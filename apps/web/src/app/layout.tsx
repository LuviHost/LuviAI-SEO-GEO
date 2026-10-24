import './globals.css';
import Script from 'next/script';
import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { CookieConsent } from '@/components/cookie-consent';
import { AppSessionProvider } from '@/components/session-provider';
import { Toaster } from 'sonner';
import { RefTracker } from '@/components/ref-tracker';
import { SignupEvent } from '@/components/signup-event';
import { fontVariables } from '@/lib/fonts';

// Microsoft Clarity project ID — heatmap + session recording.
// Default to RanksUp production project; .env'den override edilebilir (staging için ayrı ID).
// Bos dize Clarity'yi kapatir.
const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ?? 'x8l5as16yd';

// Google Tag Manager container ID — analytics + remarketing + conversion tracking.
// Bos dize GTM'i kapatir.
//
// NEDEN burada yuklenmiyor: GTM ve Clarity eskiden her sayfa goruntulemesinde
// onaysiz yukleniyordu; cerez bandindaki "Reddet" hicbir seyi degistirmiyordu.
// Artik ikisi de YALNIZ ziyaretci banttan "Kabul et" dediginde CookieConsent
// tarafindan yuklenir (lib/consent.ts: KVKK cerez rehberi 7 ve 7.3, e-Gizlilik
// 2002/58/EC m. 5(3), Google Consent Mode temel kip). Kimlikler yalniz bu
// bilesene gecer.
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID ?? 'GTM-TSH8KWCC';

// Dogrudan gtag.js ile GA4 olcum kimligi. VARSAYILAN BOS: ranksup.ai GA4'e zaten
// GTM-TSH8KWCC icindeki Google etiketiyle olculuyor (Analytics hesabi "LuviAI",
// mulk 537885751; 25.10.2026'da veri akisi gorulerek dogrulandi). Burada ayrica
// bir kimlik verilirse page_view'ler cift sayilir ya da iki mulke bolunur.
// Bos iken sign_up olayi dataLayer'a gider (SignupEvent) ve GTM'deki "sign_up"
// ozel olay tetikleyicisi GA4'e iletir. Dolu ve gecerli bir kimlik verilirse
// GTM gibi YALNIZ "Kabul et" sonrasi CookieConsent yukler (lib/consent.ts).
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_ID ?? '';

