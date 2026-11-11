import Link from 'next/link';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { VITRIN_LINK, VitrinBand, VitrinHero, VitrinSection } from '@/components/vitrin/vitrin-page';
import { pageUpdated } from '@/lib/page-updated';
import { cn } from '@/lib/utils';

/**
 * Yardim rehberlerinin ortak sablonu (/help/<slug>) — SUNUCU bileseni.
 *
 * Koyu vitrin (Kasim 2026): iki tonlu baslik; altinda her <h2> ayri bir bolum olur
 * (solda yapiskan baslik, sagda okuma sutunu — Hakkimizda ve SSS ile ayni duzen).
 * Icerik sayfalardan duz <p>, <ul>, <h3>, <a>, <strong>, <code> olarak gelir; siniflar
 * burada, sutun kapsayicisinda verilir (BODY). `prose` eklentisi yok. Kapanisi ortak
 * VitrinCta yapar (marketing-shell).
 */

/**
 * Okuma sutunu: 16px govdede satir basina ~70 karakter (34rem; Geist dar bir yazi,
 * 38rem'de satir ~80 karaktere cikiyor), uzun okuma icin sonuk gri yerine parlak ton.
 * Baslik, liste ve vurgu bicimleri /rehber makaleleriyle ayni (rehber-article.tsx).
 * Baglanti / kalin / kod kurallari her derinlikte gecerli: Step ve Tip icindeki metni
 * de bunlar boyar (o iki bilesen yalniz bu sutunun icinde kullanilir).
 */
const BODY = cn(
  'max-w-[34rem] text-base leading-[1.8] text-foreground/85 marker:text-muted-foreground',
  '[&>*:first-child]:mt-0 [&>p]:mt-5',
  '[&>ul]:mt-5 [&>ul]:list-[square] [&>ul]:space-y-2 [&>ul]:pl-5 [&>ul>li]:pl-1.5',
  '[&>h3]:mt-10 [&>h3]:text-lg [&>h3]:font-medium [&>h3]:leading-snug [&>h3]:text-foreground',
  '[&_strong]:font-medium [&_strong]:text-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm [&_code]:text-foreground',
  // VITRIN_LINK ile ayni gorunum (baglantilar icerikte sinifsiz <a> olarak gelir)
  '[&_a]:border-b [&_a]:border-white/30 [&_a]:pb-0.5 [&_a]:text-foreground [&_a]:transition-colors [&_a]:duration-200',
  '[&_a:hover]:border-brand-vivid [&_a:hover]:text-brand-vivid',
);

/**
 * Iki tonlu H1 icin basligi iki satira boler. Kelimeler ve sira AYNI kalir (iki parca
 * arasinda tek bosluk basilir). Ortaya en yakin bosluktan keser; esitlikte sonraki
 * bosluk secilir. Virgulun ya da "+" isaretinin hemen ardindan kesmez (sayim ortasindan
 * bolunmus gorunuyor); baska bosluk yoksa onlar da adaydir.
 */
function splitTitle(title: string): [string, string | undefined] {
  const spaces = Array.from(title.matchAll(/ /g), (m) => m.index);
  const clean = spaces.filter((i) => !',+'.includes(title[i - 1]));
  const pool = clean.length ? clean : spaces;
  if (!pool.length) return [title, undefined];
  const mid = title.length / 2;
  const cut = pool.reduce((best, i) => (Math.abs(i - mid) <= Math.abs(best - mid) ? i : best));
  return [title.slice(0, cut), title.slice(cut + 1)];
}

type Heading = ReactElement<{ id?: string; children?: ReactNode }>;

/**
 * Icerigi <h2>'lerden bolumlere ayirir. Ilk <h2>'den onceki icerik basliksiz bir bolum
 * olur. Sayfalar <h2>'leri dogrudan cocuk olarak verir; sarmalanmis bir <h2> bolum
 * acmaz, bulundugu bolumun metninde kalir.
 */
function splitSections(children: ReactNode): Array<{ head?: Heading; body: ReactNode[] }> {
  const sections: Array<{ head?: Heading; body: ReactNode[] }> = [];
  for (const child of Children.toArray(children)) {
    if (isValidElement(child) && child.type === 'h2') {
      sections.push({ head: child as Heading, body: [] });
    } else {
      if (!sections.length) sections.push({ body: [] });
      sections[sections.length - 1].body.push(child);
    }
  }
  return sections;
}

