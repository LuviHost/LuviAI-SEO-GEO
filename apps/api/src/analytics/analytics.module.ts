import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsCron } from './analytics.cron.js';
import { GaService } from './ga.service.js';
import { ReportsService } from './reports.service.js';
import { SiteReportService } from './site-report.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { LandingAnalyticsController } from './landing-analytics.controller.js';
import { LandingAnalyticsService } from './landing-analytics.service.js';
import { LookerController } from './looker.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';

/**
 * Analytics — GSC günlük snapshot + GA4 davranış metrikleri.
 * Cron: her gece 02:00 UTC.
 * Reports — haftalik/aylik/yillik ozet + CSV export.
 * Landing — anonim funnel tracking (kendi sistemimiz).
 */
@Module({
  imports: [AuditModule, AuthModule, PrismaModule],
  controllers: [AnalyticsController, LandingAnalyticsController, LookerController],
  providers: [AnalyticsService, AnalyticsCron, GaService, ReportsService, SiteReportService, LandingAnalyticsService],
  exports: [AnalyticsService, GaService, ReportsService, SiteReportService, LandingAnalyticsService],
})
export class AnalyticsModule {}
