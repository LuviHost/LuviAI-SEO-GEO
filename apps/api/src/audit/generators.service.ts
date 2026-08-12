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
    /** Content-Signal: ai-train degeri — varsayilan yes (gorunurluk oncelikli) */
    allowAiTraining?: boolean;
  } = {}): string {
    const allowAi = opts.allowAiCrawlers ?? true;
    const block = opts.blockPaths ?? ['/admin/', '/wp-admin/', '/api/', '/cgi-bin/', '/.git/'];

    const baseUrl = siteUrl.replace(/\/$/, '');
    let txt = `# RanksUp tarafından üretildi — ${new Date().toISOString().slice(0, 10)}\n`;
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

    // Content Signals (Cloudflare Content Signals Policy) — iceriginin arama,
    // AI cevabi ve egitimde nasil kullanilabilecegini deklare eder. Agent
    // Readiness (AXO) kontrolu bu satiri arar.
    txt += `# ═════════════════════════════════════════════════════\n`;
    txt += `# Content Signals — icerik kullanim tercihi\n`;
    txt += `# ═════════════════════════════════════════════════════\n`;
    txt += `Content-Signal: search=yes, ai-input=yes, ai-train=${opts.allowAiTraining === false ? 'no' : 'yes'}\n\n`;

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

  /**
   * A2A Agent Card — /.well-known/agent.json
   * Ajanlarin siteyi bir "hizmet" olarak kesfetmesi icin kimlik karti.
   * Zorunlu alanlar: name, description, url; skills sitenin sundugu
   * hizmetlerden (brain.seoStrategy pillars) turetilir.
   */
  generateAgentJson(opts: {
    siteUrl: string;
    brandName: string;
    description: string;
    pillars?: Array<{ name?: string; url?: string }>;
  }): string {
    const baseUrl = opts.siteUrl.replace(/\/$/, '');
    const skills = (opts.pillars ?? [])
      .filter((p) => p?.name)
      .slice(0, 8)
      .map((p, i) => ({
        id: `skill-${i + 1}`,
        name: p.name,
        description: `${opts.brandName} — ${p.name}`,
        ...(p.url ? { url: p.url.startsWith('http') ? p.url : `${baseUrl}${p.url}` } : {}),
      }));

    return JSON.stringify({
      protocolVersion: '0.3.0',
      name: opts.brandName,
      description: opts.description,
      url: baseUrl,
      preferredTransport: 'none',
      provider: { organization: opts.brandName, url: baseUrl },
      documentationUrl: `${baseUrl}/llms.txt`,
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/html', 'text/markdown'],
      skills,
      generatedBy: `RanksUp — ${new Date().toISOString().slice(0, 10)}`,
    }, null, 2);
  }

  /**
   * auth.md — kullanici adina islem yapan AI ajanlarina giris talimati.
   * Login akisini bilmeyen ajan formu brute-force parse etmeye calisir ve
   * cogu zaman vazgecer; bu dosya akisi acikca anlatir.
   */
  generateAuthMd(opts: { siteUrl: string; brandName: string; loginPath?: string }): string {
    const baseUrl = opts.siteUrl.replace(/\/$/, '');
    const login = opts.loginPath ?? '/giris';
    return `# ${opts.brandName} — AI Agent Authentication Guide

> Bu dosya, kullanıcı adına işlem yapan AI ajanları (ChatGPT Operator, Claude,
> Perplexity Assistant vb.) için giriş akışını tarif eder.

## Login

- **Login URL:** ${baseUrl}${login}
- **Yöntem:** E-posta + şifre formu
- **Alanlar:** \`email\`, \`password\`
- **Başarılı girişte:** oturum çerezi set edilir, kullanıcı paneline yönlenir.

## İki Aşamalı Doğrulama (2FA)

2FA aktifse e-posta ile tek kullanımlık kod gönderilir. Ajanlar kodu
kullanıcıdan istemelidir; otomatik atlama yolu yoktur.

## API Erişimi (önerilen)

İnsan-dışı erişim için oturum yerine API anahtarı kullanın:

- Anahtar talebi: hesap ayarları → API anahtarları
- Kullanım: \`Authorization: Bearer <API_KEY>\`

## Kurallar

- Rate limit: 60 istek/dk. Aşımda \`429\` döner — bekleyip yeniden deneyin.
- Ajanlar \`robots.txt\` kurallarına uymalıdır.
- Sorun bildirimi: ${baseUrl}/iletisim

_Üretildi: RanksUp — ${new Date().toISOString().slice(0, 10)}_
`;
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
