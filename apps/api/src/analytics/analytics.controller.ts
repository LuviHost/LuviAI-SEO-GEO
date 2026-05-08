import { Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AnalyticsService } from './analytics.service.js';
import { GaService } from './ga.service.js';
import { ReportsService, ReportRange } from './reports.service.js';

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

  /** POST /sites/:siteId/analytics/snapshot-now (test/manuel tetik) */
  @Post('snapshot-now')
  async snapshotNow(@Param('siteId') siteId: string) {
    await this.analytics.captureSnapshot(siteId);
    return { ok: true };
  }

  /** GET /sites/:siteId/analytics/ga-summary?days=30 — GA4 davranış metrikleri */
  @Get('ga-summary')
  gaSummary(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.ga.fetchSiteSummary(siteId, days ? parseInt(days, 10) : 30);
  }

  /** GET /sites/:siteId/analytics/report?range=week|month|year — kapsamli rapor */
  @Get('report')
  report(
    @Param('siteId') siteId: string,
    @Query('range') range?: string,
  ) {
    const r: ReportRange = (range === 'week' || range === 'year') ? range : 'month';
    return this.reports.overview(siteId, r);
  }

  /** GET /sites/:siteId/analytics/report.csv?range=month — Excel'e direkt acilabilir */
  @Get('report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async reportCsv(
    @Param('siteId') siteId: string,
    @Query('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const r: ReportRange = (range === 'week' || range === 'year') ? range : 'month';
    const data = await this.reports.overview(siteId, r);
    const csv = this.reports.toCsv(data);
    const filename = `luviai-report-${siteId.slice(0, 8)}-${r}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
