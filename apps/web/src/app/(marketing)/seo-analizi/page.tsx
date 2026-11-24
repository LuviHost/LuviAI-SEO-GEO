import type { Metadata } from 'next';
import { SeoAnaliziGovde } from '@/components/seo-analizi/seo-analizi-govde';
import { ICERIK } from '@/components/seo-analizi/icerik';

/**
 * Ucretsiz SEO analizi (25.11.2026). NEDEN: Google Keyword Planner (TR, Turkce) "seo analiz" 1.900,
 * "seo analizi" 590, "site analiz" 390, "ücretsiz seo analizi" 170 aylik; SERP'te ilk 10 neredeyse
 * tamamen ucretsiz analiz araci. Site hizi bu sayfanin bir bolumu ("site hızı testi" SERP'i yazi/liste).
 *
 * Her cumle koda dayanir: tarama en fazla 10 sayfa, 15 kontrol, genel puan agirliklari ve sinirlar
 * api audit/public-seo-analysis.ts + audit-checks.service.ts (OVERALL_SCORE_WEIGHTS) ile ayni.
 * Esikler web.dev (LCP 2,5 sn, INP 200 ms, CLS 0,1 — 75. yuzdelik; api pagespeed-field.ts CWV_ESIK).
 */

const BASLIK = 'Ücretsiz SEO Analizi: teknik SEO ve site hızı testi';
const ACIKLAMA = 'Sitenizin ücretsiz SEO analizini yapın: 15 teknik kontrol, mobil site hızı ve Core Web Vitals, öncelikli sorunlar. Üyelik gerekmez.';

export const metadata: Metadata = {
  title: BASLIK,
  description: ACIKLAMA,
  alternates: { canonical: 'https://ranksup.ai/seo-analizi' },
  robots: { index: true, follow: true },
  openGraph: { title: BASLIK, description: ACIKLAMA, url: 'https://ranksup.ai/seo-analizi', type: 'website' },
};

export default function SeoAnaliziPage() {
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: ICERIK.tr.sss.map((s) => ({ '@type': 'Question', name: s.q, acceptedAnswer: { '@type': 'Answer', text: s.a } })),
  };
  const appJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'RanksUp Ücretsiz SEO Analizi',
    url: 'https://ranksup.ai/seo-analizi',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    inLanguage: 'tr-TR',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'TRY' },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }} />
      <SeoAnaliziGovde />
    </>
  );
}
