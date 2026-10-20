import { Module } from '@nestjs/common';
import { ArticlesController } from './articles.controller.js';
import { ArticlesService } from './articles.service.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { PipelineService } from './pipeline.service.js';
import { ImageGeneratorService } from './image-generator.service.js';
import { PublisherService } from './publisher.service.js';
import { ArticleSchedulerService } from './article-scheduler.service.js';
import { SchemaClassifierService } from './schema-classifier.service.js';
import { ContentPivotService } from './content-pivot.service.js';
import { ProgrammaticSeoService } from './programmatic-seo.service.js';
import { TranslatorService } from './translator.service.js';
import { LinkValidatorService } from './link-validator.service.js';
import { QaGateService } from './qa-gate.service.js';
import { PublishedLivenessService } from './published-liveness.service.js';
import { OrphanCrawlerSweepCron } from '../sites/orphan-crawler-sweep.js';
import { LLMModule } from '../llm/llm.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { SitesModule } from '../sites/sites.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

/**
 * Article Pipeline:
 *  - 6 ajan zinciri (anahtar kelime → outline → yazar → editor → görsel → yayıncı)
 *  - AgentRunner: tek ajan çağrısı (Anthropic SDK + prompt caching)
 *  - PipelineService: zincir orchestration
 *  - ImageGenerator: Gemini 2.5 Flash Image
 *  - Publisher: adapter framework (WP/FTP/SFTP/Markdown)
 *  - PublishedLiveness: gunluk "yazi sitede gercekten yayinda mi" denetimi (404/410 iki
 *    denetimle dogrulanirsa kopya yayinda sayilmaz, site sahibine panel bildirimi —
 *    NotificationsModule)
 *  - OrphanCrawlerSweepCron (sites/orphan-crawler-sweep.ts): silinmis sitelerin bot
 *    kayitlari icin gunluk temizlik. Burada kayitli cunku bu dalgada sites.module.ts
 *    degistirilmedi; dogal yeri veri saklama islerinin yanidir (me.module.ts KvSweepCron).
 */
@Module({
  imports: [AuditModule, LLMModule, SitesModule, NotificationsModule],
  controllers: [ArticlesController],
  providers: [
    ArticlesService,
    AgentRunnerService,
    PipelineService,
    ImageGeneratorService,
    PublisherService,
    ArticleSchedulerService,
    SchemaClassifierService,
    ContentPivotService,
    ProgrammaticSeoService,
    TranslatorService,
    LinkValidatorService,
    QaGateService,
    PublishedLivenessService,
    OrphanCrawlerSweepCron,
  ],
  exports: [
    ArticlesService,
    AgentRunnerService,
    PipelineService,
    ImageGeneratorService,
    PublisherService,
    ArticleSchedulerService,
    SchemaClassifierService,
    ContentPivotService,
    ProgrammaticSeoService,
    TranslatorService,
    LinkValidatorService,
    QaGateService,
  ],
})
export class ArticlesModule {}
