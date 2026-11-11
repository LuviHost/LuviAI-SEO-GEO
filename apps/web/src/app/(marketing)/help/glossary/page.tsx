import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { GLOSSARY } from '@/lib/glossary';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { VITRIN_LINK, VitrinBand, VitrinHero, VitrinSection } from '@/components/vitrin/vitrin-page';
import { pageUpdated } from '@/lib/page-updated';

const SITE_URL = 'https://ranksup.ai';
const PAGE_URL = `${SITE_URL}/help/glossary`;

export const metadata: Metadata = {
  title: 'SEO & GEO Sözlüğü — AI Arama, Schema, Reklam Terimleri',
  description:
    'SEO, GEO (Generative Engine Optimization), AEO, schema markup, llms.txt, AI citation, ROAS ve dijital pazarlama terimlerinin sade Türkçe tanımları. RanksUp sözlüğü.',
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: 'RanksUp SEO & GEO Sözlüğü',
    description: 'SEO, GEO, AEO, schema, AI search ve reklam terimleri — sade Türkçe tanımlar.',
    url: PAGE_URL,
    type: 'article',
  },
};

/** "Schema markup" → "schema-markup", "GEO" → "geo" */
function slugify(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const ENTRIES = Object.entries(GLOSSARY).sort(([a], [b]) =>
  a.localeCompare(b, 'tr'),
);

/**
 * Koyu vitrin (Kasim 2026): iki tonlu baslik; terimler ince cizgili satirlarda, solda
 * terim sagda tanim (Hakkimizda / SSS ile ayni 4 + 8 sutun). Yardim rehberleriyle ayni
 * ust kisim (help-article.tsx). Kapanisi ortak VitrinCta yapar (marketing-shell).
 */
export default function GlossaryPage() {
  // DefinedTermSet — AI'ların terim tanımlarını alıntılaması (GEO/AEO) + Google rich result.
  const definedTermSetJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    '@id': `${PAGE_URL}#termset`,
    name: 'RanksUp SEO & GEO Sözlüğü',
    description:
      'SEO, GEO, AEO, schema markup, AI search ve dijital pazarlama terimlerinin Türkçe tanımları.',
    url: PAGE_URL,
    inLanguage: 'tr-TR',
    dateModified: pageUpdated('/help/glossary'),
    hasDefinedTerm: ENTRIES.map(([term, entry]) => ({
      '@type': 'DefinedTerm',
      '@id': `${PAGE_URL}#${slugify(term)}`,
      name: term,
      description: entry.short,
      inDefinedTermSet: `${PAGE_URL}#termset`,
    })),
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'RanksUp', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Yardım', item: `${SITE_URL}/help` },
      { '@type': 'ListItem', position: 3, name: 'Sözlük', item: PAGE_URL },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(definedTermSetJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <VitrinHero
        before={(
          <Link
            href={'/help' as any}
            className="inline-flex items-center gap-1.5 py-3 text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden /> Tüm rehberler
          </Link>
        )}
        rail="Sözlük"
        a={<>SEO &amp; GEO</>}
        b="Sözlüğü"
        lead={(
          <p className="glossary-intro">
            SEO, GEO (Generative Engine Optimization), AEO, schema markup, AI citation,
            llms.txt ve dijital pazarlama terimlerinin sade Türkçe tanımları. {ENTRIES.length} terim.
          </p>
        )}
      >
        {/* font-mono sarmalayicida: tarih satiri yardim rehberleriyle ayni sinifi tasir */}
        <div className="mt-4 font-mono">
          <PageUpdatedLine path="/help/glossary" className="mt-2" fixedLocale="tr" />
        </div>
      </VitrinHero>

      <VitrinBand>
        <dl className="border-t border-border">
          {ENTRIES.map(([term, entry]) => (
            <div
              key={term}
              id={slugify(term)}
              className="grid scroll-mt-24 gap-x-10 gap-y-2 border-b border-border py-5 lg:grid-cols-12"
            >
              <dt className="text-base font-medium lg:col-span-4">{term}</dt>
              <dd className="max-w-2xl text-sm leading-[1.8] text-muted-foreground lg:col-span-8">{entry.short}</dd>
            </div>
          ))}
        </dl>
      </VitrinBand>

      <VitrinSection title="Aradığın terim yok mu?">
        <p className="text-xl tracking-[-0.02em] sm:text-2xl">
          <a href="mailto:destek@luvihost.com" className={VITRIN_LINK}>destek@luvihost.com</a>
        </p>
        <p className="mt-5 max-w-2xl text-sm leading-[1.8] text-muted-foreground">
          Bize yaz, sözlüğe ekleyelim.
        </p>
      </VitrinSection>
    </>
  );
}
