import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AffiliateService {
  private readonly log = new Logger(AffiliateService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────
  //  Affiliate enrollment
  // ─────────────────────────────────────────────

  async enroll(userId: string): Promise<{ refCode: string }> {
    const existing = await this.prisma.affiliate.findUnique({ where: { userId } });
    if (existing) return { refCode: existing.refCode };

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const refCode = this.generateRefCode(user.name ?? user.email);

    await this.prisma.affiliate.create({
      data: { userId, refCode },
    });

    return { refCode };
  }

  async getStats(userId: string) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { userId },
      include: {
        referrals: { orderBy: { clickedAt: 'desc' }, take: 50 },
      },
    });

    if (!affiliate) {
      return { enrolled: false };
    }

    return {
      enrolled: true,
      refCode: affiliate.refCode,
      shareUrl: `${process.env.WEB_BASE_URL ?? 'https://ai.luvihost.com'}?ref=${affiliate.refCode}`,
      totalReferred: affiliate.totalReferred,
      totalRevenue: affiliate.totalRevenue,
      totalCommission: affiliate.totalCommission,
      totalPaid: affiliate.totalPaid,
      pendingPayout: Number(affiliate.totalCommission) - Number(affiliate.totalPaid),
      referrals: affiliate.referrals,
    };
  }

  // ─────────────────────────────────────────────
  //  Click tracking — query string ?ref=CODE
  // ─────────────────────────────────────────────

  async trackClick(refCode: string): Promise<{ ok: boolean }> {
    const affiliate = await this.prisma.affiliate.findUnique({ where: { refCode } });
    if (!affiliate || !affiliate.active) return { ok: false };

    // Click sayısını refferal record'a yazıyoruz, signup yoksa pending kalır
    // Burada sadece "valid affiliate code" doğrularız — gerçek tracking
    // signup-time'da userId'yi referredUserId olarak yazar
    return { ok: true };
  }

  // ─────────────────────────────────────────────
  //  Signup'ta affiliate kayıt — User.referredByCode'tan
  // ─────────────────────────────────────────────

  async linkUserOnSignup(userId: string, refCode: string): Promise<void> {
    const affiliate = await this.prisma.affiliate.findUnique({ where: { refCode } });
    if (!affiliate || !affiliate.active) return;

    const commissionUntil = new Date(Date.now() + 90 * 86400000);

    await this.prisma.affiliateReferral.create({
      data: {
        affiliateId: affiliate.id,
        referredUserId: userId,
        signedUpAt: new Date(),
        commissionUntil,
        status: 'signed_up',
      },
    });

    await this.prisma.affiliate.update({
      where: { id: affiliate.id },
      data: { totalReferred: { increment: 1 } },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { referredByCode: refCode },
    });

    this.log.log(`Affiliate signup: ${userId} ← ${refCode}`);
  }

  // ─────────────────────────────────────────────
  //  Komisyon kaydet — invoice paid olduğunda
  // ─────────────────────────────────────────────

  async recordCommission(referredUserId: string, invoiceAmount: number): Promise<void> {
    const referral = await this.prisma.affiliateReferral.findFirst({
      where: {
        referredUserId,
        commissionUntil: { gt: new Date() },
      },
      include: { affiliate: true },
    });

    if (!referral) return;

    const commission = (invoiceAmount * Number(referral.affiliate.commissionPct)) / 100;

    await this.prisma.affiliateReferral.update({
      where: { id: referral.id },
      data: {
        firstPaidAt: referral.firstPaidAt ?? new Date(),
        totalCommissionEarned: { increment: commission },
        status: 'paid',
      },
    });

    await this.prisma.affiliate.update({
      where: { id: referral.affiliateId },
      data: {
        totalRevenue: { increment: invoiceAmount },
        totalCommission: { increment: commission },
      },
    });

    this.log.log(`Komisyon: ${referredUserId} → ${referral.affiliateId} = ₺${commission.toFixed(2)}`);
  }

  // ─────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────

  private generateRefCode(seed: string): string {
    const slug = seed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20);
    const suffix = Math.random().toString(36).slice(2, 6);
    return `${slug}-${suffix}`;
  }
}
