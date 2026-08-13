'use client';

import Link from 'next/link';
import {
  Rocket, Search, Smartphone, Wand2, Bot, Sparkles,
  CreditCard, Plug, MessageSquare, BarChart3, BookOpen,
} from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Eyebrow, StepMotif } from '@/components/brand';

const TOPICS_BASE = [
  { id: 'getting-started', icon: Rocket, href: '/help/getting-started' },
  { id: 'ai-visibility', icon: Sparkles, href: '/help/ai-visibility' },
  { id: 'aso', icon: Search, href: '/help/aso' },
  { id: 'asa-asc', icon: Smartphone, href: '/help/asa-asc' },
  { id: 'studio', icon: Wand2, href: '/help/studio' },
  { id: 'auto-pilot', icon: Bot, href: '/help/auto-pilot' },
  { id: 'api-keys', icon: Plug, href: '/help/api-keys' },
  { id: 'social', icon: MessageSquare, href: '/help/social' },
  { id: 'billing', icon: CreditCard, href: '/help/billing' },
  { id: 'glossary', icon: BookOpen, href: '/help/glossary' },
];

const COPY = {
  tr: {
    eyebrow: '📚 Yardım Merkezi',
    titleA: 'RanksUp nasıl',
    titleB: 'kullanılır?',
    lead1: '9 modül, 5 dakikada başla. Her sekmenin kendi rehberi.',
    lead2: 'Sorunu bulamadıysan ',
    readGuide: 'Rehberi oku →',
    stuckTitle: 'Hâlâ takılı kaldın mı?',
    stuckBody: 'Ekranı paylaşarak 15 dakika ücretsiz onboarding desteği alabilirsin. Pro plan + üstü kullanıcılar için canlı destek mevcut.',
    mailBtn: '📧 Mail destek',
    signinBtn: 'Hesabıma giriş',
    topics: {
      'getting-started': { title: 'Hızlı Başlangıç', desc: '5 dakikada hesabını kurup ilk AI çıktısını al.' },
      'ai-visibility': { title: 'AI Görünürlük', desc: "ChatGPT, Claude, Gemini, Perplexity'de markanı izle." },
      'aso': { title: 'ASO — Mobil App SEO', desc: 'App Store + Play Store keyword sıralama + rakip analizi.' },
      'asa-asc': { title: 'Apple Search Ads + ASC', desc: 'iOS reklam kampanyası kurulumu, Auto-Pilot, review takibi.' },
      'studio': { title: 'AI Studio', desc: 'Görsel (DALL-E), video (Sora 2 + Veo 3), metin üretimi.' },
      'auto-pilot': { title: 'Auto-Pilot Otomasyon', desc: 'Sen uyurken AI keyword ekler, kampanya optimize eder.' },
      'api-keys': { title: 'API Keys (BYOK)', desc: "Kendi OpenAI/Anthropic key'inle çalış, kotamızdan düşmez." },
      'social': { title: 'Sosyal Medya', desc: '5 kanala AI ile post + görsel + zamanlama.' },
      'billing': { title: 'Faturalama', desc: 'Plan değiştirme, iptal, fatura indirme, kota.' },
      'glossary': { title: 'SEO & GEO Sözlüğü', desc: 'SEO, GEO, AEO, schema ve reklam terimleri — sade Türkçe.' },
    },
  },
  en: {
    eyebrow: '📚 Help Center',
    titleA: 'How do I use',
    titleB: 'RanksUp?',
    lead1: '9 modules, start in 5 minutes. Each tab has its own guide.',
    lead2: "Can't find what you need? ",
    readGuide: 'Read guide →',
    stuckTitle: 'Still stuck?',
    stuckBody: 'Get 15 minutes of free screen-share onboarding. Live support is available for Pro plan and above.',
    mailBtn: '📧 Email support',
    signinBtn: 'Sign in to my account',
    topics: {
      'getting-started': { title: 'Quick Start', desc: 'Set up your account and get your first AI output in 5 minutes.' },
      'ai-visibility': { title: 'AI Visibility', desc: 'Monitor your brand on ChatGPT, Claude, Gemini, Perplexity.' },
      'aso': { title: 'ASO — Mobile App SEO', desc: 'App Store + Play Store keyword ranking + competitor analysis.' },
      'asa-asc': { title: 'Apple Search Ads + ASC', desc: 'iOS ad campaign setup, Auto-Pilot, review tracking.' },
      'studio': { title: 'AI Studio', desc: 'Image (DALL-E), video (Sora 2 + Veo 3), text generation.' },
      'auto-pilot': { title: 'Auto-Pilot Automation', desc: 'While you sleep, AI adds keywords and optimizes campaigns.' },
      'api-keys': { title: 'API Keys (BYOK)', desc: "Use your own OpenAI/Anthropic key — doesn't count against our quota." },
      'social': { title: 'Social Media', desc: 'AI post + image + scheduling for 5 channels.' },
      'billing': { title: 'Billing', desc: 'Change plan, cancel, download invoice, quota.' },
      'glossary': { title: 'SEO & GEO Glossary', desc: 'SEO, GEO, AEO, schema and ad terms — plain definitions.' },
    },
  },
} as const;

