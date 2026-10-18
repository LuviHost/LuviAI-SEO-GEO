import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import * as cheerio from 'cheerio';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteCrawlerService } from '../sites/site-crawler.service.js';
import { CrawlAccessError } from '../sites/crawl-access.js';
import { fetchCustomerPage, pageFailureText, type CustomerPage, type CustomerPageBlocked, type CustomerPageFailed } from './customer-page-fetch.js';
import { createLimiter } from './axo-fetch.js';

/**
 * Toplu taramada siteye ayni anda en fazla bu kadar sayfa istegi (AXO
 * taramasiyla ayni sinir). NEDEN: 30-50 sayfa Promise.all ile ayni anda
 * isteniyordu; WAF / hiz siniri (429) bu patlamaya takilinca sayfalar
 * "erisim engellendi" isaretleniyordu — engeli KENDI istek yagmurumuz
 * uretiyordu ve musteriye sitesi bize kapali gibi gosteriliyordu.
 */
const BULK_SCAN_CONCURRENCY = 4;

/** "www." farki ayni site; sondaki nokta ve buyuk harf yok sayilir */
function hostKey(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
}

/**
 * Toplu tarama adresi sitenin KENDI alan adinda mi: ayni host, www'li/www'suz
 * hali ya da site host'unun alt alan adi (blog.ornek.com, ornek.com sitesi icin).
 *
 * NEDEN: rootUrl sorgu parametresi giris yapmis herhangi bir kullanicinin
 * RanksUp'i baska bir siteyi taramak icin kullanmasina izin veriyordu (SSRF
 * korumali ama kapsam disi kullanim; tarama istekleri bizim botumuzdan gider).
 *
 * Kayit edilebilir alan (registrableDomain) ile esleme BILEREK yapilmiyor:
 * oradaki sonek listesi kurate ve paylasimli platform alanlarini
 * (myshopify.com, wordpress.com, github.io...) bilmiyor; ornek.myshopify.com
 * sitesi "myshopify.com" uzerinden baska magazalari tarayabilirdi.
 */
export function isWithinSiteHost(candidateUrl: string, siteUrl: string): boolean {
  try {
    const c = new URL(candidateUrl);
    if (c.protocol !== 'http:' && c.protocol !== 'https:') return false;
    const site = hostKey(new URL(siteUrl).hostname);
    const host = hostKey(c.hostname);
    return !!site && (host === site || host.endsWith(`.${site}`));
  } catch {
    return false;
  }
}

/**
 * Kullanicidan gelen sayfa adresi sitenin kendi alan adinda degilse Turkce 400;
 * gecerse kirpilmis adresi doner. Her giris noktasi bunu fetch / model cagrisi /
 * yazimdan ONCE cagirir (bkz. isWithinSiteHost — kapsam disi kullanim).
 *
 * NEDEN: snippet uretimi tek sayfa icin 10'a kadar ucretli model cagrisi
 * yapabiliyor (bkz. generateForPage), statik yazici sayfayi musterinin
 * sunucusuna yaziyor; ikisi de herhangi bir genel adresi kabul ediyordu.
 *
 * @param action cumlenin oznesi ("Toplu tarama", "Snippet üretimi"...)
 */
export function assertWithinSiteHost(candidateUrl: unknown, siteUrl: string, action: string): string {
  const raw = typeof candidateUrl === 'string' ? candidateUrl.trim() : '';
  if (raw && isWithinSiteHost(raw, siteUrl)) return raw;
  let parsed: URL | null = null;
  try { parsed = new URL(raw); } catch { /* asagida "gecersiz adres" */ }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new BadRequestException('Geçerli bir adres girin (http:// veya https:// ile başlamalı).');
  }
  let siteHost = siteUrl;
  try { siteHost = new URL(siteUrl).hostname; } catch { /* gecersiz site adresi — ham hali yazilir */ }
  throw new BadRequestException(
    `${action} yalnızca sitenin kendi alan adında yapılabilir (${siteHost}; www'li/www'suz hali ve alt alan adları dahil). Girilen adres bu siteye ait değil.`,
  );
}

export type SnippetType =
  | 'meta_description'
  | 'meta_title'
  | 'canonical'
  | 'open_graph'
  | 'twitter_card'
  | 'jsonld_article'
  | 'jsonld_organization'
  | 'jsonld_breadcrumb'
  | 'jsonld_faq'
  | 'jsonld_defined_term'
  | 'citation_format'
  | 'h1';

