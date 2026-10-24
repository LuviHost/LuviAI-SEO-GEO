import type { Metadata } from 'next';
import { pageUpdated, SITE_URL } from '@/lib/page-updated';

export const metadata: Metadata = {
  title: 'Fiyatlandırma — Büyüme $149 / Profesyonel $349 / Ajans $749',
  description: 'Büyüme $149, Profesyonel $349, Ajans $749, Kurumsal $1.499 — aylık iptal, taahhüt yok. 14 gün ücretsiz dene, 2 makale üret (kart gerekmez), PayTR ile güvenli ödeme. Her planda: 6 AI asistanında görünürlük ölçümü, ASO, 14 yayın hedefi. Türk lirası karşılığı ödeme anındaki TCMB kuruyla hesaplanır.',
  alternates: { canonical: `${SITE_URL}/pricing` },
  openGraph: {
    title: 'RanksUp Fiyatlandırma — $149 / $349 / $749 / $1.499',
    // Ozellikler plana gore kademeli (plans.ts FEATURE_MIN_PLAN); "tüm özellikler dahil" yanlisti
    description: '14 gün ücretsiz, 2 makale, kart gerekmez. 4 ücretli plan; özellikler plana göre artar.',
    url: `${SITE_URL}/pricing`,
  },
};

// SoftwareApplication + plan başına Offer — Google "fiyat" rich result + AI'ların plan/fiyat
// alıntılaması (GEO) için. Product yerine SoftwareApplication: RanksUp fiziksel ürün değil,
// site genelindeki diğer schema'larla (layout.tsx, page.tsx) tutarlı.
// DIKKAT: bu degerler apps/api/src/billing/plans.ts (BASE_PLANS) ile AYNI
// olmak ZORUNDA. SEO metadata'si crawler icin statik olmak durumunda oldugundan
// buraya elle yazilir; senkron kalmasi seo-price-sync.spec.ts ile test edilir.
// Onceden TL cinsinden ve BAYAT degerler yaziliydi (₺1.499 / ₺4.999 ...) —
// yani Google'a rich result olarak GERCEGIN BESTE BIRI fiyat yayinlaniyordu.
// Fiyat USD'de kanoniktir; TL gunun kuruyla hesaplandigi icin schema'ya
// yazilamaz.
const PLANS = [
  { name: 'Büyüme',      price: '149',  desc: 'İki site, KOBİ ve freelancer için AI görünürlük ölçümü + içerik otomasyonu. Aylık 15 makale.' },
  { name: 'Profesyonel', price: '349',  desc: 'Büyüyen markalar için Apple Search Ads, App Store Connect ve App Prompt Lab dahil. Aylık 40 makale.' },
  { name: 'Ajans',       price: '749',  desc: 'Çoklu site yönetimi, Programmatic SEO, Product Radar ve GEO Heatmap ile ajanslara özel.' },
  { name: 'Kurumsal',    price: '1499', desc: 'BYOK, MCP sunucusu, REST API ve SLA ile kurumsal ölçek.' },
];

const pricingJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/pricing#software`,
      name: 'RanksUp',
      description: 'AI destekli GEO + SEO, içerik üretimi, ASO ve Apple Search Ads otomasyon platformu.',
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'SEO + Content Automation',
      operatingSystem: 'Web',
      url: `${SITE_URL}/pricing`,
      provider: { '@id': `${SITE_URL}/#organization` },
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'USD',
        lowPrice: '149',
        highPrice: '1499',
        offerCount: PLANS.length,
        offers: PLANS.map((p) => ({
          '@type': 'Offer',
          name: `RanksUp ${p.name}`,
          description: p.desc,
          price: p.price,
          priceCurrency: 'USD',
          url: `${SITE_URL}/pricing`,
          availability: 'https://schema.org/InStock',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: p.price,
            priceCurrency: 'USD',
            referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' },
          },
        })),
      },
    },
    // Sayfa dugumu — dateModified gorunur "Son güncelleme" satiriyla ve sitemap ile ayni kaynak
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/pricing#page`,
      url: `${SITE_URL}/pricing`,
      name: 'RanksUp Fiyatlandırma',
      inLanguage: 'tr-TR',
      dateModified: pageUpdated('/pricing'),
      isPartOf: { '@id': `${SITE_URL}/#website` },
      mainEntity: { '@id': `${SITE_URL}/pricing#software` },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Fiyatlandırma', item: `${SITE_URL}/pricing` },
      ],
    },
  ],
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd) }}
      />
      {children}
    </>
  );
}
