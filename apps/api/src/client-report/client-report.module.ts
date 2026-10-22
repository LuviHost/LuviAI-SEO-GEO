import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ActionPlansModule } from '../action-plans/action-plans.module.js';
import { ClientReportService } from './client-report.service.js';
import { ClientReportController, PublicClientReportController } from './client-report.controller.js';

/**
 * Musteri raporu: derleme (ClientReportService) + sahip uclari + herkese acik
 * paylasim ucu. Veri kaynaklari AuditModule (tarama, AI KPI, AI olcum) ve
 * ActionPlansModule'den; QuotaService global BillingModule'den gelir.
 */
@Module({
  imports: [PrismaModule, AuditModule, ActionPlansModule],
  controllers: [ClientReportController, PublicClientReportController],
  providers: [ClientReportService],
  exports: [ClientReportService],
})
export class ClientReportModule {}
