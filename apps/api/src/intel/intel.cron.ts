import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { IntelCollectorService } from './collector.service.js';
import { IntelTriageService } from './triage.service.js';
import { IntelAnalystService } from './analyst.service.js';
import { ClaimLedgerService } from './claim-ledger.service.js';
import { IntelDigestService } from './digest.service.js';

/**
 * Intel boru hatti zamanlamasi — GUNDE BIR RAPOR.
 *
 * Kullanicinin gordugu sey gunde tek bir ozettir (TR 09:30). Zincirin
 * pahali asamalari da gunde tek tur calisir: triage → analiz → defter
 * yeniden tartimi → ozet, hepsi sabah bir saat icinde.
 *
 * TEK ISTISNA TOPLAMA. Gunde bir kez cekmek KAYIP demek — feed
 * pencereleri olculdu:
 *   Search Engine Land : ~5 SAAT  (gunde ~44 yazi)   ← gunde 1 cekimde %80 kayip
 *   r/SEO              : 1.2 gun  (gunde ~20 gonderi)
 *   diger 26 kaynak    : 3-330 gun
 * Toplama LLM'e dokunmadigi icin bedava; 3 saatte bir calisir ve her
 * kaynagin kendi intervalHours degeri ikinci fren olur (cogu kaynak
 * fiilen gunde bir kez cekilir, yalnizca SEL her turda).
 *
 * Asamalarin ayri cron olmasi kasitli: analiz hatasi toplamayi
 * durdurmasin, toplama her turda LLM maliyeti dogurmasin.
 */

/** Kapatma anahtari — sorun cikarsa deploy beklemeden durdurulabilsin */
const isDisabled = () => process.env.INTEL_ENABLED === 'false';

@Injectable()
export class IntelCronService implements OnModuleInit {
  private readonly log = new Logger(IntelCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: IntelCollectorService,
    private readonly triage: IntelTriageService,
    private readonly analyst: IntelAnalystService,
    private readonly ledger: ClaimLedgerService,
    private readonly digest: IntelDigestService,
  ) {}

  /**
   * Katalog kodda yasar, DB'de yansimasi olur. Acilista senkron ki yeni
   * eklenen bir kaynak deploy ile birlikte devreye girsin.
   */
  async onModuleInit(): Promise<void> {
    if (isDisabled()) return;
    try {
      const res = await this.collector.syncCatalog();
      if (res.created > 0 || res.retired > 0) {
        this.log.log(`Kaynak katalogu: ${res.created} yeni, ${res.updated} guncel, ${res.retired} kapatildi`);
      }
    } catch (err: any) {
      this.log.warn(`Katalog senkronu basarisiz: ${err.message}`);
    }
  }

  /**
   * TOPLAMA — 3 saatte bir. Bedava (LLM yok); dar pencereli feed'lerin
   * kaybolmamasi icin sik. Kaynak bazli intervalHours gercek frekansi
   * belirler.
   */
  @Cron('0 */3 * * *')
  async collect(): Promise<void> {
    if (isDisabled()) return;
    if (!(await acquireCronLock(this.prisma, 'intel-collect', 'hourly'))) return;

    try {
      const res = await this.collector.collectDue();
      if (res.sources > 0) {
        this.log.log(`Toplama: ${res.sources} kaynak, ${res.newItems} yeni kayit, ${res.errors} hata`);
      }
    } catch (err: any) {
      this.log.error(`Toplama cron hatasi: ${err.message}`);
    }
  }

  /** TRIAGE — gunde 1 kez, 05:20 UTC (TR 08:20). Ucuz modelle eleme. */
  @Cron('20 5 * * *')
  async triageRun(): Promise<void> {
    if (isDisabled()) return;
    if (!(await acquireCronLock(this.prisma, 'intel-triage', 'daily'))) return;

    try {
      const res = await this.triage.runPending();
      if (res.processed > 0) {
        this.log.log(`Triage: ${res.processed} kayit elendi, ${res.relevant} alakali`);
      }
    } catch (err: any) {
      this.log.error(`Triage cron hatasi: ${err.message}`);
    }
  }

