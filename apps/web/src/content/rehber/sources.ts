/**
 * Rehber makalelerinin ortak kaynaklari. Her URL 24.10.2026'da ureticinin / yayincinin
 * kendi sayfasindan okundu; `accessed` o tarih. Bir kaynak yeniden kontrol edilince
 * tarihini ve onu kullanan makalenin PUBLIC_PAGES tarihini ayni committe guncelle.
 *
 * Birinci taraf veriler (KobiPratik olcumleri) URL tasimaz; donem ve yontem `note`'ta.
 */
import type { RehberSource } from './types';

const ERISIM = '2026-10-24';
/** 11.11.2026'da yeniden okunan / yeni eklenen kaynaklar (yapay-zeka-gorunurlugu, ai-bakisi-gorunurluk) */
const ERISIM_KASIM = '2026-11-11';
/** 14.11.2026'da eklenen kaynaklar (chatgpt-isletme-profili) */
const ERISIM_ISLETME = '2026-11-14';
/**
 * 14.11.2026'da eklenen kaynaklar (turkiyede-yapay-zeka-gorunurluk-urunleri, e-ticaret-yapay-zeka-gorunurlugu,
 * ajanslar-icin-yapay-zeka-gorunurluk-raporu). Hepsi headless Chrome ile, JS calismis haliyle okundu.
 * Ayni gun SEOYEN'in iki sayfasi bastan sona yeniden okundu (alintilarin hepsi yerinde) → `seoyen` ve
 * `seoyenPricing` tarihi 14.11. GEON'da fiyat kartlari, prompt sayilari, alti platform, Turkce destek ve
 * "Ajanslar & Çoklu marka" karti yeniden okundu ve ayniydi; ama kapali SSS cevaplari (Copilot yol haritasi,
 * AI hazirlik analizi) tek tek yeniden okunmadigi icin `geon` tarihi 24.10 olarak BIRAKILDI.
 * GEON'un tanimi: gorunen metinde "AI Görünürlük Platformu — Herkes için GEO"; statik <title> ise
 * "GEON — AI Arama Görünürlük Platformu", meta aciklamada "Türkiye'nin ilk GEO platformu." (curl, 14.11).
 */
const ERISIM_TURKIYE = '2026-11-14';

