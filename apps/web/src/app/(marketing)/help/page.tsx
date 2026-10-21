'use client';

import Link from 'next/link';
import {
  Rocket, Search, Smartphone, Bot, Sparkles,
  CreditCard, Plug, BarChart3, BookOpen, Clapperboard,
} from 'lucide-react';
import { useT } from '@/lib/i18n';

type Color = 'orange' | 'purple' | 'blue' | 'amber' | 'rose' | 'emerald' | 'cyan' | 'pink' | 'slate';

const TOPICS_BASE = [
  { id: 'getting-started', icon: Rocket, color: 'orange' as Color, href: '/help/getting-started' },
  { id: 'ai-visibility', icon: Sparkles, color: 'purple' as Color, href: '/help/ai-visibility' },
  { id: 'aso', icon: Search, color: 'blue' as Color, href: '/help/aso' },
  { id: 'asa-asc', icon: Smartphone, color: 'amber' as Color, href: '/help/asa-asc' },
  { id: 'auto-pilot', icon: Bot, color: 'emerald' as Color, href: '/help/auto-pilot' },
  { id: 'video', icon: Clapperboard, color: 'rose' as Color, href: '/help/video' },
  { id: 'api-keys', icon: Plug, color: 'cyan' as Color, href: '/help/api-keys' },
  { id: 'billing', icon: CreditCard, color: 'slate' as Color, href: '/help/billing' },
  { id: 'glossary', icon: BookOpen, color: 'purple' as Color, href: '/help/glossary' },
];

// Destek metni plans.ts destek kademeleriyle ayni (Büyüme e-posta 24 saat,
// Profesyonel e-posta 4 saat, Ajans öncelikli + Slack, Kurumsal özel hesap
// yöneticisi). Eski "Pro ve ustu canli destek" ve "15 dakika ucretsiz ekran
// paylasimi" vaatleri hicbir plana dayanmiyordu. BYOK yalniz Kurumsal.
const COPY = {
  tr: {
    eyebrow: '📚 Yardım Merkezi',
    titleA: 'RanksUp nasıl',
    titleB: 'kullanılır?',
    lead1: 'Adım adım rehberler; ilk siteni birkaç dakikada ekle.',
    lead2: 'Sorunu bulamadıysan ',
    readGuide: 'Rehberi oku →',
    stuckTitle: 'Hâlâ takılı kaldın mı?',
    stuckBody: 'Destek ekibine e-postayla yaz. Yanıt süresi planına göre değişir: Büyüme’de 24 saat, Profesyonel’de 4 saat; Ajans planında öncelikli destek ve Slack kanalı, Kurumsal planda özel hesap yöneticisi var.',
    mailBtn: '📧 Mail destek',
    signinBtn: 'Hesabıma giriş',
    topics: {
      'getting-started': { title: 'Hızlı Başlangıç', desc: 'Hesabını aç, siteni ekle, ilk AI bulgularını gör.' },
      'ai-visibility': { title: 'AI Görünürlük', desc: 'ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’te markanı ölç.' },
      'aso': { title: 'ASO — Mobil App SEO', desc: 'App Store + Play Store anahtar kelime sıralaması + rakip analizi.' },
      'asa-asc': { title: 'Apple Search Ads + ASC', desc: 'iOS reklam kampanyası kurulumu, Auto-Pilot, yorum ve sürüm takibi.' },
      'auto-pilot': { title: 'Otomatik akış ve Auto-Pilot', desc: 'Neler otomatik çalışır, neleri sen başlatırsın.' },
      'video': { title: 'RanksUp Video', desc: 'Makale, site ve ürün tanıtım videoları; sitenin markasıyla dikey ve yatay (Profesyonel ve üstü).' },
      'api-keys': { title: 'Kendi sağlayıcı anahtarın (BYOK)', desc: 'Kurumsal planda kendi AI sağlayıcı anahtarınla ölç.' },
      'billing': { title: 'Faturalama', desc: 'Plan değiştirme, iptal, iade, ödeme geçmişi, kota.' },
      'glossary': { title: 'SEO & GEO Sözlüğü', desc: 'SEO, GEO, AEO, schema ve reklam terimleri — sade Türkçe.' },
    },
  },
  en: {
    eyebrow: '📚 Help Center',
    titleA: 'How do I use',
    titleB: 'RanksUp?',
    lead1: 'Step-by-step guides; add your first site in a few minutes.',
    lead2: "Can't find what you need? ",
    readGuide: 'Read guide →',
    stuckTitle: 'Still stuck?',
    stuckBody: 'Email our support team. Response time depends on your plan: 24 hours on Growth, 4 hours on Professional; Agency adds priority support and a Slack channel, Enterprise a dedicated account manager.',
    mailBtn: '📧 Email support',
    signinBtn: 'Sign in to my account',
    topics: {
      'getting-started': { title: 'Quick Start', desc: 'Open your account, add your site, see your first AI findings.' },
      'ai-visibility': { title: 'AI Visibility', desc: 'Measure your brand on ChatGPT, Claude, Gemini, Perplexity, Grok and DeepSeek.' },
      'aso': { title: 'ASO — Mobile App SEO', desc: 'App Store + Play Store keyword ranking + competitor analysis.' },
      'asa-asc': { title: 'Apple Search Ads + ASC', desc: 'iOS ad campaign setup, Auto-Pilot, review and release tracking.' },
      'auto-pilot': { title: 'Automation and Auto-Pilot', desc: 'What runs automatically and what you start yourself.' },
      'video': { title: 'RanksUp Video', desc: 'Article, site and product promo videos in your branding, vertical and horizontal (Professional and up).' },
      'api-keys': { title: 'Bring your own key (BYOK)', desc: 'Measure with your own AI provider keys on the Enterprise plan.' },
      'billing': { title: 'Billing', desc: 'Change plan, cancel, refunds, payment history, quota.' },
      'glossary': { title: 'SEO & GEO Glossary', desc: 'SEO, GEO, AEO, schema and ad terms — plain definitions.' },
    },
  },
} as const;

