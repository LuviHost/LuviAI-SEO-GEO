import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import { safeFetchText } from '../common/safe-fetch.js';

/**
 * IndexNow anahtar bicimi: "a minimum of 8 and a maximum of 128 hexadecimal
 * characters"; izinli karakterler a-z, A-Z, 0-9 ve '-'
 * (https://www.indexnow.org/documentation, 18.10.2026'da dogrulandi).
 */
const INDEXNOW_KEY_FORMAT = /^[a-zA-Z0-9-]{8,128}$/;

/** Gonderilmeyen ya da kabul edilmeyen kanalin nedeni (musteri/MCP okuyabilir) */
export type PingSkipReasons = Partial<Record<'indexnow' | 'google' | 'bing' | 'gsc', string>>;

export interface PingResult {
  indexnow: boolean;
  /** Her zaman false: Google Indexing API kullanilmaz (asagida). Alan geriye uyum icin duruyor. */
  google: boolean;
  /** Her zaman false: Bing anonim site haritasi ping'i kaldirildi. Alan geriye uyum icin duruyor. */
  bing: boolean;
  gsc: boolean;
  /** Kanal basina neden gonderilmedigi / kabul edilmedigi */
  skipped: PingSkipReasons;
}

/**
 * Google Indexing API NEDEN YOK: Google'a gore API "can only be used to crawl
 * pages with either JobPosting or BroadcastEvent embedded in a VideoObject"
 * (https://developers.google.com/search/apis/indexing-api/v3/quickstart,
 * 18.10.2026'da dogrulandi). Eskiden HER makale adresi RanksUp'in ortak hizmet
 * hesabiyla (GOOGLE_INDEXING_SA_JSON) bildiriliyordu: makaleler bu turlerden
 * degil ve "Any attempts to abuse the Indexing API" erisimin kaldirilmasina
 * yol acabilir. Ayrica API hizmet hesabinin Search Console mulkunde SAHIP
 * olmasini ister ("Add your service account as an owner" —
 * https://developers.google.com/search/apis/indexing-api/v3/prereqs); musteri
 * mulklerinde RanksUp hesabi sahip degil. Google'a dogru kanal sitenin kendi
 * Search Console baglantisiyla site haritasi gonderimi (gsc).
 */
const GOOGLE_SKIP = 'Google Indexing API yalnız iş ilanı (JobPosting) ve canlı yayın (BroadcastEvent) sayfaları içindir; makaleler için Google\'a doğru kanal Search Console site haritasıdır.';

/**
 * Bing anonim ping'i NEDEN YOK: Bing 13 Mayis 2022'de "we will be deprecating
 * the ability for anonymous sitemap submissions starting today" dedi
 * (https://blogs.bing.com/webmaster/may-2022/Spring-cleaning-Removed-Bing-anonymous-sitemap-submission);
 * bing.com/ping?sitemap= 18.10.2026'da HTTP 410 Gone donuyor. Bing'e kanal IndexNow.
 */
const BING_SKIP = 'Bing anonim site haritası bildirimini 2022\'de kaldırdı; Bing\'e IndexNow ile bildirilir.';

/**
 * AI Indexing Pinger — yeni makale yayinlandiginda bildirim gonderir:
 *  - IndexNow (Bing, Yandex, Seznam, Naver...) — YALNIZ anahtar dosyasi
 *    bildirilen host'ta duruyorsa (sahiplik kurali, pingIndexNow)
 *  - GSC sitemap submit (Search Console API — site GSC'ye bagliysa)
 *
 * AI sistemleri (OpenAI, Anthropic, Perplexity) public indexing endpoint
 * sunmuyor. Bildirim dizine alinmayi garanti etmez ("it doesn't guarantee
 * indexing" — https://www.indexnow.org/faq).
 */
