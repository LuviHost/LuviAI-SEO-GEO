'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { api } from '@/lib/api';
import { trackPageview, trackCta, setupScrollDepthTracking, setupSectionTracking } from '@/lib/landing-track';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import { BrandLogo } from '@/components/brand-logo';
import {
  Sparkles, ArrowRight, Check, X as XIcon, ChevronDown,
  Rocket, Search, Smartphone, Wand2, Bot, Star,
  TrendingUp, Zap, ShieldCheck, Clock, BarChart3, Globe,
  PlayCircle, MousePointer2, MessageSquare, FileText, Apple,
  Lock, Cpu, Cloud, BadgeCheck,
} from 'lucide-react';

// ───────────────────────────────────────────────────────────────
//  LuviAI — Landing (yeni, dönüşüm odaklı)
//  AIDA + PAS + Risk Reversal · brand orange · plan verisi /api/billing/plans'tan
// ───────────────────────────────────────────────────────────────

type Plan = {
  id: string;
  name: string;
  monthly: number;
  annual: number;
  currency: string;
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

const AVATAR_BGS = [
  'from-orange-500 to-rose-500',
  'from-orange-400 to-amber-500',
  'from-orange-500 to-purple-500',
  'from-amber-400 to-orange-500',
  'from-rose-400 to-orange-500',
  'from-orange-600 to-amber-600',
];

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
  const [plans, setPlans] = useState<Plan[]>([]);
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [testimonials, setTestimonials] = useState<PublicTestimonial[]>([]);

  useEffect(() => {
    api.getPlans('tr').then((p) => setPlans(p ?? [])).catch(() => {});
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
            url: 'https://ai.luvihost.com/',
            name: 'LuviAI — Senin yerine pazarlama yapan AI',
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
              name: 'LuviAI',
              url: 'https://ai.luvihost.com/',
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

      {/* ─── NAV (Apple-grade glassmorphic) ──────────────────── */}
      <nav className="sticky top-0 z-50 nav-blur">
        <div className="container-apple h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em]">
            <BrandLogo size={26} className="rounded-md" />
            <span>LuviAI</span>
          </Link>
          <div className="hidden md:flex items-center gap-9 text-[13px] text-neutral-600 dark:text-neutral-300">
            <a href="#cozum" className="hover:text-foreground transition-colors duration-300 ease-apple">Çözüm</a>
            <a href="#nasil" className="hover:text-foreground transition-colors duration-300 ease-apple">Nasıl çalışır</a>
            <a href="#sonuc" className="hover:text-foreground transition-colors duration-300 ease-apple">Sonuçlar</a>
            <a href="#fiyat" className="hover:text-foreground transition-colors duration-300 ease-apple">Fiyat</a>
            <a href="#sss" className="hover:text-foreground transition-colors duration-300 ease-apple">SSS</a>
          </div>
          <div className="flex items-center gap-1.5">
            <LocaleSwitch />
            <ThemeToggle />
            <Link href="/signin" className="hidden sm:inline-flex items-center px-3 h-9 text-[13px] text-neutral-600 dark:text-neutral-300 hover:text-foreground transition-colors duration-300 ease-apple">
              Giriş
            </Link>
            <Link href="/signin?signup=1" className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-foreground text-background text-[13px] font-medium transition-all duration-300 ease-apple hover:scale-[1.03] active:scale-[0.97] shadow-apple">
              Ücretsiz başla
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── HERO (Apple-grade massive type + mesh) ──────────── */}
      <section className="relative section-padding overflow-hidden">
        {/* Multi-layer gradient mesh + noise — premium background */}
        <div className="absolute inset-0 -z-10 bg-mesh-warm opacity-90 pointer-events-none" />
        <div className="absolute inset-0 -z-10 bg-noise opacity-[0.04] pointer-events-none" />
        {/* Subtle radial glow at top */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[120vw] h-[60vh] -z-10 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-200/30 via-brand-50/10 to-transparent dark:from-brand-900/20 dark:via-transparent blur-3xl" />
        </div>

        <div className="container-apple text-center stagger-reveal">
          {/* Eyebrow */}
          <div className="flex items-center justify-center mb-7">
            <div className="inline-flex items-center gap-2.5 px-4 h-8 rounded-full border border-neutral-200/80 dark:border-neutral-700/60 bg-background/60 backdrop-blur-sm text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-500" />
              </span>
              AI · ASO · Sosyal · Studio — hepsi tek panelde
            </div>
          </div>

          {/* Massive Apple-grade headline */}
          <h1 className="hero-headline text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.75rem,8vw,7rem)] leading-[0.96]">
            <span>Senin yerine</span>
            <br />
            <span>pazarlama yapan </span>
            <span className="font-display italic text-[1.05em] bg-gradient-to-br from-brand-500 via-rose-500 to-amber-500 bg-clip-text text-transparent">AI</span>
            <span>.</span>
          </h1>

          {/* Refined sub-headline */}
          <p className="hero-subtitle text-pretty mt-8 mx-auto max-w-[640px] text-[clamp(1.0625rem,1.6vw,1.375rem)] leading-[1.5] text-neutral-600 dark:text-neutral-400">
            Site, mobil app, sosyal medya — hepsi tek panelden. LuviAI siteni tarar, eksikleri bulur, içeriği üretir, App Store reklamını optimize eder.
          </p>

          {/* Apple-grade CTAs */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/signin?signup=1" onClick={() => trackCta('hero_primary')} className="btn-apple-primary group">
              Ücretsiz başla — kart gerekmez
              <ArrowRight className="h-4 w-4 transition-transform duration-300 ease-apple group-hover:translate-x-0.5" />
            </Link>
            <a href="#nasil" onClick={() => trackCta('hero_secondary_demo')} className="btn-apple-ghost group">
              <PlayCircle className="h-4 w-4" /> Nasıl çalışır (2dk)
            </a>
          </div>

          {/* Risk reversal — minimal Apple style */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] text-neutral-500 dark:text-neutral-400">
            <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-brand-500" /> Kart istenmez</span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-brand-500" /> 2 makale ücretsiz</span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-brand-500" /> İstediğin zaman iptal</span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-brand-500" /> 5 dakikada kurulum</span>
          </div>
        </div>

        {/* ─── Live Product Preview — Apple "device showcase" pattern ─── */}
        <div className="container-apple mt-20 lg:mt-24 animate-scale-in">
          <div className="relative">
            {/* Subtle glow behind product */}
            <div className="absolute inset-x-0 -inset-y-8 -z-10 bg-gradient-to-b from-brand-200/20 via-transparent to-transparent dark:from-brand-900/20 blur-3xl pointer-events-none" />
            <ProductPreview />
          </div>
        </div>

        {/* Authority + integrations — minimalist Apple "tech specs" bar */}
        <div className="container-apple mt-24 lg:mt-28">
          {/* Authority badges (toned-down, monochrome) */}
          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3 mb-12 text-[12px] text-neutral-500 dark:text-neutral-400">
            <span className="inline-flex items-center gap-1.5"><Apple className="h-3.5 w-3.5" /> Apple Search Ads Open API Partner</span>
            <span className="hidden sm:inline text-neutral-300 dark:text-neutral-700">·</span>
            <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> OpenAI · Anthropic · Google Cloud</span>
            <span className="hidden sm:inline text-neutral-300 dark:text-neutral-700">·</span>
            <span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> AES-256 · TLS 1.3</span>
            <span className="hidden sm:inline text-neutral-300 dark:text-neutral-700">·</span>
            <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-3.5 w-3.5" /> KVKK · TR sunucu</span>
            <span className="hidden sm:inline text-neutral-300 dark:text-neutral-700">·</span>
            <span className="inline-flex items-center gap-1.5"><Cloud className="h-3.5 w-3.5" /> %99.9 SLA</span>
          </div>

          {/* AI Provider logo wall — refined */}
          <p className="text-eyebrow text-neutral-400 dark:text-neutral-500 text-center mb-6">
            Markanı her major AI platformunda izle
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-9 gap-y-5 mb-12">
            {(['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'grok', 'deepseek', 'mistral'] as VendorName[]).map((v) => (
              <div key={v} className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity duration-300 ease-apple">
                <VendorLogo name={v} size={22} />
                <span className="text-[13px] font-medium tracking-[-0.005em]">{AI_LABELS[v] ?? v}</span>
              </div>
            ))}
          </div>

          {/* Integrations — even more subtle */}
          <p className="text-eyebrow text-neutral-400 dark:text-neutral-500 text-center mb-5">
            Ayrıca entegre çalıştığımız platformlar
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4 opacity-60 hover:opacity-90 transition-opacity duration-500 ease-apple">
            {(['linkedin', 'twitter', 'facebook', 'instagram', 'tiktok', 'youtube', 'google', 'wordpress', 'shopify', 'webflow'] as VendorName[]).map((v) => (
              <div key={v} className="flex items-center" title={INTEGRATION_LABELS[v] ?? v}>
                <VendorLogo name={v} size={20} />
              </div>
            ))}
            <span className="text-[11px] font-medium text-neutral-500 ml-2">+ Apple Search Ads · App Store Connect</span>
          </div>
        </div>
      </section>

      {/* ─── PAIN (PAS) — Apple-grade ─────────────────────────── */}
      <section className="section-padding border-y border-border/60 bg-neutral-50 dark:bg-neutral-950/40">
        <div className="container-apple">
          <div className="text-center mb-16 max-w-[680px] mx-auto">
            <p className="eyebrow mb-4">Tanıdık geldi mi?</p>
            <h2 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.05]">
              Pazarlama bütçen patlıyor,{' '}
              <span className="font-display italic text-[1.05em] text-neutral-500 dark:text-neutral-400">sonuç gelmiyor.</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4 lg:gap-6">
            <PainCard
              cost="₺15.000/ay"
              title="SEO ajansı"
              body="Aylar süren raporlar, belirsiz sonuç. Hangi keyword'de gerçekten ön plandasın bilmiyorsun."
            />
            <PainCard
              cost="₺25.000/ay"
              title="ASO + ASA uzmanı"
              body="iOS App Store'da rakipler 1. sırada, sen 47. sıradasın. Apple Search Ads açmaya bile cesaret edemiyorsun."
            />
            <PainCard
              cost="₺18.000/ay"
              title="5 farklı SaaS aboneliği"
              body="SEMrush + AppTweak + Hootsuite + ChatGPT + Canva. Hiçbiri konuşmuyor, hepsine ayrı para."
            />
          </div>
          <p className="text-center mt-12 text-[clamp(1rem,1.4vw,1.25rem)] text-neutral-600 dark:text-neutral-400">
            <span className="line-through text-neutral-400 dark:text-neutral-600">Toplam: ₺58.000/ay</span>
            {' → '}
            <span className="font-medium text-foreground">LuviAI: ₺799'dan başlar</span>
          </p>
        </div>
      </section>

      {/* ─── SOLUTION — Apple-grade ──────────────────────────── */}
      <section id="cozum" className="section-padding">
        <div className="container-apple">
          <div className="text-center mb-20 max-w-[760px] mx-auto">
            <p className="eyebrow mb-4">Çözüm</p>
            <h2 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.25rem,5vw,4rem)] leading-[1]">
              4 ayrı uzmana ihtiyacın yok.
              <br />
              <span className="font-display italic text-[1.08em] bg-gradient-to-br from-brand-500 via-rose-500 to-amber-500 bg-clip-text text-transparent">Hepsi tek AI panel.</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-4 lg:gap-6">
            <FeatureCard
              icon={Search}
              tag="SEO + AEO"
              title="AI'lara görünür ol"
              body="ChatGPT, Claude ve Gemini'de senin adının geçtiği yerleri gösterir. Hangi sorularda çıkmıyorsun, AI önerir, makaleyi otomatik yazar."
              bullets={['50+ keyword takibi', 'AI Citation Tracker', 'Otomatik makale üretimi', 'Çoklu yayın hedefi']}
            />
            <FeatureCard
              icon={Smartphone}
              tag="ASO + Apple Search Ads"
              title="App Store'da 1. sıraya"
              body="Mobil uygulamandaki rakip analizi, keyword sıralaması, Apple Search Ads kampanya yönetimi. Auto-Pilot, düşük performansı pause edip yenisini ekler."
              bullets={['App Store + Play Store skoru', 'AI keyword araştırması', 'ASA kampanya + bid otomasyonu', 'Auto-Pilot: kendiliğinden optimize']}
            />
            <FeatureCard
              icon={Wand2}
              tag="Sosyal Medya Studio"
              title="AI ile post, görsel, video üret"
              body="Tek konudan X / LinkedIn / Instagram için 3 farklı varyant. Sora 2, Google Veo 3, Runway ile video; DALL-E ile görsel."
              bullets={['Görsel: GPT Image / DALL-E', 'Video: Sora 2 + Veo 3 + Runway', 'Metin: GPT-5 / Claude 4', 'Çoklu kanal tek tık paylaşım']}
            />
            <FeatureCard
              icon={Bot}
              tag="Otomasyon"
              title="Auto-Pilot — sen uyurken çalışır"
              body="Haftalık AI rapor, ranking düştüğünde alarm, fırsat keyword'ler için ASA otomatik açar. Sen sadece kararı ver."
              bullets={["Günlük rank check", "Anomaly alert", "Cron'lu rapor & öneri", "Bütçe cap'lı auto-pilot"]}
            />
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS — Apple-grade ──────────────────────── */}
      <section id="nasil" className="section-padding border-y border-border/60 bg-neutral-50 dark:bg-neutral-950/40">
        <div className="container-apple max-w-[1200px]">
          <div className="text-center mb-20 max-w-[680px] mx-auto">
            <p className="eyebrow mb-4">3 adım</p>
            <h2 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.25rem,5vw,4rem)] leading-[1]">
              5 dakikada{' '}
              <span className="font-display italic text-[1.08em] text-brand-600 dark:text-brand-400">yayında.</span>
            </h2>
            <p className="mt-6 text-[clamp(1rem,1.4vw,1.25rem)] text-neutral-500 dark:text-neutral-400">
              Teknik bilgi gerekmez. Onboarding sırasında AI senin sektörünü tahmin eder, ilk içerikleri üretir.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 lg:gap-6">
            <StepCard n={1} title="Siteni bağla" body="URL'i yapıştır. LuviAI siteyi tarar, sektörünü belirler, ilk 50 keyword'ü çıkarır." icon={Globe} />
            <StepCard n={2} title="AI analiz" body="Rakiplerin metadata'sı, sıralamalar, eksik keyword'ler, AI Citation skorun — hepsi 2 dakikada." icon={Sparkles} />
            <StepCard n={3} title="Yayında" body="İlk makale, ilk sosyal post, ilk ASA önerisi hazır. Auto-Pilot açarsan sen hiçbir şey yapmazsın." icon={Rocket} />
          </div>
        </div>
      </section>

      {/* ─── RESULTS — Apple "Big Numbers" pattern ─────────── */}
      <section id="sonuc" className="section-padding">
        <div className="container-apple">
          <div className="text-center mb-20">
            <p className="eyebrow mb-4">Sonuçlar</p>
            <h2 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.25rem,5vw,4rem)] leading-[1]">
              Sayılarla{' '}
              <span className="font-display italic text-[1.08em]">LuviAI</span>{' '}
              etkisi.
            </h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-6 lg:gap-12 max-w-[1100px] mx-auto">
            <StatCard num="+%47" label="ortalama organic trafik artışı" sub="ilk 30 günde" />
            <StatCard num="-%62" label="App Store Ads CPI düşüşü" sub="Auto-Pilot 60 gün sonrası" />
            <StatCard num="10x" label="içerik üretim hızı" sub="manuel sürece kıyasla" />
          </div>
        </div>
      </section>

      {/* ─── COMPARISON — Apple "Tech Specs" table ─────────── */}
      <section className="section-padding border-y border-border/60 bg-neutral-50 dark:bg-neutral-950/40">
        <div className="container-apple max-w-[1100px]">
          <div className="text-center mb-16">
            <p className="eyebrow mb-4">Karşılaştırma</p>
            <h2 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.25rem,5vw,4rem)] leading-[1]">
              5 SaaS yerine{' '}
              <span className="font-display italic text-[1.08em] bg-gradient-to-br from-brand-500 to-rose-500 bg-clip-text text-transparent">1 LuviAI</span>.
            </h2>
            <p className="mt-6 text-[clamp(1rem,1.4vw,1.25rem)] text-neutral-500 dark:text-neutral-400">
              Şu an birden fazla araç için ödüyorsan büyük ihtimalle %80 tasarruf edersin.
            </p>
          </div>

          <div className="overflow-x-auto rounded-apple border border-border/60 bg-background shadow-apple-sm">
            <table className="w-full text-[14px]">
              <thead className="bg-neutral-50 dark:bg-neutral-950/60">
                <tr>
                  <th className="text-left p-5 text-[12px] font-medium tracking-[0.04em] uppercase text-neutral-500 dark:text-neutral-400">Özellik</th>
                  <th className="text-center p-5 text-[12px] font-medium tracking-[0.04em] uppercase text-neutral-500 dark:text-neutral-400">SEMrush</th>
                  <th className="text-center p-5 text-[12px] font-medium tracking-[0.04em] uppercase text-neutral-500 dark:text-neutral-400">AppTweak</th>
                  <th className="text-center p-5 text-[12px] font-medium tracking-[0.04em] uppercase text-neutral-500 dark:text-neutral-400">Hootsuite</th>
                  <th className="text-center p-5 text-[12px] font-medium tracking-[0.04em] uppercase text-neutral-500 dark:text-neutral-400">ChatGPT Team</th>
                  <th className="text-center p-5 text-[12px] font-medium tracking-[0.04em] uppercase bg-brand-500/[0.06] text-brand-700 dark:text-brand-400">LuviAI</th>
                </tr>
              </thead>
              <tbody>
                <CompareRow row={['Web SEO + keyword takibi', true, false, false, false, true]} />
                <CompareRow row={['AI Görünürlük (ChatGPT/Claude/Gemini)', false, false, false, false, true]} />
                <CompareRow row={['App Store + Play Store ASO', false, true, false, false, true]} />
                <CompareRow row={['Apple Search Ads yönetimi', false, false, false, false, true]} />
                <CompareRow row={['Sosyal medya post + zamanlama', false, false, true, false, true]} />
                <CompareRow row={['AI görsel + video üretimi', false, false, false, true, true]} />
                <CompareRow row={['AI makale üretimi', false, false, false, true, true]} />
                <CompareRow row={['Auto-Pilot otomasyon', false, false, false, false, true]} />
                <tr className="border-t border-border/60 bg-neutral-50 dark:bg-neutral-950/40">
                  <td className="p-5 text-[14px] font-medium">Aylık fiyat (yaklaşık)</td>
                  <td className="text-center p-5 text-neutral-500 dark:text-neutral-400">$140</td>
                  <td className="text-center p-5 text-neutral-500 dark:text-neutral-400">$200</td>
                  <td className="text-center p-5 text-neutral-500 dark:text-neutral-400">$99</td>
                  <td className="text-center p-5 text-neutral-500 dark:text-neutral-400">$60</td>
                  <td className="text-center p-5 bg-brand-500/[0.06] font-medium text-brand-700 dark:text-brand-400">₺2.499</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-center text-[12px] text-neutral-500 dark:text-neutral-400 mt-6">
            * Karşılaştırma resmi web sitelerinin Pro/Team paket fiyatlarına göre. Mayıs 2026 itibarıyla.
          </p>
        </div>
      </section>

      {/* ─── USE CASES — Apple-grade ──────────────────────── */}
      <section className="section-padding">
        <div className="container-apple">
          <div className="text-center mb-20 max-w-[760px] mx-auto">
            <p className="eyebrow mb-4">Kimler kullanıyor</p>
            <h2 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.25rem,5vw,4rem)] leading-[1]">
              Senin iş modelin için{' '}
              <span className="font-display italic text-[1.08em]">biçildi mi?</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 lg:gap-6">
            <UseCaseCard
              icon={FileText}
              audience="KOBİ + Hizmet"
              hook="Muhasebe / hukuk / danışmanlık"
              body="Hedef müşteri Google ve ChatGPT'de seni arıyor. LuviAI haftalık 3 makale yazar, Linkedin'de paylaşır, organic trafik gelir."
              before="Ayda 200 organic ziyaret"
              after="6 ay sonra ayda 4.200"
            />
            <UseCaseCard
              icon={Smartphone}
              audience="Mobil App Sahibi"
              hook="iOS / Android uygulama"
              body="App Store'da rakiplerin 'en iyi X uygulaması' aramasında 1. sırada — sen 47. Auto-Pilot ASA açar, sıralaman yükselir."
              before="Aylık 50 organic install"
              after="60 gün sonra ayda 1.800"
            />
            <UseCaseCard
              icon={MessageSquare}
              audience="E-ticaret"
              hook="Marka odaklı online satış"
              body="Instagram + TikTok + Google için içerik üretimi başına ayda 40 saat harcıyordun. LuviAI ile 4 saat."
              before="Ayda 8 post / 1 kanal"
              after="Ayda 50 post / 5 kanal"
            />
          </div>
        </div>
      </section>

      {/* ─── TESTIMONIALS — Apple-grade ──────────────────── */}
      <section className="section-padding border-y border-border/60 bg-neutral-50 dark:bg-neutral-950/40">
        <div className="container-apple">
          <div className="text-center mb-20">
            <p className="eyebrow mb-4">Kullanıcı yorumları</p>
            <h2 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.25rem,5vw,4rem)] leading-[1]">
              Ekipler{' '}
              <span className="font-display italic text-[1.08em]">ne diyor?</span>
            </h2>
          </div>

          {testimonials.length > 0 ? (
            <div className="grid md:grid-cols-3 gap-5">
              {testimonials.slice(0, 6).map((t, i) => (
                <Testimonial
                  key={t.id}
                  name={t.displayName}
                  role={t.role ?? 'LuviAI kullanıcısı'}
                  company={t.company ?? ''}
                  avatar={t.initials}
                  avatarBg={AVATAR_BGS[i % AVATAR_BGS.length]}
                  metric={t.metric ?? `${t.rating}/5 puan`}
                  quote={t.body}
                />
              ))}
            </div>
          ) : (
            /* Henüz onaylı yorum yok — kısa placeholder */
            <div className="rounded-2xl border-2 border-dashed border-border bg-card p-12 text-center max-w-2xl mx-auto">
              <Star className="h-10 w-10 text-amber-400 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                İlk müşteri yorumları toplanıyor — sen de ilk kullananlardan ol, deneyimini paylaş.
              </p>
            </div>
          )}

          {/* Aggregate stat */}
          {testimonials.length > 0 && (
            <div className="mt-12 flex items-center justify-center gap-2 text-sm">
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className={`h-5 w-5 ${i <= Math.round(testimonials.reduce((s, t) => s + t.rating, 0) / testimonials.length) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
                ))}
              </div>
              <span className="font-bold">
                {(testimonials.reduce((s, t) => s + t.rating, 0) / testimonials.length).toFixed(1)} / 5.0
              </span>
              <span className="text-muted-foreground">— {testimonials.length}+ ekipten</span>
            </div>
          )}
        </div>
      </section>

      {/* ─── PRICING — Apple-grade ────────────────────────── */}
      <section id="fiyat" className="section-padding">
        <div className="container-apple">
          <div className="text-center mb-14">
            <p className="eyebrow mb-4">Şeffaf fiyat</p>
            <h2 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.25rem,5vw,4rem)] leading-[1]">
              Bugün başla,{' '}
              <span className="font-display italic text-[1.08em] text-brand-600 dark:text-brand-400">kart sonra.</span>
            </h2>
            <p className="mt-6 text-[clamp(1rem,1.4vw,1.25rem)] text-neutral-500 dark:text-neutral-400">
              2 makale ücretsiz · İstediğin zaman iptal · Gizli ücret yok
            </p>
          </div>

          {/* Apple-style segmented control */}
          <div className="flex items-center justify-center mb-16">
            <div className="inline-flex p-1 rounded-full bg-neutral-100 dark:bg-neutral-900 border border-border/60">
              <button
                onClick={() => setBilling('monthly')}
                className={`px-5 h-9 rounded-full text-[13px] font-medium transition-all duration-300 ease-apple ${
                  billing === 'monthly' ? 'bg-background shadow-apple-sm text-foreground' : 'text-neutral-500 hover:text-foreground'
                }`}
              >
                Aylık
              </button>
              <button
                onClick={() => setBilling('annual')}
                className={`px-5 h-9 rounded-full text-[13px] font-medium transition-all duration-300 ease-apple relative ${
                  billing === 'annual' ? 'bg-background shadow-apple-sm text-foreground' : 'text-neutral-500 hover:text-foreground'
                }`}
              >
                Yıllık
                <span className="absolute -top-2 -right-2 text-[10px] bg-brand-500 text-white px-1.5 py-0.5 rounded-full font-medium">
                  −%17
                </span>
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 max-w-[1400px] mx-auto">
            {plans.filter((p) => p.id !== 'trial').map((p) => {
              const monthlyEq = billing === 'annual' ? Math.round(p.annual / 12) : p.monthly;
              return (
                <PriceCard
                  key={p.id}
                  name={p.name}
                  price={p.contactSales ? 'Özel' : `₺${monthlyEq.toLocaleString('tr-TR')}`}
                  period={p.contactSales ? '' : '/ay'}
                  annualNote={!p.contactSales && billing === 'annual' ? `Yıllık ₺${p.annual.toLocaleString('tr-TR')} faturalandırılır` : !p.contactSales ? 'Aylık faturalandırılır' : ''}
                  bullets={[
                    `${p.articlesPerMonth} AI makale / ay`,
                    `${p.socialPostsPerMonth} sosyal post / ay`,
                    `${typeof p.sites === 'number' ? p.sites : 'Sınırsız'} site`,
                    `Destek: ${p.support}`,
                  ]}
                  cta={p.contactSales ? 'Bizimle iletişime geç' : 'Ücretsiz başla'}
                  href={p.contactSales ? '/pricing' : '/signin?signup=1'}
                  highlighted={!!p.popular}
                  onCtaClick={() => trackCta('pricing_cta', { planId: p.id, billing })}
                />
              );
            })}
          </div>

          <p className="text-center mt-8 text-sm text-muted-foreground">
            Hepsinde: tüm AI modüller · Apple Search Ads · 10+ yayın hedefi · API erişimi
          </p>
        </div>
      </section>

      {/* ─── SOCIAL PROOF / METRICS — Apple "stat strip" ─── */}
      <section className="section-padding-sm">
        <div className="container-apple max-w-[1100px]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            <StatStrip num="10dk" label="Ortalama kurulum" />
            <StatStrip num="35+" label="Entegrasyon" />
            <StatStrip num="240+" label="Aktif ekip" />
            <StatStrip num="%99.9" label="SLA uptime" />
          </div>
        </div>
      </section>

      {/* ─── FAQ — Apple-grade ──────────────────────────────── */}
      <section id="sss" className="section-padding border-y border-border/60 bg-neutral-50 dark:bg-neutral-950/40">
        {/* FAQPage schema — AI'lar bunu cevap kaynağı olarak çok kullanır */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: FAQS.map((q) => ({
                '@type': 'Question',
                name: q.q,
                acceptedAnswer: { '@type': 'Answer', text: q.a },
              })),
            }),
          }}
        />
        <div className="container-apple max-w-[820px]">
          <div className="text-center mb-16">
            <p className="eyebrow mb-4">SSS</p>
            <h2 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.25rem,5vw,4rem)] leading-[1]">
              Aklındaki{' '}
              <span className="font-display italic text-[1.08em]">sorular.</span>
            </h2>
          </div>

          <div className="divide-y divide-border/60 border-y border-border/60">
            {FAQS.map((q, i) => (
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

      {/* ─── FINAL CTA — Apple-grade closing statement ──────── */}
      <section className="relative section-padding overflow-hidden">
        {/* Layered atmospheric background — mesh + noise + radial */}
        <div className="absolute inset-0 -z-10 bg-mesh-warm opacity-80 pointer-events-none" />
        <div className="absolute inset-0 -z-10 bg-noise opacity-[0.04] pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[60vh] -z-10 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-200/30 via-transparent to-transparent dark:from-brand-900/20 blur-3xl" />
        </div>

        <div className="container-apple max-w-[1024px] text-center">
          {/* Display headline — italic accent on key word */}
          <h2 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.5rem,7vw,5.5rem)] leading-[0.96]">
            <span>5 dakika.</span>
            <br />
            <span className="font-display italic text-[1.05em] bg-gradient-to-br from-brand-500 via-rose-500 to-amber-500 bg-clip-text text-transparent">Sıfır</span>
            <span> risk.</span>
          </h2>

          <p className="text-pretty mt-8 mx-auto max-w-[560px] text-[clamp(1.0625rem,1.5vw,1.25rem)] leading-[1.5] text-neutral-600 dark:text-neutral-400">
            Kart bilgisi istenmez, istediğin zaman iptal edersin. İlk gün AI'nın senin için ne yapabileceğini gör.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/signin?signup=1" onClick={() => trackCta('final_primary')} className="btn-apple-primary group">
              Şimdi ücretsiz başla
              <ArrowRight className="h-4 w-4 transition-transform duration-300 ease-apple group-hover:translate-x-0.5" />
            </Link>
            <Link href="/pricing" onClick={() => trackCta('final_secondary_pricing')} className="btn-apple-ghost">
              Fiyatları detaylı gör
            </Link>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] text-neutral-500 dark:text-neutral-400">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3" /> SOC-2 uyumlu</span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <span className="inline-flex items-center gap-1.5"><Zap className="h-3 w-3" /> %99.9 uptime</span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3 w-3" /> 7/24 izleme</span>
          </div>
        </div>
      </section>

      {/* ─── FOOTER — Apple-grade minimal ───────────────────── */}
      <footer className="border-t border-border/60 bg-neutral-50 dark:bg-neutral-950/40">
        <div className="container-apple py-16 lg:py-20">
          <div className="grid md:grid-cols-12 gap-10 lg:gap-16">
            {/* Brand column — wider */}
            <div className="md:col-span-4">
              <Link href="/" className="inline-flex items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em]">
                <BrandLogo size={28} className="rounded-md" />
                LuviAI
              </Link>
              <p className="mt-4 max-w-[280px] text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                AI ile siteni, mobil app'ini ve sosyal medyanı tek panelden büyüt. Türkiye'de yapıldı.
              </p>
              <p className="mt-6 text-[11px] tracking-[0.04em] uppercase text-neutral-400 dark:text-neutral-500">
                Senin yerine pazarlama yapan <span className="font-display italic text-[1.1em] text-neutral-700 dark:text-neutral-300 normal-case">AI</span>
              </p>
            </div>

            {/* Link columns */}
            <div className="md:col-span-8 grid grid-cols-2 sm:grid-cols-3 gap-8">
              <FooterCol title="Ürün" links={[
                ['Özellikler', '#cozum'], ['Fiyat', '/pricing'], ['Kullanım Senaryoları', '/use-cases'], ['Karşılaştırma', '/compare'],
              ]} />
              <FooterCol title="Şirket" links={[
                ['Hakkımızda', '/about'], ['Destek', '/help'], ['SSS', '/faq'], ['Durum', '/status'],
              ]} />
              <FooterCol title="Yasal" links={[
                ['Gizlilik', '/privacy'], ['Şartlar', '/terms'], ['KVKK', '/kvkk'],
              ]} />
            </div>
          </div>
        </div>

        <div className="border-t border-border/60">
          <div className="container-apple py-6 flex flex-wrap items-center justify-between gap-3 text-[12px] text-neutral-500 dark:text-neutral-500">
            <span>© {new Date().getFullYear()} LuviAI. Tüm hakları saklıdır.</span>
            <span className="inline-flex items-center gap-1.5">
              Made with <span className="text-brand-500">●</span> in Türkiye
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Product Preview (dashboard mockup — hero altına)
// ─────────────────────────────────────────────────────────────

function ProductPreview() {
  return (
    <div className="relative">
      {/* Browser chrome */}
      <div className="rounded-2xl border bg-card shadow-2xl shadow-orange-500/10 overflow-hidden">
        {/* Top bar — sahte tarayıcı */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/40">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-rose-400/70" />
            <span className="h-3 w-3 rounded-full bg-amber-400/70" />
            <span className="h-3 w-3 rounded-full bg-emerald-400/70" />
          </div>
          <div className="flex-1 mx-3 px-3 py-1 rounded-md bg-background border text-[11px] font-mono text-muted-foreground text-center">
            ai.luvihost.com/sites/kobipratik
          </div>
          <div className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
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
            <div className="rounded-xl border bg-background p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-semibold">AI Görünürlük (30 gün)</div>
                  <div className="text-[10px] text-muted-foreground">ChatGPT, Claude, Gemini, Perplexity</div>
                </div>
                <div className="flex gap-1 text-[10px]">
                  <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground">7g</span>
                  <span className="px-2 py-0.5 rounded bg-orange-500/15 text-orange-700 dark:text-orange-400 font-semibold">30g</span>
                  <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground">90g</span>
                </div>
              </div>
              <CitationChart />
              <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-orange-500" /> ChatGPT</span>
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-purple-500" /> Claude</span>
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Gemini</span>
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Perplexity</span>
              </div>
            </div>

            {/* ASO + ASA grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* ASO Keywords */}
              <div className="rounded-xl border bg-background p-4">
                <div className="text-xs font-semibold mb-3">App Store sıralama</div>
                <div className="space-y-2 text-[11px]">
                  <KeywordRow kw="ön muhasebe" rank={3} delta={5} />
                  <KeywordRow kw="kobi kredisi" rank={8} delta={2} />
                  <KeywordRow kw="esnaf finansman" rank={12} delta={-1} />
                  <KeywordRow kw="ticari pos" rank={23} delta={7} />
                </div>
              </div>

              {/* ASA Perf */}
              <div className="rounded-xl border bg-gradient-to-br from-orange-500/5 to-transparent p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-semibold">Apple Search Ads</div>
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700">Auto-Pilot</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <MiniBox label="Gösterim" value="12.4K" />
                  <MiniBox label="Tıklama" value="487" />
                  <MiniBox label="İndirme" value="62" />
                  <MiniBox label="Harcama" value="$26" />
                </div>
                <div className="mt-2 text-[10px] text-muted-foreground">
                  Son 7 gün · CR %12.7
                </div>
              </div>
            </div>
          </div>

          {/* Sağ: live activity feed */}
          <div className="border-t lg:border-t-0 lg:border-l bg-muted/20 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
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

      {/* Floating UI badges (cosmetic) */}
      <div className="hidden lg:block absolute -top-4 -left-4 px-3 py-1.5 rounded-full bg-card border shadow-lg text-[11px] font-semibold">
        <span className="text-emerald-600">●</span> 247 keyword izleniyor
      </div>
      <div className="hidden lg:block absolute -bottom-4 -right-4 px-3 py-1.5 rounded-full bg-card border shadow-lg text-[11px] font-semibold">
        🤖 Auto-Pilot aktif
      </div>
    </div>
  );
}

function MiniStat({ label, value, delta, deltaColor }: { label: string; value: string; delta: string; deltaColor: 'emerald' | 'rose' }) {
  const colorClass = deltaColor === 'emerald' ? 'text-emerald-600' : 'text-rose-600';
  return (
    <div className="rounded-lg border bg-background p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-base font-bold">{value}</span>
        <span className={`text-[10px] font-semibold ${colorClass}`}>{delta}</span>
      </div>
    </div>
  );
}

function CitationChart() {
  // 4 line chart — mock points
  const lines = [
    { color: '#f97316', points: [30, 28, 35, 32, 40, 45, 42, 50, 55, 58, 62, 70] },     // ChatGPT
    { color: '#a855f7', points: [22, 25, 28, 30, 32, 35, 38, 42, 45, 48, 52, 55] },     // Claude
    { color: '#10b981', points: [18, 20, 19, 24, 26, 28, 30, 32, 34, 36, 38, 40] },     // Gemini
    { color: '#3b82f6', points: [12, 14, 15, 17, 19, 22, 24, 26, 28, 30, 32, 35] },     // Perplexity
  ];
  const w = 500, h = 110, max = 80;
  const path = (pts: number[]) => {
    const step = w / (pts.length - 1);
    return pts.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (y / max) * h).toFixed(1)}`).join(' ');
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[110px]">
      <defs>
        <linearGradient id="g-orange" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* horizontal grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
        <line key={i} x1="0" x2={w} y1={p * h} y2={p * h} stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
      ))}
      {/* area fill under ChatGPT line */}
      <path d={`${path(lines[0].points)} L${w},${h} L0,${h} Z`} fill="url(#g-orange)" />
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
      <span className="truncate">{kw}</span>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-bold">#{rank}</span>
        <span className={`text-[10px] font-semibold ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
          {up ? '↑' : '↓'}{Math.abs(delta)}
        </span>
      </div>
    </div>
  );
}

function MiniBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-background/60 border border-border/40 px-2 py-1.5">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className="font-bold text-sm">{value}</div>
    </div>
  );
}

function FeedItem({ time, icon, text }: { time: string; icon: string; text: string }) {
  return (
    <div className="flex gap-2.5">
      <span className="text-base leading-none mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="leading-snug">{text}</div>
        <div className="text-[9px] text-muted-foreground mt-0.5">{time}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────

function PainCard({ cost, title, body }: { cost: string; title: string; body: string }) {
  return (
    <div className="card-apple p-7 lg:p-8 hover:border-rose-500/40">
      <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400 uppercase tracking-[0.08em] mb-3">{cost}</div>
      <h3 className="text-h5 font-medium mb-3 tracking-[-0.02em]">{title}</h3>
      <p className="text-[14px] text-neutral-500 dark:text-neutral-400 leading-[1.55]">{body}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon, tag, title, body, bullets,
}: {
  icon: any; tag: string; title: string; body: string; bullets: string[];
}) {
  return (
    <div className="card-apple p-8 lg:p-10 group">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-brand-500/15 to-brand-600/5 border border-brand-500/20 grid place-items-center transition-transform duration-500 ease-apple group-hover:scale-110">
          <Icon className="h-5 w-5 text-brand-600 dark:text-brand-400" />
        </div>
        <span className="text-eyebrow text-brand-600 dark:text-brand-400">{tag}</span>
      </div>
      <h3 className="text-h4 font-medium mb-3 tracking-[-0.025em]">{title}</h3>
      <p className="text-[15px] text-neutral-500 dark:text-neutral-400 leading-[1.55] mb-6">{body}</p>
      <ul className="space-y-2.5">
        {bullets.map((b, i) => (
          <li key={i} className="text-[14px] flex items-start gap-2.5 text-neutral-700 dark:text-neutral-300">
            <Check className="h-3.5 w-3.5 text-brand-500 shrink-0 mt-1" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepCard({ n, title, body, icon: Icon }: { n: number; title: string; body: string; icon: any }) {
  return (
    <div className="card-apple relative p-8 lg:p-10 overflow-hidden">
      {/* Massive ghost numeral — Apple "page chapter" pattern */}
      <div className="absolute -top-6 -right-4 font-display italic text-[10rem] leading-none text-neutral-100 dark:text-neutral-900 select-none pointer-events-none">
        {n}
      </div>
      <div className="relative">
        <Icon className="h-7 w-7 text-brand-600 dark:text-brand-400 mb-5" strokeWidth={1.5} />
        <h3 className="text-h5 font-medium mb-3 tracking-[-0.02em]">{title}</h3>
        <p className="text-[14px] text-neutral-500 dark:text-neutral-400 leading-[1.55]">{body}</p>
      </div>
    </div>
  );
}

function StatCard({ num, label, sub }: { num: string; label: string; sub: string }) {
  return (
    <div className="text-center">
      <div className="font-medium tracking-display text-[clamp(3.5rem,7vw,5.5rem)] leading-[0.95] bg-gradient-to-br from-brand-500 via-rose-500 to-amber-500 bg-clip-text text-transparent">
        <AnimatedNumber raw={num} />
      </div>
      <div className="mt-4 text-[15px] font-medium text-foreground tracking-[-0.01em]">{label}</div>
      <div className="text-[13px] text-neutral-500 dark:text-neutral-400 mt-1.5">{sub}</div>
    </div>
  );
}

function StatStrip({ num, label }: { num: string; label: string }) {
  return (
    <div className="text-center">
      <div className="font-medium tracking-display text-[clamp(2rem,4vw,3.25rem)] text-foreground"><AnimatedNumber raw={num} /></div>
      <div className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-2 tracking-[-0.005em]">{label}</div>
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
    <div className="inline-flex items-center gap-1.5 px-3 h-7 rounded-full border border-border/60 bg-background/60 backdrop-blur-sm text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
      <Icon className="h-3 w-3 text-brand-600 dark:text-brand-400" strokeWidth={1.75} />
      <span>{text}</span>
    </div>
  );
}

function Testimonial({
  name, role, company, avatar, avatarBg, metric, quote,
}: {
  name: string; role: string; company: string;
  avatar: string; avatarBg: string; metric: string; quote: string;
}) {
  return (
    <div className="card-apple p-8 lg:p-9 flex flex-col">
      {/* Quote mark — Apple "Newsroom" pattern */}
      <div className="font-display italic text-[3rem] text-brand-500/30 leading-none mb-3 select-none">"</div>
      {/* Quote */}
      <p className="text-[15px] leading-[1.6] flex-1 mb-7 text-neutral-700 dark:text-neutral-300">{quote}</p>
      {/* Metric badge */}
      <div className="mb-6 inline-flex self-start items-center gap-1.5 px-2.5 h-7 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-medium">
        <TrendingUp className="h-3 w-3" /> {metric}
      </div>
      {/* Author */}
      <div className="flex items-center gap-3 pt-6 border-t border-border/60">
        <div className={`h-10 w-10 rounded-full bg-gradient-to-br ${avatarBg} text-white grid place-items-center font-medium text-[13px] shrink-0 shadow-apple-sm`}>
          {avatar}
        </div>
        <div className="min-w-0">
          <div className="font-medium text-[14px] tracking-[-0.005em]">{name}</div>
          <div className="text-[12px] text-neutral-500 dark:text-neutral-400 truncate">{role} · {company}</div>
        </div>
      </div>
    </div>
  );
}

function CompareRow({ row }: { row: [string, ...boolean[]] }) {
  const [label, ...vals] = row;
  return (
    <tr className="border-t border-border/60">
      <td className="p-5 text-[14px] font-medium">{label}</td>
      {vals.map((v, i) => (
        <td key={i} className={`p-5 text-center ${i === vals.length - 1 ? 'bg-brand-500/[0.04]' : ''}`}>
          {v
            ? <Check className="h-4 w-4 text-brand-500 inline" strokeWidth={2.5} />
            : <XIcon className="h-4 w-4 text-neutral-300 dark:text-neutral-700 inline" strokeWidth={1.75} />}
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
    <div className="card-apple p-8 lg:p-9">
      <div className="flex items-center gap-2.5 mb-4">
        <Icon className="h-4 w-4 text-brand-600 dark:text-brand-400" strokeWidth={1.75} />
        <span className="text-eyebrow text-brand-600 dark:text-brand-400">{audience}</span>
      </div>
      <h3 className="text-h5 font-medium mb-3 tracking-[-0.02em]">{hook}</h3>
      <p className="text-[14px] text-neutral-500 dark:text-neutral-400 leading-[1.55] mb-7">{body}</p>
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-border/60">
          <div className="text-[10px] font-medium tracking-[0.06em] text-neutral-400 dark:text-neutral-500 uppercase mb-2">Önce</div>
          <div className="font-medium text-[13px]">{before}</div>
        </div>
        <div className="p-4 rounded-xl bg-gradient-to-br from-brand-500/[0.08] to-brand-500/[0.02] border border-brand-500/20">
          <div className="text-[10px] font-medium tracking-[0.06em] text-brand-600 dark:text-brand-400 uppercase mb-2">Sonra</div>
          <div className="font-medium text-[13px]">{after}</div>
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
    <div className={`relative rounded-apple border flex flex-col p-8 lg:p-9 transition-all duration-500 ease-apple ${
      highlighted
        ? 'bg-foreground text-background border-foreground shadow-apple-xl lg:-translate-y-2'
        : 'bg-card border-border/60 shadow-apple-sm hover:shadow-apple-md'
    }`}>
      {highlighted && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1.5 inline-flex items-center gap-1 rounded-full text-xs font-bold tracking-wide uppercase bg-brand-500 text-white shadow-apple-md whitespace-nowrap">
          ⭐ En Çok Tercih Edilen
        </div>
      )}
      <h3 className={`text-eyebrow ${highlighted ? 'text-brand-400' : 'text-brand-600 dark:text-brand-400'} mb-5`}>{name}</h3>
      <div className="flex items-baseline gap-1 mb-1">
        <span className="font-medium tracking-display text-[clamp(2.5rem,3.5vw,3.5rem)] leading-none">{price}</span>
        <span className={`text-[14px] ${highlighted ? 'text-neutral-400' : 'text-neutral-500 dark:text-neutral-400'}`}>{period}</span>
      </div>
      <p className={`text-[12px] min-h-[16px] mt-1 ${highlighted ? 'text-neutral-400' : 'text-neutral-500 dark:text-neutral-400'}`}>{annualNote}</p>
      <ul className="space-y-3 text-[14px] mt-7 mb-8 flex-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <Check className={`h-3.5 w-3.5 mt-1 shrink-0 ${highlighted ? 'text-brand-400' : 'text-brand-500'}`} strokeWidth={2.5} />
            <span className={highlighted ? 'text-neutral-200' : ''}>{b}</span>
          </li>
        ))}
      </ul>
      <Link
        href={href}
        onClick={onCtaClick}
        className={`inline-flex items-center justify-center w-full h-11 rounded-full font-medium text-[14px] transition-all duration-300 ease-apple ${
          highlighted
            ? 'bg-background text-foreground hover:scale-[1.02] shadow-apple-sm'
            : 'border border-border bg-background text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-900'
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}

function FaqItem({ question, answer, open, onToggle }: { question: string; answer: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full py-6 flex items-center justify-between text-left group gap-6"
      >
        <span className="text-[16px] font-medium tracking-[-0.01em] text-foreground group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors duration-300 ease-apple">
          {question}
        </span>
        <span className={`h-7 w-7 shrink-0 rounded-full border border-border/60 grid place-items-center transition-all duration-500 ease-apple ${open ? 'rotate-45 bg-foreground text-background border-foreground' : 'group-hover:border-foreground'}`}>
          <ChevronDown className={`h-3 w-3 transition-transform duration-500 ease-apple ${open ? '-rotate-45' : ''}`} strokeWidth={2} />
        </span>
      </button>
      <div className={`overflow-hidden transition-all duration-500 ease-apple ${open ? 'max-h-[500px] opacity-100 pb-6' : 'max-h-0 opacity-0'}`}>
        <p className="text-[15px] text-neutral-600 dark:text-neutral-400 leading-[1.6] max-w-[680px]">
          {answer}
        </p>
      </div>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="text-eyebrow text-neutral-400 dark:text-neutral-500 mb-5">{title}</h4>
      <ul className="space-y-3 text-[13px]">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FAQS = [
  {
    q: 'Hangi sitelerde çalışıyor?',
    a: 'Herhangi bir web sitesi (WordPress, Shopify, Webflow, custom). Mobil app entegrasyonu için iOS App Store ID (adamId) yeterli. Bağlamak için sadece URL yapıştır.',
  },
  {
    q: 'Kredi kartı vermem gerekiyor mu?',
    a: 'Hayır. Ücretsiz deneme için kart istenmez. 2 ücretsiz makale hakkını kullandıktan sonra devam etmek istersen plan seçer ve kart eklersin, istemezsen hesap pasif kalır.',
  },
  {
    q: 'AI sektörümü gerçekten anlayabilir mi?',
    a: 'Evet. Onboarding sırasında siteni tarayıp sektörünü %95+ doğrulukla belirler. Yanlış tahmin ederse manuel düzeltebilirsin, sonraki içerikler ona göre üretilir.',
  },
  {
    q: 'Apple Search Ads için Apple Developer hesabım gerekli mi?',
    a: 'Evet, ASA için Apple\'ın istediği credentials sende olmalı (Org ID + Key ID + Public Key). LuviAI senin yerine wizard ile kurar — terminal/openssl gerekmez. 3 adım.',
  },
  {
    q: 'Üretilen içerikler benim mi?',
    a: 'Evet, %100 senin. LuviAI ürettiği makale, görsel, video, metin için telif iddia etmez. Sınırsız kullanabilirsin (planındaki kota dahilinde).',
  },
  {
    q: 'İstediğim zaman iptal edebilir miyim?',
    a: 'Evet. Tek tıkla iptal, ay sonuna kadar kullanmaya devam edersin. İade politikası: ilk 7 gün içinde koşulsuz para iadesi.',
  },
];
