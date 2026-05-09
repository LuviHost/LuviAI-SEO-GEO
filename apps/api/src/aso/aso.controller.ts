import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AsoService } from './aso.service.js';
import { AppStore, KeywordSource } from '@prisma/client';

@Controller('sites/:siteId/aso')
export class AsoController {
  constructor(private readonly aso: AsoService) {}

  // ─── Search ─────────────────────────────────

  /**
   * GET /sites/:siteId/aso/search?term=spotify&store=BOTH&country=tr
   * Hem name search hem URL paste destekler.
   */
  @Get('search')
  searchApps(
    @Query('term') term: string,
    @Query('store') store?: 'IOS' | 'ANDROID' | 'BOTH',
    @Query('country') country?: string,
  ) {
    return this.aso.searchApps({ term, store, country });
  }

  // ─── Apps ───────────────────────────────────

  @Get('apps')
  listApps(@Param('siteId') siteId: string) {
    return this.aso.listApps(siteId);
  }

  @Post('apps')
  connectApp(
    @Param('siteId') siteId: string,
    @Body() body: { appStoreId?: string; playStoreId?: string; country?: string },
  ) {
    return this.aso.connectApp({ siteId, ...body });
  }

  @Get('apps/:appId')
  getApp(@Param('appId') appId: string) {
    return this.aso.getApp(appId);
  }

  @Delete('apps/:appId')
  deleteApp(@Param('appId') appId: string) {
    return this.aso.deleteApp(appId);
  }

  @Post('apps/:appId/refresh')
  refreshApp(@Param('appId') appId: string) {
    return this.aso.refreshMetadata(appId);
  }

  // ─── Keywords ───────────────────────────────

  @Post('apps/:appId/keywords')
  addKeyword(
    @Param('appId') appId: string,
    @Body() body: { keyword?: string; keywords?: string[]; store: AppStore; source?: KeywordSource },
  ) {
    if (Array.isArray(body.keywords) && body.keywords.length > 0) {
      return this.aso.addKeywordsBulk({
        trackedAppId: appId,
        keywords: body.keywords,
        store: body.store,
        source: body.source,
      });
    }
    if (!body.keyword) {
      return { error: 'keyword veya keywords[] gerekli' };
    }
    return this.aso.addKeyword({
      trackedAppId: appId,
      keyword: body.keyword,
      store: body.store,
      source: body.source,
    });
  }

  @Delete('keywords/:keywordId')
  removeKeyword(@Param('keywordId') keywordId: string) {
    return this.aso.removeKeyword(keywordId);
  }

  @Get('keywords/:keywordId/history')
  keywordHistory(@Param('keywordId') keywordId: string, @Query('days') daysStr?: string) {
    const days = daysStr ? parseInt(daysStr, 10) : 30;
    return this.aso.getKeywordHistory(keywordId, days);
  }

  @Post('keywords/:keywordId/check-rank')
  checkRank(@Param('keywordId') keywordId: string) {
    return this.aso.checkRank(keywordId);
  }

  @Post('apps/:appId/check-all-ranks')
  checkAllRanks(@Param('appId') appId: string) {
    return this.aso.checkAllRanks(appId);
  }

  // ─── Reviews ────────────────────────────────

  @Post('apps/:appId/reviews/fetch')
  fetchReviews(
    @Param('appId') appId: string,
    @Body() body?: { limit?: number; analyzeSentiment?: boolean },
  ) {
    return this.aso.fetchReviews(appId, body);
  }

  @Get('apps/:appId/reviews/stats')
  reviewStats(@Param('appId') appId: string) {
    return this.aso.getReviewStats(appId);
  }

  // ─── AI Agent ───────────────────────────────

  @Post('apps/:appId/discover-competitors')
  discoverCompetitors(@Param('appId') appId: string) {
    return this.aso.discoverCompetitors(appId);
  }

  @Post('apps/:appId/ai-keyword-research')
  aiKeywordResearch(
    @Param('appId') appId: string,
    @Body() body?: { competitorAppIds?: Array<{ appId: string; store: 'IOS' | 'ANDROID' }>; locale?: 'tr' | 'en' },
  ) {
    return this.aso.aiKeywordResearch({ trackedAppId: appId, ...body });
  }

  @Post('apps/:appId/optimize-metadata')
  optimizeMetadata(
    @Param('appId') appId: string,
    @Body() body: { targetKeywords: string[]; store: 'IOS' | 'ANDROID'; locale?: 'tr' | 'en' },
  ) {
    return this.aso.optimizeMetadata({ trackedAppId: appId, ...body });
  }
}
