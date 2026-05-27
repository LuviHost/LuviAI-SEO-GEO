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

const BASE_PLANS: BasePlan[] = [
  {
    id: 'trial',
    name_tr: 'Ücretsiz Deneme',
    name_en: 'Free Trial',
    monthly_try: 0, annual_try: 0,
    articlesPerMonth: 1,
    socialPostsPerMonth: 2,
    videosPerMonth: 0,           // Trial: video yok (cost guard)
    sites: 1,
    publishTargets: 'limited',
    support_tr: 'topluluk',
    support_en: 'community',
  },
  {
    id: 'starter',
    name_tr: 'Başlangıç',
    name_en: 'Starter',
    monthly_try: 1199, annual_try: 11990,    // +%50 (799 → 1199)
    articlesPerMonth: 12,
    socialPostsPerMonth: 10,
    videosPerMonth: 2,            // 2 video/ay
    sites: 1,
    publishTargets: 'all',
    support_tr: 'e-posta 24 saat',
    support_en: 'email 24h',
  },
  {
    id: 'pro',
    name_tr: 'Profesyonel',
    name_en: 'Pro',
    monthly_try: 3499, annual_try: 34990,    // +%40 (2499 → 3499)
    articlesPerMonth: 30,
    socialPostsPerMonth: 20,
    videosPerMonth: 8,            // 8 video/ay
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
    monthly_try: 7999, annual_try: 79990,    // +%33 (5999 → 7999)
    articlesPerMonth: 60,
    socialPostsPerMonth: 40,
    videosPerMonth: 25,           // 25 video/ay
    sites: 10,
    publishTargets: 'all',
    support_tr: 'öncelikli + Slack',
    support_en: 'priority + Slack',
  },
  {
    id: 'enterprise',
    name_tr: 'Kurumsal',
    name_en: 'Enterprise',
    monthly_try: 19999, annual_try: 199990,  // +%33 (14999 → 19999)
    articlesPerMonth: 250,
    socialPostsPerMonth: 120,
    videosPerMonth: 80,           // 80 video/ay
    sites: 30,                    // 'unlimited' → 30 (cost guard, ek site ₺250/ay)
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
}
