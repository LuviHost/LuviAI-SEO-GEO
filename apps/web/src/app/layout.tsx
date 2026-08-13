import './globals.css';
import Script from 'next/script';
import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { CookieConsent } from '@/components/cookie-consent';
import { AppSessionProvider } from '@/components/session-provider';
import { Toaster } from 'sonner';
import { RefTracker } from '@/components/ref-tracker';
import { fontVariables } from '@/lib/fonts';

// Microsoft Clarity project ID — heatmap + session recording.
// Default to RanksUp production project; .env'den override edilebilir (staging için ayrı ID).
const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ?? 'x8l5as16yd';

// Google Tag Manager container ID — analytics + remarketing + conversion tracking.
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID ?? 'GTM-TSH8KWCC';

const SITE_URL = 'https://ranksup.ai';
// Browser tab + Google snippet için uzun başlık (60 char)
const TITLE = 'RanksUp — AI çağının pazarlama platformu';
// Tüm sayfalarda fallback (max 160 char Google için)
const DESCRIPTION = 'AI çağının görünürlük platformu. GEO, SEO, ASO ve Apple Search Ads tek panelde — markanı ChatGPT, Claude ve Gemini cevaplarında ölç, App Store sıralamanı yükselt.';
// WhatsApp / Telegram / Discord unfurl için kısa versiyon (max 90 char, sosyal görseli güzelleştirir)
const OG_TITLE = 'RanksUp — Senin yerine pazarlama yapan AI';
const OG_DESCRIPTION = 'GEO · SEO · ASO · Apple Search Ads — hepsi tek panel. 2 makale ücretsiz, kart gerekmez.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s · RanksUp',
  },
  description: DESCRIPTION,
  applicationName: 'RanksUp',
  keywords: [
    'SEO otomasyonu', 'AI içerik üretimi', 'GEO optimizasyonu', 'AI search optimization',
    'Generative Engine Optimization', 'ChatGPT görünürlük', 'Perplexity SEO',
    'WordPress otomatik yayın', 'Türkçe AI yazar', 'site denetimi', 'meta tag üretici',
    'sosyal medya planlayıcı', 'X otomatik post', 'LinkedIn otomatik post',
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
        'Social Media Management',
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
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'TRY',
        lowPrice: '1499',
        highPrice: '34999',
        offerCount: 4,
      },
      featureList: [
        'AI site denetimi (SEO + GEO)',
        'AI makale üretimi (1800-2500 kelime)',
        'WordPress, Webflow, Shopify otomatik yayın',
        'X + LinkedIn sosyal medya planlayıcı',
        'Google Ads + Meta Ads kampanya denetimi',
        'AI crawler trafiği takibi (GPTBot, ClaudeBot, PerplexityBot)',
        'AI citation tracking (ChatGPT, Claude, Gemini, Perplexity)',
      ],
      provider: { '@id': `${SITE_URL}/#organization` },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning className={fontVariables}>
      <head>
        {/* Google Tag Manager — GA4, conversion, remarketing. En üst konumda (head). */}
        {GTM_ID && (
          <Script id="gtm-head" strategy="afterInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
              new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
              j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
              'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
              })(window,document,'script','dataLayer','${GTM_ID}');`}
          </Script>
        )}
        {/* RanksUp AI Crawler Tracker — kendi sitemizi izle (GPTBot, ClaudeBot, PerplexityBot, vs.) */}
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
        {/* GTM noscript fallback — body açılışının hemen sonrası (resmi öneri) */}
        {GTM_ID && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
            />
          </noscript>
        )}
        {/* Microsoft Clarity — session replay + heatmap. afterInteractive: ana içerikten sonra. */}
        {CLARITY_PROJECT_ID && (
          <Script id="ms-clarity" strategy="afterInteractive">
            {`(function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");`}
          </Script>
        )}
        <RefTracker />
        <AppSessionProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
            <CookieConsent />
            <Toaster position="top-right" richColors closeButton />
          </ThemeProvider>
        </AppSessionProvider>
      </body>
    </html>
  );
}
