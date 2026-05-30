import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PublicCitationSubscriberService } from './public-citation-subscriber.service.js';

/**
 * Public AI Citation retest cron — gunluk 09:00 UTC
 *
 * nextRetestAt <= now olan ACTIVE subscriber'lari isler:
 *  - Fresh test yapar (cache bypass)
 *  - Delta hesaplar (subscribe oldugu gun ile bugun karsilastirir)
 *  - Branded email gonderir
 *  - Sonraki retest zamanini planlar (15/30/60/90g cycle)
 */
@Injectable()
export class PublicCitationRetestCron {
  private readonly log = new Logger(PublicCitationRetestCron.name);

  constructor(private readonly subscribers: PublicCitationSubscriberService) {}

  @Cron('0 9 * * *') // her gun 09:00
  async runDailyRetests() {
    this.log.log('[cron] public citation retest baslıyor');
    try {
      const stats = await this.subscribers.runScheduledRetests();
      this.log.log(`[cron] retest tamamlandi — islenen: ${stats.processed}, gonderildi: ${stats.sent}, basarisiz: ${stats.failed}`);
    } catch (err: any) {
      this.log.error(`[cron] retest hata: ${err.message}`);
    }
  }
}