export default function HelpPage() {
  const { locale } = useT();
  const c = COPY[locale];

  return (
    <main className="relative min-h-screen">
      <div className="absolute inset-x-0 top-0 h-80 -z-10 grid-paper-light pointer-events-none" aria-hidden="true" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="relative text-center mb-14 max-w-3xl mx-auto">
          <StepMotif size={36} steps={4} className="absolute -top-1 right-0 hidden sm:block" />
          <div className="mb-5">
            <Eyebrow>{c.eyebrow}</Eyebrow>
          </div>
          <h1 className="font-brandDisplay text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-[-0.03em] leading-[1.08] mb-4">
            {c.titleA}{' '}
            <span className="text-brand dark:text-brand-400">
              {c.titleB}
            </span>
          </h1>
          <p className="text-lg text-muted-foreground">
            {c.lead1}{' '}
            <br />
            {c.lead2}
            <a href="mailto:destek@luvihost.com" className="text-brand dark:text-brand-400 hover:underline font-semibold">destek@luvihost.com</a>
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {TOPICS_BASE.map((t) => {
            const topic = c.topics[t.id as keyof typeof c.topics];
            return (
              <Link
                key={t.href}
                href={t.href as any}
                className="p-6 rounded-2xl border border-ink/10 dark:border-bone/10 bg-paper dark:bg-ink-2 hover:border-brand/40 dark:hover:border-brand-400/40 transition-colors group"
              >
                <div className="h-11 w-11 rounded-xl bg-brand/10 text-brand dark:text-brand-400 grid place-items-center mb-3">
                  <t.icon className="h-5 w-5" />
                </div>
                <h2 className="font-brandDisplay font-bold text-lg mb-1.5">{topic.title}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{topic.desc}</p>
                <div className="mt-4 text-xs font-bold text-brand dark:text-brand-400 group-hover:translate-x-0.5 transition-transform">
                  {c.readGuide}
                </div>
              </Link>
            );
          })}
        </div>

        {/* Quick links */}
        <div className="mt-16 card-brand p-8 text-center">
          <BarChart3 className="h-10 w-10 text-brand dark:text-brand-400 mx-auto mb-3" />
          <h3 className="font-brandDisplay text-2xl font-bold mb-2">{c.stuckTitle}</h3>
          <p className="text-muted-foreground mb-5 max-w-xl mx-auto">{c.stuckBody}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="mailto:destek@luvihost.com"
              className="btn-brand h-10 px-5 text-sm"
            >
              {c.mailBtn}
            </a>
            <Link
              href={'/signin' as any}
              className="btn-brand-outline h-10 px-5 text-sm"
            >
              {c.signinBtn}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
