'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Sparkles, TrendingUp } from 'lucide-react';

/**
 * Site genel bakışında ince bir şerit: son 7 günün AI maliyeti, token toplamı ve
 * hangi context'lerde kullanıldı. AnalyticsRow'un altında durur.
 *
 * NOT: burada eskiden '/admin/spend'e giden bir "Detay" linki vardı. O rota admin
 * layout guard'ının arkasında; normal müşteri tıklayınca /dashboard'a atılıyordu,
 * yani buton kırıktı. Müşteriye açık bir spend sayfası olmadığı için link
 * kaldırıldı; yerine şeridin kendisi token muhasebesini gösteriyor.
 */

/** Token sayısını şeride sığacak kadar kısaltır: 1.2M / 34.5K / 812 */
function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

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

  // tokens API'de yeni; eski cevaplarda olmayabilir diye korumalı okuyoruz.
  const tokens = data.tokens as
    | { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
    | undefined;

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
          {tokens && tokens.total > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {compactTokens(tokens.total)} token
            </span>
          )}
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
      {tokens && tokens.total > 0 && (
        <div
          className="text-[11px] px-2.5 py-1.5 rounded-md border text-muted-foreground hidden sm:inline-flex items-center gap-1.5 shrink-0 tabular-nums"
          title={`Giris ${tokens.input.toLocaleString('tr-TR')} · Cikis ${tokens.output.toLocaleString('tr-TR')} · Cache okuma ${tokens.cacheRead.toLocaleString('tr-TR')} · Cache yazma ${tokens.cacheWrite.toLocaleString('tr-TR')}`}
        >
          <TrendingUp className="h-3 w-3 shrink-0" />
          <span className="font-mono">
            {compactTokens(tokens.input)} ↓ / {compactTokens(tokens.output)} ↑
          </span>
        </div>
      )}
    </div>
  );
}
