import Link from 'next/link';
import type { Metadata } from 'next';
import { Fragment } from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { SITE_URL, pageUpdated } from '@/lib/page-updated';
import {
  SIGNUP_HREF, formatAccessDate, parseInline, plainInline, publishedText, rehberJsonLd, rehberPath,
} from '@/lib/rehber';
import { findRehber } from '@/content/rehber';
import type { RehberArticle, RehberBlock, RehberSource } from '@/content/rehber/types';

/**
 * /rehber makale sayfasi — SUNUCU bileseni. Icerik content/rehber/*.ts veri modullerinden
 * gelir; ilk HTML'de tam metin, SSS ve JSON-LD hazirdir (istemci tarafi veri cekimi yok).
 * PageUpdatedLine istemci adacigi yalniz tarih satirini basar (sunucu da 'tr' basar).
 */

const OG_IMAGE = { url: `${SITE_URL}/og-image.png?v=2`, width: 1200, height: 630, alt: 'RanksUp Rehber' };

export function rehberMetadata(a: RehberArticle): Metadata {
  const url = `${SITE_URL}${rehberPath(a.slug)}`;
  return {
    title: a.metaTitle,
    description: a.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      locale: 'tr_TR',
      siteName: 'RanksUp',
      url,
      title: a.metaTitle,
      description: a.description,
      publishedTime: a.published,
      modifiedTime: pageUpdated(rehberPath(a.slug)),
      images: [OG_IMAGE],
    },
    twitter: { card: 'summary_large_image', title: a.metaTitle, description: a.description, images: [OG_IMAGE.url] },
  };
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((tok, i) => {
        if (tok.type === 'strong') return <strong key={i}>{tok.text}</strong>;
        if (tok.type === 'link') {
          return tok.href.startsWith('/')
            ? <Link key={i} href={tok.href as any}>{tok.text}</Link>
            : <a key={i} href={tok.href} target="_blank" rel="noopener noreferrer">{tok.text}</a>;
        }
        return <Fragment key={i}>{tok.text}</Fragment>;
      })}
    </>
  );
}

/** Blogun hemen altindaki "Kaynak: …" satiri — para ve iddialarin yaninda gorunur kaynak */
function SourceLine({ ids, sources }: { ids?: string[]; sources: RehberSource[] }) {
  if (!ids?.length) return null;
  const list = ids.map((id) => sources.find((s) => s.id === id)).filter((s): s is RehberSource => !!s);
  return (
    <p className="not-prose -mt-2 mb-6 text-xs leading-relaxed text-muted-foreground">
      Kaynak:{' '}
      {list.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && '; '}
          {s.url
            ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-foreground">{s.publisher}</a>
            : <span>{s.publisher}</span>}
          {s.url && s.accessed ? ` (erişim ${formatAccessDate(s.accessed)})` : s.note ? ` (${s.note})` : ''}
        </Fragment>
      ))}
    </p>
  );
}

