/**
 * Rehber makalelerinin ortak kaynaklari. Her URL 24.10.2026'da ureticinin / yayincinin
 * kendi sayfasindan okundu; `accessed` o tarih. Bir kaynak yeniden kontrol edilince
 * tarihini ve onu kullanan makalenin PUBLIC_PAGES tarihini ayni committe guncelle.
 *
 * Birinci taraf veriler (KobiPratik olcumleri) URL tasimaz; donem ve yontem `note`'ta.
 */
import type { RehberSource } from './types';

const ERISIM = '2026-10-24';

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
  googleTrHelp: {
    id: 'google-tr-help', title: 'Google Arama’daki AI Bakışı özelliği', publisher: 'Google Arama Yardım',
    url: 'https://support.google.com/websearch/answer/14901683?hl=tr', accessed: ERISIM,
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
  ranksupPricing: {
    id: 'ranksup-pricing', title: 'RanksUp fiyatlandırma', publisher: 'RanksUp',
    url: 'https://ranksup.ai/pricing', accessed: ERISIM,
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
  seoyen: {
    id: 'seoyen', title: 'SEOYEN ana sayfa (özellikler)', publisher: 'SEOYEN',
    url: 'https://seoyen.com/', accessed: ERISIM,
  },
  seoyenPricing: {
    id: 'seoyen-pricing', title: 'SEOYEN fiyatlar ve SSS', publisher: 'SEOYEN',
    url: 'https://seoyen.com/fiyatlar/', accessed: ERISIM,
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
  //  Ahrefs (ahrefs.com/brand-radar, ABD'den erisimde USD; Avrupa'da € gosterilebilir): Custom Prompts
  //   "Free for every paid Ahrefs Lite plan and above." "Starts at $50/mo" · AI Visibility Index "Starts at
  //   $199/mo" "496 million prompts" · "The AI Visibility Index covers: … AI Overviews, AI Mode, ChatGPT,
  //   Perplexity, Gemini, Copilot" · "Custom Prompts supports all of the above plus Claude." · "Claude
  //   consumes 8 checks per update."
  ahrefs: {
    id: 'ahrefs', title: 'Brand Radar', publisher: 'Ahrefs',
    url: 'https://ahrefs.com/brand-radar', accessed: ERISIM,
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
