import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsCron } from './analytics.cron.js';
import { GaService } from './ga.service.js';
import { AuthModule } from '../auth/auth.module.js';

/**
 * Analytics — GSC günlük snapshot + GA4 davranış metrikleri.
 * Cron: her gece 02:00 UTC.
 */
@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsCron, GaService],
  exports: [AnalyticsService, GaService],
})
export class AnalyticsModule {}
