import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AsoService } from './aso.service.js';
import { AsoScreenshotService } from './screenshot.service.js';
import { ASOScorerService } from './aso-scorer.service.js';
import { ItunesApiClient } from './itunes-api.client.js';
import { AsoKeywordAnalyzerService } from './aso-keyword-analyzer.service.js';
import { AsoReviewAnalyzerService } from './aso-review-analyzer.service.js';
import { AsoMetadataOptimizerService } from './aso-metadata-optimizer.service.js';
import { AsoLocalizationHelperService } from './aso-localization-helper.service.js';
import { AsoAbTestPlannerService } from './aso-ab-test-planner.service.js';
import { AsoLaunchChecklistService } from './aso-launch-checklist.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppStore, KeywordSource } from '@prisma/client';

@Controller('sites/:siteId/aso')
export class AsoController {
  constructor(
    private readonly aso: AsoService,
    private readonly screenshots: AsoScreenshotService,
    private readonly scorer: ASOScorerService,
    private readonly itunes: ItunesApiClient,
    private readonly prisma: PrismaService,
    private readonly keywordAnalyzer: AsoKeywordAnalyzerService,
    private readonly reviewAnalyzer: AsoReviewAnalyzerService,
    private readonly metadataOpt: AsoMetadataOptimizerService,
    private readonly localization: AsoLocalizationHelperService,
    private readonly abTest: AsoAbTestPlannerService,
    private readonly launchChecklist: AsoLaunchChecklistService,
  ) {}

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

