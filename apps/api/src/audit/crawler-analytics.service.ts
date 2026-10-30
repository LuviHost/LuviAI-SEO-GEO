import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeFetchText, type SafeTextResult } from '../common/safe-fetch.js';
import { detectBlock } from '../common/block-detect.js';
import { CRAWLER_EVENT_RETENTION_DAYS } from './crawler-event-retention.js';

/** Sitemap duz metin ama devasa olabilir — belge basina 8 MB tavan */
const SITEMAP_MAX_BYTES = 8 * 1024 * 1024;
/** Indeksten en fazla bu kadar alt sitemap okunur; fazlasinda oran hesaplanmaz */
const MAX_CHILD_SITEMAPS = 25;
/**
 * Kapsam icin sitemap adresleri bellekte (onbellekte) tutulur; tek bir
 * sitemap dosyasinin protokol tavani kadarina izin var. Fazlasinda oran
 * hesaplanmaz — kismi listeyle oran yanlis cikardi.
 */
const MAX_SITEMAP_URLS = 50_000;
/** Panel ucu bekletilmesin: tum sitemap okumasi icin toplam sure */
const SITEMAP_BUDGET_MS = 8_000;
/** Ayni site icin sitemap her panel acilisinda yeniden indirilmesin */
const SITEMAP_CACHE_MS = 15 * 60 * 1000;
/** Onbellekte en fazla bu kadar site — adres listeleri bellegi sisirmesin */
const SITEMAP_CACHE_MAX_SITES = 20;
/** Edge ham yollarindan en fazla bu kadar tekil yol okunur; fazlasinda oran "en az" */
const MAX_EVENT_PATHS = 20_000;

const XML_ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return XML_ENTITY[e.toLowerCase()] ?? m;
  });
}

/**
 * Sitemap belgesindeki <loc> adresleri ve belge turu. Indeksteki <loc>'lar
 * SAYFA degil alt sitemap adresidir — ayrimi burada yapilir.
 *
 * XML kacislari cozulur (protokol & isaretini &amp; yazdirir: ?p=1&amp;lang=tr)
 * ve CDATA icindeki adres de okunur; yoksa sorgulu adresler ziyaret edilen
 * adresle hic eslesmezdi. <image:loc> / <video:content_loc> sayfa degildir,
 * desen onlari almaz.
 *
 * Desendeki tekrarlar sinirli, birbiriyle ortusmez ve '<' gorunce durur:
 * belge musteri sitesinden gelir (8 MB'a kadar); kapanmayan <loc> / CDATA
 * yigini geri izleme patlamasiyla (ReDoS) sureci kilitleyemesin (8 MB'lik
 * kotu niyetli belgelerde ~10 ms olculdu). Protokolde adres 2048 karakterden
 * kisa olmali; 4096 bosluklu yazima pay birakir.
 */
export function readSitemapLocs(xml: string): { kind: 'urlset' | 'index' | 'none'; locs: string[] } {
  const kind = /<sitemapindex[\s>]/i.test(xml) ? 'index' : /<urlset[\s>]/i.test(xml) ? 'urlset' : 'none';
  const locs = kind === 'none'
    ? []
    : [...xml.matchAll(/<loc>(?:\s*<!\[CDATA\[([^<]{0,4096}?)\]\]>\s*|([^<]{0,4096}))<\/loc>/gi)]
      .map((m) => decodeXmlEntities((m[1] ?? m[2] ?? '').trim()))
      .filter(Boolean);
  return { kind, locs };
}

/** "www." farki ayni site; sondaki nokta ve buyuk harf yok sayilir */
function hostKey(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
}

/**
/**
 * Sayfayi degistirmeyen izleme parametreleri — "/blog/a?utm_source=x" ayni
 * sayfadir. srsltid: Google'in arama sonucundaki urun adreslerine ekledigi parametre.
 */
const TRACKING_PARAM = /^(?:utm_[a-z0-9_]*|gclid|fbclid|msclkid|yclid|dclid|gbraid|wbraid|_ga|_gl|mc_cid|mc_eid|igshid|srsltid)$/i;

/** Izleme parametresiz, sirali sorgu ("" ya da "?a=1&b=2") — iki taraf ayni bicime gelsin */
function canonicalQuery(search: string): string {
  if (!search || search === '?') return '';
  const kept = [...new URLSearchParams(search)]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  return kept.length > 0 ? `?${new URLSearchParams(kept).toString()}` : '';
}

