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
  sites: number;
  /**
   * Aylik AI gorunurluk calistirmasi.
   *
   * DIKKAT: bu deger QuotaService.LIMITS[plan].citationTests ile AYNI olmak
   * ZORUNDA — fiilen dayatilan sayac odur. AI Citation testi ve Prompt Lab
   * calistirmasi ayni kovadan duser (prompt-lab.service -> enforceCitationQuota).
   *
   * Onceki promptRunsPerMonth (150/400/1.200/4.000) ve llmResponsesPerMonth
   * (6.000...200.000) alanlari BURADA DURUYORDU ve hicbir sayaca dayanmiyordu;
   * fiyatlandirmada karsiligi olmayan vaat anlamina geliyorlardi. Kaldirildilar.
   */
  aiRunsPerMonth: number;
  /** Bir calistirmada sorgulanan AI asistan sayisi (bkz. AiCitationService saglayici listesi) */
  aiProviders: number;
  publishTargets: 'limited' | 'all';
  /** ASO: takip edilebilir uygulama sayisi — AsoService.connectApp dayatir */
  trackedApps: number;
  /** Apple Search Ads baglama — AsaController dayatir */
  asaEnabled: boolean;
  /** App Store Connect baglama — AscController dayatir */
  ascEnabled: boolean;
  /** MCP sunucusu erisimi — McpController dayatir */
  mcpAccess: boolean;
  /** REST API anahtari uretme — ApiKeysController dayatir */
  apiAccess: boolean;
  /** Kendi saglayici anahtarini baglama — SiteAiKeysController dayatir */
  byok: boolean;
  support_tr: string;
  support_en: string;
  /** Kart bu planin maddelerini "X'teki her sey, arti:" diye gosterir */
  inheritsFrom?: PlanId;
  /** Fiyat karti maddeleri — TEK KAYNAK. Her madde calisan bir ozellige dayanmali. */
  features_tr: string[];
  features_en: string[];
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
    sites: 1,
    aiRunsPerMonth: 3,
    aiProviders: 7,
    publishTargets: 'limited',
    trackedApps: 1,
    asaEnabled: false,
    ascEnabled: false,
    mcpAccess: false,
    apiAccess: false,
    byok: false,
    support_tr: 'topluluk',
    support_en: 'community',
    features_tr: [
      '2 AI makale · 3 görünürlük çalıştırması',
      '1 site',
      'Kredi kartı istemez',
    ],
    features_en: [
      '2 AI articles · 3 visibility runs',
      '1 site',
      'No credit card required',
    ],
  },
  {
    id: 'starter',
    name_tr: 'Büyüme',
    name_en: 'Growth',
    monthly_usd: 149,
    annual_usd: 1490,
    articlesPerMonth: 15,
    sites: 2,
    aiRunsPerMonth: 20,
    aiProviders: 7,
    publishTargets: 'all',
    trackedApps: 1,
    asaEnabled: false,
    ascEnabled: false,
    mcpAccess: false,
    apiAccess: false,
    byok: false,
    support_tr: 'e-posta 24 saat',
    support_en: 'email 24h',
    features_tr: [
      '15 AI makale / ay — 5 ajanlı üretim hattı, yayın öncesi QA kapısı',
      '20 AI görünürlük çalıştırması / ay — her çalıştırma 7 asistanı birden sorgular',
      'ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek · Llama',
      '2 site',
      'Site SEO/GEO denetimi — 14 teknik kontrol + PageSpeed + harf notu',
      'ASO: uygulamanı bağla, App Store + Google Play metadata’sını AI ile optimize et',
      'Günlük otomatik keyword sıra takibi',
      '14 yayın hedefi — WordPress, FTP/SFTP, cPanel, GitHub, Ghost, Webflow, Sanity…',
      'İçerik takvimi, zamanlanmış üretim ve otomatik yayın',
      'Haftalık e-posta performans raporu',
    ],
    features_en: [
      '15 AI articles/mo — 5-agent pipeline with a pre-publish QA gate',
      '20 AI visibility runs/mo — every run queries 7 assistants at once',
      'ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek · Llama',
      '2 sites',
      'Site SEO/GEO audit — 14 technical checks + PageSpeed + letter grade',
      'ASO: connect your app, AI-optimize App Store + Google Play metadata',
      'Daily automated keyword rank tracking',
      '14 publishing targets — WordPress, FTP/SFTP, cPanel, GitHub, Ghost, Webflow, Sanity…',
      'Content calendar, scheduled generation and auto-publish',
      'Weekly performance report by email',
    ],
  },
  {
    id: 'pro',
    name_tr: 'Profesyonel',
    name_en: 'Professional',
    monthly_usd: 349,
    annual_usd: 3490,
    articlesPerMonth: 40,
    sites: 5,
    aiRunsPerMonth: 75,
    aiProviders: 7,
    publishTargets: 'all',
    trackedApps: 3,
    asaEnabled: true,
    ascEnabled: true,
    mcpAccess: false,
    apiAccess: false,
    byok: false,
    support_tr: 'e-posta 4 saat',
    support_en: 'email 4h',
    inheritsFrom: 'starter',
    features_tr: [
      '40 AI makale / ay · 75 görünürlük çalıştırması · 5 site',
      'Apple Search Ads — kampanya kurulumu, senkron ve günlük oto-pilot',
      'App Store Connect — sürüm senkronu, yorum çekme + LLM duygu analizi',
      'App Prompt Lab — AI asistanları uygulamanı öneriyor mu, ölç',
      'Screenshot Studio — AI arka plan + caption, 1290×2796 canvas editör',
      'Agent Readiness (AXO) — robots.txt / llms.txt / sitemap otomatik düzeltme',
      'Takılmış sayfa tespiti — LLM ile kurtarma, tek tıkla geri alma',
      'İçerik fırsatları — kaybettiğin promptlardan makale üretip yeniden ölçen kapalı döngü',
    ],
    features_en: [
      '40 AI articles/mo · 75 visibility runs · 5 sites',
      'Apple Search Ads — campaign setup, sync and daily auto-pilot',
      'App Store Connect — release sync, review ingest + LLM sentiment analysis',
      'App Prompt Lab — measure whether AI assistants recommend your app',
      'Screenshot Studio — AI backgrounds + captions, 1290×2796 canvas editor',
      'Agent Readiness (AXO) — automatic robots.txt / llms.txt / sitemap fixes',
      'Stuck page detection — LLM-driven recovery, one-click revert',
      'Content opportunities — closed loop that writes for lost prompts and re-measures',
    ],
    popular: true,
  },
  {
    id: 'agency',
    name_tr: 'Ajans',
    name_en: 'Agency',
    monthly_usd: 749,
    annual_usd: 7490,
    articlesPerMonth: 100,
    sites: 15,
    aiRunsPerMonth: 300,
    aiProviders: 7,
    publishTargets: 'all',
    trackedApps: 10,
    asaEnabled: true,
    ascEnabled: true,
    mcpAccess: false,
    apiAccess: false,
    byok: false,
    support_tr: 'öncelikli + Slack',
    support_en: 'priority + Slack',
    inheritsFrom: 'pro',
    features_tr: [
      '100 AI makale / ay · 300 görünürlük çalıştırması · 15 site',
      'Programmatic SEO — çalıştırma başına 100 şehir sayfası (81 il şablonu)',
      'Product Radar — haftalık rakip ses payı ve kategori sırası',
      'GEO Heatmap — çoklu sağlayıcıda görünürlük ısı haritası',
      'Live Crawler — AI botlarının canlı akışı + sunucu logu yutma',
      'Öncelikli destek + Slack kanalı',
    ],
    features_en: [
      '100 AI articles/mo · 300 visibility runs · 15 sites',
      'Programmatic SEO — 100 city pages per run (81-province template)',
      'Product Radar — weekly competitor share-of-voice and category rank',
      'GEO Heatmap — multi-provider visibility heatmap',
      'Live Crawler — live AI bot stream + server log ingestion',
      'Priority support + Slack channel',
    ],
  },
  {
    id: 'enterprise',
    name_tr: 'Kurumsal',
    name_en: 'Enterprise',
    monthly_usd: 1499,
    annual_usd: 14990,
    articlesPerMonth: 350,
    sites: 50,
    aiRunsPerMonth: 1_000,
    aiProviders: 7,
    publishTargets: 'all',
    trackedApps: 50,
    asaEnabled: true,
    ascEnabled: true,
    mcpAccess: true,
    apiAccess: true,
    byok: true,
    support_tr: 'özel hesap yöneticisi + SLA',
    support_en: 'dedicated account manager + SLA',
    inheritsFrom: 'agency',
    features_tr: [
      '350 AI makale / ay · 1.000 görünürlük çalıştırması · 50 site',
      'BYOK — kendi sağlayıcı anahtarların; havuz kotası dolsa bile ölçüm durmaz',
      'MCP sunucusu — Claude, Cursor veya kendi ajanından 26 araçla bağlan',
      'REST API + scope’lu API anahtarları',
      'AI maliyet ve token muhasebesi — sağlayıcı / bağlam / gün kırılımı',
      'Özel hesap yöneticisi + SLA, sözleşmeli kurulum',
    ],
    features_en: [
      '350 AI articles/mo · 1,000 visibility runs · 50 sites',
      'BYOK — your own provider keys; measurement continues past pool quota',
      'MCP server — connect from Claude, Cursor or your own agent via 26 tools',
      'REST API + scoped API keys',
      'AI cost and token accounting — by provider / context / day',
      'Dedicated account manager + SLA, contracted onboarding',
    ],
    contactSales: true,
  },
];

export function findPlan(id: string): BasePlan | undefined {
  return BASE_PLANS.find((p) => p.id === id);
}

/** Satin alinabilir planlar (trial ucretsiz, enterprise satis ekibi uzerinden) */
export const PURCHASABLE_PLAN_IDS: PlanId[] = ['starter', 'pro', 'agency'];
