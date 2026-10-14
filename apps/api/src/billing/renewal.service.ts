import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { PaytrService } from './paytr.service.js';
import { findPlan } from './plans.js';
import { periodEndFromInvoice } from './subscription-period.js';
import { decideRenewal, RENEWAL_GRACE_DAYS } from './renewal-policy.js';

const DAY_MS = 86_400_000;
const trDate = (d: Date) =>
  d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });

/**
 * Abonelik yenileme — her gun 05:00 (Istanbul), cift-calisma kilidiyle.
 *
 * Karar renewal-policy.ts'te (saf, testli); burasi yalniz uygular:
 *  - charge   → PaytrService.chargeStoredCard (kayitli karttan, Non3D)
 *  - notice   → "yenileme gerekli" e-postasi (karti kayitli olmayan abone)
 *  - downgrade→ plan deneme duzeyine
 */
@Injectable()
export class RenewalService {
  private readonly log = new Logger(RenewalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paytr: PaytrService,
    private readonly email: EmailService,
  ) {}

  @Cron('0 5 * * *', { timeZone: 'Europe/Istanbul' })
  async renewalCron() {
    if (!(await acquireCronLock(this.prisma, 'subscription-renewal', 'daily'))) return;
    await this.runRenewals();
  }

  async runRenewals(now: Date = new Date()) {
    const users = await this.prisma.user.findMany({
      where: { plan: { not: 'TRIAL' }, subscriptionStatus: { in: ['ACTIVE', 'PAST_DUE'] } },
      select: {
        id: true, email: true, name: true, role: true, plan: true, subscriptionStatus: true,
        autoRenew: true, paytrUtoken: true, renewalFailCount: true, renewalLastAttemptAt: true, renewalNoticeAt: true,
      },
    });
    const tally = { charge: 0, notice: 0, downgrade: 0 };

    for (const u of users) {
      try {
        const lastPaid = await this.prisma.invoice.findFirst({
          where: { userId: u.id, status: 'PAID' },
          orderBy: { paidAt: 'desc' },
          select: { paidAt: true, createdAt: true, description: true },
        });
        const periodEnd = periodEndFromInvoice(lastPaid);
        const action = decideRenewal({
          now,
          plan: u.plan,
          status: u.subscriptionStatus,
          isAdmin: u.role === 'ADMIN',
          periodEnd,
          recurringEnabled: this.paytr.recurringEnabled,
          autoRenew: u.autoRenew,
          hasUtoken: !!u.paytrUtoken,
          failCount: u.renewalFailCount,
          lastAttemptAt: u.renewalLastAttemptAt,
          noticeAt: u.renewalNoticeAt,
        });
        if (action === 'none') continue;
        tally[action]++;

        if (action === 'charge') {
          const r = await this.paytr.chargeStoredCard(u.id);
          this.log.log(`Yenileme cekimi ${u.id}: ${r.result}${r.reason ? ` (${r.reason})` : ''}`);
        } else if (action === 'notice') {
          await this.prisma.user.update({ where: { id: u.id }, data: { renewalNoticeAt: now } });
          const deadline = new Date(Math.max(periodEnd!.getTime(), now.getTime()) + RENEWAL_GRACE_DAYS * DAY_MS);
          if (u.email) {
            this.email.send({
              userId: u.id,
              to: u.email,
              template: 'renewal_required',
              data: {
                name: u.name ?? 'kullanıcı',
                planName: findPlan(u.plan.toLowerCase())?.name_tr ?? u.plan,
                periodEndText: periodEnd!.getTime() > now.getTime() ? trDate(periodEnd!) : null,
                deadlineText: trDate(deadline),
              },
            }).catch((err) => this.log.warn(`renewal_required mail: ${err.message}`));
          }
        } else if (action === 'downgrade') {
          await this.paytr.downgradeForNonPayment(u.id, 'yenileme ödemesi alınamadı');
        }
      } catch (err: any) {
        // Tek kullanicidaki hata digerlerini durdurmasin
        this.log.error(`Yenileme ${u.id} hata: ${err.message}`);
      }
    }
    if (tally.charge || tally.notice || tally.downgrade) {
      this.log.log(`Yenileme turu: ${tally.charge} çekim, ${tally.notice} e-posta, ${tally.downgrade} düşürme`);
    }
    return tally;
  }
}
