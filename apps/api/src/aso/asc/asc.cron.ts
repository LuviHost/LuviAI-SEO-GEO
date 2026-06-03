import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AscService } from './asc.service.js';

@Injectable()
export class AscCronService {
  private readonly log = new Logger(AscCronService.name);

  constructor(private readonly asc: AscService) {}

  /** Günlük 05:30 UTC — tüm ASC hesapları için sync (apps + releases + alerts) */
  @Cron('30 5 * * *')
  async dailyAscSync() {
    this.log.log('[asc-cron] daily sync start');
    await this.asc.runDailySyncAll();
  }
}
