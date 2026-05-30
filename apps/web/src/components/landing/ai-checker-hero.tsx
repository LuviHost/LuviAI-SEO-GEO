'use client';

import { useState, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import { AiVisibilityChecker } from './ai-visibility-checker';

const COPY = {
  tr: {
    eyebrow: 'AI VISIBILITY PLATFORM',
    titleA: 'Markanız',
    rotating: ['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Grok', 'DeepSeek', 'Meta AI'],
    titleB: "'de görünüyor mu?",
    subtitle: 'ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek ve Meta AI\'da markanızın nasıl tanındığını test edin. 30 saniyede sonuç, üye olmadan, kart bilgisi yok.',
    placeholder: 'yourdomain.com',
    btnTest: 'Test Et',
    socialProof: '7 AI motorunda hızlı görünürlük testi',
    centerLabel: 'MARKANIZ',
  },
  en: {
    eyebrow: 'AI VISIBILITY PLATFORM',
    titleA: 'Is your brand on',
    rotating: ['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Grok', 'DeepSeek', 'Meta AI'],
    titleB: '?',
    subtitle: 'See how ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek and Meta AI recognize your brand. Results in 30 seconds, no signup, no card.',
    placeholder: 'yourdomain.com',
    btnTest: 'Test',
    socialProof: 'Fast visibility test across 7 AI engines',
    centerLabel: 'YOUR BRAND',
  },
} as const;

const ENGINES: Array<{ name: VendorName; label: string }> = [
  { name: 'openai', label: 'CHATGPT' },        // Multi-color OpenAI Sphere (full brand)
  { name: 'anthropic', label: 'CLAUDE' },      // Anthropic cream "A" (official current brand)
  { name: 'gemini', label: 'GEMINI' },
  { name: 'perplexity', label: 'PERPLEXITY' },
  { name: 'grok', label: 'GROK' },
  { name: 'deepseek', label: 'DEEPSEEK' },
  { name: 'meta-ai', label: 'META AI' },       // Llama via Groq
];

export function AiCheckerHero() {
  const { locale } = useT();
  const c = COPY[locale];
  const [rotateIdx, setRotateIdx] = useState(0);

  // Rotate engine name in headline every 2s
  useEffect(() => {
    const id = setInterval(() => {
      setRotateIdx((i) => (i + 1) % c.rotating.length);
    }, 2200);
    return () => clearInterval(id);
  }, [c.rotating.length]);

  return (
    <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
      {/* LEFT — message + input */}
      <div className="text-center lg:text-left">
        <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-orange-600 mb-5">
          {c.eyebrow}
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold tracking-tight leading-[1.05] mb-5">
          {c.titleA}{' '}
          <span className="relative inline-block">
            <span
              key={rotateIdx}
              className="inline-block bg-gradient-to-br from-orange-500 to-orange-700 bg-clip-text text-transparent animate-[fadeInUp_400ms_ease-out]"
            >
              {c.rotating[rotateIdx]}
            </span>
            <span className="absolute -bottom-1.5 left-0 right-0 h-[5px] bg-gradient-to-r from-orange-500/40 via-orange-500 to-orange-500/40 rounded-full" />
          </span>
          {c.titleB}
        </h1>

        <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0 leading-relaxed mb-7">
          {c.subtitle}
        </p>

        {/* Embedded compact input — re-uses AiVisibilityChecker hero mode */}
        <div className="mb-3">
          <AiVisibilityChecker mode="hero" />
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-4">
          {c.socialProof}
        </p>
      </div>

      {/* RIGHT — Orbital diagram (6 engines around YOUR BRAND) */}
      <div className="relative hidden lg:flex items-center justify-center">
        <OrbitalDiagram centerLabel={c.centerLabel} />
      </div>
    </div>
  );
}

function OrbitalDiagram({ centerLabel }: { centerLabel: string }) {
  // Diagram is a 480x480 canvas. Engines on a circle of radius 190 from center.
  // Spacing is 360°/N starting from -90° (top), clockwise.
  const size = 480;
  const radius = 190;
  const centerX = size / 2;
  const centerY = size / 2;
  const angleStep = 360 / ENGINES.length;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Background subtle glow */}
      <div className="absolute inset-8 rounded-full bg-gradient-to-br from-orange-500/8 via-amber-400/4 to-transparent blur-2xl" />

      {/* SVG: circle outlines + connecting lines */}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="orbital-line" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(249 115 22)" stopOpacity="0.45" />
            <stop offset="60%" stopColor="rgb(249 115 22)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(249 115 22)" stopOpacity="0.08" />
          </radialGradient>
          <linearGradient id="orbital-ring" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgb(249 115 22)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(245 158 11)" stopOpacity="0.15" />
          </linearGradient>
        </defs>

        {/* Outer ring */}
        <circle
          cx={centerX} cy={centerY} r={radius}
          fill="none"
          stroke="url(#orbital-ring)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        {/* Middle ring */}
        <circle
          cx={centerX} cy={centerY} r={radius * 0.65}
          fill="none"
          stroke="rgb(249 115 22)"
          strokeOpacity="0.15"
          strokeWidth="1"
        />
        {/* Inner highlight ring */}
        <circle
          cx={centerX} cy={centerY} r={64}
          fill="url(#orbital-line)"
          opacity="0.5"
        />
        {/* Connection lines from center to each engine */}
        {ENGINES.map((_, i) => {
          const angle = (-90 + i * angleStep) * (Math.PI / 180);
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          return (
            <line
              key={i}
              x1={centerX} y1={centerY} x2={x} y2={y}
              stroke="rgb(249 115 22)"
              strokeOpacity="0.18"
              strokeWidth="1"
              strokeDasharray="2 6"
            />
          );
        })}

        {/* Orbiting pulse dots along each line */}
        {ENGINES.map((_, i) => {
          const angle = (-90 + i * angleStep) * (Math.PI / 180);
          const x = centerX + radius * 0.55 * Math.cos(angle);
          const y = centerY + radius * 0.55 * Math.sin(angle);
          return (
            <circle key={`d${i}`} cx={x} cy={y} r="3" fill="rgb(249 115 22)" opacity="0.6">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
              <animate attributeName="r" values="2;4;2" dur="2.2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
            </circle>
          );
        })}
      </svg>

      {/* CENTER badge — YOUR BRAND */}
      <div
        className="absolute"
        style={{
          left: centerX - 70,
          top: centerY - 70,
          width: 140,
          height: 140,
        }}
      >
        <div className="relative w-full h-full">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-orange-500 to-red-600 animate-pulse opacity-25 blur-xl" />
          <div className="absolute inset-0 rounded-full border-2 border-orange-500/60 animate-ping opacity-40" />
          <div className="absolute inset-2 rounded-full bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 grid place-items-center shadow-2xl shadow-orange-500/40">
            <div className="text-center text-white">
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-90">
                {centerLabel}
              </div>
              <div className="mt-1 text-2xl">✨</div>
            </div>
          </div>
        </div>
      </div>

      {/* Engine nodes (6 around the circle) */}
      {ENGINES.map((engine, i) => {
        const angle = (-90 + i * angleStep) * (Math.PI / 180);
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        return (
          <div
            key={engine.name}
            className="absolute"
            style={{
              left: x - 36,
              top: y - 36,
              width: 72,
              height: 72,
            }}
          >
            <div className="group relative w-full h-full">
              {/* Force white background so colored brand icons stay visible in dark mode */}
              <div className="absolute inset-0 rounded-full bg-white shadow-lg shadow-orange-500/10 ring-1 ring-orange-500/20 grid place-items-center hover:ring-2 hover:ring-orange-500/60 hover:scale-110 transition-all duration-300 overflow-hidden">
                <VendorLogo name={engine.name} size={48} />
              </div>
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground dark:text-white/70 whitespace-nowrap">
                {engine.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
