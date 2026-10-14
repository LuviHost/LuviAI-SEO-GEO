import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  Sparkles, ArrowRight, Check, X as XIcon, Search, Smartphone, Wand2, Bot, Star,
  TrendingUp, Globe, Rocket, Apple, Lock, Cpu, Cloud, BadgeCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import { BrandWordmark } from '@/components/brand-logo';
import type { Key } from '@/lib/i18n';
import { AiCheckerHero } from '@/components/landing/ai-checker-hero';
import { HeroVideo } from '@/components/landing/hero-video';
import { ExplainerDialog, WatchVideoButton } from '@/components/landing/explainer-dialog';
import { PricingSection } from '@/components/landing/pricing-section';
import { FaqSection } from '@/components/landing/faq-section';
import { T, TrackedLink, LandingAnalytics, AnimatedNumber, LocaleNumber } from '@/components/landing/landing-islands';
import { fetchPlans, fetchTestimonials, type PublicTestimonial } from '@/components/landing/landing-data';

// ───────────────────────────────────────────────────────────────
//  RanksUp — Landing (Faz 6)
//
//  SERVER bilesen + istemci adaciklari. Plan ve yorumlar sunucuda ISR ile
//  cekilir (ilk boyamada fiyat dolu). Metinler <T/> yapraklarinda cozulur cunku
//  dil secimi istemcide (localStorage) — SSR 'tr' basar.
//
//  Sira: Hero → Kanit seridi → Nasil calisir (video) → Cozum → Sonuclar →
//        (Yorumlar, yalniz ≥3 onayli) → Karsilastirma → Fiyat → SSS → Son CTA
// ───────────────────────────────────────────────────────────────

/** Fiyat/yorumlar 10 dakikada bir yeniden uretilir (landing-data LANDING_REVALIDATE ile ayni) */
export const revalidate = 600;

const AI_LABELS: Partial<Record<VendorName, string>> = {
  chatgpt: 'ChatGPT',
  'claude-ai': 'Claude',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  grok: 'Grok',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
};