export interface PageSnippet {
  pageUrl: string;
  type: SnippetType;
  reason: string;            // neden eksik/yanlış
  insertLocation: string;    // "<head> içine" / "</body> öncesi" / "ilk H1 olarak"
  currentValue?: string;
  generatedSnippet: string;  // copy-paste edilecek HTML
  language: 'html' | 'json-ld';
}

/**
 * D1 — Snippet Generator. Auto-fix YAPMAZ; eksik on-page tag'leri için
 * AI ile içerik üretip kullanıcıya copy-paste snippet'i verir.
 *
 * Strateji:
 *  - Sayfayı crawl et, h1/title/meta/canonical/og/twitter/jsonld eksiklerini bul
 *  - AI ile içerik üret: ask() claude-opus-5 modelini kullanir, Haiku DEGIL
 *    (eski yorum "Claude Haiku, ucuz" diyordu; model degismedi, yorum
 *    duzeltildi). Sayfa basina 10'a kadar ucretli cagri olabildigi icin uretim
 *    yalniz sitenin kendi sayfalarinda (assertWithinSiteHost).
 *  - HTML/JSON-LD formatında insert location ile birlikte döndür
 */
@Injectable()
export class SnippetGeneratorService {
  private readonly log = new Logger(SnippetGeneratorService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crawler: SiteCrawlerService,
  ) {}

  /**
   * Toplu tarama — site root URL'inden başlayıp tüm alt sayfalar için SEO durumunu çıkarır.
   * AI çağrısı yapmaz (hızlı + ücretsiz). Her sayfa için: title var mı, metaDesc uzunluğu,
   * canonical/OG/Twitter/Schema/H1 durumu. Frontend tablo halinde gösterir.
   *
   * Sonra kullanıcı tablodaki her sayfa için tek tek "Üret" tıklayabilir veya bulk run.
   */
  async bulkScan(siteId: string, rootUrl?: string, maxPages = 30): Promise<{
    pages: Array<{
      url: string;
      title: string | null;
      titleLength: number;
      metaDescription: string | null;
      metaDescriptionLength: number;
      h1: string | null;
      hasCanonical: boolean;
      hasOG: boolean;
      hasTwitter: boolean;
      hasSchema: boolean;
      hasFAQ: boolean;
      score: number; // 0-100
      issues: string[];
      /** Erisimimiz engellendi (WAF / bot dogrulamasi) — skor olculmedi, ortalamaya girmez */
      blocked: boolean;
      /**
       * Engel DISI bir nedenle okunamadi (HTTP 404/500, zaman asimi, DNS, HTML
       * olmayan icerik) — skor olculmedi, ortalamaya girmez. blocked ile birlikte
       * true olmaz.
       */
      failed: boolean;
      /** failed ise kisa Turkce neden (customer-page-fetch pageFailureText) */
      failReason?: string;
    }>;
    totalScanned: number;
    /** Yalnizca GERCEKTEN okunan sayfalarin ortalamasi (engelli ve okunamayan haric) */
    averageScore: number;
    /** Engel yuzunden olculemeyen sayfa sayisi */
    blockedPages: number;
    /** Engel disi nedenle okunamayan sayfa sayisi */
    failedPages: number;
  }> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const requested = rootUrl?.trim() || null;
    const base = requested ? assertWithinSiteHost(requested, site.url, 'Toplu tarama') : site.url;

    // Crawler zaten 30 sayfaya kadar dolaşıp HTML'leri topluyor
    const crawl = await this.crawler.crawl(base, maxPages);
    // Anasayfa okunamadi ve tarama durdu: "0 sayfa, ortalama 0" yerine neden +
    // izin talimati (denetim ve marka beyniyle ayni hata tipi, 422)
    if (crawl.homeAccess && crawl.pages.length === 0) {
      throw new CrawlAccessError(crawl.homeAccess);
    }
    const blocks: CustomerPageBlocked[] = [];
    const failures: CustomerPageFailed[] = [];
    const limit = createLimiter(BULK_SCAN_CONCURRENCY);