function Block({ b, sources }: { b: RehberBlock; sources: RehberSource[] }) {
  switch (b.t) {
    case 'p':
      return <><p><Inline text={b.text} /></p><SourceLine ids={b.kaynak} sources={sources} /></>;
    case 'h3':
      return <h3><Inline text={b.text} /></h3>;
    case 'ul':
    case 'ol': {
      const List = b.t;
      return (
        <>
          <List>{b.items.map((it, i) => <li key={i}><Inline text={it} /></li>)}</List>
          <SourceLine ids={b.kaynak} sources={sources} />
        </>
      );
    }
    case 'table':
      return (
        <>
          <div className="not-prose my-6 overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <caption className="px-4 pt-3 pb-2 text-left text-xs font-semibold text-muted-foreground">{b.caption}</caption>
              <thead className="bg-muted/40 text-xs">
                <tr>
                  {b.head.map((h, i) => <th key={i} scope="col" className="px-4 py-2.5 text-left font-semibold align-bottom">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {b.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      ci === 0
                        ? <th key={ci} scope="row" className="px-4 py-2.5 text-left font-medium align-top">{plainInline(cell)}</th>
                        : <td key={ci} className="px-4 py-2.5 align-top text-foreground/85 [&_a]:text-brand-600 [&_a]:underline-offset-2 hover:[&_a]:underline"><Inline text={cell} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {b.not && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{b.not}</p>}
          </div>
          <SourceLine ids={b.kaynak} sources={sources} />
        </>
      );
    case 'code':
      return (
        <figure className="not-prose my-5">
          <figcaption className="mb-1.5 text-xs font-medium text-muted-foreground">{b.label}</figcaption>
          <pre className="overflow-x-auto rounded-xl border bg-muted/50 p-4 text-xs leading-relaxed"><code>{b.code}</code></pre>
        </figure>
      );
    case 'callout':
      return (
        <>
          <aside className="not-prose my-6 rounded-xl border-l-4 border-brand-500 bg-brand-500/5 p-4 text-sm leading-relaxed">
            <p className="mb-1 font-semibold">{b.title}</p>
            <p className="text-foreground/85"><Inline text={b.text} /></p>
          </aside>
          <SourceLine ids={b.kaynak} sources={sources} />
        </>
      );
  }
}

export function RehberArticlePage({ article: a }: { article: RehberArticle }) {
  const path = rehberPath(a.slug);
  const updated = pageUpdated(path);
  const related = a.related.map(findRehber);

  return (
    <main className="relative min-h-screen">
      {rehberJsonLd(a, updated).map((ld, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      ))}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-20 h-96 w-96 rounded-full bg-brand-500/8 blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-xs text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li><Link href="/" className="hover:text-foreground">RanksUp</Link></li>
            <li aria-hidden><ChevronRight className="h-3 w-3" /></li>
            <li><Link href={'/rehber' as any} className="hover:text-foreground">Rehber</Link></li>
            <li aria-hidden><ChevronRight className="h-3 w-3" /></li>
            <li aria-current="page" className="text-foreground/80">{a.topic}</li>
          </ol>
        </nav>

        <header className="mb-8">
          <p className="mb-2 text-xs font-medium text-brand-600">{a.topic}</p>
          <h1 className="mb-4 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{a.title}</h1>
          <p className="rehber-answer text-lg leading-relaxed text-foreground/90">{a.answer}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <PageUpdatedLine path={path} fixedLocale="tr" />
            <span className="text-xs text-muted-foreground">{publishedText(a.published)}</span>
          </div>
        </header>

        <aside aria-labelledby="hizli-cevap" className="mb-10 rounded-2xl border bg-card p-5 shadow-sm">
          <h2 id="hizli-cevap" className="mb-3 text-sm font-bold">Hızlı cevap</h2>
          <ul className="space-y-2 text-sm leading-relaxed">
            {a.quick.map((q, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                <span><Inline text={q} /></span>
              </li>
            ))}
          </ul>
        </aside>

        <nav aria-label="İçindekiler" className="mb-10 text-sm">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Bu sayfada</p>
          <ol className="list-decimal space-y-1 pl-5 text-foreground/80">
            {a.sections.map((s) => (
              <li key={s.id}><a href={`#${s.id}`} className="hover:text-brand-600">{s.h2}</a></li>
            ))}
            <li><a href="#sss" className="hover:text-brand-600">Sık sorulan sorular</a></li>
            <li><a href="#kaynaklar" className="hover:text-brand-600">Kaynaklar</a></li>
          </ol>
        </nav>

        <article className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-bold prose-h2:mt-12 prose-h2:mb-3 prose-h2:text-xl prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-base prose-p:leading-relaxed prose-li:my-1 prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline prose-strong:font-bold">
          {a.sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-20">
              <h2>{s.h2}</h2>
              {s.blocks.map((b, i) => <Block key={i} b={b} sources={a.sources} />)}
            </section>
          ))}

          {/* Gorunur SSS — FAQPage JSON-LD ayni listeden (lib/rehber.ts rehberFaqJsonLd) */}
          <section id="sss" className="scroll-mt-20">
            <h2>Sık sorulan sorular</h2>
            {a.faq.map((f) => (
              <div key={f.q}>
                <h3>{f.q}</h3>
                <p>{f.a}</p>
              </div>
            ))}
          </section>

          <section id="kaynaklar" className="scroll-mt-20">
            <h2>Kaynaklar</h2>
            <ol className="text-sm">
              {a.sources.map((s) => (
                <li key={s.id}>
                  {s.url ? (
                    <>
                      {s.publisher}: <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                      {s.accessed && <span className="text-muted-foreground"> · erişim {formatAccessDate(s.accessed)}</span>}
                    </>
                  ) : (
                    <>
                      {s.publisher}: {s.title}
                      {s.note && <span className="text-muted-foreground"> · {s.note}</span>}
                    </>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </article>

        {related.length > 0 && (
          <section aria-labelledby="ilgili" className="mt-12">
            <h2 id="ilgili" className="mb-4 text-lg font-bold">İlgili rehberler</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {related.map((r) => (
                <Link key={r.slug} href={rehberPath(r.slug) as any} className="group rounded-xl border bg-card p-4 transition-colors hover:border-brand-500/40">
                  <p className="mb-1 text-xs font-medium text-brand-600">{r.topic}</p>
                  <p className="text-sm font-semibold leading-snug group-hover:text-brand-600">{r.title}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        <RehberCta />
      </div>
    </main>
  );
}

/** Deneme cagrisi — metin plans.ts deneme maddesiyle ayni (14 gun, kart istemez) */
export function RehberCta() {
  return (
    <div className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-6">
      <div>
        <p className="font-bold">Markanı altı yapay zekâ asistanında ölç</p>
        <p className="text-sm text-muted-foreground">Site denetimi, AI görünürlük ölçümü, içerik ve ASO tek panelde.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={SIGNUP_HREF as any}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 px-4 py-2 text-sm font-semibold text-white hover:from-brand-600 hover:to-brand-700"
        >
          14 gün ücretsiz dene · Kart gerekmez <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <Link href="/pricing" className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-muted/50">
          Fiyatlar
        </Link>
      </div>
    </div>
  );
}
