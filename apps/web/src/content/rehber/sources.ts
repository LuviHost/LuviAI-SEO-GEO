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
  perplexityBots: {
    id: 'perplexity-bots', title: 'Perplexity Crawlers', publisher: 'Perplexity',
    url: 'https://docs.perplexity.ai/guides/bots', accessed: ERISIM,
  },
  googleCrawlers: {
    id: 'google-crawlers', title: "Google's common crawlers (Google-Extended)", publisher: 'Google Search Central',
    url: 'https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers', accessed: ERISIM,
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
    id: 'google-faq-2023', title: 'Changes to HowTo and FAQ rich results (8 Ağustos 2023)', publisher: 'Google Search Central Blog',
    url: 'https://developers.google.com/search/blog/2023/08/howto-faq-changes', accessed: ERISIM,
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
    id: 'llmstxt', title: 'The /llms.txt file (öneri, 3 Eylül 2024)', publisher: 'llmstxt.org (Jeremy Howard)',
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
  ranksupAiVisibility: {
    id: 'ranksup-ai-visibility', title: 'AI Görünürlük rehberi (ölçüm yöntemi)', publisher: 'RanksUp',
    url: 'https://ranksup.ai/help/ai-visibility', accessed: ERISIM,
  },
  geon: {
    id: 'geon', title: 'GEON ana sayfa', publisher: 'GEON',
    url: 'https://usegeon.com/', accessed: ERISIM,
  },
  geonPricing: {
    id: 'geon-pricing', title: 'GEON fiyatlandırma', publisher: 'GEON',
    url: 'https://usegeon.com/fiyatlandirma', accessed: ERISIM,
  },
  seoyen: {
    id: 'seoyen', title: 'SEOYEN ana sayfa ve paketler', publisher: 'SEOYEN',
    url: 'https://seoyen.com/', accessed: ERISIM,
  },
  otterly: {
    id: 'otterly', title: 'Otterly.AI pricing', publisher: 'Otterly.AI',
    url: 'https://otterly.ai/pricing', accessed: ERISIM,
  },
  peec: {
    id: 'peec', title: 'Peec AI pricing', publisher: 'Peec AI',
    url: 'https://peec.ai/pricing', accessed: ERISIM,
  },
  peecHome: {
    id: 'peec-home', title: 'Peec AI ana sayfa', publisher: 'Peec AI',
    url: 'https://peec.ai/', accessed: ERISIM,
  },
  profound: {
    id: 'profound', title: 'Profound pricing', publisher: 'Profound',
    url: 'https://www.tryprofound.com/pricing', accessed: ERISIM,
  },
  semrush: {
    id: 'semrush', title: 'AI Visibility Toolkit (bilgi bankası)', publisher: 'Semrush',
    url: 'https://www.semrush.com/kb/1493-ai-toolkit', accessed: ERISIM,
  },
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
    note: 'Günlük tıklama 16 Mayıs – 13 Ağustos 2026; 28 günlük toplam Ekim 2026.',
  },
  kpCloudflare: {
    id: 'kp-cloudflare', title: 'KobiPratik Cloudflare AI Crawl Control paneli', publisher: 'Cloudflare (birinci taraf)',
    note: 'Ekim 2026, 7 günlük pencere.',
  },
} as const satisfies Record<string, RehberSource>;
