'use client';

import { useEffect, useRef } from 'react';
import { animate, stagger } from 'animejs';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScanOrb } from './scan-orb';
import { useReducedMotion } from './use-reduced-motion';

type Step = { num: number; label: string };

/**
 * Onboarding 7-adım takımyıldızı.
 * Linear bar yerine yatay yörünge: aktif düğümün etrafında HUD radar,
 * tamamlanmışlar dolu glow, tamamlananlar arası data-trace çizgisi.
 */
export function MissionMap({
  steps,
  current,
  onJump,
  className,
}: {
  steps: Step[];
  current: number;
  onJump?: (n: number) => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);

  // initial entrance + per-step bounce
  useEffect(() => {
    if (reduced || !trackRef.current) return;
    const nodes = trackRef.current.querySelectorAll('.mission-node');
    if (!nodes.length) return;

    const a = animate(nodes, {
      opacity: [{ from: 0, to: 1 }],
      translateY: [{ from: 12, to: 0 }],
      scale: [{ from: 0.85, to: 1 }],
      duration: 600,
      delay: stagger(70),
      ease: 'outQuad',
    });
    return () => { if (a.pause) a.pause(); };
  }, [reduced, steps.length]);

  // background floating dots — subtle starfield
  useEffect(() => {
    if (reduced || !dotsRef.current) return;
    const dots = dotsRef.current.querySelectorAll('.bg-dot');
    if (!dots.length) return;
    const a = animate(dots, {
      opacity: [
        { to: 0.55, duration: 1400 },
        { to: 0.1, duration: 1400 },
      ],
      scale: [
        { to: 1.4, duration: 1400 },
        { to: 1, duration: 1400 },
      ],
      loop: true,
      delay: stagger(150, { from: 'random' }),
      ease: 'inOutSine',
    });
    return () => { if (a.pause) a.pause(); };
  }, [reduced]);

  return (
    <div
      className={cn(
        'relative w-full rounded-2xl border bg-gradient-to-br from-background via-background to-brand/5 px-3 py-5 sm:px-6 sm:py-6 overflow-hidden',
        className,
      )}
    >
      {/* starfield bg */}
      <div ref={dotsRef} className="absolute inset-0 pointer-events-none" aria-hidden>
        {Array.from({ length: 18 }).map((_, i) => {
          const left = (i * 173) % 100;
          const top = (i * 61) % 100;
          return (
            <span
              key={i}
              className="bg-dot absolute h-1 w-1 rounded-full bg-brand/40"
              style={{ left: `${left}%`, top: `${top}%` }}
            />
          );
        })}
      </div>

      {/* gradient connector behind nodes */}
      <svg
        className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-12 w-[calc(100%-3rem)] pointer-events-none"
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="mm-trace-bg" x1="0" x2="1">
            <stop offset="0%" stopColor="rgb(148 163 184 / 0.25)" />
            <stop offset="100%" stopColor="rgb(148 163 184 / 0.25)" />
          </linearGradient>
          <linearGradient id="mm-trace-fill" x1="0" x2="1">
            <stop offset="0%" stopColor="rgb(124 58 237 / 0.9)" />
            <stop offset="100%" stopColor="rgb(167 139 250 / 0.9)" />
          </linearGradient>
        </defs>
        <line x1="0" y1="6" x2="100" y2="6" stroke="url(#mm-trace-bg)" strokeWidth="0.6" strokeDasharray="1.2 1.6" />
        {steps.length > 1 && (
          <line
            x1="0"
            y1="6"
            x2={Math.min(100, ((current - 1) / (steps.length - 1)) * 100)}
            y2="6"
            stroke="url(#mm-trace-fill)"
            strokeWidth="1.2"
            strokeLinecap="round"
            style={{ transition: 'all 700ms cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        )}
      </svg>

      {/* nodes row */}
      <div ref={trackRef} className="relative grid items-end" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s) => {
          const state: 'done' | 'active' | 'future' =
            s.num < current ? 'done' : s.num === current ? 'active' : 'future';
          const clickable = s.num <= current;
          return (
            <button
              key={s.num}
              type="button"
              onClick={() => clickable && onJump?.(s.num)}
              disabled={!clickable}
              className={cn(
                'mission-node relative flex flex-col items-center gap-2 group',
                clickable ? 'cursor-pointer' : 'cursor-not-allowed',
              )}
            >
              {/* node visual */}
              <div className="relative">
                {state === 'active' && (
                  <div className="text-brand">
                    <ScanOrb size="sm" state="scanning">
                      <span className="text-[10px] font-bold tabular-nums text-brand">{s.num}</span>
                    </ScanOrb>
                  </div>
                )}
                {state === 'done' && (
                  <div className="h-11 w-11 rounded-full bg-emerald-500/15 border border-emerald-500/40 grid place-items-center shadow-[0_0_0_4px_rgb(16_185_129/0.08)] group-hover:shadow-[0_0_0_6px_rgb(16_185_129/0.14)] transition-shadow">
                    <Check className="h-4 w-4 text-emerald-500" />
                  </div>
                )}
                {state === 'future' && (
                  <div className="h-11 w-11 rounded-full border border-dashed border-muted-foreground/30 grid place-items-center text-muted-foreground/50">
                    <span className="text-[11px] font-semibold">{s.num}</span>
                  </div>
                )}
              </div>

              {/* label */}
              <span
                className={cn(
                  'text-[10px] sm:text-[11px] text-center leading-tight max-w-[80px] sm:max-w-[100px] line-clamp-2 transition-colors',
                  state === 'active' && 'text-foreground font-semibold',
                  state === 'done' && 'text-foreground/70',
                  state === 'future' && 'text-muted-foreground/50',
                )}
              >
                {s.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
