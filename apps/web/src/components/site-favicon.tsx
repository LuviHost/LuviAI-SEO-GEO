'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Sitenin kendi favicon'u (dogrudan sitenin /favicon.ico'su — ucuncu taraf
 * favicon servisine alan adi gonderilmez). Yuklenemezse ad bas harfleri.
 */
export function SiteFavicon({ url, name, size = 'md', className }: {
  url?: string | null;
  name?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  let origin: string | null = null;
  try { origin = url ? new URL(url).origin : null; } catch { origin = null; }
  const box = size === 'lg' ? 'h-12 w-12 rounded-xl' : size === 'sm' ? 'h-8 w-8 rounded-md' : 'h-11 w-11 rounded-lg';
  const img = size === 'lg' ? 'h-7 w-7' : size === 'sm' ? 'h-4 w-4' : 'h-6 w-6';
  return (
    <span
      className={cn('grid shrink-0 place-items-center border border-border bg-white text-sm font-semibold text-foreground/70 dark:bg-card', box, className)}
      aria-hidden
    >
      {origin && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${origin}/favicon.ico`} alt="" className={cn(img, 'object-contain')} onError={() => setFailed(true)} loading="lazy" decoding="async" />
      ) : (
        (name ?? '??').slice(0, 2).toLocaleUpperCase('tr-TR')
      )}
    </span>
  );
}
