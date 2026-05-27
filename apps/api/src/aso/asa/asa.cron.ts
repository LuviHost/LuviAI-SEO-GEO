import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AsaService } from './asa.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * ASA Cron — Auto-Pilot + günlük performance sync.
 *
 * Cron'lar:
 *   - 03:30 (UTC) her gün → tüm enabled hesaplar için performance fetch
 *   - 04:30 (UTC) her gün → tüm Auto-Pilot enabled hesaplar için run
 */
@Injectable()
export class AsaCronService {
  private readonly log = new Logger(AsaCronService.name);

  constructor(
    private readonly asa: AsaService,
    private readonly prisma: PrismaService,
  ) {}

  /** Günlük performance fetch — 03:30 UTC */
  @Cron('30 3 * * *')
  async dailyPerformanceFetch() {
    const accounts = await this.prisma.asaAccount.findMany({ where: { isActive: true } });
    this.log.log(`[asa-cron] daily perf fetch: ${accounts.length} hesap`);
    for (const acc of accounts) {
      try {
        await this.asa.fetchPerformance(acc.id, 7);
      } catch (err: any) {
        this.log.error(`[asa-cron:perf:${acc.id}] ${err.message}`);
      }
    }
  }

  /** Auto-Pilot — 04:30 UTC (perf fetch'ten sonra çalışsın diye) */
  @Cron('30 4 * * *')
  async dailyAutoPilot() {
    this.log.log('[asa-cron] auto-pilot start');
    await this.asa.runAllAutoPilots();
  }
}
