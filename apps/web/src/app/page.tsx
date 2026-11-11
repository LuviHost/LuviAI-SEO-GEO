import Link from 'next/link';
import { ArrowUpRight, Check, X as XIcon, TrendingUp } from 'lucide-react';
import type { Key } from '@/lib/i18n';
import { AiCheckerHero } from '@/components/landing/ai-checker-hero';
import { HeroVideo } from '@/components/landing/hero-video';
import { ExplainerDialog, WatchVideoButton } from '@/components/landing/explainer-dialog';
import { PricingSection } from '@/components/landing/pricing-section';
import { FaqSection } from '@/components/landing/faq-section';
import { T, LandingAnalytics, LocaleNumber } from '@/components/landing/landing-islands';
import { fetchPlans, fetchMeasuredEngines, fetchTestimonials, type PublicTestimonial } from '@/components/landing/landing-data';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { pageUpdated } from '@/lib/page-updated';
import { VITRIN_WRAP } from '@/lib/vitrin';
import { VitrinNav } from '@/components/vitrin/vitrin-nav';
import { VitrinCta } from '@/components/vitrin/vitrin-cta';
import { VitrinFooter } from '@/components/vitrin/vitrin-footer';

// ───────────────────────────────────────────────────────────────
//  RanksUp — Landing
//
//  SERVER bilesen + istemci adaciklari. Plan ve yorumlar sunucuda ISR ile
//  cekilir (ilk boyamada fiyat dolu). Metinler <T/> yapraklarinda cozulur cunku
//  dil secimi istemcide (localStorage) — SSR 'tr' basar.
//
//  Koyu vitrin (Kasim 2026): sayfa ziyaretcinin temasindan bagimsiz, notr siyah
//  ve duz bir sahnede cizilir (globals.css `.vitrin`, tema zorlamasi
//  theme-provider.tsx). Dil: buyuk, siki aralikli, ince agirlikli Geist; iki
//  tonlu basliklar; ince cizgili izgara; golge yok; tek doygun turuncu. Her
//  bolum ustte kucuk mono bir seritle baslar (solda bolum adi, sagda baglam ya
//  da derin sayfaya baglanti). Hero'nun imzasi canli yazilan ORNEK AI cevabi +
//  turuncu kalem; kanit bolumu sayfanin tek tam turuncu bandi.
//  Sira: Hero (test) → Uc yuzey → Nasil calisir (video) → KobiPratik kaniti →
//        (Yorumlar, yalniz ≥3 onayli) → Karsilastirma → Fiyat → SSS → Son cagri
// ───────────────────────────────────────────────────────────────

/** Fiyat/yorumlar 10 dakikada bir yeniden uretilir (landing-data LANDING_REVALIDATE ile ayni) */
export const revalidate = 600;

/** Bolum icerik genisligi + yan bosluk — ust menu ve alt bilgiyle ayni (lib/vitrin.ts) */
const WRAP = VITRIN_WRAP;
/** Bolum dikey boslugu */
const PAD = 'py-20 lg:py-28';

/**
 * KobiPratik — OLCULMUS tek vaka. Kaynaklar:
 *   - trafik/gosterim: Search Console (sc-domain:kobipratik.com), ilk 30 gun
 *     1.559 tiklama (gunde 52,0) -> son 30 gun 10.202 (gunde 340,1) = 6,54x;
 *     gosterim 79.852 -> 728.565
 *   - siralama: app_rankings, 16 May - 13 Agu, 1.264 konumlu olcum, 4.8 -> 2.9
 * Bu dosyada baska metrik YOK; yeni rakam eklenecekse once olculmeli.
 */
const CASE_ROWS: Array<{ label: Key; before: number; after: number; decimals?: number }> = [
  { label: 'land.res.d1', before: 52, after: 340 },
  { label: 'land.res.d2', before: 1559, after: 10202 },
  { label: 'land.res.d3', before: 79852, after: 728565 },
  { label: 'land.res.d4', before: 4.8, after: 2.9, decimals: 1 },
];

