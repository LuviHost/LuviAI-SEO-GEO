import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { FxService } from './fx.service.js';
import { PaytrService } from './paytr.service.js';
import { QuotaService } from './quota.service.js';

/**
 * PayTR + plan-based quota.
 * Global module — QuotaService her modülden inject edilebilir
 * (örn. ArticlesService.queueGeneration → enforceArticleQuota).
 */
@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService, FxService, PaytrService, QuotaService],
  exports: [BillingService, FxService, PaytrService, QuotaService],
})
export class BillingModule {}