const SITE_URL = 'https://ranksup.ai';
// Browser tab + Google snippet için uzun başlık (60 char)
const TITLE = 'RanksUp — AI çağının pazarlama platformu';
// Tüm sayfalarda fallback (max 160 char Google için)
// "Sıralamanı yükselt" bir sonuç vaadiydi; Kullanım Şartları SEO sonucunu garanti etmiyor.
const DESCRIPTION = 'AI çağının görünürlük platformu. GEO, SEO, ASO ve Apple Search Ads tek panelde — markanı ChatGPT, Claude ve Gemini cevaplarında ölç, App Store sıralamanı takip et.';
// WhatsApp / Telegram / Discord unfurl için kısa versiyon (max 90 char, sosyal görseli güzelleştirir)
const OG_TITLE = 'RanksUp — Senin yerine pazarlama yapan AI';
const OG_DESCRIPTION = 'GEO · SEO · ASO · Apple Search Ads — hepsi tek panel. 14 gün ücretsiz, 2 makale, kart gerekmez.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s · RanksUp',
  },
  description: DESCRIPTION,
  applicationName: 'RanksUp',
  // Yalniz calisan ozellikler. Sosyal medya modulu (planlayici, X / LinkedIn
  // otomatik post) 0db5a1c'de kaldirildi; anahtar kelimelerde kalmisti.
  keywords: [
    'SEO otomasyonu', 'AI içerik üretimi', 'GEO optimizasyonu', 'AI search optimization',
    'Generative Engine Optimization', 'ChatGPT görünürlük', 'Perplexity SEO',
    'WordPress otomatik yayın', 'Türkçe AI yazar', 'site denetimi', 'meta tag üretici',
    'App Store optimizasyonu', 'ASO', 'Apple Search Ads',
    'Google Ads denetimi', 'Meta Ads denetimi', 'kampanya skoru',
  ],
  authors: [{ name: 'RanksUp', url: SITE_URL }],
  creator: 'RanksUp',
  publisher: 'RanksUp',
  formatDetection: { email: false, address: false, telephone: false },
  alternates: {
    canonical: SITE_URL,
    // NOT: Dil değişimi client-side (localStorage). `?locale=en` SSR'da aynı TR HTML'i
    // döndürür — ayrı bir EN URL yok. Bu yüzden var olmayan bir en-US alternate ilan
    // ETMİYORUZ (geçersiz hreflang + duplicate content sinyali olur). Gerçek path-bazlı
    // i18n (/en) eklendiğinde buraya en-US eklenmeli.
    languages: {
      'tr-TR': SITE_URL,
      'x-default': SITE_URL,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    alternateLocale: ['en_US'],
    url: SITE_URL,
    siteName: 'RanksUp',
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [
      {
        url: `${SITE_URL}/og-image.png?v=2`,
        secureUrl: `${SITE_URL}/og-image.png?v=2`,
        width: 1200,
        height: 630,
        alt: 'RanksUp — AI ile pazarlama platformu',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@luvihost',
    creator: '@luvihost',
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [{
      url: `${SITE_URL}/og-image.png?v=2`,
      alt: 'RanksUp — AI ile pazarlama platformu',
    }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    shortcut: '/favicon-32.png',
    apple: '/apple-touch-icon.png',
  },
  category: 'technology',
  // Search Console / Webmaster verification — gerçek tokenları .env'den oku
  verification: {
    google: process.env.NEXT_PUBLIC_GSC_VERIFICATION,
    other: {
      'msvalidate.01': process.env.NEXT_PUBLIC_BING_VERIFICATION ?? '',
      'yandex-verification': process.env.NEXT_PUBLIC_YANDEX_VERIFICATION ?? '',
    },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#020617' },
  ],
};

// Organization + WebSite + SoftwareApplication JSON-LD — global root schema
const orgJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'RanksUp',
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/og-image.png?v=2`,
        width: 1200,
        height: 630,
      },
      sameAs: [
        'https://x.com/luvihost',
        'https://www.linkedin.com/company/luvihost',
      ],
      description: DESCRIPTION,
      foundingDate: '2026',
      areaServed: { '@type': 'Country', name: 'Turkey' },
      knowsAbout: [
        'Search Engine Optimization',
        'Generative Engine Optimization',
        'AI Search Optimization',
        'Content Marketing Automation',
        'App Store Optimization',
        'WordPress Publishing',
        'Google Ads',
        'Meta Ads',
      ],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'RanksUp',
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: ['tr-TR', 'en-US'],
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#software`,
      name: 'RanksUp',
      url: SITE_URL,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'SEO + Content Automation',
      operatingSystem: 'Web',
      description: DESCRIPTION,
      // Fiyat USD'de kanonik (apps/api/src/billing/plans.ts); TL gunun kuruyla
      // hesaplandigi icin schema'ya yazilamaz. Eskiden bayat TL araligi
      // (₺1.499 - ₺34.999) yayinlaniyordu. Deger pricing/layout.tsx ile ayni;
      // public-docs.spec.ts denetler.
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'USD',
        lowPrice: '149',
        highPrice: '1499',
        offerCount: 4,
      },
      // Yalniz calisan ozellikler: Shopify yayin hedefi yok (14 hedef:
      // publish-targets.service TARGET_TYPES), sosyal medya modulu kaldirildi,
      // makale uzunlugu sabit degil (yazar istemi: dolgu yok).
      featureList: [
        'AI site denetimi (SEO + GEO)',
        'AI makale üretimi (5 ajanlı üretim hattı + yayın öncesi kalite kapısı)',
        'WordPress, Webflow, Ghost, FTP/SFTP, cPanel ve GitHub dahil 14 yayın hedefine otomatik yayın',
        'AI görünürlük ölçümü (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek)',
        'Ajan Hazırlığı (AXO) taraması ve önizlemeli robots.txt / llms.txt / sitemap düzeltmesi',
        'ASO: App Store ve Google Play metadata optimizasyonu, anahtar kelime sıra takibi',
        'Apple Search Ads ve App Store Connect entegrasyonu',
        'Google Ads + Meta Ads kampanya denetimi',
        'AI crawler trafiği takibi (GPTBot, ClaudeBot, PerplexityBot)',
      ],
      provider: { '@id': `${SITE_URL}/#organization` },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning className={fontVariables}>
      <head>
        {/* RanksUp AI tarayici sayaci — kendi sitemizi izler (GPTBot, ClaudeBot, PerplexityBot, vs.).
            Onaydan bagimsiz yuklenir cunku cerez yazmaz, tarayicida bir sey saklamaz ve kisisel
            veri tutmaz: betik (apps/api/src/audit/tracker.controller.ts buildTrackerJs) yalniz
            kullanici ajani AI botu ya da yonlendiren bir AI asistani ise 1x1 beacon atar; sunucu
            gunluk toplam (bot) ve asistan basina en cok acilan 10 sayfa adresini yazar, IP
            yalniz bellekte hiz siniri icindir (crawler-tracking.middleware.ts, ai-referrer.service.ts).
            Gizlilik sayfasi (privacy/page.tsx) bunu boyle anlatir. */}
        <Script
          id="luviai-tracker"
          src="https://ranksup.ai/api/tracker.js?site=cmp6036790001artdfumwec57"
          strategy="afterInteractive"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
      </head>
      <body className="font-sans antialiased min-h-screen bg-background text-foreground">
        {/* GTM noscript iframe'i BILEREK yok: JavaScript kapaliyken bant calismaz, yani onay
            alinamaz; ns.html iframe'i ise container'in noscript etiketlerini onaysiz atardi. */}
        <RefTracker />
        <AppSessionProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
            <CookieConsent gtmId={GTM_ID} clarityId={CLARITY_PROJECT_ID} gaId={GA_MEASUREMENT_ID} />
            <SignupEvent gaId={GA_MEASUREMENT_ID} />
            <Toaster position="top-right" richColors closeButton />
          </ThemeProvider>
        </AppSessionProvider>
      </body>
    </html>
  );
}
