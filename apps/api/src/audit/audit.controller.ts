import { Body, Controller, Delete, ForbiddenException, Get, Header, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, BadRequestException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StuckPageStatus } from '@prisma/client';
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
import { AiSitemapService, PUBLIC_SITEMAP_TTL_MS } from './ai-sitemap.service.js';
import { AiSitemapThrottlerGuard } from './ai-sitemap-throttler.guard.js';
import { AuthorProfileService } from './author-profile.service.js';
import { HaroParserService } from './haro-parser.service.js';
import { AiReferrerService } from './ai-referrer.service.js';
import { CitedSourcesService } from './cited-sources.service.js';
import { PersonaChatService } from './persona-chat.service.js';
import { SnippetOptimizerService } from './snippet-optimizer.service.js';
import { WebhookNotifierService } from './webhook-notifier.service.js';
import { Public } from '../auth/public.decorator.js';
import { SessionOnly } from '../auth/session-only.decorator.js';
import { SnippetGeneratorService, type PageSnippet } from './snippet-generator.service.js';
import { SnippetApplierService } from './snippet-applier.service.js';
import { StaticHtmlFixerService } from './static-html-fixer.service.js';
import { StuckPageDetectorService } from './stuck-page-detector.service.js';
import { StuckPageRecoveryService } from './stuck-page-recovery.service.js';
import { StuckPageExternalRecoveryService } from './stuck-page-external-recovery.service.js';
import { STUCK_PAGE_NOT_FOUND } from './stuck-page-messages.js';
import { STUCK_CLAIM_LEASE_MS } from './stuck-page-autopilot.js';
import { PromptLabService } from './prompt-lab.service.js';
import { FanoutService } from './fanout.service.js';
import { AgentReadinessService, readinessForResponse } from './agent-readiness.service.js';
import { SiteUserThrottlerGuard, SITE_USER_THROTTLE } from './site-user-throttler.guard.js';
import { PersonaChatThrottlerGuard } from './persona-chat-throttler.guard.js';
import {
  AddFanoutDto, ApplySnippetsDto, ArticleRefDto, AutoFixApplyDto, AutoFixNowDto, AutoFixPreviewDto,
  CommunityLimitDto, CrawlerIngestDto, CreateLocalPromptsDto, CreatePromptDto, CrossLinkApplyDto,
  CrossLinkSuggestDto, GenerateFanoutDto, GeoHeatmapDto, HaroParseDto, LocalPromptSpecDto, SiteAuthorDto,
  PersonaChatDto, RecoverStuckBatchDto, RunAllPromptsDto, RunPromptDto, SchemaValidateDto,
  SnippetOptimizeApplyDto, StaticSnippetsDto, SubmitKnowledgeDto, ToggleFanoutDto, UpdateCommunityDto,
  UpdateOpportunityDto, UpdatePromptDto,
  COMMUNITY_MAX_LIMIT, CROSS_LINK_MAX_LIMIT, GEO_HEATMAP_MAX_QUERIES, STUCK_BATCH_MAX,
} from './audit.dto.js';
import { ContentOpportunityService } from './content-opportunity.service.js';
import { AiKpisService } from './ai-kpis.service.js';
import { ProductRadarService } from './product-radar.service.js';
import { CommunityAgentService } from './community-agent.service.js';
import { LiveCrawlerService } from './live-crawler.service.js';
import { RequiresPlan } from '../billing/plan-feature.decorator.js';
import { MeasurementSession } from '../billing/measurement-session.interceptor.js';

// PLAN KAPILARI — bu dosyada yalnizca EYLEM uclari plana baglidir:
// calistirma/uretme/uygulama gibi pahali POST'lar. Duz listeleme ve gecmis
// GET uclari bilerek ACIK birakildi; plani dusen kullanici gecmis verisini
// gorebilmeli ve disari alabilmeli.

/**
 * Model cagiran snippet uclarinin kullanici + site basina siniri
 * (SiteUserThrottlerGuard). Sayfa snippet'i istek basina 8'e kadar model
 * cagrisi yapar; elle, sayfa sayfa "Uret" akisi icin saatte 20 istek yeter.
 * Optimize tek cagridir, daha gevsek.
 */
const SNIPPET_PAGE_THROTTLE = { limit: 20, ttl: 60 * 60_000 };
const SNIPPET_OPTIMIZE_THROTTLE = { limit: 30, ttl: 60 * 60_000 };

/*
 * Diger model cagiran uclar — ayni guard, kendi kovalari (rota basina ayri
 * sayilir). Eskiden yalniz global IP limiti (60/dk) vardi; tek istek
 * birden cok ucretli model cagrisi yapabildigi icin dakikada yuzlerce cagri
 * mumkundu. Limitler panelin elle, tek tek kullanimina gore secildi.
 */
