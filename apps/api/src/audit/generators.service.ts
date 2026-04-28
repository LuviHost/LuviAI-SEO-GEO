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

  /** robots.txt — GEO v2: 18+ AI crawler explicit allow + llms-full referansi */
  generateRobotsTxt(siteUrl: string, opts: {
    allowAiCrawlers?: boolean;
    blockPaths?: string[];
  } = {}): string {
    const allowAi = opts.allowAiCrawlers ?? true;
    const block = opts.blockPaths ?? ['/admin/', '/wp-admin/', '/api/', '/cgi-bin/', '/.git/'];

    const baseUrl = siteUrl.replace(/\/$/, '');
    let txt = `# LuviAI tarafından üretildi — ${new Date().toISOString().slice(0, 10)}\n`;
    txt += `# GEO v2: AI search engines (ChatGPT, Claude, Gemini, Perplexity) icin optimize\n\n`;

    txt += `# Genel kurallar\nUser-agent: *\n`;
    block.forEach(p => txt += `Disallow: ${p}\n`);
    txt += `Allow: /\nCrawl-delay: 1\n\n`;

    if (allowAi) {
      // AI search engine crawlers — actively want them
      const aiCrawlersDescriptions: Array<[string, string]> = [
        ['GPTBot', 'OpenAI ChatGPT training crawler'],
        ['OAI-SearchBot', 'ChatGPT Search (real-time)'],
        ['ChatGPT-User', 'ChatGPT user-shared link fetch'],
        ['ClaudeBot', 'Anthropic Claude training crawler'],
        ['Claude-Web', 'Claude.ai web fetch'],
        ['anthropic-ai', 'Anthropic generic'],
        ['Google-Extended', 'Bard / Gemini training'],
        ['Googlebot', 'Google Search'],
        ['Googlebot-Image', 'Google Images / Lens'],
        ['Bingbot', 'Bing + Copilot'],
        ['Applebot', 'Apple Search'],
        ['Applebot-Extended', 'Apple Intelligence training'],
        ['PerplexityBot', 'Perplexity AI search'],
        ['Perplexity-User', 'Perplexity user-shared link fetch'],
        ['YouBot', 'You.com AI search'],
        ['cohere-ai', 'Cohere training'],
        ['Bytespider', 'TikTok/ByteDance AI search'],
        ['Amazonbot', 'Amazon Alexa+ / Rufus'],
        ['DuckAssistBot', 'DuckDuckGo AI'],
        ['Meta-ExternalAgent', 'Meta AI'],
        ['FacebookBot', 'Meta link preview / training'],
        ['Diffbot', 'Diffbot knowledge graph'],
        ['CCBot', 'Common Crawl (training data)'],
        ['Mistral-AI-User', 'Mistral Le Chat'],
        ['DeepSeekBot', 'DeepSeek crawler'],
      ];
      txt += `# ═════════════════════════════════════════════════════\n`;
      txt += `# AI Search Engines — explicit allow (modern GEO)\n`;
      txt += `# ═════════════════════════════════════════════════════\n\n`;
      for (const [bot, desc] of aiCrawlersDescriptions) {
        txt += `# ${desc}\nUser-agent: ${bot}\nAllow: /\nCrawl-delay: 1\n\n`;
      }
    }

    // SEO tool crawlers — block (sites usually don't want these)
    txt += `# ═════════════════════════════════════════════════════\n`;
    txt += `# SEO tool / scraper bots — bloke\n`;
    txt += `# ═════════════════════════════════════════════════════\n\n`;
    const blockedBots = ['AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'BLEXBot', 'PetalBot', 'SeznamBot', 'serpstatbot'];
    for (const bot of blockedBots) {
      txt += `User-agent: ${bot}\nDisallow: /\n\n`;
    }

    txt += `# ═════════════════════════════════════════════════════\n`;
    txt += `# Sitemap + AI dosyalari\n`;
    txt += `# ═════════════════════════════════════════════════════\n`;
    txt += `Sitemap: ${baseUrl}/sitemap.xml\n`;
    // llms.txt + llms-full.txt referansi (AI crawlerlar bunu okur)
    txt += `\n# AI search asistanlari icin yapilandirilmis ozet:\n`;
    txt += `# ${baseUrl}/llms.txt\n`;
    txt += `# ${baseUrl}/llms-full.txt\n`;

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