const AVATAR_BGS = [
  'from-brand-500 to-brand-700',
  'from-brand-400 to-amber-500',
  'from-amber-400 to-brand-500',
  'from-brand-600 to-amber-600',
];

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
    <div className="min-h-screen bg-background text-foreground antialiased overflow-x-hidden">
      <LandingAnalytics sections={['nasil', 'cozum', 'sonuc', 'fiyat', 'sss']} />
      <ExplainerDialog />

      {/* Speakable schema — sesli asistanlar hero'yu okuyabilsin */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            url: 'https://ranksup.ai/',
            name: 'RanksUp — Markan ChatGPT\'de görünüyor mu?',
            speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.hero-headline', '.hero-subtitle'] },
          }),
        }}
      />
      {showTestimonials && <ReviewSchema testimonials={testimonials} />}

      {/* ─── NAV ──────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-background/85 backdrop-blur-xl border-b border-border/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center" aria-label="RanksUp">
            <ThemedWordmark size={24} />
          </Link>
          <div className="hidden md:flex items-center gap-7 text-sm">
            <a href="#nasil" className="hover:text-brand-600 transition-colors"><T k="land.nav.how" /></a>
            <a href="#cozum" className="hover:text-brand-600 transition-colors"><T k="land.nav.solution" /></a>
            <a href="#sonuc" className="hover:text-brand-600 transition-colors"><T k="land.nav.results" /></a>
            <a href="#fiyat" className="hover:text-brand-600 transition-colors"><T k="land.nav.pricing" /></a>
            <a href="#sss" className="hover:text-brand-600 transition-colors"><T k="land.nav.faq" /></a>
          </div>
          <div className="flex items-center gap-1.5">
            <LocaleSwitch />
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/signin"><T k="land.nav.login" /></Link>
            </Button>
            <Button asChild size="sm" className="bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white shadow-lg shadow-brand-500/20">
              <TrackedLink href="/signin?signup=1" cta="nav_signup">
                <T k="land.nav.signup" /> <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </TrackedLink>
            </Button>
          </div>
        </div>
      </nav>

      {/* ─── HERO (tek) ───────────────────────────────────────── */}
      <section className="relative pt-12 pb-14 lg:pt-20 lg:pb-16">
        {/* Tek, bulaniksiz arka plan gecisi — eski 3 dev blur-3xl katmani yerine */}
        <div className="absolute inset-x-0 top-0 -z-10 h-[38rem] bg-gradient-to-b from-brand-500/[0.07] via-amber-400/[0.03] to-transparent pointer-events-none" aria-hidden />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AiCheckerHero />
        </div>

        {/* Urun videosu — mobilde de hero gorseli (orbital diyagram yalniz lg+) */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 lg:mt-16">
          <HeroVideo />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mb-8">
            <AuthorityBadge icon={Apple} text="land.hero.authority_apple" />
            <AuthorityBadge icon={Cpu} text="land.hero.authority_ai" />
            <AuthorityBadge icon={Lock} text="land.hero.authority_security" />
            <AuthorityBadge icon={BadgeCheck} text="land.hero.authority_kvkk" />
            <AuthorityBadge icon={Cloud} text="land.hero.authority_uptime" />
          </div>
          <p className="text-eyebrow uppercase text-muted-foreground text-center mb-5">
            <T k="land.hero.ai_bar" />
          </p>
          <ul className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
            {(['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'grok', 'deepseek', 'mistral'] as VendorName[]).map((v) => (
              <li key={v} className="flex items-center gap-2 opacity-80">
                <VendorLogo name={v} size={22} alt="" />
                <span className="text-sm font-semibold">{AI_LABELS[v] ?? v}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── KANIT SERIDI (gercek vaka) ───────────────────────── */}
      <section aria-labelledby="kanit-baslik" className="border-y bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col lg:flex-row items-center gap-6 lg:gap-10">
          <p id="kanit-baslik" className="text-eyebrow uppercase text-brand-600 shrink-0">
            <T k="land.proof.label" />
          </p>
          <dl className="grid grid-cols-3 gap-4 sm:gap-8 flex-1 w-full text-center lg:text-left">
            <ProofStat value="6.5x" label="land.res.r1.title" />
            <ProofStat value="729K" label="land.res.r2.title" />
            <ProofStat value="2.9" label="land.res.r3.title" />
          </dl>
          <a href="#sonuc" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline underline-offset-4 shrink-0">
            <T k="land.proof.details" /> <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </section>

      {/* ─── NASIL CALISIR (video) ────────────────────────────── */}
      <section id="nasil" className="py-24 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHead eyebrow="land.how.eyebrow" title="land.how.title" subtitle="land.how.subtitle" />
          <div className="grid md:grid-cols-3 gap-6">
            <StepCard n={1} title="land.how.s1.title" body="land.how.s1.body" icon={Globe} />
            <StepCard n={2} title="land.how.s2.title" body="land.how.s2.body" icon={Sparkles} />
            <StepCard n={3} title="land.how.s3.title" body="land.how.s3.body" icon={Rocket} />
          </div>
          <div className="mt-10 flex justify-center">
            <WatchVideoButton label="land.how.video_cta" source="how_section" />
          </div>
        </div>
      </section>

      {/* ─── COZUM ────────────────────────────────────────────── */}
      <section id="cozum" className="py-24 bg-muted/30 border-y scroll-mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <p className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-2"><T k="land.sol.eyebrow" /></p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
              <T k="land.sol.title_a" />
              <br />
              <span className="bg-gradient-to-br from-brand-500 to-brand-700 bg-clip-text text-transparent">
                <T k="land.sol.title_b" />
              </span>
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <FeatureCard icon={Search} prefix="land.sol.c1" bullets={5} />
            <FeatureCard icon={Smartphone} prefix="land.sol.c2" bullets={4} />
            <FeatureCard icon={Wand2} prefix="land.sol.c3" bullets={4} />
            <FeatureCard icon={Bot} prefix="land.sol.c4" bullets={4} />
          </div>
          <div className="mt-10 text-center">
            <Link href="/use-cases" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline underline-offset-4">
              <T k="land.uc.link" /> <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── SONUCLAR (vaka ayrintisi) ────────────────────────── */}
      <section id="sonuc" className="py-24 scroll-mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHead eyebrow="land.res.eyebrow" title="land.res.title" />
          <div className="grid sm:grid-cols-3 gap-6 mb-10">
            <StatCard num="6.5x" label="land.res.r1.title" sub="land.res.r1.sub" />
            <StatCard num="729K" label="land.res.r2.title" sub="land.res.r2.sub" />
            <StatCard num="2.9" label="land.res.r3.title" sub="land.res.r3.sub" />
          </div>
          <div className="rounded-2xl border bg-card overflow-hidden">
            <h3 className="px-5 py-4 border-b font-bold"><T k="land.res.case_title" /></h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th scope="col" className="p-4 font-semibold"><T k="land.res.col_metric" /></th>
                    <th scope="col" className="p-4 font-semibold text-right"><T k="land.res.col_before" /></th>
                    <th scope="col" className="p-4 font-semibold text-right"><T k="land.res.col_after" /></th>
                  </tr>
                </thead>
                <tbody>
                  {CASE_ROWS.map((r) => (
                    <tr key={r.label} className="border-t">
                      <th scope="row" className="p-4 font-medium text-left"><T k={r.label} /></th>
                      <td className="p-4 text-right tabular-nums text-muted-foreground"><LocaleNumber value={r.before} decimals={r.decimals} /></td>
                      <td className="p-4 text-right tabular-nums font-bold text-success"><LocaleNumber value={r.after} decimals={r.decimals} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 border-t text-xs text-muted-foreground"><T k="land.res.source" /></p>
          </div>
        </div>
      </section>

      {/* ─── YORUMLAR — yalniz ≥3 onayli yorum varsa ──────────── */}
      {showTestimonials && (
        <section className="py-24 bg-muted/30 border-y">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <SectionHead eyebrow="land.test.eyebrow" title="land.test.title" />
            <div className="grid md:grid-cols-3 gap-5">
              {testimonials.slice(0, 6).map((item, i) => (
                <Testimonial key={item.id} item={item} avatarBg={AVATAR_BGS[i % AVATAR_BGS.length]} />
              ))}
            </div>
            <AggregateStars testimonials={testimonials} />
          </div>
        </section>
      )}

      {/* ─── KARSILASTIRMA ────────────────────────────────────── */}
      <section className={`py-24 ${showTestimonials ? '' : 'bg-muted/30 border-y'}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHead eyebrow="land.cmp.eyebrow" title="land.cmp.title" subtitle="land.cmp.subtitle" />
          <div className="overflow-x-auto rounded-2xl border bg-background">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="bg-muted">
                  <th scope="col" className="sticky left-0 z-10 bg-muted text-left p-4 font-semibold"><T k="land.cmp.col_feature" /></th>
                  {['SEMrush', 'AppTweak', 'Hootsuite', 'ChatGPT Team'].map((n) => (
                    <th key={n} scope="col" className="text-center p-4 font-semibold">{n}</th>
                  ))}
                  <th scope="col" className="text-center p-4 font-bold bg-brand-500/10 text-brand-700 dark:text-brand-400">RanksUp</th>
                </tr>
              </thead>
              <tbody>
                <CompareRow label="land.cmp.row1" vals={[true, false, false, false, true]} />
                <CompareRow label="land.cmp.row2" vals={[false, false, false, false, true]} />
                <CompareRow label="land.cmp.row3" vals={[false, true, false, false, true]} />
                <CompareRow label="land.cmp.row4" vals={[false, false, false, false, true]} />
                <CompareRow label="land.cmp.row5" vals={[false, false, true, false, true]} />
                <CompareRow label="land.cmp.row6" vals={[false, false, false, true, true]} />
                <CompareRow label="land.cmp.row7" vals={[false, false, false, true, true]} />
                <CompareRow label="land.cmp.row8" vals={[false, false, false, false, true]} />
                <tr className="border-t">
                  <th scope="row" className="sticky left-0 z-10 bg-background text-left p-4 font-bold"><T k="land.cmp.row_price" /></th>
                  {['$140', '$200', '$99', '$60'].map((p) => (
                    <td key={p} className="text-center p-4 text-muted-foreground">{p}</td>
                  ))}
                  {/* Fiyat ELLE YAZILMAZ — /billing/plans ile ayni kaynak (sunucuda cekildi) */}
                  <td className="text-center p-4 bg-brand-500/10 font-bold text-brand-700 dark:text-brand-400">
                    {comparePlan ? `$${comparePlan.monthly.toLocaleString('en-US')}` : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-4"><T k="land.cmp.note" /></p>
        </div>
      </section>

      {/* ─── FIYAT ────────────────────────────────────────────── */}
      <section id="fiyat" className={`py-24 scroll-mt-16 ${showTestimonials ? 'bg-muted/30 border-y' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <p className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-2"><T k="land.pricing.eyebrow" /></p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight"><T k="land.pricing.title" /></h2>
            <p className="mt-3 text-muted-foreground text-lg"><T k="land.pricing.subtitle" /></p>
          </div>
          <PricingSection initialPlans={{ tr: plansTr, en: plansEn }} />
          <p className="text-center mt-8 text-sm text-muted-foreground"><T k="land.pric.footer_note" /></p>
        </div>
      </section>

      {/* ─── SSS ──────────────────────────────────────────────── */}
      <section id="sss" className={`py-24 scroll-mt-16 ${showTestimonials ? '' : 'bg-muted/30 border-y'}`}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-2"><T k="land.faq.eyebrow" /></p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight"><T k="land.faq.title" /></h2>
          </div>
          <FaqSection />
        </div>
      </section>

      {/* ─── SON CTA ──────────────────────────────────────────── */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-500/10 via-amber-400/5 to-transparent" aria-hidden />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl sm:text-6xl font-extrabold tracking-tight"><T k="land.cta.title" /></h2>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto"><T k="land.cta.subtitle" /></p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg" className="h-14 px-8 text-base bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white shadow-2xl shadow-brand-500/40">
              <TrackedLink href="/signin?signup=1" cta="final_primary">
                <T k="land.cta.button" /> <ArrowRight className="h-5 w-5" aria-hidden />
              </TrackedLink>
            </Button>
            <WatchVideoButton label="land.cta.secondary" source="final_cta" className="h-14 px-8 text-base" />
          </div>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {(['land.hero.tag_no_card', 'land.hero.tag_free_articles', 'land.hero.tag_cancel'] as Key[]).map((k) => (
              <li key={k} className="inline-flex items-center gap-1">
                <Check className="h-3.5 w-3.5 text-success" aria-hidden /> <T k={k} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── FOOTER ───────────────────────────────────────────── */}
      <footer className="border-t py-12 text-sm text-muted-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center" aria-label="RanksUp">
              <ThemedWordmark size={20} />
            </Link>
            <p className="mt-3 text-xs leading-relaxed"><T k="land.footer.tagline" /></p>
          </div>
          <FooterCol title="land.footer.product" links={[['land.nav.pricing', '/pricing'], ['land.footer.use_cases', '/use-cases'], ['land.footer.compare', '/compare']]} />
          <FooterCol title="land.footer.company" links={[['land.footer.about', '/about'], ['land.footer.help', '/help'], ['land.nav.faq', '/faq'], ['land.footer.status', '/status']]} />
          <FooterCol title="land.footer.legal" links={[['land.footer.privacy', '/privacy'], ['land.footer.terms', '/terms'], ['land.footer.kvkk', '/kvkk']]} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-10 pt-6 border-t text-xs flex flex-wrap justify-between gap-3">
          <span>© {new Date().getFullYear()} RanksUp. <T k="land.footer.rights" />.</span>
          <span><T k="land.footer.made_in" /></span>
        </div>
      </footer>
    </div>
  );
}

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

function SectionHead({ eyebrow, title, subtitle }: { eyebrow: Key; title: Key; subtitle?: Key }) {
  return (
    <div className="text-center mb-14">
      <p className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-2"><T k={eyebrow} /></p>
      <h2 className="text-3xl sm:text-5xl font-bold tracking-tight"><T k={title} /></h2>
      {subtitle && <p className="mt-3 text-lg text-muted-foreground"><T k={subtitle} /></p>}
    </div>
  );
}

function ProofStat({ value, label }: { value: string; label: Key }) {
  return (
    <div>
      <dd className="text-2xl sm:text-3xl font-extrabold text-foreground">
        <AnimatedNumber raw={value} />
      </dd>
      <dt className="text-xs text-muted-foreground mt-0.5"><T k={label} /></dt>
    </div>
  );
}

function FeatureCard({ icon: Icon, prefix, bullets }: { icon: LucideIcon; prefix: 'land.sol.c1' | 'land.sol.c2' | 'land.sol.c3' | 'land.sol.c4'; bullets: number }) {
  const bulletKeys = Array.from({ length: bullets }, (_, i) => `${prefix}.b${i + 1}` as Key);
  return (
    <div className="p-7 rounded-2xl border bg-card hover:border-brand-500/40 transition-colors">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-11 w-11 rounded-xl bg-brand-500/10 grid place-items-center">
          <Icon className="h-5 w-5 text-brand-600" aria-hidden />
        </div>
        <span className="text-label font-bold uppercase tracking-wider text-brand-600"><T k={`${prefix}.tag` as Key} /></span>
      </div>
      <h3 className="text-xl font-bold mb-2"><T k={`${prefix}.title` as Key} /></h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-4"><T k={`${prefix}.body` as Key} /></p>
      <ul className="space-y-1.5">
        {bulletKeys.map((k) => (
          <li key={k} className="text-sm flex items-start gap-2">
            <Check className="h-4 w-4 text-brand-600 shrink-0 mt-0.5" aria-hidden />
            <span><T k={k} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepCard({ n, title, body, icon: Icon }: { n: number; title: Key; body: Key; icon: LucideIcon }) {
  return (
    <div className="relative p-7 rounded-2xl border bg-background">
      <div className="absolute -top-4 -left-2 text-7xl font-extrabold text-brand-500/10 leading-none select-none" aria-hidden>
        {n}
      </div>
      <div className="relative">
        <Icon className="h-7 w-7 text-brand-600 mb-3" aria-hidden />
        <h3 className="text-lg font-bold mb-2"><T k={title} /></h3>
        <p className="text-sm text-muted-foreground leading-relaxed"><T k={body} /></p>
      </div>
    </div>
  );
}

function StatCard({ num, label, sub }: { num: string; label: Key; sub: Key }) {
  return (
    <div className="p-8 rounded-2xl border bg-gradient-to-br from-brand-500/5 to-transparent text-center">
      <div className="text-5xl md:text-6xl font-extrabold bg-gradient-to-br from-brand-500 to-brand-700 bg-clip-text text-transparent">
        <AnimatedNumber raw={num} />
      </div>
      <div className="mt-2 font-semibold"><T k={label} /></div>
      <div className="text-xs text-muted-foreground mt-1"><T k={sub} /></div>
    </div>
  );
}

function AuthorityBadge({ icon: Icon, text }: { icon: LucideIcon; text: Key }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/60 bg-background/50 text-label font-semibold">
      <Icon className="h-3.5 w-3.5 text-brand-600" aria-hidden />
      <T k={text} />
    </div>
  );
}

function CompareRow({ label, vals }: { label: Key; vals: boolean[] }) {
  return (
    <tr className="border-t">
      <th scope="row" className="sticky left-0 z-10 bg-background text-left p-4 font-medium"><T k={label} /></th>
      {vals.map((v, i) => (
        <td key={i} className={`p-4 text-center ${i === vals.length - 1 ? 'bg-brand-500/5' : ''}`}>
          {v ? <Check className="h-4 w-4 text-success inline" aria-hidden /> : <XIcon className="h-4 w-4 text-muted-foreground/40 inline" aria-hidden />}
          <span className="sr-only"><T k={v ? 'land.cmp.yes' : 'land.cmp.no'} /></span>
        </td>
      ))}
    </tr>
  );
}

function Testimonial({ item, avatarBg }: { item: PublicTestimonial; avatarBg: string }) {
  return (
    <figure className="p-7 rounded-2xl border bg-background flex flex-col">
      <div className="flex gap-0.5 mb-3" aria-label={`${item.rating}/5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={`h-4 w-4 ${i <= item.rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} aria-hidden />
        ))}
      </div>
      <blockquote className="text-sm leading-relaxed flex-1 mb-5">“{item.body}”</blockquote>
      {item.metric && (
        <div className="mb-5 inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/10 text-success text-label font-bold">
          <TrendingUp className="h-3 w-3" aria-hidden /> {item.metric}
        </div>
      )}
      <figcaption className="flex items-center gap-3 pt-4 border-t">
        <div className={`h-10 w-10 rounded-full bg-gradient-to-br ${avatarBg} text-white grid place-items-center font-bold text-sm shrink-0`} aria-hidden>
          {item.initials}
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm">{item.displayName}</div>
          {(item.role || item.company) && (
            <div className="text-label text-muted-foreground truncate">{[item.role, item.company].filter(Boolean).join(' · ')}</div>
          )}
        </div>
      </figcaption>
    </figure>
  );
}

function AggregateStars({ testimonials }: { testimonials: PublicTestimonial[] }) {
  const avg = testimonials.reduce((s, t) => s + t.rating, 0) / testimonials.length;
  return (
    <div className="mt-12 flex items-center justify-center gap-2 text-sm">
      <div className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={`h-5 w-5 ${i <= Math.round(avg) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
        ))}
      </div>
      <span className="font-bold">{avg.toFixed(1)} / 5.0</span>
      <span className="text-muted-foreground">— {testimonials.length} <T k="land.test.from_reviews" /></span>
    </div>
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
