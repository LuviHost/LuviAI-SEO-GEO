import { Module } from '@nestjs/common';
import { AdsController } from './ads.controller.js';
import { AdGeneratorService } from './ad-generator.service.js';
import { AdImageGeneratorService } from './ad-image-generator.service.js';
import { AudienceBuilderService } from './audience-builder.service.js';
import { CampaignOrchestratorService } from './campaign-orchestrator.service.js';
import { AdsMcpClientService } from './mcp-client.service.js';

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
  controllers: [AdsController],
  providers: [
    AdGeneratorService,
    AdImageGeneratorService,
    AudienceBuilderService,
    CampaignOrchestratorService,
    AdsMcpClientService,
  ],
  exports: [
    AdGeneratorService,
    AdImageGeneratorService,
    AudienceBuilderService,
    CampaignOrchestratorService,
    AdsMcpClientService,
  ],
})
export class AdsModule {}
