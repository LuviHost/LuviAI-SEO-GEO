import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CompetitorMove {
  competitor: string;
  newPost: string;
  url: string;
  ourGap: boolean;
}

/**
 * Brain'deki competitors listesinden alır, son blog yazılarını tarar.
 * RSS önce, yoksa basit HTML parse.
 */
@Injectable()
export class CompetitorService {
  private readonly log = new Logger(CompetitorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async scanCompetitors(siteId: string): Promise<CompetitorMove[]> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    if (!site.brain) return [];

    const competitors = (site.brain.competitors as any[]) ?? [];
    const moves: CompetitorMove[] = [];

    for (const c of competitors) {
      if (!c.url) continue;
      try {
        const items = await this.fetchBlogPosts(c.url);
        // Brain'in cluster slug listesinde benzer var mı?
        const ourClusters = this.extractClusterSlugs(site.brain.seoStrategy as any);

        for (const item of items.slice(0, 5)) {
          const isGap = !this.hasSimilar(item.title, ourClusters);
          if (isGap) {
            moves.push({
              competitor: c.name,
              newPost: item.title,
              url: item.link,
              ourGap: true,
            });
          }
        }
      } catch (err: any) {
        this.log.warn(`${c.name}: ${err.message}`);
      }
    }

    return moves;
  }

  private async fetchBlogPosts(competitorUrl: string): Promise<Array<{ title: string; link: string }>> {
    // RSS dene
    const rssCandidates = [
      `${competitorUrl}/rss`, `${competitorUrl}/feed`,
      `${competitorUrl}/feed/`, `${competitorUrl}/rss.xml`,
      `${competitorUrl}/blog/feed/`, `${competitorUrl}/atom.xml`,
    ];
    for (const url of rssCandidates) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const xml = await res.text();
        if (!xml.includes('<item') && !xml.includes('<entry')) continue;
        return this.parseRss(xml);
      } catch {}
    }

    // HTML fallback — blog sayfasından article başlıkları
    try {
      const res = await fetch(competitorUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return [];
      const html = await res.text();
      return this.parseHtmlForArticles(html, competitorUrl);
    } catch {
      return [];
    }
  }

  private parseRss(xml: string): Array<{ title: string; link: string }> {
    const items: any[] = [];
    const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
    for (const block of blocks.slice(0, 10)) {
      const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim();
      const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim()
        || block.match(/<link[^>]+href="([^"]+)"/i)?.[1];
      if (title && link) items.push({ title, link });
    }
    return items;
  }

  private parseHtmlForArticles(html: string, baseUrl: string): Array<{ title: string; link: string }> {
    const items: any[] = [];
    const matches = html.matchAll(/<a[^>]+href="([^"]+(?:\/blog\/|\/yazilar\/|\/makale\/|\/post\/)[^"]+)"[^>]*>([^<]{20,150})<\/a>/gi);
    for (const m of matches) {
      try {
        const link = new URL(m[1], baseUrl).href;
        const title = m[2].replace(/<[^>]+>/g, '').trim();
        if (title.length > 15 && !items.find(i => i.link === link)) items.push({ title, link });
      } catch {}
      if (items.length >= 10) break;
    }
    return items;
  }

  private extractClusterSlugs(seoStrategy: any): string[] {
    const slugs: string[] = [];
    for (const pillar of seoStrategy?.pillars ?? []) {
      for (const cluster of pillar.clusters ?? []) {
        slugs.push(typeof cluster === 'string' ? cluster : cluster.slug ?? '');
      }
    }
    return slugs.filter(Boolean);
  }

  private hasSimilar(title: string, slugs: string[]): boolean {
    const w1 = new Set(title.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    for (const slug of slugs) {
      const w2 = new Set(slug.split('-').filter(w => w.length > 3));
      const intersection = [...w1].filter(w => w2.has(w)).length;
      const union = w1.size + w2.size - intersection;
      const score = union ? intersection / union : 0;
      if (score > 0.3) return true;
    }
    return false;
  }
}
