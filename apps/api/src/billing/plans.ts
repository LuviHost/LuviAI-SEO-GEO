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
  | 'agentReadiness' | 'stuckPages' | 'contentOpportunities' | 'articleVideo'
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
  // RanksUp Video (makale, site ve urun tanitim videolari; ortak aylik hak) — sahip karari 21.10.2026: Profesyonel ve ustu.
  // Alt planlar kilitli onizleme gorur; render ve LLM maliyeti olusmaz (videos/videos.service.ts).
  articleVideo: 'pro',
  // Ajans — portfoy olcegi. Ajans 11.11.2026'da satistan kalkti; kapi burada durur ki mevcut
  // Ajans hesaplari hakkini korusun. Yeni musteride bu ozellikler Kurumsal'dadir ve musteriye
  // soylenen plan adi featureOfferPlan'dan gelir (asagida).
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
  articleVideo: 'RanksUp Video',
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

/**
 * RanksUp Video — plan basina AYLIK video hakki. TEK YER: sahip sayilari buradan degistirir;
 * fiyat karti maddeleri, QuotaService (videoLimitFor) ve panel ayni degeri okur.
 *
 * Dayatma: User.videosUsedThisMonth kosullu UPDATE ile artar (ayni anda gelen iki istek son
 * hakki iki kez alamaz), render basarisiz olursa geri verilir; sayac makale sayaciyla birlikte
 * takvim ayi basinda sifirlanir (quota.service maybeResetMonthlyQuota). 0 = ozellik yok.
 *
 * Neden bu sayilar (21.10.2026 onerisi): video basina maliyet bir Haiku 5.5 cagrisi (~3 bin
 * token girdi; $0.10 / $0.50 MTok fiyatla yaklasik $0.001) + sunucuda ~1-2 dk CPU render'i; kisit maliyet degil, tek kuyrukta
 * sira (eszamanlilik 1). Profesyonel makale hakkinin (40) yarisi, Ajans/Kurumsal site
 * sayisiyla orantili.
 */
