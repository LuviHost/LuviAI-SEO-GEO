'use client';

import { useSyncExternalStore } from 'react';

export type Locale = 'tr' | 'en';

// Tek source-of-truth: dictionary
const dictionary = {
  tr: {
    // Nav
    'nav.home': 'Ana Sayfa',
    'nav.pricing': 'Fiyatlar',
    'nav.dashboard': 'Panel',
    'nav.login': 'Giriş Yap',
    'nav.signup': 'Erken Erişim',
    'nav.faq': 'SSS',
    'nav.compare': 'Karşılaştır',
    'nav.use_cases': 'Kullanım Senaryoları',

    // Hero
    'hero.title': 'Siteni ve sosyal medyanı, AI ile birlikte yönet',
    'hero.subtitle': "SEO ve GEO uyumlu içerikler otomatik üretilir, takvimden saatini seçersin, sitene ve sosyal kanallarına (X, LinkedIn) otomatik yayınlanır.",
    'hero.cta_primary': 'Erken Erişime Katıl',
    'hero.cta_secondary': 'Demo İzle',
    'hero.beta_note': 'Beta — şu anda davet üzeri kayıt',

    // Value cards (4 sütun)
    'value.title': 'Her şeyi tek panelden yönet',
    'value.subtitle': "Site analizinden makale üretimine, sosyal takvimden otomatik yayına — 4 işi tek dashboard'dan otomatikleştirir.",
    'value.v1.title': 'Sitesini AI denetler',
    'value.v1.desc': '14 SEO + GEO kontrolü. Eksikleri otomatik düzeltir (sitemap, robots.txt, llms.txt). GSC ile büyümeyi izler.',
    'value.v2.title': 'İçeriği AI üretir',
    'value.v2.desc': '6 ajanlı yazım zinciri: anahtar kelime → taslak → yazar → editör → görsel → şema. Türkçe, 1800–2500 kelime, FAQ + Article schema.',
    'value.v3.title': 'Takvimden planla',
    'value.v3.desc': "Plana göre ayda 8, 18 veya 30 sosyal post. PZT/SAL/CAR gibi günleri ve saati seç, X ve LinkedIn'e otomatik atılır.",
    'value.v4.title': 'Otomatik yayınla',
    'value.v4.desc': 'WordPress, FTP, GitHub, Webflow, Sanity, Ghost… 14 yayın hedefi. Onay bekleyen makaleyi tek tıkla canlıya al.',

    // Features section
    'features.eyebrow': 'Tek panelde 6 büyük iş',
    'features.title': 'Saatlerce uğraşmana gerek yok',
    'features.subtitle': 'Site eklediğin an şunlar otomatik başlar — hepsi tek panelden yönetilir.',
    'features.f1.title': 'AI içerik üretimi',
    'features.f1.desc': 'SEO + GEO uyumlu, marka sesinde 1800-2500 kelimelik makaleler. 6 ajan zinciri (anahtar kelime → outline → yazar → editör → görsel → yayıncı).',
    'features.f2.title': 'Çok kanallı yayın',
    'features.f2.desc': 'WordPress, FTP, SFTP, GitHub Pages, custom webhook ve daha fazlası. Yayın zamanını takvimden sürükle-bırak ile belirle.',
    'features.f3.title': 'Sosyal medya otomatik',
    'features.f3.desc': 'X (Twitter) ve LinkedIn için marka sesinde post draft\'ları. Plana göre ayda 8-30 post otomatik takvime alınır.',
    'features.f4.title': 'AI Search (GEO)',
    'features.f4.desc': 'ChatGPT, Claude, Gemini, Perplexity\'de görünürlük takibi. llms.txt, schema markup, FAQ otomatik optimize edilir.',
    'features.f5.title': 'Reklam autopilot',
    'features.f5.desc': 'Google Ads + Meta Ads kampanya optimizasyonu. ROAS\'a göre 6 saatte bir bütçe ayarı yapılır.',
    'features.f6.title': 'Detaylı analitik',
    'features.f6.desc': 'GSC + GA4 + AI Citation entegrasyonu. Performans düşen makaleler 30 gün sonra otomatik revize edilir.',

    // Social schedule strip
    'social.eyebrow': 'Sosyal Medya Takvimi',
    'social.title': 'X ve LinkedIn için haftalık post takvimi',
    'social.desc': 'Makale yayınlandığında otomatik post draft\'ı oluşturulur. Sen sadece beğen, düzenle ya da onayla.',
    'social.b1': 'Plana göre ayda 8, 18 veya 30 post otomatik',
    'social.b2': 'Saatleri PZT/SAL/CAR ızgarasında inline düzenle',
    'social.b3': 'Hashtag, mention, link otomatik renklendirilir',
    'social.b4': 'X için 280 karakter limiti gerçek zamanlı sayaç',
    'social.b5': 'Yetersiz içerik varsa slot atlanır, eklenince yayınlanır',

    // How it works
    'how.eyebrow': 'Akış',
    'how.title': 'Site eklediğinden 90 saniye sonra ilk makalen yayında',
    'how.s1.title': '1. Site URL\'ini gir',
    'how.s1.desc': 'Sadece domain — gerisini AI yapar. Otomatik tarama → marka sesi tespiti → niş analizi.',
    'how.s2.title': '2. AI 6 konu önerir',
    'how.s2.desc': 'Plan + GSC + GEO + rakip analizi → tier-1 öneriler. Sürükle-bırak ile takvime al.',
    'how.s3.title': '3. Otomatik üret + yayınla',
    'how.s3.desc': 'Yayın saati gelir → 14 saniyede mock veya 90sn gerçek pipeline → WordPress\'e gider.',

    // GEO section
    'geo.eyebrow': 'AI Search optimizasyonu',
    'geo.title': 'ChatGPT, Claude, Gemini\'de seni alıntılasınlar',
    'geo.subtitle': 'GEO (Generative Engine Optimization) — geleneksel SEO\'nun ötesinde. Citation skoru günlük takip edilir.',
    'geo.b1': 'llms.txt + llms-full.txt otomatik üretilir',
    'geo.b2': 'Schema markup (Article + FAQPage + HowTo) eklenir',
    'geo.b3': 'AI crawler izinleri (GPTBot, ClaudeBot vb.) açılır',
    'geo.b4': 'Speakable content + multi-modal media (TTS audio) entegre',
    'geo.b5': 'Günlük citation snapshot — düşüş varsa email alarmı',

    // Ads section
    'ads.eyebrow': 'Reklam autopilot',
    'ads.title': 'Google Ads + Meta Ads ROAS\'a göre otomatik optimize edilir',
    'ads.subtitle': 'Reklam uzmanı tutmaya gerek yok. AI 6 saatte bir kampanyaları analiz edip bütçeyi en iyi performansa kaydırır.',
    'ads.b1': 'Auto-bid + auto-pause düşük performanslı reklamlar',
    'ads.b2': 'AI ile reklam görseli (Gemini) + metin draft\'ı',
    'ads.b3': 'Multi-platform tek panel (Google + Meta + GA4 conversion)',
    'ads.b4': 'A/B test sürekli — kazanan creative\'i otomatik scale',
    'ads.impact': '<strong class="text-orange-500">Etki:</strong> Ortalama bir KOBİ Google + Meta\'ya ayda 5-15k ₺ harcıyor. Kötü yönetilirse %30-50\'si israf olur. <strong>LuviAI bunu otomatik kapatır → ayda 1.5-7.5k ₺ tasarruf.</strong>',

    // Comparison table
    'compare.title': 'LuviAI vs klasik kadro',
    'compare.subtitle': 'Tek bir panel, 6 farklı uzmanın yaptığı işi yapıyor.',
    'compare.col_need': 'İhtiyaç',
    'compare.col_classic': 'Klasik',
    'compare.col_luviai': 'LuviAI',
    'compare.row_seo': 'SEO uzmanı',
    'compare.row_writer': 'Makale yazarı',
    'compare.row_social': 'Sosyal medya yöneticisi',
    'compare.row_ads': 'Reklam uzmanı (Google + Meta)',
    'compare.row_ab': 'A/B test analist',
    'compare.row_ga': 'GA4 expert',
    'compare.row_ai': 'AI Search optimizasyonu',
    'compare.row_total': 'TOPLAM',
    'compare.classic_total': '78-140k ₺/ay',
    'compare.luviai_total_label': 'LuviAI ile',
    'compare.luviai_total_subtext': 'aylık başlangıç (Pro plan)',

    // Final CTA
    'final.title': 'Saatlerce uğraşmaktan kurtul. Bugün başla.',
    'final.subtitle': '14 günlük deneme. Kredi kartı gerekmez. İstediğin zaman iptal et.',
    'final.cta_primary': 'Ücretsiz Dene',
    'final.cta_secondary': 'Plan ve fiyatları gör',

    // Footer
    'footer.product': 'Ürün',
    'footer.product.how': 'Nasıl çalışır',
    'footer.product.features': 'Özellikler',
    'footer.product.pricing': 'Fiyatlar',
    'footer.product.faq': 'SSS',
    'footer.legal': 'Hukuk',
    'footer.legal.terms': 'Kullanım koşulları',
    'footer.legal.privacy': 'Gizlilik politikası',
    'footer.legal.kvkk': 'KVKK',
    'footer.contact': 'İletişim',
    'footer.contact.support': 'Destek',
    'footer.contact.status': 'Sistem durumu',
    'footer.tagline': 'Türkiye merkezli AI içerik + sosyal + reklam otopilotu.',
    'footer.copyright': '© 2026 LuviAI. Tüm hakları saklıdır.',

    // Pricing
    'pricing.title': 'Plan Seçenekleri',
    'pricing.subtitle': 'Ücretsiz başla, dilediğin zaman iptal et.',
    'pricing.monthly': 'Aylık',
    'pricing.annual': 'Yıllık',
    'pricing.save': 'kazan',
    'pricing.cta': '1 Makale Ücretsiz Dene',
    'pricing.popular': 'EN POPÜLER',
    'pricing.articles_per_month': 'SEO makale/ay',
    'pricing.social_posts_per_month': 'sosyal medya postu/ay (X, LinkedIn)',
    'pricing.sites': 'site',
    'pricing.all_publish_targets': 'Tüm yayın hedefleri',
    'pricing.markdown_only': 'Sadece Markdown ZIP',
    'pricing.security_note': '💳 PayTR güvenli ödeme · ✅ İstediğin zaman iptal · 🇹🇷 KDV dahil',

    // Dashboard
    'dashboard.title': 'Panel',
    'dashboard.new_site': '+ Yeni Site',
    'dashboard.sites': 'Sitelerim',
    'dashboard.empty': 'Henüz site eklenmemiş.',
    'dashboard.add_first': 'İlk siteni ekle →',

    // Common
    'common.loading': 'Yükleniyor…',
    'common.error': 'Bir hata oluştu',
    'common.cancel': 'İptal',
    'common.save': 'Kaydet',
    'common.continue': 'Devam',
    'common.back': 'Geri',
    'common.finish': 'Bitir',
    'common.try_again': 'Tekrar dene',
    'common.learn_more': 'Daha fazla',
  },
  en: {
    // Nav
    'nav.home': 'Home',
    'nav.pricing': 'Pricing',
    'nav.dashboard': 'Dashboard',
    'nav.login': 'Sign In',
    'nav.signup': 'Early Access',
    'nav.faq': 'FAQ',
    'nav.compare': 'Compare',
    'nav.use_cases': 'Use Cases',

    // Hero
    'hero.title': 'Manage your website and social with AI, on autopilot',
    'hero.subtitle': 'SEO + GEO ready content gets generated automatically, you pick the time on the calendar, and it publishes to your site and social channels (X, LinkedIn).',
    'hero.cta_primary': 'Join Early Access',
    'hero.cta_secondary': 'Watch Demo',
    'hero.beta_note': 'Beta — invite only',

    // Value cards (4 sütun)
    'value.title': 'Manage everything from a single panel',
    'value.subtitle': 'From site audits to article generation, social calendar to auto-publishing — 4 jobs automated from one dashboard.',
    'value.v1.title': 'AI audits your site',
    'value.v1.desc': '14 SEO + GEO checks. Auto-fixes the gaps (sitemap, robots.txt, llms.txt). Tracks growth via GSC.',
    'value.v2.title': 'AI writes your content',
    'value.v2.desc': '6-agent writing chain: keyword → outline → writer → editor → visuals → schema. 1800–2500 words, FAQ + Article schema.',
    'value.v3.title': 'Plan from the calendar',
    'value.v3.desc': '8, 18 or 30 social posts/month based on plan. Pick days like MON/WED/FRI and times — auto-posts to X and LinkedIn.',
    'value.v4.title': 'Auto-publish',
    'value.v4.desc': 'WordPress, FTP, GitHub, Webflow, Sanity, Ghost… 14 publish targets. Approve articles with a single click.',

    // Features section
    'features.eyebrow': 'One panel, six big jobs',
    'features.title': 'You don\'t have to spend hours on it',
    'features.subtitle': 'The moment you add a site, the following kick in automatically — all controlled from a single panel.',
    'features.f1.title': 'AI content generation',
    'features.f1.desc': 'SEO + GEO ready, brand-voice articles of 1800-2500 words. A 6-agent chain (keyword → outline → writer → editor → visuals → publisher).',
    'features.f2.title': 'Multi-channel publishing',
    'features.f2.desc': 'WordPress, FTP, SFTP, GitHub Pages, custom webhook and more. Pick the publish time on a drag-and-drop calendar.',
    'features.f3.title': 'Social media automation',
    'features.f3.desc': 'Brand-voice post drafts for X (Twitter) and LinkedIn. 8-30 posts/month auto-scheduled depending on plan.',
    'features.f4.title': 'AI Search (GEO)',
    'features.f4.desc': 'Track visibility on ChatGPT, Claude, Gemini, Perplexity. Auto-optimized llms.txt, schema markup, FAQ.',
    'features.f5.title': 'Ads autopilot',
    'features.f5.desc': 'Google Ads + Meta Ads campaign optimization. Budget rebalanced based on ROAS every 6 hours.',
    'features.f6.title': 'Detailed analytics',
    'features.f6.desc': 'GSC + GA4 + AI Citation integration. Underperforming articles get auto-revised after 30 days.',

    // Social schedule strip
    'social.eyebrow': 'Social Media Calendar',
    'social.title': 'Weekly post calendar for X and LinkedIn',
    'social.desc': 'When an article publishes, a draft post is created automatically. You just like, edit or approve.',
    'social.b1': '8, 18 or 30 posts/month auto-scheduled depending on plan',
    'social.b2': 'Inline edit times in the MON/TUE/WED grid',
    'social.b3': 'Hashtags, mentions, links auto-highlighted',
    'social.b4': 'Real-time 280-char counter for X',
    'social.b5': 'If content is short, slot is skipped and reused later',

    // How it works
    'how.eyebrow': 'Flow',
    'how.title': 'Your first article goes live 90 seconds after you add the site',
    'how.s1.title': '1. Enter your site URL',
    'how.s1.desc': 'Just the domain — AI does the rest. Auto-crawl → brand voice → niche analysis.',
    'how.s2.title': '2. AI suggests 6 topics',
    'how.s2.desc': 'Plan + GSC + GEO + competitor analysis → tier-1 suggestions. Drag-and-drop into the calendar.',
    'how.s3.title': '3. Auto-generate + publish',
    'how.s3.desc': 'Time arrives → 14sec mock or 90sec real pipeline → ships to WordPress.',

    // GEO
    'geo.eyebrow': 'AI Search optimization',
    'geo.title': 'Get cited by ChatGPT, Claude, Gemini',
    'geo.subtitle': 'GEO (Generative Engine Optimization) — beyond traditional SEO. Daily citation score tracking.',
    'geo.b1': 'Auto-generated llms.txt + llms-full.txt',
    'geo.b2': 'Schema markup (Article + FAQPage + HowTo) injected',
    'geo.b3': 'AI crawler permissions (GPTBot, ClaudeBot, etc.) opened',
    'geo.b4': 'Speakable content + multi-modal media (TTS audio) integrated',
    'geo.b5': 'Daily citation snapshot — email alarm on drop',

    // Ads
    'ads.eyebrow': 'Ads autopilot',
    'ads.title': 'Google Ads + Meta Ads optimized automatically by ROAS',
    'ads.subtitle': 'No need to hire an ads expert. AI analyzes campaigns every 6 hours and shifts budget to the best performers.',
    'ads.b1': 'Auto-bid + auto-pause underperforming ads',
    'ads.b2': 'AI ad creative (Gemini) + copy drafts',
    'ads.b3': 'Multi-platform single panel (Google + Meta + GA4 conversion)',
    'ads.b4': 'Continuous A/B test — auto-scale winning creatives',
    'ads.impact': '<strong class="text-orange-500">Impact:</strong> An average SMB spends 5-15k ₺/month on Google + Meta. Without good management, 30-50% gets wasted. <strong>LuviAI plugs the leak — saving 1.5-7.5k ₺/month.</strong>',

    // Comparison
    'compare.title': 'LuviAI vs the classic team',
    'compare.subtitle': 'A single panel does the work of 6 different specialists.',
    'compare.col_need': 'Need',
    'compare.col_classic': 'Classic',
    'compare.col_luviai': 'LuviAI',
    'compare.row_seo': 'SEO specialist',
    'compare.row_writer': 'Article writer',
    'compare.row_social': 'Social media manager',
    'compare.row_ads': 'Ads specialist (Google + Meta)',
    'compare.row_ab': 'A/B test analyst',
    'compare.row_ga': 'GA4 expert',
    'compare.row_ai': 'AI Search optimization',
    'compare.row_total': 'TOTAL',
    'compare.classic_total': '78-140k ₺/month',
    'compare.luviai_total_label': 'With LuviAI',
    'compare.luviai_total_subtext': 'monthly starting (Pro plan)',

    // Final CTA
    'final.title': 'Stop spending hours on it. Start today.',
    'final.subtitle': '14-day trial. No credit card required. Cancel anytime.',
    'final.cta_primary': 'Try Free',
    'final.cta_secondary': 'See plans & pricing',

    // Footer
    'footer.product': 'Product',
    'footer.product.how': 'How it works',
    'footer.product.features': 'Features',
    'footer.product.pricing': 'Pricing',
    'footer.product.faq': 'FAQ',
    'footer.legal': 'Legal',
    'footer.legal.terms': 'Terms of service',
    'footer.legal.privacy': 'Privacy policy',
    'footer.legal.kvkk': 'KVKK (TR)',
    'footer.contact': 'Contact',
    'footer.contact.support': 'Support',
    'footer.contact.status': 'System status',
    'footer.tagline': 'Turkey-based AI content + social + ads autopilot.',
    'footer.copyright': '© 2026 LuviAI. All rights reserved.',

    // Pricing
    'pricing.title': 'Plans & Pricing',
    'pricing.subtitle': 'Start free, cancel anytime.',
    'pricing.monthly': 'Monthly',
    'pricing.annual': 'Annual',
    'pricing.save': 'save',
    'pricing.cta': 'Try 1 Article Free',
    'pricing.popular': 'MOST POPULAR',
    'pricing.articles_per_month': 'SEO articles/mo',
    'pricing.social_posts_per_month': 'social posts/mo (X, LinkedIn)',
    'pricing.sites': 'sites',
    'pricing.all_publish_targets': 'All publish targets',
    'pricing.markdown_only': 'Markdown ZIP only',
    'pricing.security_note': '💳 PayTR secure payment · ✅ Cancel anytime · 🇹🇷 VAT included',

    // Dashboard
    'dashboard.title': 'Dashboard',
    'dashboard.new_site': '+ New Site',
    'dashboard.sites': 'My Sites',
    'dashboard.empty': 'No sites yet.',
    'dashboard.add_first': 'Add your first site →',

    // Common
    'common.loading': 'Loading…',
    'common.error': 'An error occurred',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.continue': 'Continue',
    'common.back': 'Back',
    'common.finish': 'Finish',
    'common.try_again': 'Try again',
    'common.learn_more': 'Learn more',
  },
} as const;

type Key = keyof typeof dictionary['tr'];

const LOCALE_KEY = 'luviai_locale';
const LOCALE_EVENT = 'luviai:locale-change';

function readLocale(): Locale {
  if (typeof window === 'undefined') return 'tr';
  const saved = window.localStorage.getItem(LOCALE_KEY);
  if (saved === 'en' || saved === 'tr') return saved;
  return navigator.language.startsWith('tr') ? 'tr' : 'en';
}

export function getLocale(): Locale {
  return readLocale();
}

export function setLocale(locale: Locale) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCALE_KEY, locale);
  document.documentElement.lang = locale;
  // Hem custom event (ayni tab) hem storage event (diger tablar) tetiklenir
  window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: locale }));
}

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(LOCALE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(LOCALE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

const getServerSnapshot = (): Locale => 'tr';

export function useT() {
  const locale = useSyncExternalStore<Locale>(subscribe, readLocale, getServerSnapshot);

  const t = (key: Key) => dictionary[locale][key] ?? key;

  return { t, locale, setLocale };
}
