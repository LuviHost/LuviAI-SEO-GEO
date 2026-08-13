import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { GLOSSARY } from '@/lib/glossary';
import { Eyebrow } from '@/components/brand';

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
    <main className="relative min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(definedTermSetJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <div className="absolute inset-x-0 top-0 h-72 -z-10 grid-paper-light pointer-events-none" aria-hidden="true" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link
          href={'/help' as any}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Tüm rehberler
        </Link>

        <div className="flex items-start gap-4 mb-8">
          <div className="h-12 w-12 rounded-2xl bg-brand/10 grid place-items-center shrink-0">
            <BookOpen className="h-6 w-6 text-brand dark:text-brand-400" />
          </div>
          <div>
            <div className="mb-1">
              <Eyebrow>SÖZLÜK</Eyebrow>
            </div>
            <h1 className="font-brandDisplay text-3xl sm:text-4xl font-extrabold tracking-[-0.03em] leading-tight mb-2">
              SEO &amp; GEO Sözlüğü
            </h1>
            <p className="glossary-intro text-muted-foreground leading-relaxed">
              SEO, GEO (Generative Engine Optimization), AEO, schema markup, AI citation,
              llms.txt ve dijital pazarlama terimlerinin sade Türkçe tanımları. {ENTRIES.length} terim.
            </p>
          </div>
        </div>

        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
          {ENTRIES.map(([term, entry]) => (
            <div
              key={term}
              id={slugify(term)}
              className="scroll-mt-24 card-brand p-4"
            >
              <dt className="font-bold text-base mb-1">{term}</dt>
              <dd className="text-sm text-muted-foreground leading-relaxed">{entry.short}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 card-brand p-5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-semibold">Aradığın terim yok mu?</p>
            <p className="text-xs text-muted-foreground">
              Bize yaz, sözlüğe ekleyelim. 15 dakika ücretsiz destek.
            </p>
          </div>
          <a
            href="mailto:destek@luvihost.com"
            className="btn-brand h-10 px-4 text-sm"
          >
            destek@luvihost.com
          </a>
        </div>
      </div>
    </main>
  );
}
