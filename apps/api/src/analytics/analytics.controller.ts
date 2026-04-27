import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';

@Controller('sites/:siteId/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

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
}
