import { Injectable, Logger } from '@nestjs/common';
import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { XSearchService } from './x-search.service.js';
import { INTEL_SOURCES, type SourceKind } from './source-registry.js';

/**
 * Toplayici — kaynak katalogundaki akislari ceker, tekillestirir, ham
 * IntelItem olarak yazar. LLM'e HIC dokunmaz: burasi ucuz ve deterministik
 * kalmali ki gunde binlerce yayin taranabilsin. Eleme bir sonraki
 * asamada (triage) yapilir.
 *
 * TEKILLESTIRME: ayni yazi birden fazla feed'den gelir (Search Engine Land
 * ve Search Engine Journal ayni Google duyurusunu verir; ayni makale iki
 * subreddit'e dusebilir). Parmak izi normalize URL + normalize baslik
 * uzerinden hesaplanir ve GLOBAL unique'tir — ayni icerigi iki kez analiz
 * edip iddia defterine cift kanit yazmayi engeller.
 */

const UA = 'Mozilla/5.0 (compatible; RanksUpIntel/1.0; +https://ranksup.ai/bot)';
const FETCH_TIMEOUT_MS = 20_000;
/** Ust uste bu kadar hatadan sonra kaynak otomatik devre disi kalir */
const MAX_FAILS = 5;
/** Bir cekimde tek kaynaktan alinacak azami yeni kayit */
const MAX_ITEMS_PER_SOURCE = 40;
/** HN'de bu puanin altindaki hikayeler gurultu sayilir */
const HN_MIN_POINTS = 15;

/**
 * Kaynak tipi bazli fren. Degerler CANLI OLCUMLE belirlendi: tum katalog
 * ard arda cekildiginde bazi bloglar (ahrefs, openai, apple) hizli ardisik
 * isteklerde baglantiyi reddetti — halbuki tek baslarina sorunsuz cevap
 * veriyorlar.
 */
const THROTTLE_MS: Partial<Record<SourceKind, number>> = {
  // Reddit anonim .rss ucunda kota TEK istekte tukeniyor: yanit basliklari
  // x-ratelimit-remaining: 0 ve x-ratelimit-reset: 33 donuyor. Iki subreddit
  // ard arda cekildiginde ikincisi 429 aliyordu. Reset suresinin ustunde
  // bekliyoruz.
  reddit: 35_000,
  rss: 1500,
  github: 1000,
  hn: 1000,
};

/** Gecici ag hatasi / 429 sonrasi tek yeniden deneme oncesi bekleme */
const RETRY_DELAY_MS = 4000;

export interface RawItem {
  url: string;
  title: string;
  author?: string | null;
  publishedAt?: Date | null;
  summary?: string | null;
  engagement?: number | null;
  meta?: Record<string, any>;
}

@Injectable()
export class IntelCollectorService {
  private readonly log = new Logger(IntelCollectorService.name);
  /** Kaynak tipi → son istek zamani; throttle icin */
  private readonly lastRequestAt = new Map<SourceKind, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly xSearch: XSearchService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  KATALOG SENKRONU
  // ────────────────────────────────────────────────────────────

  /**
   * source-registry.ts'i DB'ye yansitir. Kodda tanimli alanlar (isim,
   * hedef, agirlik) uzerine yazilir; CALISMA ZAMANI durumu (enabled,
   * failCount, lastFetchedAt) korunur — admin panelden kapatilmis bir
   * kaynak her deploy'da geri acilmasin diye.
   */
  async syncCatalog(): Promise<{ created: number; updated: number; retired: number }> {
    let created = 0;
    let updated = 0;

    for (const def of INTEL_SOURCES) {
      const existing = await this.prisma.intelSource.findUnique({
        where: { key: def.key },
        select: { id: true },
      });

      const data = {
        name: def.name,
        kind: def.kind,
        target: def.target,
        tier: def.tier,
        topics: def.topics as any,
        weight: def.weight,
        intervalHours: def.intervalHours,
        note: def.note ?? null,
      };

      if (existing) {
        await this.prisma.intelSource.update({ where: { key: def.key }, data });
        updated++;
      } else {
        await this.prisma.intelSource.create({ data: { key: def.key, ...data } });
        created++;
      }
    }

    // Katalogdan CIKARILAN kaynaklar DB'de yetim kalir ve cekilmeye devam
    // eder (ornegin bot korumasi yuzunden kaldirdigimiz bir feed). Silmiyoruz
    // — gecmis yayinlari ve kanit zincirini korumak icin — ama kapatiyoruz.
    const known = INTEL_SOURCES.map((s) => s.key);
    const retiredRes = await this.prisma.intelSource.updateMany({
      where: { key: { notIn: known }, enabled: true },
      data: { enabled: false, lastError: 'Kaynak katalogdan cikarildi' },
    });
    if (retiredRes.count > 0) {
      this.log.log(`${retiredRes.count} kaynak katalogdan cikarildigi icin kapatildi`);
    }

    return { created, updated, retired: retiredRes.count };
  }

