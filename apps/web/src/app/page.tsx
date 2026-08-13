'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { trackPageview, trackCta, setupScrollDepthTracking, setupSectionTracking } from '@/lib/landing-track';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import { BrandWordmark } from '@/components/brand-logo';
import { Eyebrow, StepMotif } from '@/components/brand';
import { AiCheckerHero } from '@/components/landing/ai-checker-hero';
import {
  Sparkles, ArrowRight, Check, X as XIcon, ChevronDown,
  Rocket, Search, Smartphone, Wand2, Bot, Star,
  TrendingUp, Zap, ShieldCheck, Clock, Globe,
  PlayCircle, MessageSquare, FileText, Apple,
  Lock, Cpu, Cloud, BadgeCheck,
} from 'lucide-react';

// ───────────────────────────────────────────────────────────────
//  RanksUp — Landing ("Basamak" marka sistemi v1)
//  AIDA + PAS + Risk Reversal · ink ↔ bone bölüm ritmi · plan verisi /api/billing/plans'tan
// ───────────────────────────────────────────────────────────────

type Plan = {
  id: string;
  name: string;
  /** Kanonik fiyat — USD */
  monthly: number;
  annual: number;
  currency: string;
  /** Gunun TCMB kuruyla hesaplanmis TL karsiligi */
  monthlyTry: number;
  annualTry: number;
  articlesPerMonth: number;
  socialPostsPerMonth: number;
  sites: number | string;
  publishTargets: string;
  support: string;
  popular?: boolean;
  contactSales?: boolean;
};

const AI_LABELS: Partial<Record<VendorName, string>> = {
  'chatgpt': 'ChatGPT',
  'claude-ai': 'Claude',
  'gemini': 'Gemini',
  'perplexity': 'Perplexity',
  'grok': 'Grok',
  'deepseek': 'DeepSeek',
  'mistral': 'Mistral',
};

const INTEGRATION_LABELS: Partial<Record<VendorName, string>> = {
  'linkedin': 'LinkedIn', 'twitter': 'X (Twitter)', 'facebook': 'Facebook',
  'instagram': 'Instagram', 'tiktok': 'TikTok', 'youtube': 'YouTube',
  'google': 'Google Ads', 'wordpress': 'WordPress', 'shopify': 'Shopify', 'webflow': 'Webflow',
};

type PublicTestimonial = {
  id: string;
  rating: number;
  body: string;
  role: string | null;
  company: string | null;
  metric: string | null;
  displayName: string;
  initials: string;
};

