'use client';

import { useState, useEffect } from 'react';
import { useT } from '@/lib/i18n';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import { AiVisibilityChecker } from './ai-visibility-checker';

const COPY = {
  tr: {
    eyebrow: '7 AI MOTORU · 30 SANİYEDE SONUÇ',
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
    eyebrow: '7 AI ENGINES · RESULTS IN 30 SEC',
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
  { name: 'chatgpt', label: 'CHATGPT' },       // Yesil iOS app icon
  { name: 'claude-ai', label: 'CLAUDE' },      // Turuncu yildiz/burst (Claude AI app icon)
  { name: 'gemini', label: 'GEMINI' },
  { name: 'perplexity', label: 'PERPLEXITY' },
  { name: 'grok', label: 'GROK' },
  { name: 'deepseek', label: 'DEEPSEEK' },
  { name: 'meta-ai', label: 'META AI' },       // Llama via Groq, gradient ring
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
        {/* Mono eyebrow — "ölçüm sesi" (hero her temada ink zemin, renkler sabit) */}
        <div className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-brand-400 mb-5">
          {c.eyebrow}
        </div>

        <h1 className="hero-headline font-brandDisplay text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold tracking-[-0.035em] leading-[1.02] text-bone mb-5">
          {c.titleA}{' '}
          <span className="relative inline-block">
            <span
              key={rotateIdx}
              className="inline-block text-brand-400 animate-[luvi-fade-up_400ms_ease-out_both]"
            >
              {c.rotating[rotateIdx]}
            </span>
            <span className="absolute -bottom-1.5 left-0 right-0 h-1 bg-brand" />
          </span>
          {c.titleB}
        </h1>

        <p className="hero-subtitle text-base sm:text-lg text-[#A99F92] max-w-xl mx-auto lg:mx-0 leading-relaxed mb-7">
          {c.subtitle}
        </p>

        {/* Embedded compact input — re-uses AiVisibilityChecker hero mode */}
        <div className="mb-3">
          <AiVisibilityChecker mode="hero" />
        </div>

        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#A99F92] mt-4">
          {c.socialProof}
        </p>
      </div>

      {/* RIGHT — Orbital diagram (7 engines around YOUR BRAND) */}
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
    <div className="relative text-bone" style={{ width: size, height: size }}>
      {/* SVG: hairline halkalar + bağlantı çizgileri — teknik çizim dili, glow yok */}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer ring */}
        <circle
          cx={centerX} cy={centerY} r={radius}
          fill="none"
          stroke="#F6F3EC"
          strokeOpacity="0.14"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        {/* Middle ring */}
        <circle
          cx={centerX} cy={centerY} r={radius * 0.65}
          fill="none"
          stroke="#F6F3EC"
          strokeOpacity="0.07"
          strokeWidth="1"
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
              stroke="#F6F3EC"
              strokeOpacity="0.10"
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
            <circle key={`d${i}`} cx={x} cy={y} r="3" fill="#E04E24" opacity="0.6">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
              <animate attributeName="r" values="2;4;2" dur="2.2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
            </circle>
          );
        })}
      </svg>

      {/* CENTER badge — YOUR BRAND (flat turuncu, wordmark oku ile) */}
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
          <div className="absolute inset-0 rounded-full border border-brand-400/50 animate-ping opacity-40" />
          <div className="absolute inset-2 rounded-full bg-brand border border-bone/20 grid place-items-center">
            <div className="text-center text-paper">
              <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] opacity-90">
                {centerLabel}
              </div>
              <div className="mt-1 text-2xl font-brandDisplay font-bold leading-none">↗</div>
            </div>
          </div>
        </div>
      </div>

      {/* Engine nodes (7 around the circle) */}
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
              {/* Force white background so colored brand icons stay visible on ink */}
              <div className="absolute inset-0 rounded-full bg-white ring-1 ring-bone/25 grid place-items-center hover:ring-2 hover:ring-brand-400/70 hover:scale-105 transition-all duration-300 overflow-hidden">
                <VendorLogo name={engine.name} size={48} />
              </div>
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#A99F92] whitespace-nowrap">
                {engine.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
