import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { PaytrService } from './paytr.service.js';
import { QuotaService } from './quota.service.js';

/**
 * PayTR entegrasyonu — Faz 2.
 *  - PaytrService: token üretme + iframe + webhook handler
 *  - BillingService: subscription state machine
 *  - QuotaService: kullanıcının makale/ay limit takibi
 */
@Module({
  controllers: [BillingController],
  providers: [BillingService, PaytrService, QuotaService],
  exports: [BillingService, QuotaService],
})
export class BillingModule {}
