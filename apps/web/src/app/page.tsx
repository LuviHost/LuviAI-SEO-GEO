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

      {/* ─── NAV ──────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-background/85 backdrop-blur-xl border-b border-border/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <BrandLogo size={32} className="rounded-lg shadow-lg shadow-orange-500/20" />
            LuviAI
          </Link>
          <div className="hidden md:flex items-center gap-7 text-sm">
            <a href="#cozum" className="hover:text-orange-600 transition-colors">Çözüm</a>
            <a href="#nasil" className="hover:text-orange-600 transition-colors">Nasıl çalışır</a>
            <a href="#sonuc" className="hover:text-orange-600 transition-colors">Sonuçlar</a>
            <a href="#fiyat" className="hover:text-orange-600 transition-colors">Fiyat</a>
            <a href="#sss" className="hover:text-orange-600 transition-colors">SSS</a>
          </div>
          <div className="flex items-center gap-1.5">
            <LocaleSwitch />
            <ThemeToggle />
            <Link href="/signin" className="hidden sm:inline-block">
              <Button variant="ghost" size="sm">Giriş</Button>
            </Link>
            <Link href="/signin?signup=1">
              <Button size="sm" className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-lg shadow-orange-500/20">
                Ücretsiz başla <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─────────────────────────────────────────────── */}
      <section className="relative pt-14 pb-16 lg:pt-20 lg:pb-20">
        {/* gradient blobs */}
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute top-0 -left-32 w-[36rem] h-[36rem] bg-orange-500/15 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -right-24 w-[40rem] h-[40rem] bg-amber-400/10 rounded-full blur-3xl" />
          <div className="absolute top-40 right-1/3 w-72 h-72 bg-orange-400/8 rounded-full blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Mini badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-orange-500/30 bg-orange-500/5 text-xs font-semibold text-orange-700 dark:text-orange-400 mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
            </span>
            AI · ASO · ASA · Sosyal · Studio — hepsi tek panelde
          </div>

          {/* Headline — single sharp statement */}
          <h1 className="hero-headline text-5xl sm:text-6xl lg:text-8xl font-extrabold tracking-tight leading-[0.95]">
            Senin yerine pazarlama yapan{' '}
            <span className="bg-gradient-to-br from-orange-500 to-orange-700 bg-clip-text text-transparent">AI</span>.
          </h1>

          {/* Sub */}
          <p className="hero-subtitle mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Site, mobil app, sosyal medya — hepsi tek panelden. LuviAI siteni tarar, eksikleri bulur, içeriği üretir, App Store reklamını optimize eder.
          </p>

          {/* CTA */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/signin?signup=1" onClick={() => trackCta('hero_primary')}>
              <Button size="lg" className="h-14 px-7 text-base bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-2xl shadow-orange-500/30">
                Ücretsiz başla — kart gerekmez
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
            <a href="#nasil" onClick={() => trackCta('hero_secondary_demo')}>
              <Button size="lg" variant="outline" className="h-14 px-7 text-base">
                <PlayCircle className="h-5 w-5 mr-2" /> Nasıl çalışır (2dk)
              </Button>
            </a>
          </div>

          {/* Risk reversal microcopy */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-emerald-600" /> Kredi kartı istenmez</span>
            <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-emerald-600" /> 2 makale ücretsiz</span>
            <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-emerald-600" /> Kart gerekmez</span>
            <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-emerald-600" /> 5 dakikada kurulum</span>
          </div>
        </div>

        {/* ─── Live Product Preview (dashboard mockup) ─── */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-16">
          <ProductPreview />
        </div>

        {/* Authority badges + integrations */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-16">
          {/* Authority rozet bar */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mb-8">
            <AuthorityBadge icon={Apple} text="Apple Search Ads Open API Partner" />
            <AuthorityBadge icon={Cpu} text="OpenAI · Anthropic · Google Cloud" />
            <AuthorityBadge icon={Lock} text="AES-256 · TLS 1.3" />
            <AuthorityBadge icon={BadgeCheck} text="KVKK uyumlu · TR sunucu" />
            <AuthorityBadge icon={Cloud} text="%99.9 SLA uptime" />
          </div>

          {/* AI Provider logo bar — Maya tarzı */}
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground text-center mb-5">
            Markanı her major AI platformunda izle
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4 mb-8">
            {(['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'grok', 'deepseek', 'mistral'] as VendorName[]).map((v) => (
              <div key={v} className="flex items-center gap-2 opacity-80 hover:opacity-100 transition">
                <VendorLogo name={v} size={22} />
                <span className="text-sm font-semibold">{AI_LABELS[v] ?? v}</span>
              </div>
            ))}
          </div>

          {/* Diğer entegrasyon platformları */}
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground text-center mb-4 mt-4">
            Ayrıca entegre çalıştığımız platformlar
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4 opacity-80">
            {(['linkedin', 'twitter', 'facebook', 'instagram', 'tiktok', 'youtube', 'google', 'wordpress', 'shopify', 'webflow'] as VendorName[]).map((v) => (
              <div key={v} className="flex items-center gap-1.5 hover:opacity-100 transition" title={INTEGRATION_LABELS[v] ?? v}>
                <VendorLogo name={v} size={20} />
              </div>
            ))}
            <span className="text-xs font-bold text-muted-foreground ml-2">+ Apple Search Ads · App Store Connect</span>
          </div>
        </div>
      </section>

      {/* ─── PAIN (PAS) ───────────────────────────────────────── */}
      <section className="py-20 border-y bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 max-w-3xl mx-auto">
            <p className="text-sm font-semibold text-orange-600 uppercase tracking-wider mb-2">Tanıdık geldi mi?</p>
            <h2 className="text-3xl sm:text-4xl font-bold">
              Pazarlama bütçen patlıyor, sonuç gelmiyor.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
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
          <p className="text-center mt-10 text-lg">
            <span className="line-through text-muted-foreground">Toplam: ₺58.000/ay</span>
            {' '}
            <span className="font-bold">→ LuviAI: ₺799'dan başlar</span>
          </p>
        </div>
      </section>

      {/* ─── SOLUTION ─────────────────────────────────────────── */}
      <section id="cozum" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <p className="text-sm font-semibold text-orange-600 uppercase tracking-wider mb-2">Çözüm</p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
              4 ayrı uzmana ihtiyacın yok.<br />
              <span className="bg-gradient-to-br from-orange-500 to-orange-700 bg-clip-text text-transparent">
                Hepsi tek AI panel.
              </span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
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

      {/* ─── HOW IT WORKS ─────────────────────────────────────── */}
      <section id="nasil" className="py-24 bg-muted/30 border-y">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-orange-600 uppercase tracking-wider mb-2">3 adım</p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
              5 dakikada yayında.
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">Teknik bilgi gerekmez. Onboarding sırasında AI senin sektörünü tahmin eder, ilk içerikleri üretir.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <StepCard
              n={1}
              title="Siteni bağla"
              body="URL'i yapıştır. LuviAI siteyi tarar, sektörünü belirler, ilk 50 keyword'ü çıkarır."
              icon={Globe}
            />
            <StepCard
              n={2}
              title="AI analiz"
              body="Rakiplerin metadata'sı, sıralamalar, eksik keyword'ler, AI Citation skorun — hepsi 2 dakikada."
              icon={Sparkles}
            />
            <StepCard
              n={3}
              title="Yayında"
              body="İlk makale, ilk sosyal post, ilk ASA önerisi hazır. Auto-Pilot açarsan sen hiçbir şey yapmazsın."
              icon={Rocket}
            />
          </div>
        </div>
      </section>

      {/* ─── RESULTS ──────────────────────────────────────────── */}
      <section id="sonuc" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold text-orange-600 uppercase tracking-wider mb-2">Sonuçlar</p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
              Sayılarla LuviAI etkisi.
            </h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <StatCard num="+%47" label="ortalama organic trafik artışı" sub="ilk 30 günde" />
            <StatCard num="-%62" label="App Store Ads CPI düşüşü" sub="Auto-Pilot 60 gün sonrası" />
            <StatCard num="10x" label="içerik üretim hızı" sub="manuel sürece kıyasla" />
          </div>
        </div>
      </section>

      {/* ─── COMPARISON ──────────────────────────────────────── */}
      <section className="py-24 bg-muted/30 border-y">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-sm font-semibold text-orange-600 uppercase tracking-wider mb-2">Karşılaştırma</p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
              5 SaaS yerine 1 LuviAI.
            </h2>
            <p className="mt-3 text-muted-foreground">Şu an birden fazla araç için ödüyorsan büyük ihtimalle %80 tasarruf edersin.</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-4 font-semibold">Özellik</th>
                  <th className="text-center p-4 font-semibold">SEMrush</th>
                  <th className="text-center p-4 font-semibold">AppTweak</th>
                  <th className="text-center p-4 font-semibold">Hootsuite</th>
                  <th className="text-center p-4 font-semibold">ChatGPT Team</th>
                  <th className="text-center p-4 font-bold bg-orange-500/10 text-orange-700 dark:text-orange-400">LuviAI</th>
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
                <tr className="border-t bg-muted/20">
                  <td className="p-4 font-bold">Aylık fiyat (yaklaşık)</td>
                  <td className="text-center p-4 text-muted-foreground">$140</td>
                  <td className="text-center p-4 text-muted-foreground">$200</td>
                  <td className="text-center p-4 text-muted-foreground">$99</td>
                  <td className="text-center p-4 text-muted-foreground">$60</td>
                  <td className="text-center p-4 bg-orange-500/10 font-bold text-orange-700 dark:text-orange-400">₺4.999 ($125)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-4">
            * Karşılaştırma resmi web sitelerinin Pro/Team paket fiyatlarına göre. Mayıs 2026 itibarıyla.
          </p>
        </div>
      </section>

      {/* ─── USE CASES ────────────────────────────────────────── */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold text-orange-600 uppercase tracking-wider mb-2">Kimler kullanıyor</p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
              Senin iş modelin için biçildi mi?
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
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

      {/* ─── TESTIMONIALS ─────────────────────────────────────── */}
      <section className="py-24 bg-muted/30 border-y">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold text-orange-600 uppercase tracking-wider mb-2">Kullanıcı yorumları</p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
              Ekipler ne diyor?
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

      {/* ─── PRICING ──────────────────────────────────────────── */}
      <section id="fiyat" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <p className="text-sm font-semibold text-orange-600 uppercase tracking-wider mb-2">Şeffaf fiyat</p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
              Bugün başla, kart sonra.
            </h2>
            <p className="mt-3 text-muted-foreground text-lg">
              2 makale ücretsiz · İstediğin zaman iptal · Gizli ücret yok
            </p>
          </div>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-3 mb-12">
            <button
              onClick={() => setBilling('monthly')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                billing === 'monthly' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Aylık
            </button>
            <button
              onClick={() => setBilling('annual')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition relative ${
                billing === 'annual' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Yıllık
              <span className="absolute -top-3 -right-3 text-[10px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                %17 indirim
              </span>
            </button>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-7xl mx-auto">
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

      {/* ─── SOCIAL PROOF / METRICS ──────────────────────────── */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-3xl md:text-4xl font-extrabold"><AnimatedNumber raw="10dk" /></div>
              <div className="text-xs text-muted-foreground mt-1">Ortalama kurulum</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-extrabold"><AnimatedNumber raw="35+" /></div>
              <div className="text-xs text-muted-foreground mt-1">Entegrasyon</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-extrabold"><AnimatedNumber raw="240+" /></div>
              <div className="text-xs text-muted-foreground mt-1">Aktif ekip</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-extrabold"><AnimatedNumber raw="%99.9" /></div>
              <div className="text-xs text-muted-foreground mt-1">SLA uptime</div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FAQ ──────────────────────────────────────────────── */}
      <section id="sss" className="py-24 bg-muted/30 border-y">
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
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-sm font-semibold text-orange-600 uppercase tracking-wider mb-2">SSS</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Aklındaki sorular.</h2>
          </div>

          <div className="space-y-3">
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

      {/* ─── FINAL CTA ───────────────────────────────────────── */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-orange-500/10 via-amber-400/5 to-transparent" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl sm:text-6xl font-extrabold tracking-tight">
            5 dakika.<br />
            <span className="bg-gradient-to-br from-orange-500 to-orange-700 bg-clip-text text-transparent">
              Sıfır risk.
            </span>
          </h2>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            Kart bilgisi istenmez, istediğin zaman iptal edersin. İlk gün AI'nın senin için ne yapabileceğini gör.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/signin?signup=1" onClick={() => trackCta('final_primary')}>
              <Button size="lg" className="h-14 px-8 text-base bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-2xl shadow-orange-500/40">
                Şimdi ücretsiz başla <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
            <Link href="/pricing" onClick={() => trackCta('final_secondary_pricing')}>
              <Button size="lg" variant="outline" className="h-14 px-8 text-base">
                Fiyatları detaylı gör
              </Button>
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> SOC-2 uyumlu</span>
            <span className="inline-flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-emerald-600" /> %99.9 uptime</span>
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-emerald-600" /> 7/24 izleme</span>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ───────────────────────────────────────────── */}
      <footer className="border-t py-12 text-sm text-muted-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-4 gap-8">
          <div>
            <Link href="/" className="flex items-center gap-2 font-bold text-base text-foreground">
              <BrandLogo size={28} className="rounded-lg" />
              LuviAI
            </Link>
            <p className="mt-3 text-xs leading-relaxed">
              AI ile siteni, mobil app'ini ve sosyal medyanı tek panelden büyüt.
            </p>
          </div>
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-10 pt-6 border-t text-xs flex flex-wrap justify-between gap-3">
          <span>© {new Date().getFullYear()} LuviAI. Tüm hakları saklıdır.</span>
          <span>Made with ❤️ in Türkiye</span>
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
    <div className="p-6 rounded-2xl border bg-background hover:border-rose-500/40 transition">
      <div className="text-xs font-semibold text-rose-600 uppercase tracking-wider mb-2">{cost}</div>
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon, tag, title, body, bullets,
}: {
  icon: any; tag: string; title: string; body: string; bullets: string[];
}) {
  return (
    <div className="p-7 rounded-2xl border bg-card hover:border-orange-500/40 hover:shadow-xl hover:shadow-orange-500/5 transition-all">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-orange-500/15 to-orange-600/10 grid place-items-center">
          <Icon className="h-5 w-5 text-orange-600" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">{tag}</span>
      </div>
      <h3 className="text-xl font-bold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-4">{body}</p>
      <ul className="space-y-1.5">
        {bullets.map((b, i) => (
          <li key={i} className="text-sm flex items-start gap-2">
            <Check className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepCard({ n, title, body, icon: Icon }: { n: number; title: string; body: string; icon: any }) {
  return (
    <div className="relative p-7 rounded-2xl border bg-background">
      <div className="absolute -top-4 -left-2 text-7xl font-extrabold text-orange-500/10 leading-none select-none">
        {n}
      </div>
      <div className="relative">
        <Icon className="h-7 w-7 text-orange-600 mb-3" />
        <h3 className="text-lg font-bold mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function StatCard({ num, label, sub }: { num: string; label: string; sub: string }) {
  return (
    <div className="p-8 rounded-2xl border bg-gradient-to-br from-orange-500/5 to-transparent text-center">
      <div className="text-5xl md:text-6xl font-extrabold bg-gradient-to-br from-orange-500 to-orange-700 bg-clip-text text-transparent">
        <AnimatedNumber raw={num} />
      </div>
      <div className="mt-2 font-semibold">{label}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
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
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/60 bg-background/50 backdrop-blur-sm text-[11px] font-semibold">
      <Icon className="h-3.5 w-3.5 text-orange-600" />
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
    <div className="p-7 rounded-2xl border bg-background flex flex-col hover:shadow-xl hover:shadow-orange-500/5 hover:border-orange-500/30 transition-all">
      {/* Stars */}
      <div className="flex gap-0.5 mb-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
        ))}
      </div>
      {/* Quote */}
      <p className="text-sm leading-relaxed flex-1 mb-5">"{quote}"</p>
      {/* Metric badge */}
      <div className="mb-5 inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold">
        <TrendingUp className="h-3 w-3" /> {metric}
      </div>
      {/* Author */}
      <div className="flex items-center gap-3 pt-4 border-t">
        <div className={`h-10 w-10 rounded-full bg-gradient-to-br ${avatarBg} text-white grid place-items-center font-bold text-sm shrink-0`}>
          {avatar}
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm">{name}</div>
          <div className="text-[11px] text-muted-foreground truncate">{role} · {company}</div>
        </div>
      </div>
    </div>
  );
}

function CompareRow({ row }: { row: [string, ...boolean[]] }) {
  const [label, ...vals] = row;
  return (
    <tr className="border-t">
      <td className="p-4 font-medium">{label}</td>
      {vals.map((v, i) => (
        <td key={i} className={`p-4 text-center ${i === vals.length - 1 ? 'bg-orange-500/5' : ''}`}>
          {v ? <Check className="h-4 w-4 text-emerald-600 inline" /> : <XIcon className="h-4 w-4 text-muted-foreground/40 inline" />}
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
    <div className="p-7 rounded-2xl border bg-card hover:border-orange-500/40 transition">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-5 w-5 text-orange-600" />
        <span className="text-xs font-bold uppercase tracking-wider text-orange-600">{audience}</span>
      </div>
      <h3 className="text-lg font-bold mb-2">{hook}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-5">{body}</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-3 rounded-lg bg-muted/40">
          <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Önce</div>
          <div className="font-semibold">{before}</div>
        </div>
        <div className="p-3 rounded-lg bg-orange-500/10">
          <div className="text-[10px] font-bold text-orange-600 uppercase mb-1">Sonra</div>
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
    <div className={`relative p-7 rounded-2xl border flex flex-col ${
      highlighted
        ? 'bg-gradient-to-br from-orange-500/10 to-orange-500/5 border-orange-500/40 shadow-xl shadow-orange-500/10 lg:scale-[1.03]'
        : 'bg-background'
    }`}>
      {highlighted && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg whitespace-nowrap">
          ⭐ En Çok Tercih Edilen
        </div>
      )}
      <h3 className="text-lg font-bold">{name}</h3>
      <div className="mt-4 mb-1">
        <span className="text-4xl font-extrabold">{price}</span>
        <span className="text-muted-foreground text-sm">{period}</span>
      </div>
      <p className="text-xs text-muted-foreground min-h-[16px]">{annualNote}</p>
      <ul className="space-y-2 text-sm mt-5 mb-6 flex-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2">
            <Check className={`h-4 w-4 mt-0.5 shrink-0 ${highlighted ? 'text-orange-600' : 'text-emerald-600'}`} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <Link href={href} onClick={onCtaClick}>
        <Button
          className={`w-full ${highlighted ? 'bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white' : ''}`}
          variant={highlighted ? 'default' : 'outline'}
        >
          {cta}
        </Button>
      </Link>
    </div>
  );
}

function FaqItem({ question, answer, open, onToggle }: { question: string; answer: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border bg-background overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-5 flex items-center justify-between text-left hover:bg-muted/30 transition"
      >
        <span className="font-semibold">{question}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed border-t pt-4">
          {answer}
        </div>
      )}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="font-semibold text-foreground mb-3">{title}</h4>
      <ul className="space-y-2 text-xs">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="hover:text-foreground transition">{label}</Link>
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
