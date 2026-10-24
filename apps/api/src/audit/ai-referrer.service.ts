import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AI_SOURCES, classifyAiVisit } from './ai-source.js';

/**
 * AI Referrer Service — ChatGPT/Perplexity/Claude'dan gelen KULLANICI trafigi.
 *
 * AI cevap kutucuklarindan link tiklayan kullanicinin ziyaretini sayar. AI bot'larindan
 * farkli — bunlar gercek satin alma niyeti olan ziyaretciler.
 *
 * Siniflandirma (referer HOST'u, yoksa inis URL'inin utm_source'u), kaynak listesi ve
 * anthropic.com karari: ./ai-source.ts (tracker.js on suzgeciyle ortak tek kaynak).
 */
@Injectable()
export class AiReferrerService {
  private readonly log = new Logger(AiReferrerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tracker beacon'dan gelen ziyareti siniflandirir + DB'ye yazar. Referer bos olabilir:
   * ChatGPT uygulamasindan gelen tiklama cogu zaman referer tasimaz, kaynak inis
   * URL'indeki utm_source=chatgpt.com'dan anlasilir.
   */
  async record(siteId: string, referer: string, url: string): Promise<{ matched: boolean }> {
    const matched = this.classify(referer, url);
    if (!matched) return { matched: false };

    const date = new Date();
    date.setHours(0, 0, 0, 0);

    try {
      const existing = await this.prisma.aiReferrerHit.findUnique({
        where: { siteId_date_referrer: { siteId, date, referrer: matched.key } },
      });
      const existingTop: any[] = existing ? (existing.topUrls as any[]) : [];
      const urlMap = new Map<string, number>();
      for (const t of existingTop) urlMap.set(t.url, t.count);
      urlMap.set(url, (urlMap.get(url) ?? 0) + 1);
      const newTop = [...urlMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([u, c]) => ({ url: u, count: c }));

      await this.prisma.aiReferrerHit.upsert({
        where: { siteId_date_referrer: { siteId, date, referrer: matched.key } },
        update: {
          hits: { increment: 1 },
          uniqueUrls: urlMap.size,
          topUrls: newTop as any,
        },
        create: {
          siteId, date, referrer: matched.key,
          hits: 1, uniqueUrls: 1,
          topUrls: [{ url, count: 1 }] as any,
        },
      });
    } catch (err: any) {
      this.log.warn(`AI referrer record fail: ${err.message}`);
    }

    return { matched: true };
  }

  classify(referer: string, landingUrl = ''): { key: string; label: string } | null {
    const m = classifyAiVisit(referer, landingUrl);
    return m ? { key: m.key, label: m.label } : null;
  }

  async getHistory(siteId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400000);
    since.setHours(0, 0, 0, 0);

    const hits = await this.prisma.aiReferrerHit.findMany({
      where: { siteId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });

    const totalHits = hits.reduce((a, h) => a + h.hits, 0);
    const byReferrer: Record<string, number> = {};
    const byDate: Record<string, Record<string, number>> = {};

    for (const h of hits) {
      byReferrer[h.referrer] = (byReferrer[h.referrer] ?? 0) + h.hits;
      const d = h.date.toISOString().slice(0, 10);
      byDate[d] = byDate[d] ?? {};
      byDate[d][h.referrer] = (byDate[d][h.referrer] ?? 0) + h.hits;
    }

    return {
      days,
      totalHits,
      byReferrer,
      byDate,
      registry: AI_SOURCES.map((r) => ({ key: r.key, label: r.label })),
    };
  }
}