    // Sonuc sirasi tarama sirasidir (Promise.all); yalniz ayni andaki istek sayisi sinirli
    const results = await Promise.all(
      crawl.pages.map((p) => limit(async () => {
        // Crawl edilen page metadata yetersiz → her sayfa için ham HTML çek
        const page = await this.fetchPage(p.url);
        if (page.kind !== 'ok') {
          const blocked = page.kind === 'blocked';
          if (page.kind === 'blocked') blocks.push(page);
          else failures.push(page);
          // Engel DISI okuma hatasi (404, zaman asimi, DNS, PDF...) da olcum
          // DEGIL: eskiden skor 0 ile ortalamaya girip siteyi oldugundan kotu
          // gosteriyordu ve tabloda "kotu sayfa"dan ayirt edilemiyordu.
          const failReason = page.kind === 'failed' ? pageFailureText(page) : undefined;
          return {
            url: p.url,
            title: p.title || null,
            titleLength: (p.title || '').length,
            metaDescription: null,
            metaDescriptionLength: 0,
            h1: p.h1 || null,
            hasCanonical: false,
            hasOG: false,
            hasTwitter: false,
            hasSchema: false,
            hasFAQ: false,
            score: 0,
            // Engel: "sayfa bozuk" degil, "bize kapali" — nedeni yaz
            issues: [page.kind === 'blocked' ? page.signal.reason : failReason!],
            blocked,
            failed: !blocked,
            ...(failReason ? { failReason } : {}),
          };
        }

        const $ = cheerio.load(page.text);
        const title = $('title').text().trim() || null;
        const metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? null;
        const h1 = $('h1').first().text().trim() || null;
        const hasCanonical = $('link[rel="canonical"]').length > 0;
        const hasOG = $('meta[property^="og:"]').length >= 3; // en az og:type, og:title, og:url
        const hasTwitter = $('meta[name^="twitter:"]').length >= 2;
        const schemaScripts = $('script[type="application/ld+json"]');
        const hasSchema = schemaScripts.length > 0;
        let hasFAQ = false;
        schemaScripts.each((_i, el) => {
          try {
            const json = JSON.parse($(el).html() ?? '{}');
            const types = Array.isArray(json) ? json.map((j) => j['@type']) : [json['@type']];
            if (types.some((t) => t === 'FAQPage' || t === 'Question')) hasFAQ = true;
          } catch {/* noop */}
        });

        const issues: string[] = [];
        let score = 0;
        // Scoring (toplam 100)
        if (title && title.length >= 20 && title.length <= 65) score += 15;
        else if (title) { score += 5; issues.push(title.length < 20 ? 'Title çok kısa' : 'Title çok uzun'); }
        else issues.push('Title yok');

        if (metaDescription && metaDescription.length >= 140 && metaDescription.length <= 160) score += 20;
        else if (metaDescription) {
          score += 8;
          issues.push(metaDescription.length < 140 ? 'Meta description çok kısa' : 'Meta description çok uzun');
        } else issues.push('Meta description yok');

        if (h1) score += 10; else issues.push('H1 yok');
        if (hasCanonical) score += 10; else issues.push('Canonical yok');
        if (hasOG) score += 15; else issues.push('Open Graph yok');
        if (hasTwitter) score += 10; else issues.push('Twitter Card yok');
        if (hasSchema) score += 15; else issues.push('Schema markup yok');
        if (hasFAQ) score += 5;

        return {
          url: p.url,
          title,
          titleLength: title?.length ?? 0,
          metaDescription,
          metaDescriptionLength: metaDescription?.length ?? 0,
          h1,
          hasCanonical,
          hasOG,
          hasTwitter,
          hasSchema,
          hasFAQ,
          score,
          issues,
          blocked: false,
          failed: false,
        };
      })),
    );

    const totalScanned = results.length;
    const measured = results.filter((r) => !r.blocked && !r.failed);
    const blockedPages = results.filter((r) => r.blocked).length;
    const failedPages = results.filter((r) => r.failed).length;
    // Taranan sayfalarin HICBIRI okunamadiysa tablo yalniz sifirlardan olusur
    // ve "ortalama 0" siteyi bozuk gosterir; nedeni (engelde izin talimati
    // dahil — o yuzden once engel) ve cozumu soyle.
    if (totalScanned > 0 && measured.length === 0) {
      const first = blocks[0] ?? failures[0];
      throw new BadRequestException(`Sayfalar okunamadı: ${first ? pageFailureText(first) : 'Sayfaya bağlanılamadı.'}`);
    }
    const averageScore = measured.length > 0
      ? Math.round(measured.reduce((s, r) => s + r.score, 0) / measured.length)
      : 0;

