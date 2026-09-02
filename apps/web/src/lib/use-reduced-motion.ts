'use client';

import { useEffect, useState } from 'react';

/**
 * OS "hareketi azalt" tercihi. ai-scan'den src/lib'e tasindi (02.09.2026):
 * dashboard genelinde motion-presets ile birlikte kullanilir — ai-scan'e ozel degil.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}
