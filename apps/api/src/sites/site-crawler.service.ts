import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';

export interface CrawledPage {
  url: string;
  title: string;
  metaDescription: string;
  h1: string;
  h2s: string[];
  textSample: string; // ilk 1000 karakter
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
  /**
   * Bir siteyi sınırlı derinlikte crawl eder.
   * Faz 1: max 30 sayfa, sitemap.xml öncelikli, yoksa link discovery.
   */
  async crawl(baseUrl: string, maxPages = 30): Promise<CrawlResult> {
    const url = new URL(baseUrl);
    const origin = url.origin;

    // 1) Sitemap fetch dene
    const sitemapUrl = await this.findSitemap(origin);
    let urls: string[] = [];
    if (sitemapUrl) {
      urls = await this.parseSitemap(sitemapUrl);
    }

    // 2) Yetersizse anasayfadan link discovery
    if (urls.length < 10) {
      const homepage = await this.fetchPage(origin);
      if (homepage) {
        const $ = cheerio.load(homepage);
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          try {
            const abs = new URL(href, origin).href;
            if (abs.startsWith(origin) && !urls.includes(abs)) urls.push(abs);
          } catch {}
        });
      }
    }

    // 3) İlk N sayfayı detaylı crawl
    const pages: CrawledPage[] = [];
    const targetUrls = [origin, ...urls.filter(u => u !== origin)].slice(0, maxPages);

    for (const pageUrl of targetUrls) {
      try {
        const html = await this.fetchPage(pageUrl);
        if (!html) continue;
        pages.push(this.extractPageData(pageUrl, html, origin));
      } catch {}
    }

    // 4) robots.txt + llms.txt
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

  private async fetchPage(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'LuviAI-Crawler/1.0 (+https://ai.luvihost.com)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  private async findSitemap(origin: string): Promise<string | null> {
    const candidates = [
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
      `${origin}/sitemap-index.xml`,
    ];
    for (const url of candidates) {
      const txt = await this.fetchPage(url);
      if (txt && txt.includes('<urlset') || (txt && txt.includes('<sitemapindex'))) return url;
    }

    // robots.txt'den keşif
    const robots = await this.fetchPage(`${origin}/robots.txt`);
    if (robots) {
      const match = robots.match(/Sitemap:\s*(\S+)/i);
      if (match) return match[1];
    }
    return null;
  }

  private async parseSitemap(sitemapUrl: string): Promise<string[]> {
    const xml = await this.fetchPage(sitemapUrl);
    if (!xml) return [];
    const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
    return matches.map(m => m[1].trim()).filter(u => u.startsWith('http'));
  }

  private extractPageData(url: string, html: string, origin: string): CrawledPage {
    const $ = cheerio.load(html);
    const h2s: string[] = [];
    $('h2').each((_, el) => {
      const text = $(el).text().trim();
      if (text) h2s.push(text);
    });

    const outboundLinks: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const abs = new URL(href, origin).href;
        if (abs.startsWith(origin) && !outboundLinks.includes(abs)) {
          outboundLinks.push(abs);
        }
      } catch {}
    });

    // textSample — script/style hariç, ilk 1000 karakter
    $('script, style, nav, footer').remove();
    const textSample = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 1000);

    return {
      url,
      title: $('title').text().trim() || $('h1').first().text().trim(),
      metaDescription: $('meta[name="description"]').attr('content') ?? '',
      h1: $('h1').first().text().trim(),
      h2s: h2s.slice(0, 10),
      textSample,
      outboundLinks: outboundLinks.slice(0, 20),
    };
  }
}
