'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import { useReducedMotion } from '@/components/ai-scan';

/*
 * PipelineGauge — FuturisticGauge'in controlled varyantı.
 * Onboarding gauge ile aynı görsel: 5 pastel yay sürekli akıcı döner,
 * aktif step'e karşılık gelen yay kalınlaşır.
 *
 * Kullanım: backend pipeline progress göstermek için
 *   (audit, auto-fix, topic engine, article generation vb.).
 */

const PASTEL_COLORS = [
  '#7dd3fc', // sky-300
  '#c4b5fd', // violet-300
  '#fda4af', // rose-300
  '#fcd34d', // amber-300
  '#86efac', // green-300
];

const TOTAL_TICKS = 80;
const VIEW = 360;
const CENTER = VIEW / 2;
const RING_RADIUS = 158;
const TICK_RADIUS_OUTER = 134;
const TICK_RADIUS_INNER = 126;
const GLOBE_RADIUS = 100;

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

export function PipelineGauge({
  activeIdx,
  totalSteps,
  percent,
  className,
}: {
  activeIdx: number; // 0..totalSteps-1
  totalSteps: number;
  percent: number; // 0..100
  className?: string;
}) {
  const reduced = useReducedMotion();
  const ringGroupRef = useRef<SVGGElement>(null);
  const tickRingRef = useRef<SVGGElement>(null);

  // 5 yaylık halka, totalSteps -> 5 arcs map
  const activeArcIdx = totalSteps > 0
    ? Math.min(PASTEL_COLORS.length - 1, Math.floor((activeIdx / totalSteps) * PASTEL_COLORS.length))
    : 0;
  const activeColor = PASTEL_COLORS[activeArcIdx];

  // Ring grup — sürekli yumuşak dönüş
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

  // Tick ring — ters yön
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

  return (
    <div className={`relative grid place-items-center ${className ?? ''}`}>
      <div className="relative aspect-square w-[180px] sm:w-[220px]">
        <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="absolute inset-0 w-full h-full" aria-hidden>
          <defs>
            <pattern id="pgDotGrid" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.9" fill="currentColor" opacity="0.35" />
            </pattern>

            <radialGradient id="pgGlobeBody" cx="50%" cy="40%" r="65%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="60%" stopColor="#faf5ff" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#ede9fe" stopOpacity="0.82" />
            </radialGradient>

            <radialGradient id="pgGlobeGloss" cx="32%" cy="22%" r="42%">
              <stop offset="0%" stopColor="white" stopOpacity="0.85" />
              <stop offset="55%" stopColor="white" stopOpacity="0.15" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>

            <radialGradient id="pgRimGlow" cx="50%" cy="50%" r="50%">
              <stop offset="78%" stopColor={activeColor} stopOpacity="0" />
              <stop offset="100%" stopColor={activeColor} stopOpacity="0.4" />
            </radialGradient>

            <filter id="pgArcGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Dot grid */}
          <g className="text-violet-400/45">
            <circle cx={CENTER} cy={CENTER} r={RING_RADIUS - 18} fill="url(#pgDotGrid)" opacity="0.5" />
          </g>

          {/* Halka — 5 pastel yay, sürekli döner */}
          <g
            ref={ringGroupRef}
            style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
            filter="url(#pgArcGlow)"
          >
            {PASTEL_COLORS.map((color, i) => {
              const start = i * (ARC_LEN_DEG + ARC_GAP_DEG);
              const end = start + ARC_LEN_DEG;
              const isActive = i === activeArcIdx;
              return (
                <path
                  key={i}
                  d={arcStrokePath(start, end, RING_RADIUS)}
                  stroke={color}
                  strokeWidth={isActive ? 11 : 7}
                  strokeLinecap="round"
                  strokeOpacity={isActive ? 0.95 : 0.55}
                  fill="none"
                  style={{
                    transition: 'stroke-width 600ms cubic-bezier(0.22, 1, 0.36, 1), stroke-opacity 600ms ease-out',
                  }}
                />
              );
            })}
          </g>

          {/* Tick ring */}
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
          <circle cx={CENTER} cy={CENTER} r={GLOBE_RADIUS} fill="url(#pgGlobeBody)" />
          <circle cx={CENTER} cy={CENTER} r={GLOBE_RADIUS} fill="url(#pgRimGlow)" />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={GLOBE_RADIUS}
            fill="none"
            stroke={activeColor}
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
            cx={CENTER - 14}
            cy={CENTER - 28}
            rx={GLOBE_RADIUS * 0.7}
            ry={GLOBE_RADIUS * 0.4}
            fill="url(#pgGlobeGloss)"
          />
        </svg>

        {/* Merkez yüzde */}
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex items-baseline gap-0.5 leading-none">
            <span
              className="text-4xl sm:text-5xl font-bold tracking-tight tabular-nums text-brand"
              style={{ transition: 'color 600ms ease-out' }}
            >
              {Math.round(percent)}
            </span>
            <span className="text-xl sm:text-2xl font-semibold text-foreground/40">%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
