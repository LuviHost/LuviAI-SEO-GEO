import { Module } from '@nestjs/common';
import { AsoController } from './aso.controller.js';
import { AsoService } from './aso.service.js';
import { AsoScrapersService } from './scrapers.service.js';
import { AsoKeywordService } from './keyword.service.js';
import { AsoTrackerService } from './tracker.service.js';
import { AsoReviewsService } from './reviews.service.js';
import { AsoAiAgentService } from './ai-agent.service.js';
import { AsoScreenshotService } from './screenshot.service.js';
import { ASOScorerService } from './aso-scorer.service.js';
import { ItunesApiClient } from './itunes-api.client.js';
import { AsoKeywordAnalyzerService } from './aso-keyword-analyzer.service.js';
import { AsoReviewAnalyzerService } from './aso-review-analyzer.service.js';
import { AsoMetadataOptimizerService } from './aso-metadata-optimizer.service.js';
import { AsoLocalizationHelperService } from './aso-localization-helper.service.js';
import { AsoAbTestPlannerService } from './aso-ab-test-planner.service.js';
import { AsoLaunchChecklistService } from './aso-launch-checklist.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LLMModule } from '../llm/llm.module.js';

@Module({
  imports: [PrismaModule, LLMModule],
  controllers: [AsoController],
  providers: [
    AsoService,
    AsoScrapersService,
    AsoKeywordService,
    AsoTrackerService,
    AsoReviewsService,
    AsoAiAgentService,
    AsoScreenshotService,
    ASOScorerService,
    ItunesApiClient,
    // claude-code-aso-skill ports
    AsoKeywordAnalyzerService,
    AsoReviewAnalyzerService,
    AsoMetadataOptimizerService,
    AsoLocalizationHelperService,
    AsoAbTestPlannerService,
    AsoLaunchChecklistService,
  ],
  exports: [
    AsoService, AsoTrackerService, AsoScreenshotService,
    ASOScorerService, ItunesApiClient,
    AsoKeywordAnalyzerService, AsoReviewAnalyzerService,
    AsoMetadataOptimizerService, AsoLocalizationHelperService,
    AsoAbTestPlannerService, AsoLaunchChecklistService,
  ],
})
export class AsoModule {}
