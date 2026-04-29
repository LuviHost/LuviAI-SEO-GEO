import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { AuditChecksService } from './audit-checks.service.js';
import { PageSpeedService } from './pagespeed.service.js';
import { GeoRunnerService } from './geo-runner.service.js';
import { GeneratorsService } from './generators.service.js';
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
import { CrawlerTrackingMiddleware } from './crawler-tracking.middleware.js';
import { TrackerController } from './tracker.controller.js';
import { AiMentionAlarmService } from './ai-mention-alarm.service.js';
import { GeoScoreCardService } from './geo-score-card.service.js';
import { SchemaValidatorService } from './schema-validator.service.js';
import { AiSitemapService } from './ai-sitemap.service.js';
import { AuthorProfileService } from './author-profile.service.js';
import { HaroParserService } from './haro-parser.service.js';
import { EmailModule } from '../email/email.module.js';
import { SnippetGeneratorService } from './snippet-generator.service.js';
import { SnippetApplierService } from './snippet-applier.service.js';
import { StaticHtmlFixerService } from './static-html-fixer.service.js';
import { SitesModule } from '../sites/sites.module.js';

@Module({
  imports: [SitesModule, EmailModule],
  controllers: [AuditController, TrackerController],
  providers: [
    AuditService,
    AuditChecksService,
    PageSpeedService,
    GeoRunnerService,
    GeneratorsService,
    AutoFixService,
    AiCitationService,
    AiCitationTrackerService,
    AiIndexingPingerService,
    LlmsFullBuilderService,
    GeoHeatmapService,
    KnowledgeGraphBuilderService,
    KnowledgeSubmitterService,
    CommunityOutreachService,
    CrossLinkingService,
    TrainingDataExporterService,
    CrawlerAnalyticsService,
    CrawlerTrackingMiddleware,
    AiMentionAlarmService,
    GeoScoreCardService,
    SchemaValidatorService,
    AiSitemapService,
    AuthorProfileService,
    HaroParserService,
    SnippetGeneratorService,
    SnippetApplierService,
    StaticHtmlFixerService,
  ],
  exports: [
    AuditService,
    AutoFixService,
    GeoRunnerService,
    AiCitationService,
    AiCitationTrackerService,
    AiIndexingPingerService,
    LlmsFullBuilderService,
    GeoHeatmapService,
    KnowledgeGraphBuilderService,
    KnowledgeSubmitterService,
    CommunityOutreachService,
    CrossLinkingService,
    TrainingDataExporterService,
    CrawlerAnalyticsService,
    AiMentionAlarmService,
    GeoScoreCardService,
    SchemaValidatorService,
    AiSitemapService,
    AuthorProfileService,
    HaroParserService,
    SnippetGeneratorService,
    SnippetApplierService,
    StaticHtmlFixerService,
  ],
})
export class AuditModule {}