export default async function LandingPage() {
  const [plansTr, plansEn, testimonials, engines] = await Promise.all([
    fetchPlans('tr'),
    fetchPlans('en'),
    fetchTestimonials(6),
    // Su an olculen asistanlar: serit Muse'u yalniz API "olculuyor" derse gosterir
    fetchMeasuredEngines(),
  ]);
  // Karsilastirma tablosundaki RanksUp fiyati plan verisinden — elle yazilmaz
  const comparePlan = plansTr.find((p) => p.id === 'starter');
  const showTestimonials = testimonials.length >= 3;

  return (
    // data-vitrin: globals.css bu isareti gorunce token'lari belge duzeyinde koyu sahneye ceker.
    // overflow-x-clip (hidden DEGIL): hidden sarmalayiciyi kaydirma kabi yapiyor ve icindeki
    // `sticky` ust menu sayfayla birlikte kayip gidiyordu (canlida da boyleydi, 11.11.2026).
    <div data-vitrin className="dark vitrin min-h-screen overflow-x-clip bg-background text-foreground antialiased">
      <LandingAnalytics sections={['yuzeyler', 'nasil', 'sonuc', 'fiyat', 'sss']} />
      <ExplainerDialog />

      {/* Speakable schema — sesli asistanlar hero'yu okuyabilsin */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            url: 'https://ranksup.ai/',
            name: 'RanksUp — Yapay zekâ seni tavsiye ediyor mu?',
            // Footer'daki "Son güncelleme" satiriyla ve sitemap lastModified ile ayni kaynak
            dateModified: pageUpdated('/'),
            speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.hero-headline', '.hero-subtitle'] },
          }),
        }}
      />
      {showTestimonials && <ReviewSchema testimonials={testimonials} />}

      <VitrinNav />

      {/* ─── HERO ─────────────────────────────────────────────── */}
      {/* overflow-hidden: kartin arkasindaki nokta dokusu sutunun disina tasiyor; burada kirpilir
          (sarmalayicidaki overflow-x-clip'i tanimayan eski tarayicilarda yatay kaymayi onler) */}
      <section id="test" className="scroll-mt-16 overflow-hidden">
        <AiCheckerHero engines={engines} />
      </section>

      {/* ─── UC YUZEY ─────────────────────────────────────────── */}
      <section id="yuzeyler" className="scroll-mt-16 border-t border-border">
        <div className={`${WRAP} ${PAD}`}>
          <Rail label="land3.surf.rail"><T k="land3.surf.meta" /></Rail>
          <SectionHead a="land3.surf.a" b="land3.surf.b" sub="land2.surf.sub" />
          <div className="mt-14 border-t border-border lg:mt-20">
            <SurfaceRow code="SEO" title="land2.surf.seo.title" body="land2.surf.seo.body">
              <div className="space-y-1.5">
                <p className="v-rail">markan.com</p>
                <p className="font-medium text-info"><T k="land2.surf.seo.mock_title" /></p>
                <p className="inline-flex items-center gap-1.5 rounded bg-success/10 px-2 py-0.5 text-label font-medium text-success">
                  <TrendingUp className="h-3 w-3" aria-hidden /> <T k="land2.surf.seo.mock_meta" />
                </p>
              </div>
            </SurfaceRow>
            <SurfaceRow code="GEO" title="land2.surf.geo.title" body="land2.surf.geo.body">
              <p className="leading-relaxed">
                <mark className="rounded-[3px] bg-[hsl(var(--highlighter))] px-1 font-medium text-black">markan.com</mark>{' '}
                <span className="text-muted-foreground"><T k="land2.surf.geo.mock" /></span>
                <sup className="ml-0.5 text-label font-medium text-brand-vivid">[1]</sup>
              </p>
            </SurfaceRow>
            <SurfaceRow code="ASO" title="land2.surf.aso.title" body="land2.surf.aso.body">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-vivid text-lg font-semibold text-black" aria-hidden>M</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Markan</p>
                  <p className="text-label text-muted-foreground">“<T k="land2.surf.aso.mock_kw" />”</p>
                </div>
                <p className="text-3xl font-[450] tracking-[-0.05em] tabular-nums">#3</p>
              </div>
            </SurfaceRow>
          </div>
          <p className="v-rail mt-6"><T k="land2.surf.mock_note" /></p>
        </div>
      </section>

      {/* ─── NASIL CALISIR ────────────────────────────────────── */}
      <section id="nasil" className="scroll-mt-16 border-t border-border">
        <div className={`${WRAP} ${PAD}`}>
          <Rail label="land.nav.how"><T k="land3.how.meta" /></Rail>
          <SectionHead a="land3.how.a" b="land3.how.b" sub="land.how.subtitle" />
          <div className="mt-14 grid gap-12 lg:mt-20 lg:grid-cols-12 lg:gap-10">
            {/* Adimlar gercek bir sira: numara anlam tasir */}
            <ol className="border-t border-border lg:col-span-5">
              {([1, 2, 3] as const).map((n) => (
                <li key={n} className="grid grid-cols-[3rem_1fr] gap-4 border-b border-border py-6">
                  <span className="pt-1 font-mono text-vitrin-rail text-brand-vivid tabular-nums" aria-hidden>0{n}</span>
                  <div>
                    <h3 className="text-base font-medium"><T k={`land.how.s${n}.title` as Key} /></h3>
                    <p className="mt-2 text-sm leading-[1.8] text-muted-foreground"><T k={`land.how.s${n}.body` as Key} /></p>
                  </div>
                </li>
              ))}
            </ol>
            <figure className="lg:col-span-7">
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <HeroVideo variant="dark" />
              </div>
              <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="v-rail"><T k="land2.how.caption" /></span>
                <WatchVideoButton label="land.how.video_cta" source="how_section" variant="bare" className="v-btn-line h-9 px-4" />
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* ─── KANIT (gercek vaka) — sayfanin tek tam turuncu bandi ─ */}
      <section id="sonuc" className="scroll-mt-16 bg-brand-vivid text-black">
        <div className={`${WRAP} ${PAD}`}>
          <div className="mb-10 flex items-center justify-between gap-6 font-mono text-vitrin-rail text-black/70 sm:mb-14">
            <p className="flex items-center gap-2.5"><span className="h-1.5 w-1.5 bg-black" aria-hidden /><T k="land3.proof.rail" /></p>
            <p className="text-right"><T k="land3.proof.meta" /></p>
          </div>
          <div className="grid gap-14 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-7">
              <p className="text-base font-medium"><T k="land2.proof.kicker" /></p>
              <p className="mt-4 text-vitrin-0 tabular-nums">
                <span className="text-black/55">52</span>
                <span className="mx-[0.14em]" aria-hidden>→</span>
                <span className="sr-only"> → </span>
                <span>340</span>
              </p>
              <p className="mt-5 text-vitrin-3"><T k="land2.proof.unit" /></p>
            </div>
            <div className="lg:col-span-5 lg:pt-10">
              <h2 className="sr-only"><T k="land.res.case_title" /></h2>
              <dl className="border-t border-black/25">
                {CASE_ROWS.map((r) => (
                  <div key={r.label} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-5 border-b border-black/25 py-4">
                    <dt className="text-sm"><T k={r.label} /></dt>
                    <dd className="text-sm tabular-nums text-black/70"><LocaleNumber value={r.before} decimals={r.decimals} /></dd>
                    <dd className="min-w-[4.5rem] text-right text-base font-semibold tabular-nums"><LocaleNumber value={r.after} decimals={r.decimals} /></dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 text-label leading-relaxed text-black/70"><T k="land.res.source" /></p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── YORUMLAR — yalniz ≥3 onayli yorum varsa ──────────── */}
      {showTestimonials && (
        <section className="border-t border-border">
          <div className={`${WRAP} ${PAD}`}>
            <Rail label="land.test.eyebrow" />
            <h2 className="text-vitrin-2"><T k="land.test.title" /></h2>
            <div className="mt-14 grid gap-10 md:grid-cols-3">
              {testimonials.slice(0, 6).map((item) => <Testimonial key={item.id} item={item} />)}
            </div>
          </div>
        </section>
      )}

      {/* ─── KARSILASTIRMA ────────────────────────────────────── */}
      <section className="border-t border-border">
        <div className={`${WRAP} ${PAD}`}>
          <Rail label="land.cmp.eyebrow"><RailLink href="/compare" k="land3.cmp.meta" /></Rail>
          <SectionHead a="land3.cmp.a" b="land3.cmp.b" sub="land.cmp.subtitle" />
          {/* relative SART: hucrelerdeki sr-only metinler position:absolute. Kaydirma kutusu
              konumlu degilken bunlar kutunun kirpmasindan kacip belgeyi telefonda ~645px'e
              genisletiyordu (sayfa yatay kayiyordu; canlida da boyleydi, 11.11.2026). */}
          <div className="relative mt-14 overflow-x-auto lg:mt-20">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="v-rail sticky left-0 z-10 bg-background py-3 pr-4"><T k="land.cmp.col_feature" /></th>
                  {COMPETITORS.map((c) => (
                    <th key={c.name} scope="col" className="v-rail px-4 py-3 text-center">{c.name}</th>
                  ))}
                  <th scope="col" className="border-t-2 border-brand-vivid bg-card px-4 py-3 text-center font-medium">RanksUp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(['row1', 'row2', 'row3', 'row4', 'row5', 'row6', 'row7', 'row8'] as const).map((row, i) => (
                  <CompareRow key={row} label={`land.cmp.${row}` as Key} vals={COMPARE[i]} />
                ))}
                <tr>
                  <th scope="row" className="sticky left-0 z-10 bg-background py-4 pr-4 text-left font-medium"><T k="land.cmp.row_price" /></th>
                  {COMPETITORS.map((c) => (
                    <td key={c.name} className="px-4 py-4 text-center tabular-nums text-muted-foreground">{c.price}</td>
                  ))}
                  {/* Fiyat ELLE YAZILMAZ — /billing/plans ile ayni kaynak (sunucuda cekildi) */}
                  <td className="bg-card px-4 py-4 text-center font-semibold tabular-nums">
                    {comparePlan ? `$${comparePlan.monthly.toLocaleString('en-US')}` : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-6 max-w-4xl text-label leading-relaxed text-muted-foreground"><T k="land.cmp.note" /></p>
        </div>
      </section>

      {/* ─── FIYAT ────────────────────────────────────────────── */}
      <section id="fiyat" className="scroll-mt-16 border-t border-border">
        <div className={`${WRAP} ${PAD}`}>
          <Rail label="land.nav.pricing"><RailLink href="/pricing" k="land3.pricing.meta" /></Rail>
          <SectionHead a="land3.pricing.a" b="land3.pricing.b" sub="land.pricing.subtitle" />
          <div className="mt-14 lg:mt-20">
            <PricingSection initialPlans={{ tr: plansTr, en: plansEn }} />
          </div>
          <p className="mt-8 max-w-4xl text-sm leading-relaxed text-muted-foreground"><T k="land.pric.footer_note" /></p>
        </div>
      </section>

      {/* ─── SSS ──────────────────────────────────────────────── */}
      <section id="sss" className="scroll-mt-16 border-t border-border">
        <div className={`${WRAP} ${PAD}`}>
          <Rail label="land3.faq.rail"><RailLink href="/faq" k="land3.faq.meta" /></Rail>
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
            <h2 className="text-vitrin-2 lg:col-span-5">
              <span className="block"><T k="land3.faq.a" /></span>{' '}
              <span className="block text-dim"><T k="land3.faq.b" /></span>
            </h2>
            <div className="lg:col-span-7">
              <FaqSection />
            </div>
          </div>
        </div>
      </section>

      <VitrinCta />
      {/* "Son güncelleme" satiri burada kalir: page-updated.spec bu dosyada arar */}
      <VitrinFooter updated={<PageUpdatedLine path="/" className="font-mono" />} />
    </div>
  );
}

/**
 * Karsilastirma — sutunlar /compare ile ayni rakipler (Surfer, Jasper, Ahrefs,
 * Frase), sonra RanksUp. Eski set (SEMrush, AppTweak, Hootsuite, ChatGPT Team;
 * "Mayis 2026") dogrulanmamisti ve Hootsuite RanksUp'in artik sunmadigi sosyal
 * yayin icindi.
 *
 * Hucre: true = var, false = yok (urun kapsami disi), null = DOGRULANMADI ("—").
 * Rakip hakkinda yanlis "yok" iddiasi hukuki risk; ureticinin sayfasinda
 * gorulmeyen her hucre null. ASO ve Apple Search Ads satirlarindaki "yok":
 * dort aracin da fiyat/urun sayfalarinda uygulama magazasi ozelligi yok,
 * urun kapsamlari web SEO/icerik (/compare'deki reklam ve Turkiye satirlari gibi).
 *
 * Kaynaklar (hepsi 18.10.2026'da ureticinin kendi sayfasindan):
 *  - Surfer https://surferseo.com/pricing/ — Discovery 49 USD/ay yillik
 *    faturali (sayfada aylik faturali fiyat yok, yillik "up to 17%" ucuz);
 *    AI Tracker / "AI Search Analytics" plani; SSS "competitor share of voice".
 *    Tam makale: https://docs.surferseo.com/en/articles/7869670-surfer-ai
 *  - Jasper https://www.jasper.ai/pricing — Pro "$69/month billed monthly"
 *    ($59 yillik), kullanici basina; GEO ajanlari Business planda.
 *    AI gorunurluk: https://www.jasper.ai/solutions/seo-aeo-geo ("Measure how
 *    your brand performs across every major AI answer engine").
 *    Tam taslak: https://www.jasper.ai/agents/blog-post ("full draft", Pro).
 *  - Ahrefs https://ahrefs.com/pricing — en dusuk ucretli plan Starter $29/ay
 *    (ayri bolumde, ozellik listesi yok: "See what people search and spy on
 *    competitors"); Lite $129/ay ve ustunde Rank Tracker, Site Audit ve Brand
 *    Radar istemleri (Lite 5) dahil → tikler Lite+ (alt not "ust planlarda"
 *    diyor). AI yazim (Content Kit, "Soon") eklenti → null.
 *    AI Share of Voice: https://ahrefs.com/brand-radar
 *  - Frase https://www.frase.io/pricing — Starter "$49/mo month to month"
 *    ($39 yillik); AI Visibility (ChatGPT + Google AI, ust planda Claude/Gemini),
 *    her planda makale uretimi; share of voice ve anahtar kelime takibi yazmiyor.
 * Yeniden dogrulanirken tarih i18n.ts land.cmp.note ile birlikte guncellenir.
 */
const COMPETITORS: Array<{ name: string; price: string }> = [
  { name: 'Surfer', price: '$49' },
  { name: 'Jasper', price: '$69' },
  { name: 'Ahrefs', price: '$29' },
  { name: 'Frase', price: '$49' },
];

/** Sira: Surfer, Jasper, Ahrefs, Frase, RanksUp */
const COMPARE: Array<Array<boolean | null>> = [
  [null, null, true, null, true],     // Web SEO + anahtar kelime takibi (Ahrefs Rank Tracker)
  [true, true, true, true, true],     // AI gorunurluk takibi (rakiplerde plana gore)
  [false, false, false, false, true], // App Store + Play ASO
  [false, false, false, false, true], // Apple Search Ads yonetimi
  [null, null, null, null, true],     // Agent Readiness (AXO)
  [true, null, true, null, true],     // Rakip AI payi (Surfer AI Tracker, Ahrefs Brand Radar)
  [true, true, null, true, true],     // AI makale uretimi
  [null, null, null, null, true],     // Otomatik akis
];

// ─────────────────────────────────────────────────────────────
//  Sunucu alt bilesenleri (metin yapraklari <T/>)
// ─────────────────────────────────────────────────────────────

/**
 * Bolum ust seridi: solda bolum adi, sagda baglam ya da derin sayfaya baglanti.
 * Suslu bir ust etiket degil; ust menudeki bolum adlariyla ayni adlari tasir.
 */
function Rail({ label, children }: { label: Key; children?: React.ReactNode }) {
  return (
    <div className="mb-10 flex items-center justify-between gap-6 sm:mb-14">
      <p className="v-rail flex items-center gap-2.5">
        <span className="h-1.5 w-1.5 shrink-0 bg-brand-vivid" aria-hidden />
        <T k={label} />
      </p>
      {children && <div className="v-rail text-right">{children}</div>}
    </div>
  );
}

function RailLink({ href, k }: { href: string; k: Key }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 border-b border-white/25 pb-0.5 text-foreground transition-colors duration-200 hover:border-brand-vivid hover:text-brand-vivid"
    >
      <T k={k} />
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/** Iki tonlu bolum basligi (a parlak, b sonuk) + sagda kisa aciklama */
function SectionHead({ a, b, sub }: { a: Key; b: Key; sub?: Key }) {
  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
      <h2 className="text-vitrin-2 lg:col-span-8">
        <span className="block"><T k={a} /></span>{' '}
        <span className="block text-dim"><T k={b} /></span>
      </h2>
      {sub && <p className="max-w-md text-sm leading-[1.8] text-muted-foreground lg:col-span-4 lg:pt-3"><T k={sub} /></p>}
    </div>
  );
}

/** Bir arama yuzeyi satiri: solda buyuk kisaltma, ortada baslik + aciklama, sagda kucuk ornek */
function SurfaceRow({ code, title, body, children }: { code: string; title: Key; body: Key; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-6 border-b border-border py-9 lg:grid-cols-12 lg:gap-10 lg:py-11">
      <p className="text-vitrin-2 lg:col-span-3">{code}</p>
      <div className="lg:col-span-5">
        <h3 className="text-vitrin-3"><T k={title} /></h3>
        <p className="mt-3 max-w-md text-sm leading-[1.8] text-muted-foreground"><T k={body} /></p>
      </div>
      <div className="lg:col-span-4">
        <div className="flex min-h-[6.5rem] flex-col justify-center rounded-lg border border-border bg-card p-4 text-sm">{children}</div>
      </div>
    </div>
  );
}

function CompareRow({ label, vals }: { label: Key; vals: Array<boolean | null> }) {
  return (
    <tr>
      <th scope="row" className="sticky left-0 z-10 bg-background py-4 pr-4 text-left font-normal"><T k={label} /></th>
      {vals.map((v, i) => (
        <td key={i} className={`px-4 py-4 text-center ${i === vals.length - 1 ? 'bg-card' : ''}`}>
          {v === null ? (
            <span className="text-dim" aria-hidden>—</span>
          ) : v ? (
            <Check className={`inline h-4 w-4 ${i === vals.length - 1 ? 'text-brand-vivid' : 'text-foreground/70'}`} aria-hidden />
          ) : (
            <XIcon className="inline h-4 w-4 text-dim" aria-hidden />
          )}
          <span className="sr-only"><T k={v === null ? 'land.cmp.unknown' : v ? 'land.cmp.yes' : 'land.cmp.no'} /></span>
        </td>
      ))}
    </tr>
  );
}

function Testimonial({ item }: { item: PublicTestimonial }) {
  return (
    <figure className="flex flex-col border-t border-white/25 pt-6">
      <blockquote className="flex-1 text-base leading-[1.75]">“{item.body}”</blockquote>
      {item.metric && <p className="mt-4 font-mono text-vitrin-rail text-brand-vivid">{item.metric}</p>}
      <figcaption className="mt-5 text-sm">
        <span className="font-medium">{item.displayName}</span>
        {(item.role || item.company) && <span className="block text-muted-foreground">{[item.role, item.company].filter(Boolean).join(', ')}</span>}
      </figcaption>
    </figure>
  );
}

/** AggregateRating + Review schema — yalniz 3+ onayli yorum varsa */
function ReviewSchema({ testimonials }: { testimonials: PublicTestimonial[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: 'RanksUp',
          url: 'https://ranksup.ai/',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: (testimonials.reduce((s, t) => s + t.rating, 0) / testimonials.length).toFixed(1),
            reviewCount: testimonials.length,
            bestRating: 5,
            worstRating: 1,
          },
          review: testimonials.slice(0, 5).map((t) => ({
            '@type': 'Review',
            reviewRating: { '@type': 'Rating', ratingValue: t.rating, bestRating: 5 },
            author: {
              '@type': 'Person',
              name: t.displayName,
              ...(t.role || t.company ? { jobTitle: [t.role, t.company].filter(Boolean).join(' · ') } : {}),
            },
            reviewBody: t.body,
          })),
        }),
      }}
    />
  );
}
