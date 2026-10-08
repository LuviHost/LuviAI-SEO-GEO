import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AscService } from './asc.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { acquireCronLock } from '../../common/cron-lock.js';

@Injectable()
export class AscCronService {
  private readonly log = new Logger(AscCronService.name);

  constructor(
    private readonly asc: AscService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Günlük 05:30 UTC — tüm ASC hesapları için sync (apps + releases + alerts).
   * API + worker'da çift tetiklenmesin: kilitsizken her sürüm uyarısı iki kez
   * oluşuyordu.
   */
  @Cron('30 5 * * *')
  async dailyAscSync() {
    if (!(await acquireCronLock(this.prisma, 'asc-daily-sync', 'daily'))) return;
    this.log.log('[asc-cron] daily sync start');
    await this.asc.runDailySyncAll();
  }
}
