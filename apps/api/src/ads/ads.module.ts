import { Module } from '@nestjs/common';
import { AdsController } from './ads.controller.js';
import { AdGeneratorService } from './ad-generator.service.js';
import { AdImageGeneratorService } from './ad-image-generator.service.js';
import { AudienceBuilderService } from './audience-builder.service.js';
import { CampaignOrchestratorService } from './campaign-orchestrator.service.js';
import { AdsClientService } from './ads-client.service.js';
import { GoogleAdsClientService } from './google-ads-client.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';
import { PerformanceSyncService } from './performance-sync.service.js';
import { AbTestManagerService } from './ab-test-manager.service.js';
import { KeywordOptimizerService } from './keyword-optimizer.service.js';
import { BudgetShifterService } from './budget-shifter.service.js';
import { AutoBoostService } from './auto-boost.service.js';
import { AdsAuditService } from './ads-audit.service.js';
import { AdsSnapshotCollectorService } from './snapshot-collector.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { ArticlesModule } from '../articles/articles.module.js';

/**
 * Faz 11.2: Ads Manager — direkt resmi API entegrasyonu
 *
 * Google Ads + Meta Marketing API:
 *   - GoogleAdsClientService: GAQL + REST v18, OAuth refresh token
 *   - MetaAdsClientService: Marketing API v21.0, long-lived access token
 *   - AdsClientService: platform router
 *   - Site bazli credential'lar (googleAdsRefreshToken / metaAdsAccessToken)
 *   - Otopilot: cron her 6 saat performans tarayip ROAS-bazli optimize
 *
 * 3. parti SaaS yok (Ryze AI MCP kaldirildi). Sifir aboneligi.
 */
@Module({
  imports: [AuditModule, ArticlesModule],
  controllers: [AdsController],
  providers: [
    AdGeneratorService,
    AdImageGeneratorService,
    AudienceBuilderService,
    CampaignOrchestratorService,
    AdsClientService,
    GoogleAdsClientService,
    MetaAdsClientService,
    PerformanceSyncService,
    AbTestManagerService,
    KeywordOptimizerService,
    BudgetShifterService,
    AutoBoostService,
    AdsAuditService,
    AdsSnapshotCollectorService,
  ],
  exports: [
    AdGeneratorService,
    AdImageGeneratorService,
    AudienceBuilderService,
    CampaignOrchestratorService,
    AdsClientService,
    GoogleAdsClientService,
    MetaAdsClientService,
    PerformanceSyncService,
    AbTestManagerService,
    KeywordOptimizerService,
    BudgetShifterService,
    AutoBoostService,
    AdsAuditService,
  ],
})
export class AdsModule {}
