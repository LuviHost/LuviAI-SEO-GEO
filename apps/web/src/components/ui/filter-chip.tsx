'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Filtre cipi — 28px yukseklik / 6px yaricap sozlesmesi (h-7 + rounded-chip).
 * Zaman araligi (7g/30g/90g), durum ve saglayici filtreleri icin TEK gorunum.
 * Secili durum marka turuncusuyla; secilmemis notr.
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
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
      selected
        ? 'border-brand/30 bg-brand/10 text-brand-700 dark:text-brand-300'
        : 'border-border bg-transparent text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground',
      className,
    )}
    {...props}
  />
));
FilterChip.displayName = 'FilterChip';
