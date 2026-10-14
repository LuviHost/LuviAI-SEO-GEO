'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { FileText, Globe, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { formatNum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/async-state';
import { StatusBanner } from '@/components/ui/status-banner';

type Quota = Awaited<ReturnType<typeof api.getUserQuota>>;

/**
 * Aylik kotalar + AI butce uyarisi. %70'te uyari, %90'da tehlike tonu.
 * Yuklenirken iskelet, hata olursa tekrar dene — eskiden veri gelene kadar
 * null donup bolum sonradan "patliyordu".
 */
export function QuotaMonitor() {
  const { data: session, status } = useSession();
  const userId = (session?.user as any)?.id as string | undefined;
  const [data, setData] = useState<Quota | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    if (!userId) return;
    api.getUserQuota(userId)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [userId, load]);

  if (error && !data) return <ErrorState error={error} onRetry={load} />;
  if (!data) {
    // Oturum yoksa (beklenmez) iskelet sonsuza dek donmesin
    if (status === 'unauthenticated') return null;
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy="true" aria-label="Kotalar yükleniyor">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[68px]" />)}
      </div>
    );
  }

  // Eksik ekseni ATLA, patlama: API bir ekseni biraktiginda (eski 'videos' gibi)
  // tek bir undefined tum /sites/[id] sayfasini error boundary'ye dusuruyordu.
  const items = [
    data.articles && {
      key: 'articles', icon: FileText, label: 'Makale',
      used: data.articles.limit - data.articles.remaining, limit: data.articles.limit,
    },
    data.aiRuns && {
      key: 'aiRuns', icon: Sparkles, label: 'AI çalıştırma',
      used: data.aiRuns.used, limit: data.aiRuns.limit,
    },
    data.sites && {
      key: 'sites', icon: Globe, label: 'Site',
      used: data.sites.current, limit: data.sites.limit,
    },
  ].filter(Boolean) as Array<{ key: string; icon: typeof FileText; label: string; used: number; limit: number }>;

  const budget = data.budget;
  const showBudgetWarn = !!budget && (budget.warn || budget.hardBlock);

  return (
    <div className="space-y-3">
      {showBudgetWarn && (
        <StatusBanner
          tone={budget.hardBlock ? 'danger' : 'warning'}
          title={budget.hardBlock ? `Aylık AI bütçen doldu (%${budget.pct})` : `AI bütçenin %${budget.pct}'i kullanıldı`}
        >
          ${budget.used.toFixed(2)} / ${budget.cap.toFixed(2)} ·{' '}
          {budget.hardBlock ? 'Yeni AI istekleri durduruldu, planını yükselt.' : 'Limit yaklaşıyor, takipte kal.'}
        </StatusBanner>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {items.map((it) => {
          const pct = it.limit > 0 ? Math.min(100, Math.round((it.used / it.limit) * 100)) : 0;
          const tone = pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'brand';
          return (
            <Card key={it.key} className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-label">
                  <it.icon
                    className={cn('h-3.5 w-3.5', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground')}
                    aria-hidden
                  />
                  {it.label}
                </span>
                <span className="text-label">
                  <span className="font-semibold tabular-nums">{formatNum(it.used)}</span>
                  <span className="text-muted-foreground">/{formatNum(it.limit)}</span>
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`${it.label} kotası`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <div
                  className={cn('h-full rounded-full transition-all', tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-brand')}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
