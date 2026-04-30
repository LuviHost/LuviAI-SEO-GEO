'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import { cn } from '@/lib/utils';
import { useReducedMotion } from './use-reduced-motion';

/**
 * "Mission Console" içerik paneli.
 * 4 köşe braketi + üstte terminal başlığı (>> 03 / 07 STEP_LABEL) +
 * brand-glow border + scan line animasyonu.
 */
export function ConsolePanel({
  step,
  total,
  label,
  status = 'ACTIVE',
  children,
  className,
  bodyClassName,
}: {
  step: number;
  total: number;
  label: string;
  status?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const reduced = useReducedMotion();
  const scanlineRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastStepRef = useRef<number>(step);

  // continuous scanline sweep
  useEffect(() => {
    if (reduced || !scanlineRef.current) return;
    const a = animate(scanlineRef.current, {
      translateY: ['-10%', '110%'],
      opacity: [
        { to: 0.6, duration: 200 },
        { to: 0.6, duration: 2400 },
        { to: 0, duration: 600 },
      ],
      duration: 3200,
      loop: true,
      ease: 'inOutSine',
    });
    return () => { if (a.pause) a.pause(); };
  }, [reduced]);

  // step change → body fade-in
  useEffect(() => {
    if (reduced || !bodyRef.current) return;
    if (lastStepRef.current !== step) {
      animate(bodyRef.current, {
        opacity: [{ from: 0, to: 1 }],
        translateY: [{ from: 8, to: 0 }],
        duration: 480,
        ease: 'outQuad',
      });
      lastStepRef.current = step;
    }
  }, [step, reduced]);

  const stepStr = String(step).padStart(2, '0');
  const totalStr = String(total).padStart(2, '0');
  const labelToken = label.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_İŞĞÜÇÖ]/g, '');

  return (
    <div className={cn('relative', className)}>
      {/* terminal header */}
      <div className="flex items-center gap-3 mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.2em]">
        <span className="flex items-center gap-1.5 text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
          <span className="font-semibold">&gt;&gt; {stepStr} / {totalStr}</span>
        </span>
        <span className="text-foreground/70">{labelToken}</span>
        <span className="ml-auto flex items-center gap-2 text-emerald-500/80">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {status}
        </span>
      </div>

      {/* main panel */}
      <div className="relative rounded-2xl border border-brand/25 bg-card/70 backdrop-blur-sm shadow-[0_0_0_1px_rgb(124_58_237_/_0.05),0_20px_60px_-20px_rgb(124_58_237_/_0.25)] overflow-hidden">
        {/* corner brackets (4) */}
        <CornerBracket pos="tl" />
        <CornerBracket pos="tr" />
        <CornerBracket pos="bl" />
        <CornerBracket pos="br" />

        {/* scanline */}
        <div className="absolute inset-x-0 top-0 h-full pointer-events-none overflow-hidden">
          <div
            ref={scanlineRef}
            className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-brand/60 to-transparent"
            style={{ filter: 'blur(1px)' }}
          />
        </div>

        {/* body */}
        <div ref={bodyRef} className={cn('relative p-6 sm:p-8', bodyClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const base = 'absolute h-5 w-5 border-brand/60 pointer-events-none';
  const variant = {
    tl: 'top-0 left-0 border-t-2 border-l-2 rounded-tl-2xl',
    tr: 'top-0 right-0 border-t-2 border-r-2 rounded-tr-2xl',
    bl: 'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl',
    br: 'bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl',
  }[pos];
  return <span className={cn(base, variant)} aria-hidden />;
}