const COLORS: Record<string, string> = {
  orange: 'from-brand-500/15 to-brand-600/10 text-brand-600',
  purple: 'from-purple-500/15 to-purple-600/10 text-purple-600',
  blue: 'from-blue-500/15 to-blue-600/10 text-blue-600',
  amber: 'from-amber-500/15 to-amber-600/10 text-amber-600',
  rose: 'from-rose-500/15 to-rose-600/10 text-rose-600',
  emerald: 'from-emerald-500/15 to-emerald-600/10 text-emerald-600',
  cyan: 'from-cyan-500/15 to-cyan-600/10 text-cyan-600',
  pink: 'from-pink-500/15 to-pink-600/10 text-pink-600',
  slate: 'from-slate-500/15 to-slate-600/10 text-slate-600',
};

export default function HelpPage() {
  const { locale } = useT();
  const c = COPY[locale];

  return (
    <main className="relative min-h-screen">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
        <div className="absolute top-60 -right-20 w-96 h-96 bg-amber-400/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-14 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-600 text-xs font-semibold mb-5">
            {c.eyebrow}
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-4">
            {c.titleA}{' '}
            <span className="bg-gradient-to-r from-brand-500 via-brand-600 to-red-600 bg-clip-text text-transparent">
              {c.titleB}
            </span>
          </h1>
          <p className="text-lg text-muted-foreground">
            {c.lead1}{' '}
            <br />
            {c.lead2}
            <a href="mailto:destek@luvihost.com" className="text-brand-600 hover:underline font-semibold">destek@luvihost.com</a>
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {TOPICS_BASE.map((t) => {
            const topic = c.topics[t.id as keyof typeof c.topics];
            return (
              <Link
                key={t.href}
                href={t.href as any}
                className="p-6 rounded-2xl border bg-background hover:border-brand-500/40 hover:shadow-xl hover:shadow-brand-500/5 transition-all group"
              >
                <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${COLORS[t.color]} grid place-items-center mb-3 group-hover:scale-110 transition-transform`}>
                  <t.icon className="h-5 w-5" />
                </div>
                <h2 className="font-bold text-lg mb-1.5">{topic.title}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{topic.desc}</p>
                <div className="mt-4 text-xs font-bold text-brand-600 group-hover:translate-x-0.5 transition-transform">
                  {c.readGuide}
                </div>
              </Link>
            );
          })}
        </div>

        {/* Quick links */}
        <div className="mt-16 rounded-2xl border-2 border-brand-500/30 bg-gradient-to-br from-brand-500/5 to-amber-400/5 p-8 text-center">
          <BarChart3 className="h-10 w-10 text-brand-600 mx-auto mb-3" />
          <h3 className="text-2xl font-bold mb-2">{c.stuckTitle}</h3>
          <p className="text-muted-foreground mb-5 max-w-xl mx-auto">{c.stuckBody}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="mailto:destek@luvihost.com"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white text-sm font-semibold shadow-lg shadow-brand-500/20"
            >
              {c.mailBtn}
            </a>
            <Link
              href={'/signin' as any}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border text-sm font-semibold hover:bg-muted/50"
            >
              {c.signinBtn}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
