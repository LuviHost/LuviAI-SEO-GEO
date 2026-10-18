import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { safeFetchText, type SafeTextOptions, type SafeTextResult } from '../common/safe-fetch.js';
import { detectBlock } from '../common/block-detect.js';
import { extractImages, type ExtractedImage, type ImageAltStats } from './image-extract.js';
import { isJsShell } from './js-shell.js';
import { isAllowedForRanksUpBot, parseRanksUpBotGroup, ROBOTS_PARSE_LIMIT, type RanksUpRobotsPolicy } from './ranksup-robots.js';
import {
  accessFromBlock, accessFromFetchError, accessFromHttpStatus, accessFromRobots, type CrawlAccessIssue,
} from './crawl-access.js';

export interface CrawledPage {
  url: string;
  title: string;
  metaDescription: string;
  h1: string;
  h2s: string[];
  textSample: string; // body içerik özeti (ilk 1500 karakter)

  // Head'den extract edilen alanlar — DOM parse ile DOĞRU şekilde alınır
  ogTags: Record<string, string>;        // og:title, og:image, og:description, og:url, og:type, og:site_name
  twitterTags: Record<string, string>;   // twitter:card, twitter:title, twitter:description, twitter:image
  canonical: string | null;              // <link rel="canonical" href="...">
  hreflangs: { lang: string; href: string }[];  // <link rel="alternate" hreflang="...">
  jsonLdBlocks: any[];                   // application/ld+json içerikleri (parse edilmiş)
  schemaTypes: string[];                 // ['Organization', 'Product', 'FAQPage'] vb. flatten edilmiş

  /** <html lang> — alt metni onerisi sayfanin dilinde uretilir */
  lang: string | null;
  /** Sunucu HTML'i bos JS iskeleti (SPA) — icerik yalniz JS sonrasi (js-shell.ts) */
  jsShell?: boolean;

  // Resimler ve internal linkler
  imageAltStats: ImageAltStats;
  /** Gorsel bazli kayit (sayfa basi en fazla 50; bkz. image-extract.ts) */
  images: ExtractedImage[];
  imagesCapped: boolean;
  outboundLinks: string[];
  inboundLinks?: string[];
  /**
   * Sayfadaki <a href="tel:..."> degerleri (ham, tekrarsiz, en fazla 10).
   * Yerel olcumun site NAP'i icin (audit/site-nap.ts): denetim taramasi
   * telefonu bulursa olcum aninda anasayfaya ayrica gidilmez. Dizi VARSA
   * sayfa tarandi demektir (bos = tel: baglantisi yok).
   */
  telLinks?: string[];
}

/**
 * Kok dosyanin (robots.txt, sitemap, llms.txt) erisim durumu.
 * blocked/error/disallowed "YOK" DEGILDIR — dosya var olabilir, biz okuyamadik.
 */
export interface CrawlResourceStatus {
  state: 'ok' | 'missing' | 'blocked' | 'error' | 'disallowed';
  url: string | null;
  status: number | null;
  /** ok/missing disinda kullaniciya gosterilecek aciklama (Turkce) */
  reason?: string;
  access?: CrawlAccessIssue;
}

export interface CrawlResult {
  baseUrl: string;
  pages: CrawledPage[];
  sitemapUrl: string | null;
  robotsTxt: string | null;
  llmsTxt: string | null;
  totalPages: number;
  /**
   * Anasayfa okunamadiysa nedeni (engel, ulasilamama, sunucu hatasi). Doluysa
   * denetim PUAN VERMEZ — bkz. audit.service runAudit.
   */
  homeAccess?: CrawlAccessIssue | null;
  /** Site bizi reddettigi icin okunamayan sayfalar — "eksik" sayilmaz, puana girmez */
  blockedPages?: CrawlAccessIssue[];
  /** robots.txt'teki RanksUpBot grubu yasakladigi icin hic istenmeyen adresler */
  robotsDisallowed?: string[];
  /** robots.txt'te acik "User-agent: RanksUpBot" grubu var mi */
  ranksUpBotGroup?: boolean;
  /** Bot korumasi devreye girdigi icin tarama erken durdurulduysa nedeni */
  stoppedEarly?: string | null;
  resources?: { robots: CrawlResourceStatus; sitemap: CrawlResourceStatus; llms: CrawlResourceStatus };
}