  /**
   * ANALIZ — gunde 1 kez, 05:50 UTC (TR 08:50). Boru hattinin en pahali
   * ucu (Opus + tam metin), bu yuzden gunluk tek tur ve INTEL_ANALYZE_LIMIT
   * tavani var.
   */
  @Cron('50 5 * * *')
  async analyze(): Promise<void> {
    if (isDisabled()) return;
    if (!(await acquireCronLock(this.prisma, 'intel-analyze', 'daily'))) return;

    try {
      const res = await this.analyst.runRelevant();
      if (res.analyzed > 0) {
        this.log.log(`Analiz: ${res.analyzed} yayin, ${res.claims} iddia/kanit, ${res.failed} hata`);
      }
    } catch (err: any) {
      this.log.error(`Analiz cron hatasi: ${err.message}`);
    }
  }

  /**
   * GUNLUK OZET — 06:30 UTC (TR 09:30). Zincirin son halkasi.
   *
   * Once TUM defter yeniden tartilir: tazelik carpani zamanla dustugu
   * icin yeni kanit gelmese bile durumlar kayar (CONFIRMED → STALE) ve
   * ozet bunu yakalamali. Sonra ozet uretilip e-postalanir.
   */
  @Cron('30 6 * * *')
  async dailyDigest(): Promise<void> {
    if (isDisabled()) return;
    if (!(await acquireCronLock(this.prisma, 'intel-digest-daily', 'daily'))) return;

    try {
      const re = await this.ledger.recomputeAll();
      if (re.changed > 0) {
        this.log.log(`Defter yeniden tartildi: ${re.scanned} iddia, ${re.changed} durum degisti`);
      }
      const res = await this.digest.build('daily');
      this.log.log(`Gunluk ozet uretildi: ${res.stats.claimsTouched} iddia guncel`);
    } catch (err: any) {
      this.log.error(`Gunluk ozet hatasi: ${err.message}`);
    }
  }

  /**
   * HAFTALIK OZET — Pazartesi 07:00 UTC (TR 10:00). Gunluk ozet gunun
   * degisimini verir; haftalik olan trendi gosterir (hangi iddia bu
   * hafta yon degistirdi).
   */
  @Cron('0 7 * * 1')
  async weeklyDigest(): Promise<void> {
    if (isDisabled()) return;
    if (!(await acquireCronLock(this.prisma, 'intel-digest-weekly', 'weekly'))) return;

    try {
      const res = await this.digest.build('weekly');
      this.log.log(`Haftalik ozet uretildi: ${res.stats.claimsTouched} iddia guncel`);
    } catch (err: any) {
      this.log.error(`Haftalik ozet hatasi: ${err.message}`);
    }
  }

  /**
   * TEMIZLIK — alakasiz bulunmus eski kayitlari siler. Analiz edilenler
   * ve kanit tasiyanlar KALIR: kanit zincirinin kaynagi silinirse iddia
   * defteri denetlenemez hale gelir.
   */
  @Cron('0 4 * * 0')
  async purge(): Promise<void> {
    if (isDisabled()) return;
    if (!(await acquireCronLock(this.prisma, 'intel-purge', 'weekly'))) return;

    const cutoff = new Date(Date.now() - 90 * 86_400_000);
    try {
      const res = await this.prisma.intelItem.deleteMany({
        where: { status: 'IRRELEVANT', createdAt: { lt: cutoff }, evidences: { none: {} } },
      });
      if (res.count > 0) this.log.log(`Temizlik: ${res.count} alakasiz kayit silindi`);
    } catch (err: any) {
      this.log.warn(`Temizlik hatasi: ${err.message}`);
    }
  }
}
