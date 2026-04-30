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

    // Tier 1 — kullanicinin dogrudan davet ettigi kullanicilar
    const tier1 = affiliate.referrals;
    const tier1UserIds = tier1.map((r) => r.referredUserId).filter((id): id is string => !!id);

    // Tier 2 — tier 1'deki kullanicilarin kendi affiliate hesaplarinin referrals'i
    // (multi-level network: davetlim de affiliate olduysa, onun davetlileri benim 2. seviyem)
    let tier2: any[] = [];
    if (tier1UserIds.length > 0) {
      const subAffiliates = await this.prisma.affiliate.findMany({
        where: { userId: { in: tier1UserIds } },
        include: {
          referrals: { orderBy: { clickedAt: 'desc' }, take: 30 },
        },
      });
      for (const sub of subAffiliates) {
        for (const r of sub.referrals) {
          tier2.push({ ...r, tier: 2, parentUserId: sub.userId });
        }
      }
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
      referrals: tier1.map((r) => ({ ...r, tier: 1 })),
      tier2Referrals: tier2,
      networkSize: tier1.length + tier2.length,
      networkLevels: tier2.length > 0 ? 2 : (tier1.length > 0 ? 1 : 0),
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
