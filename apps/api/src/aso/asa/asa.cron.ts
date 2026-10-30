import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AsaService } from './asa.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { acquireCronLock } from '../../common/cron-lock.js';
import { siteWhereForFeatureOrAdmin } from '../../billing/plan-site-filter.js';
import { getAsaApiVersion, v5SunsetNotice } from './asa-client.factory.js';

/**
 * ASA Cron — Auto-Pilot + günlük performance sync.
 *
 * Cron'lar:
 *   - 03:30 (UTC) her gün → tüm enabled hesaplar için performance fetch
 *   - 04:30 (UTC) her gün → tüm Auto-Pilot enabled hesaplar için run
 *
 * API ve worker aynı AppModule'u ayağa kaldırdığı için @Cron iki proseste
 * birden tetiklenir. Auto-Pilot keyword pause/bid oluşturduğundan kilitsiz
 * hali müşterinin Apple Search Ads hesabında aynı kararı günde İKİ KEZ
 * uyguluyordu → acquireCronLock.
 *
 * Iki API surumuyle de calisir: servis istemciyi ASA_API_VERSION'a gore uretir
 * (asa-client.factory.ts). v5 kapanisi yaklasinca her kosuda uyari loglanir.
 */
@Injectable()
export class AsaCronService implements OnModuleInit {
  private readonly log = new Logger(AsaCronService.name);

  constructor(
    private readonly asa: AsaService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.log.log(`[asa] Apple Ads API sürümü: ${getAsaApiVersion()}`);
    this.warnIfV5Sunset();
  }

  private warnIfV5Sunset() {
    const notice = v5SunsetNotice(getAsaApiVersion());
    if (notice) this.log.warn(`[asa] ${notice}`);
  }

  /** Günlük performance fetch — 03:30 UTC */
  @Cron('30 3 * * *')
  async dailyPerformanceFetch() {
    if (!(await acquireCronLock(this.prisma, 'asa-perf-fetch', 'daily'))) return;
    this.warnIfV5Sunset();
    // Yalniz sahibinin planinda asaEnabled olan hesaplar (ADMIN sahipli dahil):
    // senkron musterinin Apple kimligiyle canli istek atar ve paneldeki
    // performans verisini tazeler; plani dusen hesapta durmali (eski veri
    // panelde okunabilir kalir).
    const accounts = await this.prisma.asaAccount.findMany({
      where: { isActive: true, site: siteWhereForFeatureOrAdmin('asaEnabled') },
    });
    this.log.log(`[asa-cron] daily perf fetch: ${accounts.length} hesap`);
    for (const acc of accounts) {
      try {
        // Ilk kosuda hesap basina bir kez geriye donuk doldurma (yukleme duzeltmesi)
        await this.asa.fetchPerformanceScheduled(acc.id);
      } catch (err: any) {
        this.log.error(`[asa-cron:perf:${acc.id}] ${err.message}`);
      }
    }
  }

  /** Auto-Pilot — 04:30 UTC (perf fetch'ten sonra çalışsın diye) */
  @Cron('30 4 * * *')
  async dailyAutoPilot() {
    if (!(await acquireCronLock(this.prisma, 'asa-auto-pilot', 'daily'))) return;
    this.warnIfV5Sunset();
    this.log.log('[asa-cron] auto-pilot start');
    await this.asa.runAllAutoPilots();
  }
}