/** cross-link/suggest: oneri basina bir model cagrisi (en fazla 10) */
const CROSS_LINK_THROTTLE = { limit: 20, ttl: 60 * 60_000 };
/** community/find + community/scan: firsat basina bir yanit taslagi (en fazla 20) + Reddit aramalari */
const COMMUNITY_THROTTLE = { limit: 10, ttl: 60 * 60_000 };
/** haro/parse: soru basina bir model cagrisi (en fazla HARO_MAX_QUERIES) */
const HARO_THROTTLE = { limit: 5, ttl: 60 * 60_000 };
/** knowledge/wikipedia: tek bir uzun model cagrisi (taslak metin) */
const KNOWLEDGE_AI_THROTTLE = { limit: 10, ttl: 60 * 60_000 };
/** knowledge/wikidata: model cagrisi yok, yalniz DB okumasi — gevsek */
const KNOWLEDGE_DRAFT_THROTTLE = { limit: 30, ttl: 60 * 60_000 };
/** fanout/generate: tek model cagrisi; author-profile: brain'de bio yoksa tek model cagrisi */
const SINGLE_AI_CALL_THROTTLE = { limit: 30, ttl: 60 * 60_000 };
/**
 * Takili sayfa onarimi: sayfa basina bir model cagrisi (yaziyi yeniden yazar)
 * + yeniden yayin. Toplu istek tek seferde 50 sayfaya kadar isler; 100
 * sayfalik bir liste iki istekte biter — saatte 5 toplu istek bunu kesmez.
 */
const STUCK_RECOVER_THROTTLE = { limit: 30, ttl: 60 * 60_000 };
const STUCK_BATCH_THROTTLE = { limit: 5, ttl: 60 * 60_000 };

/**
 * HARO ozeti: haro-parser.service her "N) Summary:" blogu icin AYRI bir
 * model cagrisi yapar ve blok sayisini sinirlamaz; 100 KB'lik bir govdeye
 * binlerce kisa blok sigar. Ayirici servistekiyle ayni desen.
 */
const HARO_BLOCK_SPLIT = /\n\d+\)\s*Summary:/i;
const HARO_MAX_QUERIES = 30;

/**
 * Sorgu parametresi yalniz duz metin olarak kullanilir. Express 4'un qs
 * ayristiricisi `?status[not]=X` girdisini nesneye, `?status=a&status=b`
 * girdisini diziye cevirir: nesne Prisma'da filtre olarak yorumlaniyor,
 * dizi Prisma dogrulama hatasiyla 500 donuyordu.
 */
function queryText(value: unknown, max = 512): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
}