export const VIDEOS_PER_MONTH: Record<PlanId, number> = {
  trial: 0,
  starter: 0,
  pro: 20,
  agency: 60,
  enterprise: 200,
};

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
  /** RanksUp Video aylik hakki — VIDEOS_PER_MONTH'tan; QuotaService.consumeVideoAllowance dayatir */
  videosPerMonth: number;
  /**
   * Destek kanali (fiyat ozeti ve /billing/plans). Yalniz kanal yazilir: yanit suresi,
   * SLA, Slack kanali ya da hesap yoneticisi vaadi YAZILMAZ — kodda ve operasyonda
   * karsiligi yok (sahip karari 30.10.2026). public-docs.spec.ts denetler.
   */
  support_tr: string;
  support_en: string;
  /**
   * Kartta plan adinin altindaki tek satir: plan KIME, NE ICIN. Ozellik sayilmaz, vaat
   * yazilmaz — yalniz o planda calisan seyin ozeti (maddelerle celismemeli).
   */
  tagline_tr?: string;
  tagline_en?: string;
  /** Kart bu planin maddelerini "X'teki her sey, arti:" diye gosterir */
  inheritsFrom?: PlanId;
  /** Fiyat karti maddeleri — TEK KAYNAK. Her madde calisan bir ozellige dayanmali. */
  features_tr: string[];
  features_en: string[];
  popular?: boolean;
  contactSales?: boolean;
  /** Satistan kalkan plan: mevcut hesaplar icin tanimli kalir; listede, kartta ve satin almada gorunmez */
  legacy?: boolean;
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
 * 24.000 yanit), Enterprise custom. Bizde 6 saglayici olcum (Meta (Muse) yalniz
 * META_MODEL_API_KEY tanimliyken — ai-citation.service.ts) + icerik uretimi +
 * yayinlama + ASO ayni pakette.
 *
 * MADDE KURALI (2026-10): sabit MCP arac sayisi yazilmaz (kayit degistikce
 * bayatliyor; agent-setup.txt de liste yayimlamiyor) ve Llama kosulsuz
 * vaat edilmez: Groq Llama sohbet modelini kaldirdi, saglayici ozel env
 * olmadan olculmuyor. public-docs.spec.ts ikisini de denetler.
 *
 * DOGRULUK KURALI (30.10.2026): madde yalniz musterinin bugun eline gecen
 * seyi yazar. Yayin hedefi sayisi musterinin ekleyip yazisini teslim
 * alabildigi hedeflerdir: KOBIPRATIK yalniz admin, Markdown ZIP sunucuya
 * dosya yazar ama indirme vermez (packages/adapters/src/markdown-zip.ts) —
 * ikisi sayilmaz; public-docs.spec.ts sayiyi katalogla denetler. Kosula
 * bagli ozellik kosulunu da yazar: keyword sira takibi ve takilmis sayfa
 * tespiti Search Console verisiyle calisir, geri alma yalniz RanksUp'in
 * yayinladigi yazida.
 *
 * KANIT DENETIMI (08.11.2026): llms.txt bir avantaj olarak satilmaz (Google
 * yok sayiyor, etkisi gosterilmedi); Agent Readiness maddesi yalniz robots.txt
 * onizlemeli eklemesini ve eksik site haritasinin olusturulmasini yazar.
 * Sehir sayfalari (programatik SEO) karttan kaldirildi: ozellik kapatiliyor
 * (olcekli sablon sayfa). programmaticSeo anahtari plan kapisinda kalir,
 * kod tarafini ayri PR kapatir.
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
/**
 * PAKET YAPISI (11.11.2026, sahip karari): UC paket — Baslangic, Profesyonel,
 * Kurumsal. Konumlandirma "AI makale araci" degil "yapay zeka gorunurluk
 * platformu": kartlar olcumle baslar, makale yalniz Profesyonel'de tek satirdir.
 *
 *  - Baslangic 99 USD: 4 asistan (ChatGPT, Gemini, Claude, Perplexity), HIZLI
 *    modeller, makale uretimi YOK (articlesPerMonth 0).
 *  - Profesyonel 349 USD: butun asistanlar (Grok, DeepSeek ve — anahtari
 *    tanimliysa — Muse eklenir), gelismis modeller, makale ve icerik araclari.
 *  - Kurumsal: teklifle (contactSales). Eski Ajans paketinin ozellikleri
 *    (Product Radar, GEO Heatmap, Live Crawler) artik bu kartta.
 *  - Ajans SATISTAN KALKTI ama tanimi durur (`legacy: true`): bu plandaki
 *    hesap limitlerini korur ve kayitli karttan otomatik yenileme calisir
 *    (paytr.service chargeStoredCard). Liste, kart ve yeni satin almada gorunmez
 *    (publicPlans, PURCHASABLE_PLAN_IDS). ELLE yenileme yolu YOK: otomatik yenileme
 *    kapaliyken bu plan donem sonunda duser. 11.11.2026'da Ajans'ta odeyen hesap
 *    olmadigi icin (sahip) yazilmadi; boyle bir hesap acilirsa once bu yol eklenir.
 *
 * Hangi pakette hangi asistan ve hangi model kademesi: planEngines /
 * planModelTier (asagida) — olcum motoru (ai-citation.service) bunlari DAYATIR;
 * kart maddesi de ayni fonksiyondan uretilir (enginesBullet), elle yazilmaz.
 */

/** Olcum asistanlari — audit/ai-citation.service `Provider` ile AYNI dizgeler */
export type MeasurementEngine = 'openai' | 'gemini' | 'anthropic' | 'perplexity' | 'xai' | 'deepseek' | 'meta';

/** Kart ve seritte gorunen adlar */
export const ENGINE_LABELS: Record<MeasurementEngine, string> = {
  openai: 'ChatGPT',
  gemini: 'Gemini',
  anthropic: 'Claude',
  perplexity: 'Perplexity',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  meta: 'Muse',
};

/** Baslangic ve deneme: en bilinen dort asistan */
export const STANDARD_ENGINES: readonly MeasurementEngine[] = ['openai', 'gemini', 'anthropic', 'perplexity'];

/** Her kurulumda olculen alti asistan (Profesyonel ve ustu). Sira ana sayfadaki seritle ayni. */
export const BASE_ENGINES: readonly MeasurementEngine[] = [...STANDARD_ENGINES, 'xai', 'deepseek'];