/**
 * Ziyaret ya da sitemap adresi → karsilastirma bicimi. null: gecersiz ya da
 * baska bir alan adina ait (sitemap baska host listeleyebilir; log satirinda
 * mutlak adres olabilir).
 *  - Goreli yol (log satiri, edge yolu) sitenin kendi alan adinda sayilir.
 *  - Alan adi www'siz ve kucuk harfle karsilastirilir; http/https farki yok.
 *  - Yolun %-kacislari cozulur (%C3%A7 = ç; buyuk/kucuk onaltilik farki kalmaz).
 *  - Sondaki / atilir, kok "/" kalir: /blog/a/ = /blog/a.
 *  - #parca atilir. Sorgu KORUNUR (sitemap ?p=123 gibi sorgulu adres
 *    listeleyebilir; "/?s=ara" ana sayfa ziyareti sayilmaz) ama izleme
 *    parametreleri atilir ve kalanlar siralanir.
 */
export function normalizeCoverageUrl(raw: string, site: URL): { path: string; query: string } | null {
  let u: URL;
  try { u = new URL(raw.trim(), site); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (hostKey(u.hostname) !== hostKey(site.hostname)) return null;
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { /* bozuk kacis — ham yol */ }
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/';
  return { path, query: canonicalQuery(u.search) };
}

export type CoverageUnavailableReason =
  /** Site kaydi / adresi yok */
  | 'no_site'
  /** Ziyaretlerde adres bilgisi yok — oranin payi bilinmiyor */
  | 'no_visits'
  /** /sitemap.xml okunamadi ya da site haritasi degil */
  | 'sitemap_unavailable'
  /** Site haritasina erisimimiz engellendi (WAF, bot dogrulamasi...) */
  | 'sitemap_blocked'
  /** Bir alt site haritasi okunamadi, belge kesildi ya da sure doldu */
  | 'sitemap_incomplete'
  /** Alt site haritasi ya da adres sayisi tavanin ustunde */
  | 'sitemap_too_large'
  /** Site haritasinda bu alan adina ait sayfa yok */
  | 'sitemap_empty';

/**
 * Sayfa tarama kapsami: sitemap'teki sayfalarin kacini en az bir bot ziyaret
 * etti. Oran = |ziyaret edilen ∩ sitemap| / |sitemap|.
 */
export interface CrawlCoverage {
  /** Botlarin istedigi tekil yol sayisi — robots.txt, feed, wp-json gibi sayfa olmayanlar DAHIL */
  uniquePathsVisited: number;
  /** Sitemap'teki tekil sayfa sayisi (sitenin alan adinda); okunamadiysa null */
  sitePagesTotal: number | null;
  /** Sitemap sayfalarindan en az bir bot ziyareti gorenlerin sayisi */
  sitemapPagesVisited: number | null;
  /** sitemapPagesVisited / sitePagesTotal, yuzde (0.1 hassasiyet); hesaplanamadiysa null */
  pagesCrawledPct: number | null;
  /** Ziyaret listesi eksik/orneklem: oran gercegin ALT siniridir ("en az") */
  partial: boolean;
  unavailableReason: CoverageUnavailableReason | null;
  /** Kullaniciya gosterilecek tek cumle (unavailableReason varken) */
  unavailableText: string | null;
}

type SitemapPages =
  | { ok: true; keys: Set<string> }
  | { ok: false; reason: CoverageUnavailableReason; text: string };

/** Karsilastirma anahtari — ziyaret ve sitemap tarafi AYNI bicimle */
function coverageKey(n: { path: string; query: string }): string {
  return `${n.path}${n.query}`;
}

export interface CrawlerLogEntry {
  ip: string;
  userAgent: string;
  url: string;
  status: number;
  bytes: number;
  timestamp: Date;
}

export interface CrawlerSummary {
  bot: string;
  category: 'ai-search' | 'training' | 'classic-search' | 'social' | 'unknown';
  hits: number;
  uniqueUrls: number;
  topUrls: Array<{ url: string; count: number }>;
  /** Basarili son cevap: 2xx + 304 Not Modified (isSuccessfulCrawlStatus) */
  status2xx: number;
  status4xx: number;
  status5xx: number;
  bytesServed: number;
}

/**
 * Durum kodu AiCrawlerHit.status2xx ("basarili istek") kovasina mi yazilir —
 * iki guvenilir yazicinin ORTAK kurali: log yuklemesi (summarize) ve imzali
 * edge ingest (live-crawler.service updateDailyAggregates).
 *
 * 2xx ve 304 Not Modified. NEDEN 304: kosullu GET'e verilen basarili SON
 * cevaptir. RFC 9110 15.4.5: "would have resulted in a 200 (OK) response if it
 * were not for the fact that the condition evaluated to false"; Google'in
 * tarayici belgesi: "the content is the same as last time it was crawled"
 * (https://developers.google.com/crawling/docs/troubleshooting/http-status-codes,
 * 2026-10-18'de okundu). Eskiden 304 hicbir kovaya girmiyordu: onbellekli,
 * saglikli sitede Bingbot'un 304'leri hata oraninin paydasindan dusuyor ve
 * sahte "sitene ulaşamıyor" alarmi gidiyordu (inceleme R16); yalniz 304 alan
 * bot da "site ayakta" kaniti sayilmadigi icin gercek bir engel alarmsiz
 * kalabiliyordu.
 *
 * NEDEN 301/302/307/308 DEGIL: yonlendirme son cevap degildir (RFC 9110 15.4:
 * "further action needs to be taken by the user agent"); bot hedefi izler ve
 * hedefin cevabi ayri bir istek olarak sayilir (Google en fazla 10 adim izler,
 * ayni belge). Basarili sayilsaydi uygulamasi 502 veren ama nginx'te
 * http→https yonlendirmesi calisan bir sitede botlar "basarili yanit aliyor"
 * gorunur, alarm site komple dusukken "bu bota ozel engel var" derdi.
 * Yonlendirmeler hits'te kalir; alarm onlari "ulasildi" olarak paydaya kendisi
 * ekler (crawler-error-alarm.service trustedStatusRow).
 */
export function isSuccessfulCrawlStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 304;
}

