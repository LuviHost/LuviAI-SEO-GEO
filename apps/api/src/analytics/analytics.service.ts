import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

@Injectable()
export class AnalyticsService {
  private readonly log = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gscOAuth: GscOAuthService,
  ) {}

  // ─────────────────────────────────────────────
  //  Daily snapshot — cron task çağırır
  // ─────────────────────────────────────────────

  async captureSnapshot(siteId: string, date?: Date, opts?: { silent?: boolean }): Promise<void> {
    const targetDate = date ?? this.yesterday();
    const dateStr = targetDate.toISOString().slice(0, 10);

    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.gscPropertyUrl || !site.gscRefreshToken) {
      if (opts?.silent) {
        this.log.log(`[${siteId}] GSC bağlı değil — snapshot atlandı`);
        return;
      }
      throw new BadRequestException(
        'Bu site Google Search Console hesabına bağlı değil. Önce ayarlardan GSC bağlamalısın.',
      );
    }

    const client = await this.gscOAuth.getAuthenticatedClient(siteId);
    if (!client) return;

    const webmasters = google.webmasters({ version: 'v3', auth: client as any });

    try {
      // Page-level top 50
      const pageRes = await webmasters.searchanalytics.query({
        siteUrl: site.gscPropertyUrl,
        requestBody: {
          startDate: dateStr,
          endDate: dateStr,
          dimensions: ['page'],
          rowLimit: 50,
        },
      });

      // Query-level top 100
      const queryRes = await webmasters.searchanalytics.query({
        siteUrl: site.gscPropertyUrl,
        requestBody: {
          startDate: dateStr,
          endDate: dateStr,
          dimensions: ['query', 'page'],
          rowLimit: 100,
        },
      });

      const pageRows: GscRow[] = (pageRes.data.rows ?? []) as any;
      const queryRows: GscRow[] = (queryRes.data.rows ?? []) as any;

      const totalClicks = pageRows.reduce((s, r) => s + (r.clicks ?? 0), 0);
      const totalImpressions = pageRows.reduce((s, r) => s + (r.impressions ?? 0), 0);
      const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
      const avgPosition = pageRows.length > 0
        ? pageRows.reduce((s, r) => s + (r.position ?? 0), 0) / pageRows.length
        : 0;

      await this.prisma.analyticsSnapshot.upsert({
        where: { siteId_date: { siteId, date: targetDate } },
        create: {
          siteId,
          date: targetDate,
          totalClicks,
          totalImpressions,
          avgCtr,
          avgPosition,
          pageDetails: pageRows.map(r => ({
            page: r.keys?.[0],
            clicks: r.clicks ?? 0,
            impressions: r.impressions ?? 0,
            ctr: r.ctr ?? 0,
            position: r.position ?? 0,
          })) as any,
          queryDetails: queryRows.map(r => ({
            query: r.keys?.[0],
            page: r.keys?.[1],
            clicks: r.clicks ?? 0,
            impressions: r.impressions ?? 0,
            ctr: r.ctr ?? 0,
            position: r.position ?? 0,
          })) as any,
        },
        update: {
          totalClicks,
          totalImpressions,
          avgCtr,
          avgPosition,
          pageDetails: pageRows as any,
          queryDetails: queryRows as any,
        },
      });

      // Article performansı update
      await this.updateArticleMetrics(siteId, pageRows);

      this.log.log(`[${siteId}] Snapshot ${dateStr}: ${totalClicks} clicks, ${totalImpressions} imp, pos ${avgPosition.toFixed(1)}`);
    } catch (err: any) {
      this.log.error(`[${siteId}] Snapshot error: ${err.message}`);
    }
  }

  /** Page URL'den slug çıkartıp Article.performanceMetrics güncelle */
  private async updateArticleMetrics(siteId: string, pageRows: GscRow[]) {
    const articles = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' },
      select: { id: true, slug: true },
    });
    const slugMap = new Map(articles.map(a => [a.slug, a.id]));

    for (const row of pageRows) {
      const url = row.keys?.[0];
      if (!url) continue;
      try {
        const path = new URL(url).pathname;
        const slug = path.split('/').filter(Boolean).pop();
        if (!slug) continue;
        const articleId = slugMap.get(slug);
        if (!articleId) continue;

        await this.prisma.article.update({
          where: { id: articleId },
          data: {
            performanceCheckedAt: new Date(),
            performanceMetrics: {
              clicks: row.clicks ?? 0,
              impressions: row.impressions ?? 0,
              ctr: row.ctr ?? 0,
              position: row.position ?? 0,
              lastUpdated: new Date().toISOString(),
            },
          },
        });
      } catch {}
    }
  }

  // ─────────────────────────────────────────────
  //  Site overview (last 30 days)
  // ─────────────────────────────────────────────

  async getOverview(siteId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400000);
    const snapshots = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });

    const totals = snapshots.reduce(
      (acc, s) => ({
        clicks: acc.clicks + s.totalClicks,
        impressions: acc.impressions + s.totalImpressions,
      }),
      { clicks: 0, impressions: 0 },
    );

    return {
      totals: {
        ...totals,
        avgCtr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
        avgPosition:
          snapshots.length > 0
            ? snapshots.reduce((s, x) => s + x.avgPosition, 0) / snapshots.length
            : 0,
      },
      timeSeries: snapshots.map(s => ({
        date: s.date.toISOString().slice(0, 10),
        clicks: s.totalClicks,
        impressions: s.totalImpressions,
        ctr: s.avgCtr,
        position: s.avgPosition,
      })),
      latestSnapshot: snapshots[snapshots.length - 1] ?? null,
    };
  }

  // ─────────────────────────────────────────────
  //  Top articles by performance
  // ─────────────────────────────────────────────

  async getTopArticles(siteId: string, limit = 10) {
    const articles = await this.prisma.article.findMany({
      where: {
        siteId,
        status: 'PUBLISHED',
        performanceMetrics: { not: null as any },
      },
      orderBy: { publishedAt: 'desc' },
      take: 100,
    });

    return articles
      .map(a => {
        const m = (a.performanceMetrics as any) ?? {};
        return {
          id: a.id,
          slug: a.slug,
          title: a.title,
          publishedAt: a.publishedAt,
          clicks: m.clicks ?? 0,
          impressions: m.impressions ?? 0,
          ctr: m.ctr ?? 0,
          position: m.position ?? 0,
        };
      })
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, limit);
  }

  // ─────────────────────────────────────────────
  //  Trending queries (last 7 vs prev 7)
  // ─────────────────────────────────────────────

  async getTrendingQueries(siteId: string) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);

    const recent = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { gte: sevenDaysAgo, lt: now } },
    });
    const previous = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
    });

    const recentTotals = this.aggregateQueries(recent);
    const previousTotals = this.aggregateQueries(previous);

    const trending: any[] = [];
    for (const [query, recentImp] of recentTotals) {
      const prevImp = previousTotals.get(query) ?? 0;
      if (recentImp < 50) continue;
      const growth = prevImp > 0 ? ((recentImp - prevImp) / prevImp) * 100 : 100;
      if (growth >= 30) {
        trending.push({ query, recentImp, prevImp, growthPct: Math.round(growth) });
      }
    }

    return trending.sort((a, b) => b.growthPct - a.growthPct).slice(0, 10);
  }

  private aggregateQueries(snapshots: any[]): Map<string, number> {
    const totals = new Map<string, number>();
    for (const s of snapshots) {
      const queries = (s.queryDetails as any[]) ?? [];
      for (const q of queries) {
        if (!q.query) continue;
        totals.set(q.query, (totals.get(q.query) ?? 0) + (q.impressions ?? 0));
      }
    }
    return totals;
  }

  // ─────────────────────────────────────────────
  //  Improvement suggestions (low-CTR + near-miss)
  // ─────────────────────────────────────────────

  async getImprovementSuggestions(siteId: string) {
    const lastSnap = await this.prisma.analyticsSnapshot.findFirst({
      where: { siteId },
      orderBy: { date: 'desc' },
    });
    if (!lastSnap) return [];

    const queries = (lastSnap.queryDetails as any[]) ?? [];
    const suggestions: any[] = [];

    for (const q of queries) {
      // Near-miss: position 4-15, impressions > 100, clicks < 5
      if (q.position >= 4 && q.position <= 15 && q.impressions > 100 && q.clicks < 5) {
        suggestions.push({
          type: 'near-miss',
          query: q.query,
          page: q.page,
          impressions: q.impressions,
          position: q.position,
          recommendation: 'İlk sayfaya yakın, içerik güçlendirilirse ilk 3\'e çıkabilir',
        });
      }
      // Low-CTR: clicks > 0, ctr < 2%, impressions > 100
      else if (q.clicks > 0 && q.ctr < 0.02 && q.impressions > 100) {
        suggestions.push({
          type: 'low-ctr',
          query: q.query,
          page: q.page,
          ctr: q.ctr,
          impressions: q.impressions,
          recommendation: 'Meta title/description yeniden yazılmalı — düşük CTR',
        });
      }
    }

    return suggestions.slice(0, 20);
  }

  // ─────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────

  private yesterday(): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