  /**
   * POST /aso/apps/:appId/link-store
   * Body: { appStoreId?: string, playStoreId?: string }
   * Mevcut app'e ikinci store'u ekle (iOS-only app'e Android, veya tersi).
   */
  @Post('apps/:appId/link-store')
  linkStore(
    @Param('appId') appId: string,
    @Body() body: { appStoreId?: string; playStoreId?: string },
  ) {
    return this.aso.linkStore({ trackedAppId: appId, ...body });
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

  @Post('apps/:appId/refresh-scores')
  refreshScores(@Param('appId') appId: string) {
    return this.aso.refreshScoresForApp(appId);
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

  @Get('apps/:appId/audit')
  audit(@Param('appId') appId: string) {
    return this.aso.auditMetadata(appId);
  }

  // ─── Screenshot Studio ──────────────────────

  /** POST /aso/apps/:appId/screenshots/background — Gemini Imagen ile arkaplan üret */
  @Post('apps/:appId/screenshots/background')
  generateBackground(
    @Param('appId') appId: string,
    @Body() body: {
      style?: 'minimalist' | 'bold' | 'illustrative' | 'gradient' | 'mesh';
      brandColor?: string;
      customPrompt?: string;
      width?: number;
      height?: number;
    },
  ) {
    return this.screenshots.generateBackground({ trackedAppId: appId, ...body });
  }

  /** POST /aso/apps/:appId/screenshots/captions — AI caption text önerileri (10 slot) */
  @Post('apps/:appId/screenshots/captions')
  generateCaptions(
    @Param('appId') appId: string,
    @Body() body: { targetKeywords?: string[]; locale?: 'tr' | 'en'; slotCount?: number },
  ) {
    return this.screenshots.generateCaptions({ trackedAppId: appId, ...body });
  }

  /** POST /aso/apps/:appId/screenshots/save — final PNG'i sunucuda sakla */
  @Post('apps/:appId/screenshots/save')
  saveScreenshot(
    @Param('appId') appId: string,
    @Body() body: { base64Png: string; slotIndex: number; store: 'IOS' | 'ANDROID' },
  ) {
    return this.screenshots.saveScreenshot({ trackedAppId: appId, ...body });
  }

  /**
   * POST /aso/apps/:appId/screenshots/hand-photo-with-screenshot
   * Multimodal Gemini: screenshot → AI hand+phone scene with screenshot embedded.
   */
  @Post('apps/:appId/screenshots/hand-photo-with-screenshot')
  generateHandPhotoWithScreenshot(
    @Param('appId') appId: string,
    @Body() body: { screenshotBase64: string; brandColor?: string; width?: number; height?: number },
  ) {
    return this.screenshots.generateHandPhotoWithScreenshot({ trackedAppId: appId, ...body });
  }

  /** GET /aso/apps/:appId/screenshots/library — bu app için üretilmiş tüm AI background'lar */
  @Get('apps/:appId/screenshots/library')
  listScreenshotLibrary(@Param('appId') appId: string) {
    return this.screenshots.listLibrary(appId);
  }

  /** DELETE /aso/apps/:appId/screenshots/library/:filename — galeriden sil */
  @Delete('apps/:appId/screenshots/library/:filename')
  deleteFromLibrary(@Param('appId') appId: string, @Param('filename') filename: string) {
    return this.screenshots.deleteFromLibrary(appId, filename);
  }

  // ─── ASO Health Scoring (claude-code-aso-skill port) ────────

  /**
   * POST /sites/:siteId/aso/apps/:appId/score
   * Mevcut TrackedApp verilerinden (metadata + reviews + opsiyonel manuel input)
   * 4-boyut weighted ASO health score (0-100) hesaplar + recommendation üretir.
   */
  @Post('apps/:appId/score')
  async calculateScore(
    @Param('appId') appId: string,
    @Body() body: {
      targetKeywords?: string[];
      keywordPerformance?: { top_10?: number; top_50?: number; top_100?: number; improving_keywords?: number };
      conversion?: { impression_to_install?: number; downloads_last_30_days?: number; downloads_trend?: 'up' | 'stable' | 'down' };
    } = {},
  ) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({ where: { id: appId } });
    const md = (app.metadata as any) ?? {};
    const ios = md.ios ?? {};
    const android = md.android ?? {};
    const title = ios.trackName ?? android.title ?? app.name;
    const desc = ios.description ?? android.description ?? '';
    const keywords = body.targetKeywords ?? [];

    // Title keyword count — case-insensitive substring
    const titleLower = title.toLowerCase();
    const titleKwCount = keywords.filter(k => titleLower.includes(k.toLowerCase())).length;
    // Keyword density in description (%)
    const descWords = desc.split(/\s+/).filter(Boolean).length;
    const descLower = desc.toLowerCase();
    const kwHits = keywords.reduce((s, k) => s + (descLower.match(new RegExp('\\b' + k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'))?.length ?? 0), 0);
    const density = descWords > 0 ? (kwHits / descWords) * 100 : 0;

    const result = this.scorer.calculateOverallScore(
      {
        title_keyword_count: titleKwCount,
        title_length: title.length,
        description_length: desc.length,
        description_quality: desc.length > 1500 ? 0.8 : desc.length > 500 ? 0.5 : 0.3,
        keyword_density: density,
      },
      {
        average_rating: app.iosRating ?? app.androidRating ?? 0,
        total_ratings: (app.iosReviewCount ?? 0) + (app.androidReviewCount ?? 0),
        recent_ratings_30d: 0, // TODO: review timestamps'ten compute et
      },
      body.keywordPerformance ?? {},
      body.conversion ?? {},
    );

    return {
      appId,
      appName: app.name,
      computedAt: new Date().toISOString(),
      ...result,
    };
  }

  // ─── Competitor Discovery (iTunes API) ─────────────────────

  /**
   * GET /sites/:siteId/aso/competitors?category=productivity&country=tr&limit=10
   * iTunes Search API'den top app'leri çeker + extractMetadata ile temizler.
   */
  @Get('competitors')
  async listCompetitors(
    @Query('category') category: string,
    @Query('country') country = 'tr',
    @Query('limit') limit = '10',
  ) {
    if (!category) return { error: 'category query parametresi gerekli', results: [] };
    const apps = await this.itunes.getCompetitors(category, parseInt(limit, 10) || 10, country);
    return {
      category,
      country,
      count: apps.length,
      results: apps.map(a => this.itunes.extractMetadata(a)),
    };
  }

  /**
   * POST /sites/:siteId/aso/competitors/compare
   * Body: { names: ['Todoist', 'Notion', 'Bear'] }
   * Bir liste competitor adından batch metadata.
   */
  @Post('competitors/compare')
  async compareCompetitors(
    @Body() body: { names: string[]; country?: string },
  ) {
    if (!Array.isArray(body.names) || body.names.length === 0) {
      return { error: 'names array gerekli', results: [] };
    }
    const country = body.country ?? 'tr';
    const results = await this.itunes.compareCompetitors(body.names, country);
    return { country, count: results.length, results };
  }

  // ─── 6 ASO skill port endpoints ────────────────────────────

  /** POST /aso/keywords/analyze — bir veya birden çok keyword'ı analiz et */
  @Post('keywords/analyze')
  analyzeKeywords(@Body() body: { keywords: Array<{ keyword: string; competing_apps?: number; search_volume?: number; current_rank?: number | null; app_relevance?: number }> }) {
    if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
      return { error: 'keywords array gerekli', analyses: [] };
    }
    return this.keywordAnalyzer.compareKeywords(body.keywords);
  }

  /** POST /aso/keywords/extract — metinden keyword çıkar */
  @Post('keywords/extract')
  extractKeywords(@Body() body: { text: string; minLength?: number; maxResults?: number }) {
    return this.keywordAnalyzer.extractKeywordsFromText(body.text ?? '', body.minLength, body.maxResults);
  }

  /** POST /aso/reviews/analyze — review array'i için sentiment + theme + issue + feature req */
  @Post('reviews/analyze')
  analyzeReviews(@Body() body: { reviews: Array<{ rating: number; text: string; date?: string }>; appName?: string }) {
    const reviews = body.reviews ?? [];
    const sentiment = this.reviewAnalyzer.analyzeSentiment(reviews);
    const themes = this.reviewAnalyzer.extractCommonThemes(reviews);
    const issues = this.reviewAnalyzer.identifyIssues(reviews);
    const featureRequests = this.reviewAnalyzer.findFeatureRequests(reviews);
    return { sentiment, themes, issues, feature_requests: featureRequests, app_name: body.appName ?? 'app' };
  }

  /** POST /aso/metadata/optimize — title + description + keyword field auto-build */
  @Post('metadata/optimize')
  optimizeMetadataFromInputs(@Body() body: {
    platform: 'apple' | 'google';
    brand: string;
    keywords: string[];
    intro: string;
    features: string[];
    socialProof?: string;
    cta?: string;
  }) {
    const title = this.metadataOpt.optimizeTitle({ brand: body.brand, keywords: body.keywords, platform: body.platform });
    const description = this.metadataOpt.optimizeDescription({
      intro: body.intro,
      features: body.features,
      socialProof: body.socialProof,
      cta: body.cta,
      keywords: body.keywords,
      platform: body.platform,
    });
    const keywordField = body.platform === 'apple'
      ? this.metadataOpt.optimizeKeywordField(body.keywords, title.optimized_title.split(/[\s,:]+/))
      : null;
    return {
      platform: body.platform,
      title,
      description,
      keyword_field: keywordField,
    };
  }

  /** GET /aso/localization/markets?budget=2000 — hedef pazar listesi + cost */
  @Get('localization/markets')
  listLocalizationMarkets(@Query('budget') budgetUsd?: string, @Query('max') maxMarkets?: string) {
    return this.localization.identifyTargetMarkets({
      budgetUsd: budgetUsd ? parseFloat(budgetUsd) : undefined,
      maxMarkets: maxMarkets ? parseInt(maxMarkets, 10) : undefined,
    });
  }

  /** POST /aso/localization/roi — payback hesabı */
  @Post('localization/roi')
  localizationROI(@Body() body: { currentMonthlyInstalls: number; avgLtvUsd: number; targetMarket: string; expectedUplift?: number }) {
    return this.localization.calculateLocalizationROI({
      currentMonthlyInstalls: body.currentMonthlyInstalls,
      avgLtvUsd: body.avgLtvUsd,
      targetMarket: body.targetMarket as any,
      expectedUplift: body.expectedUplift,
    });
  }

  /** POST /aso/ab-test/design — sample size + best practices */
  @Post('ab-test/design')
  designAbTest(@Body() body: {
    test_type: 'icon' | 'screenshots' | 'title' | 'subtitle' | 'description' | 'category';
    hypothesis: string;
    baseline_conversion_rate: number;
    min_detectable_effect: number;
    variant_count?: number;
    daily_traffic?: number;
    confidence_level?: number;
  }) {
    return this.abTest.designTest(body);
  }

  /** POST /aso/ab-test/significance — control vs variant istatistiksel test */
  @Post('ab-test/significance')
  abTestSignificance(@Body() body: { control_visitors: number; control_conversions: number; variant_visitors: number; variant_conversions: number; confidence_level?: number }) {
    return this.abTest.calculateSignificance(body);
  }

  /** GET /aso/launch/checklist?platform=both */
  @Get('launch/checklist')
  launchChecklistGet(@Query('platform') platform: 'apple' | 'google' | 'both' = 'both', @Query('category') category?: string) {
    return this.launchChecklist.generatePrelaunchChecklist({ platform, appCategory: category });
  }

  /** POST /aso/launch/compliance — metadata uyumluluk validate */
  @Post('launch/compliance')
  launchCompliance(@Body() body: {
    platform: 'apple' | 'google';
    title: string; subtitle?: string; shortDescription?: string; description: string; keywordField?: string; iconUrl?: string;
  }) {
    if (body.platform === 'apple') {
      return this.launchChecklist.validateAppleCompliance(body);
    }
    return this.launchChecklist.validateGoogleCompliance({
      title: body.title,
      shortDescription: body.shortDescription,
      description: body.description,
      iconUrl: body.iconUrl,
    });
  }

  /** GET /aso/launch/seasonal */
  @Get('launch/seasonal')
  launchSeasonal(@Query('country') country?: string, @Query('category') category?: string) {
    return this.launchChecklist.planSeasonalCampaigns({ country, appCategory: category });
  }
}
