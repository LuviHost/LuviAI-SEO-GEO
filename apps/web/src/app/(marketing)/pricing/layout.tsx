import type { Metadata } from 'next';
import { pageUpdated, SITE_URL } from '@/lib/page-updated';

// 11.11.2026 paket yapisi (api plans.ts): uc ucretli plan — Baslangic $99 (4 asistan, makale
// uretimi yok), Profesyonel $349 (6 asistan, makale, 13 yayin hedefi), Kurumsal teklifle (liste
// fiyati YAZILMAZ). Ajans satistan kalkti. Eski metin "Büyüme $149 / Ajans $749 / Kurumsal
// $1.499" ve "ücretli her planda 6 AI asistanı, 13 yayın hedefi" diyordu.
export const metadata: Metadata = {
  title: 'Fiyatlandırma — Başlangıç $99 / Profesyonel $349 / Kurumsal teklifle',
  description: 'Başlangıç $99, Profesyonel $349, Kurumsal teklifle — aylık iptal, taahhüt yok. 14 gün ücretsiz dene (kart gerekmez), PayTR ile güvenli ödeme. Başlangıç’ta 4, Profesyonel ve üstünde 6 AI asistanında görünürlük ölçümü; makale üretimi ve 13 yayın hedefi Profesyonel ve üstünde. Türk lirası karşılığı ödeme anındaki TCMB kuruyla hesaplanır.',
  alternates: { canonical: `${SITE_URL}/pricing` },
  openGraph: {
    title: 'RanksUp Fiyatlandırma — Başlangıç $99 / Profesyonel $349 / Kurumsal teklifle',
    // Ozellikler plana gore kademeli (plans.ts FEATURE_MIN_PLAN); "tüm özellikler dahil" yanlisti
    description: '14 gün ücretsiz, kart gerekmez. 3 ücretli plan; özellikler plana göre artar.',
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
// 11.11.2026: yalniz musterinin FIYAT gordugu planlar (herkese acik, ucretli, teklifle degil).
// Kurumsal teklifle satilir — liste fiyati yayimlanmaz ve fiyatsiz Offer gecersizdir, bu yuzden
// listede yok; Ajans satistan kalkti. Aralik da bu iki plandan: $99 – $349.
const PLANS = [
  { name: 'Başlangıç',   price: '99',   desc: 'İki site, KOBİ ve freelancer için 4 AI asistanında görünürlük ölçümü, site SEO/GEO denetimi ve ASO. Makale üretimi yok.' },
  { name: 'Profesyonel', price: '349',  desc: 'Büyüyen markalar için 6 AI asistanında ölçüm, Apple Search Ads, App Store Connect ve App Prompt Lab dahil. Aylık 40 makale.' },
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
        lowPrice: '99',
        highPrice: '349',
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
