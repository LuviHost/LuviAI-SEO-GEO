import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { PaytrService } from './paytr.service.js';
import { QuotaService } from './quota.service.js';
import { FxService } from './fx.service.js';
import { RenewalService } from './renewal.service.js';
import { EmailModule } from '../email/email.module.js';
import { MeasurementAllowanceService } from './measurement-allowance.service.js';
import { MeasurementSessionInterceptor } from './measurement-session.interceptor.js';

/**
 * PayTR + plan-based quota.
 * Global module — QuotaService her modülden inject edilebilir
 * (örn. ArticlesService.queueGeneration → enforceArticleQuota).
 */
@Global()
@Module({
  imports: [EmailModule],
  controllers: [BillingController],
  providers: [BillingService, PaytrService, QuotaService, FxService, RenewalService, MeasurementAllowanceService, MeasurementSessionInterceptor],
  exports: [BillingService, PaytrService, QuotaService, FxService, MeasurementAllowanceService, MeasurementSessionInterceptor],
})
export class BillingModule {}