/** AiCrawlerHit satirinin log yuklemesinin dokundugu sayac alanlari */
export type CrawlerHitCounters = Pick<CrawlerSummary, 'hits' | 'uniqueUrls' | 'status2xx' | 'status4xx' | 'status5xx' | 'bytesServed'>;

const LOG_COUNTER_FIELDS = ['hits', 'uniqueUrls', 'status2xx', 'status4xx', 'status5xx', 'bytesServed'] as const;

/**
 * Log yuklemesinin mevcut gunluk satira YIKICI OLMAYAN birlestirmesi — saf.
 *
 * NEDEN: yukleme eskiden satiri mutlak degerle eziyordu (hits: s.hits). Ayni
 * (site, gun, bot) satirina imzali edge ingest (live-crawler) ve beacon ara
 * katmani `increment` ile yazar; Worker'in gun icinde topladigi 900 ziyaret,
 * 100 satirlik bir log parcasi yuklenince 100'e dusuyordu.
 *
 * NEDEN TOPLAMA DEGIL "EKSIK KADAR ARTIR" (max): log ile edge ajani AYNI
 * trafigi gorur — sunucu logundaki bot istegini Worker da yakalamistir.
 * Duz toplama ayni ziyareti iki kez sayardi; ayni logu yeniden yuklemek de
 * sayilari katlardi. Her sayac max(mevcut, log) olur ve bu fark `increment`
 * ile yazilir: okuma ile yazma arasinda canli ingest artirirsa o artis
 * kaybolmaz (en kotu durumda hafif fazla sayim, asla silme). Ayni logu ikinci
 * kez yuklemek idempotenttir. Bilinen sinir: ayni gunun AYRIK iki log parcasi
 * (dondurulmus log) toplanmaz, buyuk olan kalir — eksik sayim, kayip degil.
 *
 * topUrls: adres basina en buyuk sayi, ilk 10 (ayni max kurali).
 */
export function mergeLogIntoDailyHit(
  existing: (CrawlerHitCounters & { topUrls?: unknown }) | null,
  log: CrawlerHitCounters & { topUrls: Array<{ url: string; count: number }> },
): { increments: CrawlerHitCounters; topUrls: Array<{ url: string; count: number }> } {
  const increments = {} as CrawlerHitCounters;
  for (const f of LOG_COUNTER_FIELDS) {
    const cur = Number(existing?.[f] ?? 0) || 0;
    increments[f] = Math.max(0, (log[f] ?? 0) - cur);
  }
  const byUrl = new Map<string, number>();
  const prev = Array.isArray(existing?.topUrls) ? (existing!.topUrls as Array<{ url?: unknown; count?: unknown }>) : [];
  for (const u of [...prev, ...log.topUrls]) {
    if (typeof u?.url !== 'string') continue;
    const c = Number(u.count) || 0;
    byUrl.set(u.url, Math.max(byUrl.get(u.url) ?? 0, c));
  }
  const topUrls = [...byUrl.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([url, count]) => ({ url, count }));
  return { increments, topUrls };
}

/**
 * Yalniz robots.txt'te KONTROL belirteci olan, kendi HTTP kullanici ajani
 * OLMAYAN adlar — sunucu logunda hic gorunmezler, ziyaret takibine girmezler.
 *
 * Google-Extended: "Google-Extended doesn't have a separate HTTP request user
 * agent string. Crawling is done with existing Google user agent strings; the
 * robots.txt user-agent token is used in a control capacity."
 * (https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers,
 * 2026-10-18'de dogrulandi). Eskiden /Google-Extended/ ile aranip "Google
 * Gemini training" diye listeleniyordu: gercek bir istekle hic eslesemez,
 * eslesen satir ancak sahte (taklit) bir kullanici ajanindan gelir. Bu taramayi
 * Googlebot yapar ve oyle sayilir. Robots.txt durusu agent-readiness /
 * robots-check'te (known-ai-bots.ts) olculmeye devam eder.
 */
