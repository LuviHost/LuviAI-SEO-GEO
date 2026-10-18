import Link from 'next/link';
import { Check, X as XIcon, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { BrandWordmark } from '@/components/brand-logo';
import type { Key } from '@/lib/i18n';
import { AiCheckerHero } from '@/components/landing/ai-checker-hero';
import { HeroVideo } from '@/components/landing/hero-video';
import { ExplainerDialog, WatchVideoButton } from '@/components/landing/explainer-dialog';
import { PricingSection } from '@/components/landing/pricing-section';
import { FaqSection } from '@/components/landing/faq-section';
import { T, TrackedLink, LandingAnalytics, LocaleNumber } from '@/components/landing/landing-islands';
import { fetchPlans, fetchTestimonials, type PublicTestimonial } from '@/components/landing/landing-data';

// ───────────────────────────────────────────────────────────────
//  RanksUp — Landing (Faz 6)
//
//  SERVER bilesen + istemci adaciklari. Plan ve yorumlar sunucuda ISR ile
//  cekilir (ilk boyamada fiyat dolu). Metinler <T/> yapraklarinda cozulur cunku
//  dil secimi istemcide (localStorage) — SSR 'tr' basar.
//
//  Yeniden tasarim (Ekim 2026): hero'da canli yazilan ORNEK AI cevabi + fosforlu
//  kalem (tek cesur oge), Sora basliklar, sola hizali duzen; buyuk harfli ust
//  etiket / gradyan metin / logo seridi / dogrulanmamis rozet yok.
//  Sira: Hero (test) → Uc yuzey → Nasil calisir (video) → KobiPratik kaniti →
//        (Yorumlar, yalniz ≥3 onayli) → Karsilastirma → Fiyat → SSS → Son cagri
// ───────────────────────────────────────────────────────────────

/** Fiyat/yorumlar 10 dakikada bir yeniden uretilir (landing-data LANDING_REVALIDATE ile ayni) */
export const revalidate = 600;

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
  const [plansTr, plansEn, testimonials] = await Promise.all([
    fetchPlans('tr'),
    fetchPlans('en'),
    fetchTestimonials(6),
  ]);
  // Karsilastirma tablosundaki RanksUp fiyati plan verisinden — elle yazilmaz
  const comparePlan = plansTr.find((p) => p.id === 'starter');
  const showTestimonials = testimonials.length >= 3;

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground antialiased">
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
            speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.hero-headline', '.hero-subtitle'] },
          }),
        }}
      />
      {showTestimonials && <ReviewSchema testimonials={testimonials} />}

      {/* ─── NAV ──────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center" aria-label="RanksUp">
            <ThemedWordmark size={24} />
          </Link>
          <div className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#nasil" className="hover:text-foreground"><T k="land.nav.how" /></a>
            <a href="#sonuc" className="hover:text-foreground"><T k="land.nav.results" /></a>
            <a href="#fiyat" className="hover:text-foreground"><T k="land.nav.pricing" /></a>
            <a href="#sss" className="hover:text-foreground"><T k="land.nav.faq" /></a>
          </div>
          <div className="flex items-center gap-1.5">
            <LocaleSwitch />
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/signin"><T k="land.nav.login" /></Link>
            </Button>
            <Button asChild size="sm" className="bg-brand text-white hover:bg-brand-600">
              <TrackedLink href="/signin?signup=1" cta="nav_signup"><T k="land.nav.signup" /></TrackedLink>
            </Button>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─────────────────────────────────────────────── */}
      <section id="test" className="scroll-mt-16 overflow-x-clip pb-24 pt-14 lg:pb-32 lg:pt-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <AiCheckerHero />
        </div>
      </section>

      {/* ─── UC YUZEY ─────────────────────────────────────────── */}
      <section id="yuzeyler" className="scroll-mt-16 border-t border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionTitle title="land2.surf.title" sub="land2.surf.sub" />
          <div className="mt-14 grid gap-12 md:grid-cols-3 md:gap-0 md:divide-x md:divide-border">
            <Surface title="land2.surf.seo.title" body="land2.surf.seo.body" first>
              <div className="space-y-1.5">
                <p className="text-label text-muted-foreground">markan.com</p>
                <p className="font-medium text-info"><T k="land2.surf.seo.mock_title" /></p>
                <p className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-label font-semibold text-success">
                  <TrendingUp className="h-3 w-3" aria-hidden /> <T k="land2.surf.seo.mock_meta" />
                </p>
              </div>
            </Surface>
            <Surface title="land2.surf.geo.title" body="land2.surf.geo.body">
              <p className="leading-relaxed">
                <mark className="rounded-[3px] bg-[hsl(var(--highlighter))] px-0.5 font-semibold text-foreground">markan.com</mark>{' '}
                <span className="text-muted-foreground"><T k="land2.surf.geo.mock" /></span>
                <sup className="ml-0.5 text-label font-semibold text-brand-700 dark:text-brand-300">[1]</sup>
              </p>
            </Surface>
            <Surface title="land2.surf.aso.title" body="land2.surf.aso.body">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-brand font-brand text-lg font-bold text-white" aria-hidden>M</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Markan</p>
                  <p className="text-label text-muted-foreground">“<T k="land2.surf.aso.mock_kw" />”</p>
                </div>
                <p className="font-brand text-2xl font-semibold tabular-nums">#3</p>
              </div>
            </Surface>
          </div>
          <p className="mt-10 text-label text-muted-foreground"><T k="land2.surf.mock_note" /></p>
        </div>
      </section>

      {/* ─── NASIL CALISIR ────────────────────────────────────── */}
      <section id="nasil" className="scroll-mt-16 border-t border-border bg-muted/40 py-24">
        <div className="mx-auto grid max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-5">
            <SectionTitle title="land2.how.title" sub="land.how.subtitle" />
            <ol className="mt-10 space-y-8">
              {([1, 2, 3] as const).map((n) => (
                <li key={n} className="grid grid-cols-[2.5rem_1fr] gap-4">
                  <span className="font-brand text-2xl font-semibold leading-none text-brand-700 dark:text-brand-300 tabular-nums" aria-hidden>{n}</span>
                  <div>
                    <h3 className="font-semibold"><T k={`land.how.s${n}.title` as Key} /></h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground"><T k={`land.how.s${n}.body` as Key} /></p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <figure className="lg:col-span-7">
            <div className="overflow-hidden rounded-[20px] border border-border bg-card">
              <HeroVideo />
            </div>
            <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <T k="land2.how.caption" />
              <WatchVideoButton label="land.how.video_cta" source="how_section" variant="outline" size="sm" />
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ─── KANIT (gercek vaka) ──────────────────────────────── */}
      <section id="sonuc" className="scroll-mt-16 border-t border-border py-24">
        <div className="mx-auto grid max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-7">
            <p className="text-sm font-medium text-muted-foreground"><T k="land2.proof.kicker" /></p>
            <p className="mt-4 font-brand text-[3.5rem] font-semibold leading-none tracking-[-0.04em] tabular-nums sm:text-8xl">
              <span className="text-muted-foreground/70">52</span>
              <span className="mx-3 text-brand sm:mx-5" aria-hidden>→</span>
              <span className="sr-only"> → </span>
              <span>340</span>
            </p>
            <p className="mt-4 text-lg"><T k="land2.proof.unit" /></p>
          </div>
          <div className="lg:col-span-5">
            <h2 className="sr-only"><T k="land.res.case_title" /></h2>
            <dl className="divide-y divide-border border-y border-border">
              {CASE_ROWS.map((r) => (
                <div key={r.label} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 py-4">
                  <dt className="text-sm"><T k={r.label} /></dt>
                  <dd className="text-sm tabular-nums text-muted-foreground"><LocaleNumber value={r.before} decimals={r.decimals} /></dd>
                  <dd className="font-semibold tabular-nums text-success"><LocaleNumber value={r.after} decimals={r.decimals} /></dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-label leading-relaxed text-muted-foreground"><T k="land.res.source" /></p>
          </div>
        </div>
      </section>

      {/* ─── YORUMLAR — yalniz ≥3 onayli yorum varsa ──────────── */}
      {showTestimonials && (
        <section className="border-t border-border py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionTitle title="land.test.title" />
            <div className="mt-12 grid gap-10 md:grid-cols-3">
              {testimonials.slice(0, 6).map((item) => <Testimonial key={item.id} item={item} />)}
            </div>
          </div>
        </section>
      )}

      {/* ─── KARSILASTIRMA ────────────────────────────────────── */}
      <section className="border-t border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionTitle title="land.cmp.title" sub="land.cmp.subtitle" />
          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="sticky left-0 z-10 bg-background py-3 pr-4 font-medium text-muted-foreground"><T k="land.cmp.col_feature" /></th>
                  {COMPETITORS.map((c) => (
                    <th key={c.name} scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">{c.name}</th>
                  ))}
                  <th scope="col" className="border-t-2 border-brand px-4 py-3 text-center font-semibold">RanksUp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(['row1', 'row2', 'row3', 'row4', 'row5', 'row6', 'row7', 'row8'] as const).map((row, i) => (
                  <CompareRow key={row} label={`land.cmp.${row}` as Key} vals={COMPARE[i]} />
                ))}
                <tr>
                  <th scope="row" className="sticky left-0 z-10 bg-background py-4 pr-4 text-left font-semibold"><T k="land.cmp.row_price" /></th>
                  {COMPETITORS.map((c) => (
                    <td key={c.name} className="px-4 py-4 text-center tabular-nums text-muted-foreground">{c.price}</td>
                  ))}
                  {/* Fiyat ELLE YAZILMAZ — /billing/plans ile ayni kaynak (sunucuda cekildi) */}
                  <td className="bg-brand/5 px-4 py-4 text-center font-semibold tabular-nums">
                    {comparePlan ? `$${comparePlan.monthly.toLocaleString('en-US')}` : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-label text-muted-foreground"><T k="land.cmp.note" /></p>
        </div>
      </section>

      {/* ─── FIYAT ────────────────────────────────────────────── */}
      <section id="fiyat" className="scroll-mt-16 border-t border-border bg-muted/40 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionTitle title="land.pricing.title" sub="land.pricing.subtitle" />
          <div className="mt-12">
            <PricingSection initialPlans={{ tr: plansTr, en: plansEn }} />
          </div>
          <p className="mt-8 text-sm text-muted-foreground"><T k="land.pric.footer_note" /></p>
        </div>
      </section>

      {/* ─── SSS ──────────────────────────────────────────────── */}
      <section id="sss" className="scroll-mt-16 border-t border-border py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-4">
            <SectionTitle title="land.faq.title" />
          </div>
          <div className="lg:col-span-8">
            <FaqSection />
          </div>
        </div>
      </section>

      {/* ─── SON CTA ──────────────────────────────────────────── */}
      <section className="border-t border-border py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="max-w-3xl font-brand text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
            <T k="land2.cta.title" />
          </h2>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground"><T k="land.cta.subtitle" /></p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="h-12 bg-brand px-7 text-base text-white hover:bg-brand-600">
              <a href="#test"><T k="land2.cta.test" /></a>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-7 text-base">
              <TrackedLink href="/signin?signup=1" cta="final_primary"><T k="land.cta.button" /></TrackedLink>
            </Button>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ───────────────────────────────────────────── */}
      <footer className="border-t border-border py-12 text-sm text-muted-foreground">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 sm:px-6 md:grid-cols-4 lg:px-8">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center" aria-label="RanksUp">
              <ThemedWordmark size={20} />
            </Link>
            <p className="mt-3 text-xs leading-relaxed"><T k="land.footer.tagline" /></p>
          </div>
          <FooterCol title="land.footer.product" links={[['land.nav.pricing', '/pricing'], ['land.footer.use_cases', '/use-cases'], ['land.footer.compare', '/compare']]} />
          <FooterCol title="land.footer.company" links={[['land.footer.about', '/about'], ['land.footer.help', '/help'], ['land.nav.faq', '/faq']]} />
          <FooterCol title="land.footer.legal" links={[['land.footer.privacy', '/privacy'], ['land.footer.terms', '/terms'], ['land.footer.kvkk', '/kvkk']]} />
        </div>
        <div className="mx-auto mt-10 flex max-w-7xl flex-wrap justify-between gap-3 border-t border-border px-4 pt-6 text-xs sm:px-6 lg:px-8">
          <span>© {new Date().getFullYear()} RanksUp. <T k="land.footer.rights" />.</span>
          <span><T k="land.footer.made_in" /></span>
        </div>
      </footer>
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

/** BrandWordmark koyu temada "reversed" ister; inline display stili sinifi ezdigi icin sarmalanir */
function ThemedWordmark({ size }: { size: number }) {
  return (
    <>
      <span className="dark:hidden"><BrandWordmark size={size} /></span>
      <span className="hidden dark:inline"><BrandWordmark size={size} reversed /></span>
    </>
  );
}

/** Sola hizali bolum basligi — buyuk harfli ust etiket yok, gradyan metin yok */
function SectionTitle({ title, sub }: { title: Key; sub?: Key }) {
  return (
    <div className="max-w-2xl">
      <h2 className="font-brand text-3xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[2.75rem]"><T k={title} /></h2>
      {sub && <p className="mt-4 text-lg leading-relaxed text-muted-foreground"><T k={sub} /></p>}
    </div>
  );
}

/** Bir arama yuzeyi: ustte kendine ozgu kucuk ornek, altta baslik + aciklama */
function Surface({ title, body, first, children }: { title: Key; body: Key; first?: boolean; children: React.ReactNode }) {
  return (
    <div className={first ? 'md:pr-10' : 'md:px-10 md:last:pr-0'}>
      <div className="flex min-h-[7rem] flex-col justify-center rounded-xl border border-border bg-card p-4 text-sm">{children}</div>
      <h3 className="mt-6 font-brand text-xl font-semibold tracking-[-0.01em]"><T k={title} /></h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground"><T k={body} /></p>
    </div>
  );
}

function CompareRow({ label, vals }: { label: Key; vals: Array<boolean | null> }) {
  return (
    <tr>
      <th scope="row" className="sticky left-0 z-10 bg-background py-4 pr-4 text-left font-normal"><T k={label} /></th>
      {vals.map((v, i) => (
        <td key={i} className={`px-4 py-4 text-center ${i === vals.length - 1 ? 'bg-brand/5' : ''}`}>
          {v === null ? (
            <span className="text-muted-foreground/60" aria-hidden>—</span>
          ) : v ? (
            <Check className={`inline h-4 w-4 ${i === vals.length - 1 ? 'text-brand-700 dark:text-brand-300' : 'text-foreground/70'}`} aria-hidden />
          ) : (
            <XIcon className="inline h-4 w-4 text-muted-foreground/40" aria-hidden />
          )}
          <span className="sr-only"><T k={v === null ? 'land.cmp.unknown' : v ? 'land.cmp.yes' : 'land.cmp.no'} /></span>
        </td>
      ))}
    </tr>
  );
}

function Testimonial({ item }: { item: PublicTestimonial }) {
  return (
    <figure className="flex flex-col border-t-2 border-brand pt-6">
      <blockquote className="flex-1 text-[1.05rem] leading-relaxed">“{item.body}”</blockquote>
      {item.metric && <p className="mt-4 text-sm font-semibold text-success">{item.metric}</p>}
      <figcaption className="mt-5 text-sm">
        <span className="font-semibold">{item.displayName}</span>
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

function FooterCol({ title, links }: { title: Key; links: Array<[Key, string]> }) {
  return (
    <div>
      <h4 className="font-semibold text-foreground mb-3"><T k={title} /></h4>
      <ul className="space-y-2 text-xs">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="hover:text-foreground transition-colors"><T k={label} /></Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
