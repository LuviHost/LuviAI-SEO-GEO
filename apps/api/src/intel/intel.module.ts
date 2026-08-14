import { Module } from '@nestjs/common';
import { LLMModule } from '../llm/llm.module.js';
import { IntelController } from './intel.controller.js';
import { IntelCollectorService } from './collector.service.js';
import { XSearchService } from './x-search.service.js';
import { OpenClawService } from './openclaw.service.js';
import { IntelTriageService } from './triage.service.js';
import { IntelAnalystService } from './analyst.service.js';
import { ClaimLedgerService } from './claim-ledger.service.js';
import { IntelDigestService } from './digest.service.js';
import { IntelCronService } from './intel.cron.js';

/**
 * Intel — sektor istihbarati boru hatti.
 *
 *   kaynak katalogu → toplama → triage (ucuz eleme) → analiz (kanit
 *   cikarimi) → iddia defteri → gunluk ozet
 *
 * Prisma/Settings/Email modulleri global oldugundan yalnizca LLMModule
 * ayrica import edilir.
 */
@Module({
  imports: [LLMModule],
  controllers: [IntelController],
  providers: [
    IntelCollectorService,
    XSearchService,
    OpenClawService,
    IntelTriageService,
    IntelAnalystService,
    ClaimLedgerService,
    IntelDigestService,
    IntelCronService,
  ],
  exports: [ClaimLedgerService, IntelDigestService],
})
export class IntelModule {}