export function HelpArticle({
  badge, title, intro, children, slug, steps,
}: {
  /**
   * Konu ikonu. Makale basinda artik cizilmiyor (renkli ikon karosu kaldirildi; bolum
   * etiketinin isareti turuncu kare). Ayni ikon yardim dizininde (help/page.tsx) gorunur;
   * alan, rehber sayfalarinin cagrisi degismesin diye duruyor.
   */
  icon?: any;
  badge: string; title: string; intro: string; children: ReactNode;
  /** URL slug (örn: 'getting-started') — schema'da kullanılır */
  slug?: string;
  /** Step listesi — HowTo schema için (Google rich snippet "Step 1, 2, 3"). Her item: { name, text } */
  steps?: Array<{ name: string; text: string }>;
}) {
  const siteUrl = 'https://ranksup.ai';
  const articleUrl = slug ? `${siteUrl}/help/${slug}` : `${siteUrl}/help`;
  // Tarih tek kaynaktan (lib/page-updated.ts): gorunur satir, dateModified ve sitemap ayni
  const path = slug ? `/help/${slug}` : '/help';
  const updated = pageUpdated(path);
  const [titleA, titleB] = splitTitle(title);

  return (
    <>
      {/* BreadcrumbList schema (her alt help sayfasında) */}
      {slug && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'RanksUp', item: siteUrl },
                { '@type': 'ListItem', position: 2, name: 'Yardım', item: `${siteUrl}/help` },
                { '@type': 'ListItem', position: 3, name: title, item: articleUrl },
              ],
            }),
          }}
        />
      )}
      {/* Article schema (TechArticle — AI'lar dokümantasyon olarak tanısın) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            headline: title,
            description: intro,
            url: articleUrl,
            inLanguage: 'tr-TR',
            dateModified: updated,
            author: { '@type': 'Organization', name: 'RanksUp', url: siteUrl },
            publisher: { '@type': 'Organization', name: 'RanksUp', url: siteUrl, logo: { '@type': 'ImageObject', url: `${siteUrl}/og-image.png` } },
            // Speakable — Google Voice / Assistant için en üstteki paragraf okunabilir
            speakable: {
              '@type': 'SpeakableSpecification',
              cssSelector: ['h1', '.help-intro'],
            },
          }),
        }}
      />
      {/* HowTo schema — adim adim rehberin makine-okunur hali. totalTime yazilmaz:
          eskiden her rehbere olculmemis sabit 'PT5M' (5 dk) basiliyordu. */}
      {steps && steps.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'HowTo',
              name: title,
              description: intro,
              inLanguage: 'tr-TR',
              step: steps.map((s, i) => ({
                '@type': 'HowToStep',
                position: i + 1,
                name: s.name,
                text: s.text,
                url: `${articleUrl}#step-${i + 1}`,
              })),
            }),
          }}
        />
      )}
      <VitrinHero
        before={(
          <Link
            href={'/help' as any}
            className="inline-flex items-center gap-1.5 py-3 text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden /> Tüm rehberler
          </Link>
        )}
        rail={badge}
        a={titleA}
        b={titleB}
        lead={<p className="help-intro">{intro}</p>}
      >
        {/* font-mono sarmalayicida: tarih satirinin kendi sinif metni page-updated.spec'te sabit */}
        <div className="mt-4 font-mono">
          <PageUpdatedLine path={path} className="mt-2" fixedLocale="tr" />
        </div>
      </VitrinHero>

      <article>
        {splitSections(children).map((s, i) => (s.head ? (
          <VitrinSection key={i} id={s.head.props.id} title={s.head.props.children}>
            <div className={BODY}>{s.body}</div>
          </VitrinSection>
        ) : (
          <VitrinBand key={i} className="grid lg:grid-cols-12 lg:gap-10">
            <div className={cn(BODY, 'lg:col-span-8 lg:col-start-5')}>{s.body}</div>
          </VitrinBand>
        )))}
      </article>

      {/* Destek metni plans.ts destek kademeleriyle ayni (help/page.tsx ile de).
          Eski "15 dakika ucretsiz ekran paylasimi" hicbir plana dayanmiyordu. */}
      <VitrinSection title="Çözemedin mi?">
        <p className="text-xl tracking-[-0.02em] sm:text-2xl">
          <a href="mailto:destek@luvihost.com" className={VITRIN_LINK}>destek@luvihost.com</a>
        </p>
        <p className="mt-5 max-w-2xl text-sm leading-[1.8] text-muted-foreground">
          Destek ekibine e-postayla yaz; yanıt süresi planına göre değişir.
        </p>
      </VitrinSection>
    </>
  );
}

/**
 * Adım satırı: ince çizgili satır, solda mono sıra numarası (ana sayfadaki "Nasıl
 * çalışır" adımlarıyla aynı dil). Ardışık adımlar aradaki çizgiyi paylaşır.
 */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="help-step mt-6 grid grid-cols-[2rem_1fr] gap-x-2 border-y border-border py-5 [.help-step+&]:-mt-px sm:grid-cols-[2.5rem_1fr]">
      <span className="pt-1 font-mono text-vitrin-rail text-brand-vivid tabular-nums">{String(n).padStart(2, '0')}</span>
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}

/** Tür → etiket + durum tonu (yalnız durum token'ları; çizgi rengi metinle aynı) */
const TIP: Record<'info' | 'warn' | 'success', { label: string; tone: string }> = {
  info: { label: 'İpucu', tone: 'text-info' },
  warn: { label: 'Dikkat', tone: 'text-warning' },
  success: { label: 'Kazanım', tone: 'text-success' },
};

/** Bilgi / uyarı notu: solda durum renginde ince çizgi, üstte mono etiket */
export function Tip({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'success'; children: ReactNode }) {
  const { label, tone } = TIP[kind];
  return (
    <aside className={cn('mt-8 border-l-2 border-current pl-5', tone)}>
      <p className="font-mono text-vitrin-rail">{label}</p>
      <div className="mt-1.5 text-sm leading-[1.8] text-foreground/85">{children}</div>
    </aside>
  );
}
