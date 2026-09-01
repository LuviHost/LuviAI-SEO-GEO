import { Body, Controller, Delete, ForbiddenException, Get, Header, NotFoundException, Param, Patch, Post, Query, Req, Res, BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from './audit.service.js';
import { AutoFixService } from './auto-fix.service.js';
import { AiCitationService } from './ai-citation.service.js';
import { AiCitationTrackerService } from './ai-citation-tracker.service.js';
import { geoRaporHtml } from './geo-rapor-html.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiIndexingPingerService } from './ai-indexing-pinger.service.js';
import { LlmsFullBuilderService } from './llms-full-builder.service.js';
import { GeoHeatmapService } from './geo-heatmap.service.js';
import { KnowledgeGraphBuilderService } from './knowledge-graph-builder.service.js';
import { KnowledgeSubmitterService } from './knowledge-submitter.service.js';
import { CommunityOutreachService } from './community-outreach.service.js';
import { CrossLinkingService } from './cross-linking.service.js';
import { TrainingDataExporterService } from './training-data-exporter.service.js';
import { CrawlerAnalyticsService } from './crawler-analytics.service.js';
import { AiMentionAlarmService } from './ai-mention-alarm.service.js';
import { GeoScoreCardService } from './geo-score-card.service.js';
import { SchemaValidatorService } from './schema-validator.service.js';
import { AiSitemapService } from './ai-sitemap.service.js';
import { AuthorProfileService } from './author-profile.service.js';
import { HaroParserService } from './haro-parser.service.js';
import { AiReferrerService } from './ai-referrer.service.js';
import { PersonaChatService } from './persona-chat.service.js';
import { SnippetOptimizerService } from './snippet-optimizer.service.js';
import { WebhookNotifierService } from './webhook-notifier.service.js';
import { Public } from '../auth/public.decorator.js';
import { SnippetGeneratorService } from './snippet-generator.service.js';
import { SnippetApplierService } from './snippet-applier.service.js';
import { StaticHtmlFixerService } from './static-html-fixer.service.js';
import { StuckPageDetectorService } from './stuck-page-detector.service.js';
import { StuckPageRecoveryService } from './stuck-page-recovery.service.js';
import { StuckPageExternalRecoveryService } from './stuck-page-external-recovery.service.js';
import { PromptLabService } from './prompt-lab.service.js';
import { FanoutService, type FanoutKind } from './fanout.service.js';
import type { Provider } from './ai-citation.service.js';
import { AgentReadinessService } from './agent-readiness.service.js';
import { ContentOpportunityService } from './content-opportunity.service.js';
import { AiKpisService } from './ai-kpis.service.js';
import { ProductRadarService } from './product-radar.service.js';
import { CommunityAgentService } from './community-agent.service.js';
import { LiveCrawlerService } from './live-crawler.service.js';
import { RequiresPlan } from '../billing/plan-feature.decorator.js';

// PLAN KAPILARI — bu dosyada yalnizca EYLEM uclari plana baglidir:
// calistirma/uretme/uygulama gibi pahali POST'lar. Duz listeleme ve gecmis
// GET uclari bilerek ACIK birakildi; plani dusen kullanici gecmis verisini
// gorebilmeli ve disari alabilmeli.
@Controller('sites/:siteId/audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly autoFix: AutoFixService,
    private readonly citation: AiCitationService,
    private readonly tracker: AiCitationTrackerService,
    private readonly pinger: AiIndexingPingerService,
    private readonly llmsBuilder: LlmsFullBuilderService,
    private readonly heatmap: GeoHeatmapService,
    private readonly knowledge: KnowledgeGraphBuilderService,
    private readonly knowledgeSubmitter: KnowledgeSubmitterService,
    private readonly outreach: CommunityOutreachService,
    private readonly crossLink: CrossLinkingService,
    private readonly trainingExport: TrainingDataExporterService,
    private readonly crawler: CrawlerAnalyticsService,
    private readonly alarm: AiMentionAlarmService,
    private readonly scoreCard: GeoScoreCardService,
    private readonly schemaValidator: SchemaValidatorService,
    private readonly aiSitemap: AiSitemapService,
    private readonly authorProfile: AuthorProfileService,
    private readonly haro: HaroParserService,
    private readonly aiReferrer: AiReferrerService,
    private readonly personaChat: PersonaChatService,
    private readonly snippetOpt: SnippetOptimizerService,
    private readonly webhook: WebhookNotifierService,
    private readonly snippets: SnippetGeneratorService,
    private readonly applier: SnippetApplierService,
    private readonly staticFixer: StaticHtmlFixerService,
    private readonly stuckDetector: StuckPageDetectorService,
    private readonly stuckRecovery: StuckPageRecoveryService,
    private readonly stuckExternalRecovery: StuckPageExternalRecoveryService,
    private readonly promptLab: PromptLabService,
    private readonly fanout: FanoutService,
    private readonly agentReadiness: AgentReadinessService,
    private readonly opportunities: ContentOpportunityService,
    private readonly kpis: AiKpisService,
    private readonly productRadar: ProductRadarService,
    private readonly communityAgent: CommunityAgentService,
    private readonly liveCrawler: LiveCrawlerService,
    private readonly prisma: PrismaService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  LIVE CRAWLER — canli AI bot akisi
  //  Asagidaki iki GET bilerek ACIK: akisi izleme ve kurulum kodunu gorme
  //  plana bagli degil. Plan kapisi log yutma ucunda (crawler/ingest).
  // ────────────────────────────────────────────────────────────

  /** GET /sites/:siteId/audit/live-crawler?minutes=10&limit=50 */
  @Get('live-crawler')
  liveCrawlerRecent(
    @Param('siteId') siteId: string,
    @Query('minutes') minutes?: string,
    @Query('limit') limit?: string,
  ) {
    return this.liveCrawler.recent(siteId, {
      minutes: parseInt(minutes ?? '10', 10) || 10,
      limit: parseInt(limit ?? '50', 10) || 50,
    });
  }

  /**
   * GET /sites/:siteId/audit/live-crawler/snippets — Worker/WP/nginx kurulum kodlari.
   * Snippet'ler ingest sirrini icerir; sir yoksa burada uretilir.
   */
  @Get('live-crawler/snippets')
  liveCrawlerSnippets(@Param('siteId') siteId: string) {
    return this.liveCrawler.snippets(siteId);
  }

  /**
   * POST /sites/:siteId/audit/live-crawler/rotate-secret — ingest anahtarini yenile.
   * Sir sizdiysa tek care budur: eski anahtarla imzalanan istekler aninda
   * reddedilir, bu yuzden cevapta snippet'i yeniden kurma uyarisi doner.
   */
  @Post('live-crawler/rotate-secret')
  liveCrawlerRotateSecret(@Param('siteId') siteId: string) {
    return this.liveCrawler.rotateIngestSecret(siteId);
  }

  // ────────────────────────────────────────────────────────────
  //  AGENT READINESS (AXO)
  // ────────────────────────────────────────────────────────────

  /** GET /sites/:siteId/audit/agent-readiness/latest */
  // OKUMA ucu da plana bagli. Onceden yalnizca POST uclari kapaliydi;
  // web'de kilit gostermek kozmetik kaliyordu cunku API'yi dogrudan
  // cagiran veriyi yine aliyordu. Kartta ust plana ait diye satilan
  // ozelligin OKUNMASI da kisitli olmali.
  @RequiresPlan('agentReadiness')
  @Get('agent-readiness/latest')
  agentReadinessLatest(@Param('siteId') siteId: string) {
    return this.agentReadiness.getLatest(siteId);
  }

  /** POST /sites/:siteId/audit/agent-readiness/run — tarama baslatir (plan kapisi) */
  @RequiresPlan('agentReadiness')
  @Post('agent-readiness/run')
  agentReadinessRun(@Param('siteId') siteId: string) {
    return this.agentReadiness.scan(siteId);
  }

  /** GET /sites/:siteId/audit/agent-readiness/history?days=90 */
  @Get('agent-readiness/history')
  agentReadinessHistory(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.agentReadiness.history(siteId, parseInt(days ?? '90', 10) || 90);
  }

  // ────────────────────────────────────────────────────────────
  //  CONTENT OPPORTUNITIES (kapali dongu)
  // ────────────────────────────────────────────────────────────

  /** GET /sites/:siteId/audit/opportunities */
  // OKUMA ucu da plana bagli. Onceden yalnizca POST uclari kapaliydi;
  // web'de kilit gostermek kozmetik kaliyordu cunku API'yi dogrudan
  // cagiran veriyi yine aliyordu. Kartta ust plana ait diye satilan
  // ozelligin OKUNMASI da kisitli olmali.
  @RequiresPlan('contentOpportunities')
  @Get('opportunities')
  async listOpportunities(
    @Param('siteId') siteId: string,
    @Query('status') status?: string,
    @Query('coverage') coverage?: string,
  ) {
    await this.opportunities.reconcile(siteId);
    return this.opportunities.list(siteId, { status, coverage });
  }

  /** POST /sites/:siteId/audit/opportunities/derive — prompt kayiplarindan firsat cikar */
  @RequiresPlan('contentOpportunities')
  @Post('opportunities/derive')
  deriveOpportunities(@Param('siteId') siteId: string) {
    return this.opportunities.derive(siteId);
  }

  /**
   * PATCH /sites/:siteId/audit/opportunities/:id — durum degistir (OPEN/PLANNED/DISMISSED)
   * PLAN KAPISI YOK: bu yalnizca isaretleme; uretim/olcum yapmaz. Plani dusen
   * kullanici acik kalan firsatlarini kapatabilmeli.
   */
  @Patch('opportunities/:id')
  updateOpportunity(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.opportunities.updateStatus(siteId, id, body.status);
  }

  /** POST /sites/:siteId/audit/opportunities/:id/generate — firsattan makale uret */
  @RequiresPlan('contentOpportunities')
  @Post('opportunities/:id/generate')
  generateFromOpportunity(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.opportunities.generateArticle(siteId, id);
  }

  /** POST /sites/:siteId/audit/opportunities/:id/remeasure — yayin sonrasi yeniden olc */
  @RequiresPlan('contentOpportunities')
  @Post('opportunities/:id/remeasure')
  remeasureOpportunity(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.opportunities.remeasure(siteId, id);
  }

  // ────────────────────────────────────────────────────────────
  //  AI KPI SERIDI + PRODUCT RADAR + COMMUNITY AGENT
  // ────────────────────────────────────────────────────────────

  /** GET /sites/:siteId/audit/ai-kpis — overview KPI seridi */
  @Get('ai-kpis')
  aiKpis(@Param('siteId') siteId: string) {
    return this.kpis.getKpis(siteId);
  }

  /** GET /sites/:siteId/audit/product-radar */
  // OKUMA ucu da plana bagli. Onceden yalnizca POST uclari kapaliydi;
  // web'de kilit gostermek kozmetik kaliyordu cunku API'yi dogrudan
  // cagiran veriyi yine aliyordu. Kartta ust plana ait diye satilan
  // ozelligin OKUNMASI da kisitli olmali.
  @RequiresPlan('productRadar')
  @Get('product-radar')
  productRadarLatest(@Param('siteId') siteId: string) {
    return this.productRadar.latest(siteId);
  }

  /** POST /sites/:siteId/audit/product-radar/run — tarama baslatir (plan kapisi) */
  @RequiresPlan('productRadar')
  @Post('product-radar/run')
  productRadarRun(@Param('siteId') siteId: string) {
    return this.productRadar.run(siteId);
  }

  /** GET /sites/:siteId/audit/community */
  @Get('community')
  communityList(@Param('siteId') siteId: string, @Query('status') status?: string) {
    return this.communityAgent.list(siteId, { status });
  }

  /** POST /sites/:siteId/audit/community/scan */
  @Post('community/scan')
  communityScan(@Param('siteId') siteId: string, @Body() body: { limit?: number }) {
    return this.communityAgent.scan(siteId, { limit: body?.limit });
  }

  /** PATCH /sites/:siteId/audit/community/:id */
  @Patch('community/:id')
  communityUpdate(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: { status?: string; draftReply?: string },
  ) {
    return this.communityAgent.update(siteId, id, body);
  }

  /** DELETE /sites/:siteId/audit/community/:id */
  @Delete('community/:id')
  communityRemove(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.communityAgent.remove(siteId, id);
  }

  @Get('latest')
  latest(@Param('siteId') siteId: string) {
    return this.audit.getLatest(siteId);
  }

  /**
   * GET /sites/:siteId/audit/history?limit=20 — tarama gecmisi (yeni -> eski).
   * Plan kapisi YOK: okuma ucu, @Get('latest') ile tutarli.
   */
  @Get('history')
  history(@Param('siteId') siteId: string, @Query('limit') limit?: string) {
    return this.audit.getHistory(siteId, parseInt(limit ?? '20', 10) || 20);
  }

  /**
   * GET /sites/:siteId/audit/compare?fromId=..&toId=.. — iki tarama farki.
   * Parametresiz cagrilirsa son iki taramayi karsilastirir.
   * Plan kapisi YOK: okuma ucu.
   */
  @Get('compare')
  compare(
    @Param('siteId') siteId: string,
    @Query('fromId') fromId?: string,
    @Query('toId') toId?: string,
  ) {
    return this.audit.compareAudits(siteId, { fromId, toId });
  }

  @Post('run-now')
  async runNow(@Param('siteId') siteId: string) {
    return this.audit.runAudit(siteId);
  }

  @Post('run')
  run(@Param('siteId') siteId: string) {
    return this.audit.queueAudit(siteId);
  }

  @Post('auto-fix')
  autoFixApply(@Param('siteId') siteId: string, @Body() body: { fixes: string[] }) {
    return this.autoFix.applyFixes(siteId, body.fixes);
  }

  @Post('auto-fix-now')
  async autoFixNow(@Param('siteId') siteId: string, @Body() body: { fixes: string[] }) {
    return this.autoFix.runAutoFix(siteId, body.fixes);
  }

  // ──────────────────────────────────────────────────────────────
  //  Stuck Pages — On-page.ai Recipe 1 esleyicisi
  // ──────────────────────────────────────────────────────────────

  // OKUMA ucu da plana bagli. Onceden yalnizca POST uclari kapaliydi;
  // web'de kilit gostermek kozmetik kaliyordu cunku API'yi dogrudan
  // cagiran veriyi yine aliyordu. Kartta ust plana ait diye satilan
  // ozelligin OKUNMASI da kisitli olmali.
  @RequiresPlan('stuckPages')
  @Get('stuck-pages')
  async listStuckPages(
    @Param('siteId') siteId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.stuckDetector.list(siteId, {
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** Tespit taramasi — pahali eylem, plana bagli. Yukaridaki liste GET'i acik. */
  @RequiresPlan('stuckPages')
  @Post('stuck-pages/detect')
  async detectStuckPages(@Param('siteId') siteId: string) {
    return this.stuckDetector.detect(siteId);
  }

  // NOT: Asagidaki tum stuck-page islemleri siteId ile KISITLANIR.
  // SiteAccessGuard yalnizca URL'deki :siteId'nin sahipligini dogrular; ic
  // kaynak id'lerine bakmaz. Kapsam olmadan saldirgan kendi sitesinin URL'i
  // altinda baskasinin stuckPageId/recoveryId'sini gecirip o musterinin
  // yayindaki makalesini degistirebilir veya govdesini okuyabilirdi.

  @Get('stuck-pages/:id')
  async stuckPageDetail(@Param('siteId') siteId: string, @Param('id') id: string) {
    const sp = await this.stuckDetector.getDetail(siteId, id);
    if (!sp) throw new NotFoundException('Stuck page bulunamadi');
    return sp;
  }

  @RequiresPlan('stuckPages')
  @Post('stuck-pages/:id/recover')
  async recoverStuckPage(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: { triggeredBy?: string } = {},
  ) {
    // articleId varsa Article-based recovery, yoksa external (URL fetch)
    const sp = await this.stuckDetector.getDetail(siteId, id);
    if (!sp) throw new NotFoundException('Stuck page bulunamadi');
    if (sp.articleId) {
      return this.stuckRecovery.recover(id, {
        triggeredBy: body.triggeredBy || 'manual',
      });
    }
    return this.stuckExternalRecovery.recover(id, {
      triggeredBy: body.triggeredBy || 'manual',
    });
  }

  @RequiresPlan('stuckPages')
  @Post('stuck-pages/recover-batch')
  async recoverBatch(
    @Param('siteId') siteId: string,
    @Body() body: { stuckPageIds: string[]; triggeredBy?: string },
  ) {
    const results: Array<{ id: string; ok: boolean; error?: string; recoveryId?: string }> = [];
    // Toplu istekte de her id ayri ayri siteId ile dogrulanir — govdeden gelen
    // liste kullanicinin kendi sitesine ait olmayan id icerebilir.
    for (const id of (body.stuckPageIds ?? []).slice(0, 50)) {
      try {
        const sp = await this.stuckDetector.getDetail(siteId, id);
        if (!sp) {
          results.push({ id, ok: false, error: 'Stuck page bulunamadi' });
          continue;
        }
        const r = sp.articleId
          ? await this.stuckRecovery.recover(id, { triggeredBy: body.triggeredBy || 'manual' })
          : await this.stuckExternalRecovery.recover(id, { triggeredBy: body.triggeredBy || 'manual' });
        results.push({ id, ok: r.success, recoveryId: r.recoveryId });
      } catch (err: any) {
        results.push({ id, ok: false, error: err.message });
      }
    }
    return { siteId, results };
  }

  @RequiresPlan('stuckPages')
  @Post('stuck-pages/recovery/:recoveryId/revert')
  async revertRecovery(
    @Param('siteId') siteId: string,
    @Param('recoveryId') recoveryId: string,
    @Req() req: Request,
  ) {
    // Kim geri aldi bilgisi OTURUMDAN alinir. Onceden body.userId'den
    // okunuyordu; saldirgan denetim kaydina istedigi kimligi yazdirabilirdi.
    const actor = (req as any).user?.id ?? 'manual';
    await this.stuckRecovery.revert(siteId, recoveryId, actor);
    return { ok: true };
  }

  // PLAN KAPISI YOK: yalnizca isaretleme (yok say). Kurtarma/tespit gibi is
  // yapmaz, o yuzden plani dusen kullanici listesini temizleyebilmeli.
  @Post('stuck-pages/:id/ignore')
  async ignoreStuckPage(@Param('siteId') siteId: string, @Param('id') id: string) {
    await this.stuckDetector.ignore(siteId, id);
    return { ok: true };
  }

  // ══════════════════════════════════════════════════════════
  //  PROMPT LAB — takip edilen sorular
  // ══════════════════════════════════════════════════════════

  /** GET /sites/:siteId/audit/prompts?includeInactive=1 */
  @Get('prompts')
  listPrompts(@Param('siteId') siteId: string, @Query('includeInactive') inc?: string) {
    return this.promptLab.list(siteId, { includeInactive: inc === '1' || inc === 'true' });
  }

  /** POST /sites/:siteId/audit/prompts — takip listesine soru ekle */
  @Post('prompts')
  createPrompt(
    @Param('siteId') siteId: string,
    @Body() body: { text: string; intent?: string; locale?: string; tags?: string[] },
  ) {
    return this.promptLab.create(siteId, body);
  }

  /** POST /sites/:siteId/audit/prompts/import-brain — brain'deki AEO/GEO sorgularini aktar */
  @Post('prompts/import-brain')
  importPromptsFromBrain(@Param('siteId') siteId: string) {
    return this.promptLab.importFromBrain(siteId);
  }

  /** POST /sites/:siteId/audit/prompts/run-all — tum aktif promptlari calistir */
  @Post('prompts/run-all')
  runAllPrompts(
    @Param('siteId') siteId: string,
    @Body() body: { withFanout?: boolean; limit?: number } = {},
  ) {
    return this.promptLab.runAll(siteId, body);
  }

  /** GET /sites/:siteId/audit/prompts/coverage?days=30 — ana soru vs fan-out farki */
  @Get('prompts/coverage')
  promptCoverage(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.promptLab.coverage(siteId, days ? parseInt(days, 10) : 30);
  }

  // NOT: Asagidaki ':promptId' rotalari, yukaridaki sabit yollardan
  // ('prompts/import-brain', 'prompts/run-all', 'prompts/coverage') SONRA
  // tanimlanmalidir. NestJS rotalari tanim sirasina gore eslestirir; sabit
  // yollar once gelmezse 'prompts/coverage' istegi ':promptId' handler'ina
  // duser ve promptId="coverage" ile 404 alirsiniz.

  /** PATCH /sites/:siteId/audit/prompts/:promptId */
  @Patch('prompts/:promptId')
  updatePrompt(
    @Param('siteId') siteId: string,
    @Param('promptId') promptId: string,
    @Body() body: { text?: string; intent?: string; tags?: string[]; isActive?: boolean },
  ) {
    return this.promptLab.update(siteId, promptId, body);
  }

  /** DELETE /sites/:siteId/audit/prompts/:promptId */
  @Delete('prompts/:promptId')
  deletePrompt(@Param('siteId') siteId: string, @Param('promptId') promptId: string) {
    return this.promptLab.remove(siteId, promptId);
  }

  /** POST /sites/:siteId/audit/prompts/:promptId/run — tek prompt calistir */
  @Post('prompts/:promptId/run')
  runPrompt(
    @Param('siteId') siteId: string,
    @Param('promptId') promptId: string,
    @Body() body: { withFanout?: boolean; providers?: Provider[]; fanoutProviders?: Provider[] } = {},
  ) {
    return this.promptLab.runPrompt(siteId, promptId, body);
  }

  /** GET /sites/:siteId/audit/prompts/:promptId/history?days=30 */
  @Get('prompts/:promptId/history')
  promptHistory(
    @Param('siteId') siteId: string,
    @Param('promptId') promptId: string,
    @Query('days') days?: string,
  ) {
    return this.promptLab.history(siteId, promptId, days);
  }

  // ══════════════════════════════════════════════════════════
  //  FAN-OUT — modelin arka planda actigi alt sorgu dallari
  // ══════════════════════════════════════════════════════════

  /** GET /sites/:siteId/audit/prompts/:promptId/fanout */
  @Get('prompts/:promptId/fanout')
  listFanout(@Param('siteId') siteId: string, @Param('promptId') promptId: string) {
    return this.fanout.listForPrompt(siteId, promptId);
  }

  /** POST /sites/:siteId/audit/prompts/:promptId/fanout/generate — dallari (yeniden) uret */
  @Post('prompts/:promptId/fanout/generate')
  generateFanout(
    @Param('siteId') siteId: string,
    @Param('promptId') promptId: string,
    @Body() body: { max?: number } = {},
  ) {
    return this.fanout.generateForPrompt(siteId, promptId, body);
  }

  /** POST /sites/:siteId/audit/prompts/:promptId/fanout — elle dal ekle */
  @Post('prompts/:promptId/fanout')
  addFanout(
    @Param('siteId') siteId: string,
    @Param('promptId') promptId: string,
    @Body() body: { text?: string; kind?: FanoutKind } = {},
  ) {
    return this.fanout.addManual(siteId, promptId, body?.text, body?.kind);
  }

  /** PATCH /sites/:siteId/audit/fanout/:fanoutId — dali ac/kapat */
  @Patch('fanout/:fanoutId')
  toggleFanout(
    @Param('siteId') siteId: string,
    @Param('fanoutId') fanoutId: string,
    @Body() body: { isActive?: boolean } = {},
  ) {
    return this.fanout.setActive(siteId, fanoutId, !!body?.isActive);
  }

  /** DELETE /sites/:siteId/audit/fanout/:fanoutId */
  @Delete('fanout/:fanoutId')
  deleteFanout(@Param('siteId') siteId: string, @Param('fanoutId') fanoutId: string) {
    return this.fanout.remove(siteId, fanoutId);
  }

  // Asagidaki POST uclari EYLEM'dir: kullanici tetikli calistirma, citation
  // kotasi dayatilir (runForSite varsayilani trigger:'user'). GET
  // citation-history sadece gecmis listeler — kotasi dolan kullanici da
  // gormeli, o yuzden kapi yok.
  @Post('citation-test')
  async citationTest(@Param('siteId') siteId: string) {
    const results = await this.citation.runForSite(siteId, 5);
    return { results, runAt: new Date().toISOString() };
  }

  /** POST /sites/:siteId/audit/citation-roadmap — son sonuçlardan AI önerisi */
  @Post('citation-roadmap')
  async citationRoadmap(@Param('siteId') siteId: string) {
    const results = await this.citation.runForSite(siteId, 5);
    const roadmap = await this.citation.generateRoadmap(siteId, results);
    return { results, roadmap, runAt: new Date().toISOString() };
  }

  /** POST /sites/:siteId/audit/citation-per-page — Clarity-style per-page cite + grounding queries */
  @Post('citation-per-page')
  async citationPerPage(@Param('siteId') siteId: string) {
    const results = await this.citation.runForSite(siteId, 5);
    const breakdown = this.citation.aggregatePerPageCitations(results);
    return { breakdown, runAt: new Date().toISOString() };
  }

  /**
   * GET /sites/:siteId/audit/citation-history?days=30[&headline=1] — tarihsel AI gorunurluk.
   * headline=1: probe JSON'suz hafif yanit (manset + trends), overview kartlari icin.
   */
  @Get('citation-history')
  citationHistory(
    @Param('siteId') siteId: string,
    @Query('days') days?: string,
    @Query('headline') headline?: string,
  ) {
    return this.tracker.getHistory(siteId, days ? parseInt(days, 10) : 30, headline === '1');
  }

  /** GET /sites/:siteId/audit/citation-runs?limit=30 — test gecmisi (her kosum kalici) */
  @Get('citation-runs')
  citationRuns(@Param('siteId') siteId: string, @Query('limit') limit?: string) {
    return this.tracker.listRuns(siteId, limit ? parseInt(limit, 10) : 30);
  }

  /** GET /sites/:siteId/audit/citation-runs/compare?a=&b= — iki testi kiyasla */
  @Get('citation-runs/compare')
  async compareCitationRuns(@Param('siteId') siteId: string, @Query('a') a: string, @Query('b') b: string) {
    const res = await this.tracker.compareRuns(siteId, a, b);
    if (!res) throw new BadRequestException('Kosum bulunamadi');
    return res;
  }

  /**
   * GET /sites/:siteId/audit/citation-runs/rapor?a=&b= — iki kosumun A4 YAZDIRILABILIR raporu.
   * NEDEN HTML: rapor musteriye gonderilir/yazdirilir; panel yeni sekmede acar, kullanici Ctrl+P ile PDF alir.
   */
  @Get('citation-runs/rapor')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async citationRunsRapor(
    @Param('siteId') siteId: string,
    @Query('a') a: string,
    @Query('b') b: string,
  ): Promise<string> {
    const karsilastirma = await this.tracker.compareRuns(siteId, a, b);
    if (!karsilastirma) throw new BadRequestException('Kosum bulunamadi');
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { name: true, url: true } });
    const gecmis = await this.tracker.getHistory(siteId, 30, true).catch(() => null);
    const trend = (gecmis as { headline?: { daily?: Array<{ date: string; score: number | null }> } } | null)?.headline?.daily ?? [];
    let host = site?.url ?? '';
    try { host = new URL(site?.url ?? '').hostname.replace(/^www\./, ''); } catch { /* url bozuksa oldugu gibi */ }
    return geoRaporHtml({ karsilastirma, brand: site?.name ?? host, host, trend });
  }

  /** GET /sites/:siteId/audit/citation-runs/:id — tek kosumun tam sonucu */
  @Get('citation-runs/:id')
  async citationRun(@Param('siteId') siteId: string, @Param('id') id: string) {
    const run = await this.tracker.getRun(siteId, id);
    if (!run) throw new BadRequestException('Kosum bulunamadi');
    return run;
  }

  /** POST /sites/:siteId/audit/citation-snapshot — snapshot al ve DB'ye yaz */
  @Post('citation-snapshot')
  citationSnapshot(@Param('siteId') siteId: string) {
    return this.tracker.snapshotSite(siteId);
  }

  /** POST /sites/:siteId/audit/llms-full/build — llms-full.txt yeniden olustur */
  @Post('llms-full/build')
  buildLlmsFull(@Param('siteId') siteId: string) {
    return this.llmsBuilder.build(siteId);
  }

  /** GET /sites/:siteId/audit/llms-full.txt — AI'lar ve kullanicilar icin */
  @Get('llms-full.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async getLlmsFull(@Param('siteId') siteId: string, @Res() res: Response) {
    const text = await this.llmsBuilder.getCached(siteId);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(text);
  }

  /** POST /sites/:siteId/audit/index-ping — bir URL'i tum AI/search engine kanallarina bildir */
  @Post('index-ping')
  indexPing(@Param('siteId') siteId: string, @Body() body: { url: string }) {
    return this.pinger.pingUrl(siteId, body.url);
  }

  /** POST /sites/:siteId/audit/geo-heatmap — sektor sorularini AI'lara test et + rakiplerle karsilastir */
  @RequiresPlan('geoHeatmap')
  @Post('geo-heatmap')
  geoHeatmap(@Param('siteId') siteId: string, @Body() body: { maxQueries?: number }) {
    return this.heatmap.runForSite(siteId, { maxQueries: body?.maxQueries });
  }

  /** GET /sites/:siteId/audit/knowledge/wikidata — Wikidata stub draft */
  @Get('knowledge/wikidata')
  wikidataDraft(@Param('siteId') siteId: string) {
    return this.knowledge.buildWikidata(siteId);
  }

  /** GET /sites/:siteId/audit/knowledge/wikipedia — Wikipedia article draft */
  @Get('knowledge/wikipedia')
  wikipediaDraft(@Param('siteId') siteId: string) {
    return this.knowledge.buildWikipedia(siteId);
  }

  /** POST /sites/:siteId/audit/knowledge/submit — Wikidata/Wikipedia auto-submit */
  @Post('knowledge/submit')
  async submitKnowledge(
    @Param('siteId') siteId: string,
    @Body() body: { target: 'wikidata' | 'wikipedia'; draft: any; lang?: 'tr' | 'en' },
  ) {
    if (body.target === 'wikidata') return this.knowledgeSubmitter.submitWikidata(body.draft);
    return this.knowledgeSubmitter.submitWikipedia(body.draft, body.lang);
  }

  /** POST /sites/:siteId/audit/community/find — Reddit/Quora/HARO firsatlari */
  @Post('community/find')
  findCommunity(@Param('siteId') siteId: string, @Body() body: { limit?: number }) {
    return this.outreach.findOpportunities(siteId, { limit: body?.limit });
  }

  /** POST /sites/:siteId/audit/cross-link/suggest — bir makale icin cross-link onerileri */
  @Post('cross-link/suggest')
  crossLinkSuggest(@Param('siteId') siteId: string, @Body() body: { articleId: string; limit?: number }) {
    return this.crossLink.suggestForArticle(body.articleId, { limit: body?.limit });
  }

  /** POST /sites/:siteId/audit/cross-link/apply — onaylanan oneriyi uygula */
  @Post('cross-link/apply')
  crossLinkApply(@Param('siteId') siteId: string, @Body() body: { suggestion: any }) {
    return this.crossLink.applyLinkSuggestion(body.suggestion);
  }

  /** GET /sites/:siteId/audit/training-data — JSONL HuggingFace export */
  @Get('training-data')
  @Header('Content-Type', 'application/json; charset=utf-8')
  async trainingDataMetadata(@Param('siteId') siteId: string) {
    const result = await this.trainingExport.exportSite(siteId);
    return { ...result, jsonl: undefined, sample: result.jsonl.slice(0, 2000) };
  }

  /** GET /sites/:siteId/audit/training-data.jsonl — direct download */
  @Get('training-data.jsonl')
  @Header('Content-Type', 'application/jsonl; charset=utf-8')
  async trainingDataDownload(@Param('siteId') siteId: string, @Res() res: Response) {
    const result = await this.trainingExport.exportSite(siteId);
    res.setHeader('Content-Disposition', `attachment; filename="${siteId.slice(0, 8)}-training-${result.records}r.jsonl"`);
    res.send(result.jsonl);
  }

  /**
   * POST /sites/:siteId/audit/crawler/ingest — Apache log parse + DB save
   * Sunucu logu yutma ucu; Ajans maddesinin sattigi sey bu. GET history acik.
   */
  @RequiresPlan('liveCrawler')
  @Post('crawler/ingest')
  ingestCrawlerLog(@Param('siteId') siteId: string, @Body() body: { logContent: string }) {
    return this.crawler.ingestLog(siteId, body.logContent);
  }

  /** GET /sites/:siteId/audit/crawler/history?days=30 — bot trafigi tarihcesi */
  @Get('crawler/history')
  crawlerHistory(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.crawler.getHistory(siteId, days ? parseInt(days, 10) : 30);
  }

  /**
   * POST /sites/:siteId/audit/alarm/scan — TUM sitelerde alarm tarama.
   *
   * ADMIN ZORUNLU: scanAndAlert() butun tenant'lari tarar ve donusteki her
   * AlarmTrigger kaydi o sitenin userId + userEmail bilgisini tasir.
   * Yetki kontrolu yokken, kendi sitesi olan HERHANGI bir kullanici bu
   * endpoint'i kendi siteId'siyle cagirip tum musteri listesinin e-posta
   * adreslerini cekebiliyordu. SiteAccessGuard bunu goremez; o yalnizca
   * URL'deki siteId'nin sahipligini dogrular, islemin kapsamini degil.
   */
  @Post('alarm/scan')
  alarmScan(@Req() req: Request) {
    const user = (req as any).user;
    if (user?.role !== 'ADMIN') {
      throw new ForbiddenException('Bu islem tum kiracilari tarar, yalnizca admin calistirabilir');
    }
    return this.alarm.scanAndAlert();
  }

  /** GET /sites/:siteId/audit/score-card — kapsamli GEO saglik skoru */
  @Get('score-card')
  scoreCardGet(@Param('siteId') siteId: string) {
    return this.scoreCard.build(siteId);
  }

  /** POST /sites/:siteId/audit/schema-validate — bir URL'in schema markup'ini validate et */
  @Post('schema-validate')
  validateSchema(@Param('siteId') siteId: string, @Body() body: { url: string }) {
    return this.schemaValidator.validate(body.url);
  }

  /** GET /sites/:siteId/audit/sitemap-ai.xml — AI optimize sitemap */
  @Get('sitemap-ai.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async aiSitemapXml(@Param('siteId') siteId: string, @Res() res: Response) {
    const result = await this.aiSitemap.build(siteId);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(result.xml);
  }

  /** GET /sites/:siteId/audit/author-profile?persona=Mert */
  @Get('author-profile')
  authorProfileGet(@Param('siteId') siteId: string, @Query('persona') persona: string) {
    return this.authorProfile.buildForPersona(siteId, persona ?? 'Yazar');
  }

  /** POST /sites/:siteId/audit/haro/parse — HARO email digest parse + draft pitch */
  @Post('haro/parse')
  haroParse(@Param('siteId') siteId: string, @Body() body: { emailContent: string }) {
    return this.haro.parseDigest(siteId, body.emailContent);
  }

  /** GET /sites/:siteId/audit/ai-referrer/history?days=30 — AI Search Console */
  @Get('ai-referrer/history')
  aiReferrerHistory(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.aiReferrer.getHistory(siteId, days ? parseInt(days, 10) : 30);
  }

  /** POST /sites/:siteId/audit/snippet/optimize — AI cevap kutucugu icin meta+snippet refine */
  @Post('snippet/optimize')
  snippetOptimize(@Param('siteId') siteId: string, @Body() body: { articleId: string }) {
    return this.snippetOpt.optimize(body.articleId);
  }

  /** POST /sites/:siteId/audit/snippet/optimize/apply — onerileri uygula */
  @Post('snippet/optimize/apply')
  snippetOptimizeApply(
    @Param('siteId') siteId: string,
    @Body() body: { articleId: string; optimized: any },
  ) {
    return this.snippetOpt.apply(body.articleId, body.optimized);
  }

  /** POST /sites/:siteId/audit/webhook/test — Slack/Discord webhook testi */
  @Post('webhook/test')
  webhookTest(@Param('siteId') siteId: string) {
    return this.webhook.test(siteId);
  }

  /** POST /sites/:siteId/audit/persona/chat — Public widget endpoint */
  @Public()
  @Post('persona/chat')
  personaChatAsk(
    @Param('siteId') siteId: string,
    @Body() body: { history: { role: 'user' | 'assistant'; content: string }[] },
  ) {
    return this.personaChat.ask(siteId, body.history ?? []);
  }

  @Get('snippets')
  async getSnippets(@Param('siteId') siteId: string, @Query('pageUrl') pageUrl?: string) {
    if (pageUrl) {
      const snippets = await this.snippets.generateForPage(siteId, pageUrl);
      return { pageUrl, snippets };
    }
    const audit = await this.audit.getLatest(siteId);
    const baseUrl = (audit?.checks as any)?.sitemap_xml?.details?.url
      ? new URL((audit!.checks as any).sitemap_xml.details.url).origin
      : null;
    if (!baseUrl) return { snippets: [], reason: 'Site base URL bulunamadı, önce audit çalıştır.' };
    const [pageSnippets, org] = await Promise.all([
      this.snippets.generateForPage(siteId, baseUrl),
      this.snippets.generateOrganizationJsonLd(siteId),
    ]);
    return { pageUrl: baseUrl, snippets: [org, ...pageSnippets] };
  }

  /** D2 — CMS adapter (WP/Webflow/Shopify) on-page meta yazımı */
  @Post('snippets/apply')
  async applySnippets(@Param('siteId') siteId: string, @Body() body: { snippets: any[] }) {
    return this.applier.applyToTarget(siteId, body.snippets ?? []);
  }

  /**
   * GET /sites/:siteId/audit/snippets/bulk-scan?rootUrl=...&maxPages=30
   * Toplu tarama — root URL'den başlayıp tüm alt sayfaların SEO durumunu çıkarır.
   * AI çağrısı yapmaz, sadece HTML parse + score. Ücretsiz + hızlı (~10-30sn / 30 sayfa).
   */
  @Get('snippets/bulk-scan')
  async bulkScanSnippets(
    @Param('siteId') siteId: string,
    @Query('rootUrl') rootUrl?: string,
    @Query('maxPages') maxPages?: string,
  ) {
    const max = Math.min(50, Math.max(1, parseInt(maxPages ?? '30', 10) || 30));
    return this.snippets.bulkScan(siteId, rootUrl, max);
  }

  /** D4 — Statik HTML preview (FTP/SFTP/cPanel için) */
  @Post('snippets/static-preview')
  async staticPreview(
    @Param('siteId') siteId: string,
    @Body() body: { pageUrl: string; snippets: any[] },
  ) {
    return this.staticFixer.preview(siteId, body.pageUrl, body.snippets ?? []);
  }

  /** D4 — Statik HTML write (onaydan sonra) */
  @Post('snippets/static-write')
  async staticWrite(
    @Param('siteId') siteId: string,
    @Body() body: { pageUrl: string; snippets: any[] },
  ) {
    return this.staticFixer.write(siteId, body.pageUrl, body.snippets ?? []);
  }
}
