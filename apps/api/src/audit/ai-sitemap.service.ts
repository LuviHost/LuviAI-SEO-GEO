import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * AI Sitemap (sitemap-ai.xml) — standart sitemap'ten ayri, AI search engines
 * icin optimize edilmis sitemap.
 *
 * Ozellikler:
 *   - Custom <ai:summary> namespace (her URL icin 200 kelimelik AI ozet)
 *   - <ai:topics> (AEO/GEO sorulari)
 *   - <priority> AI alintilanma skoruna gore (yuksek alintilananlar one)
 *   - <changefreq> tier-1 makalelere daily, kalanlarina weekly
 */
@Injectable()
export class AiSitemapService {
  private readonly log = new Logger(AiSitemapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async build(siteId: string): Promise<{ xml: string; bytes: number; urls: number }> {
    const siteRaw = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const site: any = siteRaw;
    const baseUrl = site.url.replace(/\/+$/, '');

    const articles = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any },
      orderBy: { publishedAt: 'desc' },
      take: 1000,
    });

    const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:ai="https://luvihost.com.tr/schemas/ai-sitemap"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
`;

    // Anasayfa
    xml += `  <url>
    <loc>${xmlEsc(baseUrl)}/</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <ai:summary>${xmlEsc(site.name + (site.niche ? ` — ${site.niche} alanında hizmet veren Türkiye merkezli platform.` : '.'))}</ai:summary>
  </url>
`;

    for (const a of articles) {
      const url = `${baseUrl}/blog/${a.slug}.html`;
      const lastmod = (a.publishedAt ?? a.createdAt).toISOString().slice(0, 10);
      const summary = (a.metaDescription ?? '').slice(0, 200);
      const fm: any = a.frontmatter ?? {};
      const aeoQueries: string[] = Array.isArray(fm.aeo_queries) ? fm.aeo_queries : [];
      const editorScore = a.editorScore ?? 50;
      // Editor skoru 50/60 = 0.83 → 0.5 + (skor/60)*0.5
      const priority = Math.min(0.9, 0.4 + (editorScore / 60) * 0.5).toFixed(1);
      const changefreq = (a.publishedAt && Date.now() - a.publishedAt.getTime() < 30 * 86400000) ? 'daily' : 'weekly';

      xml += `  <url>
    <loc>${xmlEsc(url)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
    <ai:summary>${xmlEsc(summary)}</ai:summary>
`;
      if (aeoQueries.length > 0) {
        xml += `    <ai:topics>\n`;
        for (const q of aeoQueries.slice(0, 5)) {
          xml += `      <ai:topic>${xmlEsc(q)}</ai:topic>\n`;
        }
        xml += `    </ai:topics>\n`;
      }
      if (a.heroImageUrl) {
        xml += `    <image:image><image:loc>${xmlEsc(a.heroImageUrl)}</image:loc><image:title>${xmlEsc(a.title)}</image:title></image:image>\n`;
      }
      xml += `  </url>\n`;
    }

    xml += `</urlset>\n`;

    return { xml, bytes: Buffer.byteLength(xml, 'utf8'), urls: articles.length + 1 };
  }
}
