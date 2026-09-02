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
 * Sozlesme: 14px kart yaricapi (rounded-lg) · 16px pad (p-4) · deger text-metric(-lg)
 * · etiket text-label · sayilar NumberTicker (reduced-motion'i kendi tanir)
 * · aksan cubugu + ikon cipi + oturmus hover kalibi.
 */

const ACCENTS = {
  brand: {
    iconBg: 'bg-brand/15',
    iconText: 'text-brand',
    bar: 'from-brand to-brand/40',
    hoverBorder: 'hover:border-brand/40',
  },
  emerald: {
    iconBg: 'bg-emerald-500/15',
    iconText: 'text-emerald-600 dark:text-emerald-400',
    bar: 'from-emerald-500 to-emerald-500/40',
    hoverBorder: 'hover:border-emerald-500/40',
  },
  amber: {
    iconBg: 'bg-amber-500/15',
    iconText: 'text-amber-600 dark:text-amber-400',
    bar: 'from-amber-500 to-amber-500/40',
    hoverBorder: 'hover:border-amber-500/40',
  },
  violet: {
    iconBg: 'bg-violet-500/15',
    iconText: 'text-violet-600 dark:text-violet-400',
    bar: 'from-violet-500 to-violet-500/40',
    hoverBorder: 'hover:border-violet-500/40',
  },
  rose: {
    iconBg: 'bg-rose-500/15',
    iconText: 'text-rose-600 dark:text-rose-400',
    bar: 'from-rose-500 to-rose-500/40',
    hoverBorder: 'hover:border-rose-500/40',
  },
  muted: {
    iconBg: 'bg-muted',
    iconText: 'text-muted-foreground',
    bar: 'from-border to-transparent',
    hoverBorder: 'hover:border-border',
  },
} as const;

export type MetricAccent = keyof typeof ACCENTS;

const metricValue = cva('font-semibold tracking-tight tabular-nums leading-none', {
  variants: {
    size: {
      sm: 'text-metric',
      md: 'text-metric-lg',
      lg: 'text-h4 font-semibold',
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
        'group relative overflow-hidden rounded-lg border bg-card p-4 transition-all duration-300',
        'hover:-translate-y-0.5 hover:shadow-apple',
        a.hoverBorder,
        className,
      )}
      {...props}
    >
      {/* Aksan cubugu */}
      <div
        className={cn(
          'absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r opacity-60 transition-opacity group-hover:opacity-100',
          a.bar,
        )}
      />
      <div className="flex items-start justify-between gap-3">
        {Icon && (
          <div
            className={cn(
              'grid h-9 w-9 place-items-center rounded-lg transition-transform duration-300 group-hover:scale-110',
              a.iconBg,
            )}
          >
            <Icon className={cn('h-4 w-4', a.iconText)} />
          </div>
        )}
        {delta !== undefined && <DeltaBadge delta={delta} suffix={deltaSuffix} iyiYon={iyiYon} />}
      </div>
      <div className={cn(metricValue({ size }), a.iconText, Icon ? 'mt-3' : 'mt-0.5')}>
        {typeof value === 'number' ? (
          <NumberTicker value={value} format={format} prefix={prefix} suffix={suffix} />
        ) : (
          value
        )}
      </div>
      <div className="mt-2 text-label text-muted-foreground">{label}</div>
      {hint && <div className="mt-1 text-label text-muted-foreground/70">{hint}</div>}
    </div>
  );
}
