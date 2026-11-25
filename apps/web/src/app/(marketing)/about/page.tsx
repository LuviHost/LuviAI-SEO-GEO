import { AboutGovde } from './about-govde';

const SITE_URL = 'https://ranksup.ai';
const SUPPORT_EMAIL = 'destek@luvihost.com';

const aboutJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'AboutPage',
      '@id': `${SITE_URL}/about#aboutpage`,
      url: `${SITE_URL}/about`,
      name: 'RanksUp Hakkında',
      description: 'Türkiye merkezli GEO + SEO + ASO + Apple Search Ads platformu RanksUp hakkında bilgiler.',
      isPartOf: { '@id': `${SITE_URL}/#website` },
      about: { '@id': `${SITE_URL}/#organization` },
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization-extended`,
      name: 'RanksUp',
      legalName: 'LuviHost Bilişim Hizmetleri',
      url: SITE_URL,
      foundingDate: '2026',
      foundingLocation: { '@type': 'Place', name: 'Türkiye' },
      areaServed: { '@type': 'Country', name: 'Turkey' },
      knowsLanguage: ['Turkish', 'English'],
      contactPoint: [
        {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          email: SUPPORT_EMAIL,
          availableLanguage: ['Turkish', 'English'],
        },
      ],
      slogan: 'AI ile büyü, tek panelden.',
      knowsAbout: [
        'Search Engine Optimization',
        'Generative Engine Optimization',
        'AI Search Optimization',
        'Content Marketing Automation',
        'App Store Optimization (ASO)',
        'WordPress Publishing',
        'Google Ads Optimization',
        'Meta Ads Optimization',
      ],
      brand: { '@type': 'Brand', name: 'RanksUp' },
      parentOrganization: {
        '@type': 'Organization',
        name: 'LuviHost',
        url: 'https://luvihost.com',
      },
    },
  ],
};

/**
 * Koyu vitrin (Kasim 2026). Gorunur govde about-govde.tsx'te (TR sunucuda, EN secilince tarayicida;
 * 25.11.2026'ya kadar yalniz Turkceydi). JSON-LD burada, Turkce.
 */
export default function AboutPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutJsonLd) }}
      />
      <AboutGovde />
    </>
  );
}
