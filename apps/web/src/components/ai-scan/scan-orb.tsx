'use client';

import { useEffect, useRef } from 'react';
import { animate, stagger } from 'animejs';
import { cn } from '@/lib/utils';
import { useReducedMotion } from './use-reduced-motion';

type Size = 'sm' | 'md' | 'lg' | 'xl';
type State = 'idle' | 'scanning' | 'done';

const SIZES: Record<Size, { px: number; outer: number; inner: number; center: number; tick: number; tickCount: number; strokeOuter: number; strokeArc: number }> = {
  sm: { px: 44, outer: 20, inner: 14, center: 4, tick: 2, tickCount: 36, strokeOuter: 1, strokeArc: 2 },
  md: { px: 140, outer: 64, inner: 48, center: 14, tick: 4, tickCount: 60, strokeOuter: 1.25, strokeArc: 3 },
  lg: { px: 220, outer: 100, inner: 76, center: 22, tick: 6, tickCount: 84, strokeOuter: 1.5, strokeArc: 4 },
  xl: { px: 320, outer: 145, inner: 110, center: 30, tick: 8, tickCount: 108, strokeOuter: 1.75, strokeArc: 5 },
};

const ARC_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6'];

export function ScanOrb({
  size = 'md',
  state = 'scanning',
  label,
  percent,
  className,
  children,
}: {
  size?: Size;
  state?: State;
  label?: string;
  percent?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const cfg = SIZES[size];
  const cx = cfg.px / 2;
  const cy = cfg.px / 2;

  const outerRingRef = useRef<SVGGElement>(null);
  const scanBeamRef = useRef<SVGGElement>(null);
  const colorArcsRef = useRef<SVGGElement>(null);
  const ticksRef = useRef<SVGGElement>(null);
  const centerRef = useRef<SVGGElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (reduced || state === 'idle') return;

    const animations: Array<{ pause?: () => void } | null> = [];

    if (outerRingRef.current) {
      animations.push(
        animate(outerRingRef.current, {
          rotate: 360,
          duration: 14000,
          loop: true,
          ease: 'linear',
        }),
      );
    }

    if (scanBeamRef.current && state === 'scanning') {
      animations.push(
        animate(scanBeamRef.current, {
          rotate: 360,
          duration: 2800,
          loop: true,
          ease: 'linear',
        }),
      );
    }

    if (colorArcsRef.current) {
      animations.push(
        animate(colorArcsRef.current, {
          rotate: -360,
          duration: 32000,
          loop: true,
          ease: 'linear',
        }),
      );
    }

    if (ticksRef.current) {
      const tickEls = ticksRef.current.querySelectorAll('.scan-tick');
      if (tickEls.length) {
        animations.push(
          animate(tickEls, {
            opacity: [
              { to: 0.95, duration: 600 },
              { to: 0.25, duration: 1000 },
            ],
            scaleY: [
              { to: 1.6, duration: 600, ease: 'outQuad' },
              { to: 1, duration: 1000, ease: 'inOutSine' },
            ],
            loop: true,
            delay: stagger(60, { from: 'first' }),
          }),
        );
      }
    }

    if (centerRef.current) {
      animations.push(
        animate(centerRef.current, {
          scale: [
            { to: 1.18, duration: 900, ease: 'outQuad' },
            { to: 1, duration: 900, ease: 'inOutSine' },
          ],
          opacity: [
            { to: 1, duration: 900 },
            { to: 0.7, duration: 900 },
          ],
          loop: true,
        }),
      );
    }

    if (haloRef.current) {
      animations.push(
        animate(haloRef.current, {
          opacity: [0.45, 0.15, 0.45],
          scale: [1, 1.08, 1],
          duration: 2400,
          loop: true,
          ease: 'inOutSine',
        }),
      );
    }

    return () => {
      animations.forEach((a) => { if (a && a.pause) a.pause(); });
    };
  }, [reduced, state]);

  const tickInner = cfg.inner - cfg.tick - 1;
  const tickOuter = cfg.inner;

  const arcLength = (radius: number, deg: number) => (Math.PI * 2 * radius * deg) / 360;
  const arcCirc = (radius: number) => Math.PI * 2 * radius;

  const arcDeg = 50;
  const arcStrokeDash = (radius: number) => `${arcLength(radius, arcDeg)} ${arcCirc(radius)}`;
  const arcOffset = (radius: number, startDeg: number) => -arcLength(radius, startDeg);

  return (
    <div
      className={cn('relative inline-grid place-items-center', className)}
      style={{ width: cfg.px, height: cfg.px }}
    >
      <svg
        width={cfg.px}
        height={cfg.px}
        viewBox={`0 0 ${cfg.px} ${cfg.px}`}
        className="absolute inset-0"
        aria-hidden
      >
        <defs>
          <radialGradient id={`scan-halo-${size}`}>
            <stop offset="0%" stopColor="rgb(124 58 237 / 0.5)" />
            <stop offset="70%" stopColor="rgb(124 58 237 / 0.05)" />
            <stop offset="100%" stopColor="rgb(124 58 237 / 0)" />
          </radialGradient>
          <linearGradient id={`scan-beam-${size}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgb(124 58 237 / 0)" />
            <stop offset="60%" stopColor="rgb(167 139 250 / 0.7)" />
            <stop offset="100%" stopColor="rgb(196 181 253 / 1)" />
          </linearGradient>
        </defs>

        <circle
          ref={haloRef}
          cx={cx}
          cy={cy}
          r={cfg.outer + 2}
          fill={`url(#scan-halo-${size})`}
          opacity={0.35}
          style={{ transformOrigin: 'center', transformBox: 'fill-box' }}
        />

        <g
          ref={outerRingRef}
          style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: 'fill-box' }}
        >
          <circle
            cx={cx}
            cy={cy}
            r={cfg.outer}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth={cfg.strokeOuter}
            strokeDasharray={size === 'sm' ? '2 3' : '3 5'}
          />
        </g>

        <g
          ref={colorArcsRef}
          style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: 'fill-box' }}
        >
          {ARC_COLORS.map((color, i) => {
            const startDeg = i * (360 / ARC_COLORS.length);
            const r = cfg.outer - 1.5;
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={color}
                strokeWidth={cfg.strokeArc}
                strokeLinecap="round"
                strokeDasharray={arcStrokeDash(r)}
                strokeDashoffset={arcOffset(r, startDeg)}
                opacity={0.85}
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            );
          })}
        </g>

        {state === 'scanning' && (
          <g
            ref={scanBeamRef}
            style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: 'fill-box' }}
          >
            <circle
              cx={cx}
              cy={cy}
              r={cfg.outer - 4}
              fill="none"
              stroke={`url(#scan-beam-${size})`}
              strokeWidth={cfg.strokeArc + 1}
              strokeLinecap="round"
              strokeDasharray={`${arcLength(cfg.outer - 4, 28)} ${arcCirc(cfg.outer - 4)}`}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          </g>
        )}

        <g ref={ticksRef}>
          {Array.from({ length: cfg.tickCount }).map((_, i) => {
            const angle = (i / cfg.tickCount) * Math.PI * 2 - Math.PI / 2;
            const x1 = cx + Math.cos(angle) * tickInner;
            const y1 = cy + Math.sin(angle) * tickInner;
            const x2 = cx + Math.cos(angle) * tickOuter;
            const y2 = cy + Math.sin(angle) * tickOuter;
            return (
              <line
                key={i}
                className="scan-tick"
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="currentColor"
                strokeOpacity="0.55"
                strokeWidth={size === 'sm' ? 0.8 : 1.2}
                strokeLinecap="round"
                style={{ transformOrigin: `${(x1 + x2) / 2}px ${(y1 + y2) / 2}px`, transformBox: 'fill-box' }}
              />
            );
          })}
        </g>

        <g
          ref={centerRef}
          style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: 'fill-box' }}
        >
          <circle
            cx={cx}
            cy={cy}
            r={cfg.center}
            fill={state === 'done' ? '#10b981' : 'currentColor'}
            opacity={0.92}
          />
          {state === 'done' && (
            <path
              d={`M ${cx - cfg.center * 0.5} ${cy + 0.5} L ${cx - cfg.center * 0.1} ${cy + cfg.center * 0.4} L ${cx + cfg.center * 0.55} ${cy - cfg.center * 0.35}`}
              fill="none"
              stroke="white"
              strokeWidth={size === 'sm' ? 1.2 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      </svg>

      {(children || (typeof percent === 'number' && size !== 'sm') || (label && size !== 'sm')) && (
        <div className="relative z-10 grid place-items-center text-center pointer-events-none">
          {children}
          {typeof percent === 'number' && size !== 'sm' && (
            <span className="text-xs font-mono font-semibold tabular-nums text-foreground/90 mt-1">
              %{Math.round(percent)}
            </span>
          )}
          {label && (size === 'lg' || size === 'xl') && (
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
              {label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
