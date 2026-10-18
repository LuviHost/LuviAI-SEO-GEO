import { Injectable } from '@nestjs/common';
import type { CrawlResult } from '../sites/site-crawler.service.js';

/**
 * auth.md ELLE KULLANIM sablonu (saf) — otomatik yayinlanmaz.
 *
 * NEDEN: eski generateAuthMd musterinin sitesine uydurma bilgi yayinliyordu
 * (varsayilan '/giris', e-posta+sifre alanlari, e-posta 2FA, API anahtari,
 * "60 istek/dk"). auth.md aslinda API'si olan servisler icin bir ajan kayit
 * protokolu (WorkOS; kesif → kayit → onay → token → kullanim → iptal):
 *   https://github.com/workos/auth.md
 *   https://zuplo.com/blog/auth-md-agent-signup
 * Bu sablon o adim yapisini izler; bilinmeyen her deger acik <YER_TUTUCU>.
 * Ajanlarin okudugu dosya oldugu icin govde protokol ornegi gibi Ingilizce.
 */
export function authMdTemplate(brandName: string): string {
  const brand = brandName.trim() || '<BRAND_NAME>';
  return `<!-- RanksUp şablonu: <...> ile gösterilen her değeri kendi API bilgilerinle değiştir; desteklemediğin adımı sil. Doldurmadan yayınlama. -->
# ${brand} — auth.md

This file tells AI agents how to obtain and use credentials for the ${brand} API,
following the auth.md protocol (https://github.com/workos/auth.md).

## 1. Discover

- Protected resource metadata: <PROTECTED_RESOURCE_METADATA_URL>
- Authorization server metadata (contains the \`agent_auth\` block): <AUTHORIZATION_SERVER_METADATA_URL>

## 2. Register

- Endpoint: \`POST <IDENTITY_ENDPOINT>\`
- Supported identity types: <IDENTITY_TYPES_SUPPORTED>

## 3. Claim (user confirmation)

- Endpoint: \`POST <CLAIM_ENDPOINT>\`
- How the user confirms: <USER_CONFIRMATION_STEPS>

## 4. Exchange

- Token endpoint: \`POST <TOKEN_ENDPOINT>\`
- Grant type: <GRANT_TYPE>

## 5. Use

- Send \`Authorization: Bearer <ACCESS_TOKEN>\`
- Scopes: <SCOPES>
- Rate limits: <RATE_LIMITS>

## 6. Revocation

- Revocation endpoint: <REVOCATION_ENDPOINT>
- Events endpoint: <EVENTS_ENDPOINT>

## Support

<SUPPORT_CONTACT>
`;
}

/**
 * Kok dosya uretecileri — sitemap.xml ve llms.txt. Uretilen icerik AutoFixService
 * onizlemesinden gecer; var olan dosyanin uzerine yazma kararini o verir.
 *
 * KALDIRILANLAR (2026-10): generateRobotsTxt musterinin robots.txt'sinin
 * uzerine yaziyordu — yerini robots-merge.ts'teki guvenli ekleme aldi.
 * generateAgentJson A2A ucu olmayan sitelere v0.2 yoluna v0.3 karti
 * (preferredTransport 'none') yayinliyordu — ajanlari yaniltir, kaldirildi.
 */
@Injectable()
export class GeneratorsService {
  /**
   * sitemap.xml — taranan sayfalardan, yalniz <loc>.
   * lastmod YAZILMAZ: gercek degisiklik tarihini bilmiyoruz; her URL'ye "bugun"
   * yazmak yanlis veri. Google lastmod'u yalniz "tutarli ve dogrulanabilir
   * sekilde dogruysa" kullanir, priority/changefreq'i yok sayar; Bing de
   * uretim zamanini lastmod yapmamayi soyler:
   *   https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
   *   https://blogs.bing.com/webmaster/July-2025/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search
   * Canonical'i baska adresi gosteren sayfa listeye girmez.
   */
  generateSitemap(crawl: CrawlResult): string {
    const origin = safeOrigin(crawl.baseUrl);
    const seen = new Set<string>();
    const locs: string[] = [];
    for (const p of crawl.pages) {
      if (!origin || safeOrigin(p.url) !== origin) continue;
      const key = normalizeForCompare(p.url);
      if (p.canonical && normalizeForCompare(p.canonical, p.url) !== key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      locs.push(p.url);
    }
    const today = new Date().toISOString().slice(0, 10);
    const urls = locs.map((u) => `  <url><loc>${this.escapeXml(u)}</loc></url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- RanksUp: ${today} tarihinde taranan ${locs.length} sayfadan uretildi. Gercek degisiklik tarihleri bilinmedigi icin lastmod yazilmadi. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  }

  /** auth.md elle kullanim sablonu — artik otomatik yayinlanmaz (bkz. authMdTemplate) */
  generateAuthMd(opts: { siteUrl: string; brandName: string }): string {
    return authMdTemplate(opts.brandName);
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

function safeOrigin(raw: string): string | null {
  try { return new URL(raw).origin; } catch { return null; }
}

/** Karsilastirma anahtari: hash yok, sondaki slash yok (kok haric) */
function normalizeForCompare(raw: string, base?: string): string {
  try {
    const u = new URL(raw, base);
    u.hash = '';
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return raw;
  }
}
