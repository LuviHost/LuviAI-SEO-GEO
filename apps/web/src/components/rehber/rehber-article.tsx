import Link from 'next/link';
import type { Metadata } from 'next';
import { Fragment } from 'react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { VITRIN_LINK, VitrinBand, VitrinHero, VitrinRail, VitrinSection } from '@/components/vitrin/vitrin-page';
import { SITE_URL, pageUpdated } from '@/lib/page-updated';
import {
  SIGNUP_HREF, formatAccessDate, parseInline, plainInline, publishedText, rehberJsonLd, rehberPath,
} from '@/lib/rehber';
import { findRehber } from '@/content/rehber';
import { AiVisibilityChecker } from '@/components/landing/ai-visibility-checker';
import type { RehberArticle, RehberBlock, RehberSource } from '@/content/rehber/types';

/**
 * /rehber makale sayfasi — SUNUCU bileseni. Icerik content/rehber/*.ts veri modullerinden
 * gelir; ilk HTML'de tam metin, SSS ve JSON-LD hazirdir (istemci tarafi veri cekimi yok).
 * PageUpdatedLine istemci adacigi yalniz tarih satirini basar (sunucu da 'tr' basar).
 *
 * Koyu vitrin (Kasim 2026): iki tonlu baslik; altinda solda yapiskan "Bu sayfada",
 * sagda okuma sutunu. Metin bloklari okuma olcusunde (MEASURE) kalir; tablo, kod ve
 * test kutusu sutunun tamamini kullanir. `prose` eklentisi yok: her blok kendi
 * siniflarini tasir (renkler yalniz token). Kapanisi ortak VitrinCta yapar
 * (marketing-shell); RehberCta onun ustunde kisa bir serit olarak kalir.
 */

const OG_IMAGE = { url: `${SITE_URL}/og-image.png?v=2`, width: 1200, height: 630, alt: 'RanksUp Rehber' };

/** Okuma olcusu: 16px govdede satir basina ~70 karakter */
const MEASURE = 'max-w-[34rem]';
/** Uzun metin govdesi: koyu zeminde sonuk gri yerine parlak ton (uzun okuma) */
const BODY = `${MEASURE} text-base leading-[1.8] text-foreground/85`;
/** Makale bolumu: ustte ince cizgi; capa, yapiskan ust menunun (h-16) altinda durur */
const SECTION = 'mt-14 scroll-mt-16 border-t border-border pt-10 first:mt-0';
const H2 = `${MEASURE} text-vitrin-3`;
/** Kaynak satirlarindaki baglanti: metin ici baglantidan daha sessiz */
const SOURCE_LINK = 'border-b border-white/25 transition-colors duration-200 hover:border-brand-vivid hover:text-brand-vivid';

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

/**
 * Iki tonlu H1 icin basligi iki satira boler. Kelimeler ve sira AYNI kalir (iki parca
 * arasinda tek bosluk basilir). Once ilk virgulden; yoksa sondaki parantezden; o da
 * yoksa ortaya en yakin bosluktan.
 */
function splitTitle(title: string): [string, string | undefined] {
  const comma = title.indexOf(', ');
  if (comma > 0) return [title.slice(0, comma + 1), title.slice(comma + 2)];
  const paren = title.lastIndexOf(' (');
  if (paren > 0) return [title.slice(0, paren), title.slice(paren + 1)];
  const mid = title.length / 2;
  let cut = -1;
  for (let i = title.indexOf(' '); i !== -1; i = title.indexOf(' ', i + 1)) {
    if (cut === -1 || Math.abs(i - mid) < Math.abs(cut - mid)) cut = i;
  }
  return cut > 0 ? [title.slice(0, cut), title.slice(cut + 1)] : [title, undefined];
}

