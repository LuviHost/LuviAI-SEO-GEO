'use client';

import Link from 'next/link';
import {
  Rocket, Search, Smartphone, Bot, Sparkles,
  CreditCard, Plug, BookOpen, Clapperboard, Mail,
} from 'lucide-react';
import { useT } from '@/lib/i18n';
import { PageUpdatedLine } from '@/components/page-updated-line';
import {
  VITRIN_CELL, VITRIN_GRID, VITRIN_LINK, VitrinBand, VitrinHero, VitrinSection,
} from '@/components/vitrin/vitrin-page';

const TOPICS_BASE = [
  { id: 'getting-started', icon: Rocket, href: '/help/getting-started' },
  { id: 'ai-visibility', icon: Sparkles, href: '/help/ai-visibility' },
  { id: 'aso', icon: Search, href: '/help/aso' },
  { id: 'asa-asc', icon: Smartphone, href: '/help/asa-asc' },
  { id: 'auto-pilot', icon: Bot, href: '/help/auto-pilot' },
  { id: 'video', icon: Clapperboard, href: '/help/video' },
  { id: 'api-keys', icon: Plug, href: '/help/api-keys' },
  { id: 'billing', icon: CreditCard, href: '/help/billing' },
  { id: 'glossary', icon: BookOpen, href: '/help/glossary' },
];

// Destek metni plans.ts support_tr ile ayni: her planda e-posta. Yanit suresi
// (24 / 4 saat), Slack kanali ve ozel hesap yoneticisi vaatleri kaldirildi —
// kodda ve operasyonda karsiligi yoktu (sahip karari 30.10.2026). Eski "Pro ve
// ustu canli destek" ve "15 dakika ucretsiz ekran paylasimi" vaatleri de hicbir
// plana dayanmiyordu. BYOK yalniz Kurumsal.
const COPY = {
  tr: {
    eyebrow: 'Yardım Merkezi',
    titleA: 'RanksUp nasıl',
    titleB: 'kullanılır?',
    lead1: 'Adım adım rehberler; ilk siteni birkaç dakikada ekle.',
    lead2: 'Sorunu bulamadıysan ',
    readGuide: 'Rehberi oku →',
    stuckTitle: 'Hâlâ takılı kaldın mı?',
    stuckBody: 'Destek ekibine e-postayla ulaş; sorunu ve site adresini yazman işimizi kolaylaştırır.',
    mailBtn: 'Mail destek',
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
    eyebrow: 'Help Center',
    titleA: 'How do I use',
    titleB: 'RanksUp?',
    lead1: 'Step-by-step guides; add your first site in a few minutes.',
    lead2: "Can't find what you need? ",
    readGuide: 'Read guide →',
    stuckTitle: 'Still stuck?',
    stuckBody: 'Email our support team; including the problem and your site address helps us look into it.',
    mailBtn: 'Email support',
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

/**
 * Koyu vitrin (Kasim 2026): iki tonlu baslik, altinda konular bitisik hucreli izgarada
 * (kartlar arasi bosluk yerine tek ince cizgi; ikon duz, renkli karo yok). Sayfa alti
 * destek bolumu Hakkimizda'daki bolumlerle ayni duzende; kapanisi ortak VitrinCta yapar
 * (marketing-shell).
 */
export default function HelpPage() {
  const { locale } = useT();
  const c = COPY[locale];

  return (
    <>
      <VitrinHero
        rail={c.eyebrow}
        a={c.titleA}
        b={c.titleB}
        lead={(
          <p>
            {c.lead1}{' '}
            <br />
            {c.lead2}
            <a href="mailto:destek@luvihost.com" className={VITRIN_LINK}>destek@luvihost.com</a>
          </p>
        )}
      >
        <PageUpdatedLine path="/help" className="mt-6 font-mono" />
      </VitrinHero>

      <VitrinBand>
        {/* Dokuz konu genis ekranda 3x3; iki sutunda son hucre satiri doldurur */}
        <div className={`${VITRIN_GRID} sm:grid-cols-2 lg:grid-cols-3`}>
          {TOPICS_BASE.map((t) => {
            const topic = c.topics[t.id as keyof typeof c.topics];
            return (
              <Link
                key={t.href}
                href={t.href as any}
                className={`${VITRIN_CELL} group flex flex-col transition-colors duration-200 hover:bg-card sm:max-lg:last:col-span-2`}
              >
                <t.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                <h2 className="mt-6 text-vitrin-3 sm:mt-8">{topic.title}</h2>
                <p className="mt-3 text-sm leading-[1.8] text-muted-foreground">{topic.desc}</p>
                <span className="v-rail mt-auto pt-6 transition-colors duration-200 group-hover:text-brand-vivid sm:pt-8">
                  {c.readGuide}
                </span>
              </Link>
            );
          })}
        </div>
      </VitrinBand>

      <VitrinSection title={c.stuckTitle}>
        <p className="max-w-2xl text-base leading-[1.75] text-muted-foreground">{c.stuckBody}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a href="mailto:destek@luvihost.com" className="v-btn">
            <Mail className="h-4 w-4" aria-hidden />
            {c.mailBtn}
          </a>
          <Link href={'/signin' as any} className="v-btn-line">
            {c.signinBtn}
          </Link>
        </div>
      </VitrinSection>
    </>
  );
}
