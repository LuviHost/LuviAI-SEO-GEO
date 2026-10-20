import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { referralLabel } from './referral-label.js';

/**
 * getStats secenekleri. revealContacts yalniz YONETICI icin (denetleyici rol bakar):
 * destek ve elle yapilan komisyon odemesinde davetlinin kim oldugu dogrulanir. Ortagin
 * kendisi davetlinin yalniz kisaltilmis etiketini gorur (referral-label.ts).
 */
export interface AffiliateStatsOptions {
  revealContacts?: boolean;
}

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

  /**
   * Ortaklik paneli verisi.
   *
   * KVKK veri minimizasyonu (referral-label.ts): ortaga (revealContacts yok) davetlilerin
   * tam adi, e-postasi ve baska kullanicilarin ic kimlikleri (referredUserId, 2. seviyede
   * affiliateId / parentUserId) GITMEZ; her satirda yalniz panelin gosterdigi kisaltilmis
   * etiket (referredLabel) ve davet olgulari durur. 2. seviyede komisyon yok: o satirlardaki
   * totalCommissionEarned / commissionUntil 1. seviyedeki kisinin kendi kazancidir, ortaga
   * gitmez. Ag grafigi 2. seviyeyi ust dugume parentReferralId (1. seviye davet kaydinin
   * kimligi) ile baglar. Yonetici (revealContacts) eski bicimi aynen alir.
   */
  async getStats(userId: string, opts: AffiliateStatsOptions = {}) {
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
    const tier2: any[] = [];
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

    // Tier 1 + tier 2'deki tum referredUserId'ler icin tek toplu sorgu: ad / e-posta yalniz
    // etiketi uretmek icin okunur (yoneticiye aynen gider, ortaga gitmez)
    const allRefUserIds = [
      ...tier1.map((r) => r.referredUserId),
      ...tier2.map((r) => r.referredUserId),
    ].filter((id): id is string => !!id);
    let userMap: Record<string, { name: string | null; email: string }> = {};
    if (allRefUserIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: Array.from(new Set(allRefUserIds)) } },
        select: { id: true, name: true, email: true },
      });
      userMap = Object.fromEntries(users.map((u) => [u.id, { name: u.name, email: u.email }]));
    }
    let tier1Enriched: unknown[];
    let tier2Enriched: unknown[];
    if (opts.revealContacts === true) {
      // Yonetici: eski bicim aynen (tam ad, e-posta, ic kimlikler)
      const enrich = (arr: any[]) => arr.map((r) => {
        const u = r.referredUserId ? userMap[r.referredUserId] : null;
        return {
          ...r,
          referredName: u?.name ?? null,
          referredEmail: u?.email ?? null,
        };
      });
      tier1Enriched = enrich(tier1.map((r) => ({ ...r, tier: 1 })));
      tier2Enriched = enrich(tier2);
    } else {
      const labelOf = (referredUserId: string | null | undefined) => {
        const u = referredUserId ? userMap[referredUserId] : null;
        return referralLabel(u?.name, u?.email);
      };
      // 2. seviye satirinin ust dugumu: 1. seviyedeki davet kaydinin kimligi (kullanici kimligi degil)
      const parentReferralOf = new Map<string, string>();
      for (const r of tier1) if (r.referredUserId) parentReferralOf.set(r.referredUserId, r.id);
      // Acik alan listesi: Prisma'ya yeni bir alan eklense de ortaga kendiliginden gitmez
      tier1Enriched = tier1.map((r) => ({
        id: r.id,
        tier: 1 as const,
        referredLabel: labelOf(r.referredUserId),
        status: r.status,
        clickedAt: r.clickedAt,
        signedUpAt: r.signedUpAt,
        firstPaidAt: r.firstPaidAt,
        commissionUntil: r.commissionUntil,
        totalCommissionEarned: r.totalCommissionEarned,
      }));
      tier2Enriched = tier2.map((r) => ({
        id: r.id,
        tier: 2 as const,
        parentReferralId: parentReferralOf.get(r.parentUserId) ?? null,
        referredLabel: labelOf(r.referredUserId),
        status: r.status,
        clickedAt: r.clickedAt,
        signedUpAt: r.signedUpAt,
        firstPaidAt: r.firstPaidAt,
      }));
    }

    return {
      enrolled: true,
      refCode: affiliate.refCode,
      shareUrl: `${process.env.WEB_BASE_URL ?? 'https://ranksup.ai'}?ref=${affiliate.refCode}`,
      totalReferred: affiliate.totalReferred,
      totalRevenue: affiliate.totalRevenue,
      totalCommission: affiliate.totalCommission,
      totalPaid: affiliate.totalPaid,
      pendingPayout: Number(affiliate.totalCommission) - Number(affiliate.totalPaid),
      referrals: tier1Enriched,
      tier2Referrals: tier2Enriched,
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
