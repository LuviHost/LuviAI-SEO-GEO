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
import { SnippetGeneratorService } from './snippet-generator.service.js';
import { SnippetApplierService } from './snippet-applier.service.js';
import { StaticHtmlFixerService } from './static-html-fixer.service.js';
import { SitesModule } from '../sites/sites.module.js';

@Module({
  imports: [SitesModule],
  controllers: [AuditController],
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
    SnippetGeneratorService,
    SnippetApplierService,
    StaticHtmlFixerService,
  ],
})
export class AuditModule {}