export default function LandingPage() {
  const { t } = useT();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [testimonials, setTestimonials] = useState<PublicTestimonial[]>([]);

  useEffect(() => {
    api.getPlans('tr').then((r) => setPlans((r?.plans as Plan[]) ?? [])).catch(() => {});
    api.listPublicTestimonials(6).then((t) => setTestimonials(t ?? [])).catch(() => {});
    // Landing analytics
    trackPageview();
    const offScroll = setupScrollDepthTracking();
    const offSection = setupSectionTracking(['cozum', 'nasil', 'sonuc', 'fiyat', 'sss']);
    return () => { offScroll?.(); offSection?.(); };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground antialiased overflow-x-hidden">
      {/* Speakable schema — Voice search / Assistant için hero okunabilir */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            url: 'https://ranksup.ai/',
            name: 'RanksUp — Senin yerine pazarlama yapan AI',
            speakable: {
              '@type': 'SpeakableSpecification',
              cssSelector: ['.hero-headline', '.hero-subtitle'],
            },
          }),
        }}
      />

      {/* AggregateRating + Review schema — sadece 3+ onaylı testimonial varsa */}
      {testimonials.length >= 3 && (
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
      )}

      {/* ─── NAV ──────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-background/85 backdrop-blur-xl border-b border-border/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <BrandWordmark size={24} />
          </Link>
          <div className="hidden md:flex items-center gap-7 text-sm">
            <a href="#cozum" className="hover:text-brand transition-colors">{t('land.nav.solution')}</a>
            <a href="#nasil" className="hover:text-brand transition-colors">{t('land.nav.how')}</a>
            <a href="#sonuc" className="hover:text-brand transition-colors">{t('land.nav.results')}</a>
            <a href="#fiyat" className="hover:text-brand transition-colors">{t('land.nav.pricing')}</a>
            <a href="#sss" className="hover:text-brand transition-colors">{t('land.nav.faq')}</a>
          </div>
          <div className="flex items-center gap-1.5">
            <LocaleSwitch />
            <ThemeToggle />
            <Link href="/signin" className="hidden sm:inline-block">
              <Button variant="ghost" size="sm">{t('land.nav.login')}</Button>
            </Link>
            <Link href="/signin?signup=1" className="btn-brand h-9 px-4 text-sm">
              {t('land.nav.signup')} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── HERO — surface-ink + grafik kağıdı (her temada ink) ── */}
      <section className="relative overflow-hidden surface-ink grid-paper pt-14 pb-16 lg:pt-20 lg:pb-24">
        {/* Basamak köşe süsü — orkestre an: karelerin yukarı dizilişi (stagger) */}
        <div aria-hidden className="pointer-events-none absolute top-10 right-6 lg:right-12 hidden md:flex items-end gap-[3px] stagger-reveal">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 ${i === 4 ? 'bg-brand' : 'bg-bone/20'}`}
              style={{ marginBottom: i * 13 }}
            />
          ))}
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* PRIMARY: Big AI Visibility Test hero (domain test as the main CTA) */}
          <AiCheckerHero />

          {/* SUB-HERO: full-platform message + signup CTA (after the test catches attention) */}
          <div className="mt-20 lg:mt-24 pt-12 border-t border-bone/10 text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-bone/15 mb-5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-400" />
              </span>
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-brand-400">
                {t('land.hero.badge')}
              </span>
            </div>

            <h2 className="font-brandDisplay text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-[-0.03em] leading-[1.08] mb-4">
              {t('land.hero.title_pre')}{' '}
              <span className="text-brand-400">{t('land.hero.title_brand')}</span>{t('land.hero.title_dot')}
            </h2>

            <p className="text-base sm:text-lg text-[#A99F92] max-w-2xl mx-auto leading-relaxed mb-7">
              {t('land.hero.subtitle')}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/signin?signup=1"
                onClick={() => trackCta('hero_primary')}
                className="btn-brand h-12 px-7 text-base w-full sm:w-auto"
              >
                {t('land.hero.cta_primary')}
                <ArrowRight className="h-5 w-5" />
              </Link>
              <a
                href="#nasil"
                onClick={() => trackCta('hero_secondary_demo')}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] border border-bone/20 px-7 text-base font-semibold text-bone transition-colors hover:border-bone/40 w-full sm:w-auto"
              >
                <PlayCircle className="h-5 w-5" /> {t('land.hero.cta_secondary')}
              </a>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-[#A99F92]">
              <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-[#3E9B4F]" /> {t('land.hero.tag_no_card')}</span>
              <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-[#3E9B4F]" /> {t('land.hero.tag_free_articles')}</span>
              <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-[#3E9B4F]" /> {t('land.hero.tag_cancel')}</span>
              <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-[#3E9B4F]" /> {t('land.hero.tag_setup')}</span>
            </div>
          </div>
        </div>

        {/* ─── Live Product Preview (dashboard mockup) ─── */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-16">
          <ProductPreview />
        </div>
      </section>

      {/* ─── AUTHORITY + LOGO BAR — bone strip ───────────────── */}
      <section className="bg-bone text-ink dark:bg-ink-2 dark:text-bone border-b border-ink/10 dark:border-bone/10 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Authority rozet bar */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mb-8">
            <AuthorityBadge icon={Apple} text={t('land.hero.authority_apple')} />
            <AuthorityBadge icon={Cpu} text={t('land.hero.authority_ai')} />
            <AuthorityBadge icon={Lock} text={t('land.hero.authority_security')} />
            <AuthorityBadge icon={BadgeCheck} text={t('land.hero.authority_kvkk')} />
            <AuthorityBadge icon={Cloud} text={t('land.hero.authority_uptime')} />
          </div>

          {/* AI Provider logo bar */}
          <div className="text-center mb-5">
            <Eyebrow>{t('land.hero.ai_bar')}</Eyebrow>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4 mb-8">
            {(['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'grok', 'deepseek', 'mistral'] as VendorName[]).map((v) => (
              <div key={v} className="flex items-center gap-2 opacity-80 hover:opacity-100 transition">
                <VendorLogo name={v} size={22} />
                <span className="text-sm font-semibold">{AI_LABELS[v] ?? v}</span>
              </div>
            ))}
          </div>

          {/* Diğer entegrasyon platformları */}
          <div className="text-center mb-4 mt-4">
            <Eyebrow>{t('land.hero.integration_bar')}</Eyebrow>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4 opacity-80">
            {(['linkedin', 'twitter', 'facebook', 'instagram', 'tiktok', 'youtube', 'google', 'wordpress', 'shopify', 'webflow'] as VendorName[]).map((v) => (
              <div key={v} className="flex items-center gap-1.5 hover:opacity-100 transition" title={INTEGRATION_LABELS[v] ?? v}>
                <VendorLogo name={v} size={20} />
              </div>
            ))}
            <span className="text-xs font-bold text-[#6E6259] dark:text-[#A99F92] ml-2">+ Apple Search Ads · App Store Connect</span>
          </div>
        </div>
      </section>

      {/* ─── PAIN (PAS) — ink ─────────────────────────────────── */}
      <section className="surface-ink py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 max-w-3xl mx-auto">
            <Eyebrow index="01" className="mb-3 text-[#A99F92]">{t('land.pain.eyebrow')}</Eyebrow>
            <h2 className="font-brandDisplay text-3xl sm:text-4xl font-bold tracking-[-0.03em]">
              {t('land.pain.title')}
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            <PainCard
              cost={t('land.pain.c1_cost')}
              title={t('land.pain.c1_title')}
              body={t('land.pain.c1_body')}
            />
            <PainCard
              cost={t('land.pain.c2_cost')}
              title={t('land.pain.c2_title')}
              body={t('land.pain.c2_body')}
            />
            <PainCard
              cost={t('land.pain.c3_cost')}
              title={t('land.pain.c3_title')}
              body={t('land.pain.c3_body')}
            />
          </div>
          <p className="text-center mt-10 text-lg font-bold">
            {t('land.pain.total')}
          </p>
        </div>
      </section>

      {/* ─── SOLUTION — bone ──────────────────────────────────── */}
      <section id="cozum" className="bg-bone text-ink dark:bg-ink-2 dark:text-bone py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <Eyebrow index="02" className="mb-3">{t('land.sol.eyebrow')}</Eyebrow>
            <h2 className="font-brandDisplay text-3xl sm:text-5xl font-bold tracking-[-0.03em]">
              {t('land.sol.title_a')}<br />
              <span className="text-brand dark:text-brand-400">
                {t('land.sol.title_b')}
              </span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <FeatureCard
              icon={Search}
              tag={t('land.sol.c1.tag')}
              title={t('land.sol.c1.title')}
              body={t('land.sol.c1.body')}
              bullets={[t('land.sol.c1.b1'), t('land.sol.c1.b2'), t('land.sol.c1.b3'), t('land.sol.c1.b4')]}
            />
            <FeatureCard
              icon={Smartphone}
              tag={t('land.sol.c2.tag')}
              title={t('land.sol.c2.title')}
              body={t('land.sol.c2.body')}
              bullets={[t('land.sol.c2.b1'), t('land.sol.c2.b2'), t('land.sol.c2.b3'), t('land.sol.c2.b4')]}
            />
            <FeatureCard
              icon={Wand2}
              tag={t('land.sol.c3.tag')}
              title={t('land.sol.c3.title')}
              body={t('land.sol.c3.body')}
              bullets={[t('land.sol.c3.b1'), t('land.sol.c3.b2'), t('land.sol.c3.b3'), t('land.sol.c3.b4')]}
            />
            <FeatureCard
              icon={Bot}
              tag={t('land.sol.c4.tag')}
              title={t('land.sol.c4.title')}
              body={t('land.sol.c4.body')}
              bullets={[t('land.sol.c4.b1'), t('land.sol.c4.b2'), t('land.sol.c4.b3'), t('land.sol.c4.b4')]}
            />
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS — ink ───────────────────────────────── */}
      <section id="nasil" className="surface-ink py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <Eyebrow index="03" className="mb-3 text-[#A99F92]">{t('land.how.eyebrow')}</Eyebrow>
            <h2 className="font-brandDisplay text-3xl sm:text-5xl font-bold tracking-[-0.03em]">
              {t('land.how.title')}
            </h2>
            <p className="mt-3 text-lg text-[#A99F92]">{t('land.how.subtitle')}</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <StepCard n={1} title={t('land.how.s1.title')} body={t('land.how.s1.body')} icon={Globe} />
            <StepCard n={2} title={t('land.how.s2.title')} body={t('land.how.s2.body')} icon={Sparkles} />
            <StepCard n={3} title={t('land.how.s3.title')} body={t('land.how.s3.body')} icon={Rocket} />
          </div>
        </div>
      </section>

      {/* ─── RESULTS — bone ───────────────────────────────────── */}
      <section id="sonuc" className="bg-bone text-ink dark:bg-ink-2 dark:text-bone py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <Eyebrow index="04" className="mb-3">{t('land.res.eyebrow')}</Eyebrow>
            <h2 className="font-brandDisplay text-3xl sm:text-5xl font-bold tracking-[-0.03em]">
              {t('land.res.title')}
            </h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <StatCard num="+%47" label={t('land.res.r1.title')} sub={t('land.res.r1.sub')} />
            <StatCard num="-%62" label={t('land.res.r2.title')} sub={t('land.res.r2.sub')} />
            <StatCard num="10x" label={t('land.res.r3.title')} sub={t('land.res.r3.sub')} />
          </div>
        </div>
      </section>

      {/* ─── COMPARISON — ink ─────────────────────────────────── */}
      <section className="surface-ink py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <Eyebrow index="05" className="mb-3 text-[#A99F92]">{t('land.cmp.eyebrow')}</Eyebrow>
            <h2 className="font-brandDisplay text-3xl sm:text-5xl font-bold tracking-[-0.03em]">
              {t('land.cmp.title')}
            </h2>
            <p className="mt-3 text-[#A99F92]">{t('land.cmp.subtitle')}</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-bone/10 bg-ink-2">
            <table className="w-full text-sm">
              <thead className="bg-bone/5">
                <tr>
                  <th className="text-left p-4 font-semibold">{t('land.cmp.col_feature')}</th>
                  <th className="text-center p-4 font-semibold">SEMrush</th>
                  <th className="text-center p-4 font-semibold">AppTweak</th>
                  <th className="text-center p-4 font-semibold">Hootsuite</th>
                  <th className="text-center p-4 font-semibold">ChatGPT Team</th>
                  <th className="text-center p-4 font-bold bg-brand/15 text-brand-400">RanksUp</th>
                </tr>
              </thead>
              <tbody>
                <CompareRow row={[t('land.cmp.row1'), true, false, false, false, true]} />
                <CompareRow row={[t('land.cmp.row2'), false, false, false, false, true]} />
                <CompareRow row={[t('land.cmp.row3'), false, true, false, false, true]} />
                <CompareRow row={[t('land.cmp.row4'), false, false, false, false, true]} />
                <CompareRow row={[t('land.cmp.row5'), false, false, true, false, true]} />
                <CompareRow row={[t('land.cmp.row6'), false, false, false, true, true]} />
                <CompareRow row={[t('land.cmp.row7'), false, false, false, true, true]} />
                <CompareRow row={[t('land.cmp.row8'), false, false, false, false, true]} />
                <tr className="border-t border-bone/10 bg-bone/5">
                  <td className="p-4 font-bold">{t('land.cmp.row_price')}</td>
                  <td className="text-center p-4 text-[#A99F92]">$140</td>
                  <td className="text-center p-4 text-[#A99F92]">$200</td>
                  <td className="text-center p-4 text-[#A99F92]">$99</td>
                  <td className="text-center p-4 text-[#A99F92]">$60</td>
                  <td className="text-center p-4 bg-brand/15 font-bold tabular-nums text-brand-400">₺4.999 ($125)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs text-[#A99F92] mt-4">
            {t('land.cmp.note')}
          </p>
        </div>
      </section>

      {/* ─── USE CASES — bone ─────────────────────────────────── */}
      <section className="bg-bone text-ink dark:bg-ink-2 dark:text-bone py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <Eyebrow index="06" className="mb-3">{t('land.uc.eyebrow')}</Eyebrow>
            <h2 className="font-brandDisplay text-3xl sm:text-5xl font-bold tracking-[-0.03em]">
              {t('land.uc.title')}
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            <UseCaseCard
              icon={FileText}
              audience={t('land.uc.c1.tag')}
              hook={t('land.uc.c1.title')}
              body={t('land.uc.c1.body')}
              before={t('land.uc.c1.before')}
              after={t('land.uc.c1.after')}
            />
            <UseCaseCard
              icon={Smartphone}
              audience={t('land.uc.c2.tag')}
              hook={t('land.uc.c2.title')}
              body={t('land.uc.c2.body')}
              before={t('land.uc.c2.before')}
              after={t('land.uc.c2.after')}
            />
            <UseCaseCard
              icon={MessageSquare}
              audience={t('land.uc.c3.tag')}
              hook={t('land.uc.c3.title')}
              body={t('land.uc.c3.body')}
              before={t('land.uc.c3.before')}
              after={t('land.uc.c3.after')}
            />
          </div>
        </div>
      </section>

      {/* ─── TESTIMONIALS — ink ───────────────────────────────── */}
      <section className="surface-ink py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <Eyebrow index="07" className="mb-3 text-[#A99F92]">{t('land.test.eyebrow')}</Eyebrow>
            <h2 className="font-brandDisplay text-3xl sm:text-5xl font-bold tracking-[-0.03em]">
              {t('land.test.title')}
            </h2>
          </div>

          {testimonials.length > 0 ? (
            <div className="grid md:grid-cols-3 gap-5">
              {testimonials.slice(0, 6).map((item) => (
                <Testimonial
                  key={item.id}
                  name={item.displayName}
                  role={item.role ?? 'RanksUp user'}
                  company={item.company ?? ''}
                  avatar={item.initials}
                  metric={item.metric ?? `${item.rating}/5`}
                  quote={item.body}
                />
              ))}
            </div>
          ) : (
            /* Henüz onaylı yorum yok — kısa placeholder */
            <div className="rounded-2xl border border-dashed border-bone/20 bg-ink-2 p-12 text-center max-w-2xl mx-auto">
              <div className="flex justify-center mb-3"><StepMotif size={32} steps={4} className="text-bone" /></div>
              <p className="text-sm text-[#A99F92]">
                {t('land.test.empty')}
              </p>
            </div>
          )}

          {/* Aggregate stat */}
          {testimonials.length > 0 && (
            <div className="mt-12 flex items-center justify-center gap-2 text-sm">
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className={`h-5 w-5 ${i <= Math.round(testimonials.reduce((s, t) => s + t.rating, 0) / testimonials.length) ? 'fill-brand-400 text-brand-400' : 'text-bone/25'}`} />
                ))}
              </div>
              <span className="font-bold tabular-nums">
                {(testimonials.reduce((s, t) => s + t.rating, 0) / testimonials.length).toFixed(1)} / 5.0
              </span>
              <span className="text-[#A99F92]">— {testimonials.length}+ ekipten</span>
            </div>
          )}
        </div>
      </section>

      {/* ─── PRICING — bone ───────────────────────────────────── */}
      <section id="fiyat" className="bg-bone text-ink dark:bg-ink-2 dark:text-bone py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <Eyebrow index="08" className="mb-3">{t('land.pricing.eyebrow')}</Eyebrow>
            <h2 className="font-brandDisplay text-3xl sm:text-5xl font-bold tracking-[-0.03em]">
              {t('land.pricing.title')}
            </h2>
            <p className="mt-3 text-[#6E6259] dark:text-[#A99F92] text-lg">
              {t('land.pricing.subtitle')}
            </p>
          </div>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-3 mb-12">
            <button
              onClick={() => setBilling('monthly')}
              className={`px-4 py-2 rounded-[10px] text-sm font-semibold transition ${
                billing === 'monthly' ? 'bg-ink text-bone dark:bg-bone dark:text-ink' : 'text-[#6E6259] dark:text-[#A99F92] hover:text-ink dark:hover:text-bone'
              }`}
            >
              {t('land.pric.monthly')}
            </button>
            <button
              onClick={() => setBilling('annual')}
              className={`px-4 py-2 rounded-[10px] text-sm font-semibold transition relative ${
                billing === 'annual' ? 'bg-ink text-bone dark:bg-bone dark:text-ink' : 'text-[#6E6259] dark:text-[#A99F92] hover:text-ink dark:hover:text-bone'
              }`}
            >
              {t('land.pric.annual')}
              <span className="absolute -top-3 -right-3 text-[10px] bg-[#3E9B4F] text-white px-1.5 py-0.5 rounded-full font-bold">
                {t('land.pric.discount_badge')}
              </span>
            </button>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-7xl mx-auto">
            {plans.filter((p) => p.id !== 'trial').map((p) => {
              const monthlyEq = billing === 'annual' ? Math.round(p.annual / 12) : p.monthly;
              // TL karsiligi bilgi amacli — tahsilat odeme anindaki kurla yapilir
              const monthlyEqTry = billing === 'annual' ? Math.round((p.annualTry ?? 0) / 12) : (p.monthlyTry ?? 0);
              // Plan name'i locale'e gore secelim (API'den TR olarak gelir)
              const planNameKey = `land.pric.plan_${p.id}`;
              const localizedName = t(planNameKey as Parameters<typeof t>[0]);
              const finalName = localizedName === planNameKey ? p.name : localizedName;
              const sitesLabel = typeof p.sites === 'number'
                ? (p.sites === 1 ? `${p.sites} ${t('land.pric.bullet_site')}` : `${p.sites} ${t('land.pric.bullet_sites')}`)
                : t('land.pric.bullet_sites');
              return (
                <PriceCard
                  key={p.id}
                  name={finalName}
                  price={p.contactSales ? t('land.pric.enterprise_label') : `$${monthlyEq.toLocaleString('en-US')}`}
                  period={p.contactSales ? '' : t('land.pric.per_month')}
                  annualNote={p.contactSales
                    ? ''
                    : billing === 'annual'
                      ? `${t('land.pric.annual_billed_prefix')} $${p.annual.toLocaleString('en-US')} ${t('land.pric.annual_billed_suffix')}`
                        + (p.annualTry ? ` (≈ ₺${p.annualTry.toLocaleString('tr-TR')})` : '')
                      : monthlyEqTry
                        ? `≈ ₺${monthlyEqTry.toLocaleString('tr-TR')} / ${t('land.pric.per_month')}`
                        : t('land.pric.monthly_billed')}
                  bullets={[
                    `${p.articlesPerMonth} ${t('land.pric.bullet_articles')}`,
                    `${p.socialPostsPerMonth} ${t('land.pric.bullet_posts')}`,
                    sitesLabel,
                    `${t('land.pric.bullet_support')} ${p.support}`,
                  ]}
                  cta={p.contactSales ? t('land.pric.cta_contact') : t('land.pric.cta_free')}
                  href="/pricing"
                  highlighted={!!p.popular}
                  onCtaClick={() => trackCta('pricing_cta', { planId: p.id, billing })}
                />
              );
            })}
          </div>

          <p className="text-center mt-8 text-sm text-[#6E6259] dark:text-[#A99F92]">
            {t('land.pric.footer_note')}
          </p>
        </div>
      </section>

      {/* ─── SOCIAL PROOF / METRICS — ink ────────────────────── */}
      <section className="surface-ink py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="font-brandDisplay text-3xl md:text-4xl font-extrabold tabular-nums"><AnimatedNumber raw="10dk" /></div>
              <div className="mt-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#A99F92]">{t('land.stats.setup')}</div>
            </div>
            <div>
              <div className="font-brandDisplay text-3xl md:text-4xl font-extrabold tabular-nums"><AnimatedNumber raw="35+" /></div>
              <div className="mt-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#A99F92]">{t('land.stats.integrations')}</div>
            </div>
            <div>
              <div className="font-brandDisplay text-3xl md:text-4xl font-extrabold tabular-nums"><AnimatedNumber raw="240+" /></div>
              <div className="mt-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#A99F92]">{t('land.stats.team')}</div>
            </div>
            <div>
              <div className="font-brandDisplay text-3xl md:text-4xl font-extrabold tabular-nums"><AnimatedNumber raw="%99.9" /></div>
              <div className="mt-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#A99F92]">{t('land.stats.uptime')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FAQ — bone ───────────────────────────────────────── */}
      <section id="sss" className="bg-bone text-ink dark:bg-ink-2 dark:text-bone py-24">
        {/* FAQPage schema — AI'lar bunu cevap kaynağı olarak çok kullanır */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: getFaqs(t).map((q) => ({
                '@type': 'Question',
                name: q.q,
                acceptedAnswer: { '@type': 'Answer', text: q.a },
              })),
            }),
          }}
        />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <Eyebrow index="09" className="mb-3">{t('land.faq.eyebrow')}</Eyebrow>
            <h2 className="font-brandDisplay text-3xl sm:text-4xl font-bold tracking-[-0.03em]">{t('land.faq.title')}</h2>
          </div>

          <div className="space-y-3">
            {getFaqs(t).map((q, i) => (
              <FaqItem
                key={i}
                question={q.q}
                answer={q.a}
                open={openFaq === i}
                onToggle={() => setOpenFaq(openFaq === i ? null : i)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA — ink + grafik kağıdı ─────────────────── */}
      <section className="relative overflow-hidden surface-ink grid-paper py-24">
        <div aria-hidden className="pointer-events-none absolute top-8 right-8 hidden md:block">
          <StepMotif size={56} steps={5} className="text-bone" />
        </div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-brandDisplay text-4xl sm:text-6xl font-extrabold tracking-[-0.04em] leading-[1.02]">
            {t('land.cta.title')}
          </h2>
          <p className="mt-6 text-lg text-[#A99F92] max-w-2xl mx-auto">
            {t('land.cta.subtitle')}
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/signin?signup=1"
              onClick={() => trackCta('final_primary')}
              className="btn-brand h-14 px-8 text-base w-full sm:w-auto"
            >
              {t('land.cta.button')} <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/pricing"
              onClick={() => trackCta('final_secondary_pricing')}
              className="inline-flex h-14 items-center justify-center rounded-[10px] border border-bone/20 px-8 text-base font-semibold text-bone transition-colors hover:border-bone/40 w-full sm:w-auto"
            >
              {t('land.cta.secondary')}
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-[#A99F92]">
            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-[#3E9B4F]" /> SOC-2 uyumlu</span>
            <span className="inline-flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-[#3E9B4F]" /> %99.9 uptime</span>
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-[#3E9B4F]" /> 7/24 izleme</span>
          </div>
        </div>
      </section>

      {/* ─── FOOTER — ink ─────────────────────────────────────── */}
      <footer className="surface-ink border-t border-bone/10 py-12 text-sm text-[#A99F92]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-4 gap-8">
          <div>
            <Link href="/" className="flex items-center">
              <BrandWordmark size={20} reversed />
            </Link>
            <p className="mt-3 text-xs leading-relaxed">
              {t('land.footer.tagline')}
            </p>
          </div>
          <FooterCol title={t('land.footer.product')} links={[
            [t('land.nav.solution'), '#cozum'], [t('land.nav.pricing'), '/pricing'], ['Use Cases', '/use-cases'], ['Compare', '/compare'],
          ]} />
          <FooterCol title={t('land.footer.company')} links={[
            ['About', '/about'], ['Help', '/help'], [t('land.nav.faq'), '/faq'], ['Status', '/status'],
          ]} />
          <FooterCol title={t('land.footer.legal')} links={[
            ['Privacy', '/privacy'], ['Terms', '/terms'], ['KVKK', '/kvkk'],
          ]} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-10 pt-6 border-t border-bone/10 text-xs flex flex-wrap justify-between gap-3">
          <span>© {new Date().getFullYear()} RanksUp. {t('land.footer.rights')}.</span>
          <span>Made with ❤️ in Türkiye</span>
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Product Preview (dashboard mockup — hero altına, ink zemin)
// ─────────────────────────────────────────────────────────────

function ProductPreview() {
  return (
    <div className="relative">
      {/* Browser chrome — flat, 1px border */}
      <div className="rounded-2xl border border-bone/[0.12] bg-ink-2 overflow-hidden">
        {/* Top bar — sahte tarayıcı */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-bone/10 bg-bone/5">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-bone/15" />
            <span className="h-3 w-3 rounded-full bg-bone/15" />
            <span className="h-3 w-3 rounded-full bg-bone/15" />
          </div>
          <div className="flex-1 mx-3 px-3 py-1 rounded-md bg-ink border border-bone/10 text-[11px] font-mono text-[#A99F92] text-center">
            ranksup.ai/sites/kobipratik
          </div>
          <div className="hidden sm:flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A99F92]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#3E9B4F] animate-pulse" />
            CANLI
          </div>
        </div>

        {/* Dashboard içeriği */}
        <div className="grid lg:grid-cols-[1fr_320px] gap-0">
          {/* Sol: ana içerik */}
          <div className="p-5 space-y-4">
            {/* Top stat strip */}
            <div className="grid grid-cols-4 gap-2">
              <MiniStat label="AI Citation" value="47" delta="+12" deltaColor="emerald" />
              <MiniStat label="ASO Skor" value="78" delta="+5" deltaColor="emerald" />
              <MiniStat label="ASA CPI" value="$0.42" delta="-23%" deltaColor="emerald" />
              <MiniStat label="Post" value="124" delta="+18" deltaColor="emerald" />
            </div>

            {/* Citation chart */}
            <div className="rounded-xl border border-bone/10 bg-ink p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-semibold">AI Görünürlük (30 gün)</div>
                  <div className="text-[10px] text-[#A99F92]">ChatGPT, Claude, Gemini, Perplexity</div>
                </div>
                <div className="flex gap-1 text-[10px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-bone/10 text-[#A99F92]">7g</span>
                  <span className="px-2 py-0.5 rounded bg-brand/20 text-brand-400 font-semibold">30g</span>
                  <span className="px-2 py-0.5 rounded bg-bone/10 text-[#A99F92]">90g</span>
                </div>
              </div>
              <CitationChart />
              <div className="mt-2 flex items-center gap-3 text-[10px] text-[#A99F92]">
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 bg-[#E04E24]" /> ChatGPT</span>
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 bg-[#8A8177]" /> Claude</span>
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 bg-[#C9BFB2]" /> Gemini</span>
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 bg-[#6E6259]" /> Perplexity</span>
              </div>
            </div>

            {/* ASO + ASA grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* ASO Keywords */}
              <div className="rounded-xl border border-bone/10 bg-ink p-4">
                <div className="text-xs font-semibold mb-3">App Store sıralama</div>
                <div className="space-y-2 text-[11px]">
                  <KeywordRow kw="ön muhasebe" rank={3} delta={5} />
                  <KeywordRow kw="kobi kredisi" rank={8} delta={2} />
                  <KeywordRow kw="esnaf finansman" rank={12} delta={-1} />
                  <KeywordRow kw="ticari pos" rank={23} delta={7} />
                </div>
              </div>

              {/* ASA Perf */}
              <div className="rounded-xl border border-bone/10 bg-ink p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-semibold">Apple Search Ads</div>
                  <span className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] px-1.5 py-0.5 rounded bg-[#3E9B4F]/15 text-[#3E9B4F]">Auto-Pilot</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <MiniBox label="Gösterim" value="12.4K" />
                  <MiniBox label="Tıklama" value="487" />
                  <MiniBox label="İndirme" value="62" />
                  <MiniBox label="Harcama" value="$26" />
                </div>
                <div className="mt-2 text-[10px] text-[#A99F92]">
                  Son 7 gün · CR %12.7
                </div>
              </div>
            </div>
          </div>

          {/* Sağ: live activity feed */}
          <div className="border-t lg:border-t-0 lg:border-l border-bone/10 bg-bone/[0.03] p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3E9B4F] animate-pulse" />
              <div className="text-xs font-semibold">Canlı aktivite</div>
            </div>
            <div className="space-y-3 text-[11px]">
              <FeedItem time="şimdi" icon="📈" text="Sıralaman yükseldi: 'ön muhasebe' #8 → #3" />
              <FeedItem time="2dk" icon="🤖" text="Auto-Pilot 3 yeni keyword ekledi" />
              <FeedItem time="14dk" icon="✍️" text="AI yeni makale üretti: 'KOBİ vergi takvimi 2026'" />
              <FeedItem time="42dk" icon="🚀" text="LinkedIn'de yayınlandı (267 görüntüleme)" />
              <FeedItem time="1s" icon="⚡" text="ASA bid optimize edildi: $0.50 → $0.38" />
              <FeedItem time="2s" icon="🎯" text="ChatGPT'de marka mentionı +1" />
              <FeedItem time="3s" icon="📊" text="Günlük rank check tamamlandı (50 kw)" />
            </div>
          </div>
        </div>
      </div>

      {/* Floating UI badges (cosmetic — flat) */}
      <div className="hidden lg:block absolute -top-4 -left-4 px-3 py-1.5 rounded-full bg-ink-2 border border-bone/15 text-[11px] font-semibold text-bone">
        <span className="text-[#3E9B4F]">●</span> 247 keyword izleniyor
      </div>
      <div className="hidden lg:block absolute -bottom-4 -right-4 px-3 py-1.5 rounded-full bg-ink-2 border border-bone/15 text-[11px] font-semibold text-bone">
        🤖 Auto-Pilot aktif
      </div>
    </div>
  );
}

function MiniStat({ label, value, delta, deltaColor }: { label: string; value: string; delta: string; deltaColor: 'emerald' | 'rose' }) {
  const colorClass = deltaColor === 'emerald' ? 'text-[#3E9B4F]' : 'text-[#C43C2E]';
  return (
    <div className="rounded-lg border border-bone/10 bg-ink p-2.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#A99F92]">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="font-brandDisplay text-base font-bold tabular-nums">{value}</span>
        <span className={`text-[10px] font-semibold tabular-nums ${colorClass}`}>{delta}</span>
      </div>
    </div>
  );
}

function CitationChart() {
  // 4 line chart — mock points (birincil: turuncu; diğer seriler: taş tonları)
  const lines = [
    { color: '#E04E24', points: [30, 28, 35, 32, 40, 45, 42, 50, 55, 58, 62, 70] },     // ChatGPT
    { color: '#8A8177', points: [22, 25, 28, 30, 32, 35, 38, 42, 45, 48, 52, 55] },     // Claude
    { color: '#C9BFB2', points: [18, 20, 19, 24, 26, 28, 30, 32, 34, 36, 38, 40] },     // Gemini
    { color: '#6E6259', points: [12, 14, 15, 17, 19, 22, 24, 26, 28, 30, 32, 35] },     // Perplexity
  ];
  const w = 500, h = 110, max = 80;
  const path = (pts: number[]) => {
    const step = w / (pts.length - 1);
    return pts.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (y / max) * h).toFixed(1)}`).join(' ');
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[110px]">
      <defs>
        <linearGradient id="g-brand" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#E04E24" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#E04E24" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* horizontal grid — grafik kağıdı dili */}
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
        <line key={i} x1="0" x2={w} y1={p * h} y2={p * h} stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
      ))}
      {/* area fill under ChatGPT line */}
      <path d={`${path(lines[0].points)} L${w},${h} L0,${h} Z`} fill="url(#g-brand)" />
      {/* lines */}
      {lines.map((l, i) => (
        <path key={i} d={path(l.points)} fill="none" stroke={l.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

function KeywordRow({ kw, rank, delta }: { kw: string; rank: number; delta: number }) {
  const up = delta > 0;
  return (
    <div className="flex items-center justify-between">
      <span className="truncate text-bone/80">{kw}</span>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-bold tabular-nums">#{rank}</span>
        <span className={`text-[10px] font-semibold tabular-nums ${up ? 'text-[#3E9B4F]' : 'text-[#C43C2E]'}`}>
          {up ? '↑' : '↓'}{Math.abs(delta)}
        </span>
      </div>
    </div>
  );
}

function MiniBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-bone/5 border border-bone/10 px-2 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#A99F92]">{label}</div>
      <div className="font-brandDisplay font-bold text-sm tabular-nums">{value}</div>
    </div>
  );
}

function FeedItem({ time, icon, text }: { time: string; icon: string; text: string }) {
  return (
    <div className="flex gap-2.5">
      <span className="text-base leading-none mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="leading-snug text-bone/85">{text}</div>
        <div className="font-mono text-[9px] text-[#A99F92] mt-0.5">{time}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────

function PainCard({ cost, title, body }: { cost: string; title: string; body: string }) {
  return (
    <div className="p-6 rounded-2xl border border-bone/10 bg-ink-2 transition-colors hover:border-[#C43C2E]/40">
      <div className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#C43C2E] mb-2">{cost}</div>
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <p className="text-sm text-[#A99F92] leading-relaxed">{body}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon, tag, title, body, bullets,
}: {
  icon: any; tag: string; title: string; body: string; bullets: string[];
}) {
  return (
    <div className="card-brand p-7 transition-colors hover:border-brand/40">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-11 w-11 rounded-[10px] bg-brand/10 grid place-items-center">
          <Icon className="h-5 w-5 text-brand" />
        </div>
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-brand dark:text-brand-400">{tag}</span>
      </div>
      <h3 className="text-xl font-bold mb-2">{title}</h3>
      <p className="text-sm text-[#6E6259] dark:text-[#A99F92] leading-relaxed mb-4">{body}</p>
      <ul className="space-y-1.5">
        {bullets.map((b, i) => (
          <li key={i} className="text-sm flex items-start gap-2">
            {/* Basamak bullet — kare */}
            <span className="mt-[7px] h-2 w-2 shrink-0 bg-brand" aria-hidden="true" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepCard({ n, title, body, icon: Icon }: { n: number; title: string; body: string; icon: any }) {
  return (
    <div className="relative p-7 rounded-2xl border border-bone/10 bg-ink-2 overflow-hidden">
      <div className="absolute -top-3 right-3 font-brandDisplay text-7xl font-extrabold text-bone/[0.06] leading-none select-none tabular-nums">
        {n}
      </div>
      <div className="relative">
        <div className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-brand-400 mb-3">0{n}</div>
        <Icon className="h-7 w-7 text-brand-400 mb-3" />
        <h3 className="text-lg font-bold mb-2">{title}</h3>
        <p className="text-sm text-[#A99F92] leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function StatCard({ num, label, sub }: { num: string; label: string; sub: string }) {
  return (
    <div className="card-brand p-8 text-center">
      {/* Veri dili: dev sayı (Sora 800, tabular-nums) + mono uppercase label */}
      <div className="font-brandDisplay text-5xl md:text-6xl font-extrabold leading-none tracking-[-0.03em] tabular-nums text-brand dark:text-brand-400">
        <AnimatedNumber raw={num} />
      </div>
      <div className="mt-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em]">{label}</div>
      <div className="text-xs text-[#6E6259] dark:text-[#A99F92] mt-1">{sub}</div>
    </div>
  );
}

/** Scroll'da viewport'a girince 0'dan hedefe animate eden sayı.
 *  raw "+%47" / "-%62" / "10x" gibi format'ı korur, sadece sayıyı animate eder. */
function AnimatedNumber({ raw }: { raw: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  const match = raw.match(/-?[\d.]+/);
  const target = match ? parseFloat(match[0]) : 0;
  const prefix = match ? raw.slice(0, match.index!) : '';
  const suffix = match ? raw.slice(match.index! + match[0].length) : raw;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let started = false;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !started) {
          started = true;
          const start = performance.now();
          const dur = 1400;
          const tick = (t: number) => {
            const p = Math.min(1, (t - start) / dur);
            // easeOutCubic
            const eased = 1 - Math.pow(1 - p, 3);
            setVal(target * eased);
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);

  // integer ise yuvarla, ondalık varsa 1 basamak
  const isInt = Number.isInteger(target);
  const displayed = isInt ? Math.round(val).toString() : val.toFixed(1);
  return <span ref={ref}>{prefix}{displayed}{suffix}</span>;
}

function AuthorityBadge({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-ink/10 bg-paper dark:border-bone/[0.12] dark:bg-ink text-[11px] font-semibold">
      <Icon className="h-3.5 w-3.5 text-brand" />
      <span>{text}</span>
    </div>
  );
}

function Testimonial({
  name, role, company, avatar, metric, quote,
}: {
  name: string; role: string; company: string;
  avatar: string; metric: string; quote: string;
}) {
  return (
    <div className="p-7 rounded-2xl border border-bone/10 bg-ink-2 flex flex-col transition-colors hover:border-brand/40">
      {/* Stars */}
      <div className="flex gap-0.5 mb-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className="h-4 w-4 fill-brand-400 text-brand-400" />
        ))}
      </div>
      {/* Quote */}
      <p className="text-sm leading-relaxed flex-1 mb-5 text-bone/90">"{quote}"</p>
      {/* Metric badge */}
      <div className="mb-5 inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#3E9B4F]/15 text-[#3E9B4F] text-[11px] font-bold">
        <TrendingUp className="h-3 w-3" /> {metric}
      </div>
      {/* Author */}
      <div className="flex items-center gap-3 pt-4 border-t border-bone/10">
        <div className="h-10 w-10 rounded-full bg-brand text-paper grid place-items-center font-bold text-sm shrink-0">
          {avatar}
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm">{name}</div>
          <div className="text-[11px] text-[#A99F92] truncate">{role} · {company}</div>
        </div>
      </div>
    </div>
  );
}

function CompareRow({ row }: { row: [string, ...boolean[]] }) {
  const [label, ...vals] = row;
  return (
    <tr className="border-t border-bone/10">
      <td className="p-4 font-medium">{label}</td>
      {vals.map((v, i) => (
        <td key={i} className={`p-4 text-center ${i === vals.length - 1 ? 'bg-brand/10' : ''}`}>
          {v ? <Check className="h-4 w-4 text-[#3E9B4F] inline" /> : <XIcon className="h-4 w-4 text-bone/25 inline" />}
        </td>
      ))}
    </tr>
  );
}

function UseCaseCard({
  icon: Icon, audience, hook, body, before, after,
}: {
  icon: any; audience: string; hook: string; body: string; before: string; after: string;
}) {
  return (
    <div className="card-brand p-7 transition-colors hover:border-brand/40">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-5 w-5 text-brand" />
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-brand dark:text-brand-400">{audience}</span>
      </div>
      <h3 className="text-lg font-bold mb-2">{hook}</h3>
      <p className="text-sm text-[#6E6259] dark:text-[#A99F92] leading-relaxed mb-5">{body}</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-3 rounded-lg bg-ink/5 dark:bg-bone/5">
          <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#6E6259] dark:text-[#A99F92] mb-1">Önce</div>
          <div className="font-semibold">{before}</div>
        </div>
        <div className="p-3 rounded-lg bg-brand/10">
          <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-brand dark:text-brand-400 mb-1">Sonra</div>
          <div className="font-semibold">{after}</div>
        </div>
      </div>
    </div>
  );
}

function PriceCard({
  name, price, period, annualNote, bullets, cta, href, highlighted, onCtaClick,
}: {
  name: string; price: string; period: string; annualNote: string;
  bullets: string[]; cta: string; href: string; highlighted?: boolean;
  onCtaClick?: () => void;
}) {
  return (
    <div className={`relative card-brand p-7 flex flex-col ${highlighted ? 'border-brand' : ''}`}>
      {highlighted && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full font-mono text-[10px] font-medium uppercase tracking-[0.14em] bg-brand text-paper whitespace-nowrap">
          En Çok Tercih Edilen
        </div>
      )}
      <h3 className="text-lg font-bold">{name}</h3>
      <div className="mt-4 mb-1">
        <span className="font-brandDisplay text-4xl font-extrabold tabular-nums">{price}</span>
        <span className="text-[#6E6259] dark:text-[#A99F92] text-sm">{period}</span>
      </div>
      <p className="text-xs text-[#6E6259] dark:text-[#A99F92] min-h-[16px]">{annualNote}</p>
      <ul className="space-y-2 text-sm mt-5 mb-6 flex-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2">
            {/* Basamak bullet — kare */}
            <span className="mt-[7px] h-2 w-2 shrink-0 bg-brand" aria-hidden="true" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <Link
        href={href}
        onClick={onCtaClick}
        className={`${highlighted ? 'btn-brand' : 'btn-brand-outline'} w-full`}
      >
        {cta}
      </Link>
    </div>
  );
}

function FaqItem({ question, answer, open, onToggle }: { question: string; answer: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="card-brand overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-5 flex items-center justify-between text-left hover:bg-ink/[0.03] dark:hover:bg-bone/5 transition"
      >
        <span className="font-semibold">{question}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-[#6E6259] dark:text-[#A99F92] leading-relaxed border-t border-ink/10 dark:border-bone/10 pt-4">
          {answer}
        </div>
      )}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="font-semibold text-bone mb-3">{title}</h4>
      <ul className="space-y-2 text-xs">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="hover:text-bone transition">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function getFaqs(t: ReturnType<typeof useT>['t']): Array<{ q: string; a: string }> {
  return [
    { q: t('land.faq.q1'), a: t('land.faq.a1') },
    { q: t('land.faq.q2'), a: t('land.faq.a2') },
    { q: t('land.faq.q3'), a: t('land.faq.a3') },
    { q: t('land.faq.q4'), a: t('land.faq.a4') },
    { q: t('land.faq.q5'), a: t('land.faq.a5') },
    { q: t('land.faq.q6'), a: t('land.faq.a6') },
  ];
}