  // ────────────────────────────────────────────────────────────
  //  TOPLAMA
  // ────────────────────────────────────────────────────────────

  /** Cekim zamani gelmis tum kaynaklari sirayla toplar. */
  async collectDue(): Promise<{ sources: number; newItems: number; errors: number }> {
    const sources = await this.prisma.intelSource.findMany({
      where: { enabled: true },
      orderBy: { lastFetchedAt: 'asc' },
    });

    const now = Date.now();
    let newItems = 0;
    let errors = 0;
    let touched = 0;

    for (const src of sources) {
      const due =
        !src.lastFetchedAt ||
        now - src.lastFetchedAt.getTime() >= src.intervalHours * 3_600_000;
      if (!due) continue;

      touched++;
      try {
        const count = await this.collectSource(src.id);
        newItems += count;
      } catch (err: any) {
        errors++;
        this.log.warn(`[${src.key}] toplama hatasi: ${err.message}`);
      }
    }

    return { sources: touched, newItems, errors };
  }

  /** Tek kaynagi ceker ve yeni kayitlari yazar. Hata sayacini yonetir. */
  async collectSource(sourceId: string): Promise<number> {
    const src = await this.prisma.intelSource.findUniqueOrThrow({ where: { id: sourceId } });
    const kind = src.kind as SourceKind;

    try {
      await this.throttle(kind);
      const raw = await this.fetchByKind(kind, src.target);
      const saved = await this.persist(src.id, raw.slice(0, MAX_ITEMS_PER_SOURCE));

      // BOS FEED KOR NOKTASI: seroundtable gibi bazi kaynaklar HTTP 200
      // donup govdeyi bos birakiyor (bot korumasi). Hata sayilmadigi icin
      // kaynak "saglam" gorunur ve aylarca sessizce hicbir sey getirmez.
      // "0 YENI kayit" (hepsi zaten var) ile "feed'de 0 kayit" ayri seyler;
      // yalnizca ikincisi isaretlenir.
      const emptyFeed = raw.length === 0;
      if (emptyFeed) {
        this.log.warn(`[${src.key}] feed bos dondu (HTTP basarili ama icerik yok)`);
      }

      await this.prisma.intelSource.update({
        where: { id: src.id },
        data: {
          lastFetchedAt: new Date(),
          failCount: 0,
          lastError: emptyFeed ? 'Feed bos dondu — icerik yok (bot korumasi veya olu etiket olabilir)' : null,
        },
      });

      if (saved > 0) this.log.log(`[${src.key}] ${saved} yeni kayit`);
      return saved;
    } catch (err: any) {
      const failCount = src.failCount + 1;
      await this.prisma.intelSource.update({
        where: { id: src.id },
        data: {
          failCount,
          lastError: String(err.message).slice(0, 500),
          lastFetchedAt: new Date(),
          // Surekli hata veren kaynak kendini kapatir; katalogda kalir,
          // admin panelden gerekcesiyle gorulur ve elle acilabilir.
          ...(failCount >= MAX_FAILS ? { enabled: false } : {}),
        },
      });
      if (failCount >= MAX_FAILS) {
        this.log.error(`[${src.key}] ${MAX_FAILS} ust uste hata — kaynak devre disi birakildi`);
      }
      throw err;
    }
  }

  private async fetchByKind(kind: SourceKind, target: string): Promise<RawItem[]> {
    switch (kind) {
      case 'rss':
        return this.fetchFeed(target);
      case 'github':
        return this.fetchFeed(`https://github.com/${target}/releases.atom`);
      case 'reddit':
        return this.fetchReddit(target);
      case 'hn':
        return this.fetchHackerNews(target);
      case 'x':
        return this.xSearch.search(target);
      default:
        return [];
    }
  }

