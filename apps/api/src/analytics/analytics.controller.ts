import { Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AnalyticsService } from './analytics.service.js';
import { GaService } from './ga.service.js';
import { ReportsService, type ReportOpts, type ReportRange } from './reports.service.js';

/**
 * Sorgu parametrelerini rapor donemine cevirir.
 *
 * from/to IKISI BIRDEN ve gecerli olmali; biri eksik ya da bozuksa sessizce
 * range'e duseriz — yariyla hesaplanan bir donem, kullaniciya yanlis bir
 * tarih araligi gostermekten iyidir.
 */
function donemParametresi(range?: string, from?: string, to?: string): ReportOpts {
  if (from && to) {
    const f = new Date(from);
    const t = new Date(to);
    if (!Number.isNaN(+f) && !Number.isNaN(+t) && t >= f) {
      // Bitis gunu DAHIL olsun: "1-31 Temmuz" 31 Temmuz'un tamamini kapsamali,
      // yoksa gun basinda kesilir ve son gunun verisi rapora girmez.
      t.setHours(23, 59, 59, 999);
      return { from: f, to: t };
    }
  }
  const r: ReportRange = range === 'week' || range === 'year' ? range : 'month';
  return { range: r };
}

@Controller('sites/:siteId/analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly ga: GaService,
    private readonly reports: ReportsService,
  ) {}

  /** GET /sites/:siteId/analytics/overview?days=30 */
  @Get('overview')
  overview(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.analytics.getOverview(siteId, days ? parseInt(days, 10) : 30);
  }

  /** GET /sites/:siteId/analytics/top-articles?limit=10 */
  @Get('top-articles')
  topArticles(@Param('siteId') siteId: string, @Query('limit') limit?: string) {
    return this.analytics.getTopArticles(siteId, limit ? parseInt(limit, 10) : 10);
  }

  /** GET /sites/:siteId/analytics/trending */
  @Get('trending')
  trending(@Param('siteId') siteId: string) {
    return this.analytics.getTrendingQueries(siteId);
  }

  /** GET /sites/:siteId/analytics/rankings?days=30 — GSC tabanlı keyword rank tracking */
  @Get('rankings')
  rankings(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.analytics.getRankings(siteId, days ? parseInt(days, 10) : 30);
  }

  /** GET /sites/:siteId/analytics/suggestions */
  @Get('suggestions')
  suggestions(@Param('siteId') siteId: string) {
    return this.analytics.getImprovementSuggestions(siteId);
  }

  /**
   * POST /sites/:siteId/analytics/snapshot-now?days=14
   * Manuel tetik — son N günün GSC verisini DB'ye yazar (default 14).
   * Yeni bağlanan siteler için ilk doldurma + günlük cron eksiği yakalama.
   */
  @Post('snapshot-now')
  async snapshotNow(@Param('siteId') siteId: string, @Query('days') daysStr?: string) {
    const days = daysStr ? Math.max(1, Math.min(90, parseInt(daysStr, 10))) : 14;
    return this.analytics.backfillSnapshots(siteId, days);
  }

  /** GET /sites/:siteId/analytics/ga-summary?days=30 — GA4 davranış metrikleri */
  @Get('ga-summary')
  gaSummary(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.ga.fetchSiteSummary(siteId, days ? parseInt(days, 10) : 30);
  }

  /**
   * GET /sites/:siteId/analytics/report
   *   ?range=week|month|year   — son N gun
   *   ?from=YYYY-MM-DD&to=YYYY-MM-DD — keyfi donem ("1-31 Temmuz")
   *
   * from/to birlikte verilmeli; yalniz biri verilirse range'e duseriz.
   */
  @Get('report')
  report(
    @Param('siteId') siteId: string,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.overview(siteId, donemParametresi(range, from, to));
  }

  /** GET /sites/:siteId/analytics/report.csv?range=month — Excel'e direkt acilabilir */
  @Get('report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async reportCsv(
    @Param('siteId') siteId: string,
    @Query('range') range: string | undefined,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const opts = donemParametresi(range, from, to);
    const data = await this.reports.overview(siteId, opts);
    const csv = this.reports.toCsv(data);
    const etiket = data.range === 'custom'
      ? `${data.rangeStart.slice(0, 10)}_${data.rangeEnd.slice(0, 10)}`
      : data.range;
    const filename = `ranksup-rapor-${siteId.slice(0, 8)}-${etiket}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
