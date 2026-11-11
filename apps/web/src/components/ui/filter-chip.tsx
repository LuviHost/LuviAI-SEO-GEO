'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Filtre cipi — 28px yukseklik / 6px yaricap sozlesmesi (h-7 + rounded-chip).
 * Zaman araligi (7g/30g/90g), durum ve saglayici filtreleri icin TEK gorunum.
 * Secili durum dolu (metin rengi zemini), secilmemis notr cerceve — vitrindeki
 * Aylik/Yillik dugmesiyle ayni; turuncu birincil eyleme kalir.
 */
export const FilterChip = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }
>(({ className, selected = false, type, ...props }, ref) => (
  <button
    ref={ref}
    type={type ?? 'button'}
    aria-pressed={selected}
    className={cn(
      'inline-flex h-7 items-center gap-1.5 rounded-chip border px-2.5 text-filter transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      selected
        ? 'border-foreground bg-foreground text-background'
        : 'border-border bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground',
      className,
    )}
    {...props}
  />
));
FilterChip.displayName = 'FilterChip';