@Injectable()
export class AiIndexingPingerService {
  private readonly log = new Logger(AiIndexingPingerService.name);
  /** SSRF korumali metin okuma — anahtar dosyasi denetimi (testte degistirilir) */
  protected fetchText = safeFetchText;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gscOAuth: GscOAuthService,
  ) {}

  /**
   * Bir URL icin kanallari bildir. Hatalar yutulur — best-effort.
   */
  async pingUrl(siteId: string, url: string): Promise<PingResult> {
    const result: PingResult = {
      indexnow: false, google: false, bing: false, gsc: false,
      skipped: { google: GOOGLE_SKIP, bing: BING_SKIP },
    };

    await Promise.all([
      this.pingIndexNow(url)
        .then((r) => { result.indexnow = r.ok; if (r.skipped) result.skipped.indexnow = r.skipped; })
        .catch(() => { result.skipped.indexnow = 'IndexNow bildirimi gönderilemedi.'; }),
      this.submitGscSitemap(siteId, url)
        .then((r) => { result.gsc = r.ok; if (r.skipped) result.skipped.gsc = r.skipped; })
        .catch(() => { result.skipped.gsc = 'Search Console site haritası gönderilemedi.'; }),
    ]);

    this.log.log(
      `[${siteId}] Index ping ${url}: indexnow=${result.indexnow}, gsc=${result.gsc}${result.skipped.indexnow ? ` (indexnow: ${result.skipped.indexnow})` : ''}`,
    );
    return result;
  }

  /**
   * IndexNow — Bing, Yandex, Seznam, Naver tek API'den.
   *
   * SAHIPLIK KURALI: "To submit URLs, you must "prove" ownership of the host
   * for which URLs are being submitted ... by hosting at least one text file
   * within the host"; dosya yoksa ya da eslesmiyorsa "IndexNow submissions
   * will not be accepted" (https://www.indexnow.org/documentation,
   * https://www.indexnow.org/faq — 18.10.2026'da dogrulandi). Repodaki tek
   * anahtar dosyasi apps/web/public altinda, yani yalniz ranksup.ai kokunde
   * sunuluyor; eskiden HER musteri alan adi bu ortak anahtarla gonderiliyordu — arama motoru
   * reddeder, ama API ilk istekte 202 ("key validation pending") donup sonucu
   * "indexnow: true" gosteriyordu. Simdi once <origin>/<anahtar>.txt okunur;
   * dosya bildirilen host'ta ve icerigi anahtarsa gonderilir (keyLocation ile).
   */
  private async pingIndexNow(url: string): Promise<{ ok: boolean; skipped?: string }> {
    const key = (process.env.INDEXNOW_KEY ?? '').trim();
    if (!key) return { ok: false, skipped: 'IndexNow anahtarı tanımlı değil.' };
    if (!INDEXNOW_KEY_FORMAT.test(key)) return { ok: false, skipped: 'IndexNow anahtarı biçimi geçersiz.' };
    let target: URL;
    try { target = new URL(url); } catch { return { ok: false, skipped: 'Adres geçersiz.' }; }
    const keyLocation = `${target.origin}/${key}.txt`;
    if (!(await this.keyFileHosted(keyLocation, key))) {
      return {
        ok: false,
        skipped: `IndexNow anahtar dosyası ${target.host} üzerinde bulunamadı (${keyLocation}); IndexNow, dosya bildirilen alan adında olmadan gönderimi kabul etmez.`,
      };
    }
    try {
      const res = await fetch('https://api.indexnow.org/IndexNow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: target.host, key, keyLocation, urlList: [url] }),
        signal: AbortSignal.timeout(10000),
      });
      // 200 gonderildi, 202 alindi (anahtar dogrulamasi bekliyor) — dosya zaten dogrulandi
      return res.ok ? { ok: true } : { ok: false, skipped: `IndexNow gönderimi kabul edilmedi (HTTP ${res.status}).` };
    } catch {
      return { ok: false, skipped: 'IndexNow servisine ulaşılamadı.' };
    }
  }

  /**
   * Anahtar dosyasi dogrudan (yonlendirmesiz) 200 ve icerigi tam anahtar mi?
   * Yonlendirme baska host'a (or. www'ye) gidebilir; IndexNow her host'u ayri
   * sayar ("Each subdomain is treated as a separate host" — indexnow.org/faq).
   * Adres musterinin sitesi: ic aga baglanmamak icin safe-fetch.
   */
  private async keyFileHosted(keyLocation: string, key: string): Promise<boolean> {
    try {
      const res = await this.fetchText(keyLocation, {
        timeoutMs: 5_000,
        maxBytes: 1024,
        errorBodyBytes: 0,
        maxRedirects: 0,
        accept: 'text/plain,*/*;q=0.1',
      });
      return res.ok && res.text.trim() === key;
    } catch {
      return false;
    }
  }

  /**
   * GSC sitemap submit — site Google Search Console'a bagliysa Search Console API
   * uzerinden <origin>/sitemap.xml'i sitenin KENDI mulkune gonderir.
   * Best-effort: bagli degilse / yazma scope'u yoksa nedeniyle false doner.
   */
  private async submitGscSitemap(siteId: string, url: string): Promise<{ ok: boolean; skipped?: string }> {
    let sitemapUrl: string;
    try { sitemapUrl = `${new URL(url).origin}/sitemap.xml`; } catch { return { ok: false, skipped: 'Adres geçersiz.' }; }
    const res = await this.gscOAuth.submitSitemap(siteId, sitemapUrl);
    if (res.ok) return { ok: true };
    if (res.error) this.log.warn(`[${siteId}] GSC sitemap submit: ${res.error}`);
    if (res.skipped === 'not_connected') return { ok: false, skipped: 'Search Console bağlı değil.' };
    if (res.skipped === 'no_property') return { ok: false, skipped: 'Search Console mülkü seçilmemiş.' };
    if (res.error?.startsWith('insufficient_scope')) {
      return { ok: false, skipped: 'Search Console yazma izni yok — bağlantıyı yenileyin.' };
    }
    return { ok: false, skipped: 'Search Console site haritasını kabul etmedi.' };
  }
}
