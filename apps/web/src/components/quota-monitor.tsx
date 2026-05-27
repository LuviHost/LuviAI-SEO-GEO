'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, Globe, Film, DollarSign, AlertTriangle } from 'lucide-react';

/**
 * Dashboard'da kullanıcının aylık kotalarını + AI cost bütçesini gösterir.
 * Limit %80'i geçince sarı, %100 olunca kırmızı uyarı.
 */
export function QuotaMonitor() {
  const { data: session } = useSession();
  const userId = (session?.user as any)?.id as string | undefined;
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getUserQuota>> | null>(null);

  useEffect(() => {
    if (!userId) return;
    api.getUserQuota(userId).then(setData).catch(() => {});
    // Her dakika refresh
    const id = setInterval(() => {
      api.getUserQuota(userId).then(setData).catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, [userId]);

  if (!data) return null;

  const items = [
    {
      key: 'articles',
      icon: FileText,
      label: 'Makale',
      used: data.articles.limit - data.articles.remaining,
      limit: data.articles.limit,
      color: 'orange',
    },
    {
      key: 'videos',
      icon: Film,
      label: 'Video',
      used: data.videos.used,
      limit: data.videos.limit,
      color: 'purple',
    },
    {
      key: 'sites',
      icon: Globe,
      label: 'Site',
      used: data.sites.current,
      limit: data.sites.limit,
      color: 'blue',
    },
  ];

  // Budget warning banner
  const showBudgetWarn = data.budget.warn || data.budget.hardBlock;

  return (
    <div className="space-y-2">
      {showBudgetWarn && (
        <div className={`rounded-xl border-2 p-3 flex items-start gap-2.5 ${
          data.budget.hardBlock
            ? 'border-rose-500/50 bg-rose-50/50 dark:bg-rose-950/20'
            : 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20'
        }`}>
          <AlertTriangle className={`h-5 w-5 shrink-0 ${data.budget.hardBlock ? 'text-rose-600' : 'text-amber-600'}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold ${data.budget.hardBlock ? 'text-rose-900 dark:text-rose-100' : 'text-amber-900 dark:text-amber-100'}`}>
              {data.budget.hardBlock
                ? `Aylık AI bütçen doldu (%${data.budget.pct})`
                : `AI bütçenin %${data.budget.pct}'i kullanıldı`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              ${data.budget.used.toFixed(2)} / ${data.budget.cap.toFixed(2)} · {data.budget.hardBlock ? 'Yeni AI istekleri durduruldu, plan yükselt.' : 'Limit yaklaşıyor, izlemeye al.'}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {items.map((it) => {
          const pct = it.limit > 0 ? Math.min(100, Math.round((it.used / it.limit) * 100)) : 0;
          const danger = pct >= 90;
          const warn = pct >= 70;
          const colorMap: Record<string, string> = {
            orange: 'from-orange-500 to-orange-600',
            purple: 'from-purple-500 to-purple-600',
            blue: 'from-blue-500 to-blue-600',
          };
          return (
            <Card key={it.key}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <it.icon className={`h-3.5 w-3.5 ${danger ? 'text-rose-600' : warn ? 'text-amber-600' : 'text-muted-foreground'}`} />
                    {it.label}
                  </div>
                  <div className="text-xs">
                    <span className="font-bold tabular-nums">{it.used}</span>
                    <span className="text-muted-foreground">/{it.limit}</span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r transition-all ${
                      danger ? 'from-rose-500 to-rose-600' : warn ? 'from-amber-500 to-amber-600' : colorMap[it.color]
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