export const SRC = {
  openaiBots: {
    id: 'openai-bots', title: 'Overview of OpenAI Crawlers', publisher: 'OpenAI',
    url: 'https://developers.openai.com/api/docs/bots', accessed: ERISIM,
  },
  anthropicBots: {
    id: 'anthropic-bots', title: 'Does Anthropic crawl data from the web, and how can site owners block the crawler?', publisher: 'Anthropic',
    url: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler', accessed: ERISIM,
  },
  // Eski adres docs.perplexity.ai/guides/bots tasindi; yeni adres 24.10.2026'da acildi.
  perplexityBots: {
    id: 'perplexity-bots', title: 'Perplexity Crawlers', publisher: 'Perplexity',
    url: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers', accessed: ERISIM,
  },
  // Eski adres developers.google.com/search/docs/crawling-indexing/... tasindi.
  googleCrawlers: {
    id: 'google-crawlers', title: "Google's common crawlers (Google-Extended)", publisher: 'Google Crawling Infrastructure',
    url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers', accessed: ERISIM,
  },
  googleAiGuide: {
    id: 'google-ai-guide', title: 'AI optimization guide (son güncelleme 10.07.2026)', publisher: 'Google Search Central',
    url: 'https://developers.google.com/search/docs/fundamentals/ai-optimization-guide', accessed: ERISIM,
  },
  googleAiFeatures: {
    id: 'google-ai-features', title: 'AI features and your website (son güncelleme 10.12.2025)', publisher: 'Google Search Central',
    url: 'https://developers.google.com/search/docs/appearance/ai-features', accessed: ERISIM,
  },
  googleFaq2023: {
    id: 'google-faq-2023', title: 'Changes to HowTo and FAQ rich results (8 Ağustos 2023: SSS zengin sonuçları devlet ve sağlık siteleriyle sınırlandı)', publisher: 'Google Search Central Blog',
    url: 'https://developers.google.com/search/blog/2023/08/howto-faq-changes', accessed: ERISIM,
  },
  // Degisiklik gunlugu, 8 Mayis 2026 "Deprecating the FAQ rich result feature": "This feature will no
  // longer appear in Google Search starting May 7, 2026." 15 Haziran 2026: "The FAQ rich result feature
  // is no longer shown in Google Search results".
  googleFaq2026: {
    id: 'google-faq-2026', title: 'Search Central değişiklik günlüğü: Deprecating the FAQ rich result feature (8 Mayıs 2026)', publisher: 'Google Search Central',
    url: 'https://developers.google.com/search/updates', accessed: ERISIM,
  },
  googleTrBlog: {
    id: 'google-tr-blog', title: 'Türkiye’de AI Modu ve AI Bakışı dönemi başlıyor (18 Şubat 2026)', publisher: 'Google Türkiye Blogu',
    url: 'https://blog.google/intl/tr-tr/urun-duyurulari/turkiyede-ai-modu-ve-ai-bakisi-donemi-basliyor/', accessed: ERISIM,
  },
  // 11.11.2026 yeniden okundu. Verbatim: "yapay zekayla üretilmiş özetler sunarak arama sürecini
  // kolaylaştırabilir" · "üretken yapay zekanın faydalı olabileceğini belirlediğinde" · "daha ayrıntılı
  // araştırma için bağlantılar" · "Özellikler devre dışı bırakılamaz." · Web filtresi "AI Bakışı gibi
  // özellikler olmadan yalnızca metin tabanlı bağlantıları gösterir" · "AI Bakışları'nda hata olabilir ve olacaktır."
  googleTrHelp: {
    id: 'google-tr-help', title: 'Google Arama’daki AI Bakışı özelliği', publisher: 'Google Arama Yardım',
    url: 'https://support.google.com/websearch/answer/14901683?hl=tr', accessed: ERISIM_KASIM,
  },
  appleBot: {
    id: 'applebot', title: 'About Applebot (Applebot-Extended)', publisher: 'Apple',
    url: 'https://support.apple.com/en-us/119829', accessed: ERISIM,
  },
  ccbot: {
    id: 'ccbot', title: 'CCBot', publisher: 'Common Crawl',
    url: 'https://commoncrawl.org/ccbot', accessed: ERISIM,
  },
  cloudflareAcc: {
    id: 'cloudflare-acc', title: 'AI Crawl Control', publisher: 'Cloudflare Docs',
    url: 'https://developers.cloudflare.com/ai-crawl-control/', accessed: ERISIM,
  },
  rfc9309: {
    id: 'rfc9309', title: 'RFC 9309: Robots Exclusion Protocol (Eylül 2022)', publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc9309.html', accessed: ERISIM,
  },
  llmstxt: {
    id: 'llmstxt', title: 'The /llms.txt file (standartlaştırma önerisi, 3 Eylül 2024; v2, son değişiklik 10.08.2026)', publisher: 'llmstxt.org (Jeremy Howard)',
    url: 'https://llmstxt.org/', accessed: ERISIM,
  },
  lighthouseLlms: {
    id: 'lighthouse-llms', title: 'llms.txt — Agentic browsing audits (son güncelleme 05.05.2026)', publisher: 'Chrome for Developers',
    url: 'https://developer.chrome.com/docs/lighthouse/agentic-browsing/llms-txt', accessed: ERISIM,
  },
  sejLlms: {
    id: 'sej-llms', title: 'LLMs.txt Shows No Clear Effect On AI Citations, Based On 300k Domains (20 Kasım 2025)', publisher: 'Search Engine Journal',
    url: 'https://www.searchenginejournal.com/llms-txt-shows-no-clear-effect-on-ai-citations-based-on-300k-domains/', accessed: ERISIM,
  },
  geoPaper: {
    id: 'geo-paper', title: 'GEO: Generative Engine Optimization (Aggarwal vd., 16 Kasım 2023; KDD 2024)', publisher: 'arXiv',
    url: 'https://arxiv.org/abs/2311.09735', accessed: ERISIM,
  },
  apptweak: {
    id: 'apptweak', title: 'GEO for apps (21 Eylül 2026)', publisher: 'AppTweak',
    url: 'https://www.apptweak.com/en/aso-blog/geo-for-apps', accessed: ERISIM,
  },
  // "Description: Limited to 4000 characters." · "Keywords: You can provide up to 100 bytes of content."
  // · "Promotional Text: This property can’t be longer than 170 characters." (apps/api/src/aso/store-limits.ts ile ayni)
  appleAscLimits: {
    id: 'apple-asc-limits', title: 'App Store Connect: Platform version information (alan sınırları)', publisher: 'Apple Developer',
    url: 'https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information', accessed: ERISIM,
  },
  appleProductPage: {
    id: 'apple-product-page', title: 'Creating your product page', publisher: 'Apple Developer',
    url: 'https://developer.apple.com/app-store/product-page/', accessed: ERISIM,
  },
  googlePlayListing: {
    id: 'google-play-listing', title: 'Create and set up your app (store listing)', publisher: 'Google Play Console Yardım',
    url: 'https://support.google.com/googleplay/android-developer/answer/9859152?hl=en', accessed: ERISIM,
  },
  // 11.11.2026 paket yapisi (api plans.ts, /pricing ayni kaynaktan basilir): Baslangic $99/ay
  // (4 asistan, makale uretimi yok), Profesyonel $349/ay, Kurumsal teklifle. 14.11.2026'dan beri bu
  // kaynagi karsilastirmanin yaninda Turkiye listesi, KOBI, e-ticaret ve ajans rehberleri de kullaniyor.
  ranksupPricing: {
    id: 'ranksup-pricing', title: 'RanksUp fiyatlandırma', publisher: 'RanksUp',
    url: 'https://ranksup.ai/pricing', accessed: ERISIM_KASIM,
  },
  // Kullanim Sartlari 3. madde: "Aylık veya yıllık ödeme. KDV dahil."
  ranksupTerms: {
    id: 'ranksup-terms', title: 'Kullanım şartları (ödeme: KDV dahil)', publisher: 'RanksUp',
    url: 'https://ranksup.ai/terms', accessed: ERISIM,
  },
  ranksupAiVisibility: {
    id: 'ranksup-ai-visibility', title: 'AI Görünürlük rehberi (ölçüm yöntemi)', publisher: 'RanksUp',
    url: 'https://ranksup.ai/help/ai-visibility', accessed: ERISIM,
  },
  // Birinci taraf (URL yok): musteri raporu herkese acik bir sayfada anlatilmiyor, panelin icinde.
  // Kod: web app/(dashboard)/sites/[id]/report/musteri, components/musteri-raporu/*, lib/musteri-raporu.ts
  // (PAYLASIM_GUNLERI 7/30/90), api client-report.controller ("PLAN KAPISI YOK … deneme dahil tum planlarda
  // acik"), karsilastirma raporu app/(dashboard)/sites/[id]/gorunurluk-raporu. Haftalik e-posta: api
  // email/email.cron.ts weeklyReports — Search Console tiklama / gosterim / sira + yayinlanan makale; AI
  // gorunurluk verisi YOK, hesap sahibine tek e-posta.
  ranksupPanel: {
    id: 'ranksup-panel', title: 'RanksUp paneli: Raporlar bölümü (müşteri raporu, karşılaştırma raporu, haftalık e-posta özeti)', publisher: 'RanksUp (ürün içi)',
    note: '14 Kasım 2026 itibarıyla panelde; müşteri raporu deneme dahil tüm planlarda açık.',
  },
  // ── Rakipler: 24.10.2026'da (UTC; Turkiye saatiyle 25.10 gece yarisini gecerek) saticinin kendi sayfasi, JS ile render edilmis haliyle (headless Chrome)
  // okundu. Statik HTML'de fiyat gorunmeyen sayfalar (GEON, Peec) render edilince fiyat gosteriyor.
  // Verbatim alintilar:
  //  GEON (usegeon.com; /fiyatlandirma tek sayfa uygulamada 404 veriyor, fiyat kartlari ana sayfada):
  //   "Growth" "$99" "$39" "/mo" "🔥 İlk ay — sınırlı süre" "50 prompt/ay" · "Enterprise" "$259" "/mo"
  //   "200 prompt/ay" · "Aylık" "Yıllık" "%20" · "Kayıt olun, 5 ücretsiz kredi kazanın = 5 prompt taraması."
  //   · "Şu an ChatGPT, Perplexity AI, Anthropic Claude, Google Gemini, Grok ve DeepSeek'i takip ediyoruz.
  //   Roadmap'imizde Microsoft Copilot" · "AI hazırlık analizi … robots.txt erişimini, sitemap'i,
  //   yapılandırılmış veriyi ve içerik derinliğini kontrol ediyoruz. Ücretsiz" · "Eksik alıntıları içerik
  //   taslağı, SSS güncellemesi ve karşılaştırma sayfalarına çevirin." · Rapor sayfasi SSS'si: "Growth planı
  //   $99/ay, Enterprise için custom." · "Platform Türkçe ve İngilizce … Müşteri destek ekibimiz de Türkçe"
  geon: {
    id: 'geon', title: 'GEON ana sayfa (özellikler, fiyat kartları, SSS)', publisher: 'GEON',
    url: 'https://usegeon.com/', accessed: ERISIM,
  },
  //  SEOYEN (seoyen.com/fiyatlar/): "1.299 ₺/ay" (aylik) · "Deneme sonrası yıllık 12.470,40 ₺ peşin ödenir
  //   (ayda 1.039 ₺ karşılığı) · KDV dahil" · "Bu sayfadaki tüm fiyatlar %20 KDV dahildir" · "Bireysel
  //   paketi 7 gün boyunca 50 ₺ karşılığında tam erişimle denersiniz. … Süre dolunca aboneliğiniz seçtiğiniz
  //   dönemle (aylık ya da yıllık) devam eder ve o dönemin ücreti kayıtlı kartınızdan çekilir. Dönem
  //   seçmediyseniz varsayılan dönem yıllıktır. Çekimden önce tarih ve tutarı e-posta ile hatırlatırız."
  //   · "Yıllık ödemede aylık fiyata göre %20 tasarruf" · "Ödemeler iyzico altyapısı üzerinden"
  //  SEOYEN (seoyen.com): "3 AI motoru günlük tarama (ChatGPT, Gemini, Claude)" · "ChatGPT, Gemini ve
  //   Google AI Overview'da markanızın görünürlüğünü ölçün." · "100 AI görünürlük sorgusu/ay" (Bireysel)
  //   · "245 otomatik kontrolle teknik SEO sorunlarını tespit edin" · "WordPress'e tek tıkla yayınlama"
  //   · "Tüm veriler Türkiye'deki sunucularda saklanır."
  //  14.11.2026: iki SEOYEN sayfasi da yeniden okundu; yukaridaki alintilarin hepsi yerinde (degisiklik yok),
  //   tarih bu yuzden 14.11. Yeni okunanlar (/fiyatlar/): Bireysel "Takip edilen AI prompt	20" · Pro "3.799 ₺/ay"
  //   "KDV dahil" "Profesyoneller ve ajanslar için" "20 proje / site" "1.000 AI görünürlük sorgusu/ay"
  //   "Takip edilen AI prompt … 50" "2 kişilik takım" "White-label raporlar" "E-Ticaret analizi".
  seoyen: {
    id: 'seoyen', title: 'SEOYEN ana sayfa (özellikler)', publisher: 'SEOYEN',
    url: 'https://seoyen.com/', accessed: ERISIM_TURKIYE,
  },
  seoyenPricing: {
    id: 'seoyen-pricing', title: 'SEOYEN fiyatlar ve SSS', publisher: 'SEOYEN',
    url: 'https://seoyen.com/fiyatlar/', accessed: ERISIM_TURKIYE,
  },
  //  Otterly (otterly.ai/pricing): "Monthly" "Annually" "15% off" · "Lite" "$" "29" "/month" "15 search
  //   prompts" · Standard "$189/month" "100 search prompts" · Premium "$489/month" "400 search prompts" ·
  //   yillik gorunumde Lite "$25/month" (Standard $160, Premium $422) · "Tracking of 4 AI Search Engines:
  //   ChatGPT, Google AI Overviews, Perplexity, MS Copilot" · Claude, Google AI Mode ve Gemini eklenti ·
  //   "The displayed prices are US Dollar (excluding tax)." · "Yes, we provide a free trial for new users."
  otterly: {
    id: 'otterly', title: 'Otterly.AI pricing', publisher: 'Otterly.AI',
    url: 'https://otterly.ai/pricing', accessed: ERISIM,
  },
  //  Peec AI (peec.ai/pricing, render edilmis; erisimimizde $ gosterildi): "Starter" "$95" "/mo" "50 prompts"
  //   "Choose 3 models" · "Pro" "$245" "150 prompts" · "Advanced" "$495" "350 prompts" · Enterprise "Custom"
  //   · Starter model listesi: "ChatGPT" "AI Mode" "AI Overviews" "Microsoft Copilot" "Gemini" "Naver AI";
  //   Perplexity ve Claude Enterprise listesinde · "You can track queries across any supported country or
  //   language with no additional cost." · "Start free trial"
  peec: {
    id: 'peec', title: 'Peec AI pricing', publisher: 'Peec AI',
    url: 'https://peec.ai/pricing', accessed: ERISIM,
  },
  peecHome: {
    id: 'peec-home', title: 'Peec AI ana sayfa', publisher: 'Peec AI',
    url: 'https://peec.ai/', accessed: ERISIM,
  },
  //  Profound (tryprofound.com/pricing): Trial "Free" · "50 prompts run daily for 7 days" · deneme motorlari
  //   "ChatGPT", "Gemini", "Google AI Overviews" · Enterprise "Custom" · "Up to 9 Answer Engines tracked":
  //   ChatGPT, Perplexity, Google AI Mode, Gemini, Microsoft Copilot, DeepSeek, Anthropic Claude, Google AI
  //   Overviews, Exa Search · Agency Growth: "Full client workspaces as an add-on for $399/month" (Agency
  //   Growth taban fiyati JS degiskeni; dogrudan okunamadi, yazilmadi)
  //  14.11.2026 (yalniz bu satir yeniden bakildi, tarih degismedi): plan karsilastirma tablosunda "ChatGPT
  //   Shopping" satiri Trial "No", Enterprise "Yes" — e-ticaret rehberindeki Profound satirinin dayanagi.
  profound: {
    id: 'profound', title: 'Profound pricing', publisher: 'Profound',
    url: 'https://www.tryprofound.com/pricing', accessed: ERISIM,
  },
  //  Semrush (KB): "Price: $99 per month." · "Trial: No, the AI Visibility Toolkit does not offer a free trial."
  //   · "25 prompts for Prompt Tracking" · "on platforms like Google AI Mode and ChatGPT"
  semrush: {
    id: 'semrush', title: 'AI Visibility Toolkit (bilgi bankası)', publisher: 'Semrush',
    url: 'https://www.semrush.com/kb/1493-ai-toolkit', accessed: ERISIM,
  },
  //  Semrush KB (11.11.2026 okundu): "The AI Visibility Score reflects how often your brand is mentioned in
  //   AI-generated answers" "compared to the median number of mentions for your top industry competitors." ·
  //   Brand Performance "analyzes your Share of Voice, brand sentiment, and the key narratives driving your reputation."
  semrushScore: {
    id: 'semrush-score', title: 'AI Visibility Toolkit: AI Visibility Score tanımı (bilgi bankası)', publisher: 'Semrush',
    url: 'https://www.semrush.com/kb/1493-ai-toolkit', accessed: ERISIM_KASIM,
  },
  //  Peec AI dokumani (11.11.2026 okundu, "What Peec AI does"): Visibility "Shows how often your brand gets
  //   mentioned across AI responses" · Position "Measures where you rank when you do appear, compared with other
  //   brands." · Sentiment "Captures whether AI describes your brand positively, neutrally, or negatively"
  peecDocs: {
    id: 'peec-docs', title: 'Peec AI dokümantasyonu: Visibility, Position, Sentiment', publisher: 'Peec AI',
    url: 'https://docs.peec.ai/', accessed: ERISIM_KASIM,
  },
  //  Ahrefs (ahrefs.com/brand-radar, ABD'den erisimde USD; Avrupa'da € gosterilebilir): Custom Prompts
  //   "Free for every paid Ahrefs Lite plan and above." "Starts at $50/mo" · AI Visibility Index "Starts at
  //   $199/mo" "496 million prompts" · "The AI Visibility Index covers: … AI Overviews, AI Mode, ChatGPT,
  //   Perplexity, Gemini, Copilot" · "Custom Prompts supports all of the above plus Claude." · "Claude
  //   consumes 8 checks per update."
  ahrefs: {
    id: 'ahrefs', title: 'Brand Radar', publisher: 'Ahrefs',
    url: 'https://ahrefs.com/brand-radar', accessed: ERISIM,
  },
  // ── ChatGPT isletme profili (Businesses in ChatGPT, beta 10.11.2026) ──
  //  help.openai.com otomatik istekleri 403 ile reddediyor: metin 14.11.2026'da arama sonucundaki
  //  sayfa ozetinden okundu, tarayicidan DEGIL. Okunanlar: "You don't need an Ads account or a ChatGPT
  //  Enterprise agreement to claim an eligible business" · sahiplenme "initially available to eligible
  //  businesses with a website" · dogrulama: phone, business email, website domain (TXT record), Shopify ·
  //  "You'll need to complete identity verification with Persona before you can publish changes to your
  //  business information, view insights, or create an eligible business agent" · rozet Persona onayindan
  //  sonra · "Insights show aggregate activity over the past 28 days" · cevrimici islemede anilma = siteye
  //  atif · "claiming doesn't guarantee increased visibility or give you direct control over ChatGPT's
  //  independent recommendations". Sayfa yeniden okununca bu not ve tarih birlikte guncellenir.
  openaiBusinessHelp: {
    id: 'openai-business-help', title: 'Setting up your business on ChatGPT', publisher: 'OpenAI Help Center',
    url: 'https://help.openai.com/en/articles/20001635-setting-up-your-business-on-chatgpt', accessed: ERISIM_ISLETME,
  },
  //  OpenAI duyurusu (dogrudan okundu): "Available to eligible ecommerce and online service businesses in
  //  the U.S." (isletme asistani) · eligible businesses "located wherever ChatGPT is available can get started
  //  by claiming their business in Business Hub" · "aggregated insights on mentions, website clicks, and common
  //  topics in conversations where your business is cited" · "We don't share people's conversations or Business
  //  Agent chats with businesses." Ayni baslikta kullanicilarin dogrulama sorunlari da yaziyor (resmi degil).
  openaiBusinessAnnounce: {
    id: 'openai-business-announce', title: 'Introducing Businesses in ChatGPT in beta (10 Kasım 2026)', publisher: 'OpenAI Developer Community',
    url: 'https://community.openai.com/t/introducing-businesses-in-chatgpt-in-beta/1414865', accessed: ERISIM_ISLETME,
  },
  //  IT Brief UK, 11.11.2026: "Business Hub is launching globally for eligible businesses wherever ChatGPT is
  //  available." · "Business Agents are available only to eligible eCommerce and online service businesses in
  //  the United States." · "insights are available only when interaction volumes meet specified thresholds." ·
  //  "It plans to widen access over time to more markets and categories"
  itbriefBusinessHub: {
    id: 'itbrief-business-hub', title: 'OpenAI launches ChatGPT Business Hub for companies (11 Kasım 2026)', publisher: 'IT Brief UK',
    url: 'https://itbrief.co.uk/story/openai-launches-chatgpt-business-hub-for-companies', accessed: ERISIM_ISLETME,
  },
  //  VentureBeat, Carl Franzen, 10.11.2026: basvuru ChatGPT'nin calistigi ve OpenAI'in gereken dogrulamayi
  //  destekledigi pazarlarda · "Depending on the business, OpenAI can verify a claim through a business phone
  //  number" (+ e-posta, alan adi, Shopify) · "Local stores and restaurants can currently claim only an existing
  //  U.S. listing." · "... for free at launch" (ileride ucret olasiligi acik) · "must complete a separate identity
  //  check through Persona before publishing profile changes" · "claiming a profile carries no guarantee of
  //  better placement or more sales".
  venturebeatBusinessHub: {
    id: 'venturebeat-business-hub', title: 'OpenAI lets you claim your business in ChatGPT and set up a custom agentic AI customer sales rep (10 Kasım 2026)', publisher: 'VentureBeat',
    url: 'https://venturebeat.com/technology/openai-lets-you-claim-your-business-in-chatgpt-and-set-up-a-custom-agentic-ai-customer-sales-rep', accessed: ERISIM_ISLETME,
  },
  //  LLM Pulse derlemesi, 11.11.2026 (ucuncu taraf; OpenAI sayfalarina ve ilk gun denemelerine dayaniyor):
  //  adimlarin sirasi, ulke listesi yayimlanmadigi, "Business Hub and Business Agents are free at launch.",
  //  "local businesses can only claim an existing listing, and only in the US", rakamlarda tek tek soru ve rakip
  //  bulunmadigi, "At least one claim made outside the US went to a waitlist on launch day, according to PPC Land."
  llmpulseBusinessHub: {
    id: 'llmpulse-business-hub', title: 'ChatGPT Business Hub explained: how to claim your business and what Insights shows (11 Kasım 2026)', publisher: 'LLM Pulse',
    url: 'https://llmpulse.ai/blog/chatgpt-business-hub/', accessed: ERISIM_ISLETME,
  },
  // ── Turkiye'de satilan AI gorunurluk urunleri (14.11.2026, saticinin kendi sayfasi, render edilmis) ──
  //  rankzupAI (rankzup.ai/tr/fiyatlar): "Tüm paketlerde aynı motor seti (Google AI Overviews, ChatGPT, Gemini,
  //   Perplexity)" · Starter "1.749 ₺" "/ay +KDV" "1 proje · 1 koltuk" "25 izlenen sorgu" "haftalık tarama" ·
  //   Growth "3.269 ₺" · Scale "6.149 ₺" · Agency "13.699 ₺" "/ay +KDV" "10 proje · 10 koltuk" "250 izlenen sorgu"
  //   "White-label rapor + çoklu proje" · "Bizdeki ek motorlar Claude, Grok ile Google AI Mode. Ücretleri plana
  //   göre değişiyor." · "Arayüz ve sorgu dili	TR + EN" · "Haftalık PDF raporu (e-posta)" ve "Paylaşımlı canlı
  //   rapor linki — Üyeliksiz açılan, müşteriyle paylaşılabilir sayfa." (dort pakette) · "REST API + MCP" ve
  //   "Looker Studio ucu" (Scale, Agency) · "Beyaz-etiket müşteri raporu — Ajanslar için kendi logonla raporlama."
  //   (yalniz Agency) · "Fiyatlara KDV dahil değildir." · "Kredi kartı gerekmez" · "7 gün ücretsiz dene"
  rankzupPricing: {
    id: 'rankzup-pricing', title: 'rankzupAI fiyatlar', publisher: 'rankzupAI',
    url: 'https://rankzup.ai/tr/fiyatlar', accessed: ERISIM_TURKIYE,
  },
  //  rankzupAI (rankzup.ai/tr, ana sayfa): "7 AI motoruna kadar" · "Brief'ten yayına hazır makale" "GEO Brief'i
  //   tek tıkla SSS ve iç link önerili, yayına hazır bir taslak makaleye dönüştür." · "E-ticaret İçin Yapay
  //   Zeka Görünürlüğü" · "rankzupAI artık Shopify App Store'da: eklentiyi kur, ürün başlıklarından
  //   müşterilerinin yapay zekaya sorduğu soruları otomatik üretsin" · "Ürün (SKU) bazında AI görünürlük
  //   takibi" · "Ödeme Shopify faturana eklenir, ayrı kart gerekmez"
  rankzupHome: {
    id: 'rankzup', title: 'rankzupAI ana sayfa', publisher: 'rankzupAI',
    url: 'https://rankzup.ai/tr', accessed: ERISIM_TURKIYE,
  },
  //  rankzupAI (rankzup.ai/tr/hakkimizda): "rankzupAI, markaların ChatGPT, Gemini, Perplexity, Claude, Grok ve
  //   Google AI Overviews cevaplarında ne kadar göründüğünü ölçen bir yapay zeka görünürlük platformudur." ·
  //   "Taha Yelkenci'nin Eylül 2012'de kurduğu İstanbul merkezli SEO ve GEO ajansı rankZup" · "rankzupAI 2026'da
  //   bu boşluğu kapatmak için geliştirildi."
  rankzupAbout: {
    id: 'rankzup-about', title: 'rankzupAI hakkında', publisher: 'rankzupAI',
    url: 'https://rankzup.ai/tr/hakkimizda', accessed: ERISIM_TURKIYE,
  },
  //  Geovium (geovium.com/tr; fiyat kartlari ana sayfada ve /tr/pricing'de ayni): "GEO platformu" · "Geovium,
  //   müşterilerinizin sorduğu soruları ChatGPT, Gemini, Claude, Perplexity ve Grok'a sorar" · Starter "₺2.990"
  //   "+ KDV" "/ay" "Tarama başına 25 takip edilen soru" "1 çalışma alanı" "2 kullanıcı" "Haftalık taramalar"
  //   "Yanıtlarınızın CSV dışa aktarımı" · Pro "₺5.490" · Growth "₺13.990" · Ajans "₺29.990" "+ KDV" "10 çalışma
  //   alanı" "10 kullanıcı" · "14 gün ücretsiz deneme. Kredi kartı gerekmez." · E-ticaret ekipleri: "Shopify ve
  //   Google Merchant Center'ı bağlayın" · entegrasyonlar "isteğe bağlı … Taramalar bunlar olmadan da çalışır." ·
  //   alt bilgi "KUTBU YAZILIM BİLİŞİM TEKNOLOJİLERİ SANAYİ VE TİCARET A.Ş." "Ataşehir, İstanbul"
  geovium: {
    id: 'geovium', title: 'Geovium ana sayfa (özellikler ve fiyat kartları)', publisher: 'Geovium',
    url: 'https://geovium.com/tr', accessed: ERISIM_TURKIYE,
  },
  //  Visby (visby.ai/tr): baslik "Visby - ChatGPT, Claude ve Gemini için AI Görünürlük Platformu" · "Visby
  //   ChatGPT, Claude, Gemini ve Google AI Overviews'u takip eder. Her plan seçeceğiniz üç motoru içerir"
  visbyHome: {
    id: 'visby', title: 'Visby ana sayfa', publisher: 'Visby',
    url: 'https://visby.ai/tr', accessed: ERISIM_TURKIYE,
  },
  //  Visby (visby.ai/tr/pricing): Starter "$79" "/ay" "İSTEDİĞİNİZ 3 AI MOTORUNU SEÇİN" (ChatGPT, Claude, Gemini,
  //   AI Overviews) "1 domain" "15 takip edilen prompt" "Google Search Console, Google Analytics, Bing and Shopify
  //   entegrasyonları" · Growth "$199" "Google Merchant Center entegrasyonu" · Enterprise "Görüşelim" · "Evet -
  //   Starter planının ücretsiz denemesini doğrudan kayıt sayfasından başlatabilirsiniz." (sure yazmiyor) ·
  //   plan karsilastirma tablosu: "Aylık AI yanıtı analizi" 45 / 270 / 750+ · "Aylık makale üretimi" 5 / 15 / 25
  //   (plan kartlarinda makale maddesi yalniz Enterprise'da: "Ayda 25 makale üretimi")
  visbyPricing: {
    id: 'visby-pricing', title: 'Visby fiyatlar', publisher: 'Visby',
    url: 'https://visby.ai/tr/pricing', accessed: ERISIM_TURKIYE,
  },
  //  Yanıt IO (yanit.io): "Yanıt IO (yanit.io), markaların ChatGPT, Claude ve Gemini yanıtlarındaki görünürlüğünü
  //   ölçen Türkiye merkezli bir yapay zekâ görünürlük (GEO) platformudur." · "Perplexity beta olarak ölçülür."
  yanit: {
    id: 'yanit', title: 'Yanıt IO ana sayfa', publisher: 'Yanıt IO',
    url: 'https://yanit.io/', accessed: ERISIM_TURKIYE,
  },
  //  Yanıt IO (yanit.io/pricing, "Son güncelleme: 12 Kasım 2026"): "Yanıt IO aboneliği ₺2.499/ay (KDV dahil).
  //   Ödeme yakında açılıyor; o zamana kadar ücretsiz başlayabilirsiniz, kart istenmez." · Erken erişim "₺0"
  //   "10 izlenebilir soru · 10 rakip" · abonelik "200 izlenebilir soru · 50 rakip (adil kullanım)" "Mağaza
  //   bağlantısı: 2 mağaza, 5.000 ürün" "haftalık rapor, paylaşılabilir rapor linki" "5 ekip üyesi"
  yanitPricing: {
    id: 'yanit-pricing', title: 'Yanıt IO fiyatlandırma', publisher: 'Yanıt IO',
    url: 'https://yanit.io/pricing', accessed: ERISIM_TURKIYE,
  },
  //  AIWATCH (aiwatch.com.tr): "Türkiye pazarı için geliştirilen, kanıt odaklı AI görünürlük platformu." ·
  //   "ChatGPT, Gemini ve kurulumunuzda açık diğer AI motorlarında" · "Fiyatlar marka sayınıza ve ihtiyaçlarınıza
  //   göre özelleşir — size özel teklif için iletişime geçin." · "Siteniz yapay zekâya hazır mı? Ücretsiz ölçün."
  //   · Kurumsal paket: "API erişimi" "White-label rapor" · "Bir FinHouse.ai ürünüdür" "İstanbul, Türkiye"
  aiwatch: {
    id: 'aiwatch', title: 'AIWATCH ana sayfa (paketler)', publisher: 'AIWATCH',
    url: 'https://aiwatch.com.tr/', accessed: ERISIM_TURKIYE,
  },
  //  AIWATCH (aiwatch.com.tr/about): "ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok ve Google AI
  //   Overviews gibi 12 yapay zeka motorundaki görünürlüğünü ölçen". Ana sayfa ile ayni liste DEGIL; rehberde
  //   iki ifade de yazildi.
  aiwatchAbout: {
    id: 'aiwatch-about', title: 'AIWATCH hakkımızda', publisher: 'AIWATCH',
    url: 'https://aiwatch.com.tr/about', accessed: ERISIM_TURKIYE,
  },
  //  Zekabi (zekabi.com/fiyat): "Zekabi aylık ya da yıllık abonelikle çalışır. Ücrete marka araştırması, size özel
  //   Türkçe soru seti, her ay ChatGPT, Gemini ve Claude'da ölçüm ve aylık web raporu dahildir." · Hafif "5.000 TL
  //   + KDV / ay" "4–24 soru" "aylık ölçüm" · KOBİ "15.000 TL + KDV / ay" · Kurumsal "40.000 TL + KDV / ay" ·
  //   Ajanslar: "Müşterileriniz için ölçüm; ajans fiyatı, ay sonunda tek ödeme ve kendi adınızla rapor."
  zekabiPricing: {
    id: 'zekabi-pricing', title: 'Zekabi fiyat', publisher: 'Zekabi',
    url: 'https://zekabi.com/fiyat', accessed: ERISIM_TURKIYE,
  },
  //  Sheltron (sheltron.com.tr/fiyatlandirma/): "AI Görünürlük (GEO) danışmanlığı için net rakamlar; SaaS
  //   ürünlerimiz için ihtiyacınıza özel teklif." · Starter "₺35.000" "aylık · 12 hafta sprint (~3 ay)" · Growth
  //   "₺125.000" "aylık · 24 hafta sprint (~6 ay)" · "Tüm fiyatlar aylık + KDV hariç" · "AiSEO, SME-Index, AI
  //   Automation ve GEO Builder platformları — kullanıcı sayısı ve scope'a göre özel fiyatlandırma." Ana sayfadaki
  //   "Türkiye'nin ilk …" iddiasi rehbere ALINMADI (GEON ve AIWATCH de ayni iddiayi yaziyor).
  sheltronPricing: {
    id: 'sheltron-pricing', title: 'Sheltron fiyatlandırma', publisher: 'Sheltron',
    url: 'https://sheltron.com.tr/fiyatlandirma/', accessed: ERISIM_TURKIYE,
  },
  // ── ChatGPT'de alisveris sonuclari (14.11.2026, tarayicida dogrudan okundu) ──
  //  OpenAI Help Center: "Product results are not ads" · "When determining which products to surface, ChatGPT
  //   considers: Structured metadata from first-party and third-party providers (e.g., price, product
  //   description) and other third-party content." · "These model-generated summaries are based on reviews from
  //   public websites" · "Merchants are ranked based on factors like availability, price, quality, and whether
  //   they are the maker or primary seller of that item." · "For merchants on Shopify, product data is already
  //   integrated into ChatGPT through Shopify Catalog … No additional work is required from individual merchants."
  //   · "Merchants interested in providing a direct product feed to OpenAI … can read the Product Feed
  //   documentation on our developer site and apply for direct feeds access." · "Keep in mind that not all
  //   available products will necessarily be shown"
  openaiShoppingHelp: {
    id: 'openai-shopping-help', title: 'Shopping with ChatGPT Search', publisher: 'OpenAI Help Center',
    url: 'https://help.openai.com/en/articles/11128490-shopping-with-chatgpt-search', accessed: ERISIM_TURKIYE,
  },
  //  OpenAI Developers, "Product feed schema" (developers.openai.com/commerce/specs/feed bu adrese yonleniyor):
  //   "Submit product data for discovery in ChatGPT, with separate requirements for Ads and checkout." · "The
  //   standard OpenAI-format upload currently targets the US. … Use additional markets only after OpenAI confirms
  //   the integration and its allowed countries and currencies." · "Eligibility does not guarantee display." ·
  //   target_countries: "the shared format currently represents US, CA, and MX. Standard uploads use ["US"]
  //   regardless of this column." Belgede Turkiye'nin adi gecmiyor.
  openaiProductFeed: {
    id: 'openai-product-feed', title: 'Product feed schema', publisher: 'OpenAI Developers',
    url: 'https://developers.openai.com/commerce/specs/file-upload/products', accessed: ERISIM_TURKIYE,
  },
  // ── Birinci taraf: KobiPratik (kurucu ekibimizin ortagi oldugu site) ──
  kpCitation: {
    id: 'kp-citation', title: 'KobiPratik AI kaynak gösterme ölçümü', publisher: 'RanksUp ölçümü',
    note: '16 Ekim 2026; ChatGPT, Perplexity, Gemini ve Claude; asistan başına 3 tur × 5 soru (15 cevap).',
  },
  kpPerplexity: {
    id: 'kp-perplexity', title: 'KobiPratik Perplexity günlük ölçümü', publisher: 'RanksUp ölçümü',
    note: '18 Mayıs – 31 Ağustos 2026, günlük ölçüm.',
  },
  kpGsc: {
    id: 'kp-gsc', title: 'KobiPratik Google Search Console performans raporu', publisher: 'Google Search Console (birinci taraf)',
    note: '16 Mayıs – 13 Ağustos 2026; günlük ortalama ilk 30 gün ile son 30 gün karşılaştırması, 28 günlük toplam 13 Ağustos 2026’da biten dönem.',
  },
  kpCloudflare: {
    id: 'kp-cloudflare', title: 'KobiPratik Cloudflare AI Crawl Control paneli', publisher: 'Cloudflare (birinci taraf)',
    note: 'Ekim 2026, 7 günlük pencere.',
  },
} as const satisfies Record<string, RehberSource>;
