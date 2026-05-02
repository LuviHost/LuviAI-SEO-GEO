import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import * as cheerio from 'cheerio';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteCrawlerService } from '../sites/site-crawler.service.js';

export type SnippetType =
  | 'meta_description'
  | 'meta_title'
  | 'canonical'
  | 'open_graph'
  | 'twitter_card'
  | 'jsonld_article'
  | 'jsonld_organization'
  | 'jsonld_breadcrumb'
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
 *  - AI (Claude Haiku, ucuz) ile içerik üret
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
    }>;
    totalScanned: number;
    averageScore: number;
  }> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const base = rootUrl ?? site.url;

    // Crawler zaten 30 sayfaya kadar dolaşıp HTML'leri topluyor
    const crawl = await this.crawler.crawl(base, maxPages);

    const results = await Promise.all(
      crawl.pages.map(async (p) => {
        // Crawl edilen page metadata yetersiz → her sayfa için ham HTML çek
        const html = await this.fetch(p.url);
        if (!html) {
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
            issues: ['Sayfa indirilemedi'],
          };
        }

        const $ = cheerio.load(html);
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
        };
      }),
    );

    const totalScanned = results.length;
    const averageScore = totalScanned > 0
      ? Math.round(results.reduce((s, r) => s + r.score, 0) / totalScanned)
      : 0;

    return { pages: results, totalScanned, averageScore };
  }

  /** Belirli sayfa için tüm eksik snippet'leri üret */
  async generateForPage(siteId: string, pageUrl: string): Promise<PageSnippet[]> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });

    const html = await this.fetch(pageUrl);
    if (!html) {
      throw new Error(`Sayfa indirilemedi: ${pageUrl}`);
    }

    const $ = cheerio.load(html);
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

  private async ask(prompt: string): Promise<string | null> {
    if (!this.anthropic) return null;
    try {
      const resp = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 220,
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

  private async fetch(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'LuviAI-Snippet/1.0' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch { return null; }
  }
}
