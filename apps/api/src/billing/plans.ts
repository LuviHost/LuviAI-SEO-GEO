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

/** Merdiven sirasi — kapi kontrolu bu siraya gore yapilir. */
export const PLAN_RANK: Record<PlanId, number> = {
  trial: 0, starter: 1, pro: 2, agency: 3, enterprise: 4,
};

/**
 * Plana bagli ozellikler.
 *
 * Fiyat kartinda ust plan farki olarak SATILAN her ozellik burada olmak
 * ZORUNDA. Aksi halde madde bos vaattir: ozellik calisir ama alt plan
 * musterisi de kullanir.
 */
export type PlanFeature =
  | 'asaEnabled' | 'ascEnabled' | 'appPromptLab' | 'screenshotStudio'
  | 'agentReadiness' | 'stuckPages' | 'contentOpportunities'
  | 'programmaticSeo' | 'productRadar' | 'geoHeatmap' | 'liveCrawler'
  | 'costAnalytics' | 'mcpAccess' | 'apiAccess' | 'byok';

/**
 * Ozellik -> gereken EN DUSUK plan.
 *
 * Neden boolean tablosu degil: her plana ayri bayrak yazildiginda merdiven
 * geriye gidebiliyordu (ust planin bir ozelligi yanlislikla false kalabilir).
 * Minimum-plan tablosunda bu YAPISAL OLARAK imkansiz — ust plan alt planin
 * her ozelligini otomatik alir.
 */
export const FEATURE_MIN_PLAN: Record<PlanFeature, PlanId> = {
  // Profesyonel — ASO'nun para harcayan katmani ve kapali dongu
  asaEnabled: 'pro',
  ascEnabled: 'pro',
  appPromptLab: 'pro',
  screenshotStudio: 'pro',
  agentReadiness: 'pro',
  stuckPages: 'pro',
  contentOpportunities: 'pro',
  // Ajans — portfoy olcegi
  programmaticSeo: 'agency',
  productRadar: 'agency',
  geoHeatmap: 'agency',
  liveCrawler: 'agency',
  // Kurumsal — platform erisimi
  costAnalytics: 'enterprise',
  mcpAccess: 'enterprise',
  apiAccess: 'enterprise',
  byok: 'enterprise',
};

/** Hata mesajinda kullanilan kullanici-yuzu ad. */
export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  asaEnabled: 'Apple Search Ads',
  ascEnabled: 'App Store Connect',
  appPromptLab: 'Uygulama soru laboratuvarı',
  screenshotStudio: 'Ekran görüntüsü stüdyosu',
  agentReadiness: 'Ajan Hazırlığı',
  stuckPages: 'Takılmış sayfa tespiti',
  contentOpportunities: 'İçerik fırsatları',
  programmaticSeo: 'Şehir sayfaları (programatik SEO)',
  productRadar: 'Ürün Radarı',
  geoHeatmap: 'GEO ısı haritası',
  liveCrawler: 'Canlı Tarayıcı',
  costAnalytics: 'AI maliyet kırılımı',
  mcpAccess: 'MCP sunucusu',
  apiAccess: 'REST API erişimi',
  byok: 'Kendi API anahtarını bağlama (BYOK)',
};