  // ────────────────────────────────────────────────────────────
  //  FEED PARSE — RSS 2.0 ve Atom tek yoldan
  // ────────────────────────────────────────────────────────────

  private async fetchFeed(url: string): Promise<RawItem[]> {
    const xml = await this.httpText(url);
    const $ = load(xml, { xml: true });
    const out: RawItem[] = [];

    // RSS 2.0
    $('item').each((_, el) => {
      const $el = $(el);
      const link = $el.find('link').first().text().trim() || $el.find('guid').first().text().trim();
      const title = $el.find('title').first().text().trim();
      if (!link || !title) return;
      out.push({
        url: link,
        title,
        author: $el.find('dc\\:creator, creator, author').first().text().trim() || null,
        publishedAt: parseDate($el.find('pubDate, dc\\:date, date').first().text()),
        summary: cleanHtml(
          $el.find('description').first().text() ||
          $el.find('content\\:encoded, encoded').first().text(),
        ),
      });
    });

    // Atom — Reddit, GitHub releases ve bazi bloglar bu formatta
    if (out.length === 0) {
      $('entry').each((_, el) => {
        const $el = $(el);
        // Atom'da link bir attribute: <link href="..."/>; alternate rel tercih edilir
        const link =
          $el.find('link[rel="alternate"]').attr('href') ||
          $el.find('link').first().attr('href') ||
          $el.find('id').first().text().trim();
        const title = $el.find('title').first().text().trim();
        if (!link || !title) return;
        out.push({
          url: link,
          title,
          author: $el.find('author > name').first().text().trim() || null,
          publishedAt: parseDate(
            $el.find('published').first().text() || $el.find('updated').first().text(),
          ),
          summary: cleanHtml(
            $el.find('summary').first().text() || $el.find('content').first().text(),
          ),
        });
      });
    }

    return out;
  }

  // ────────────────────────────────────────────────────────────
  //  REDDIT — .rss ucu (Atom). OAuth gerektirmez, ama UA sart:
  //  jenerik/bos UA ile 429 doner.
  // ────────────────────────────────────────────────────────────

  private async fetchReddit(subreddit: string): Promise<RawItem[]> {
    const items = await this.fetchFeed(`https://www.reddit.com/r/${subreddit}/new.rss`);
    return items.map((it) => ({ ...it, meta: { subreddit } }));
  }

  // ────────────────────────────────────────────────────────────
  //  HACKER NEWS — Algolia API (ucretsiz, anahtarsiz)
  // ────────────────────────────────────────────────────────────

  private async fetchHackerNews(target: string): Promise<RawItem[]> {
    // Algolia'nin query alani BOOLEAN OPERATOR ALMAZ — terimleri AND'ler.
    // "AI search OR llms.txt" gibi tek bir uzun sorgu hicbir sey bulmaz
    // (canli testte 0 sonuc). Bu yuzden hedef '|' ile ayrilmis bagimsiz
    // sorgular olarak yazilir ve her biri ayri istekle calistirilir.
    const queries = target.split('|').map((q) => q.trim()).filter(Boolean);
    const seen = new Set<string>();
    const out: RawItem[] = [];

    for (const q of queries) {
      await this.throttle('hn');
      const items = await this.fetchHnQuery(q).catch((err) => {
        this.log.warn(`HN sorgusu basarisiz (${q}): ${err.message}`);
        return [] as RawItem[];
      });
      for (const it of items) {
        // Ayni hikaye birden fazla sorguda cikabilir
        if (seen.has(it.url)) continue;
        seen.add(it.url);
        out.push(it);
      }
    }

    return out;
  }

  private async fetchHnQuery(query: string): Promise<RawItem[]> {
    const url =
      'https://hn.algolia.com/api/v1/search_by_date' +
      `?query=${encodeURIComponent(query)}` +
      '&tags=story' +
      '&hitsPerPage=25' +
      `&numericFilters=points>=${HN_MIN_POINTS}`;

    const json = JSON.parse(await this.httpText(url));
    const hits: any[] = Array.isArray(json?.hits) ? json.hits : [];

    return hits
      .filter((h) => h.title)
      .map((h) => ({
        // Soru/Show HN gonderilerinde url bos olur — tartisma sayfasina dus
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: String(h.title),
        author: h.author ?? null,
        publishedAt: h.created_at ? new Date(h.created_at) : null,
        summary: h.story_text ? cleanHtml(h.story_text) : null,
        engagement: typeof h.points === 'number' ? h.points : null,
        meta: { hnId: h.objectID, comments: h.num_comments ?? 0 },
      }));
  }

