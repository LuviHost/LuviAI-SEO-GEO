import { Module } from '@nestjs/common';
import { AdsController } from './ads.controller.js';
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
import { AdsBudgetGuardService } from './budget-guard.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { LLMModule } from '../llm/llm.module.js';

/**
 * Faz 11.2: Ads Manager — direkt resmi API entegrasyonu
 *
 * Google Ads + Meta Marketing API:
 *   - GoogleAdsClientService: GAQL + REST (surum tek yerde: google-ads-api.ts GOOGLE_ADS_API_VERSION), OAuth refresh token
 *   - MetaAdsClientService: Marketing API v21.0, long-lived access token (surum notu dosyada)
 *   - AdsClientService: platform router
 *   - Site bazli credential'lar (googleAdsRefreshToken / metaAdsAccessToken)
 *   - Otopilot: cron her 6 saat performans tarayip ROAS-bazli optimize;
 *     her butce artisi AdsBudgetGuardService'ten gecer (budget-guard.ts)
 *   - Kampanya Skoru LLM hakemi LLMProviderService'i dogrudan cagirir
 *     (eskiden ArticlesModule/agent-runner — bkz. ads-audit.service.ts)
 *
 * 3. parti SaaS yok (Ryze AI MCP kaldirildi). Sifir aboneligi.
 */
@Module({
  imports: [AuditModule, LLMModule],
  controllers: [AdsController],
  providers: [
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
    AdsBudgetGuardService,
  ],
  exports: [
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
    AdsBudgetGuardService,
  ],
})
export class AdsModule {}
