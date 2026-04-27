import { Global, Module } from '@nestjs/common';
import { AffiliateController } from './affiliate.controller.js';
import { AffiliateService } from './affiliate.service.js';

/**
 * Affiliate programı.
 * %30 komisyon, 3 ay süre, signup'tan sonra ödemelere bağlı.
 */
@Global()
@Module({
  controllers: [AffiliateController],
  providers: [AffiliateService],
  exports: [AffiliateService],
})
export class AffiliateModule {}