/** Plan bu ozellige sahip mi? */
export function planHasFeature(plan: PlanId, feature: PlanFeature): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[FEATURE_MIN_PLAN[feature]];
}

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
 * 24.000 yanit), Enterprise custom. Bizde 6 saglayici olcum (Llama yalniz
 * GROQ_LLAMA_MODEL tanimliyken — ai-citation.service.ts) + icerik uretimi +
 * yayinlama + ASO ayni pakette.
 *
 * MADDE KURALI (2026-10): sabit MCP arac sayisi yazilmaz (kayit degistikce
 * bayatliyor; agent-setup.txt de liste yayimlamiyor) ve Llama kosulsuz
 * vaat edilmez: Groq Llama sohbet modelini kaldirdi, saglayici ozel env
 * olmadan olculmuyor. public-docs.spec.ts ikisini de denetler.
 *
 * OLCUM MADDESI (18.10.2026): 16.10.2026'dan beri her hesap kayan 7 gunde 1
 * AI olcumu yapabilir (billing/measurement-allowance.ts; tum olcum araclari
 * ayni hakki paylasir, ADMIN ve platform otomasyonu sayilmaz). "20 AI
 * gorunurluk calistirmasi / ay" maddesi bunu "ayda 20 olcum" diye satiyordu;
 * kural ayda en fazla 5 olcume izin verir. aiRunsPerMonth bir olcum hakki
 * degil, aylik calistirma TAVANIDIR (QuotaService citationTests): AI testi 1,
 * Prompt Lab'de her soru ve her dal 1 sayilir, tek haftalik olcum birden cok
 * calistirma harcayabilir. Kartlar ikisini birlikte ve tavani "en fazla" diye
 * yazar; public-docs.spec.ts sayilari ve kalibi denetler.
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
    aiProviders: 6,
    publishTargets: 'limited',
    trackedApps: 1,
    support_tr: 'topluluk',
    support_en: 'community',
    // 2 makale TOPLAM (onboarding'in ilki dahil, ay basi sifirlanmaz); takvimin
    // hakki asan konulari kilitli bekler, plan secilince yazilir (articles/plan-lock.ts)
    features_tr: [
      '2 AI makale · 3 görünürlük çalıştırması (haftada en fazla 1 ölçüm)',
      'Takvimin geri kalanı plan seçince yazılır',
      '1 site',
      'Kredi kartı istemez',
    ],
    features_en: [
      '2 AI articles · 3 visibility runs (at most 1 measurement per week)',
      'The rest of your calendar is written when you choose a plan',
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
    aiProviders: 6,
    publishTargets: 'all',
    trackedApps: 1,
    support_tr: 'e-posta 24 saat',
    support_en: 'email 24h',
    features_tr: [
      '15 AI makale / ay — 5 ajanlı üretim hattı, yayın öncesi QA kapısı',
      'Hesap başına haftada 1 AI görünürlük ölçümü — AI testi, Prompt Lab ve diğer ölçümler bu hakkı paylaşır',
      'AI testi ve Prompt Lab soruları 6 AI asistanına birden sorulur; ölçümlerde ayda en fazla 20 çalıştırma (AI testi 1, Prompt Lab’de her soru ve her dal 1 çalıştırma)',
      'ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek',
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
      '1 AI visibility measurement per account per week — the AI test, Prompt Lab and other measurements share it',
      'The AI test and Prompt Lab questions go to 6 AI assistants at once; up to 20 runs/mo across measurements (an AI test is 1 run, each Prompt Lab question or branch is 1)',
      'ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek',
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
    aiProviders: 6,
    publishTargets: 'all',
    trackedApps: 3,
    support_tr: 'e-posta 4 saat',
    support_en: 'email 4h',
    inheritsFrom: 'starter',
    features_tr: [
      '40 AI makale / ay · ayda en fazla 75 çalıştırma (ölçüm yine haftada 1) · 5 site',
      'Apple Search Ads — kampanya kurulumu, senkron ve günlük oto-pilot',
      'App Store Connect — sürüm senkronu, yorum çekme + LLM duygu analizi',
      'App Prompt Lab — AI asistanları uygulamanı öneriyor mu, ölç',
      'Screenshot Studio — AI arka plan + caption, 1290×2796 canvas editör',
      'Agent Readiness (AXO) — AI bot ve ajan keşif dosyaları taraması; robots.txt / llms.txt / sitemap için önizlemeli düzeltme',
      'Takılmış sayfa tespiti — LLM ile kurtarma, tek tıkla geri alma',
      'İçerik fırsatları — kaybettiğin promptlardan makale üretip yeniden ölçen kapalı döngü',
    ],
    features_en: [
      '40 AI articles/mo · up to 75 runs/mo (still 1 measurement a week) · 5 sites',
      'Apple Search Ads — campaign setup, sync and daily auto-pilot',
      'App Store Connect — release sync, review ingest + LLM sentiment analysis',
      'App Prompt Lab — measure whether AI assistants recommend your app',
      'Screenshot Studio — AI backgrounds + captions, 1290×2796 canvas editor',
      'Agent Readiness (AXO) — AI bot and agent discovery scan; previewed robots.txt / llms.txt / sitemap fixes',
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
    aiProviders: 6,
    publishTargets: 'all',
    trackedApps: 10,
    support_tr: 'öncelikli + Slack',
    support_en: 'priority + Slack',
    inheritsFrom: 'pro',
    features_tr: [
      '100 AI makale / ay · ayda en fazla 300 çalıştırma (ölçüm yine haftada 1) · 15 site',
      'Programmatic SEO — tek şablonla 81 ilin tamamına şehir sayfası (aylık makale kotasından düşer)',
      'Product Radar — haftalık rakip ses payı ve kategori sırası',
      'GEO Heatmap — çoklu sağlayıcıda görünürlük ısı haritası',
      'Live Crawler — AI botlarının canlı akışı + sunucu logu yutma',
      'Öncelikli destek + Slack kanalı',
    ],
    features_en: [
      '100 AI articles/mo · up to 300 runs/mo (still 1 measurement a week) · 15 sites',
      'Programmatic SEO — one template, city pages for all 81 provinces (counts toward your monthly article quota)',
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
    aiProviders: 6,
    publishTargets: 'all',
    trackedApps: 50,
    support_tr: 'özel hesap yöneticisi + SLA',
    support_en: 'dedicated account manager + SLA',
    inheritsFrom: 'agency',
    features_tr: [
      '350 AI makale / ay · ayda en fazla 1.000 çalıştırma (ölçüm yine haftada 1) · 50 site',
      'BYOK — kendi sağlayıcı anahtarların; aylık çalıştırma tavanı dolsa da ölçüm bu anahtarlarla sürer (haftada 1 ölçüm kuralı geçerli)',
      'MCP sunucusu — Claude Code, Cursor ya da özel başlık gönderebilen kendi ajanından bağlan',
      'REST API + scope’lu API anahtarları',
      'AI maliyet ve token muhasebesi — sağlayıcı / bağlam / gün kırılımı',
      'Özel hesap yöneticisi + SLA, sözleşmeli kurulum',
    ],
    features_en: [
      '350 AI articles/mo · up to 1,000 runs/mo (still 1 measurement a week) · 50 sites',
      'BYOK — your own provider keys; measurement continues on them past the monthly run cap (the weekly measurement rule still applies)',
      'MCP server — connect from Claude Code, Cursor or your own agent that can send a custom header',
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