export type TextFetcher = (url: string, opts?: SafeTextOptions) => Promise<SafeTextResult>;

/** Yalnizca test: yerel sunucuya baglanan politika enjekte edilir. Uretimde kayitli degil → safeFetchText. */
export const CRAWLER_TEXT_FETCHER = Symbol('CRAWLER_TEXT_FETCHER');

type Fetched =
  | { kind: 'ok'; url: string; finalUrl: string; status: number; text: string; contentType: string }
  | { kind: 'blocked'; url: string; status: number; access: CrawlAccessIssue }
  | { kind: 'http'; url: string; status: number }
  | { kind: 'binary'; url: string; status: number; contentType: string }
  | { kind: 'failed'; url: string; error: unknown };

/** Bu engellerden sonra devam etmek hem anlamsiz hem kaba: site bizi bot diye durduruyor */
const STOP_KINDS = new Set(['waf', 'challenge', 'rate_limited']);

const CACHE_BUST_PARAM = '_rc';

/** "www." farki ayni site sayilir: ornek.com ↔ www.ornek.com */
function siteKey(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
}

function isSameSite(u: URL, site: URL): boolean {
  return (u.protocol === 'http:' || u.protocol === 'https:') && siteKey(u.hostname) === siteKey(site.hostname);
}

/** Onbellek kirma parametresini sil — kayitli adreslerde gorunmesin */
function stripCacheBust(raw: string): string {
  try {
    const u = new URL(raw);
    if (!u.searchParams.has(CACHE_BUST_PARAM)) return raw;
    u.searchParams.delete(CACHE_BUST_PARAM);
    return u.toString();
  } catch {
    return raw;
  }
}

/** Sunucu dosya yerine HTML sayfasi dondurmus mu (SPA "her yol index.html" / yumusak 404)? */
function looksLikeHtmlDocument(text: string): boolean {
  return /^\s*(?:<!doctype html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(text.slice(0, 1024));
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s][^<\]]*?)\s*(?:\]\]>)?\s*<\/loc>/g)]
    .map((m) => m[1].trim().replace(/&amp;/g, '&'));
}

@Injectable()
export class SiteCrawlerService {
  private readonly log = new Logger(SiteCrawlerService.name);
  private readonly fetchText: TextFetcher;

  constructor(@Optional() @Inject(CRAWLER_TEXT_FETCHER) fetcher?: TextFetcher) {
    // SSRF korumali: yalnizca http/https + 80/443, ic adresler hem yazili hem
    // DNS cozumu aninda reddedilir, her yonlendirme adimi yeniden denetlenir.
    this.fetchText = fetcher ?? safeFetchText;
  }

  /**
   * Tek bir sayfadan okunacak en fazla bayt (varsayilan 2 MB).
   *
   * Cikardigimiz her sinyal <head> icinde — 2 MB o isin kat kat ustunde.
   * Uretimde olculdu: siniri olmayan surumde tek bir sayfa 14.1 MB HTML
   * donduruyordu ve worker'i bellek sinirinda oldurmeye yetiyordu.
   * Ortam degiskeniyle ayarlanabilir.
   */
  private static readonly MAX_PAGE_BYTES =
    Number(process.env.CRAWL_MAX_PAGE_BYTES) > 0
      ? Number(process.env.CRAWL_MAX_PAGE_BYTES)
      : 2 * 1024 * 1024;

  /**
   * Sitemap tavani daha genis — sitemap 50.000 URL icerebilir ve bunlar
   * duz metin, ayristirmasi ucuz. Yine de sinirsiz degil.
   */
  private static readonly MAX_SITEMAP_BYTES = 8 * 1024 * 1024;

