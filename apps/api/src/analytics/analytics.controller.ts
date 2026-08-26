import { Body, Controller, Delete, Get, Header, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AnalyticsService } from './analytics.service.js';
import { GaService } from './ga.service.js';
import { ReportsService, type ReportOpts, type ReportRange } from './reports.service.js';
import { SiteReportService } from './site-report.service.js';
import { GoogleAiSurfaceService } from './google-ai-surface.service.js';

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
    private readonly siteReports: SiteReportService,
    private readonly googleAi: GoogleAiSurfaceService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  //  GOOGLE AI YUZEYI — AI Overviews / AI Mode (GSC Generative AI raporu)
  //  Google API vermiyor; kullanici UI export'unu yukler (JSON body { csv }).
  // ──────────────────────────────────────────────────────────────

  /** POST /sites/:siteId/analytics/gsc-ai-csv/preview — parse + yanlis-dosya kontrolu, yazmaz */
  @Post('gsc-ai-csv/preview')
  previewGscAiCsv(@Param('siteId') siteId: string, @Body() body: { csv?: string }) {
    return this.googleAi.preview(siteId, body?.csv ?? '');
  }

  /** POST /sites/:siteId/analytics/gsc-ai-csv — idempotent upsert (siteId+date+surface) */
  @Post('gsc-ai-csv')
  importGscAiCsv(@Param('siteId') siteId: string, @Body() body: { csv?: string; fileName?: string }) {
    return this.googleAi.import(siteId, body?.csv ?? '', { fileName: body?.fileName });
  }

  /** GET /sites/:siteId/analytics/gsc-ai-series?days=90 */
  @Get('gsc-ai-series')
  gscAiSeries(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.googleAi.series(siteId, days ? parseInt(days, 10) : 90);
  }

  /** GET /sites/:siteId/analytics/ai-mode-queries?days=28 — sezgisel AI-Mode-suphesi sorgular */
  @Get('ai-mode-queries')
  aiModeQueries(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.googleAi.aiModeQueries(siteId, days ? parseInt(days, 10) : 28);
  }

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

  // ──────────────────────────────────────────────────────────────
  //  KALICI RAPOR — calistir / gecmis / ac / sil
  // ──────────────────────────────────────────────────────────────

  /**
   * POST /sites/:siteId/analytics/reports/run
   *   ?range=week|month|year  veya  ?from=YYYY-MM-DD&to=YYYY-MM-DD
   *
   * Raporu URETIR ve DONDURUR. Senkron: butun bolumler indeksli Prisma
   * sorgulari, dis servise gidilmiyor.
   *
   * Plan kapisi bilincli olarak YOK — audit gecmis/karsilastirma uclariyla
   * tutarli. Kendi verisini gormek plan ustu bir ozellik degil.
   */
  @Post('reports/run')
  runReport(
    @Param('siteId') siteId: string,
    @Req() req: any,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.siteReports.generate(siteId, {
      ...donemParametresi(range, from, to),
      userId: req?.user?.id,
      trigger: 'manual',
    });
  }

  /** GET /sites/:siteId/analytics/reports — gecmis (dondurulmus govde HARIC) */
  @Get('reports')
  reportHistory(@Param('siteId') siteId: string, @Query('limit') limit?: string) {
    return this.siteReports.list(siteId, limit ? parseInt(limit, 10) : 30);
  }

  /** GET /sites/:siteId/analytics/reports/:reportId — dondurulmus tam govde */
  @Get('reports/:reportId')
  reportById(@Param('siteId') siteId: string, @Param('reportId') reportId: string) {
    return this.siteReports.get(siteId, reportId);
  }

  /** GET /sites/:siteId/analytics/reports/:reportId.csv */
  @Get('reports/:reportId/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async reportByIdCsv(
    @Param('siteId') siteId: string,
    @Param('reportId') reportId: string,
    @Res() res: Response,
  ) {
    const rapor = await this.siteReports.get(siteId, reportId);
    const govde = rapor.data as any;
    // Dondurulmus govdedeki SEO bolumu ayni sekle sahip — yeniden hesaplanmaz.
    const csv = this.reports.toCsv(govde.seo);
    const etiket = rapor.periodStart.toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="ranksup-rapor-${etiket}.csv"`);
    res.send(csv);
  }

  /** DELETE /sites/:siteId/analytics/reports/:reportId */
  @Delete('reports/:reportId')
  removeReport(@Param('siteId') siteId: string, @Param('reportId') reportId: string) {
    return this.siteReports.remove(siteId, reportId);
  }
}
