import { Module } from '@nestjs/common';
import { LLMModule } from '../llm/llm.module.js';
import { IntelController } from './intel.controller.js';
import { IntelCollectorService } from './collector.service.js';
import { XSearchService } from './x-search.service.js';
import { OpenClawService } from './openclaw.service.js';
import { XCurationService } from './x-curation.service.js';
import { IntelTriageService } from './triage.service.js';
import { IntelAnalystService } from './analyst.service.js';
import { ClaimLedgerService } from './claim-ledger.service.js';
import { IntelDigestService } from './digest.service.js';
import { IntelCronService } from './intel.cron.js';
import { IntelActionService } from './intel-action.service.js';
import { ActionPlansModule } from '../action-plans/action-plans.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { LinkedinOutreachService } from './linkedin-outreach.service.js';
import { ProspectModule } from '../prospect/prospect.module.js';

/**
 * Intel — sektor istihbarati boru hatti.
 *
 *   kaynak katalogu → toplama → triage (ucuz eleme) → analiz (kanit
 *   cikarimi) → iddia defteri → gunluk ozet
 *
 * Prisma/Settings/Email modulleri global oldugundan yalnizca LLMModule
 * ayrica import edilir. NotificationsModule: LinkedIn botu cevap/duraklatma
 * bildirimi icin (global degil).
 */
@Module({
  imports: [ProspectModule, LLMModule, ActionPlansModule, NotificationsModule],
  controllers: [IntelController],
  providers: [
    IntelCollectorService,
    XSearchService,
    OpenClawService,
    XCurationService,
    IntelTriageService,
    IntelAnalystService,
    ClaimLedgerService,
    IntelDigestService,
    IntelCronService,
    IntelActionService,
    LinkedinOutreachService,
  ],
  exports: [ClaimLedgerService, IntelDigestService],
})
export class IntelModule {}