  // ────────────────────────────────────────────────────────────
  //  YAZMA
  // ────────────────────────────────────────────────────────────

  private async persist(sourceId: string, items: RawItem[]): Promise<number> {
    let saved = 0;

    for (const it of items) {
      const fingerprint = fingerprintOf(it.url, it.title);
      try {
        await this.prisma.intelItem.create({
          data: {
            sourceId,
            fingerprint,
            url: it.url.slice(0, 2000),
            title: it.title.slice(0, 500),
            author: it.author?.slice(0, 200) ?? null,
            publishedAt: it.publishedAt ?? null,
            summary: it.summary?.slice(0, 4000) ?? null,
            engagement: it.engagement ?? null,
            meta: (it.meta ?? undefined) as any,
          },
        });
        saved++;
      } catch {
        // Unique violation = bu icerik zaten var (baska feed'den gelmis
        // olabilir). Sessiz gec — tekillestirmenin calistigi yer burasi.
      }
    }

    return saved;
  }

  // ────────────────────────────────────────────────────────────

  private async throttle(kind: SourceKind): Promise<void> {
    const wait = THROTTLE_MS[kind] ?? 0;
    if (!wait) return;
    const last = this.lastRequestAt.get(kind) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < wait) await sleep(wait - elapsed);
    this.lastRequestAt.set(kind, Date.now());
  }

  /**
   * Tek yeniden denemeli GET. Katalogun tamami ard arda cekildiginde
   * gecici baglanti reddi ve 429 gorulüyor; bu istekler saniyeler sonra
   * sorunsuz calisiyor. Tek retry, kaynagi bosuna "hatali" isaretleyip
   * MAX_FAILS sayacini sisirmemek icin.
   */
  private async httpText(url: string, attempt = 0): Promise<string> {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: 'application/rss+xml, application/atom+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.8',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      });

      // 429/503 gecici; 404/403 kalici — kalicida retry zaman kaybi
      if ((res.status === 429 || res.status === 503) && attempt === 0) {
        // Reddit retry-after gondermez ama x-ratelimit-reset (saniye) verir
        const retryAfter = parseInt(res.headers.get('retry-after') ?? '', 10);
        const rlReset = parseInt(res.headers.get('x-ratelimit-reset') ?? '', 10);
        const waitSec = Number.isFinite(retryAfter) ? retryAfter : Number.isFinite(rlReset) ? rlReset : 0;
        await sleep(waitSec > 0 ? Math.min(waitSec * 1000 + 1000, 45_000) : RETRY_DELAY_MS);
        return this.httpText(url, attempt + 1);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
      return res.text();
    } catch (err: any) {
      // Ag katmani hatasi (fetch failed / timeout) — bir kez daha dene
      if (attempt === 0 && !String(err.message).startsWith('HTTP ')) {
        await sleep(RETRY_DELAY_MS);
        return this.httpText(url, attempt + 1);
      }
      throw err;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  Saf yardimcilar — test edilebilir kalsin diye sinif disinda
// ═══════════════════════════════════════════════════════════════

/** Takip/kampanya parametreleri icerigi degistirmez; parmak izinden atilir. */
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ref|source|__hs)/i;

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    // Sondaki '/' varligi ayni sayfayi iki kayda bolmesin
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * Parmak izi. URL TEK BASINA yetmez: ayni yazi kanonik adresiyle,
 * Reddit paylasimiyla ve Medium aynasiyla farkli URL'lerde gorunur.
 * Basligi da katarak (normalize edilmis) ayni icerigi yakalariz.
 */
export function fingerprintOf(url: string, title: string): string {
  const t = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 120);
  return createHash('sha1').update(`${normalizeUrl(url)}|${t}`).digest('hex');
}

export function parseDate(input: string | undefined | null): Date | null {
  if (!input) return null;
  const d = new Date(input.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Feed ozetleri HTML icerir — triage'a duz metin gitsin. */
export function cleanHtml(input: string | undefined | null): string | null {
  if (!input) return null;
  const text = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