    return { pages: results, totalScanned, averageScore, blockedPages, failedPages };
  }

  /** Belirli sayfa için tüm eksik snippet'leri üret */
  async generateForPage(siteId: string, rawPageUrl: string): Promise<PageSnippet[]> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    // Kapsam: sayfa basina 10'a kadar ucretli model cagrisi — yalniz sitenin
    // kendi sayfalari icin, istekten ve modelden ONCE.
    const pageUrl = assertWithinSiteHost(rawPageUrl, site.url, 'Snippet üretimi');

    const page = await this.fetchPage(pageUrl);
    if (page.kind !== 'ok') {
      // Duz Error 500 "Internal server error" oluyordu; kullanici nedeni gorsun.
      // Engel sayfasindan snippet uretmek dogrulama ekranini "icerik" sanmak olurdu.
      throw new BadRequestException(`Sayfa indirilemedi: ${pageUrl} — ${pageFailureText(page)}`);
    }

    const $ = cheerio.load(page.text);
    const snippets: PageSnippet[] = [];

    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? '';
    const canonical = $('link[rel="canonical"]').attr('href')?.trim() ?? '';
    const h1 = $('h1').first().text().trim();
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogImage = $('meta[property="og:image"]').attr('content');
    const twCard = $('meta[name="twitter:card"]').attr('content');
    const hasArticleSchema = $('script[type="application/ld+json"]')
      .toArray()
      .some(el => ($(el).html() ?? '').includes('"@type":"Article"') || ($(el).html() ?? '').includes('"@type": "Article"'));

    const bodyText = $('body').clone().find('script,style,nav,footer').remove().end().text().replace(/\s+/g, ' ').trim().slice(0, 2000);

    // Title eksik veya çok kısa
    if (!title || title.length < 30) {
      snippets.push(await this.aiTitle(pageUrl, h1, bodyText, site.name));
    }

    // Meta description eksik veya yanlış uzunlukta
    if (!metaDesc || metaDesc.length < 120 || metaDesc.length > 170) {
      snippets.push(await this.aiMetaDescription(pageUrl, h1 || title, bodyText, metaDesc));
    }

    // Canonical eksik
    if (!canonical) {
      snippets.push({
        pageUrl,
        type: 'canonical',
        reason: 'Canonical link tag yok — duplicate content riski',
        insertLocation: '<head> içine',
        generatedSnippet: `<link rel="canonical" href="${pageUrl}" />`,
        language: 'html',
      });
    }

    // H1 eksik
    if (!h1) {
      snippets.push(await this.aiH1(pageUrl, title, bodyText));
    }

    // Open Graph eksik (en az og:title + og:image olmalı)
    if (!ogTitle || !ogImage) {
      snippets.push(await this.aiOpenGraph(pageUrl, title || h1, metaDesc, bodyText, site.url));
    }

    // Twitter card
    if (!twCard) {
      snippets.push({
        pageUrl,
        type: 'twitter_card',
        reason: 'Twitter Card meta yok — Twitter/X paylaşımlarında zengin önizleme çıkmaz',
        insertLocation: '<head> içine, OG meta\'ların yanına',
        generatedSnippet: [
          `<meta name="twitter:card" content="summary_large_image" />`,
          `<meta name="twitter:title" content="${this.esc(title || h1 || site.name)}" />`,
          `<meta name="twitter:description" content="${this.esc(metaDesc || (bodyText.slice(0, 150)))}" />`,
        ].join('\n'),
        language: 'html',
      });
    }

    // JSON-LD Article (yalnızca makale-tipi sayfalarda öner)
    if (!hasArticleSchema && this.looksLikeArticle($, pageUrl)) {
      snippets.push(await this.aiJsonLdArticle(pageUrl, title || h1, metaDesc, bodyText, site.name, site.url));
    }

    // FAQ schema (Q-A çiftleri yoksa AI ile üret)
    const hasFAQSchema = $('script[type="application/ld+json"]').toArray()
      .some(el => /"@type"\s*:\s*"(FAQPage|Question)"/i.test($(el).html() ?? ''));
    if (!hasFAQSchema) {
      const faq = await this.aiJsonLdFAQ(pageUrl, title || h1, bodyText);
      if (faq) snippets.push(faq);
    }

    // DefinedTerm — "X nedir?" tanım yoğunluğu için
    const hasDefinedTerm = $('script[type="application/ld+json"]').toArray()
      .some(el => /"@type"\s*:\s*"DefinedTerm"/i.test($(el).html() ?? ''));
    const hasDefinitionInBody = /(nedir\?|tanım|terim|olarak tanımlan)/i.test(bodyText.slice(0, 1500));
    if (!hasDefinedTerm && !hasDefinitionInBody) {
      const def = await this.aiDefinedTerm(pageUrl, title || h1, bodyText, site.name);
      if (def) snippets.push(def);
    }

    // Citation format — liste/tablo eksikse AI ile özet liste önerir
    const hasList = $('body ul li, body ol li').length >= 3;
    const hasTable = $('body table').length > 0;
    if (!hasList && !hasTable && bodyText.length > 800) {
      const cit = await this.aiCitationFormat(pageUrl, title || h1, bodyText);
      if (cit) snippets.push(cit);
    }

    return snippets;
  }

  /** Anasayfa için Organization JSON-LD üret (site bazlı, sayfa-bağımsız) */
  async generateOrganizationJsonLd(siteId: string): Promise<PageSnippet> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });
    const description = (site.brain?.brandVoice as any)?.tagline
      ?? `${site.name} — ${site.niche ?? 'web sitesi'}`;
    const logo = `${site.url.replace(/\/$/, '')}/logo.png`;

    const obj = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: site.name,
      url: site.url,
      logo,
      description,
    };

    return {
      pageUrl: site.url,
      type: 'jsonld_organization',
      reason: 'Anasayfada Organization schema yoksa Knowledge Panel/AI Overview\'da görünmek zorlaşır',
      insertLocation: 'Anasayfa <head> içine',
      generatedSnippet: `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`,
      language: 'json-ld',
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  AI üreticiler
  // ──────────────────────────────────────────────────────────────────
  private async aiTitle(url: string, h1: string, bodyText: string, brand: string): Promise<PageSnippet> {
    const prompt = `Bu sayfa için 50-60 karakter SEO uyumlu Türkçe <title> üret. Marka adı sonda olsun. Sadece başlık metni, başka yorum yok.\n\nURL: ${url}\nH1: ${h1}\nIçerik özeti: ${bodyText.slice(0, 500)}\nMarka: ${brand}`;
    const ai = await this.ask(prompt);
    const title = (ai || `${h1 || brand}`).replace(/^["']|["']$/g, '').trim().slice(0, 60);
    return {
      pageUrl: url,
      type: 'meta_title',
      reason: 'Title eksik veya 30 karakterden kısa',
      insertLocation: '<head> içine (<title> tag\'ı olarak)',
      currentValue: undefined,
      generatedSnippet: `<title>${this.esc(title)}</title>`,
      language: 'html',
    };
  }

  private async aiMetaDescription(url: string, heading: string, bodyText: string, current: string): Promise<PageSnippet> {
    const prompt = `Bu sayfa için 140-160 karakter Türkçe meta description yaz. Aktif fiil + değer önerisi + (varsa) sayısal kanıt. Sadece description metni döndür.\n\nBaşlık: ${heading}\nIçerik: ${bodyText.slice(0, 600)}`;
    const ai = await this.ask(prompt);
    const desc = (ai || bodyText.slice(0, 155)).replace(/^["']|["']$/g, '').trim().slice(0, 158);
    return {
      pageUrl: url,
      type: 'meta_description',
      reason: current
        ? `Mevcut meta description ${current.length} karakter (140-160 olmalı)`
        : 'Meta description yok',
      insertLocation: '<head> içine',
      currentValue: current || undefined,
      generatedSnippet: `<meta name="description" content="${this.esc(desc)}" />`,
      language: 'html',
    };
  }

  private async aiH1(url: string, title: string, bodyText: string): Promise<PageSnippet> {
    const prompt = `Bu sayfa için ana anahtar kelimeyi içeren tek satır Türkçe H1 üret. Sadece başlık.\n\nTitle: ${title}\nIçerik: ${bodyText.slice(0, 400)}`;
    const ai = await this.ask(prompt);
    const h1Text = (ai || title || 'Sayfa Başlığı').replace(/^["']|["']$/g, '').trim().slice(0, 100);
    return {
      pageUrl: url,
      type: 'h1',
      reason: 'Sayfada H1 etiketi yok — Google için ana konu sinyali eksik',
      insertLocation: 'İçerik gövdesinin en üstüne, ilk H1 olarak',
      generatedSnippet: `<h1>${this.esc(h1Text)}</h1>`,
      language: 'html',
    };
  }

  private async aiOpenGraph(url: string, title: string, desc: string, bodyText: string, siteUrl: string): Promise<PageSnippet> {
    const ogTitle = title || (await this.ask(`Bu içerik için 60 karakter Türkçe OG başlığı yaz. Sadece metin.\n\n${bodyText.slice(0, 400)}`)) || 'Başlık';
    const ogDesc = desc || (await this.ask(`Bu içerik için 150 karakter Türkçe OG açıklaması yaz. Sadece metin.\n\n${bodyText.slice(0, 500)}`)) || '';
    const fallbackImg = `${new URL(siteUrl).origin}/og-default.png`;
    return {
      pageUrl: url,
      type: 'open_graph',
      reason: 'Open Graph meta eksik — Facebook/LinkedIn paylaşımında zengin önizleme çıkmaz',
      insertLocation: '<head> içine',
      generatedSnippet: [
        `<meta property="og:type" content="article" />`,
        `<meta property="og:url" content="${url}" />`,
        `<meta property="og:title" content="${this.esc(ogTitle.trim().slice(0, 95))}" />`,
        `<meta property="og:description" content="${this.esc(ogDesc.trim().slice(0, 160))}" />`,
        `<meta property="og:image" content="${fallbackImg}" />`,
        `<meta property="og:image:width" content="1200" />`,
        `<meta property="og:image:height" content="630" />`,
      ].join('\n'),
      language: 'html',
    };
  }

  private async aiJsonLdArticle(url: string, title: string, desc: string, bodyText: string, brand: string, siteUrl: string): Promise<PageSnippet> {
    const headline = title || (await this.ask(`Bu içerik için 60 karakter Türkçe headline yaz. Sadece metin.\n\n${bodyText.slice(0, 300)}`)) || 'Başlık';
    const description = desc || (await this.ask(`Bu içerik için 150 karakter Türkçe açıklama yaz. Sadece metin.\n\n${bodyText.slice(0, 500)}`)) || '';
    const obj = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: headline.trim().slice(0, 110),
      description: description.trim().slice(0, 200),
      author: { '@type': 'Organization', name: brand },
      publisher: { '@type': 'Organization', name: brand, logo: { '@type': 'ImageObject', url: `${new URL(siteUrl).origin}/logo.png` } },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      datePublished: new Date().toISOString().slice(0, 10),
      dateModified: new Date().toISOString().slice(0, 10),
    };
    return {
      pageUrl: url,
      type: 'jsonld_article',
      reason: 'Article schema yok — Google rich result + AI Overview için temel',
      insertLocation: 'Sayfanın <head> bölümüne',
      generatedSnippet: `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`,
      language: 'json-ld',
    };
  }

  private async aiJsonLdFAQ(url: string, heading: string, bodyText: string): Promise<PageSnippet | null> {
    const prompt = `Bu sayfa için 3-5 adet soru-cevap üret. Cevaplar 1-3 cümle, doğal Türkçe, sayfa konusuyla doğrudan ilgili. Sadece JSON array döndür, başka açıklama yok:
[{"q":"soru?","a":"cevap."},{"q":"...","a":"..."}]

Başlık: ${heading}
İçerik: ${bodyText.slice(0, 1200)}`;
    const raw = await this.ask(prompt);
    if (!raw) return null;
    let pairs: Array<{ q: string; a: string }> = [];
    try {
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start < 0 || end < 0) return null;
      pairs = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
    if (!Array.isArray(pairs) || pairs.length === 0) return null;

    const obj = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: pairs.slice(0, 6).map(p => ({
        '@type': 'Question',
        name: String(p.q ?? '').trim().slice(0, 200),
        acceptedAnswer: {
          '@type': 'Answer',
          text: String(p.a ?? '').trim().slice(0, 800),
        },
      })),
    };

    return {
      pageUrl: url,
      type: 'jsonld_faq',
      reason: `FAQ schema yok — GEO için ağırlık 12. ${pairs.length} soru-cevap önerildi.`,
      insertLocation: 'Sayfanın <head> bölümüne (Article schema varsa onun yanına)',
      generatedSnippet: `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`,
      language: 'json-ld',
    };
  }

  private async aiDefinedTerm(url: string, heading: string, bodyText: string, brand: string): Promise<PageSnippet | null> {
    const prompt = `Bu sayfanın ana terimi nedir, kısa bir tanımı yaz. Format JSON, sadece bunu döndür:
{"term":"terim adı","definition":"1-2 cümle tanım"}

Başlık: ${heading}
İçerik: ${bodyText.slice(0, 800)}`;
    const raw = await this.ask(prompt);
    if (!raw) return null;
    let pair: { term?: string; definition?: string } = {};
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end < 0) return null;
      pair = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
    if (!pair.term || !pair.definition) return null;

    const obj = {
      '@context': 'https://schema.org',
      '@type': 'DefinedTerm',
      name: pair.term.trim().slice(0, 120),
      description: pair.definition.trim().slice(0, 500),
      inDefinedTermSet: brand,
      url,
    };

    return {
      pageUrl: url,
      type: 'jsonld_defined_term',
      reason: 'Tanım yoğunluğu düşük — AI Overview "X nedir?" sorgularında atıf için DefinedTerm schema önerilir',
      insertLocation: 'Sayfanın <head> bölümüne',
      generatedSnippet: `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`,
      language: 'json-ld',
    };
  }

  private async aiCitationFormat(url: string, heading: string, bodyText: string): Promise<PageSnippet | null> {
    const prompt = `Bu sayfa içeriğinden 4-6 maddelik özet liste çıkar. Maddeler kısa (5-12 kelime), eyleme dönük veya gerçek. Sadece HTML <ul><li> blok döndür, başka açıklama yok.

Başlık: ${heading}
İçerik: ${bodyText.slice(0, 1500)}`;
    const raw = await this.ask(prompt);
    if (!raw) return null;
    const cleaned = raw.replace(/^```html\s*|\s*```$/g, '').trim();
    if (!/<ul/i.test(cleaned)) return null;

    return {
      pageUrl: url,
      type: 'citation_format',
      reason: 'Liste/tablo eksik — AI motorları (Perplexity/SearchGPT) madde işaretli özetleri atıf olarak tercih ediyor',
      insertLocation: 'Sayfanın giriş paragrafından sonra, ana içeriğin başına',
      generatedSnippet: cleaned,
      language: 'html',
    };
  }

  private async ask(prompt: string): Promise<string | null> {
    if (!this.anthropic) return null;
    try {
      const resp = await this.anthropic.messages.create({
        model: 'claude-opus-5',
        max_tokens: 4000,
        system: 'Sen Türkçe SEO copywriter\'ısın. İstenen formatta tek bir çıktı ver, açıklama yapma, tırnak/markdown kullanma.',
        messages: [{ role: 'user', content: prompt }],
      });
      return resp.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join(' ')
        .trim();
    } catch (err: any) {
      this.log.warn(`AI üretim hatası: ${err.message}`);
      return null;
    }
  }

  private looksLikeArticle($: cheerio.CheerioAPI, url: string): boolean {
    const path = (() => { try { return new URL(url).pathname; } catch { return url; } })();
    if (/\/blog\/|\/makale\/|\/article\/|\/post\//i.test(path)) return true;
    if ($('article').length > 0) return true;
    if ($('time[datetime]').length > 0) return true;
    return false;
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Sayfa — adres kullanicidan (pageUrl/rootUrl sorgu parametresi) ve
   * taramadan gelir: SSRF korumali, 2 MB tavanli, engel sayfasi ayrilir.
   */
  private async fetchPage(url: string): Promise<CustomerPage> {
    return fetchCustomerPage(url, { timeoutMs: 12_000, maxBytes: 2 * 1024 * 1024 });
  }
}
