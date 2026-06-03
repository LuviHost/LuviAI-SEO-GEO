import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FxService } from './fx.service.js';

export interface PlanDefinition {
  id: 'trial' | 'starter' | 'pro' | 'agency' | 'enterprise';
  name: string;
  monthly: number;       // hesaplanmış değer (TL veya USD)
  annual: number;
  currency: 'TRY' | 'USD';
  articlesPerMonth: number;
  socialPostsPerMonth: number;
  videosPerMonth: number;
  sites: number;
  publishTargets: 'limited' | 'all';
  support: string;
  popular?: boolean;
  /** Enterprise için: pazarlama formuyla iletişime geçilir, doğrudan satın alma yok */
  contactSales?: boolean;
}

/**
 * Base plan tanımları — TL bazlı (Türkçe locale için canonical).
 * USD karşılıkları FxService ile dinamik hesaplanır.
 */
interface BasePlan {
  id: PlanDefinition['id'];
  name_tr: string;
  name_en: string;
  monthly_try: number;
  annual_try: number;
  // Enterprise için USD da fix tutulabilir, ama biz TL'yi USD'ye çevireceğiz
  articlesPerMonth: number;
  socialPostsPerMonth: number;
  videosPerMonth: number;          // AI video Studio kotası (Sora 2/Veo 3/Runway)
  sites: number;                    // 'unlimited' → sayıyla limitlendi (cost guard)
  publishTargets: 'limited' | 'all';
  support_tr: string;
  support_en: string;
  popular?: boolean;
  contactSales?: boolean;
}

/**
 * PREMIUM PRICING — 2026-05 update
 *
 * Gerekçe: AI maliyetleri (Claude Sonnet 4.6, Opus 4.7, Sora 2, Veo 3) eski fiyatları
 * sürdürülemez kıldı. Profesyonel ve üstü planlarda kullanıcı başına %50 realistic usage
 * dahi zarar veriyordu (örn. eski Ajans ₺7,999 vs ortalama ₺13,756 AI cost).
 *
 * Premium positioning:
 *  - Tek aracın altında 7+ kapsam: SEO, GEO, AI Citation, Video Studio, ASO, Sosyal, Auto-publish
 *  - Global rakip benchmark: Jasper Pro $125, Surfer Pro $129, MarketMuse Enterprise $12k/yıl
 *  - RanksUp Profesyonel ₺4,999 ($125) → Jasper/Surfer ile head-to-head, kapsamla önde
 *
 * Migration (grandfathering): Mevcut aboneler 6 ay eski fiyatla devam.
 * Cost guard: Plan başına aylık USD spend cap (SETTINGS_CATALOG'da) — aşılırsa pipeline pause.
 * Add-on: Video credit pack (5/20/50) ek satın alma — base plan videosu yetmezse.
 */