/**
 * KOSULLU asistan: Meta'nin Muse'u yalniz META_MODEL_API_KEY tanimliyken olculur
 * (audit/citation-providers.ts). Plan KAPSAMINDA Profesyonel ve ustundedir; kart
 * metnine ve "N asistan" sayisina ancak gercekten olculuyorsa girer.
 */
export const CONDITIONAL_ENGINES: readonly MeasurementEngine[] = ['meta'];

/** Olcumde kullanilan model kademesi: 'standard' = saglayicinin hizli/ucuz modeli */
export type ModelTier = 'standard' | 'premium';

function isStandardScope(plan: PlanId): boolean {
  return PLAN_RANK[plan] < PLAN_RANK.pro;
}

/** Bu planin KAPSAMINDAKI asistanlar (kosullu olanlar dahil — olculup olculmeyecegini anahtar belirler) */
export function planEngines(plan: PlanId): MeasurementEngine[] {
  return isStandardScope(plan) ? [...STANDARD_ENGINES] : [...BASE_ENGINES, ...CONDITIONAL_ENGINES];
}

/** Bu planin olcumlerinde kullanilan model kademesi */
export function planModelTier(plan: PlanId): ModelTier {
  return isStandardScope(plan) ? 'standard' : 'premium';
}

/**
 * Fiyat kartindaki asistan maddesinin yer tutucusu. Metin elle yazilmaz:
 * billing.service bu maddeyi enginesBullet ile, O AN olculen asistan listesinden
 * uretir (Muse yalniz olculuyorsa gorunur).
 */
export const ENGINES_BULLET = '@asistanlar@';

function joinNames(names: string[], locale: 'tr' | 'en'): string {
  if (names.length <= 1) return names.join('');
  const and = locale === 'tr' ? 've' : 'and';
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
}

/**
 * Asistan maddesi. `measured`: su an olculen asistanlar (billing/measured-engines.ts).
 *  - Baslangic kapsami: dort asistanin adlari.
 *  - Ust paketler: alt pakete EKLENEN asistanlar ve toplam sayi.
 */
