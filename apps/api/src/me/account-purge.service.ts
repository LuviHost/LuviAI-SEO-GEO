import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { isPurgeDue, purgeCutoff } from './account-deletion.policy.js';
import { collectPurgeIds, purgePlanProblems, purgeSteps } from './account-purge.plan.js';
import { deletionCompletedEmail } from './account-deletion.emails.js';

export interface PurgeUserResult {
  purged: boolean;
  /** purged=false ise neden: zaten silinmis, suresi dolmamis ya da talep geri alinmis */
  reason?: 'not_found' | 'not_due';
  /** Muhasebe icin saklanip kisiden koparilan fatura + odeme kaydi sayisi */
  retainedInvoices?: number;
  retainedCreditPurchases?: number;
}

/** Bir turda en fazla bu kadar hesap — birikme olursa ertesi gun kalanlar */
export const PURGE_MAX_PER_RUN = 200;
const PURGE_BATCH = 20;

/**
 * Silme talebinden 30 gun sonra hesabi kalici siler (gunluk is: account-purge.cron.ts).
 *
 * Tek dev transaction YOK: buyuk hesaplarda (on binlerce siralama satiri)
 * zaman asimina dusup her gun ayni yerde takilabilirdi. Adimlar idempotent;
 * yarida kalan silme ertesi turda tamamlanir. Kullanici satiri EN SON silinir,
 * o ana kadar hesap zaten kapali (AuthGuard + giris engeli).
 */
@Injectable()
export class AccountPurgeService {
  private readonly log = new Logger(AccountPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async purgeDue(now: Date = new Date()): Promise<{ purged: number; failed: number }> {
    // Bu turda islenip silinmeyenler (hata ya da yaris) ayni turda tekrar secilmez
    const handledIds: string[] = [];
    let purged = 0;
    let failed = 0;
    while (purged + handledIds.length < PURGE_MAX_PER_RUN) {
      const due = await this.prisma.user.findMany({
        where: {
          deletionRequestedAt: { not: null, lte: purgeCutoff(now) },
          ...(handledIds.length ? { id: { notIn: handledIds } } : {}),
        },
        orderBy: { deletionRequestedAt: 'asc' },
        select: { id: true },
        take: PURGE_BATCH,
      });
      if (due.length === 0) break;
      for (const u of due) {
        try {
          const r = await this.purgeUser(u.id, now);
          if (r.purged) purged++;
          else handledIds.push(u.id);
        } catch (err: any) {
          failed++;
          handledIds.push(u.id);
          this.log.error(`Hesap kalici silinemedi ${u.id}: ${String(err?.message ?? err).slice(0, 300)}`);
        }
      }
    }
    if (purged || failed) {
      this.log.log(`Hesap silme turu: ${purged} hesap kalici silindi, ${failed} hata (ertesi gun tekrar denenir)`);
    }
    return { purged, failed };
  }

  /** Tek hesabi kalici siler. Tekrar cagrilmasi guvenli: silinmis hesapta 'not_found' doner. */
  async purgeUser(userId: string, now: Date = new Date()): Promise<PurgeUserResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, deletionRequestedAt: true },
    });
    if (!user) return { purged: false, reason: 'not_found' };
    // Guvenlik: talep yoksa (geri alinmis) ya da 30 gun dolmamissa ASLA silme
    if (!isPurgeDue(user.deletionRequestedAt, now)) return { purged: false, reason: 'not_due' };

    const ids = await collectPurgeIds(this.prisma, user);
    const steps = purgeSteps(ids);
    // Geri alinamaz ve transaction'siz: once tum adimlar veritabanina dokunmadan
    // denetlenir; bos/undefined filtre ya da yanlis tablo varsa HICBIR sey silinmez
    // (bkz. account-purge.plan.ts purgePlanProblems). purgeDue hatayi loglar, hesap ertesi gun yeniden denenir.
    const problems = await purgePlanProblems(steps, ids);
    if (problems.length > 0) {
      throw new Error(`Kalıcı silme planı güvenlik denetiminden geçmedi (${problems.length} sorun): ${problems.slice(0, 3).join(' | ')}`);
    }
    let retainedInvoices = 0;
    let retainedCreditPurchases = 0;
    for (const step of steps) {
      const r = await step.run(this.prisma);
      if (step.model === 'Invoice') retainedInvoices = r.count;
      if (step.model === 'VideoCreditPurchase') retainedCreditPurchases = r.count;
    }
    this.log.log(`Hesap kalici silindi: ${userId} (${ids.siteIds.length} site; ${retainedInvoices} fatura + ${retainedCreditPurchases} ödeme kaydı anonim saklandı)`);

    await this.sendCompletedEmail(user.email, user.name);
    return { purged: true, retainedInvoices, retainedCreditPurchases };
  }

  /**
   * Silme tamamlandi onayi (Apple: "provide a confirmation when the deletion is complete").
   * Gonderim kaydi (email_logs.to) silinen kisinin e-postasini tasidigi icin hemen ardindan silinir.
   */
  private async sendCompletedEmail(to: string, name: string | null) {
    const startedAt = new Date();
    try {
      const { subject, html } = deletionCompletedEmail({ name, email: to, baseUrl: process.env.WEB_BASE_URL });
      await this.email.sendRaw({ to, subject, html });
    } catch (err: any) {
      this.log.warn(`Silme onay e-postası gönderilemedi: ${String(err?.message ?? err).slice(0, 160)}`);
    } finally {
      await this.prisma.emailLog
        .deleteMany({ where: { to, userId: null, createdAt: { gte: startedAt } } })
        .catch(() => undefined);
    }
  }
}
