'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { trackCta } from '@/lib/landing-track';
import { fadeUp } from '@/lib/motion-presets';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import { AiVisibilityChecker } from './ai-visibility-checker';
import { WatchVideoButton } from './explainer-dialog';

/**
 * Landing'in TEK hero'su (Faz 6). Eskiden alan adi testi + ikinci bir "Senin yerine
 * pazarlama yapan AI" hero'su ust uste iki birincil CTA yaristiriyordu. Simdi:
 *   birincil  — alan adi testi (AiVisibilityChecker)
 *   ikincil   — ucretsiz hesap baglantisi + aciklama videosu
 * Alt satir SEO/GEO/ASO kapsamini tek cumlede soyler. Dil: "sen".
 */

/** Turkce ek unlu uyumuna uyar: ChatGPT'de, Claude'da, Grok'ta... */
const ROTATING_TR: Array<[string, string]> = [
  ['ChatGPT', "'de"],
  ['Claude', "'da"],
  ['Gemini', "'de"],
  ['Perplexity', "'de"],
  ['Grok', "'ta"],
  ['DeepSeek', "'te"],
  ['Meta AI', "'da"],
];

const COPY = {
  tr: {
    titleA: 'Markan',
    titleB: ' görünüyor mu?',
    subtitle:
      '7 AI asistanında markanın nasıl anıldığını 30 saniyede, üye olmadan test et. Sonra RanksUp; SEO, GEO içerik ve App Store sıralamanı (ASO) tek panelden büyütür.',
    centerLabel: 'MARKAN',
  },
  en: {
    titleA: 'Is your brand on',
    titleB: '?',
    subtitle:
      'Test how 7 AI assistants mention your brand — in 30 seconds, no signup. Then RanksUp grows your SEO, GEO content and App Store ranking (ASO) from one panel.',
    centerLabel: 'YOUR BRAND',
  },
} as const;

const ENGINES: Array<{ name: VendorName; label: string }> = [
  { name: 'chatgpt', label: 'CHATGPT' },
  { name: 'claude-ai', label: 'CLAUDE' },
  { name: 'gemini', label: 'GEMINI' },
  { name: 'perplexity', label: 'PERPLEXITY' },
  { name: 'grok', label: 'GROK' },
  { name: 'deepseek', label: 'DEEPSEEK' },
  { name: 'meta-ai', label: 'META AI' },
];

export function AiCheckerHero() {
  const { t, locale } = useT();
  const c = COPY[locale];
  const [rotateIdx, setRotateIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setRotateIdx((i) => (i + 1) % ROTATING_TR.length), 2200);
    return () => clearInterval(id);
  }, []);

  const [engine, suffix] = ROTATING_TR[rotateIdx];

  return (
    <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
      <div className="text-center lg:text-left">
        <p className="text-eyebrow uppercase text-brand-600 mb-5">{t('land.hero.eyebrow')}</p>

        <h1 className="hero-headline text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold tracking-tight leading-[1.05] mb-5">
          {c.titleA}{' '}
          <span className="relative inline-block">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={rotateIdx}
                variants={fadeUp}
                initial="hidden"
                animate="show"
                exit="hidden"
                className="inline-block bg-gradient-to-br from-brand-500 to-brand-700 bg-clip-text text-transparent"
              >
                {engine}
                {locale === 'tr' ? suffix : ''}
              </motion.span>
            </AnimatePresence>
            <span className="absolute -bottom-1.5 left-0 right-0 h-1.5 bg-gradient-to-r from-brand-500/40 via-brand-500 to-brand-500/40 rounded-full" />
          </span>
          {c.titleB}
        </h1>

        <p className="hero-subtitle text-base sm:text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0 leading-relaxed mb-7">
          {c.subtitle}
        </p>

        <AiVisibilityChecker />

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-x-6 gap-y-3">
          <Link
            href="/signin?signup=1"
            onClick={() => trackCta('hero_signup')}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground underline-offset-4 hover:text-brand-600 hover:underline"
          >
            {t('land.hero.signup_link')} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <WatchVideoButton label="land.hero.watch" source="hero" variant="link" size="sm" className="h-auto px-0 text-sm font-semibold" />
        </div>
      </div>

      <div className="relative hidden lg:flex items-center justify-center" aria-hidden>
        <OrbitalDiagram centerLabel={c.centerLabel} />
      </div>
    </div>
  );
}

function OrbitalDiagram({ centerLabel }: { centerLabel: string }) {
  // 480x480 tuval; motorlar merkezden 190px yaricapli cemberde, tepeden saat yonunde.
  const size = 480;
  const radius = 190;
  const centerX = size / 2;
  const centerY = size / 2;
  const angleStep = 360 / ENGINES.length;
  const stroke = 'rgb(249 115 22)';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className="absolute inset-12 rounded-full bg-brand-500/[0.06]" />
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <circle cx={centerX} cy={centerY} r={radius} fill="none" stroke={stroke} strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="4 4" />
        <circle cx={centerX} cy={centerY} r={radius * 0.65} fill="none" stroke={stroke} strokeOpacity="0.15" strokeWidth="1" />
        {ENGINES.map((_, i) => {
          const angle = (-90 + i * angleStep) * (Math.PI / 180);
          return (
            <line
              key={i}
              x1={centerX}
              y1={centerY}
              x2={centerX + radius * Math.cos(angle)}
              y2={centerY + radius * Math.sin(angle)}
              stroke={stroke}
              strokeOpacity="0.18"
              strokeWidth="1"
              strokeDasharray="2 6"
            />
          );
        })}
        {ENGINES.map((_, i) => {
          const angle = (-90 + i * angleStep) * (Math.PI / 180);
          return (
            <circle key={`d${i}`} cx={centerX + radius * 0.55 * Math.cos(angle)} cy={centerY + radius * 0.55 * Math.sin(angle)} r="3" fill={stroke} opacity="0.6">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
            </circle>
          );
        })}
      </svg>

      <div className="absolute" style={{ left: centerX - 70, top: centerY - 70, width: 140, height: 140 }}>
        <div className="relative w-full h-full">
          <div className="absolute inset-0 rounded-full border-2 border-brand-500/50 motion-safe:animate-ping opacity-30" />
          <div className="absolute inset-2 rounded-full bg-gradient-to-br from-brand-500 via-brand-600 to-brand-700 grid place-items-center shadow-2xl shadow-brand-500/40">
            <div className="text-center text-white">
              <div className="text-label font-bold uppercase tracking-widest opacity-90">{centerLabel}</div>
              <Sparkles className="mx-auto mt-1 h-6 w-6" />
            </div>
          </div>
        </div>
      </div>

      {ENGINES.map((engine, i) => {
        const angle = (-90 + i * angleStep) * (Math.PI / 180);
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        return (
          <div key={engine.name} className="absolute" style={{ left: x - 36, top: y - 36, width: 72, height: 72 }}>
            <div className="relative w-full h-full">
              {/* Beyaz zemin: renkli marka ikonlari koyu temada da gorunsun */}
              <div className="absolute inset-0 rounded-full bg-white shadow-lg shadow-brand-500/10 ring-1 ring-brand-500/20 grid place-items-center overflow-hidden">
                <VendorLogo name={engine.name} size={48} />
              </div>
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-label font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                {engine.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
