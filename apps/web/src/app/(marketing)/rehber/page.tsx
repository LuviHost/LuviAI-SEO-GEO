import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { RehberCta } from '@/components/rehber/rehber-article';
import { REHBER_ARTICLES } from '@/content/rehber';
import { SITE_URL, pageUpdated } from '@/lib/page-updated';
import { rehberIndexJsonLd, rehberPath } from '@/lib/rehber';

/**
 * /rehber — yapay zekâ görünürlüğü rehberleri dizini (sunucu bileseni). Liste
 * content/rehber/index.ts kaydindan; her makale tek bir soruyu cevaplar.
 */
const TITLE = 'Yapay zekâ görünürlüğü rehberi';
const DESCRIPTION =
  'ChatGPT, Gemini, Perplexity ve Google AI Bakışı’nda görünürlük üzerine Türkçe rehberler: test yöntemi, GEO, robots.txt, llms.txt, uygulamalar, araçlar.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/rehber` },
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    siteName: 'RanksUp',
    url: `${SITE_URL}/rehber`,
    title: `${TITLE} · RanksUp`,
    description: DESCRIPTION,
    images: [{ url: `${SITE_URL}/og-image.png?v=2`, width: 1200, height: 630, alt: 'RanksUp Rehber' }],
  },
};

export default function RehberIndexPage() {
  return (
    <main className="relative min-h-screen">
      {rehberIndexJsonLd(REHBER_ARTICLES, pageUpdated('/rehber')).map((ld, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      ))}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-20 h-96 w-96 rounded-full bg-brand-500/8 blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="mb-10">
          <p className="mb-2 text-xs font-medium text-brand-600">Rehber</p>
          <h1 className="mb-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{TITLE}</h1>
          <p className="leading-relaxed text-muted-foreground">
            Markanın yapay zekâ asistanlarının cevaplarında nasıl göründüğünü anlaman ve iyileştirmen için kısa, kaynaklı rehberler.
            Her sayfa tek bir soruyu cevaplar; her bilginin kaynağı ve kontrol tarihi sayfanın sonunda yazar.
          </p>
          <PageUpdatedLine path="/rehber" className="mt-3" fixedLocale="tr" />
        </header>

        <ol className="space-y-3">
          {REHBER_ARTICLES.map((a) => (
            <li key={a.slug}>
              <Link
                href={rehberPath(a.slug) as any}
                className="group block rounded-2xl border bg-card p-5 transition-colors hover:border-brand-500/40"
              >
                <p className="mb-1 text-xs font-medium text-brand-600">{a.topic}</p>
                <h2 className="mb-1.5 text-lg font-bold leading-snug group-hover:text-brand-600">{a.title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{a.description}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                  Rehberi oku <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-sm text-muted-foreground">
          Ürünün nasıl kullanıldığını arıyorsan <Link href={'/help' as any} className="text-brand-600 hover:underline">yardım merkezine</Link>,
          terimler için <Link href={'/help/glossary' as any} className="text-brand-600 hover:underline">SEO &amp; GEO sözlüğüne</Link> bak.
        </p>

        <RehberCta />
      </div>
    </main>
  );
}