/**
 * Sayiyi [min, max] araligina sikistirir; sayi degilse varsayilan. DTO zaten
 * sinirlar; bu ikinci kat dogrudan (pipe'siz) cagrilar ve servislerin kendi
 * tavani olmayan yollar icin (topluluk taramasi, heatmap).
 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

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
    private readonly citedSources: CitedSourcesService,
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
  // Yanit duz metin ingest sirrini tasir: varsayilan (audit:read) bir API
  // anahtariyla okunursa sahte bot ziyareti imzalanabilir. Yalniz panel oturumu.
  @SessionOnly()
  @Get('live-crawler/snippets')
  liveCrawlerSnippets(@Param('siteId') siteId: string) {
    return this.liveCrawler.snippets(siteId);
  }

  /**
   * POST /sites/:siteId/audit/live-crawler/rotate-secret — ingest anahtarini yenile.
   * Sir sizdiysa tek care budur: eski anahtarla imzalanan istekler aninda
   * reddedilir, bu yuzden cevapta snippet'i yeniden kurma uyarisi doner.
   */
  @SessionOnly()
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

  /**
   * POST /sites/:siteId/audit/agent-readiness/run — tarama baslatir (plan kapisi).
   * Engelli / ulasilamaz taramada overallScore null + measured:false (latest ve
   * MCP ile ayni kural); kayit ve bildirimler ham sonucu kullanir.
   */
  @RequiresPlan('agentReadiness')
  @Post('agent-readiness/run')
  async agentReadinessRun(@Param('siteId') siteId: string) {
    return readinessForResponse(await this.agentReadiness.scan(siteId));
  }

  /**
   * GET /sites/:siteId/audit/agent-readiness/history?days=90
   * latest/run ile AYNI kapi: gecmis de ayni ucretli ozelligin verisi; kapisiz
   * kalinca alt plandaki kullanici skor trendini API'den dogrudan cekebiliyordu.
   */
  @RequiresPlan('agentReadiness')
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
    return this.opportunities.list(siteId, { status: queryText(status, 32), coverage: queryText(coverage, 32) });
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
    @Body() body: UpdateOpportunityDto,
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
  @MeasurementSession()
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
  @MeasurementSession()
  @Post('product-radar/run')
  productRadarRun(@Param('siteId') siteId: string) {
    return this.productRadar.run(siteId);
  }

  /** GET /sites/:siteId/audit/community */
  @Get('community')
  communityList(@Param('siteId') siteId: string, @Query('status') status?: string) {
    return this.communityAgent.list(siteId, { status: queryText(status, 32) });
  }

  /**
   * POST /sites/:siteId/audit/community/scan — community/find ile ayni yol
   * (firsat basina bir model cagrisi). Servis limiti sinirlamiyordu.
   */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: COMMUNITY_THROTTLE })
  @Post('community/scan')
  communityScan(@Param('siteId') siteId: string, @Body() body: CommunityLimitDto) {
    return this.communityAgent.scan(siteId, { limit: clampInt(body?.limit, 1, COMMUNITY_MAX_LIMIT, 10) });
  }

  /** PATCH /sites/:siteId/audit/community/:id */
  @Patch('community/:id')
  communityUpdate(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: UpdateCommunityDto,
  ) {
    // null (IsOptional'dan gecer) "degistirme" sayilir; servis String(null) ile 'null' yazardi
    return this.communityAgent.update(siteId, id, {
      status: typeof body?.status === 'string' ? body.status : undefined,
      draftReply: typeof body?.draftReply === 'string' ? body.draftReply : undefined,
    });
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
    return this.audit.compareAudits(siteId, { fromId: queryText(fromId, 64), toId: queryText(toId, 64) });
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
  autoFixApply(@Param('siteId') siteId: string, @Body() body: AutoFixApplyDto) {
    return this.autoFix.applyFixes(siteId, body?.fixes ?? []);
  }

  /**
   * POST /sites/:siteId/audit/auto-fix-now — kok dosya duzeltmelerini uygular.
   * confirm: { [fix]: previewToken } — robots.txt her zaman onizleme onayi
   * ister; sitemap/llms onaysiz yalniz dosya YOKKEN olusturulur.
   */
  @Post('auto-fix-now')
  async autoFixNow(
    @Param('siteId') siteId: string,
    @Body() body: AutoFixNowDto,
    @Req() req: Request,
  ) {
    const confirm = body?.confirm && typeof body.confirm === 'object' && !Array.isArray(body.confirm) ? body.confirm : null;
    return this.autoFix.runAutoFix(siteId, body?.fixes ?? [], { confirm, userId: (req as any).user?.id ?? null });
  }

  /**
   * POST /sites/:siteId/audit/auto-fix/preview — yazmadan onizleme: mevcut
   * icerik, onerilen icerik, satir farki ve uygulama icin previewToken.
   * Yayin hedefi olmadan da calisir (elle kopyala-yapistir icin).
   */
  @Post('auto-fix/preview')
  autoFixPreview(@Param('siteId') siteId: string, @Body() body: AutoFixPreviewDto) {
    if (!body || typeof body.fix !== 'string') throw new BadRequestException('Düzeltme anahtarı (fix) gerekli.');
    const aiTrain = body.options?.aiTrain === 'no' ? 'no' : body.options?.aiTrain === 'yes' ? 'yes' : undefined;
    return this.autoFix.preview(siteId, body.fix, { aiTrain });
  }

  /** GET /sites/:siteId/audit/auto-fix/history — son kok dosya duzeltmeleri + geri alinabilirlik */
  @Get('auto-fix/history')
  autoFixHistory(@Param('siteId') siteId: string, @Query('limit') limit?: string) {
    return this.autoFix.history(siteId, parseInt(limit ?? '10', 10) || 10);
  }

  /** POST /sites/:siteId/audit/auto-fix/:fixId/revert — yedekten geri yaz (dosya o gunden beri degismediyse) */
  @Post('auto-fix/:fixId/revert')
  autoFixRevert(@Param('siteId') siteId: string, @Param('fixId') fixId: string, @Req() req: Request) {
    return this.autoFix.revert(siteId, fixId, (req as any).user?.id ?? null);
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
    // status Prisma enum'una gider: bilinmeyen deger dogrulama hatasiyla 500
    // donuyordu, nesne (?status[not]=..) filtre olarak yorumlaniyordu.
    const st = queryText(status, 32);
    if (st && !(Object.values(StuckPageStatus) as string[]).includes(st)) {
      throw new BadRequestException(`Durum yalnızca ${Object.values(StuckPageStatus).join('/')} olabilir`);
    }
    const n = parseInt(queryText(limit, 6) ?? '', 10);
    const filters = { status: st, limit: Number.isFinite(n) ? Math.min(Math.max(n, 1), 200) : undefined };
    const rows = await this.stuckDetector.list(siteId, filters);
    // Sahipsiz kalan "Çalışıyor" satiri (onceki is dagitimda oldu): kira suresi
    // dolmus ve isi olmayan RECOVERING satiri listelenirken onceki durumuna
    // birakilir (stuck-page-autopilot.ts releaseAbandonedStuckClaim). Panel bu
    // satirda hicbir eylem sunmuyor; haftalik taramayi beklemek sayfayi gunlerce
    // kilitli birakirdi. Ek sorgu yalniz listede bayat satir varsa.
    const now = Date.now();
    const stale = Array.isArray(rows) && rows.some((r: any) => String(r?.status) === 'RECOVERING'
      && r.updatedAt instanceof Date && now - r.updatedAt.getTime() >= STUCK_CLAIM_LEASE_MS);
    if (stale && (await this.stuckRecovery.releaseStaleClaims(siteId)) > 0) return this.stuckDetector.list(siteId, filters);
    return rows;
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
    if (!sp) throw new NotFoundException(STUCK_PAGE_NOT_FOUND);
    return sp;
  }

  // KIM TETIKLEDI bilgisi (StuckPageRecovery.appliedBy) OTURUMDAN alinir.
  // Onceden govdedeki triggeredBy aynen yaziliyordu; istemci denetim kaydina
  // istedigi kimligi ('autopilot', baska bir kullanici) yazdirabiliyordu —
  // revert ucundaki duzeltmeyle ayni sinif. Panel hala
  // { triggeredBy: 'manual' } gonderiyor: tekil ucta govde hic okunmaz,
  // toplu ucta alan kabul edilir ama yok sayilir.

  @RequiresPlan('stuckPages')
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: STUCK_RECOVER_THROTTLE })
  @Post('stuck-pages/:id/recover')
  async recoverStuckPage(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    // articleId varsa Article-based recovery, yoksa external (URL fetch)
    const sp = await this.stuckDetector.getDetail(siteId, id);
    if (!sp) throw new NotFoundException(STUCK_PAGE_NOT_FOUND);
    const triggeredBy = this.actorOf(req);
    if (sp.articleId) {
      return this.stuckRecovery.recover(id, { triggeredBy });
    }
    return this.stuckExternalRecovery.recover(id, { triggeredBy });
  }

  /**
   * Toplu onarim — ASENKRON (paylasilan sozlesme C4). Uygun her sayfa icin bir
   * STUCK_PAGE_RECOVER isi kuyruga girer, cevap hemen doner; sonuc sayfalarin
   * durumunda gorunur. NEDEN: kurtarmalar istegin icinde sirayla bekleniyordu
   * (sayfa basina ~30-60 sn): Cloudflare vekilinin zaman sinirinda panel 524
   * alip "tekrar dene" diyordu, sunucu ise yazilari duzenlemeye devam ediyordu
   * (gerekce, kaynaklar ve bicim stuck-batch-result.ts). Plan kapisi ve hiz
   * siniri kuyruga alma aninda (bu uc); kimlikler siteId ile dogrulanir.
   */
  @RequiresPlan('stuckPages')
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: STUCK_BATCH_THROTTLE })
  @Post('stuck-pages/recover-batch')
  async recoverBatch(
    @Param('siteId') siteId: string,
    @Body() body: RecoverStuckBatchDto,
    @Req() req: Request,
  ) {
    const ids = Array.isArray(body?.stuckPageIds) ? body.stuckPageIds : [];
    const { results, summary } = await this.stuckRecovery.queueBatch(siteId, ids, this.actorOf(req), STUCK_BATCH_MAX);
    return { siteId, results, summary };
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
    await this.stuckRecovery.revert(siteId, recoveryId, this.actorOf(req));
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

  /**
   * POST /sites/:siteId/audit/prompts — takip listesine soru ekle.
   * Alanlar TEK TEK aktarilir: govde servise yayildiginda istemci
   * source:'local' yazip yerel soru akisinin il/ilce dogrulamasini ve
   * sinirlarini atlayabiliyordu; nesne intent Prisma hatasiyla 500 donuyordu.
   */
  @Post('prompts')
  createPrompt(
    @Param('siteId') siteId: string,
    @Body() body: CreatePromptDto,
  ) {
    return this.promptLab.create(siteId, {
      text: body?.text,
      intent: body?.intent,
      locale: body?.locale,
      tags: body?.tags,
    });
  }

  /** POST /sites/:siteId/audit/prompts/import-brain — brain'deki AEO/GEO sorgularini aktar */
  @Post('prompts/import-brain')
  importPromptsFromBrain(@Param('siteId') siteId: string) {
    return this.promptLab.importFromBrain(siteId);
  }

  /**
   * POST /sites/:siteId/audit/prompts/run-all — tum aktif promptlari calistir.
   * scope 'local': yalniz yerel sorular — ayni olcum yolu, ayni haftalik hak.
   */
  @MeasurementSession()
  @Post('prompts/run-all')
  runAllPrompts(
    @Param('siteId') siteId: string,
    @Body() body: RunAllPromptsDto,
  ) {
    return this.promptLab.runAll(siteId, { withFanout: body?.withFanout === true, limit: body?.limit, scope: body?.scope });
  }

  /** GET /sites/:siteId/audit/prompts/coverage?days=30 — ana soru vs fan-out farki */
  @Get('prompts/coverage')
  promptCoverage(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.promptLab.coverage(siteId, days ? parseInt(days, 10) : 30);
  }

  // ── Yerel mod: il/ilce + hizmet sorulari ve NAP dogrulugu ──
  // Uretim ve onizleme AI cagirmaz (sabit sablonlar) — olcum hakki tuketmez.
  // Olcum, yukaridaki/asagidaki @MeasurementSession uclarindan gecer.

  /** POST /sites/:siteId/audit/prompts/local/preview — taslaklar (kayit yok) */
  @Post('prompts/local/preview')
  previewLocalPrompts(
    @Param('siteId') siteId: string,
    @Body() body: LocalPromptSpecDto,
  ) {
    return this.promptLab.previewLocal(siteId, { il: body?.il, ilceler: body?.ilceler, hizmetler: body?.hizmetler });
  }

  /** POST /sites/:siteId/audit/prompts/local — secilen taslaklari takibe al (texts: secim) */
  @Post('prompts/local')
  createLocalPrompts(
    @Param('siteId') siteId: string,
    @Body() body: CreateLocalPromptsDto,
  ) {
    return this.promptLab.createLocal(siteId, {
      il: body?.il, ilceler: body?.ilceler, hizmetler: body?.hizmetler, texts: body?.texts,
    });
  }

  /** GET /sites/:siteId/audit/prompts/local/site-nap — sitede bulunan telefon/adres (siteye istek atmaz) */
  @Get('prompts/local/site-nap')
  localSiteNap(@Param('siteId') siteId: string) {
    return this.promptLab.siteNapStatus(siteId);
  }

  /** POST /sites/:siteId/audit/prompts/local/site-nap/refresh — anasayfayi yeniden oku (10 dk'da bir) */
  @Post('prompts/local/site-nap/refresh')
  refreshLocalSiteNap(@Param('siteId') siteId: string) {
    return this.promptLab.refreshSiteNap(siteId);
  }

  // NOT: Asagidaki ':promptId' rotalari, yukaridaki sabit yollardan
  // ('prompts/import-brain', 'prompts/run-all', 'prompts/coverage',
  // 'prompts/local/...') SONRA tanimlanmalidir. NestJS rotalari tanim sirasina
  // gore eslestirir; sabit yollar once gelmezse 'prompts/coverage' istegi
  // ':promptId' handler'ina duser ve promptId="coverage" ile 404 alirsiniz.

  /** PATCH /sites/:siteId/audit/prompts/:promptId */
  @Patch('prompts/:promptId')
  updatePrompt(
    @Param('siteId') siteId: string,
    @Param('promptId') promptId: string,
    @Body() body: UpdatePromptDto,
  ) {
    // Tek tek: tags eskiden herhangi bir JSON olabiliyordu (nesne, ic ice dizi).
    // null (IsOptional'dan gecer) "degistirme" sayilir: servis null intent'i
    // 'null' metni olarak, null isActive'i false olarak yazardi.
    return this.promptLab.update(siteId, promptId, {
      text: typeof body?.text === 'string' ? body.text : undefined,
      intent: typeof body?.intent === 'string' ? body.intent : undefined,
      tags: Array.isArray(body?.tags) ? body.tags : undefined,
      isActive: typeof body?.isActive === 'boolean' ? body.isActive : undefined,
    });
  }

  /** DELETE /sites/:siteId/audit/prompts/:promptId */
  @Delete('prompts/:promptId')
  deletePrompt(@Param('siteId') siteId: string, @Param('promptId') promptId: string) {
    return this.promptLab.remove(siteId, promptId);
  }

  /**
   * POST /sites/:siteId/audit/prompts/:promptId/run — tek prompt calistir.
   *
   * trigger ISTEMCIDEN ASLA ALINMAZ. Govde eskiden servise aynen yayiliyordu
   * ve runPrompt opts'u trigger:'user'|'system' kabul ediyor: {"trigger":"system"}
   * gonderen kullanici ai-citation.service runQueries'te aylik citation
   * kotasinin hem dayatilmasini (enforceCitationQuota) hem sayilmasini
   * (incrementCitationUsage) atlayip havuz anahtarlariyla sinirsiz olcum
   * yapabiliyordu. 'system' yalniz platformun kendi otomasyonuna ait
   * (content-opportunity remeasure). Burada daima varsayilan 'user'.
   */
  @MeasurementSession()
  @Post('prompts/:promptId/run')
  runPrompt(
    @Param('siteId') siteId: string,
    @Param('promptId') promptId: string,
    @Body() body: RunPromptDto,
  ) {
    return this.promptLab.runPrompt(siteId, promptId, {
      withFanout: body?.withFanout === true,
      providers: body?.providers,
      fanoutProviders: body?.fanoutProviders,
    });
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

  /** POST /sites/:siteId/audit/prompts/:promptId/fanout/generate — dallari (yeniden) uret (tek model cagrisi) */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: SINGLE_AI_CALL_THROTTLE })
  @Post('prompts/:promptId/fanout/generate')
  generateFanout(
    @Param('siteId') siteId: string,
    @Param('promptId') promptId: string,
    @Body() body: GenerateFanoutDto,
  ) {
    return this.fanout.generateForPrompt(siteId, promptId, { max: body?.max });
  }

  /** POST /sites/:siteId/audit/prompts/:promptId/fanout — elle dal ekle */
  @Post('prompts/:promptId/fanout')
  addFanout(
    @Param('siteId') siteId: string,
    @Param('promptId') promptId: string,
    @Body() body: AddFanoutDto,
  ) {
    return this.fanout.addManual(siteId, promptId, body?.text, body?.kind);
  }

  /** PATCH /sites/:siteId/audit/fanout/:fanoutId — dali ac/kapat */
  @Patch('fanout/:fanoutId')
  toggleFanout(
    @Param('siteId') siteId: string,
    @Param('fanoutId') fanoutId: string,
    @Body() body: ToggleFanoutDto,
  ) {
    return this.fanout.setActive(siteId, fanoutId, body?.isActive === true);
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
  @MeasurementSession()
  @Post('citation-test')
  async citationTest(@Param('siteId') siteId: string) {
    const results = await this.citation.runForSite(siteId, 5);
    return { results, runAt: new Date().toISOString() };
  }

  /** POST /sites/:siteId/audit/citation-roadmap — son sonuçlardan AI önerisi */
  @MeasurementSession()
  @Post('citation-roadmap')
  async citationRoadmap(@Param('siteId') siteId: string) {
    const results = await this.citation.runForSite(siteId, 5);
    const roadmap = await this.citation.generateRoadmap(siteId, results);
    return { results, roadmap, runAt: new Date().toISOString() };
  }

  /** POST /sites/:siteId/audit/citation-per-page — Clarity-style per-page cite + grounding queries */
  @MeasurementSession()
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

  /**
   * GET /sites/:siteId/audit/cited-sources?days=30|90 — AI cevaplarinin alintiladigi
   * dis kaynaklar (alan adi bazinda, tur etiketli) + "nerede yer almalisin" listesi.
   * Plan kapisi YOK: citation-history ile ayni — kendi olcum gecmisini okumak.
   */
  @Get('cited-sources')
  citedSourcesReport(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.citedSources.get(siteId, days);
  }

  /** GET /sites/:siteId/audit/citation-runs?limit=30 — test gecmisi (her kosum kalici) */
  @Get('citation-runs')
  citationRuns(@Param('siteId') siteId: string, @Query('limit') limit?: string) {
    return this.tracker.listRuns(siteId, limit ? parseInt(limit, 10) : 30);
  }

  /** GET /sites/:siteId/audit/citation-runs/compare?a=&b= — iki testi kiyasla */
  @Get('citation-runs/compare')
  async compareCitationRuns(@Param('siteId') siteId: string, @Query('a') a: string, @Query('b') b: string) {
    const res = await this.tracker.compareRuns(siteId, queryText(a, 64) ?? '', queryText(b, 64) ?? '');
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
    const karsilastirma = await this.tracker.compareRuns(siteId, queryText(a, 64) ?? '', queryText(b, 64) ?? '');
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
  @MeasurementSession()
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

  // index-ping kaldirildi: hicbir istemci cagirmiyordu; Google Indexing API
  // ozelligi zaten kaldirildi ve IndexNow yalniz RanksUp anahtar dosyasini
  // sunan host'larda calisiyordu (site.url sahipligi dogrulanmiyor).

  /** POST /sites/:siteId/audit/geo-heatmap — sektor sorularini AI'lara test et + rakiplerle karsilastir */
  @RequiresPlan('geoHeatmap')
  @MeasurementSession()
  @Post('geo-heatmap')
  geoHeatmap(@Param('siteId') siteId: string, @Body() body: GeoHeatmapDto) {
    // Servis maxQueries'i sinirlamiyor (sorgu basina 4 saglayici cagrisi)
    return this.heatmap.runForSite(siteId, { maxQueries: clampInt(body?.maxQueries, 1, GEO_HEATMAP_MAX_QUERIES, 10) });
  }

  /** GET /sites/:siteId/audit/knowledge/wikidata — Wikidata stub draft (model cagrisi yok) */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: KNOWLEDGE_DRAFT_THROTTLE })
  @Get('knowledge/wikidata')
  wikidataDraft(@Param('siteId') siteId: string) {
    return this.knowledge.buildWikidata(siteId);
  }

  /** GET /sites/:siteId/audit/knowledge/wikipedia — Wikipedia article draft (uzun bir model cagrisi) */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: KNOWLEDGE_AI_THROTTLE })
  @Get('knowledge/wikipedia')
  wikipediaDraft(@Param('siteId') siteId: string) {
    return this.knowledge.buildWikipedia(siteId);
  }

  /**
   * POST /sites/:siteId/audit/knowledge/submit — OTOMATIK GONDERIM YOK.
   *
   * Eskiden govdedeki taslak (istemcinin yazdigi etiket/aciklama) RanksUp'in
   * KENDI Wikidata bot hesabiyla (WIKIDATA_BOT_USER/PASS) yeni oge olarak
   * olusturuluyordu: herhangi bir site sahibi RanksUp adina istedigi ogeyi
   * acabiliyordu. Taslagi sunucuda uretmek de yetmez — etiket sitenin adidir
   * ve onu kullanici belirler. Gerekce ve kaynaklar knowledge-submitter.service.ts.
   * Simdi taslak sunucuda sitenin kendi verisinden uretilir ve elle ekleme
   * icin geri doner; istemcinin taslagi yok sayilir.
   */
  @Post('knowledge/submit')
  async submitKnowledge(
    @Param('siteId') siteId: string,
    @Body() body: SubmitKnowledgeDto,
  ) {
    if (body?.target === 'wikidata') {
      return this.knowledgeSubmitter.submitWikidata(await this.knowledge.buildWikidata(siteId));
    }
    return this.knowledgeSubmitter.submitWikipedia(body?.lang);
  }

  /** POST /sites/:siteId/audit/community/find — Reddit/Quora/HARO firsatlari (firsat basina bir model cagrisi) */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: COMMUNITY_THROTTLE })
  @Post('community/find')
  findCommunity(@Param('siteId') siteId: string, @Body() body: CommunityLimitDto) {
    // Servis limiti sinirlamiyordu: limit=1000 → yuzlerce yanit taslagi cagrisi
    return this.outreach.findOpportunities(siteId, { limit: clampInt(body?.limit, 1, COMMUNITY_MAX_LIMIT, 10) });
  }

  /** POST /sites/:siteId/audit/cross-link/suggest — bir makale icin cross-link onerileri */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: CROSS_LINK_THROTTLE })
  @Post('cross-link/suggest')
  async crossLinkSuggest(@Param('siteId') siteId: string, @Body() body: CrossLinkSuggestDto) {
    const articleId = await this.assertArticleInSite(siteId, body?.articleId);
    // Oneri basina bir model cagrisi (aiRefine): govdeden sinirsiz limit gelmesin
    const limit = clampInt(body?.limit, 1, CROSS_LINK_MAX_LIMIT, 5);
    return this.crossLink.suggestForArticle(siteId, articleId, { limit });
  }

  /** POST /sites/:siteId/audit/cross-link/apply — onaylanan oneriyi uygula (yalniz bu sitenin makalesine) */
  @Post('cross-link/apply')
  async crossLinkApply(@Param('siteId') siteId: string, @Body() body: CrossLinkApplyDto) {
    const suggestion = (body?.suggestion ?? {}) as Record<string, unknown>;
    await this.assertArticleInSite(siteId, suggestion.fromArticleId);
    return this.crossLink.applyLinkSuggestion(siteId, suggestion);
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
  ingestCrawlerLog(@Param('siteId') siteId: string, @Body() body: CrawlerIngestDto) {
    return this.crawler.ingestLog(siteId, typeof body?.logContent === 'string' ? body.logContent : '');
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
  validateSchema(@Param('siteId') siteId: string, @Body() body: SchemaValidateDto) {
    return this.schemaValidator.validate(body?.url);
  }

  /**
   * GET /sites/:siteId/audit/sitemap-ai.xml — AI site haritasi, HERKESE ACIK.
   *
   * Panel musteriye bu adresi robots.txt'e `Sitemap:` satiri olarak eklemesini
   * soyluyor; arama motoru botlari kimliksiz okur. Eskiden uc global
   * AuthGuard'in arkasindaydi ve botlar 401 aliyordu. Icerik yalniz sitenin
   * kendi ilan edilen kamusal adresleri (ai-sitemap.service advertisedArticleEntry:
   * llms-full, persona sohbeti, canonical ve JSON-LD ile ayni kural). Site yoksa
   * ya da sahibinin hesap silme talebi varsa 404. Uretilen XML site basina
   * PUBLIC_SITEMAP_TTL_MS onbellekte; Cache-Control ayni sureyi soyler.
   * Hiz siniri: IP + site basina (ai-sitemap-throttler.guard.ts) + global IP.
   * Content-Type yalniz basarili yanitta yazilir: 404/429 JSON govdesi XML
   * basligiyla gitmesin.
   */
  @Public()
  @UseGuards(AiSitemapThrottlerGuard)
  @Get('sitemap-ai.xml')
  async aiSitemapXml(@Param('siteId') siteId: string, @Res() res: Response) {
    const xml = await this.aiSitemap.getPublicXml(siteId);
    if (xml === null) throw new NotFoundException('Site bulunamadı');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', `public, max-age=${PUBLIC_SITEMAP_TTL_MS / 1000}`);
    res.send(xml);
  }

  /** GET /sites/:siteId/audit/author-profile?persona=Mert — brain'de bio yoksa tek model cagrisi */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: SINGLE_AI_CALL_THROTTLE })
  @Get('author-profile')
  authorProfileGet(@Param('siteId') siteId: string, @Query('persona') persona: string) {
    // Persona adi istem metnine girer: dize disi (dizi/nesne) ve uzun girdi kesilir
    return this.authorProfile.buildForPersona(siteId, queryText(persona, 80) ?? 'Yazar');
  }

  /**
   * GET /sites/:siteId/audit/author-profile/site — sitenin kayitli GERCEK yazari (yoksa null).
   * Uretim hatti makale JSON-LD author'unu ve gorunur yazar satirini yalniz bundan uretir.
   */
  @Get('author-profile/site')
  async siteAuthorGet(@Param('siteId') siteId: string) {
    // Kayit yoksa bos govde degil { author: null } (panel JSON bekler)
    return { author: await this.authorProfile.getSiteAuthor(siteId) };
  }

  /** PUT /sites/:siteId/audit/author-profile/site — gercek yazari kaydet (insan beyani: yalniz panel oturumu) */
  @SessionOnly()
  @Put('author-profile/site')
  async siteAuthorPut(@Param('siteId') siteId: string, @Body() body: SiteAuthorDto) {
    return { author: await this.authorProfile.setSiteAuthor(siteId, body) };
  }

  /** DELETE /sites/:siteId/audit/author-profile/site — yazari kaldir; author yeniden Organization olur */
  @SessionOnly()
  @Delete('author-profile/site')
  siteAuthorDelete(@Param('siteId') siteId: string) {
    return this.authorProfile.clearSiteAuthor(siteId);
  }

  /** POST /sites/:siteId/audit/haro/parse — HARO email digest parse + draft pitch (soru basina bir model cagrisi) */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: HARO_THROTTLE })
  @Post('haro/parse')
  async haroParse(@Param('siteId') siteId: string, @Body() body: HaroParseDto) {
    const content = typeof body?.emailContent === 'string' ? body.emailContent : '';
    const queries = content.split(HARO_BLOCK_SPLIT).length - 1;
    if (queries > HARO_MAX_QUERIES) {
      throw new BadRequestException(
        `Tek seferde en fazla ${HARO_MAX_QUERIES} HARO sorusu işlenebilir (bu metinde ${queries} soru var). E-postayı bölerek yapıştırın.`,
      );
    }
    return this.haro.parseDigest(siteId, content);
  }

  /** GET /sites/:siteId/audit/ai-referrer/history?days=30 — AI Search Console */
  @Get('ai-referrer/history')
  aiReferrerHistory(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.aiReferrer.getHistory(siteId, days ? parseInt(days, 10) : 30);
  }

  /**
   * POST /sites/:siteId/audit/snippet/optimize — AI cevap kutucugu icin meta+snippet refine.
   * Model cagrisi: kullanici + site basina sinirli; makale bu siteye ait olmali.
   */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: SNIPPET_OPTIMIZE_THROTTLE })
  @Post('snippet/optimize')
  async snippetOptimize(@Param('siteId') siteId: string, @Body() body: ArticleRefDto) {
    return this.snippetOpt.optimize(siteId, await this.assertArticleInSite(siteId, body?.articleId));
  }

  /** POST /sites/:siteId/audit/snippet/optimize/apply — onerileri uygula (yalniz bu sitenin makalesine) */
  @Post('snippet/optimize/apply')
  async snippetOptimizeApply(
    @Param('siteId') siteId: string,
    @Body() body: SnippetOptimizeApplyDto,
  ) {
    const articleId = await this.assertArticleInSite(siteId, body?.articleId);
    if (!body?.optimized || typeof body.optimized !== 'object') throw new BadRequestException('Uygulanacak öneri (optimized) gerekli.');
    return this.snippetOpt.apply(siteId, articleId, body.optimized);
  }

  /** POST /sites/:siteId/audit/webhook/test — Slack/Discord webhook testi */
  @Post('webhook/test')
  webhookTest(@Param('siteId') siteId: string) {
    return this.webhook.test(siteId);
  }

  /**
   * POST /sites/:siteId/audit/persona/chat — Public widget endpoint.
   *
   * Musteri sitesindeki her ziyaretci RanksUp'in model anahtariyla cagri
   * yaptirabilir; tek siniri global IP limitiydi (60/dk). Simdi ziyaretci
   * IP'si + site basina ve site toplami icin ayri kovalar var
   * (persona-chat-throttler.guard.ts); son mesaj uzunlugu serviste sinirli.
   */
  @Public()
  @UseGuards(PersonaChatThrottlerGuard)
  @Post('persona/chat')
  personaChatAsk(
    @Param('siteId') siteId: string,
    @Body() body: PersonaChatDto,
  ) {
    return this.personaChat.ask(siteId, Array.isArray(body?.history) ? body.history : []);
  }

  /**
   * GET /sites/:siteId/audit/snippets[?pageUrl=] — sayfanin eksik etiketleri icin oneriler.
   * Istek basina 8'e kadar ucretli model cagrisi: kullanici + site basina saatte
   * 20 istek (SiteUserThrottlerGuard). Plan kapisi YOK — plans.ts snippet
   * uretimini bir plan ozelligi (FEATURE_MIN_PLAN) olarak listelemiyor.
   */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: SNIPPET_PAGE_THROTTLE })
  @Get('snippets')
  async getSnippets(@Param('siteId') siteId: string, @Query('pageUrl') rawPageUrl?: string) {
    // Dizi/nesne gelirse (?pageUrl=a&pageUrl=b) .trim() 500 veriyordu
    const pageUrl = queryText(rawPageUrl, 2048);
    if (pageUrl) {
      const snippets = await this.snippets.generateForPage(siteId, pageUrl);
      // Servis adresi kirpip kullanir; panel bu adresle statik onizleme/yazim ister
      return { pageUrl: pageUrl.trim(), snippets };
    }
    // Anasayfa = sitenin KENDI kayitli adresi. Eskiden sitemap adresinin
    // kokeni kullaniliyordu; robots.txt'teki Sitemap satiri baska bir hosta
    // (CDN, eski alan adi) isaret edebilir ve snippet o hostun sayfasindan
    // uretiliyordu. generateForPage ayrica kapsam denetimi yapar.
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { url: true } });
    const baseUrl = site?.url?.trim() || null;
    if (!baseUrl) return { snippets: [], reason: 'Site adresi bulunamadı.' };
    const [pageSnippets, org] = await Promise.all([
      this.snippets.generateForPage(siteId, baseUrl),
      this.snippets.generateOrganizationJsonLd(siteId),
    ]);
    return { pageUrl: baseUrl, snippets: [org, ...pageSnippets] };
  }

  /** D2 — CMS adapter (WP/Webflow/Shopify) on-page meta yazımı */
  @Post('snippets/apply')
  async applySnippets(@Param('siteId') siteId: string, @Body() body: ApplySnippetsDto) {
    return this.applier.applyToTarget(siteId, this.snippetList(body?.snippets));
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
    const max = Math.min(50, Math.max(1, parseInt(queryText(maxPages, 6) ?? '30', 10) || 30));
    return this.snippets.bulkScan(siteId, queryText(rootUrl, 2048), max);
  }

  /** D4 — Statik HTML preview (FTP/SFTP/cPanel için) */
  @Post('snippets/static-preview')
  async staticPreview(
    @Param('siteId') siteId: string,
    @Body() body: StaticSnippetsDto,
  ) {
    return this.staticFixer.preview(siteId, body?.pageUrl, this.snippetList(body?.snippets));
  }

  /** D4 — Statik HTML write (onaydan sonra) */
  @Post('snippets/static-write')
  async staticWrite(
    @Param('siteId') siteId: string,
    @Body() body: StaticSnippetsDto,
  ) {
    return this.staticFixer.write(siteId, body?.pageUrl, this.snippetList(body?.snippets));
  }

  /** Denetim kaydindaki kisi: oturumdaki kullanici; (beklenmez) yoksa 'manual' */
  private actorOf(req: Request): string {
    const id = (req as any)?.user?.id;
    return typeof id === 'string' && id ? id : 'manual';
  }

  /**
   * Snippet ogeleri DTO'da yalniz "nesne" olarak denetlenir; alanlar (pageUrl,
   * type, value) uygulayici servislerde site alan adina ve ture gore
   * dogrulanir. Nesne olmayan oge burada elenir.
   */
  private snippetList(raw: unknown): PageSnippet[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((s) => s !== null && typeof s === 'object' && !Array.isArray(s)) as PageSnippet[];
  }

  /**
   * Govdeden gelen makale kimligi BU siteye mi ait. SiteAccessGuard yalniz
   * URL'deki :siteId'nin sahipligini dogrular, govdedeki articleId'ye bakmaz;
   * servisler de kimligi siteyle sinirlamadan okuyup yaziyordu. Kapsam
   * olmadan bir kullanici kendi sitesinin adresi altinda baska bir musterinin
   * makalesini okuyabilir (meta, AI onerisi) ve degistirebilirdi
   * (metaTitle / metaDescription / bodyMd). Bulunamazsa 404: kimligin baska
   * bir sitede var olup olmadigi da sizmaz.
   */
  private async assertArticleInSite(siteId: string, articleId: unknown): Promise<string> {
    if (typeof articleId !== 'string' || !articleId.trim()) throw new BadRequestException('Makale kimliği (articleId) gerekli.');
    const article = await this.prisma.article.findFirst({ where: { id: articleId, siteId }, select: { id: true } });
    if (!article) throw new NotFoundException('Makale bulunamadı.');
    return article.id;
  }
}
