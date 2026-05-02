'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Sparkles, TrendingUp } from 'lucide-react';

/**
 * Site genel bakışında ince bir şerit: son 7 günün AI maliyeti + hangi context'lerde kullanıldı.
 * AnalyticsRow'un altında, kullanıcıyı LLM Spend dashboard'a yönlendirir.
 */
export function AiCostStrip({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    api.getSiteSpend(siteId, 7)
      .then(res => { if (!cancelled) setData(res); })
      .catch(() => { /* sessizce */ });
    return () => { cancelled = true; };
  }, [siteId]);

  if (!data || data.totalUsd === 0) return null;

  const top3 = Object.entries(data.byContext as Record<string, number>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div className="rounded-xl border bg-gradient-to-r from-emerald-500/[0.04] via-card to-card p-3 flex items-center gap-3">
      <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">AI Maliyet · 7g</span>
          <span className="text-lg font-bold tabular-nums">${data.totalUsd.toFixed(2)}</span>
          <span className="text-[11px] text-muted-foreground">{data.requestCount.toLocaleString('tr-TR')} çağrı</span>
        </div>
        {top3.length > 0 && (
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            {top3.map(([ctx, cost]) => (
              <span key={ctx} className="inline-flex items-center gap-0.5 font-mono">
                <span className="text-foreground/70">{ctx}</span>
                <span>${cost.toFixed(2)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <Link
        href={'/admin/spend' as any}
        className="text-xs px-2.5 py-1.5 rounded-md border hover:bg-muted text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
      >
        <TrendingUp className="h-3 w-3" /> Detay
      </Link>
    </div>
  );
}
