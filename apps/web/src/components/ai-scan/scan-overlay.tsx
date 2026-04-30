'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScanOrb } from './scan-orb';
import { useReducedMotion } from './use-reduced-motion';

export type PipelineStep = {
  label: string;
  sublabel?: string;
  durationMs: number;
};

/**
 * Çalışan pipeline'lar için animasyonlu HUD scanner.
 * (PipelineProgress'in görsel katmanı — bar yerine geçen sahne.)
 */
export function ScanOverlay({
  steps,
  elapsed,
  totalMs,
  currentIdx,
  title,
  className,
}: {
  steps: PipelineStep[];
  elapsed: number;
  totalMs: number;
  currentIdx: number;
  title?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const safeIdx = Math.min(currentIdx, steps.length - 1);
  const current = steps[safeIdx];
  const pct = Math.min(98, (elapsed / totalMs) * 100);
  const remainingSec = Math.max(1, Math.ceil((totalMs - elapsed) / 1000));

  const labelRef = useRef<HTMLDivElement>(null);
  const lastIdxRef = useRef<number>(-1);

  // crossfade label when step changes
  useEffect(() => {
    if (reduced || !labelRef.current) {
      lastIdxRef.current = safeIdx;
      return;
    }
    if (lastIdxRef.current !== -1 && lastIdxRef.current !== safeIdx) {
      animate(labelRef.current, {
        opacity: [{ to: 0, duration: 180 }, { to: 1, duration: 360 }],
        translateY: [{ to: -6, duration: 180 }, { to: 0, duration: 360, ease: 'outQuad' }],
      });
    }
    lastIdxRef.current = safeIdx;
  }, [safeIdx, reduced]);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-gradient-to-br from-background via-background to-muted/30 p-6 sm:p-8',
        'before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_70%_30%,rgb(124_58_237/0.08),transparent_60%)] before:pointer-events-none',
        className,
      )}
    >
      {title && (
        <div className="relative flex items-center gap-2 pb-4 mb-4 border-b border-border/40">
          <Sparkles className="h-4 w-4 text-brand" />
          <h3 className="font-semibold text-sm">{title}</h3>
          <span className="ml-auto text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            ~{remainingSec}sn
          </span>
        </div>
      )}

      <div className="relative flex items-center gap-6 sm:gap-8">
        {/* HUD scanner */}
        <div className="shrink-0 text-brand">
          <ScanOrb size="md" state="scanning" percent={pct}>
            <Sparkles className="h-5 w-5 text-brand" />
          </ScanOrb>
        </div>

        {/* live label + step list */}
        <div className="min-w-0 flex-1">
          <div ref={labelRef}>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
              Adım {Math.min(safeIdx + 1, steps.length)} / {steps.length}
            </div>
            <div className="text-base sm:text-lg font-semibold mt-1 truncate">
              {current.label}
            </div>
            {current.sublabel && (
              <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {current.sublabel}
              </div>
            )}
          </div>

          <ol className="mt-4 grid gap-1.5 grid-cols-1 sm:grid-cols-2">
            {steps.map((step, i) => {
              const done = i < safeIdx;
              const active = i === safeIdx;
              return (
                <li
                  key={i}
                  className={cn(
                    'flex items-center gap-2 text-xs transition-colors duration-300',
                    done && 'text-foreground/60',
                    active && 'text-foreground font-medium',
                    !done && !active && 'text-muted-foreground/40',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full shrink-0 transition-all duration-300',
                      done && 'bg-emerald-500',
                      active && 'bg-brand animate-pulse',
                      !done && !active && 'bg-muted-foreground/30',
                    )}
                  />
                  <span className="truncate">{step.label}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
