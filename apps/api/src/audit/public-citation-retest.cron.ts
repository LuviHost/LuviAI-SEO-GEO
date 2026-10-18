import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { PublicCitationSubscriberService } from './public-citation-subscriber.service.js';

/**
 * Public AI Citation retest cron — gunluk 09:00 UTC
 *
 * nextRetestAt <= now olan ACTIVE subscriber'lari isler:
 *  - Taze olcum yapar (cache bypass) — abonelik tabaninin AYNI soru setiyle
 *  - Yalniz o tabanla kiyaslar; soru seti, kademe ya da yontem surumu
 *    (CITATION_MATCH_VERSION) farkliysa fark hesaplanmaz, e-posta notr not
 *    tasir (PublicCitationService.compareWithBaseline)
 *  - Branded email gonderir
 *  - Sonraki retest zamanini planlar (15/30/60/90g cycle)
 *
 * CIFT CALISMA KILIDI: worker ayni AppModule'u (ScheduleModule dahil) ayaga
 * kaldirdigi icin bu @Cron API ve worker'da AYNI ANDA tetiklenir (cron-lock.ts).
 * Kilit yokken iki surec ayni aboneleri bulup ikiser olcum yapiyor ve aboneye
 * ayni raporu iki kez gonderiyordu.
 */
@Injectable()
export class PublicCitationRetestCron {
  private readonly log = new Logger(PublicCitationRetestCron.name);

  constructor(
    private readonly subscribers: PublicCitationSubscriberService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron('0 9 * * *') // her gun 09:00
  async runDailyRetests() {
    if (!(await acquireCronLock(this.prisma, 'public-citation-retest', 'daily'))) return;
    this.log.log('[cron] public citation retest baslıyor');
    try {
      const stats = await this.subscribers.runScheduledRetests();
      this.log.log(`[cron] retest tamamlandi — islenen: ${stats.processed}, gonderildi: ${stats.sent}, basarisiz: ${stats.failed}`);
    } catch (err: any) {
      this.log.error(`[cron] retest hata: ${err.message}`);
    }
  }
}