export function enginesBullet(plan: PlanId, locale: 'tr' | 'en', measured: readonly string[]): string {
  const scope = planEngines(plan).filter((e) => measured.includes(e));
  if (isStandardScope(plan)) {
    const names = scope.map((e) => ENGINE_LABELS[e]).join(', ');
    return locale === 'tr'
      ? `${scope.length} AI asistanında görünürlük ölçümü — ${names}`
      : `AI visibility measurement across ${scope.length} assistants — ${names}`;
  }
  const extras = scope.filter((e) => !STANDARD_ENGINES.includes(e)).map((e) => ENGINE_LABELS[e]);
  return locale === 'tr'
    ? `${scope.length} AI asistanı — ${joinNames(extras, 'tr')} eklenir`
    : `${scope.length} AI assistants — adds ${joinNames(extras, 'en')}`;
}

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
    aiProviders: STANDARD_ENGINES.length,
    publishTargets: 'limited',
    trackedApps: 1,
    videosPerMonth: VIDEOS_PER_MONTH.trial,
    support_tr: 'e-posta',
    support_en: 'email',
    // Sahip karari 21.10.2026: deneme 14 gun (billing/trial-policy.ts), 2 makale TOPLAM (ay basi
    // sifirlanmaz) ve makaleyi kullanici baslatir (yayin hedefi sarti); takvimin hakki asan
    // konulari kilitli bekler (articles/plan-lock.ts). Sure dolunca hesap salt okunur (satin
    // alma acikken; trial-expiry.guard.ts). 11.11.2026: makale uretimi yalniz Profesyonel ve
    // ustunde oldugu icin kilitli konular "plan secince" degil Profesyonel'de yazilir.
    features_tr: [
      '14 gün · 2 AI makale · 3 görünürlük çalıştırması (haftada en fazla 1 ölçüm)',
      'Makaleleri yayın hedefini bağlayıp sen başlatırsın; takvimin geri kalanı Profesyonel planda yazılır',
      '1 site',
      'Kredi kartı istemez',
    ],
    features_en: [
      '14 days · 2 AI articles · 3 visibility runs (at most 1 measurement per week)',
      'You start articles yourself after connecting a publish target; the rest of your calendar is written on the Professional plan',
      '1 site',
      'No credit card required',
    ],
  },
  {
    id: 'starter',
    name_tr: 'Başlangıç',
    name_en: 'Starter',
    tagline_tr: 'Markan AI cevaplarında nerede duruyor, gör.',
    tagline_en: 'See where your brand stands in AI answers.',
    monthly_usd: 99,
    annual_usd: 990,
    // Makale uretimi bu pakette yok (QuotaService.LIMITS.STARTER.articles ile ayni)
    articlesPerMonth: 0,
    sites: 2,
    aiRunsPerMonth: 20,
    aiProviders: STANDARD_ENGINES.length,
    publishTargets: 'all',
    trackedApps: 1,
    videosPerMonth: VIDEOS_PER_MONTH.starter,
    support_tr: 'e-posta',
    support_en: 'email',
    features_tr: [
      ENGINES_BULLET,
      'Haftada 1 ölçüm (hesap başına) · ayda en fazla 20 çalıştırma',
      'Rakip ve kaynak takibi — cevapta kim anılıyor, hangi siteler kaynak gösteriliyor',
      'Prompt Lab — kendi sorularınla ölçüm',
      'Site SEO/GEO denetimi — 14 teknik kontrol, PageSpeed önerileri, A+–F GEO notu',
      'Günlük anahtar kelime sıra takibi — Search Console bağlıyken',
      'ASO, 1 uygulama — App Store ve Google Play sıra takibi, metadata önerileri',
      '2 site · haftalık e-posta raporu',
      'Hızlı modellerle ölçüm',
    ],
    features_en: [
      ENGINES_BULLET,
      '1 measurement a week (per account) · up to 20 runs/mo',
      'Competitor and source tracking — who gets mentioned and which sites are cited',
      'Prompt Lab — measure with your own questions',
      'Site SEO/GEO audit — 14 technical checks, PageSpeed suggestions, A+–F GEO grade',
      'Daily keyword rank tracking — once Search Console is connected',
      'ASO, 1 app — App Store and Google Play rank tracking, metadata suggestions',
      '2 sites · weekly email report',
      'Measured with fast models',
    ],
  },
  {
    id: 'pro',
    name_tr: 'Profesyonel',
    name_en: 'Professional',
    tagline_tr: 'Ölç, eksiği içerikle kapat, yeniden ölç.',
    tagline_en: 'Measure, close the gap with content, measure again.',
    monthly_usd: 349,
    annual_usd: 3490,
    articlesPerMonth: 40,
    sites: 5,
    aiRunsPerMonth: 75,
    aiProviders: BASE_ENGINES.length,
    publishTargets: 'all',
    trackedApps: 3,
    videosPerMonth: VIDEOS_PER_MONTH.pro,
    support_tr: 'e-posta',
    support_en: 'email',
    inheritsFrom: 'starter',
    features_tr: [
      ENGINES_BULLET,
      // Bugun gercek olan fark: Claude Haiku → Opus; Grok ve DeepSeek zaten en ust modelleriyle.
      // ChatGPT, Gemini ve Perplexity iki pakette de ayni (hizli) modelle olculur — degisirse madde de degisir.
      'Claude, Grok ve DeepSeek’te en gelişmiş modeller',
      '5 site · ayda en fazla 75 çalıştırma (ölçüm yine haftada 1)',
      'GEO içerik, ayda 40 makale — 5 ajanlı üretim, kalite kapısı, 13 yayın hedefi',
      'İçerik fırsatları — kaybettiğin soruya içerik üretir, sonra yeniden ölçer',
      'Agent Readiness (AXO) — AI bot ve ajan keşif taraması; robots.txt’e önizlemeli ekleme, eksik site haritası',
      'Takılmış sayfa tespiti — Search Console verisiyle; RanksUp’ın yayınladığı yazıda tek tıkla geri alma',
      'ASO, 3 uygulama — Apple Search Ads ve App Store Connect',
      'App Prompt Lab ve Screenshot Studio',
      `RanksUp Video — ayda ${VIDEOS_PER_MONTH.pro} video`,
    ],
    features_en: [
      ENGINES_BULLET,
      'The most capable models on Claude, Grok and DeepSeek',
      '5 sites · up to 75 runs/mo (still 1 measurement a week)',
      'GEO content, 40 articles/mo — 5-agent pipeline, quality gate, 13 publishing targets',
      'Content opportunities — writes for the questions you lose, then re-measures',
      'Agent Readiness (AXO) — AI bot and agent discovery scan; previewed additions to robots.txt, missing sitemap created',
      'Stuck page detection — from Search Console data; one-click revert on articles RanksUp published',
      'ASO, 3 apps — Apple Search Ads and App Store Connect',
      'App Prompt Lab and Screenshot Studio',
      `RanksUp Video — ${VIDEOS_PER_MONTH.pro} videos/mo`,
    ],
    popular: true,
  },
  {
    // SATISTAN KALKTI (11.11.2026) — bkz. yukaridaki PAKET YAPISI notu. Tanim, bu plandaki
    // mevcut hesaplar icin durur; ozellikleri yeni musteride Kurumsal kartinda satilir.
    id: 'agency',
    name_tr: 'Ajans',
    name_en: 'Agency',
    monthly_usd: 749,
    annual_usd: 7490,
    articlesPerMonth: 100,
    sites: 15,
    aiRunsPerMonth: 300,
    aiProviders: BASE_ENGINES.length,
    publishTargets: 'all',
    trackedApps: 10,
    videosPerMonth: VIDEOS_PER_MONTH.agency,
    support_tr: 'e-posta',
    support_en: 'email',
    inheritsFrom: 'pro',
    features_tr: [
      '100 AI makale / ay · ayda en fazla 300 çalıştırma (ölçüm yine haftada 1) · 15 site',
      'Product Radar — haftalık rakip ses payı ve kategori sırası',
      'GEO Heatmap — çoklu sağlayıcıda görünürlük ısı haritası',
      'Live Crawler — AI botlarının canlı akışı + sunucu logu yutma',
      `RanksUp Video — ayda ${VIDEOS_PER_MONTH.agency} video`,
    ],
    features_en: [
      '100 AI articles/mo · up to 300 runs/mo (still 1 measurement a week) · 15 sites',
      'Product Radar — weekly competitor share-of-voice and category rank',
      'GEO Heatmap — multi-provider visibility heatmap',
      'Live Crawler — live AI bot stream + server log ingestion',
      `RanksUp Video — ${VIDEOS_PER_MONTH.agency} videos/mo`,
    ],
    legacy: true,
  },
  {
    id: 'enterprise',
    name_tr: 'Kurumsal',
    name_en: 'Enterprise',
    tagline_tr: 'Çok markalı ekipler için: API, MCP ve kendi anahtarların.',
    tagline_en: 'For multi-brand teams: API, MCP and your own keys.',
    // Liste fiyati kartta GOSTERILMEZ (contactSales: teklifle); sozlesme tabani olarak durur
    monthly_usd: 1499,
    annual_usd: 14990,
    articlesPerMonth: 350,
    sites: 50,
    aiRunsPerMonth: 1_000,
    aiProviders: BASE_ENGINES.length,
    publishTargets: 'all',
    trackedApps: 50,
    videosPerMonth: VIDEOS_PER_MONTH.enterprise,
    support_tr: 'e-posta',
    support_en: 'email',
    inheritsFrom: 'pro',
    features_tr: [
      '50 site · ayda en fazla 1.000 çalıştırma (ölçüm yine haftada 1) · 350 makale',
      'Product Radar — haftalık rakip ses payı ve kategori sırası',
      'GEO Heatmap — asistan bazında görünürlük ısı haritası',
      'Live Crawler — AI botlarının canlı akışı, sunucu logu yükleme',
      'BYOK — kendi sağlayıcı anahtarlarınla ölçüm; aylık tavan dolsa da sürer (haftada 1 ölçüm kuralı geçerli)',
      'MCP sunucusu — Claude Code, Cursor ya da özel başlık gönderebilen kendi ajanın',
      'REST API ve API anahtarları — site, makale, denetim, reklam ve analitik uçları',
      'AI maliyet ve token muhasebesi — panelde son 7 gün; sağlayıcı ve gün kırılımı API’de',
      `RanksUp Video — ayda ${VIDEOS_PER_MONTH.enterprise} video`,
    ],
    features_en: [
      '50 sites · up to 1,000 runs/mo (still 1 measurement a week) · 350 articles',
      'Product Radar — weekly competitor share-of-voice and category rank',
      'GEO Heatmap — per-assistant visibility heatmap',
      'Live Crawler — live AI bot stream, server log upload',
      'BYOK — measure with your own provider keys, also past the monthly cap (the weekly measurement rule still applies)',
      'MCP server — Claude Code, Cursor or your own agent that can send a custom header',
      'REST API and API keys — site, article, audit, ads and analytics endpoints',
      'AI cost and token accounting — last 7 days in the dashboard; provider and day breakdown via the API',
      `RanksUp Video — ${VIDEOS_PER_MONTH.enterprise} videos/mo`,
    ],
    contactSales: true,
  },
];

