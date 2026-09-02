'use client';

import * as React from 'react';
import { ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

/**
 * Grafik standardi — recharts sarmalayicisi. Elle SVG cizen 15 dosyanin gocecegi
 * hedef: responsive (sabit 720px yok), standart tooltip, token eksen stilleri.
 * RENK KURALI: bilesen ici hex yasak — yalniz src/lib/chart-colors.ts.
 */

/** XAxis/YAxis'e yay: <XAxis {...CHART_AXIS} /> */
export const CHART_AXIS = {
  stroke: 'hsl(var(--border))',
  tick: { fill: 'hsl(var(--muted-foreground))', fontSize: 12 },
  tickLine: false as const,
  axisLine: false as const,
};

/** CartesianGrid'e yay: <CartesianGrid {...CHART_GRID} /> */
export const CHART_GRID = {
  stroke: 'hsl(var(--border))',
  strokeOpacity: 0.5,
  vertical: false as const,
};

export function ChartContainer({
  height = 280,
  className,
  children,
}: {
  height?: number;
  className?: string;
  children: React.ReactElement;
}) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/** recharts <Tooltip content={<ChartTooltip />} /> icin token-uyumlu icerik */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string;
  formatter?: (value: number | string, name?: string) => React.ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-apple-md text-sm">
      {label && <div className="text-label text-muted-foreground mb-1">{label}</div>}
      <div className="space-y-0.5">
        {payload.map((e, i) => (
          <div key={i} className="flex items-center gap-2 tabular-nums">
            {e.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: e.color }} />}
            <span className="text-muted-foreground">{e.name}</span>
            <span className="ml-auto font-medium">
              {formatter && e.value !== undefined ? formatter(e.value, e.name) : e.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
