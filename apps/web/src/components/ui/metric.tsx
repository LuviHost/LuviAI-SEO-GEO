'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { NumberTicker } from '@/components/ui/number-ticker';
import type { Format } from '@number-flow/react';
import { DeltaBadge } from '@/components/ui/delta-badge';

/**
 * KANONIK metrik karti — dashboard/page.tsx StatCard DNA'sindan cikarildi.
 * 24 yerel metrik-kart kopyasinin yerini alir; yeni metrik yazan HERKES bunu kullanir.
 *
 * Sozlesme: 8px kart yaricapi (rounded-lg) · 16px pad (p-4) · deger text-metric(-lg)
 * · etiket mono serit (v-rail) · sayilar NumberTicker (reduced-motion'i kendi tanir).
 * Ekim 2026: aksan cubugu + renkli ikon cipi + turuncu deger kaldirildi (her kart
 * turuncuydu, vurgu anlamini yitirmisti); etiket ustte, deger notr, renk yalniz
 * kucuk ikonda. 12.11.2026 (vitrin dili): rakam vitrindeki kanit rakami gibi ince
 * agirlikli ve siki aralikli Geist; etiket vitrin seridi gibi mono.
 */

const ACCENTS = {
  // Varsayilan: notr ikon. Vitrinde turuncu tek vurgudur (birincil eylem, secili oge);
  // her metrik kartinda turuncu ikon o vurguyu olduruyordu.
  brand: {
    iconBg: 'bg-muted',
    iconText: 'text-muted-foreground',
    bar: 'from-border to-transparent',
    hoverBorder: 'hover:border-foreground/25',
  },
  // Durum anlami tasiyan aksanlar token'dan (globals.css --success/--warning/--danger).
  // Adlar geriye uyum icin duruyor: emerald = iyi, amber = uyari, rose = sorun.
  emerald: {
    iconBg: 'bg-success/15',
    iconText: 'text-success',
    bar: 'from-success to-success/40',
    hoverBorder: 'hover:border-success/40',
  },
  amber: {
    iconBg: 'bg-warning/15',
    iconText: 'text-warning',
    bar: 'from-warning to-warning/40',
    hoverBorder: 'hover:border-warning/40',
  },
  // violet bir durum degildi (sus rengi): notr
  violet: {
    iconBg: 'bg-muted',
    iconText: 'text-muted-foreground',
    bar: 'from-border to-transparent',
    hoverBorder: 'hover:border-foreground/25',
  },
  rose: {
    iconBg: 'bg-danger/15',
    iconText: 'text-danger',
    bar: 'from-danger to-danger/40',
    hoverBorder: 'hover:border-danger/40',
  },
  muted: {
    iconBg: 'bg-muted',
    iconText: 'text-muted-foreground',
    bar: 'from-border to-transparent',
    hoverBorder: 'hover:border-border',
  },
} as const;

export type MetricAccent = keyof typeof ACCENTS;

const metricValue = cva('tabular-nums', {
  variants: {
    size: {
      sm: 'text-metric',
      md: 'text-metric-lg',
      lg: 'text-h3 font-[450] tracking-[-0.05em]',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface MetricCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>,
    VariantProps<typeof metricValue> {
  label: React.ReactNode;
  /** number → NumberTicker ile animasyonlu; string → oldugu gibi */
  value: number | string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: MetricAccent;
  /** Degisim — verilirse DeltaBadge gosterilir */
  delta?: number;
  deltaSuffix?: string;
  iyiYon?: 'yukari' | 'asagi';
  prefix?: string;
  suffix?: string;
  format?: Format;
  /** Deger altinda kucuk aciklama satiri */
  hint?: React.ReactNode;
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  accent = 'brand',
  size,
  delta,
  deltaSuffix,
  iyiYon,
  prefix,
  suffix,
  format,
  hint,
  className,
  ...props
}: MetricCardProps) {
  const a = ACCENTS[accent];
  return (
    <div
      className={cn(
        // Vitrinle ayni sakin dil: renk yalniz kucuk ikonda; deger notr
        'group relative flex flex-col rounded-lg border bg-card p-4 transition-colors duration-200',
        a.hoverBorder,
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="v-rail">{label}</div>
        {Icon && <Icon className={cn('h-4 w-4 shrink-0', a.iconText)} aria-hidden />}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <div className={cn(metricValue({ size }), 'text-foreground')}>
          {typeof value === 'number' ? (
            <NumberTicker value={value} format={format} prefix={prefix} suffix={suffix} />
          ) : (
            value
          )}
        </div>
        {delta !== undefined && <DeltaBadge delta={delta} suffix={deltaSuffix} iyiYon={iyiYon} />}
      </div>
      {hint && <div className="mt-auto pt-2 text-label text-muted-foreground/80">{hint}</div>}
    </div>
  );
}
