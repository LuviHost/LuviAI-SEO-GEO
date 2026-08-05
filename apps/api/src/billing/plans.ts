/**
 * PLAN TANIMLARI — TEK KAYNAK.
 *
 * NEDEN BU DOSYA VAR: Fiyatlar bugune kadar IKI yerde ayri ayri duruyordu —
 * billing.service.ts icindeki BASE_PLANS ve paytr.service.ts icindeki
 * getPlanDetails() sabitleri. Biri guncellenip digeri unutuldugunda kullaniciya
 * bir fiyat gosterilip kartindan baska tutar cekilirdi. Artik her iki taraf da
 * buradan okur.
 *
 * PARA BIRIMI: USD KANONIKTIR.
 * Maliyetlerimiz (LLM API, video uretimi) USD cinsinden olustugu icin fiyat da
 * USD'de sabitlenir. TL tutari her zaman gunun TCMB kuruyla HESAPLANIR
 * (bkz. FxService) — boylece kur oynadiginda marj erimez.
 *
 * TL fiyatini buraya elle yazmayin; FxService.usdToTry() kullanin.
 */

export type PlanId = 'trial' | 'starter' | 'pro' | 'agency' | 'enterprise';

export interface BasePlan {
  id: PlanId;
  name_tr: string;
  name_en: string;
  /** Aylik fiyat — USD, kanonik */
  monthly_usd: number;
  /** Yillik fiyat — USD (10 ay fiyatina 12 ay: 2 ay bedava) */
  annual_usd: number;
  articlesPerMonth: number;
  socialPostsPerMonth: number;
  videosPerMonth: number;
  sites: number;
  /** Prompt Lab: aylik calistirilabilecek takip sorusu sayisi */
  promptRunsPerMonth: number;
  /** Prompt Lab: aylik toplam LLM yaniti (prompt run x saglayici) */
  llmResponsesPerMonth: number;
  publishTargets: 'limited' | 'all';
  support_tr: string;
  support_en: string;
  popular?: boolean;
  contactSales?: boolean;
}

/**
 * 2026-08 fiyat guncellemesi — USD bazina gecis.
 *
 * GEREKCE: Onceki liste TL sabitliydi ve kod icinde 1 USD = 40 TL varsayiliyordu.
 * Kur bu varsayimin uzerine ciktiginda fiyat sessizce dusuyor, maliyet USD
 * oldugu icin marj eriyordu. Ayrica fiyatlandirma ekseni "makale adedi" idi;
 * makale ucuzlamis bir kategori ve bizi meta olarak konumlandiriyordu.
 * Yeni eksende AI gorunurluk olcumu (prompt run) de fiyatlaniyor.
 *
 * REFERANS (rakip, Agu 2026): withmaya.ai — Starter $99 (yalniz ChatGPT,
 * 50 prompt run, 1.500 LLM yaniti), Premium $399 (4 platform, 200 run,
 * 24.000 yanit), Enterprise custom. Bizde 7 saglayici olcum + icerik uretimi +
 * yayinlama + ASO ayni pakette.
 *
 * Mevcut aboneler: User.grandfatheredUntil / legacyMonthlyPriceTry alanlariyla
 * korunur — bkz. PaytrService.getPlanPriceForUser().
 */
export const BASE_PLANS: BasePlan[] = [
  {
    id: 'trial',
    name_tr: 'Ücretsiz Deneme',
    name_en: 'Free Trial',
    monthly_usd: 0,
    annual_usd: 0,
    articlesPerMonth: 2,
    socialPostsPerMonth: 5,
    videosPerMonth: 0,
    sites: 1,
    promptRunsPerMonth: 5,
    llmResponsesPerMonth: 150,
    publishTargets: 'limited',
    support_tr: 'topluluk',
    support_en: 'community',
  },
  {
    id: 'starter',
    name_tr: 'Büyüme',
    name_en: 'Growth',
    monthly_usd: 149,
    annual_usd: 1490,
    articlesPerMonth: 15,
    socialPostsPerMonth: 15,
    videosPerMonth: 0,
    sites: 2,
    promptRunsPerMonth: 150,
    llmResponsesPerMonth: 6_000,
    publishTargets: 'all',
    support_tr: 'e-posta 24 saat',
    support_en: 'email 24h',
  },
  {
    id: 'pro',
    name_tr: 'Profesyonel',
    name_en: 'Professional',
    monthly_usd: 349,
    annual_usd: 3490,
    articlesPerMonth: 40,
    socialPostsPerMonth: 30,
    videosPerMonth: 5,
    sites: 5,
    promptRunsPerMonth: 400,
    llmResponsesPerMonth: 20_000,
    publishTargets: 'all',
    support_tr: 'e-posta 4 saat',
    support_en: 'email 4h',
    popular: true,
  },
  {
    id: 'agency',
    name_tr: 'Ajans',
    name_en: 'Agency',
    monthly_usd: 749,
    annual_usd: 7490,
    articlesPerMonth: 100,
    socialPostsPerMonth: 80,
    videosPerMonth: 20,
    sites: 15,
    promptRunsPerMonth: 1_200,
    llmResponsesPerMonth: 60_000,
    publishTargets: 'all',
    support_tr: 'öncelikli + Slack',
    support_en: 'priority + Slack',
  },
  {
    id: 'enterprise',
    name_tr: 'Kurumsal',
    name_en: 'Enterprise',
    monthly_usd: 1499,
    annual_usd: 14990,
    articlesPerMonth: 350,
    socialPostsPerMonth: 200,
    videosPerMonth: 100,
    sites: 50,
    promptRunsPerMonth: 4_000,
    llmResponsesPerMonth: 200_000,
    publishTargets: 'all',
    support_tr: 'özel hesap yöneticisi + SLA',
    support_en: 'dedicated account manager + SLA',
    contactSales: true,
  },
];

export function findPlan(id: string): BasePlan | undefined {
  return BASE_PLANS.find((p) => p.id === id);
}

/** Satin alinabilir planlar (trial ucretsiz, enterprise satis ekibi uzerinden) */
export const PURCHASABLE_PLAN_IDS: PlanId[] = ['starter', 'pro', 'agency'];
