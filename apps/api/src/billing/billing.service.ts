import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FxService } from './fx.service.js';
import { BASE_PLANS, type BasePlan, type PlanId } from './plans.js';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Kanonik fiyat — USD */
  monthly: number;
  annual: number;
  currency: 'USD';
  /** Gunun TCMB kuruyla hesaplanmis TL karsiligi (gosterim icin) */
  monthlyTry: number;
  annualTry: number;
  articlesPerMonth: number;
  socialPostsPerMonth: number;
  videosPerMonth: number;
  sites: number;
  promptRunsPerMonth: number;
  llmResponsesPerMonth: number;
  publishTargets: 'limited' | 'all';
  support: string;
  popular?: boolean;
  /** Enterprise icin: pazarlama formuyla iletisime gecilir, dogrudan satin alma yok */
  contactSales?: boolean;
}

/**
 * Kur GEREKTIRMEYEN plan listesi (senkron erisim isteyen eski cagrilar icin).
 * TL alanlari 0'dir — TL tutari yalnizca FxService ile hesaplanabilir.
 * Fiyat gostermek icin getPlans() kullanin.
 */
export const PLANS: PlanDefinition[] = BASE_PLANS.map((p) => ({
  id: p.id,
  name: p.name_tr,
  monthly: p.monthly_usd,
  annual: p.annual_usd,
  currency: 'USD' as const,
  monthlyTry: 0,
  annualTry: 0,
  articlesPerMonth: p.articlesPerMonth,
  socialPostsPerMonth: p.socialPostsPerMonth,
  videosPerMonth: p.videosPerMonth,
  sites: p.sites,
  promptRunsPerMonth: p.promptRunsPerMonth,
  llmResponsesPerMonth: p.llmResponsesPerMonth,
  publishTargets: p.publishTargets,
  support: p.support_tr,
  popular: p.popular,
  contactSales: p.contactSales,
}));

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  /**
   * Plan listesi. Fiyat her iki locale'de de USD kanoniktir; locale yalnizca
   * plan adi ve destek metnini degistirir. TL tutari gosterim icin gunun
   * TCMB kuruyla hesaplanip `monthlyTry`/`annualTry` alanlarinda doner.
   */
  async getPlans(locale: 'tr' | 'en' = 'tr'): Promise<PlanDefinition[]> {
    // Fiyat USD kanonik; TL karsiligi gunun TCMB kuruyla HESAPLANIR.
    // Kur bir kez alinir — plan basina ayri cagri yapilirsa liste icinde
    // farkli kurlar karisabilirdi.
    const { rate } = await this.fx.getRate();

    return BASE_PLANS.map((p) => ({
      id: p.id,
      name: locale === 'tr' ? p.name_tr : p.name_en,
      monthly: p.monthly_usd,
      annual: p.annual_usd,
      currency: 'USD' as const,
      monthlyTry: Math.round(p.monthly_usd * rate),
      annualTry: Math.round(p.annual_usd * rate),
      articlesPerMonth: p.articlesPerMonth,
      socialPostsPerMonth: p.socialPostsPerMonth,
      videosPerMonth: p.videosPerMonth,
      sites: p.sites,
      promptRunsPerMonth: p.promptRunsPerMonth,
      llmResponsesPerMonth: p.llmResponsesPerMonth,
      publishTargets: p.publishTargets,
      support: locale === 'tr' ? p.support_tr : p.support_en,
      popular: p.popular,
      contactSales: p.contactSales,
    }));
  }

  /** Plan listesi + o an kullanilan kur (UI dipnotu icin birlikte doner) */
  async getPlansWithFx(locale: 'tr' | 'en' = 'tr') {
    const [plans, fx] = await Promise.all([this.getPlans(locale), this.fx.getRate()]);
    return { plans, fx };
  }

  async getCurrentPlan(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const planDef = PLANS.find(p => p.id.toUpperCase() === user.plan) ?? PLANS[0];
    return {
      plan: planDef,
      status: user.subscriptionStatus,
      trialEndsAt: user.trialEndsAt,
      articlesUsedThisMonth: user.articlesUsedThisMonth,
      articlesQuotaResetAt: user.articlesQuotaResetAt,
      // 2026-05 Premium Pricing — grandfathering bilgisi (frontend banner için)
      grandfatheredUntil: (user as any).grandfatheredUntil ?? null,
      legacyMonthlyPriceTry: (user as any).legacyMonthlyPriceTry ?? null,
    };
  }

  async getInvoices(userId: string) {
    return this.prisma.invoice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Kur bilgisi — UI'da "1 USD = X TL (TCMB, <tarih>)" dipnotu icin.
   * `stale: true` ise TCMB'ye ulasilamamis, son bilinen kur gosteriliyor demektir.
   */
  async getCurrentFxRate() {
    const fx = await this.fx.getRate();
    return { usdToTry: fx.rate, source: fx.source, fetchedAt: fx.fetchedAt, stale: fx.stale };
  }

  /**
   * Enterprise inquiry — pricing sayfasında contact form'dan gelir.
   * Email gönderir + DB'ye kaydeder.
   */
  async createEnterpriseInquiry(input: {
    name: string;
    email: string;
    company: string;
    phone?: string;
    teamSize?: string;
    message?: string;
    source?: string;
  }) {
    // DB kayıt — ayrı tablo varsa kullan, yoksa setting_audit_logs gibi generic
    try {
      await this.prisma.$executeRaw`
        INSERT INTO enterprise_inquiries
          (id, name, email, company, phone, teamSize, message, source, createdAt)
        VALUES
          (UUID(), ${input.name}, ${input.email}, ${input.company},
           ${input.phone ?? null}, ${input.teamSize ?? null},
           ${input.message ?? null}, ${input.source ?? 'pricing-page'}, NOW())
      `;
    } catch {
      // Tablo yoksa sessizce geç — email yine gider
    }

    return { ok: true, message: 'Talebiniz alındı, 24 saat içinde ulaşacağız' };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Video Credit Pool (2026-05 Premium Pricing add-on)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Kullanıcının PAID statüsünde + kullanılmamış credit'lerini topla.
   * Plan kotası dolduğunda video üretimi bu havuzdan düşer.
   *
   * Döner: totalRemaining (toplam kalan), packages (detay her satın alma)
   */
  async getVideoCreditPool(userId: string): Promise<{
    totalRemaining: number;
    totalPurchased: number;
    packages: Array<{ id: string; packSize: number; creditsUsed: number; remaining: number; paidAt: Date | null; expiresAt: Date | null }>;
  }> {
    const purchases = await this.prisma.videoCreditPurchase.findMany({
      where: {
        userId,
        status: 'PAID',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { paidAt: 'asc' }, // FIFO consumption
    });

    let totalRemaining = 0;
    let totalPurchased = 0;
    const packages = purchases.map((p) => {
      const remaining = Math.max(0, p.creditsTotal - p.creditsUsed);
      totalRemaining += remaining;
      totalPurchased += p.creditsTotal;
      return {
        id: p.id,
        packSize: p.packSize,
        creditsUsed: p.creditsUsed,
        remaining,
        paidAt: p.paidAt,
        expiresAt: p.expiresAt,
      };
    });

    return { totalRemaining, totalPurchased, packages };
  }

  /**
   * Bir video kullanıldığında çağrılır. FIFO: en eski PAID pack'ten 1 düş.
   * Plan kotası yetmediğinde quota.service.consumeVideo bunu çağırır.
   */
  async consumeOneVideoCredit(userId: string): Promise<{ consumed: boolean; remaining: number }> {
    const oldest = await this.prisma.videoCreditPurchase.findFirst({
      where: {
        userId,
        status: 'PAID',
        creditsUsed: { lt: this.prisma.videoCreditPurchase.fields?.creditsTotal as any },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { paidAt: 'asc' },
    });
    // Prisma raw fields karşılaştırması bazen sorunlu — guard:
    if (!oldest || oldest.creditsUsed >= oldest.creditsTotal) {
      return { consumed: false, remaining: 0 };
    }

    const updated = await this.prisma.videoCreditPurchase.update({
      where: { id: oldest.id },
      data: {
        creditsUsed: { increment: 1 },
        // Tüm credit tükendiğinde status'u CONSUMED'a çevir
        ...(oldest.creditsUsed + 1 >= oldest.creditsTotal ? { status: 'CONSUMED' as const } : {}),
      },
    });

    const pool = await this.getVideoCreditPool(userId);
    return { consumed: true, remaining: pool.totalRemaining };
  }
}
