import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { AsoPromptLabService } from './aso-prompt-lab.service.js';
import { AsoReviewContentService } from './aso-review-content.service.js';
import { RequiresPlan } from '../billing/plan-feature.decorator.js';
import { MeasurementSession } from '../billing/measurement-session.interceptor.js';
import { AsoResourceGuard } from './aso-resource.guard.js';
import { ratingsInputFor, storeMetadataInputs } from './aso-score-inputs.js';
import { guardText, type GuardIssue } from './metadata-guard.js';
import { velocityCount } from './recent-reviews.js';
import {
  AddAppPromptDto, AddKeywordDto, AiKeywordResearchDto, CalculateScoreDto, CompareCompetitorsDto, ConnectAppBodyDto,
  FetchReviewsDto, GenerateBackgroundDto, GenerateCaptionsDto, HandPhotoDto, KeywordAuditDto, LinkStoreDto,
  MirrorKeywordsDto, OptimizeMetadataDto,
} from './aso.dto.js';

// AsoResourceGuard: :appId / :keywordId'nin :siteId'ye ait oldugunu dogrular
// (SiteAccessGuard yalnizca site sahipligine bakar).
@Controller('sites/:siteId/aso')
@UseGuards(AsoResourceGuard)
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
    private readonly appPromptLab: AsoPromptLabService,
    private readonly reviewContent: AsoReviewContentService,
  ) {}

  // ─── App Prompt Lab — AI asistanlarda app onerisi takibi (GEO ⨉ ASO) ───
  // Plan kapisi: yalnizca eylem uclarinda (prompt ekleme/oneri/calistirma/silme).
  // Listeleme ve gecmis GET uclari acik — plani dusen kullanici gecmis olcumlerini
  // gormeye devam edebilmeli.

  /** GET /sites/:siteId/aso/apps/:appId/prompts */
  @Get('apps/:appId/prompts')
  listAppPrompts(@Param('siteId') siteId: string, @Param('appId') appId: string) {
    return this.appPromptLab.list(siteId, appId);
  }

  /** POST /sites/:siteId/aso/apps/:appId/prompts */
  @Post('apps/:appId/prompts')
  @RequiresPlan('appPromptLab')
  addAppPrompt(
    @Param('siteId') siteId: string,
    @Param('appId') appId: string,
    @Body() body: AddAppPromptDto,
  ) {
    return this.appPromptLab.add(siteId, appId, body?.text ?? '');
  }

  /** POST /sites/:siteId/aso/apps/:appId/prompts/suggest — AI soru onerileri */
  @Post('apps/:appId/prompts/suggest')
  @RequiresPlan('appPromptLab')
  suggestAppPrompts(@Param('siteId') siteId: string, @Param('appId') appId: string) {
    return this.appPromptLab.suggest(siteId, appId);
  }

  /** POST /sites/:siteId/aso/apps/:appId/prompts/:promptId/run — yapilandirilmis asistanlarda olc */
  @MeasurementSession()
  @Post('apps/:appId/prompts/:promptId/run')
  @RequiresPlan('appPromptLab')
  runAppPrompt(
    @Param('siteId') siteId: string,
    @Param('appId') appId: string,
    @Param('promptId') promptId: string,
  ) {
    return this.appPromptLab.run(siteId, appId, promptId);
  }

  /** GET /sites/:siteId/aso/apps/:appId/prompts/:promptId/history */
  @Get('apps/:appId/prompts/:promptId/history')
  appPromptHistory(
    @Param('siteId') siteId: string,
    @Param('appId') appId: string,
    @Param('promptId') promptId: string,
    @Query('days') days?: string,
  ) {
    return this.appPromptLab.history(siteId, appId, promptId, parseInt(days ?? '30', 10) || 30);
  }

  /** DELETE /sites/:siteId/aso/apps/:appId/prompts/:promptId */
  @Delete('apps/:appId/prompts/:promptId')
  @RequiresPlan('appPromptLab')
  removeAppPrompt(
    @Param('siteId') siteId: string,
    @Param('appId') appId: string,
    @Param('promptId') promptId: string,
  ) {
    return this.appPromptLab.remove(siteId, appId, promptId);
  }

  // ─── Review → Icerik Dongusu ────────────────────────────────

  /** POST /sites/:siteId/aso/apps/:appId/review-content-pack
   *  Olumsuz yorum temalarindan What's New + FAQ + blog konusu uretir;
   *  blog konulari ContentOpportunity'ye (source=reviews) yazilir. */
  @Post('apps/:appId/review-content-pack')
  reviewContentPack(@Param('siteId') siteId: string, @Param('appId') appId: string) {
    return this.reviewContent.buildPack(siteId, appId);
  }

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

  // GUVENLIK KURALI: yoldan gelen ve AsoResourceGuard'in sahipligini
  // denetledigi kimlik (siteId / trackedAppId) govde yayilimindan SONRA
  // yazilir. Govdeler artik sinif DTO (aso.dto.ts) ve ValidationPipe
  // bilinmeyen alani reddediyor; sira yine de korunur (pipe atlanan bir
  // cagri ya da gevsetilen bir DTO kimligi ezemesin). Eskiden govde satir ici
  // tipliydi, denetlenmiyordu ve kimligi once yazmak baska bir musterinin
  // uygulamasi uzerinde islem yapilmasina izin veriyordu.

  // ─── Apps ───────────────────────────────────

  @Get('apps')
  listApps(@Param('siteId') siteId: string) {
    return this.aso.listApps(siteId);
  }

  @Post('apps')
  connectApp(
    @Param('siteId') siteId: string,
    @Body() body: ConnectAppBodyDto,
  ) {
    return this.aso.connectApp({ ...body, siteId });
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
    @Body() body: LinkStoreDto,
  ) {
    return this.aso.linkStore({ ...body, trackedAppId: appId });
  }

  // ─── Keywords ───────────────────────────────

  /**
   * POST /aso/apps/:appId/keywords/mirror
   * Body: { from: 'IOS'|'ANDROID', to: 'IOS'|'ANDROID' }
   * Bir magazadaki kelimeleri digerine kopyalar (skor/rank hesaplanmaz).
   */
  @Post('apps/:appId/keywords/mirror')
  mirrorKeywords(
    @Param('appId') appId: string,
    @Body() body: MirrorKeywordsDto,
  ) {
    return this.aso.mirrorKeywords({
      trackedAppId: appId,
      from: body.from ?? 'IOS',
      to: body.to ?? 'ANDROID',
    });
  }

  @Post('apps/:appId/keywords')
  addKeyword(
    @Param('appId') appId: string,
    @Body() body: AddKeywordDto,
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
    @Body() body?: FetchReviewsDto,
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
    @Body() body?: AiKeywordResearchDto,
  ) {
    return this.aso.aiKeywordResearch({ ...body, trackedAppId: appId });
  }

  @Post('apps/:appId/optimize-metadata')
  optimizeMetadata(
    @Param('appId') appId: string,
    @Body() body: OptimizeMetadataDto,
  ) {
    return this.aso.optimizeMetadata({ ...body, trackedAppId: appId });
  }

  @Get('apps/:appId/audit')
  audit(@Param('appId') appId: string) {
    return this.aso.auditMetadata(appId);
  }

  /**
   * POST /sites/:siteId/aso/apps/:appId/keyword-audit — App Store anahtar
   * kelime alani denetimi (100 karakter, ayrac, tekrar, ad/alt baslik/sirket/
   * rakip/kategori ortusmesi). Yazma yok; yalniz hesap.
   */
  @Post('apps/:appId/keyword-audit')
  keywordAudit(
    @Param('appId') appId: string,
    @Body() body: KeywordAuditDto,
  ) {
    return this.aso.auditKeywordField(appId, body ?? {});
  }

  // ─── Screenshot Studio ──────────────────────
  // Plan kapisi: yalnizca uretim uclarinda (background/captions/save/hand-photo).
  // library GET acik — plani dusen kullanici gecmis uretimlerini gorebilmeli;
  // library DELETE de acik ki kendi dosyalarini silebilsin.

  /** POST /aso/apps/:appId/screenshots/background — Gemini Imagen ile arkaplan üret */
  @Post('apps/:appId/screenshots/background')
  @RequiresPlan('screenshotStudio')
  generateBackground(
    @Param('appId') appId: string,
    @Body() body: GenerateBackgroundDto,
  ) {
    return this.screenshots.generateBackground({ ...body, trackedAppId: appId });
  }

  /** POST /aso/apps/:appId/screenshots/captions — AI caption text önerileri (10 slot) */
  @Post('apps/:appId/screenshots/captions')
  @RequiresPlan('screenshotStudio')
  generateCaptions(
    @Param('appId') appId: string,
    @Body() body: GenerateCaptionsDto,
  ) {
    return this.screenshots.generateCaptions({ ...body, trackedAppId: appId });
  }

  /**
   * POST /aso/apps/:appId/screenshots/hand-photo-with-screenshot
   * Multimodal Gemini: screenshot → AI hand+phone scene with screenshot embedded.
   */
  @Post('apps/:appId/screenshots/hand-photo-with-screenshot')
  @RequiresPlan('screenshotStudio')
  generateHandPhotoWithScreenshot(
    @Param('appId') appId: string,
    @Body() body: HandPhotoDto,
  ) {
    return this.screenshots.generateHandPhotoWithScreenshot({ ...body, trackedAppId: appId });
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
    @Body() body: CalculateScoreDto = {},
  ) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({ where: { id: appId } });
    const md = (app.metadata as any) ?? {};
    const keywords = Array.isArray(body.targetKeywords) ? body.targetKeywords.filter((k) => typeof k === 'string') : [];

    // Magaza basina metadata girdisi (App Store'da aciklama yogunlugu skora girmez) — aso-score-inputs.ts
    const storeInputs = storeMetadataInputs(md, { ios: !!app.appStoreId, android: !!app.playStoreId }, keywords);
    // Son 30 gundeki yorum sayisi saklanan yorumlardan; bilinmiyorsa ya da
    // yalniz alt siniri biliniyorsa ("en az N", bayat cekim) null → hiz
    // bileseni skora katilmaz (eskiden sabit 0; sonra alt sinir kesin sayiliyordu)
    const recentReviews = await this.aso.getRecentReviewSignal(appId);

    const result = this.scorer.calculateOverallScore(
      storeInputs.map((s) => s.input),
      ratingsInputFor(app, md, velocityCount(recentReviews)),
      body.keywordPerformance ?? {},
      body.conversion ?? {},
    );

    return {
      appId,
      appName: app.name,
      computedAt: new Date().toISOString(),
      ...result,
      signals: {
        recentReviews30d: recentReviews,
        metadataStores: storeInputs.map((s) => ({
          store: s.store,
          keywordDensity: s.keywordDensity,
          densityCounted: s.store === 'ANDROID',
        })),
      },
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
    @Body() body: CompareCompetitorsDto,
  ) {
    if (!Array.isArray(body.names) || body.names.length === 0) {
      return { error: 'names array gerekli', results: [] };
    }
    const country = body.country ?? 'tr';
    const results = await this.itunes.compareCompetitors(body.names, country);
    return { country, count: results.length, results };
  }

  // ─── 6 ASO skill port endpoints ────────────────────────────
  // Bu uclar yalniz bellekte hesap yapar: govde veritabanina, dosya yoluna ya
  // da dis bir istege gitmez (DTO sertlestirmesi bu yuzden yukaridaki uclarda).

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
    // Metin kullanicinin kendi girdisinden kuruluyor: dokunulmaz, politika
    // riski (fiyat, "ucretsiz", eylem cagrisi...) yalniz isaretlenir.
    const store = body.platform === 'apple' ? 'IOS' : 'ANDROID';
    const ownText = [body.brand, body.intro, ...(Array.isArray(body.features) ? body.features : []), body.socialProof ?? ''].join('\n');
    const issues: GuardIssue[] = [
      ...guardText(title.optimized_title, { field: 'title', store, mode: 'flag', facts: { brand: body.brand } }).issues,
      ...guardText(description.description, { field: 'description', store, mode: 'flag', facts: { sourceText: ownText } }).issues,
      ...(keywordField ? guardText(keywordField.keyword_field, { field: 'keywords', store: 'IOS', mode: 'flag' }).issues : []),
    ];
    return {
      platform: body.platform,
      title,
      description,
      keyword_field: keywordField,
      issues,
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
