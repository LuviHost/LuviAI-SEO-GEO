import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type ReportRange = 'week' | 'month' | 'year';

export interface ReportOverview {
  range: ReportRange;
  rangeStart: string;
  rangeEnd: string;
  prevStart: string;
  prevEnd: string;
  // Top-line metrikleri
  articles: {
    published: number;
    publishedDelta: number; // onceki donem ile fark
    scheduled: number;
    failed: number;
    avgEditorScore: number | null;
    totalCost: number; // USD
  };
  social: {
    posts: number;
    postsDelta: number;
    byChannel: Record<string, number>;
  };
  search: {
    totalClicks: number;
    totalImpressions: number;
    avgCtr: number;
    avgPosition: number;
    clicksDelta: number;
    impressionsDelta: number;
    topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
    topPages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>;
  };
  ai: {
    citationScore: number | null; // son audit'ten ortalama
    providers: Array<{ provider: string; label: string; score: number | null; available: boolean }>;
  };
  audit: {
    overallScore: number | null;
    geoScore: number | null;
    issuesCount: number;
    fixedThisRange: number; // bu donemde dusurulen issue sayisi (audit history)
  };
  // Zaman serisi (gunluk)
  timeSeries: {
    dates: string[]; // ISO date YYYY-MM-DD
    publishedArticles: number[];
    socialPosts: number[];
    clicks: number[];
    impressions: number[];
  };
}

