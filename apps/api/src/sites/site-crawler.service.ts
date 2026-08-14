import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';

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

  // Resimler ve internal linkler
  imageAltStats: { total: number; withAlt: number; emptyAlt: number };
  outboundLinks: string[];
  inboundLinks?: string[];
}

export interface CrawlResult {
  baseUrl: string;
  pages: CrawledPage[];
  sitemapUrl: string | null;
  robotsTxt: string | null;
  llmsTxt: string | null;
  totalPages: number;
}

@Injectable()
export class SiteCrawlerService {
  private readonly log = new Logger(SiteCrawlerService.name);

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
   * Sitemap.xml öncelikli, yoksa link discovery. Her sayfa için head'deki
   * meta tag'leri, JSON-LD blokları ve canonical URL'i Cheerio ile parse eder.
   */
  async crawl(baseUrl: string, maxPages = 30): Promise<CrawlResult> {
    const url = new URL(baseUrl);
    const origin = url.origin;

    // 1) Sitemap fetch dene (resmi best practice)
    const sitemapUrl = await this.findSitemap(origin);
    let urls: string[] = [];
    if (sitemapUrl) {
      urls = await this.parseSitemap(sitemapUrl);
    }

    // 2) Sitemap yetersizse anasayfa link discovery ile tamamla
    if (urls.length < maxPages) {
      const homepage = await this.fetchPage(origin);
      if (homepage) {
        const $ = cheerio.load(homepage);
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          try {
            const cleaned = this.normalizeUrl(href, origin);
            if (cleaned && cleaned.startsWith(origin) && !urls.includes(cleaned) && !this.isExcludedPath(cleaned, origin)) {
              urls.push(cleaned);
            }
          } catch {}
        });
      }
    }

    // 3) Origin'i her zaman ekle, normalize et, exclude'ları filtrele, deduplicate et
    const allUrls = [origin, ...urls]
      .map(u => this.normalizeUrl(u, origin))
      .filter((u): u is string => !!u)
      .filter(u => !this.isExcludedPath(u, origin));
    const targetUrls = Array.from(new Set(allUrls)).slice(0, maxPages);

    // 4) Paralel fetch (5'erli batch — rate limit + memory dengeli)
    const pages: CrawledPage[] = [];
    const BATCH = 5;
    for (let i = 0; i < targetUrls.length; i += BATCH) {
      const batch = targetUrls.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async (pageUrl) => {
        try {
          const html = await this.fetchPage(pageUrl);
          if (!html) return null;
          return this.extractPageData(pageUrl, html, origin);
        } catch {
          return null;
        }
      }));
      for (const r of results) if (r) pages.push(r);
    }

    // 5) robots.txt + llms.txt
    const [robotsTxt, llmsTxt] = await Promise.all([
      this.fetchPage(`${origin}/robots.txt`),
      this.fetchPage(`${origin}/llms.txt`),
    ]);

    return {
      baseUrl: origin,
      pages,
      sitemapUrl,
      robotsTxt,
      llmsTxt,
      totalPages: urls.length,
    };
  }

  /**
   * URL normalize: fragment + tracking query'leri temizle, trailing slash standardize et.
   * Aynı sayfaya farklı URL'lerle gelen istekleri tek hale getirir.
   */
  private normalizeUrl(href: string, origin: string): string | null {
    try {
      const u = new URL(href, origin);
      // Fragment temizle
      u.hash = '';
      // Tracking ve auth callback query parametrelerini temizle
      const TRACKING_PARAMS = ['callbackUrl', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'referrer'];
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
  private isExcludedPath(url: string, origin: string): boolean {
    const path = url.replace(origin, '');
    return /^\/(api|admin|admin-unlock|onboarding|sites|dashboard|billing|affiliate|api-keys|agency|signin|signup|auth)(\/|$|\?)/.test(path);
  }

  private async fetchPage(url: string, maxBytes = SiteCrawlerService.MAX_PAGE_BYTES): Promise<string | null> {
    try {
      // Cache-bust: WP.com / Cloudflare gibi edge cache'ler eski içerik veriyordu →
      // audit eski title/FAQ/schema görüp YANLIŞ sonuç üretiyordu. Benzersiz query +
      // no-cache header ile her zaman taze (origin) içerik çekiyoruz.
      const bust = url + (url.includes('?') ? '&' : '?') + '_rc=' + Date.now();
      const res = await fetch(bust, {
        headers: {
          'User-Agent': 'RanksUp-Crawler/1.0 (+https://ranksup.ai)',
          'Accept': 'text/html,application/xhtml+xml,application/xml,*/*',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return null;
      }

      // Metin olmayan govdeyi hic indirme. Accept basligi */* iceriyor (bazi
      // sunucular katı Accept'te 406 donuyor), yani PDF/zip/video gelebiliyordu
      // ve res.text() onu bastan sona bellege aliyordu. Ayristirilacak bir sey
      // olmadigi icin bu tamamen bosa harcanan bellek.
      const ct = res.headers.get('content-type') ?? '';
      if (ct && !/(text\/|xml|json|javascript|xhtml)/i.test(ct)) {
        await res.body?.cancel().catch(() => {});
        return null;
      }

      return await this.readCapped(res, url, maxBytes);
    } catch {
      return null;
    }
  }

  /**
   * Govdeyi tavana kadar okur, tavanda baglantiyi keser.
   *
   * NEDEN VAR: res.text() ne gelirse tamamini bellege aliyordu. Canlida olculdu —
   * tek bir site taramasi 100 sayfa icin 137 MB indiriyordu ve iceride 14.1 MB'lik
   * TEK bir HTML sayfasi vardi. Cheerio boyle bir belgeyi ayristirirken kaynagin
   * birkac kati DOM ayirir; 5'li batch ve 2 es zamanli tarama ile worker'in RSS'i
   * 205 MB'tan 1440 MB'a firliyordu. PM2'nin 1 GB max_memory_restart siniri
   * devreye girip SIGTERM gonderiyordu: tarama yarida oluyor, DB'deki is
   * PROCESSING'de asili kaliyor, BullMQ takilan isi yeniden veriyor ve ayni
   * tarama tekrar tekrar cokuyordu. Uretimde ayni is 7 kez bastan basladi.
   *
   * KESMEK, SAYFAYI ATMAKTAN IYI: cikardigimiz sinyallerin tamami (title, meta,
   * canonical, OG, JSON-LD) belgenin <head> kismindadir, yani ilk kilobaytlarda.
   * Sayfayi tamamen elemek onu link grafiginden de dusururdu ve baska sayfalari
   * yanlislikla "orphan" gosterirdi. Kirpilan sayfa loglanir — sessiz kirpma yok.
   */
  private async readCapped(res: Response, url: string, maxBytes: number): Promise<string | null> {
    const reader = res.body?.getReader();
    if (!reader) return null;

    const decoder = new TextDecoder('utf-8');
    const parts: string[] = [];
    let total = 0;
    let kirpildi = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const kalan = maxBytes - total;
        if (value.length >= kalan) {
          parts.push(decoder.decode(value.subarray(0, kalan)));
          kirpildi = true;
          await reader.cancel().catch(() => {});
          break;
        }
        total += value.length;
        parts.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      await reader.cancel().catch(() => {});
      return parts.length ? parts.join('') : null;
    }

    if (kirpildi) {
      this.log.warn(
        `${url} ${(maxBytes / 1048576).toFixed(1)}MB tavanda kirpildi — head sinyalleri okundu, sayfa sonundaki linkler eksik olabilir`,
      );
    }
    return parts.join('');
  }

  private async findSitemap(origin: string): Promise<string | null> {
    const candidates = [
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
      `${origin}/sitemap-index.xml`,
    ];
    for (const url of candidates) {
      const txt = await this.fetchPage(url, SiteCrawlerService.MAX_SITEMAP_BYTES);
      if (txt && (txt.includes('<urlset') || txt.includes('<sitemapindex'))) return url;
    }

    // robots.txt'den keşif
    const robots = await this.fetchPage(`${origin}/robots.txt`);
    if (robots) {
      const match = robots.match(/Sitemap:\s*(\S+)/i);
      if (match) return match[1];
    }
    return null;
  }

  /**
   * Sitemap parse — basit <urlset> + nested <sitemapindex> desteği.
   * Index ise alt sitemap'leri de takip eder.
   */
  private async parseSitemap(sitemapUrl: string): Promise<string[]> {
    const xml = await this.fetchPage(sitemapUrl, SiteCrawlerService.MAX_SITEMAP_BYTES);
    if (!xml) return [];

    // Sitemap index ise alt sitemap'leri parse et
    if (xml.includes('<sitemapindex')) {
      const childUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
      const all: string[] = [];
      for (const child of childUrls.slice(0, 5)) { // max 5 sub-sitemap
        const childXml = await this.fetchPage(child, SiteCrawlerService.MAX_SITEMAP_BYTES);
        if (childXml) {
          const matches = [...childXml.matchAll(/<loc>([^<]+)<\/loc>/g)];
          all.push(...matches.map(m => m[1].trim()));
        }
      }
      return all.filter(u => u.startsWith('http'));
    }

    const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
    return matches.map(m => m[1].trim()).filter(u => u.startsWith('http'));
  }

  /**
   * Sayfayı parse et: title, meta, head OG/Twitter/canonical/hreflang/JSON-LD,
   * body text sample, image alt stats, internal links.
   */
  private extractPageData(url: string, html: string, origin: string): CrawledPage {
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

    // ── Image alt text istatistikleri ──────────────────────
    let imgTotal = 0, imgWithAlt = 0, imgEmptyAlt = 0;
    $('img').each((_, el) => {
      imgTotal++;
      const alt = $(el).attr('alt');
      if (alt === undefined || alt === null) {
        // alt attribute hiç yok
      } else if (alt.trim() === '') {
        imgEmptyAlt++; // alt="" decorative ya da eksik
      } else {
        imgWithAlt++;
      }
    });

    // ── H1, H2'ler ────────────────────────────────────────
    const h2s: string[] = [];
    $('h2').each((_, el) => {
      const text = $(el).text().trim();
      if (text) h2s.push(text);
    });

    // ── Internal links ────────────────────────────────────
    const outboundLinks: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const abs = new URL(href, origin).href.split('#')[0];
        if (abs.startsWith(origin) && !outboundLinks.includes(abs)) {
          outboundLinks.push(abs);
        }
      } catch {}
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
      imageAltStats: { total: imgTotal, withAlt: imgWithAlt, emptyAlt: imgEmptyAlt },
      outboundLinks: outboundLinks.slice(0, 30),
    };
  }
}
