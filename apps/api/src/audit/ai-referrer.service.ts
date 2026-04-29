import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * AI Referrer Service — ChatGPT/Perplexity/Claude'dan gelen KULLANICI trafigi.
 *
 * AI cevap kutucuklarindan link tıklayan kullanicinin Referer header'ini
 * kontrol eder. AI bot'larindan farkli — bunlar gercek satin alma niyeti
 * olan ziyaretciler.
 *
 * Pattern matching:
 *   - chat.openai.com / chatgpt.com         -> ChatGPT
 *   - perplexity.ai                          -> Perplexity
 *   - claude.ai                              -> Claude
 *   - bard.google.com / gemini.google.com    -> Gemini
 *   - bing.com/search?form=*COPILOT*         -> Bing Copilot
 *   - you.com                                -> You.com
 *   - phind.com                              -> Phind
 *   - poe.com                                -> Poe (ChatGPT/Claude)
 */
const REFERRER_REGISTRY: Array<{ key: string; pattern: RegExp; label: string }> = [
  { key: 'chatgpt', pattern: /chat\.openai\.com|chatgpt\.com/i, label: 'ChatGPT' },
  { key: 'perplexity', pattern: /perplexity\.ai/i, label: 'Perplexity' },
  { key: 'claude', pattern: /claude\.ai|anthropic\.com/i, label: 'Claude' },
  { key: 'gemini', pattern: /gemini\.google\.com|bard\.google\.com/i, label: 'Gemini' },
  { key: 'bing-copilot', pattern: /bing\.com.*copilot|copilot\.microsoft\.com/i, label: 'Bing Copilot' },
  { key: 'you', pattern: /you\.com/i, label: 'You.com' },
  { key: 'phind', pattern: /phind\.com/i, label: 'Phind' },
  { key: 'poe', pattern: /poe\.com/i, label: 'Poe' },
];

@Injectable()
export class AiReferrerService {
  private readonly log = new Logger(AiReferrerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tracker beacon'dan gelen referer'i sınıflandırır + DB'ye yazar.
   */
  async record(siteId: string, referer: string, url: string): Promise<{ matched: boolean }> {
    const matched = this.classify(referer);
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

  classify(referer: string): { key: string; label: string } | null {
    for (const r of REFERRER_REGISTRY) {
      if (r.pattern.test(referer)) return { key: r.key, label: r.label };
    }
    return null;
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
      registry: REFERRER_REGISTRY.map((r) => ({ key: r.key, label: r.label })),
    };
  }
}
