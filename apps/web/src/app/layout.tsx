import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { CookieConsent } from '@/components/cookie-consent';
import { AppSessionProvider } from '@/components/session-provider';
import { Toaster } from 'sonner';
import { RefTracker } from '@/components/ref-tracker';

const SITE_URL = 'https://ai.luvihost.com';
const TITLE = 'LuviAI — SEO, içerik üretimi, sosyal medya ve reklam tek panelden';
const DESCRIPTION = 'Sitenin SEO + AI görünürlük denetimini dakikalar içinde yapar, marka sesinde kapsamlı makaleler üretir, sosyal medyaya ve sitene otomatik yayınlar. Türkiye için yapıldı, PayTR ile güvenli ödeme.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s · LuviAI',
  },
  description: DESCRIPTION,
  applicationName: 'LuviAI',
  keywords: [
    'SEO otomasyonu', 'AI içerik üretimi', 'GEO optimizasyonu', 'AI search optimization',
    'Generative Engine Optimization', 'ChatGPT görünürlük', 'Perplexity SEO',
    'WordPress otomatik yayın', 'Türkçe AI yazar', 'site denetimi', 'meta tag üretici',
    'sosyal medya planlayıcı', 'X otomatik post', 'LinkedIn otomatik post',
    'Google Ads denetimi', 'Meta Ads denetimi', 'kampanya skoru',
  ],
  authors: [{ name: 'LuviAI', url: SITE_URL }],
  creator: 'LuviAI',
  publisher: 'LuviAI',
  formatDetection: { email: false, address: false, telephone: false },
  alternates: {
    canonical: SITE_URL,
    languages: {
      'tr-TR': SITE_URL,
      'en-US': `${SITE_URL}/?locale=en`,
      'x-default': SITE_URL,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    alternateLocale: ['en_US'],
    url: SITE_URL,
    siteName: 'LuviAI',
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'LuviAI — SEO ve AI görünürlük otomasyonu',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@luvihost',
    creator: '@luvihost',
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SITE_URL}/og-image.png`],
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
      name: 'LuviAI',
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/og-image.png`,
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
      name: 'LuviAI',
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
      name: 'LuviAI',
      url: SITE_URL,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'SEO + Content Automation',
      operatingSystem: 'Web',
      description: DESCRIPTION,
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'TRY',
        lowPrice: '499',
        highPrice: '3299',
        offerCount: 3,
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
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
      </head>
      <body className="antialiased min-h-screen bg-background text-foreground">
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
