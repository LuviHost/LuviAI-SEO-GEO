import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { PaytrService } from './paytr.service.js';
import { QuotaService } from './quota.service.js';
import { FxService } from './fx.service.js';
import { EmailModule } from '../email/email.module.js';

/**
 * PayTR + plan-based quota.
 * Global module — QuotaService her modülden inject edilebilir
 * (örn. ArticlesService.queueGeneration → enforceArticleQuota).
 */
@Global()
@Module({
  imports: [EmailModule],
  controllers: [BillingController],
  providers: [BillingService, PaytrService, QuotaService, FxService],
  exports: [BillingService, PaytrService, QuotaService, FxService],
})
export class BillingModule {}