@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async overview(siteId: string, range: ReportRange = 'month'): Promise<ReportOverview> {
    const now = new Date();
    const days = range === 'week' ? 7 : range === 'month' ? 30 : 365;

    const rangeStart = new Date(now.getTime() - days * 86400000);
    const prevEnd = new Date(rangeStart);
    const prevStart = new Date(rangeStart.getTime() - days * 86400000);

    // ── Articles ───────────────────────────────────────────────
    const [publishedArticles, prevPublished, scheduled, failed, articleStats] = await Promise.all([
      this.prisma.article.findMany({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: rangeStart, lte: now } },
        select: { id: true, publishedAt: true, totalCost: true, editorScore: true },
      }),
      this.prisma.article.count({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: prevStart, lte: prevEnd } },
      }),
      this.prisma.article.count({ where: { siteId, status: 'SCHEDULED' as any } }),
      this.prisma.article.count({
        where: { siteId, status: 'FAILED' as any, updatedAt: { gte: rangeStart, lte: now } },
      }),
      this.prisma.article.aggregate({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: rangeStart, lte: now } },
        _avg: { editorScore: true, totalCost: true },
        _sum: { totalCost: true },
      }),
    ]);

    // ── Social posts ───────────────────────────────────────────
    const socialPosts = await this.prisma.socialPost.findMany({
      where: {
        article: { siteId },
        status: 'PUBLISHED' as any,
        publishedAt: { gte: rangeStart, lte: now },
      },
      select: { channel: true },
    });
    const prevSocialCount = await this.prisma.socialPost.count({
      where: {
        article: { siteId },
        status: 'PUBLISHED' as any,
        publishedAt: { gte: prevStart, lte: prevEnd },
      },
    });
    const byChannel: Record<string, number> = {};
    for (const p of socialPosts) byChannel[p.channel] = (byChannel[p.channel] ?? 0) + 1;

    // ── GSC analytics ──────────────────────────────────────────
    const snapshots = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { gte: rangeStart, lte: now } },
      orderBy: { date: 'asc' },
    });
    const prevSnapshots = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { gte: prevStart, lte: prevEnd } },
    });

    const totalClicks = snapshots.reduce((a, s) => a + s.totalClicks, 0);
    const totalImpressions = snapshots.reduce((a, s) => a + s.totalImpressions, 0);
    const avgCtr = snapshots.length > 0 ? snapshots.reduce((a, s) => a + s.avgCtr, 0) / snapshots.length : 0;
    const avgPosition = snapshots.length > 0 ? snapshots.reduce((a, s) => a + s.avgPosition, 0) / snapshots.length : 0;
    const prevClicks = prevSnapshots.reduce((a, s) => a + s.totalClicks, 0);
    const prevImpressions = prevSnapshots.reduce((a, s) => a + s.totalImpressions, 0);

    // Top queries / pages — son snapshot'tan al
    const lastSnapshot = snapshots[snapshots.length - 1];
    const topQueries = Array.isArray(lastSnapshot?.queryDetails)
      ? (lastSnapshot.queryDetails as any[]).slice(0, 10)
      : [];
    const topPages = Array.isArray(lastSnapshot?.pageDetails)
      ? (lastSnapshot.pageDetails as any[]).slice(0, 10)
      : [];

    // ── AI citation + audit ────────────────────────────────────
    const lastAudit = await this.prisma.audit.findFirst({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
    });
    const aiCitations = (lastAudit?.checks as any)?.aiCitations;
    const providers = aiCitations?.providers ?? [];

    const auditsInRange = await this.prisma.audit.findMany({
      where: { siteId, ranAt: { gte: rangeStart, lte: now } },
      orderBy: { ranAt: 'asc' },
      select: { issues: true, ranAt: true },
    });
    const firstIssuesCount = Array.isArray(auditsInRange[0]?.issues) ? (auditsInRange[0].issues as any[]).length : 0;
    const lastIssuesCount = Array.isArray(lastAudit?.issues) ? (lastAudit!.issues as any[]).length : 0;
    const fixedThisRange = Math.max(0, firstIssuesCount - lastIssuesCount);

    // ── Zaman serisi (gunluk) ──────────────────────────────────
    const dates: string[] = [];
    const publishedSeries: number[] = [];
    const socialSeries: number[] = [];
    const clicksSeries: number[] = [];
    const impressionsSeries: number[] = [];

    // Bucket: gunluk
    const bucketSize = range === 'year' ? 7 : 1; // yillik raporda haftalik bucket
    for (let i = 0; i < days; i += bucketSize) {
      const dStart = new Date(rangeStart.getTime() + i * 86400000);
      const dEnd = new Date(dStart.getTime() + bucketSize * 86400000);
      dates.push(dStart.toISOString().slice(0, 10));

      publishedSeries.push(
        publishedArticles.filter((a) => a.publishedAt && a.publishedAt >= dStart && a.publishedAt < dEnd).length,
      );
      socialSeries.push(
        socialPosts.filter((p: any) => p.publishedAt >= dStart && p.publishedAt < dEnd).length,
      );
      const bucketSnapshots = snapshots.filter((s) => s.date >= dStart && s.date < dEnd);
      clicksSeries.push(bucketSnapshots.reduce((a, s) => a + s.totalClicks, 0));
      impressionsSeries.push(bucketSnapshots.reduce((a, s) => a + s.totalImpressions, 0));
    }

    return {
      range,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: now.toISOString(),
      prevStart: prevStart.toISOString(),
      prevEnd: prevEnd.toISOString(),
      articles: {
        published: publishedArticles.length,
        publishedDelta: publishedArticles.length - prevPublished,
        scheduled,
        failed,
        avgEditorScore: articleStats._avg.editorScore,
        totalCost: Number(articleStats._sum.totalCost ?? 0),
      },
      social: {
        posts: socialPosts.length,
        postsDelta: socialPosts.length - prevSocialCount,
        byChannel,
      },
      search: {
        totalClicks,
        totalImpressions,
        avgCtr,
        avgPosition,
        clicksDelta: totalClicks - prevClicks,
        impressionsDelta: totalImpressions - prevImpressions,
        topQueries,
        topPages,
      },
      ai: {
        citationScore: aiCitations?.score ?? null,
        providers: providers.map((p: any) => ({
          provider: p.provider, label: p.label, score: p.score, available: p.available,
        })),
      },
      audit: {
        overallScore: lastAudit?.overallScore ?? null,
        geoScore: lastAudit?.geoScore ?? null,
        issuesCount: lastIssuesCount,
        fixedThisRange,
      },
      timeSeries: {
        dates,
        publishedArticles: publishedSeries,
        socialPosts: socialSeries,
        clicks: clicksSeries,
        impressions: impressionsSeries,
      },
    };
  }

  /**
   * CSV formatinda zaman serisi export — Excel'e direkt acilir.
   */
  toCsv(report: ReportOverview): string {
    const headers = ['date', 'publishedArticles', 'socialPosts', 'clicks', 'impressions'];
    const lines = [headers.join(',')];
    for (let i = 0; i < report.timeSeries.dates.length; i++) {
      lines.push([
        report.timeSeries.dates[i],
        report.timeSeries.publishedArticles[i],
        report.timeSeries.socialPosts[i],
        report.timeSeries.clicks[i],
        report.timeSeries.impressions[i],
      ].join(','));
    }
    lines.push('');
    lines.push('# Ozet');
    lines.push(`articles_published,${report.articles.published}`);
    lines.push(`articles_scheduled,${report.articles.scheduled}`);
    lines.push(`articles_failed,${report.articles.failed}`);
    lines.push(`total_clicks,${report.search.totalClicks}`);
    lines.push(`total_impressions,${report.search.totalImpressions}`);
    lines.push(`avg_ctr,${(report.search.avgCtr * 100).toFixed(2)}%`);
    lines.push(`avg_position,${report.search.avgPosition.toFixed(1)}`);
    lines.push(`audit_score,${report.audit.overallScore ?? '-'}`);
    lines.push(`geo_score,${report.audit.geoScore ?? '-'}`);
    lines.push(`ai_citation_score,${report.ai.citationScore ?? '-'}`);
    lines.push(`total_cost_usd,${report.articles.totalCost.toFixed(2)}`);
    return lines.join('\n');
  }
}
