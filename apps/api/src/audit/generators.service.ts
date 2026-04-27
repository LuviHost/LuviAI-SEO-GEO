import { Injectable } from '@nestjs/common';
import type { CrawlResult } from '../sites/site-crawler.service.js';

/**
 * sitemap.xml / robots.txt / llms.txt generator'ları.
 * Crawl sonucundan üretir, publish target'a gönderilmek üzere string döner.
 */
@Injectable()
export class GeneratorsService {
  /** sitemap.xml — crawl edilen sayfalardan */
  generateSitemap(crawl: CrawlResult): string {
    const today = new Date().toISOString().slice(0, 10);
    const urls = crawl.pages.map(p => {
      const isHomepage = p.url === crawl.baseUrl || p.url === `${crawl.baseUrl}/`;
      return `  <url>
    <loc>${this.escapeXml(p.url)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${isHomepage ? 'daily' : 'weekly'}</changefreq>
    <priority>${isHomepage ? '1.0' : '0.7'}</priority>
  </url>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  }

  /** robots.txt — AI crawler whitelist + sitemap referansı */
  generateRobotsTxt(siteUrl: string, opts: {
    allowAiCrawlers?: boolean;
    blockPaths?: string[];
  } = {}): string {
    const allowAi = opts.allowAiCrawlers ?? true;
    const block = opts.blockPaths ?? ['/admin/', '/wp-admin/', '/api/', '/cgi-bin/', '/.git/'];

    const baseUrl = siteUrl.replace(/\/$/, '');
    let txt = `# LuviAI tarafından üretildi — ${new Date().toISOString().slice(0, 10)}\n\n`;

    txt += `# Genel kurallar\nUser-agent: *\n`;
    block.forEach(p => txt += `Disallow: ${p}\n`);
    txt += `Allow: /\nCrawl-delay: 1\n\n`;

    if (allowAi) {
      txt += `# AI Search crawler'ları (modern SEO için)\n`;
      const aiCrawlers = ['GPTBot', 'ChatGPT-User', 'Claude-Web', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot', 'Bytespider', 'Applebot-Extended'];
      for (const c of aiCrawlers) {
        txt += `User-agent: ${c}\nAllow: /\n\n`;
      }
    }

    txt += `# Bot ağı (kötü niyetli)\nUser-agent: AhrefsBot\nDisallow: /\n\n`;
    txt += `User-agent: SemrushBot\nDisallow: /\n\n`;
    txt += `User-agent: MJ12bot\nDisallow: /\n\n`;

    txt += `# Sitemap\nSitemap: ${baseUrl}/sitemap.xml\n`;

    return txt;
  }

  /** llms.txt — Auriti formatında AI search özetlemesi */
  generateLlmsTxt(crawl: CrawlResult, brandName: string, brandDescription: string): string {
    const baseUrl = crawl.baseUrl.replace(/\/$/, '');

    let txt = `# ${brandName}\n\n`;
    txt += `> ${brandDescription}\n\n`;
    txt += `Bu dosya, AI search asistanlarının (ChatGPT, Claude, Perplexity, Gemini) `;
    txt += `${brandName} hakkında doğru ve güncel bilgi alabilmesi için hazırlandı.\n\n`;

    // Ana sayfalar
    const homepage = crawl.pages.find(p => p.url === baseUrl || p.url === `${baseUrl}/`);
    if (homepage) {
      txt += `## Ana Sayfa\n\n`;
      txt += `- [${homepage.title || brandName}](${homepage.url}): ${homepage.metaDescription || homepage.h1}\n\n`;
    }

    // Diğer önemli sayfalar (h1+meta_description varsa)
    const importantPages = crawl.pages
      .filter(p => p.url !== homepage?.url && p.h1 && p.metaDescription)
      .slice(0, 20);

    if (importantPages.length > 0) {
      txt += `## Önemli Sayfalar\n\n`;
      for (const p of importantPages) {
        txt += `- [${p.h1}](${p.url}): ${p.metaDescription}\n`;
      }
      txt += '\n';
    }

    // Optional structured data
    txt += `## Marka Bilgisi\n\n`;
    txt += `- **İsim:** ${brandName}\n`;
    txt += `- **Web sitesi:** ${baseUrl}\n`;
    txt += `- **Açıklama:** ${brandDescription}\n`;
    txt += `- **Son güncelleme:** ${new Date().toISOString().slice(0, 10)}\n`;

    return txt;
  }

  private escapeXml(s: string): string {
    return s.replace(/[<>&"']/g, c => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
    } as any)[c]);
  }
}
