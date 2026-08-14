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
   * Varsayilan ACIK.
   *
   * Diger cron'lardan (INTEL_CRON, WEEKLY_PLAN_CRON) farkli olarak burada
   * varsayilan acik: bu bir raporlama ozelliginin VERI KAYNAGI. Kapali olursa
   * karsilastirma ekrani hicbir zaman dolmaz, yani ozellik yokmus gibi olur.
   * Kapatmak icin AUDIT_CRON=false.
   */
  private enabled(): boolean {
    return String(process.env.AUDIT_CRON ?? 'true').toLowerCase() !== 'false';
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

    let basarili = 0;
    let hatali = 0;
    for (const site of secilen) {
      try {
        await this.audit.runAudit(site.id, { trigger: 'system' });
        basarili++;
      } catch (err: any) {
        hatali++;
        this.log.warn(`[${site.id}] ${site.name} taranamadi: ${err.message}`);
      }
      // Tarama crawl + PageSpeed + 7 saglayici probe demek; siteler arasi ara
      // vermek hem dis servislerin rate limit'ini hem kendi CPU'muzu korur.
      await new Promise((r) => setTimeout(r, 5000));
    }

    this.log.log(`Haftalik tarama bitti: ${basarili} basarili, ${hatali} hatali`);
    return { taranan: basarili, hatali, atlanan };
  }
}