export function findPlan(id: string): BasePlan | undefined {
  return BASE_PLANS.find((p) => p.id === id);
}

/** Listede ve kartlarda gorunen planlar — satistan kalkanlar (legacy) haric */
export function publicPlans(): BasePlan[] {
  return BASE_PLANS.filter((p) => !p.legacy);
}

/**
 * Kapali bir ozellikte musteriye SOYLENECEK plan: ozelligi iceren en dusuk SATISTAKI plan.
 *
 * Kapi FEATURE_MIN_PLAN'da durur (Ajans'taki mevcut hesaplar Product Radar, GEO Heatmap ve
 * Live Crawler hakkini korur). Ama Ajans 11.11.2026'da satistan kalkti: "Ajans planina
 * dahildir" demek musteriyi alamayacagi bir plana yollar. Hata mesajlari ve panelin kilitli
 * kartlari (entitlements `required`) plan adini BURADAN alir.
 */
export function featureOfferPlan(feature: PlanFeature): BasePlan {
  const min = PLAN_RANK[FEATURE_MIN_PLAN[feature]];
  const offered = publicPlans()
    .filter((p) => PLAN_RANK[p.id] >= min)
    .sort((a, b) => PLAN_RANK[a.id] - PLAN_RANK[b.id])[0];
  return offered ?? BASE_PLANS.find((p) => p.id === FEATURE_MIN_PLAN[feature])!;
}

