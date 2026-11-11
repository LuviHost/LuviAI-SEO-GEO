'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/components/ai-scan';

/*
 * PipelineGauge — FuturisticGauge'in controlled varyantı.
 * 5 yay sürekli akıcı döner, aktif step'e karşılık gelen yay kalınlaşır.
 *
 * 12.11.2026 (vitrin dili): pastel yaylar, mor çentikler, parlama filtresi ve beyaz
 * cam küre kaldırıldı — koyu panelde parlak bir top gibi duruyordu. Artık düz: nötr
 * yaylar (token), yalnız aktif yay turuncu (küçük işaret), küre kart yüzeyi + ince çizgi.
 *
 * Kullanım: backend pipeline progress göstermek için
 *   (audit, auto-fix, topic engine, article generation vb.).
 */

const ARC_COUNT = 5;
const NEUTRAL = 'hsl(var(--foreground))';
const ACTIVE = 'hsl(var(--brand-vivid))';

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

  // 5 yaylık halka, totalSteps -> 5 arcs map
  const activeArcIdx = totalSteps > 0
    ? Math.min(ARC_COUNT - 1, Math.floor((activeIdx / totalSteps) * ARC_COUNT))
    : 0;

  // Donusler CSS'e tasindi (animejs sokumu 02.09.2026): sonsuz spin —
  // GPU dostu, JS calistirmaz; reduced'da sinif hic eklenmez.
  const spinYavas = reduced ? undefined : 'pg-spin-yavas';
  const spinTers = reduced ? undefined : 'pg-spin-ters';

  return (
    <div className={`relative grid place-items-center ${className ?? ''}`}>
      <div className="relative aspect-square w-[180px] sm:w-[220px]">
        <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="absolute inset-0 w-full h-full" aria-hidden>
          <defs>
            <pattern id="pgDotGrid" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.9" fill="currentColor" opacity="0.35" />
            </pattern>
          </defs>

          {/* Dot grid */}
          <g className="text-muted-foreground/60">
            <circle cx={CENTER} cy={CENTER} r={RING_RADIUS - 18} fill="url(#pgDotGrid)" opacity="0.5" />
          </g>

          {/* Halka — 5 yay, sürekli döner; yalnız aktif yay turuncu */}
          {/* Donus merkezi: .pg-spin-* fill-box kullanir (globals.css). Satir ici "180px 180px" kutunun
              sol ustune gore okunup halkayi merkezden kaydiriyor, yaylar SVG kenarinda kirpiliyordu.
              Boyanmayan tam cember kutuyu simetrik yapar; merkez = kutu merkezi. */}
          <g
            className={spinYavas}
            style={{ transformOrigin: 'center' }}
          >
            <circle cx={CENTER} cy={CENTER} r={RING_RADIUS} fill="none" stroke="none" />
            {Array.from({ length: ARC_COUNT }).map((_, i) => {
              const start = i * (ARC_LEN_DEG + ARC_GAP_DEG);
              const end = start + ARC_LEN_DEG;
              const isActive = i === activeArcIdx;
              return (
                <path
                  key={i}
                  d={arcStrokePath(start, end, RING_RADIUS)}
                  stroke={isActive ? ACTIVE : NEUTRAL}
                  strokeWidth={isActive ? 9 : 6}
                  strokeLinecap="round"
                  strokeOpacity={isActive ? 1 : 0.16}
                  fill="none"
                  style={{
                    transition: 'stroke-width 600ms cubic-bezier(0.22, 1, 0.36, 1), stroke-opacity 600ms ease-out',
                  }}
                />
              );
            })}
          </g>

          {/* Tick ring */}
          <g className={spinTers} style={{ transformOrigin: 'center' }}>
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
                  stroke={NEUTRAL}
                  strokeOpacity={major ? 0.4 : 0.14}
                  strokeWidth={major ? 1.4 : 0.7}
                />
              );
            })}
          </g>

          {/* Merkez: düz kart yüzeyi + ince çizgi (cam küre / parlama yok) */}
          <circle cx={CENTER} cy={CENTER} r={GLOBE_RADIUS} fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth={1.5} />
        </svg>

        {/* Merkez yüzde */}
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex items-baseline gap-0.5 leading-none">
            <span
              className="text-4xl sm:text-5xl font-[450] tracking-[-0.045em] tabular-nums text-foreground"
            >
              {Math.round(percent)}
            </span>
            <span className="text-xl sm:text-2xl font-[450] tracking-[-0.04em] text-muted-foreground">%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
