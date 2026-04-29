import { Module } from '@nestjs/common';
import { AdsController } from './ads.controller.js';
import { AdGeneratorService } from './ad-generator.service.js';
import { AdImageGeneratorService } from './ad-image-generator.service.js';
import { AudienceBuilderService } from './audience-builder.service.js';
import { CampaignOrchestratorService } from './campaign-orchestrator.service.js';
import { AdsMcpClientService } from './mcp-client.service.js';
import { PerformanceSyncService } from './performance-sync.service.js';
import { AbTestManagerService } from './ab-test-manager.service.js';
import { KeywordOptimizerService } from './keyword-optimizer.service.js';
import { BudgetShifterService } from './budget-shifter.service.js';
import { AutoBoostService } from './auto-boost.service.js';
import { AuditModule } from '../audit/audit.module.js';

/**
 * Faz 11: Ads Manager
 *
 * Google Ads + Meta Ads + GA4 entegrasyonu:
 *   - irinabuht12-oss/google-meta-ads-ga4-mcp uzerinden 250+ tool
 *   - Anthropic Claude SDK 'mcp_servers' parametresi ile baglanir
 *   - Site bazli endpoint + token (Site.adsMcpEndpoint / adsMcpToken)
 *   - Otopilot: cron her 6 saat performans tarayip ROAS-bazli optimize
 */
@Module({
  imports: [AuditModule],
  controllers: [AdsController],
  providers: [
    AdGeneratorService,
    AdImageGeneratorService,
    AudienceBuilderService,
    CampaignOrchestratorService,
    AdsMcpClientService,
    PerformanceSyncService,
    AbTestManagerService,
    KeywordOptimizerService,
    BudgetShifterService,
    AutoBoostService,
  ],
  exports: [
    AdGeneratorService,
    AdImageGeneratorService,
    AudienceBuilderService,
    CampaignOrchestratorService,
    AdsMcpClientService,
    PerformanceSyncService,
    AbTestManagerService,
    KeywordOptimizerService,
    BudgetShifterService,
    AutoBoostService,
  ],
})
export class AdsModule {}
