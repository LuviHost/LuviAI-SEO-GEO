import type { Metadata } from 'next';

const SITE_URL = 'https://ranksup.ai';

export const metadata: Metadata = {
  title: 'Kullanım Senaryoları — KOBİ, e-ticaret, ajans için AI otomasyon',
  description: 'KOBİ, e-ticaret, dijital ajans, freelancer, blog yazarı için RanksUp nasıl kullanılır — gerçek senaryolar, beklenen sonuçlar, ROI tahmini.',
  alternates: { canonical: `${SITE_URL}/use-cases` },
  openGraph: {
    title: 'RanksUp Kullanım Senaryoları',
    description: 'KOBİ, e-ticaret, ajans ve freelancer için somut senaryolar.',
    url: `${SITE_URL}/use-cases`,
  },
};

// CollectionPage + ItemList — AI'ların "RanksUp kimler için" sorusuna yapılı cevap üretmesi (GEO).
const useCasesJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'CollectionPage',
      '@id': `${SITE_URL}/use-cases#page`,
      url: `${SITE_URL}/use-cases`,
      name: 'RanksUp Kullanım Senaryoları',
      description: 'KOBİ, e-ticaret, dijital ajans, freelancer ve blog yazarları için RanksUp kullanım senaryoları.',
      inLanguage: 'tr-TR',
      isPartOf: { '@id': `${SITE_URL}/#website` },
      about: [
        { '@type': 'Audience', audienceType: 'KOBİ ve küçük işletmeler' },
        { '@type': 'Audience', audienceType: 'E-ticaret markaları' },
        { '@type': 'Audience', audienceType: 'Dijital pazarlama ajansları' },
        { '@type': 'Audience', audienceType: 'Freelancer ve danışmanlar' },
        { '@type': 'Audience', audienceType: 'Blog yazarları ve içerik üreticileri' },
      ],
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Kullanım Senaryoları', item: `${SITE_URL}/use-cases` },
      ],
    },
  ],
};

export default function UseCasesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(useCasesJsonLd) }}
      />
      {children}
    </>
  );
}
