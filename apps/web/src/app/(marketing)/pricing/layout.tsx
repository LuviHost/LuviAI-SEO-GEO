import type { Metadata } from 'next';

const SITE_URL = 'https://ranksup.ai';

export const metadata: Metadata = {
  title: 'Fiyatlandırma — Başlangıç ₺1.499 / Profesyonel ₺4.999 / Ajans ₺14.999',
  description: "Başlangıç ₺1.499, Profesyonel ₺4.999, Ajans ₺14.999, Kurumsal ₺34.999+ — aylık iptal, taahhüt yok. 2 makale ücretsiz dene (kart gerekmez), PayTR ile güvenli ödeme. Her plan: AI Görünürlük, ASO, Apple Search Ads, AI Studio, Stuck Page Recovery, otomatik yayın. Video credit add-on pay-as-you-go.",
  alternates: { canonical: `${SITE_URL}/pricing` },
  openGraph: {
    title: 'RanksUp Fiyatlandırma — ₺1.499 / ₺4.999 / ₺14.999 / ₺34.999',
    description: '2 makale ücretsiz, kart gerekmez. 4 plan, tüm özellikler dahil.',
    url: `${SITE_URL}/pricing`,
  },
};

// SoftwareApplication + plan başına Offer — Google "fiyat" rich result + AI'ların plan/fiyat
// alıntılaması (GEO) için. Product yerine SoftwareApplication: RanksUp fiziksel ürün değil,
// site genelindeki diğer schema'larla (layout.tsx, page.tsx) tutarlı.
const PLANS = [
  { name: 'Başlangıç',   price: '1499',  desc: 'Tek site, KOBİ ve freelancer için AI Görünürlük + içerik otomasyonu. Aylık 10 makale.' },
  { name: 'Profesyonel', price: '4999',  desc: 'Büyüyen markalar için ASO, Apple Search Ads ve AI Studio dahil tam paket. Aylık 40 makale.' },
  { name: 'Ajans',       price: '14999', desc: 'Çoklu site yönetimi, whitelabel ve ekip koltukları ile ajanslara özel.' },
  { name: 'Kurumsal',    price: '34999', desc: 'Özel kota, öncelikli destek ve SLA ile kurumsal ölçek.' },
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
        priceCurrency: 'TRY',
        lowPrice: '1499',
        highPrice: '34999',
        offerCount: PLANS.length,
        offers: PLANS.map((p) => ({
          '@type': 'Offer',
          name: `RanksUp ${p.name}`,
          description: p.desc,
          price: p.price,
          priceCurrency: 'TRY',
          url: `${SITE_URL}/pricing`,
          availability: 'https://schema.org/InStock',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: p.price,
            priceCurrency: 'TRY',
            referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' },
          },
        })),
      },
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
