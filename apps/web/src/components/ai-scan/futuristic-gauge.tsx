'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Database, Brain, TrendingUp, Globe2, AudioLines } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useReducedMotion } from './use-reduced-motion';

/*
 * FuturisticGauge — LuviAI orbital halka.
 *
 * Yapı:
 *   - 5 pastel yay (her faz için bir tane), tek bir grup içinde sürekli akıcı döner (40s/turn)
 *   - Aktif faz yayı kalınlaşır + glow alır
 *   - Tick ring ters yönde döner (90s) — parallax derinlik
 *   - Açık cam küre merkez, BÜYÜK % yazısı + faz pill + ikon
 *   - Faz değiştiğinde sadece pill/ikon/label crossfade olur, halka akmaya devam eder
 */

type Phase = {
  key: string;
  label: string;
  color: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const PHASES: Phase[] = [
  { key: 'data', label: 'Veriler işleniyor', color: '#7dd3fc', Icon: Database }, // sky-300
  { key: 'ai', label: 'AI çalışıyor', color: '#c4b5fd', Icon: Brain }, // violet-300
  { key: 'seo', label: 'SEO yapılıyor', color: '#fda4af', Icon: TrendingUp }, // rose-300
  { key: 'geo', label: 'GEO yapılıyor', color: '#fcd34d', Icon: Globe2 }, // amber-300
  { key: 'aeo', label: 'AEO yapılıyor', color: '#86efac', Icon: AudioLines }, // green-300
];

const PHASE_DURATION_MS = 3300;
const TOTAL_TICKS = 80;

// Geometry
const VIEW = 400;
const CENTER = VIEW / 2;
const RING_RADIUS = 174;
const TICK_RADIUS_OUTER = 150;
const TICK_RADIUS_INNER = 142;
const GLOBE_RADIUS = 116;

// Yay başına 50° + 22° boşluk = 72°, 5 × 72° = 360°
const ARC_LEN_DEG = 50;
const ARC_GAP_DEG = 22;

function arcStrokePath(startDeg: number, endDeg: number, r: number) {
  const a1 = ((startDeg - 90) * Math.PI) / 180;
  const a2 = ((endDeg - 90) * Math.PI) / 180;
  const x1 = CENTER + r * Math.cos(a1);
  const y1 = CENTER + r * Math.sin(a1);
  const x2 = CENTER + r * Math.cos(a2);
  const y2 = CENTER + r * Math.sin(a2);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function FuturisticGauge({
  className,
  progressPercent,
  done = false,
}: {
  className?: string;
  progressPercent?: number;
  done?: boolean;
}) {
  const reduced = useReducedMotion();
  const [phaseIdx, setPhaseIdx] = useState(0);
  const ringGroupRef = useRef<SVGGElement>(null);
  const tickRingRef = useRef<SVGGElement>(null);
  const iconBoxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLDivElement>(null);
  const lastPctRef = useRef<number>(progressPercent ?? 0);

  // Phase cycling
  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      setPhaseIdx((i) => (i + 1) % PHASES.length);
    }, PHASE_DURATION_MS);
    return () => clearInterval(id);
  }, [done]);

  // Ring grup — sürekli yumuşak dönüş (saat yönü, 40sn/turn)
  useEffect(() => {
    if (reduced || !ringGroupRef.current) return;
    const a = animate(ringGroupRef.current, {
      rotate: [0, 360],
      duration: 40_000,
      ease: 'linear',
      loop: true,
    });
    return () => { a.pause(); };
  }, [reduced]);

  // Tick ring — ters yöne, daha yavaş (parallax derinlik)
  useEffect(() => {
    if (reduced || !tickRingRef.current) return;
    const a = animate(tickRingRef.current, {
      rotate: [0, -360],
      duration: 120_000,
      ease: 'linear',
      loop: true,
    });
    return () => { a.pause(); };
  }, [reduced]);

  // Icon + label crossfade
  useEffect(() => {
    if (reduced) return;
    if (iconBoxRef.current) {
      animate(iconBoxRef.current, {
        opacity: [{ to: 0, duration: 160 }, { to: 1, duration: 480 }],
        scale: [{ to: 0.88, duration: 160 }, { to: 1, duration: 480, ease: 'outBack' }],
      });
    }
    if (labelRef.current) {
      animate(labelRef.current, {
        opacity: [{ to: 0, duration: 160 }, { to: 1, duration: 480 }],
        translateY: [{ to: 6, duration: 160 }, { to: 0, duration: 480, ease: 'outQuad' }],
      });
    }
  }, [phaseIdx, reduced]);

  // Yüzde değişiminde count-up
  useEffect(() => {
    if (typeof progressPercent !== 'number' || !pctRef.current || reduced) {
      lastPctRef.current = progressPercent ?? 0;
      return;
    }
    const from = lastPctRef.current;
    const to = progressPercent;
    if (Math.abs(to - from) < 0.5) return;
    const obj = { v: from };
    const node = pctRef.current;
    animate(obj, {
      v: to,
      duration: 700,
      ease: 'outQuad',
      onUpdate: () => {
        if (node) node.textContent = `${Math.round(obj.v)}`;
      },
    });
    lastPctRef.current = to;
  }, [progressPercent, reduced]);

  const phase = PHASES[phaseIdx];
  const PhaseIcon = phase.Icon;
  const pctDisplay = Math.round(progressPercent ?? 0);

  return (
    <div className={cn('relative w-full grid place-items-center', className)}>
      <div className="relative aspect-square w-[280px] sm:w-[320px] md:w-[360px]">
        <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="absolute inset-0 w-full h-full" aria-hidden>
          <defs>
            <pattern id="dotGrid" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.9" fill="currentColor" opacity="0.35" />
            </pattern>

            <radialGradient id="globeBody" cx="50%" cy="40%" r="65%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="60%" stopColor="#faf5ff" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#ede9fe" stopOpacity="0.82" />
            </radialGradient>

            <radialGradient id="globeGloss" cx="32%" cy="22%" r="42%">
              <stop offset="0%" stopColor="white" stopOpacity="0.85" />
              <stop offset="55%" stopColor="white" stopOpacity="0.15" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>

            <radialGradient id="rimGlow" cx="50%" cy="50%" r="50%">
              <stop offset="78%" stopColor={phase.color} stopOpacity="0" />
              <stop offset="100%" stopColor={phase.color} stopOpacity="0.4" />
            </radialGradient>

            {/* Soft glow filter for arcs */}
            <filter id="arcGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Dot grid */}
          <g className="text-violet-400/45">
            <circle cx={CENTER} cy={CENTER} r={RING_RADIUS - 18} fill="url(#dotGrid)" opacity="0.5" />
          </g>

          {/* Halka — 5 yay, tek grup, akıcı döner */}
          <g
            ref={ringGroupRef}
            style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
            filter="url(#arcGlow)"
          >
            {PHASES.map((p, i) => {
              const start = i * (ARC_LEN_DEG + ARC_GAP_DEG);
              const end = start + ARC_LEN_DEG;
              const isActive = i === phaseIdx;
              return (
                <g key={p.key}>
                  {/* Soft track — yayın silik şekli */}
                  <path
                    d={arcStrokePath(start, end, RING_RADIUS)}
                    stroke={p.color}
                    strokeWidth={isActive ? 11 : 7}
                    strokeLinecap="round"
                    strokeOpacity={isActive ? 0.95 : 0.55}
                    fill="none"
                    style={{
                      transition: 'stroke-width 600ms cubic-bezier(0.22, 1, 0.36, 1), stroke-opacity 600ms ease-out',
                    }}
                  />
                </g>
              );
            })}
          </g>

          {/* Tick ring — ters yön, parallax */}
          <g ref={tickRingRef} style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}>
            {Array.from({ length: TOTAL_TICKS }).map((_, i) => {
              const angle = (i / TOTAL_TICKS) * 360 - 90;
              const rad = (angle * Math.PI) / 180;
              const x1 = CENTER + TICK_RADIUS_OUTER * Math.cos(rad);
              const y1 = CENTER + TICK_RADIUS_OUTER * Math.sin(rad);
              const x2 = CENTER + TICK_RADIUS_INNER * Math.cos(rad);
              const y2 = CENTER + TICK_RADIUS_INNER * Math.sin(rad);
              const major = i % 5 === 0;
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#7c3aed"
                  strokeOpacity={major ? 0.5 : 0.16}
                  strokeWidth={major ? 1.4 : 0.7}
                />
              );
            })}
          </g>

          {/* Açık cam küre */}
          <circle cx={CENTER} cy={CENTER} r={GLOBE_RADIUS} fill="url(#globeBody)" />
          <circle cx={CENTER} cy={CENTER} r={GLOBE_RADIUS} fill="url(#rimGlow)" />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={GLOBE_RADIUS}
            fill="none"
            stroke={phase.color}
            strokeOpacity={0.4}
            strokeWidth={1}
            style={{ transition: 'stroke 600ms ease-out' }}
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={GLOBE_RADIUS - 8}
            fill="none"
            stroke="#7c3aed"
            strokeOpacity={0.08}
            strokeWidth={0.8}
          />
          <ellipse
            cx={CENTER - 18}
            cy={CENTER - 36}
            rx={GLOBE_RADIUS * 0.7}
            ry={GLOBE_RADIUS * 0.4}
            fill="url(#globeGloss)"
          />
        </svg>

        {/* Merkez içerik */}
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center justify-center gap-2 text-center px-6">
            {/* Faz pill */}
            <div
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.2em] font-semibold"
              style={{
                color: phase.color,
                backgroundColor: `${phase.color}1f`,
                border: `1px solid ${phase.color}55`,
              }}
            >
              <span className="h-1 w-1 rounded-full animate-pulse" style={{ backgroundColor: phase.color }} />
              {phase.key.toUpperCase()}
            </div>

            {/* BÜYÜK YÜZDE */}
            <div className="flex items-baseline gap-0.5 leading-none">
              <span
                ref={pctRef}
                className="text-5xl sm:text-6xl font-bold tracking-tight tabular-nums text-brand"
                style={{ transition: 'color 600ms ease-out' }}
              >
                {pctDisplay}
              </span>
              <span className="text-2xl sm:text-3xl font-semibold text-foreground/40">
                %
              </span>
            </div>

            {/* Faz label + küçük ikon */}
            <div ref={labelRef} className="flex items-center gap-1.5">
              <PhaseIcon
                className="h-3.5 w-3.5"
                style={{ color: phase.color }}
              />
              <span className="text-[11px] sm:text-xs font-medium tracking-tight text-foreground/75">
                {phase.label}
              </span>
            </div>
          </div>
        </div>

        {/* Faz indikatörü (alt) */}
        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
          {PHASES.map((p, i) => {
            const active = i === phaseIdx;
            const past = i < phaseIdx;
            return (
              <span
                key={p.key}
                className="rounded-full transition-all duration-500"
                style={{
                  width: active ? '20px' : '6px',
                  height: '6px',
                  backgroundColor: active ? p.color : past ? `${p.color}88` : `${p.color}33`,
                  boxShadow: active ? `0 0 10px ${p.color}cc` : 'none',
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
