import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { AccountPurgeService } from './account-purge.service.js';

/**
 * Hesap kalici silme — her gun 03:45 (Istanbul), cift-calisma kilidiyle.
 *
 * API ve worker ayni AppModule'u yukledigi icin @Cron iki proseste birden
 * tetiklenir; gunluk kilit (kv_store) yalniz birinin calismasina izin verir.
 * Saat diger gece islerinden (04:00 deneme bitisi, 04:15 iptal dusurme,
 * 05:00 yenileme) once: silinecek hesap o turlara hic girmesin.
 */
@Injectable()
export class AccountPurgeCron {
  private readonly log = new Logger(AccountPurgeCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly purge: AccountPurgeService,
  ) {}

  @Cron('45 3 * * *', { timeZone: 'Europe/Istanbul' })
  async run() {
    if (!(await acquireCronLock(this.prisma, 'account-purge', 'daily'))) return;
    try {
      await this.purge.purgeDue();
    } catch (err: any) {
      this.log.error(`Hesap silme turu basarisiz: ${String(err?.message ?? err).slice(0, 300)}`);
    }
  }
}