/** Sutun sayisina gore en az tablo genisligi: dar ekranda hucreler ezilmez, kutu yatay kayar */
function tableMinWidth(cols: number): string {
  if (cols >= 5) return 'min-w-[48rem]';
  if (cols === 4) return 'min-w-[40rem]';
  if (cols === 3) return 'min-w-[32rem]';
  return '';
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((tok, i) => {
        if (tok.type === 'strong') return <strong key={i} className="font-medium text-foreground">{tok.text}</strong>;
        if (tok.type === 'link') {
          return tok.href.startsWith('/')
            ? <Link key={i} href={tok.href as any} className={VITRIN_LINK}>{tok.text}</Link>
            : <a key={i} href={tok.href} target="_blank" rel="noopener noreferrer" className={VITRIN_LINK}>{tok.text}</a>;
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
    <p className={`v-rail mt-3 leading-relaxed ${MEASURE}`}>
      Kaynak:{' '}
      {list.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && '; '}
          {s.url
            ? <a href={s.url} target="_blank" rel="noopener noreferrer" className={SOURCE_LINK}>{s.publisher}</a>
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
      return <><p className={`${BODY} mt-5`}><Inline text={b.text} /></p><SourceLine ids={b.kaynak} sources={sources} /></>;
    case 'h3':
      return <h3 className={`${MEASURE} mt-10 text-lg font-medium leading-snug`}><Inline text={b.text} /></h3>;
    case 'ul':
    case 'ol': {
      const List = b.t;
      return (
        <>
          <List className={`${BODY} mt-5 space-y-2 pl-5 marker:text-muted-foreground ${b.t === 'ol' ? 'list-decimal' : 'list-[square]'}`}>
            {b.items.map((it, i) => <li key={i} className="pl-1.5"><Inline text={it} /></li>)}
          </List>
          <SourceLine ids={b.kaynak} sources={sources} />
        </>
      );
    }
    case 'table':
      return (
        <>
          {/* relative SART: kaydirma kutusu konumlu degilken icindeki sr-only metinler
              kirpmadan kacip sayfayi telefonda genisletiyor (bkz. app/page.tsx karsilastirma) */}
          <div className="relative mt-8 overflow-x-auto">
            <table className={`w-full border-b border-border text-sm ${tableMinWidth(b.head.length)}`}>
              {/* Baslik tablo genisliginde basilir; dar ekranda kaydirmadan okunsun diye ic kutu daraltildi */}
              <caption className="pb-3 text-left text-sm font-medium">
                <span className="block max-w-[18rem] sm:max-w-none">{b.caption}</span>
              </caption>
              <thead>
                <tr className="border-y border-border text-left">
                  {b.head.map((h, i) => <th key={i} scope="col" className={`v-rail py-3 align-bottom ${i === 0 ? 'pr-4' : 'pl-6'}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {b.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      ci === 0
                        ? <th key={ci} scope="row" className="py-3.5 pr-4 text-left align-top font-medium">{plainInline(cell)}</th>
                        : <td key={ci} className="py-3.5 pl-6 align-top leading-relaxed text-foreground/85"><Inline text={cell} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.not && <p className={`${MEASURE} mt-3 text-sm leading-relaxed text-muted-foreground`}>{b.not}</p>}
          <SourceLine ids={b.kaynak} sources={sources} />
        </>
      );
    case 'code':
      return (
        <figure className="mt-6">
          <figcaption className="v-rail mb-2.5">{b.label}</figcaption>
          <pre className="overflow-x-auto rounded-lg border border-border bg-card p-4 text-sm leading-[1.7] text-foreground/85"><code>{b.code}</code></pre>
        </figure>
      );
    case 'callout':
      return (
        <>
          <aside className={`${MEASURE} mt-8 border-l-2 border-brand-vivid pl-5 text-sm leading-[1.8]`}>
            <p className="font-medium">{b.title}</p>
            <p className="mt-1 text-foreground/85"><Inline text={b.text} /></p>
          </aside>
          <SourceLine ids={b.kaynak} sources={sources} />
        </>
      );
    case 'tool':
      return (
        <aside className="mt-10 rounded-lg border border-border bg-card p-6 sm:p-8" aria-labelledby="rehber-test-baslik">
          <p id="rehber-test-baslik" className="text-vitrin-3">{b.title}</p>
          <p id="rehber-checker-hint" className="mt-3 max-w-2xl text-sm leading-[1.8] text-muted-foreground"><Inline text={b.text} /></p>
          <div className="mt-6 max-w-[34rem]">
            <AiVisibilityChecker mode="rehber" hintId="rehber-checker-hint" />
          </div>
        </aside>
      );
  }
}

/** "Bu sayfada" satiri: solda sonuk sira numarasi, sagda bolum adi */
function TocItem({ n, href, children }: { n: number; href: string; children: React.ReactNode }) {
  return (
    <li>
      <a href={href} className="grid grid-cols-[1.75rem_1fr] gap-2 py-1.5 text-sm leading-snug text-muted-foreground transition-colors duration-200 hover:text-foreground">
        <span className="pt-0.5 font-mono text-vitrin-rail text-dim tabular-nums" aria-hidden>{String(n).padStart(2, '0')}</span>
        {children}
      </a>
    </li>
  );
}

export function RehberArticlePage({ article: a }: { article: RehberArticle }) {
  const path = rehberPath(a.slug);
  const updated = pageUpdated(path);
  const related = a.related.map(findRehber);
  const [titleA, titleB] = splitTitle(a.title);

  return (
    <>
      {rehberJsonLd(a, updated).map((ld, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      ))}

      <VitrinHero
        before={(
          <nav aria-label="Breadcrumb" className="py-3 text-xs text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li><Link href="/" className="transition-colors duration-200 hover:text-foreground">RanksUp</Link></li>
              <li aria-hidden><ChevronRight className="h-3 w-3 text-muted-foreground/50" /></li>
              <li><Link href={'/rehber' as any} className="transition-colors duration-200 hover:text-foreground">Rehber</Link></li>
              <li aria-hidden><ChevronRight className="h-3 w-3 text-muted-foreground/50" /></li>
              <li aria-current="page" className="font-medium text-foreground">{a.topic}</li>
            </ol>
          </nav>
        )}
        rail={a.topic}
        a={titleA}
        b={titleB}
      >
        <p className="rehber-answer mt-8 max-w-3xl text-lg leading-[1.65] text-foreground/90 sm:text-xl">{a.answer}</p>
        {/* font-mono sarmalayicida: tarih satiri bilesene sinif verilmeden mono basilir */}
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono">
          <PageUpdatedLine path={path} fixedLocale="tr" />
          <span className="text-xs text-muted-foreground">{publishedText(a.published)}</span>
        </div>
      </VitrinHero>

      {/* Belge sirasi: hizli cevap → icindekiler → makale (telefonda bu sirayla dizilir).
          Genis ekranda icindekiler sola alinir ve iki satir boyunca yapiskan kalir. */}
      <VitrinBand className="grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-12">
        <aside
          aria-labelledby="hizli-cevap"
          className="relative border-x border-b border-border bg-card p-6 sm:p-7 lg:col-span-8 lg:col-start-5 lg:row-start-1"
        >
          <span className="absolute inset-x-0 top-0 h-0.5 bg-brand-vivid" aria-hidden />
          <h2 id="hizli-cevap" className="font-mono text-vitrin-rail text-brand-vivid">Hızlı cevap</h2>
          <ul className="mt-4 max-w-2xl space-y-2.5 text-base leading-[1.7]">
            {a.quick.map((q, i) => (
              <li key={i} className="flex gap-3">
                <span aria-hidden className="mt-[0.7em] h-1.5 w-1.5 shrink-0 bg-brand-vivid" />
                <span><Inline text={q} /></span>
              </li>
            ))}
          </ul>
        </aside>

        <div className="lg:col-span-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <nav aria-label="İçindekiler" className="lg:sticky lg:top-24">
            <VitrinRail className="mb-4">Bu sayfada</VitrinRail>
            <ol>
              {a.sections.map((s, i) => (
                <TocItem key={s.id} n={i + 1} href={`#${s.id}`}>{s.h2}</TocItem>
              ))}
              <TocItem n={a.sections.length + 1} href="#sss">Sık sorulan sorular</TocItem>
              <TocItem n={a.sections.length + 2} href="#kaynaklar">Kaynaklar</TocItem>
            </ol>
          </nav>
        </div>

        <article className="min-w-0 lg:col-span-8 lg:col-start-5 lg:row-start-2">
          {a.sections.map((s) => (
            <section key={s.id} id={s.id} className={SECTION}>
              <h2 className={H2}>{s.h2}</h2>
              {s.blocks.map((b, i) => <Block key={i} b={b} sources={a.sources} />)}
            </section>
          ))}

          {/* Gorunur SSS — FAQPage JSON-LD ayni listeden (lib/rehber.ts rehberFaqJsonLd) */}
          <section id="sss" className={SECTION}>
            <h2 className={H2}>Sık sorulan sorular</h2>
            <div className="mt-2 divide-y divide-border">
              {a.faq.map((f) => (
                <div key={f.q} className="py-6">
                  <h3 className={`${MEASURE} text-lg font-medium leading-snug`}>{f.q}</h3>
                  <p className={`${BODY} mt-2.5`}>{f.a}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="kaynaklar" className={SECTION}>
            <h2 className={H2}>Kaynaklar</h2>
            <ol className="mt-5 divide-y divide-border text-sm leading-[1.7] text-foreground/85">
              {a.sources.map((s, i) => (
                <li key={s.id} className="grid grid-cols-[1.75rem_1fr] gap-2 py-3">
                  <span className="pt-1 font-mono text-vitrin-rail text-dim tabular-nums" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0">
                    {s.url ? (
                      <>
                        {s.publisher}: <a href={s.url} target="_blank" rel="noopener noreferrer" className={VITRIN_LINK}>{s.title}</a>
                        {s.accessed && <span className="text-muted-foreground"> · erişim {formatAccessDate(s.accessed)}</span>}
                      </>
                    ) : (
                      <>
                        {s.publisher}: {s.title}
                        {s.note && <span className="text-muted-foreground"> · {s.note}</span>}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </article>
      </VitrinBand>

      {related.length > 0 && (
        <VitrinSection title={<span id="ilgili">İlgili rehberler</span>}>
          <nav aria-labelledby="ilgili">
            <ul className="border-t border-border">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={rehberPath(r.slug) as any}
                    className="group grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1.5 border-b border-border py-5 sm:grid-cols-[9rem_1fr_auto]"
                  >
                    <span className="v-rail col-span-2 sm:col-span-1">{r.topic}</span>
                    <span className="text-base font-medium transition-colors duration-200 group-hover:text-brand-vivid">{r.title}</span>
                    <ArrowUpRight className="h-4 w-4 self-center text-muted-foreground transition-colors duration-200 group-hover:text-brand-vivid" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </VitrinSection>
      )}

      <RehberCta />
    </>
  );
}

/** Deneme cagrisi — metin plans.ts deneme maddesiyle ayni (14 gun, kart istemez) */
export function RehberCta() {
  return (
    <VitrinBand className="flex flex-wrap items-center justify-between gap-x-10 gap-y-6 py-12 lg:py-14">
      <div>
        <p className="text-vitrin-3">Markanı altı yapay zekâ asistanında ölç</p>
        <p className="mt-2 text-sm leading-[1.8] text-muted-foreground">Site denetimi, AI görünürlük ölçümü, içerik ve ASO tek panelde.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href={SIGNUP_HREF as any} className="v-btn">
          14 gün ücretsiz dene · Kart gerekmez <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link href="/pricing" className="v-btn-line">
          Fiyatlar
        </Link>
      </div>
    </VitrinBand>
  );
}