/**
 * Bu planda yapay zekayla makale uretimi var mi (aylik makale hakki > 0)?
 *
 * 11.11.2026 (uc paket): Baslangic'ta YOK. Makale ureten her yol ayni kurala bakar: kullanicinin
 * baslattigi uretim ve takvim (QuotaService), ceviri (translator.service), otomatik yeniden
 * yazim (content-pivot.service), takvim kilidi (articles/plan-lock). Yalniz kotaya bakmak
 * yetmiyordu: ceviri ve yeniden yazim makale hakkindan dusmez, eskiden yalniz denemeyi eliyordu.
 * Deneme true doner (omur boyu 2 makale); denemenin kendi kurallari ayri (trial-policy, plan-lock).
 */
export function planHasArticles(plan: string | null | undefined): boolean {
  const p = BASE_PLANS.find((x) => x.id === String(plan ?? '').toLowerCase());
  return !!p && p.articlesPerMonth > 0;
}

/**
 * Makale ureten en dusuk SATISTAKI ucretli plan — "makale icin su plana gec" diyen her metin
 * plan adini BURADAN alir (hak mesajlari, deneme bitisi e-postalari, ceviri reddi).
 */
export function articleOfferPlan(): BasePlan {
  return publicPlans().find((p) => p.monthly_usd > 0 && p.articlesPerMonth > 0) ?? BASE_PLANS.find((p) => p.id === 'pro')!;
}

/**
 * Otomatik makale isleri (haftalik yeniden yazim taramasi) bu plan enum degerlerinde CALISMAZ:
 * deneme + aylik makale hakki olmayan planlar. Prisma `notIn` icin BUYUK harf.
 */
export const NO_AUTO_ARTICLE_PLANS: string[] = [
  'TRIAL',
  ...BASE_PLANS.filter((p) => p.id !== 'trial' && p.articlesPerMonth === 0).map((p) => p.id.toUpperCase()),
];

/** Satin alinabilir planlar (trial ucretsiz, enterprise satis ekibi uzerinden, agency satistan kalkti) */
export const PURCHASABLE_PLAN_IDS: PlanId[] = ['starter', 'pro'];