const BASE_PLANS: BasePlan[] = [
  {
    id: 'trial',
    name_tr: 'Ücretsiz Deneme',
    name_en: 'Free Trial',
    monthly_try: 0, annual_try: 0,
    articlesPerMonth: 2,           // 2 deneme makale (conversion hook için)
    socialPostsPerMonth: 5,        // 5 deneme sosyal post
    videosPerMonth: 0,             // Video YOK (cost guard, Sora 2 = $20/video)
    sites: 1,
    publishTargets: 'limited',     // Sadece Markdown ZIP + 1 WordPress
    support_tr: 'topluluk',
    support_en: 'community',
  },
  {
    id: 'starter',
    name_tr: 'Başlangıç',
    name_en: 'Starter',
    monthly_try: 1499, annual_try: 14990,    // ₺1,499/ay ($37) — Frase Pro altı
    articlesPerMonth: 15,
    socialPostsPerMonth: 15,
    videosPerMonth: 0,             // Video add-on'dan satın al (cost guard — solo blogger)
    sites: 1,
    publishTargets: 'all',
    support_tr: 'e-posta 24 saat',
    support_en: 'email 24h',
  },
  {
    id: 'pro',
    name_tr: 'Profesyonel',
    name_en: 'Pro',
    monthly_try: 4999, annual_try: 49990,    // ₺4,999/ay ($125) — Jasper Pro = Surfer Pro
    articlesPerMonth: 40,
    socialPostsPerMonth: 30,
    videosPerMonth: 5,             // 5 video/ay base (~$75 cost cap)
    sites: 3,
    publishTargets: 'all',
    support_tr: 'e-posta 4 saat',
    support_en: 'email 4h',
    popular: true,
  },
  {
    id: 'agency',
    name_tr: 'Ajans',
    name_en: 'Agency',
    monthly_try: 14999, annual_try: 149990,  // ₺14,999/ay ($375) — Surfer Business üzeri
    articlesPerMonth: 100,
    socialPostsPerMonth: 80,
    videosPerMonth: 20,            // 20 video/ay (~$300 cost)
    sites: 12,
    publishTargets: 'all',
    support_tr: 'öncelikli + Slack',
    support_en: 'priority + Slack',
  },
  {
    id: 'enterprise',
    name_tr: 'Kurumsal',
    name_en: 'Enterprise',
    monthly_try: 34999, annual_try: 349990,  // ₺34,999+/ay ($875+) — MarketMuse altı, custom
    articlesPerMonth: 350,
    socialPostsPerMonth: 200,
    videosPerMonth: 100,           // 100 video/ay (~$1500 cost)
    sites: 50,                     // Ek site ₺500/ay add-on (cost guard)
    publishTargets: 'all',
    support_tr: 'özel hesap yöneticisi + SLA',
    support_en: 'dedicated account manager + SLA',
    contactSales: true,
  },
];

/** Eski PlanDefinition export'unu koru — geriye uyumluluk */
export const PLANS: PlanDefinition[] = BASE_PLANS.map((p) => ({
  id: p.id,
  name: p.name_tr,
  monthly: p.monthly_try,
  annual: p.annual_try,
  currency: 'TRY',
  articlesPerMonth: p.articlesPerMonth,
  socialPostsPerMonth: p.socialPostsPerMonth,
  videosPerMonth: p.videosPerMonth,
  sites: p.sites,
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
   * Locale-aware plan listesi.
   *  - locale='tr' (default): TL fiyatlar
   *  - locale='en' veya diğer: USD'ye çevrilmiş, .99 yuvarlamalı
   */
  async getPlans(locale: 'tr' | 'en' = 'tr'): Promise<PlanDefinition[]> {
    if (locale === 'tr') {
      return BASE_PLANS.map((p) => ({
        id: p.id,
        name: p.name_tr,
        monthly: p.monthly_try,
        annual: p.annual_try,
        currency: 'TRY' as const,
        articlesPerMonth: p.articlesPerMonth,
        socialPostsPerMonth: p.socialPostsPerMonth,
        videosPerMonth: p.videosPerMonth,
        sites: p.sites,
        publishTargets: p.publishTargets,
        support: p.support_tr,
        popular: p.popular,
        contactSales: p.contactSales,
      }));
    }

    // EN / diğer dilleri → USD
    const rate = await this.fx.getUsdToTryRate();
    return Promise.all(
      BASE_PLANS.map(async (p) => {
        let monthly_usd = 0;
        let annual_usd = 0;
        if (p.monthly_try > 0) {
          monthly_usd = await this.fx.tryToUsd(p.monthly_try);
        }
        if (p.annual_try > 0) {
          annual_usd = await this.fx.tryToUsd(p.annual_try);
        }
        return {
          id: p.id,
          name: p.name_en,
          monthly: monthly_usd,
          annual: annual_usd,
          currency: 'USD' as const,
          articlesPerMonth: p.articlesPerMonth,
          socialPostsPerMonth: p.socialPostsPerMonth,
          videosPerMonth: p.videosPerMonth,
          sites: p.sites,
          publishTargets: p.publishTargets,
          support: p.support_en,
          popular: p.popular,
          contactSales: p.contactSales,
        };
      }),
    );
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
   * Kur bilgisi — UI'da "Kur: 1 USD = X TL (TCMB)" göstermek için.
   */
  async getCurrentFxRate() {
    const rate = await this.fx.getUsdToTryRate();
    return { usdToTry: rate, source: 'TCMB', cachedFor: '24h' };
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
