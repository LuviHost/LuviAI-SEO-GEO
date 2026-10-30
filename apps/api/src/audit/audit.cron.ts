import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from './audit.service.js';
import { acquireCronLock } from '../common/cron-lock.js';

/**
 * PERIYODIK SITE TARAMASI — "3 ay sonra farki gor" icin.
 *
 * NEDEN VAR: karsilastirma altyapisi (getHistory + compareAudits + delta
 * paneli) zaten calisiyordu ama KIMSE siteyi tekrar taramiyordu. Audit yalnizca
 * elle tetikleniyordu; sonuc olarak 11 sitenin 7'sinde TEK tarama vardi ve
 * "onceki taramaya gore ne degisti" sorusu cogu sitede cevapsizdi. Rapor
 * ozelligi, uzerinde calisacagi zaman serisi olmadan ise yaramiyor.
 *
 * Cost/kota notu: tarama crawl + PageSpeed (ucretsiz) ve AI citation probe'u
 * (LLM maliyeti) iceriyor. Citation SISTEM tetikli cagriliyor — kullanicinin
 * aylik gorunurluk kotasindan DUSMEZ, cunku bu taramayi kullanici istemedi.
 */
@Injectable()
export class AuditCron {
  private readonly log = new Logger(AuditCron.name);

  /** Ucretli planlar — TRIAL periyodik taramaya girmez (maliyet freni). */
  private static readonly PAID = ['STARTER', 'PRO', 'AGENCY', 'ENTERPRISE'];

  /** BullMQ'da buyuk sayi = dusuk oncelik; kullanici taramasi 5, kurulum 10 */
  private static readonly QUEUE_PRIORITY = 50;

  /** Ardisik siteler arasi gecikme — 100 site ~100 dakikaya yayilir */
  private static readonly STAGGER_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Kac site taranir — sessiz kirpma olmasin diye atlananlar loglanir. */
  private maxSites(): number {
    const raw = Number(process.env.AUDIT_CRON_MAX_SITES);
    return Number.isFinite(raw) && raw > 0 ? raw : 100;
  }

  /**
   * Varsayilan KAPALI — bilincli urun karari.
   *
   * Periyodik tarama her site icin crawl + PageSpeed + 7 saglayici probe
   * demek, yani otomatik ve surekli LLM maliyeti. Rapor kullanicinin ELLE
   * baslattigi taramalarla besleniyor: kullanici "Yeni tarama" der, sonucu
   * hemen gorur, gecmis listesine bir satir daha eklenir. Kimsenin bakmadigi
   * bir zamanlamayla token yakmanin karsiligi yok.
   *
   * Acmak isteyen AUDIT_CRON=true der; kod ve kilit hazir bekliyor.
   */
  private enabled(): boolean {
    return String(process.env.AUDIT_CRON ?? 'false').toLowerCase() === 'true';
  }

  /** Pazar 03:00 — hafta ici trafigi ve diger cron'lari rahatsiz etmesin. */
  @Cron('0 3 * * 0', { timeZone: 'Europe/Istanbul' })
  async weeklyAudit() {
    if (!this.enabled()) {
      this.log.log('Periyodik tarama atlandi (AUDIT_CRON=false)');
      return;
    }
    // API ve worker ayni AppModule'u bootstrap ediyor — kilit olmazsa her site
    // iki kez taranir, iki kat maliyet ve mukerrer Audit satiri olusur.
    if (!(await acquireCronLock(this.prisma, 'site-audit', 'weekly'))) return;

    const limit = this.maxSites();
    const uygun = await this.prisma.site.findMany({
      where: {
        status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any },
        user: { plan: { in: AuditCron.PAID as any } },
      },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });

    const secilen = uygun.slice(0, limit);
    const atlanan = uygun.length - secilen.length;
    this.log.log(`Haftalik tarama: ${secilen.length} site${atlanan > 0 ? ` (${atlanan} site tavana takildi)` : ''}`);

    // Tarama BU PROSESTE KOSMAZ, worker kuyruguna atilir (SITE_AUDIT). Cron
    // API'de de tetiklenir ve kilidi API kazanabilir; 100 sayfalik bir tarama
    // ~930 MB'a cikip API'nin pm2 bellek sinirini (800 MB) asti, API yeniden
    // basladi ve tum istekler 502 dondu. trigger 'system' is verisinde gider:
    // kullanicinin olcum hakki dusmez. Dusuk oncelik + kademeli gecikme:
    // kullanici taramalarinin onune gecmez, siteler ayni anda baslamaz (eskiden
    // siteler arasi 5 sn bekleniyordu; dis servis rate limit'i ve CPU).
    let kuyrukta = 0;
    let hatali = 0;
    for (const [i, site] of secilen.entries()) {
      try {
        await this.audit.queueAudit(site.id, {
          trigger: 'system',
          priority: AuditCron.QUEUE_PRIORITY,
          delay: i * AuditCron.STAGGER_MS,
        });
        kuyrukta++;
      } catch (err: any) {
        hatali++;
        this.log.warn(`[${site.id}] ${site.name} kuyruga atilamadi: ${err.message}`);
      }
    }

    this.log.log(`Haftalik tarama kuyruga atildi: ${kuyrukta} site, ${hatali} hatali`);
    return { kuyrukta, hatali, atlanan };
  }
}
