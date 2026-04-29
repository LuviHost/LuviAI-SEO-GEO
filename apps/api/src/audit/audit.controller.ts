import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from './audit.service.js';
import { AutoFixService } from './auto-fix.service.js';
import { AiCitationService } from './ai-citation.service.js';
import { AiCitationTrackerService } from './ai-citation-tracker.service.js';
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
  ) {}

  @Get('latest')
  latest(@Param('siteId') siteId: string) {
    return this.audit.getLatest(siteId);
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

  @Post('citation-test')
  async citationTest(@Param('siteId') siteId: string) {
    const results = await this.citation.runForSite(siteId, 5);
    return { results, runAt: new Date().toISOString() };
  }

  /** GET /sites/:siteId/audit/citation-history?days=30 — tarihsel AI gorunurluk */
  @Get('citation-history')
  citationHistory(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.tracker.getHistory(siteId, days ? parseInt(days, 10) : 30);
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

  /** POST /sites/:siteId/audit/crawler/ingest — Apache log parse + DB save */
  @Post('crawler/ingest')
  ingestCrawlerLog(@Param('siteId') siteId: string, @Body() body: { logContent: string }) {
    return this.crawler.ingestLog(siteId, body.logContent);
  }

  /** GET /sites/:siteId/audit/crawler/history?days=30 — bot trafigi tarihcesi */
  @Get('crawler/history')
  crawlerHistory(@Param('siteId') siteId: string, @Query('days') days?: string) {
    return this.crawler.getHistory(siteId, days ? parseInt(days, 10) : 30);
  }

  /** POST /audit/alarm/scan — admin: tum sitelerde alarm tarama (cron disinda manuel) */
  @Post('alarm/scan')
  alarmScan() {
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
