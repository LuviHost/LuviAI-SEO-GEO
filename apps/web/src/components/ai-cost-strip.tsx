'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownUp, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { formatNum } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/async-state';

/**
 * Son 7 gunun AI maliyeti, token toplami ve hangi baglamlarda kullanildigi.
 *
 * NOT: eskiden '/admin/spend'e giden bir "Detay" linki vardi; o rota admin
 * korumasinin arkasinda oldugu icin musteri /dashboard'a atiliyordu. Musteriye
 * acik bir harcama sayfasi olmadigindan link yok; serit token muhasebesini
 * kendisi gosterir.
 */

/** Token sayisini kisaltir: 1,2 Mn / 34,5 B / 812 */
function compactTokens(n: number): string {
  return new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function AiCostStrip({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getSiteSpend(siteId, 7)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [siteId]);

  useEffect(() => load(), [load]);

  if (loading) return <Skeleton className="h-[72px] w-full" aria-label="AI maliyeti yükleniyor" />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  if (!data || !data.totalUsd) {
    return (
      <Card className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
        Son 7 günde bu site için AI harcaması yok.
      </Card>
    );
  }

  const top3 = Object.entries((data.byContext ?? {}) as Record<string, number>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // tokens API'de yeni; eski cevaplarda olmayabilir
  const tokens = data.tokens as
    | { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
    | undefined;

  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand/10 text-brand">
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-label text-muted-foreground">AI maliyeti · son 7 gün</span>
          <span className="text-metric tabular-nums">${data.totalUsd.toFixed(2)}</span>
          <span className="text-label text-muted-foreground">{formatNum(data.requestCount)} çağrı</span>
          {tokens && tokens.total > 0 && (
            <span className="text-label text-muted-foreground tabular-nums">{compactTokens(tokens.total)} token</span>
          )}
        </div>
        {top3.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-3 text-label text-muted-foreground">
            {top3.map(([ctx, cost]) => (
              <span key={ctx} className="inline-flex items-center gap-1 font-mono">
                <span className="text-foreground/70">{ctx}</span>
                <span>${cost.toFixed(2)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {tokens && tokens.total > 0 && (
        <span
          className="hidden shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-label text-muted-foreground tabular-nums sm:inline-flex"
          title={`Giriş ${formatNum(tokens.input)} · Çıkış ${formatNum(tokens.output)} · Önbellek okuma ${formatNum(tokens.cacheRead)} · Önbellek yazma ${formatNum(tokens.cacheWrite)}`}
        >
          <ArrowDownUp className="h-3 w-3 shrink-0" aria-hidden />
          {compactTokens(tokens.input)} giriş / {compactTokens(tokens.output)} çıkış
        </span>
      )}
    </Card>
  );
}
