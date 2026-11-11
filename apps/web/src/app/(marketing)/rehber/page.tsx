import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowUpRight } from 'lucide-react';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { RehberCta } from '@/components/rehber/rehber-article';
import { VITRIN_LINK, VitrinBand, VitrinHero } from '@/components/vitrin/vitrin-page';
import { REHBER_ARTICLES } from '@/content/rehber';
import { SITE_URL, pageUpdated } from '@/lib/page-updated';
import { rehberIndexJsonLd, rehberPath } from '@/lib/rehber';

/**
 * /rehber — yapay zekâ görünürlüğü rehberleri dizini (sunucu bileseni). Liste
 * content/rehber/index.ts kaydindan; her makale tek bir soruyu cevaplar.
 *
 * Koyu vitrin (Kasim 2026): iki tonlu baslik, altinda ince cizgiyle ayrilan
 * satirlar (konu, soru + aciklama, ok). Kapanisi ortak VitrinCta yapar (marketing-shell).
 */
const TITLE = 'Yapay zekâ görünürlüğü rehberi';
const DESCRIPTION =
  'ChatGPT, Gemini, Perplexity ve Google AI Bakışı’nda görünürlük üzerine Türkçe rehberler: test yöntemi, GEO, robots.txt, llms.txt, uygulamalar, araçlar.';

/** H1 iki tonlu: son kelime sonuk ikinci satira iner; kelimeler TITLE ile ayni */
const TITLE_CUT = TITLE.lastIndexOf(' ');

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
    <>
      {rehberIndexJsonLd(REHBER_ARTICLES, pageUpdated('/rehber')).map((ld, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      ))}

      <VitrinHero
        rail="Rehber"
        a={TITLE.slice(0, TITLE_CUT)}
        b={TITLE.slice(TITLE_CUT + 1)}
        lead={(
          <p>
            Markanın yapay zekâ asistanlarının cevaplarında nasıl göründüğünü anlaman ve iyileştirmen için kısa, kaynaklı rehberler.
            Her sayfa tek bir soruyu cevaplar; her bilginin kaynağı ve kontrol tarihi sayfanın sonunda yazar.
          </p>
        )}
      >
        <PageUpdatedLine path="/rehber" className="mt-6 font-mono" fixedLocale="tr" />
      </VitrinHero>

      {/* pt-0: liste bolum cizgisinin hemen altinda baslar (arada bos serit kalmaz) */}
      <VitrinBand className="pt-0 lg:pt-0">
        <ol>
          {REHBER_ARTICLES.map((a, i) => (
            <li key={a.slug}>
              <Link
                href={rehberPath(a.slug) as any}
                className="group grid gap-x-10 gap-y-3 border-b border-border py-7 lg:grid-cols-12 lg:py-9"
              >
                <p className="v-rail flex items-baseline gap-4 lg:col-span-4 lg:pt-1.5">
                  <span className="text-dim tabular-nums" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                  {a.topic}
                </p>
                <div className="lg:col-span-6">
                  <h2 className="text-vitrin-3 transition-colors duration-200 group-hover:text-brand-vivid">{a.title}</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-[1.8] text-muted-foreground">{a.description}</p>
                </div>
                <span className="v-rail inline-flex items-center gap-1.5 transition-colors duration-200 group-hover:text-brand-vivid lg:col-span-2 lg:justify-end lg:self-start lg:pt-1.5">
                  Rehberi oku <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <p className="mt-10 max-w-2xl text-sm leading-[1.8] text-muted-foreground">
          Ürünün nasıl kullanıldığını arıyorsan <Link href={'/help' as any} className={VITRIN_LINK}>yardım merkezine</Link>,
          terimler için <Link href={'/help/glossary' as any} className={VITRIN_LINK}>SEO &amp; GEO sözlüğüne</Link> bak.
        </p>
      </VitrinBand>

      <RehberCta />
    </>
  );
}