  /**
   * Bir siteyi sınırlı derinlikte crawl eder.
   *
   * Sira: robots.txt (RanksUpBot grubu) → anasayfa → sitemap / link kesfi →
   * sayfalar → llms.txt. Anasayfa engelliyse ya da ulasilamiyorsa tarama orada
   * durur: arkasinda 100 sayfa denemek hem bos is hem de bizi engelleyen siteye
   * kabaliktir.
   *
   * @param opts.stopIfHomeUnreadable anasayfa HTTP hatasi (404/500) verdiginde de
   *   dur. Denetim bunu ister (zaten puan vermeyecek); marka beyni gibi
   *   cagiranlar sitemap'teki diger sayfalarla devam edebilir.
   */
  async crawl(baseUrl: string, maxPages = 30, opts: { stopIfHomeUnreadable?: boolean } = {}): Promise<CrawlResult> {
    const start = new URL(baseUrl);
    const startOrigin = start.origin;
    const blockedPages: CrawlAccessIssue[] = [];
    const robotsDisallowed: string[] = [];

    // 0) robots.txt ONCE: RanksUpBot grubu sonraki her istegi belirler.
    // /robots.txt'in kendisi her zaman serbest (RFC 9309 2.2.2).
    const robotsUrl = `${startOrigin}/robots.txt`;
    const robotsRes = await this.fetchResource(robotsUrl, { maxBytes: ROBOTS_PARSE_LIMIT, bust: true, skipBinary: false });
    const robotsTxt = robotsRes.kind === 'ok' && !looksLikeHtmlDocument(robotsRes.text) ? robotsRes.text : null;
    const policy = robotsTxt ? parseRanksUpBotGroup(robotsTxt) : null;
    const robotsStatus = this.resourceStatus(robotsUrl, robotsRes, robotsTxt !== null);
    const allowed = (u: string) => isAllowedForRanksUpBot(policy, u);

    // 1) Anasayfa — siteye erisebiliyor muyuz?
    let siteOrigin = new URL(startOrigin);
    const startHome = `${startOrigin}/`;
    let homeAccess: CrawlAccessIssue | null = null;
    let homeHtml: string | null = null;
    let homeFinal = startHome;
    if (!allowed(startHome)) {
      homeAccess = accessFromRobots(startHome);
    } else {
      const home = await this.fetchResource(startHome, { bust: true, policy });
      if (home.kind === 'ok') {
        homeFinal = stripCacheBust(home.finalUrl);
        const final = new URL(homeFinal);
        // ornek.com → www.ornek.com yonlendirmesi: sitenin gercek adresi
        // budur. Linkler ve sayfa adresleri bu kokte birlestirilir; aksi halde
        // www'li ic linkler "dis link" sayilip her sayfa orphan gorunuyordu.
        if (isSameSite(final, siteOrigin)) siteOrigin = new URL(final.origin);
        if (isSameSite(final, siteOrigin) && !allowed(homeFinal)) homeAccess = accessFromRobots(homeFinal);
        else homeHtml = home.text;
      } else {
        homeAccess = this.homeAccessFrom(home);
      }
    }

    const emptyResource = (reason: string): CrawlResourceStatus => ({ state: 'error', url: null, status: null, reason });

    if (homeAccess) {
      if (homeAccess.state === 'blocked') blockedPages.push(homeAccess);
      const hardStop = homeAccess.state === 'blocked' || homeAccess.kind !== 'http_error' || opts.stopIfHomeUnreadable === true;
      if (hardStop) {
        this.log.warn(`${startOrigin}: anasayfa okunamadi (${homeAccess.kind}${homeAccess.status ? ` HTTP ${homeAccess.status}` : ''}) — tarama durduruldu`);
        return {
          baseUrl: siteOrigin.origin,
          pages: [],
          sitemapUrl: null,
          robotsTxt,
          llmsTxt: null,
          totalPages: 0,
          homeAccess,
          blockedPages,
          robotsDisallowed,
          ranksUpBotGroup: !!policy,
          stoppedEarly: homeAccess.reason,
          resources: {
            robots: robotsStatus,
            sitemap: emptyResource('Anasayfa okunamadığı için kontrol edilmedi.'),
            llms: emptyResource('Anasayfa okunamadığı için kontrol edilmedi.'),
          },
        };
      }
    }

    const origin = siteOrigin.origin;
    const homeUrl = this.normalizeUrl(origin, origin, siteOrigin)!;

    // 2) Sitemap (resmi best practice) — robots.txt'te bildirilen once
    const sitemap = await this.discoverSitemap(siteOrigin, robotsTxt, policy, allowed);
    // Set ile tekillestirme: sitemap 50.000 URL tasiyabilir, includes O(n²) olurdu
    const seen = new Set<string>();
    const urls: string[] = [];
    const add = (u: string | null) => {
      if (!u || seen.has(u) || this.isExcludedPath(u)) return;
      seen.add(u);
      urls.push(u);
    };
    for (const raw of sitemap.pageUrls) add(this.normalizeUrl(raw, origin, siteOrigin));

    // 3) Sitemap yetersizse anasayfa link discovery ile tamamla (anasayfa zaten elde)
    if (urls.length < maxPages && homeHtml) {
      const $ = cheerio.load(homeHtml);
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) add(this.normalizeUrl(href, homeFinal, siteOrigin));
      });
    }

    // 4) Anasayfa her zaman ilk sirada, tekillestir
    const targetUrls = Array.from(new Set([homeUrl, ...urls])).slice(0, maxPages);

    // 5) Paralel fetch (5'erli batch — rate limit + memory dengeli)
    const pages: CrawledPage[] = [];
    let stoppedEarly: string | null = null;
    const BATCH = 5;
    for (let i = 0; i < targetUrls.length && !stoppedEarly; i += BATCH) {
      const batch = targetUrls.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async (pageUrl) => {
        try {
          if (pageUrl === homeUrl) {
            // Anasayfa ikinci kez cekilmez — 1. adimda okundu (ya da HTTP hatasi verdi)
            return homeHtml !== null ? { page: this.extractPageData(homeUrl, homeHtml, homeFinal, siteOrigin) } : {};
          }
          if (!allowed(pageUrl)) {
            robotsDisallowed.push(pageUrl);
            return {};
          }
          const r = await this.fetchResource(pageUrl, { bust: true, policy });
          if (r.kind === 'blocked') return { blocked: r.access };
          if (r.kind !== 'ok') return {};
          const finalUrl = stripCacheBust(r.finalUrl);
          // Yonlendirme sonrasi varilan adres RanksUpBot'a yasaksa icerik KULLANILMAZ
          const final = new URL(finalUrl);
          if (isSameSite(final, siteOrigin) && !allowed(finalUrl)) {
            robotsDisallowed.push(pageUrl);
            return {};
          }
          return { page: this.extractPageData(pageUrl, r.text, finalUrl, siteOrigin) };
        } catch {
          return {};
        }
      }));
      for (const r of results as Array<{ page?: CrawledPage; blocked?: CrawlAccessIssue }>) {
        if (r.page) pages.push(r.page);
        if (r.blocked) {
          blockedPages.push(r.blocked);
          if (STOP_KINDS.has(r.blocked.kind) && !stoppedEarly) stoppedEarly = r.blocked.reason;
        }
      }
    }
    if (stoppedEarly) this.log.warn(`${origin}: bot korumasi devrede, tarama erken durduruldu — ${stoppedEarly}`);

    // 6) llms.txt
    const llmsUrl = `${origin}/llms.txt`;
    let llmsTxt: string | null = null;
    let llmsStatus: CrawlResourceStatus;
    if (!allowed(llmsUrl)) {
      llmsStatus = { state: 'disallowed', url: llmsUrl, status: null, reason: accessFromRobots(llmsUrl).reason };
    } else if (stoppedEarly) {
      // Site bizi az once bot diye durdurdu — bir istek daha atmiyoruz
      llmsStatus = { state: 'error', url: llmsUrl, status: null, reason: 'Bot koruması devreye girdiği için kontrol edilmedi.' };
    } else {
      const llmsRes = await this.fetchResource(llmsUrl, { bust: true, skipBinary: false, policy });
      llmsTxt = llmsRes.kind === 'ok' && !looksLikeHtmlDocument(llmsRes.text) ? llmsRes.text : null;
      llmsStatus = this.resourceStatus(llmsUrl, llmsRes, llmsTxt !== null);
    }

    return {
      baseUrl: origin,
      pages,
      sitemapUrl: sitemap.url,
      robotsTxt,
      llmsTxt,
      totalPages: urls.length,
      homeAccess,
      blockedPages,
      robotsDisallowed,
      ranksUpBotGroup: !!policy,
      stoppedEarly,
      resources: { robots: robotsStatus, sitemap: sitemap.status, llms: llmsStatus },
    };
  }

  /**
   * URL normalize: fragment + tracking query'leri temizle, trailing slash standardize et.
   * Aynı sayfaya farklı URL'lerle gelen istekleri tek hale getirir. Goreli
   * adres sayfanin KENDI adresine gore cozulur; ayni sitenin www'li/www'suz
   * hali tek koke (site) cekilir. Baska siteye ait adres → null.
   */
  private normalizeUrl(href: string, base: string, site: URL): string | null {
    try {
      const u = new URL(href, base);
      if (!isSameSite(u, site)) return null;
      u.protocol = site.protocol;
      u.host = site.host;
      // Fragment temizle
      u.hash = '';
      // Tracking ve auth callback query parametrelerini temizle
      const TRACKING_PARAMS = ['callbackUrl', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'referrer', CACHE_BUST_PARAM];
      for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
      // Trailing slash normalize: anasayfa hariç sondaki / silinsin
      let pathname = u.pathname;
      if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
      u.pathname = pathname;
      return u.toString();
    } catch {
      return null;
    }
  }

  /**
   * Auth-protected veya SEO için faydasız path'leri crawl dışı bırak.
   */
  private isExcludedPath(url: string): boolean {
    let path: string;
    try {
      const u = new URL(url);
      path = u.pathname + u.search;
    } catch {
      return true;
    }
    return /^\/(api|admin|admin-unlock|onboarding|sites|dashboard|billing|affiliate|api-keys|agency|signin|signup|auth)(\/|$|\?)/.test(path);
  }

  /**
   * Cache-bust: WP.com / Cloudflare gibi edge cache'ler eski içerik veriyordu →
   * audit eski title/FAQ/schema görüp YANLIŞ sonuç üretiyordu. Benzersiz query +
   * no-cache header ile her zaman taze (origin) içerik çekiyoruz.
   * RanksUpBot grubu sorgulu adresleri yasakliyorsa (orn. "Disallow: /*?")
   * parametre eklenmez — yasakli bir adres istemis olmayalim.
   */
  private cacheBust(url: string, policy: RanksUpRobotsPolicy | null | undefined): string {
    const bust = `${url}${url.includes('?') ? '&' : '?'}${CACHE_BUST_PARAM}=${Date.now()}`;
    return policy && !isAllowedForRanksUpBot(policy, bust) ? url : bust;
  }

  /**
   * Tek istek + siniflandirma. Hata ATMAZ.
   * Engel kontrolu durum kodundan ONCE: bot dogrulama ekrani 200 ile de gelir
   * ve icerik sanilirsa "Just a moment..." basligi puanlanir.
   */
  private async fetchResource(
    url: string,
    opts: { maxBytes?: number; bust?: boolean; skipBinary?: boolean; policy?: RanksUpRobotsPolicy | null } = {},
  ): Promise<Fetched> {
    const maxBytes = opts.maxBytes ?? SiteCrawlerService.MAX_PAGE_BYTES;
    const target = opts.bust ? this.cacheBust(url, opts.policy) : url;
    let res: SafeTextResult;
    try {
      res = await this.fetchText(target, {
        maxBytes,
        timeoutMs: 15_000,
        // Bazi sunucular kati Accept'te 406 donuyor — */* bilerek var. Metin
        // disi govde (PDF/zip/video) skipBinary ile hic indirilmez.
        accept: 'text/html,application/xhtml+xml,application/xml,*/*',
        headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
        skipBinary: opts.skipBinary !== false,
      });
    } catch (error) {
      return { kind: 'failed', url, error };
    }

    const signal = detectBlock(res);
    if (signal) return { kind: 'blocked', url, status: res.status, access: accessFromBlock(url, signal) };
    if (!res.ok) return { kind: 'http', url, status: res.status };
    if (res.binary) return { kind: 'binary', url, status: res.status, contentType: res.contentType };
    if (res.truncated) {
      this.log.warn(
        `${url} ${(maxBytes / 1048576).toFixed(1)}MB tavanda kirpildi — head sinyalleri okundu, sayfa sonundaki linkler eksik olabilir`,
      );
    }
    return { kind: 'ok', url, finalUrl: res.url, status: res.status, text: res.text, contentType: res.contentType };
  }

  /** Anasayfa okunamadi → kullaniciya gosterilecek neden */
  private homeAccessFrom(r: Exclude<Fetched, { kind: 'ok' }>): CrawlAccessIssue {
    switch (r.kind) {
      case 'blocked':
        return r.access;
      case 'failed':
        return accessFromFetchError(r.url, r.error);
      case 'http':
        return accessFromHttpStatus(r.url, r.status);
      case 'binary':
        return {
          ...accessFromHttpStatus(r.url, r.status),
          reason: `Anasayfa HTML yerine ${r.contentType || 'bilinmeyen türde'} içerik döndürdü.`,
        };
    }
  }

  /** robots.txt / llms.txt erisim sonucu */
  private resourceStatus(url: string, r: Fetched, accepted: boolean): CrawlResourceStatus {
    switch (r.kind) {
      case 'ok':
        return accepted
          ? { state: 'ok', url, status: r.status }
          : { state: 'missing', url, status: r.status, reason: 'Sunucu dosya yerine bir HTML sayfası döndürdü.' };
      case 'blocked':
        return { state: 'blocked', url, status: r.status, reason: r.access.reason, access: r.access };
      case 'http':
        // 404/410 gibi 4xx: dosya yok. 5xx ve hedefsiz 3xx: dosya var mi bilinmiyor.
        return r.status >= 400 && r.status < 500
          ? { state: 'missing', url, status: r.status }
          : { state: 'error', url, status: r.status, reason: `Sunucu HTTP ${r.status} döndürdü.` };
      case 'binary':
        return { state: 'missing', url, status: r.status, reason: 'Sunucu metin dosyası yerine ikili içerik döndürdü.' };
      case 'failed':
        return { state: 'error', url, status: null, reason: accessFromFetchError(url, r.error).reason };
    }
  }

  /**
   * Sitemap kesfi. robots.txt'te bildirilen sitemap once denenir (yetkili
   * kaynak), sonra bilinen yollar. Bildirilen sitemap 2xx ise var sayilir
   * (.xml.gz ya da .txt sitemap'i ayristiramasak da dosya mevcut); bilinen
   * yollarda yalnizca gercek XML sitemap kabul edilir (SPA'lar her yola 200 doner).
   */
  private async discoverSitemap(
    site: URL,
    robotsTxt: string | null,
    policy: RanksUpRobotsPolicy | null,
    allowed: (u: string) => boolean,
  ): Promise<{ url: string | null; status: CrawlResourceStatus; pageUrls: string[] }> {
    const declared = robotsTxt
      ? [...robotsTxt.matchAll(/^[ \t]*sitemap[ \t]*:[ \t]*(\S+)/gim)].map((m) => m[1]).slice(0, 3)
      : [];
    const candidates: Array<{ url: string; declared: boolean }> = [];
    const seen = new Set<string>();
    for (const [raw, isDeclared] of [
      ...declared.map((d) => [d, true] as const),
      ...['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'].map((p) => [p, false] as const),
    ]) {
      try {
        const u = new URL(raw, site.origin);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
        if (seen.has(u.href)) continue;
        seen.add(u.href);
        candidates.push({ url: u.href, declared: isDeclared });
      } catch { /* gecersiz Sitemap: satiri */ }
    }

    let blocked: CrawlResourceStatus | null = null;
    let error: CrawlResourceStatus | null = null;
    let disallowed: CrawlResourceStatus | null = null;
    for (const c of candidates) {
      const sameSite = isSameSite(new URL(c.url), site);
      if (sameSite && !allowed(c.url)) {
        disallowed ??= { state: 'disallowed', url: c.url, status: null, reason: accessFromRobots(c.url).reason };
        continue;
      }
      const r = await this.fetchResource(c.url, { maxBytes: SiteCrawlerService.MAX_SITEMAP_BYTES, bust: true, policy });
      if (r.kind === 'ok') {
        const isXml = r.text.includes('<urlset') || r.text.includes('<sitemapindex');
        if (isXml) {
          return { url: c.url, status: { state: 'ok', url: c.url, status: r.status }, pageUrls: await this.parseSitemap(r.text, site, policy, allowed) };
        }
        if (c.declared) return { url: c.url, status: { state: 'ok', url: c.url, status: r.status }, pageUrls: [] };
        continue;
      }
      if (r.kind === 'binary' && c.declared) {
        return { url: c.url, status: { state: 'ok', url: c.url, status: r.status }, pageUrls: [] };
      }
      if (r.kind === 'blocked') blocked ??= { state: 'blocked', url: c.url, status: r.status, reason: r.access.reason, access: r.access };
      else if (r.kind === 'failed') error ??= { state: 'error', url: c.url, status: null, reason: accessFromFetchError(c.url, r.error).reason };
      else if (r.kind === 'http' && (r.status >= 500 || r.status < 400)) error ??= { state: 'error', url: c.url, status: r.status, reason: `Sunucu HTTP ${r.status} döndürdü.` };
    }
    const status = blocked ?? error ?? disallowed ?? { state: 'missing' as const, url: null, status: null };
    return { url: null, status, pageUrls: [] };
  }

  /**
   * Sitemap parse — basit <urlset> + nested <sitemapindex> desteği.
   * Index ise alt sitemap'leri de takip eder (en fazla 5). Yalnizca bu siteye
   * ait sayfa adresleri doner: baska bir alan adinin sayfalarini bu sitenin
   * sayfasi diye puanlamak yanlis olur.
   */
  private async parseSitemap(xml: string, site: URL, policy: RanksUpRobotsPolicy | null, allowed: (u: string) => boolean): Promise<string[]> {
    const own = (list: string[]) => list.filter((u) => {
      try { return isSameSite(new URL(u), site); } catch { return false; }
    });
    if (!xml.includes('<sitemapindex')) return own(extractLocs(xml));

    const all: string[] = [];
    for (const child of extractLocs(xml).slice(0, 5)) { // max 5 sub-sitemap
      let childUrl: URL;
      try { childUrl = new URL(child); } catch { continue; }
      if (isSameSite(childUrl, site) && !allowed(childUrl.href)) continue;
      const r = await this.fetchResource(childUrl.href, { maxBytes: SiteCrawlerService.MAX_SITEMAP_BYTES, bust: true, policy });
      if (r.kind === 'ok') all.push(...extractLocs(r.text));
    }
    return own(all);
  }

  /**
   * Sayfayı parse et: title, meta, head OG/Twitter/canonical/hreflang/JSON-LD,
   * body text sample, image alt stats, internal links.
   * @param baseHref sayfanin yonlendirmeler sonrasi GERCEK adresi — goreli
   *   linkler ve gorseller buna gore cozulur.
   */
  private extractPageData(url: string, html: string, baseHref: string, site: URL): CrawledPage {
    const $ = cheerio.load(html);

    // ── Head: OG meta tags ─────────────────────────────────
    const ogTags: Record<string, string> = {};
    $('meta[property^="og:"]').each((_, el) => {
      const property = $(el).attr('property');
      const content = $(el).attr('content');
      if (property && content) ogTags[property] = content;
    });

    // ── Head: Twitter card meta tags ───────────────────────
    const twitterTags: Record<string, string> = {};
    $('meta[name^="twitter:"]').each((_, el) => {
      const name = $(el).attr('name');
      const content = $(el).attr('content');
      if (name && content) twitterTags[name] = content;
    });

    // ── Head: Canonical URL ────────────────────────────────
    const canonical = $('link[rel="canonical"]').attr('href') ?? null;

    // ── Head: Hreflang ─────────────────────────────────────
    const hreflangs: { lang: string; href: string }[] = [];
    $('link[rel="alternate"][hreflang]').each((_, el) => {
      const lang = $(el).attr('hreflang');
      const href = $(el).attr('href');
      if (lang && href) hreflangs.push({ lang, href });
    });

    // ── Head: JSON-LD blocks (schema.org) ──────────────────
    const jsonLdBlocks: any[] = [];
    const schemaTypes: string[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).html();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        jsonLdBlocks.push(parsed);
        // @graph veya tek nesne — flatten et
        const collect = (obj: any) => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) { obj.forEach(collect); return; }
          if (obj['@type']) {
            const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
            for (const t of types) if (typeof t === 'string' && !schemaTypes.includes(t)) schemaTypes.push(t);
          }
          if (obj['@graph']) collect(obj['@graph']);
        };
        collect(parsed);
      } catch {
        // Geçersiz JSON-LD — sessizce geç
      }
    });

    // ── Gorseller: sayim + gorsel bazli kayit (image-extract.ts) ──
    const { images, stats: imageAltStats, capped: imagesCapped } = extractImages($, baseHref);

    // ── H1, H2'ler ────────────────────────────────────────
    const h2s: string[] = [];
    $('h2').each((_, el) => {
      const text = $(el).text().trim();
      if (text) h2s.push(text);
    });

    // ── Internal links ────────────────────────────────────
    // Ayni sitenin www'li/www'suz hali tek koke cekilir (orphan analizi
    // sayfa adresleriyle eslesebilsin).
    const outboundLinks: string[] = [];
    const telLinks: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      // tel: ic link degil — site NAP'i icin ayri toplanir (site-nap.ts)
      const h = href.trim();
      if (/^tel:/i.test(h)) {
        if (telLinks.length < 10 && !telLinks.includes(h)) telLinks.push(h);
        return;
      }
      try {
        const u = new URL(href, baseHref);
        if (!isSameSite(u, site)) return;
        u.protocol = site.protocol;
        u.host = site.host;
        u.hash = '';
        const abs = u.href;
        if (!outboundLinks.includes(abs)) outboundLinks.push(abs);
      } catch { /* gecersiz href */ }
    });

    // ── Body text sample (script/style/nav/footer hariç) ──
    const $body = $('body').clone();
    $body.find('script, style, nav, footer, aside, noscript').remove();
    const textSample = $body.text().replace(/\s+/g, ' ').trim().slice(0, 1500);

    return {
      url,
      // SADECE head'deki <title> — $('title').text() SVG ikon <title>'larını da
      // birleştirip uzunluğu yanlış şişiriyordu (yanlış "title 60+ karakter").
      title: ($('head title').first().text() || $('title').first().text()).trim() || $('h1').first().text().trim(),
      metaDescription: $('meta[name="description"]').attr('content') ?? '',
      h1: $('h1').first().text().trim(),
      h2s: h2s.slice(0, 10),
      textSample,
      ogTags,
      twitterTags,
      canonical,
      hreflangs,
      jsonLdBlocks,
      schemaTypes,
      lang: ($('html').attr('lang') ?? '').trim() || null,
      jsShell: isJsShell($),
      imageAltStats,
      images,
      imagesCapped,
      outboundLinks: outboundLinks.slice(0, 30),
      telLinks,
    };
  }
}
