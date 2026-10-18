import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AsoScrapersService } from './scrapers.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import {
  IOS_REVIEW_PAGE_SIZE,
  RECENT_REVIEW_WINDOW_DAYS,
  buildFetchRecord,
  parseFetchRecord,
  reviewFetchKey,
  summarizeRecentReviews,
  type RecentReviewSignal,
  type ReviewStore,
} from './recent-reviews.js';

/**
 * App review fetch + LLM sentiment analizi.
 * RanksUp'ın LLM altyapısını kullanır (multi-provider BYOK).
 */
@Injectable()
export class AsoReviewsService {
  private readonly log = new Logger(AsoReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scrapers: AsoScrapersService,
    private readonly llm: LLMProviderService,
  ) {}

  /**
   * Tracked app için son N review'ı çek + DB'ye yaz + sentiment analizi yap.
   */
  async fetchAndAnalyze(trackedAppId: string, opts?: { limit?: number; analyzeSentiment?: boolean }) {
    const limit = opts?.limit ?? 50;
    const analyzeSentiment = opts?.analyzeSentiment ?? true;

    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: trackedAppId },
    });

    let total = 0;
    const newReviews: any[] = [];

    // iOS
    if (app.appStoreId) {
      const ios = await this.scrapers.iosReviews({
        id: app.appStoreId,
        country: app.country,
        page: 1,
      });
      const iosBatch = ios.slice(0, limit);
      // RSS ilk sayfasi en fazla 50 yorum verir; "son 30 gun" sayiminin tam mi alt sinir mi oldugu bu tavana gore anlasilir
      await this.recordFetch(trackedAppId, 'IOS', iosBatch.map((r: any) => r.updated), Math.min(limit, IOS_REVIEW_PAGE_SIZE));
      for (const r of iosBatch) {
        const created = await this.prisma.appReview.upsert({
          where: {
            trackedAppId_store_externalId: {
              trackedAppId,
              store: 'IOS',
              externalId: String(r.id ?? r.userName + r.date),
            },
          },
          create: {
            trackedAppId,
            store: 'IOS',
            externalId: String(r.id ?? r.userName + r.date),
            rating: r.score ?? r.rating ?? 0,
            title: r.title ?? null,
            text: r.text ?? '',
            author: r.userName ?? null,
            reviewDate: r.updated ? new Date(r.updated) : null,
          },
          update: {},
        });
        if (created.sentiment == null) newReviews.push(created);
        total++;
      }
    }

    // Android
    if (app.playStoreId) {
      const android = await this.scrapers.androidReviews({
        appId: app.playStoreId,
        country: app.country,
        num: limit,
      });
      const androidBatch = android.slice(0, limit);
      await this.recordFetch(trackedAppId, 'ANDROID', androidBatch.map((r: any) => r.date), limit);
      for (const r of androidBatch) {
        const created = await this.prisma.appReview.upsert({
          where: {
            trackedAppId_store_externalId: {
              trackedAppId,
              store: 'ANDROID',
              externalId: String(r.id ?? Math.random()),
            },
          },
          create: {
            trackedAppId,
            store: 'ANDROID',
            externalId: String(r.id ?? Math.random()),
            rating: r.score ?? 0,
            text: r.text ?? '',
            author: r.userName ?? null,
            reviewDate: r.date ? new Date(r.date) : null,
          },
          update: {},
        });
        if (created.sentiment == null) newReviews.push(created);
        total++;
      }
    }

    // Sentiment analizi (sadece yeni review'lar)
    if (analyzeSentiment && newReviews.length > 0) {
      this.log.log(`Analyzing sentiment for ${newReviews.length} new reviews`);
      // Batch'le, 10 review tek prompt
      for (let i = 0; i < newReviews.length; i += 10) {
        const batch = newReviews.slice(i, i + 10);
        try {
          await this.analyzeBatch(batch);
        } catch (err: any) {
          this.log.warn(`Sentiment batch error: ${err.message}`);
        }
      }
    }

    return { total, newCount: newReviews.length };
  }

  /** 10 review için batch sentiment analizi. */
  private async analyzeBatch(reviews: any[]) {
    const prompt = `Aşağıdaki app store review'larını analiz et. Her biri için JSON dön:
- "sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE"
- "topics": string[] (en fazla 3 etiket — örn: "bug", "ui", "fiyat", "performans", "destek", "özellik-talep")

Response formatı:
[
  { "id": "review_id", "sentiment": "...", "topics": [...] },
  ...
]

Reviews:
${reviews.map(r => `[${r.id}] (${r.rating}/5) "${r.text.slice(0, 300)}"`).join('\n\n')}`;

    let analyzed: Array<{ id: string; sentiment: string; topics: string[] }> = [];
    try {
      const response = await this.llm.chat({
        context: 'aso-review-sentiment',
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 1500,
      });

      const text = response.output ?? '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        analyzed = JSON.parse(jsonMatch[0]);
      }
    } catch (err: any) {
      this.log.warn(`LLM sentiment error: ${err.message}`);
      return;
    }

    for (const a of analyzed) {
      try {
        await this.prisma.appReview.update({
          where: { id: a.id },
          data: {
            sentiment: ['POSITIVE', 'NEUTRAL', 'NEGATIVE'].includes(a.sentiment) ? (a.sentiment as any) : 'NEUTRAL',
            topics: (a.topics ?? []) as any,
          },
        });
      } catch {
        // ignore individual failure
      }
    }
  }

  /** Son cekimin ozeti KvStore'a; yazilamazsa yorum cekimi yine basarili sayilir. */
  private async recordFetch(trackedAppId: string, store: ReviewStore, dates: Array<string | Date | null | undefined>, cap: number) {
    const record = buildFetchRecord(dates, cap, new Date());
    if (!record) return;
    const key = reviewFetchKey(trackedAppId, store);
    const value = JSON.stringify(record);
    await this.prisma.kvStore
      .upsert({ where: { key }, create: { key, value }, update: { value } })
      .catch((err: any) => this.log.warn(`[${trackedAppId}] yorum cekim kaydi yazilamadi: ${err.message}`));
  }

  /**
   * ASO skorunun "son 30 gundeki yorum sayisi" bileseni — saklanan yorumlardan.
   * Bagli her magaza ayri degerlendirilir; kurallar recent-reviews.ts'te.
   */
  async getRecentReviewSignal(trackedAppId: string, now: Date = new Date()): Promise<RecentReviewSignal> {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: trackedAppId },
      select: { appStoreId: true, playStoreId: true },
    });
    const stores: ReviewStore[] = [
      ...(app.appStoreId ? (['IOS'] as const) : []),
      ...(app.playStoreId ? (['ANDROID'] as const) : []),
    ];
    const since = new Date(now.getTime() - RECENT_REVIEW_WINDOW_DAYS * 86_400_000);
    const stats = await Promise.all(
      stores.map(async (store) => {
        const where = { trackedAppId, store };
        const [storedTotal, storedDated, inWindow, agg, kv] = await Promise.all([
          this.prisma.appReview.count({ where }),
          this.prisma.appReview.count({ where: { ...where, reviewDate: { not: null } } }),
          this.prisma.appReview.count({ where: { ...where, reviewDate: { gte: since, lte: now } } }),
          this.prisma.appReview.aggregate({ where, _min: { reviewDate: true }, _max: { fetchedAt: true } }),
          this.prisma.kvStore.findUnique({ where: { key: reviewFetchKey(trackedAppId, store) } }).catch(() => null),
        ]);
        return {
          store,
          storedTotal,
          storedDated,
          inWindow,
          oldestStored: agg._min.reviewDate ?? null,
          latestFetchedAt: agg._max.fetchedAt ?? null,
          lastFetch: parseFetchRecord(kv?.value),
        };
      }),
    );
    return summarizeRecentReviews(stats, now);
  }

  /** App için review özet istatistikleri. */
  async getReviewStats(trackedAppId: string) {
    const grouped = await this.prisma.appReview.groupBy({
      by: ['store', 'sentiment'],
      where: { trackedAppId },
      _count: true,
      _avg: { rating: true },
    });

    const recentReviews = await this.prisma.appReview.findMany({
      where: { trackedAppId },
      orderBy: { reviewDate: 'desc' },
      take: 20,
    });

    return { grouped, recentReviews };
  }
}
