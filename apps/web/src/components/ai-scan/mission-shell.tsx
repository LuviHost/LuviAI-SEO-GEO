'use client';

import { useEffect, useRef } from 'react';
import { animate, stagger } from 'animejs';
import { cn } from '@/lib/utils';
import { ScanOrb } from './scan-orb';
import { useReducedMotion } from './use-reduced-motion';

/**
 * Mission Console arka plan kabuğu — animejs.com tarzı dijital sahne.
 *
 * Katmanlar:
 *  - Radial brand glow (sol-üst + sağ-alt vignette)
 *  - Hex grid pattern (CSS, sabit)
 *  - Animated starfield (28 nokta, stagger pulse)
 *  - Sağ üst köşede dekoratif HUD orb (xl, sürekli scanning)
 */
export function MissionShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const dotsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced || !dotsRef.current) return;
    const dots = dotsRef.current.querySelectorAll('.shell-dot');
    if (!dots.length) return;
    const a = animate(dots, {
      opacity: [
        { to: 0.65, duration: 1800 },
        { to: 0.08, duration: 1800 },
      ],
      scale: [
        { to: 1.5, duration: 1800 },
        { to: 0.8, duration: 1800 },
      ],
      loop: true,
      delay: stagger(180, { from: 'random' }),
      ease: 'inOutSine',
    });
    return () => { if (a.pause) a.pause(); };
  }, [reduced]);

  return (
    <div
      className={cn(
        'relative min-h-[calc(100vh-4rem)] overflow-hidden',
        'bg-[radial-gradient(ellipse_at_top_left,rgb(124_58_237/0.08),transparent_45%),radial-gradient(ellipse_at_bottom_right,rgb(56_189_248/0.05),transparent_50%)]',
        className,
      )}
    >
      {/* hex grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgb(124 58 237) 1px, transparent 1px), linear-gradient(90deg, rgb(124 58 237) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
        aria-hidden
      />

      {/* starfield */}
      <div ref={dotsRef} className="absolute inset-0 pointer-events-none" aria-hidden>
        {Array.from({ length: 28 }).map((_, i) => {
          const left = (i * 173) % 100;
          const top = (i * 61) % 100;
          const isBig = i % 7 === 0;
          return (
            <span
              key={i}
              className={cn(
                'shell-dot absolute rounded-full',
                isBig ? 'h-1.5 w-1.5 bg-brand/60' : 'h-1 w-1 bg-foreground/40',
              )}
              style={{ left: `${left}%`, top: `${top}%` }}
            />
          );
        })}
      </div>

      {/* corner decorative HUD — top right */}
      <div className="absolute top-6 right-6 hidden lg:block opacity-50 pointer-events-none text-brand">
        <ScanOrb size="lg" state="scanning" />
      </div>

      <div className="relative z-10">{children}</div>
    </div>
  );
}