export const ROBOTS_ONLY_TOKENS: ReadonlySet<string> = new Set(['Google-Extended']);

const BOT_REGISTRY: Record<string, { match: RegExp; category: CrawlerSummary['category']; label: string }> = {
  'GPTBot': { match: /GPTBot/i, category: 'training', label: 'OpenAI GPTBot' },
  'OAI-SearchBot': { match: /OAI-SearchBot/i, category: 'ai-search', label: 'ChatGPT Search' },
  'ChatGPT-User': { match: /ChatGPT-User/i, category: 'ai-search', label: 'ChatGPT (user link)' },
  'ClaudeBot': { match: /ClaudeBot/i, category: 'training', label: 'Anthropic ClaudeBot' },
  'Claude-Web': { match: /Claude-Web/i, category: 'ai-search', label: 'Claude.ai' },
  'PerplexityBot': { match: /PerplexityBot/i, category: 'ai-search', label: 'Perplexity' },
  'Perplexity-User': { match: /Perplexity-User/i, category: 'ai-search', label: 'Perplexity (user)' },
  'Googlebot': { match: /Googlebot[^-]/i, category: 'classic-search', label: 'Googlebot' },
  'Bingbot': { match: /Bingbot/i, category: 'classic-search', label: 'Bingbot (Copilot)' },
  'Applebot': { match: /Applebot[^-]/i, category: 'classic-search', label: 'Applebot' },
  'Applebot-Extended': { match: /Applebot-Extended/i, category: 'training', label: 'Apple Intelligence training' },
  'Bytespider': { match: /Bytespider/i, category: 'ai-search', label: 'TikTok ByteDance' },
  'Amazonbot': { match: /Amazonbot/i, category: 'ai-search', label: 'Amazon Alexa+/Rufus' },
  'CCBot': { match: /CCBot/i, category: 'training', label: 'Common Crawl' },
  'YouBot': { match: /YouBot/i, category: 'ai-search', label: 'You.com' },
  'cohere-ai': { match: /cohere-ai/i, category: 'training', label: 'Cohere' },
  'DuckAssistBot': { match: /DuckAssistBot/i, category: 'ai-search', label: 'DuckDuckGo AI' },
  'Meta-ExternalAgent': { match: /Meta-ExternalAgent/i, category: 'ai-search', label: 'Meta AI' },
  'Mistral': { match: /Mistral/i, category: 'ai-search', label: 'Mistral Le Chat' },
  'DeepSeek': { match: /DeepSeek/i, category: 'training', label: 'DeepSeek' },
  'FacebookBot': { match: /FacebookBot|facebookexternalhit/i, category: 'social', label: 'Meta Link Preview' },
  'Twitterbot': { match: /Twitterbot/i, category: 'social', label: 'X/Twitter' },
  'LinkedInBot': { match: /LinkedInBot/i, category: 'social', label: 'LinkedIn' },
};

/**
 * Crawler Analytics — sunucu log dosyasini parse edip AI bot trafigini olcer.
 * Apache combined log format veya nginx default format'i destekler.
 *
 * Sunucu tarafinda:
 *   - Apache: /var/log/apache2/access.log
 *   - Nginx: /var/log/nginx/access.log
 *   - cPanel: /home/<user>/access-logs/<domain>
 *
 * MVP: Kullanici log dosyasinin son 1000 satirini upload eder, parse ederiz,
 * gunluk DB snapshot kaydederiz. Frontend trend grafigi cizer.
 */
@Injectable()
export class CrawlerAnalyticsService {
  private readonly log = new Logger(CrawlerAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** site.url → sitemap sayfa anahtarlari ya da okunamama nedeni */
  private readonly sitemapCache = new Map<string, { at: number; result: SitemapPages }>();

  /**
   * Apache combined log format parser:
   *   IP - - [date] "GET /url HTTP/1.1" status bytes "ref" "ua"
   */
  parseApacheLog(logContent: string): CrawlerLogEntry[] {
    const lines = logContent.split('\n').filter(l => l.trim().length > 0);
    const re = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+\S+"\s+(\d+)\s+(\d+|-)\s+"[^"]*"\s+"([^"]*)"/;
    const entries: CrawlerLogEntry[] = [];

    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;
      const [, ip, dateStr, , url, status, bytes, ua] = m;
      try {
        entries.push({
          ip,
          userAgent: ua,
          url,
          status: parseInt(status, 10),
          bytes: bytes === '-' ? 0 : parseInt(bytes, 10),
          timestamp: new Date(dateStr.replace(':', ' ').replace(' +', '+')),
        });
      } catch {
        // skip malformed
      }
    }
    return entries;
  }

  /**
   * Log entries'i bot bazinda gruplayip ozet cikarir.
   */
  summarize(entries: CrawlerLogEntry[]): Map<string, CrawlerSummary> {
    const summary = new Map<string, CrawlerSummary>();

    for (const entry of entries) {
      const ua = entry.userAgent;
      let matchedBot: string | null = null;
      let category: CrawlerSummary['category'] = 'unknown';

      for (const [name, info] of Object.entries(BOT_REGISTRY)) {
        if (info.match.test(ua)) {
          matchedBot = name;
          category = info.category;
          break;
        }
      }
      if (!matchedBot) continue; // sadece bot trafigi

      let s = summary.get(matchedBot);
      if (!s) {
        s = {
          bot: matchedBot,
          category,
          hits: 0,
          uniqueUrls: 0,
          topUrls: [],
          status2xx: 0,
          status4xx: 0,
          status5xx: 0,
          bytesServed: 0,
        };
        summary.set(matchedBot, s);
      }

      s.hits++;
      s.bytesServed += entry.bytes;
      // 304 basarili kovada; diger 3xx yalniz hits'te (isSuccessfulCrawlStatus)
      if (isSuccessfulCrawlStatus(entry.status)) s.status2xx++;
      else if (entry.status >= 400 && entry.status < 500) s.status4xx++;
      else if (entry.status >= 500) s.status5xx++;
    }

    // Top URLs hesapla
    const urlCounts = new Map<string, Map<string, number>>();
    for (const entry of entries) {
      let bot: string | null = null;
      for (const [name, info] of Object.entries(BOT_REGISTRY)) {
        if (info.match.test(entry.userAgent)) { bot = name; break; }
      }
      if (!bot) continue;
      let urls = urlCounts.get(bot);
      if (!urls) { urls = new Map(); urlCounts.set(bot, urls); }
      urls.set(entry.url, (urls.get(entry.url) ?? 0) + 1);
    }
    for (const [bot, urls] of urlCounts) {
      const s = summary.get(bot);
      if (!s) continue;
      s.uniqueUrls = urls.size;
      s.topUrls = [...urls.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([url, count]) => ({ url, count }));
    }

    return summary;
  }

  /**
   * Site icin log content'i parse et + DB'ye yaz.
   */
  async ingestLog(siteId: string, logContent: string): Promise<{ entries: number; bots: number; saved: number }> {
    const entries = this.parseApacheLog(logContent);
    if (entries.length === 0) return { entries: 0, bots: 0, saved: 0 };

    // Tarih bazli grupla
    const byDate = new Map<string, CrawlerLogEntry[]>();
    for (const e of entries) {
      const d = e.timestamp.toISOString().slice(0, 10);
      const list = byDate.get(d) ?? [];
      list.push(e);
      byDate.set(d, list);
    }

    let saved = 0;
    let totalBots = 0;
    for (const [dateStr, dayEntries] of byDate) {
      const summary = this.summarize(dayEntries);
      totalBots = Math.max(totalBots, summary.size);
      const date = new Date(dateStr);

      for (const [bot, s] of summary) {
        try {
          // Mutlak deger yazmak canli ingest sayaclarini eziyordu — bkz. mergeLogIntoDailyHit
          const where = { siteId_date_bot: { siteId, date, bot } };
          const existing = await this.prisma.aiCrawlerHit.findUnique({ where });
          const merged = mergeLogIntoDailyHit(existing, s);
          await this.prisma.aiCrawlerHit.upsert({
            where,
            update: {
              hits: { increment: merged.increments.hits },
              uniqueUrls: { increment: merged.increments.uniqueUrls },
              topUrls: merged.topUrls as any,
              status2xx: { increment: merged.increments.status2xx },
              status4xx: { increment: merged.increments.status4xx },
              status5xx: { increment: merged.increments.status5xx },
              bytesServed: { increment: merged.increments.bytesServed },
            },
            create: {
              siteId,
              date,
              bot,
              hits: s.hits,
              uniqueUrls: s.uniqueUrls,
              topUrls: s.topUrls as any,
              status2xx: s.status2xx,
              status4xx: s.status4xx,
              status5xx: s.status5xx,
              bytesServed: s.bytesServed,
            },
          });
          saved++;
        } catch (err: any) {
          this.log.warn(`[${siteId}] Crawler hit kaydedilemedi: ${err.message}`);
        }
      }
    }

    this.log.log(`[${siteId}] Crawler log ingest: ${entries.length} satir, ${totalBots} bot, ${saved} snapshot`);
    return { entries: entries.length, bots: totalBots, saved };
  }

  /**
   * Frontend icin: son N gun crawler trafigi.
   */
  async getHistory(siteId: string, rawDays = 30) {
    // ?days=abc → NaN: gecersiz tarih Prisma'da 500 veriyordu; varsayilana dus
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
    const since = new Date(Date.now() - days * 86400000);
    since.setHours(0, 0, 0, 0);

    // Robots-only belirtecler (Google-Extended) gercek bir istekle eslesemez;
    // baska yollardan yazilmis satirlari (eski kayit, taklit kullanici ajani)
    // ziyaret diye gostermeyiz — toplam ile kategori dagilimi de tutarli kalir.
    const realBots = { notIn: [...ROBOTS_ONLY_TOKENS] };
    const hits = await this.prisma.aiCrawlerHit.findMany({
      where: { siteId, date: { gte: since }, bot: realBots },
      orderBy: { date: 'asc' },
    });

    // Bu site icin her bot'un TUM zamanlardaki ilk kayit tarihi (firstSeen alarmi icin)
    const firstSeenRows = await this.prisma.aiCrawlerHit.groupBy({
      by: ['bot'],
      where: { siteId, bot: realBots },
      _min: { date: true },
    });
    const firstSeen: Record<string, string> = {};
    for (const r of firstSeenRows) {
      if (r._min.date) firstSeen[r.bot] = r._min.date.toISOString();
    }

    // Kategoriye gore grupla
    const byCategory: Record<string, number> = {
      'ai-search': 0,
      'training': 0,
      'classic-search': 0,
      'social': 0,
    };
    const byBot: Record<string, number> = {};
    const byDate: Record<string, Record<string, number>> = {};

    for (const h of hits) {
      const info = BOT_REGISTRY[h.bot];
      if (info) byCategory[info.category] = (byCategory[info.category] ?? 0) + h.hits;
      byBot[h.bot] = (byBot[h.bot] ?? 0) + h.hits;
      const d = h.date.toISOString().slice(0, 10);
      byDate[d] = byDate[d] ?? {};
      byDate[d][h.bot] = (byDate[d][h.bot] ?? 0) + h.hits;
    }

    // Clarity-style metrikler:
    // 1) AI search purpose split — "AI Search %X vs general %Y"
    const totalHits = hits.reduce((a, h) => a + h.hits, 0);
    const aiSearchHits = byCategory['ai-search'] ?? 0;
    const trainingHits = byCategory['training'] ?? 0;
    const purposeSplit = {
      aiSearchPct: totalHits > 0 ? Math.round((aiSearchHits / totalHits) * 1000) / 10 : 0,
      trainingPct: totalHits > 0 ? Math.round((trainingHits / totalHits) * 1000) / 10 : 0,
      classicSearchPct: totalHits > 0 ? Math.round(((byCategory['classic-search'] ?? 0) / totalHits) * 1000) / 10 : 0,
      otherPct: totalHits > 0 ? Math.round(((byCategory['social'] ?? 0) / totalHits) * 1000) / 10 : 0,
    };

    // 2) Sayfa tarama kapsami — |ziyaret edilen ∩ sitemap| / |sitemap|
    const coverage = await this.computeCoverage(siteId, hits, since, days);

    return {
      days,
      since: since.toISOString(),
      totalHits,
      byCategory,
      byBot,
      byDate,
      firstSeen,
      registry: Object.fromEntries(Object.entries(BOT_REGISTRY).map(([k, v]) => [k, { label: v.label, category: v.category }])),
      // Yeni — Clarity-style
      purposeSplit,
      coverage,
    };
  }

  /**
   * Sitemap'teki sayfalarin kacini en az bir bot ziyaret etti.
   *
   * NEDEN: eski oran "botlarin istedigi TUM tekil yollar / sitemap sayfa
   * sayisi" idi ve %100'de kirpiliyordu. Pay robots.txt, feed, wp-json,
   * ?utm'li tekrarlar ve sitemap'te olmayan adresleri de sayiyordu; sitemap'in
   * hic ziyaret edilmemis yarisi olan bir site "%100 tarandi" gorunebiliyordu.
   * Simdi yalniz sitemap'te olan ve ziyaret edilen sayfalar sayilir; sitemap
   * listesi okunamazsa oran null + neden doner (yanlis oran gostermektense hic).
   *
   * Ziyaret edilen adresler iki kaynaktan: log yukleme / ara katman satirlarinin
   * topUrls'i (gun-bot basina en cok ziyaret edilen 10 adres) ve edge ajanlarinin
   * ham yollari (CrawlerHitEvent). topUrls orneklem oldugunda oran "en az" isaretlenir.
   */
  private async computeCoverage(
    siteId: string,
    hits: Array<{ topUrls: unknown; uniqueUrls: number | null }>,
    since: Date,
    days: number,
  ): Promise<CrawlCoverage> {
    const none = { sitePagesTotal: null, sitemapPagesVisited: null, pagesCrawledPct: null };
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { url: true } }).catch(() => null);
    let origin: URL | null = null;
    try { origin = site?.url ? new URL(site.url) : null; } catch { origin = null; }
    if (!site?.url || !origin) {
      return { uniquePathsVisited: 0, ...none, partial: false, unavailableReason: 'no_site', unavailableText: 'Site adresi okunamadı; oran hesaplanamıyor.' };
    }
    const siteOrigin = origin;

    /** Eslesme anahtarlari (bkz. normalizeCoverageUrl): "/blog/a/?utm_source=x" sitemap'teki "/blog/a" ile eslesir */
    const visitedKeys = new Set<string>();
    /** Tekil yol sayisi (uniquePathsVisited) */
    const visitedPaths = new Set<string>();
    let partial = false;
    const addVisited = (raw: unknown) => {
      if (typeof raw !== 'string' || !raw) return;
      const n = normalizeCoverageUrl(raw, siteOrigin);
      if (!n) return;
      visitedPaths.add(n.path);
      visitedKeys.add(coverageKey(n));
    };

    for (const h of hits) {
      const top = Array.isArray(h.topUrls) ? h.topUrls : [];
      // topUrls en cok ziyaret edilen 10 adres: daha fazla tekil adres varsa liste orneklemdir
      if ((h.uniqueUrls ?? 0) > top.length) partial = true;
      for (const u of top) addVisited((u as { url?: unknown } | null)?.url);
    }

    try {
      const rows = await this.prisma.crawlerHitEvent.groupBy({
        by: ['path'],
        where: { siteId, ts: { gte: since }, bot: { notIn: [...ROBOTS_ONLY_TOKENS] } },
        orderBy: { path: 'asc' },
        take: MAX_EVENT_PATHS,
      });
      for (const r of rows) addVisited(r.path);
      if (rows.length >= MAX_EVENT_PATHS) partial = true;
      // Ham satirlar saklama suresinden eski degil: daha uzun pencerede eski yollar silinmis
      if (rows.length > 0 && days > CRAWLER_EVENT_RETENTION_DAYS) partial = true;
    } catch (err: any) {
      this.log.warn(`[${siteId}] Ham ziyaret yollari okunamadi: ${err?.message ?? err}`);
      partial = true;
    }

    const base = { uniquePathsVisited: visitedPaths.size, partial };
    if (visitedPaths.size === 0) {
      // Pay bilinmiyor — sitemap'i bosuna indirme
      return { ...base, ...none, unavailableReason: 'no_visits', unavailableText: 'Bu dönemdeki bot ziyaretlerinde sayfa adresi kaydı yok; oran hesaplanamıyor.' };
    }

    const sitemap = await this.sitemapPages(site.url, siteOrigin);
    if (!sitemap.ok) return { ...base, ...none, unavailableReason: sitemap.reason, unavailableText: sitemap.text };
    if (sitemap.keys.size === 0) {
      return { ...base, ...none, sitePagesTotal: 0, unavailableReason: 'sitemap_empty', unavailableText: 'Site haritasında bu alan adına ait sayfa bulunamadı; oran hesaplanamıyor.' };
    }
    let matched = 0;
    for (const k of sitemap.keys) if (visitedKeys.has(k)) matched++;
    return {
      ...base,
      sitePagesTotal: sitemap.keys.size,
      sitemapPagesVisited: matched,
      pagesCrawledPct: Math.round((matched / sitemap.keys.size) * 1000) / 10,
      unavailableReason: null,
      unavailableText: null,
    };
  }

  /**
   * Sitemap'teki SAYFA adresleri (karsilastirma anahtari olarak); tam liste
   * okunamiyorsa neden — yanlis oran gostermektense hic gostermemek dogru.
   *
   * NEDEN: /sitemap.xml cogu sitede bir <sitemapindex>'tir (WordPress'te
   * Yoast sitemap_index.xml'e yonlendirir). 2026-10-17'de /sitemap.xml sunan
   * 7 ornek sitenin 7'sinde de indeks dondu (3 ile 2061 arasi alt sitemap).
   * Eski kod indeksteki <loc> sayisini — yani ALT SITEMAP sayisini — sayfa
   * sayisi saniyordu. Alt sitemap'ler okunup sayfalar toplanir; ayni adres iki
   * kez sayilmaz, baska alan adina ait adres sayilmaz. Adres musteri sitesinden
   * gelir: SSRF korumali okuma (common/safe-fetch.ts); engel sayfasi "sitemap
   * yok" sayilmaz, engel olarak raporlanir (block-detect.ts).
   */
  private async sitemapPages(siteUrl: string, origin: URL): Promise<SitemapPages> {
    const cached = this.sitemapCache.get(siteUrl);
    if (cached && Date.now() - cached.at < SITEMAP_CACHE_MS) return cached.result;
    const result = await this.readSitemapPages(siteUrl, origin);
    this.cacheSitemap(siteUrl, result);
    return result;
  }

  private async readSitemapPages(siteUrl: string, origin: URL): Promise<SitemapPages> {
    type Read =
      | { doc: { kind: 'urlset' | 'index' | 'none'; locs: string[] } }
      | { fail: 'missing' | 'incomplete' }
      | { fail: 'blocked'; reason: string };
    const deadline = Date.now() + SITEMAP_BUDGET_MS;
    const read = async (url: string): Promise<Read> => {
      const left = deadline - Date.now();
      if (left < 500) return { fail: 'incomplete' };
      let res: SafeTextResult;
      try {
        res = await safeFetchText(url, {
          timeoutMs: Math.min(5000, left),
          maxBytes: SITEMAP_MAX_BYTES,
          accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
        });
      } catch {
        return { fail: 'missing' };
      }
      const block = detectBlock(res);
      if (block) return { fail: 'blocked', reason: block.reason };
      if (!res.ok) return { fail: 'missing' };
      // Kesik belgede adresler eksik kalir → liste tam degil
      if (res.truncated) return { fail: 'incomplete' };
      return { doc: readSitemapLocs(res.text) };
    };

    const INCOMPLETE: SitemapPages = {
      ok: false,
      reason: 'sitemap_incomplete',
      text: 'Site haritasının tamamı okunamadı (bir alt site haritası açılmadı, belge kesildi ya da süre doldu); eksik listeyle oran yanlış çıkacağı için hesaplanmadı.',
    };
    const blocked = (reason: string): SitemapPages => ({
      ok: false,
      reason: 'sitemap_blocked',
      text: `Site haritası okunamadı: ${reason} Oran hesaplanamıyor.`,
    });
    const tooManyUrls: SitemapPages = {
      ok: false,
      reason: 'sitemap_too_large',
      text: `Site haritasında ${MAX_SITEMAP_URLS.toLocaleString('tr-TR')} adresten fazlası var; oran hesaplanmadı.`,
    };

    const keys = new Set<string>();
    const addLocs = (locs: string[]): boolean => {
      for (const loc of locs) {
        const n = normalizeCoverageUrl(loc, origin);
        if (n) keys.add(coverageKey(n));
        if (keys.size > MAX_SITEMAP_URLS) return false;
      }
      return true;
    };

    const root = await read(`${siteUrl.replace(/\/+$/, '')}/sitemap.xml`);
    if ('fail' in root) {
      if (root.fail === 'blocked') return blocked(root.reason);
      if (root.fail === 'incomplete') return INCOMPLETE;
      return { ok: false, reason: 'sitemap_unavailable', text: 'Site haritası (/sitemap.xml) okunamadı ya da geçerli bir site haritası değil; oran hesaplanamıyor.' };
    }
    if (root.doc.kind === 'none') {
      return { ok: false, reason: 'sitemap_unavailable', text: 'Site haritası (/sitemap.xml) okunamadı ya da geçerli bir site haritası değil; oran hesaplanamıyor.' };
    }
    if (root.doc.kind === 'urlset') return addLocs(root.doc.locs) ? { ok: true, keys } : tooManyUrls;

    if (root.doc.locs.length > MAX_CHILD_SITEMAPS) {
      return {
        ok: false,
        reason: 'sitemap_too_large',
        text: `Site haritası dizininde ${MAX_CHILD_SITEMAPS}’ten fazla alt site haritası var; oran hesaplanmadı.`,
      };
    }
    for (const child of root.doc.locs) {
      const doc = await read(child);
      if ('fail' in doc) return doc.fail === 'blocked' ? blocked(doc.reason) : INCOMPLETE;
      // Indeks icinde indeks protokolde yok; okunamayan alt belge kismi liste demek
      if (doc.doc.kind !== 'urlset') return INCOMPLETE;
      if (!addLocs(doc.doc.locs)) return tooManyUrls;
    }
    return { ok: true, keys };
  }

  /** Suresi dolanlari at, site sayisini sinirla — adres listeleri bellekte birikmesin */
  private cacheSitemap(siteUrl: string, result: SitemapPages): void {
    const now = Date.now();
    for (const [k, v] of this.sitemapCache) if (now - v.at >= SITEMAP_CACHE_MS) this.sitemapCache.delete(k);
    this.sitemapCache.delete(siteUrl);
    while (this.sitemapCache.size >= SITEMAP_CACHE_MAX_SITES) {
      const oldest = this.sitemapCache.keys().next().value;
      if (oldest === undefined) break;
      this.sitemapCache.delete(oldest);
    }
    this.sitemapCache.set(siteUrl, { at: now, result });
  }
}
