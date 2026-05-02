'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DollarSign, TrendingUp, Layers, Activity, RefreshCw, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

const DAYS_OPTIONS = [7, 14, 30, 60, 90];

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: 'bg-amber-500',
  openai: 'bg-emerald-500',
  gemini: 'bg-sky-500',
};

export default function AdminSpendPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getAdminSpend(days);
      setData(res);
    } catch (err: any) {
      toast.error(err.message || 'Spend verisi alınamadı');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);

  const total = data?.totalUsd ?? 0;
  const byProvider: [string, number][] = Object.entries(data?.byProvider ?? {}).sort((a: any, b: any) => b[1] - a[1]) as any;
  const byContext: [string, number][] = Object.entries(data?.byContext ?? {}).sort((a: any, b: any) => b[1] - a[1]) as any;
  const byDate: [string, number][] = Object.entries(data?.byDate ?? {}).sort((a, b) => a[0].localeCompare(b[0])) as any;

  const dailyMax = Math.max(1, ...byDate.map(([, v]) => v));

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 grid place-items-center">
          <DollarSign className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">AI Spend</h2>
          <p className="text-sm text-muted-foreground">
            Tüm AI sağlayıcı çağrılarının token + maliyet kaydı (LibreChat Transaction pattern).
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="rounded-md border bg-card px-3 py-2 text-sm"
        >
          {DAYS_OPTIONS.map(d => <option key={d} value={d}>Son {d} gün</option>)}
        </select>
        <button onClick={load} className="px-3 py-2 border rounded-md hover:bg-muted text-sm inline-flex items-center gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>

      {loading && !data && <Skeleton className="h-32" />}

      {data && (
        <>
          {/* Top stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <StatCard icon={DollarSign} label="Toplam Maliyet" value={`$${total.toFixed(2)}`} accent="emerald" />
            <StatCard icon={Activity} label="API Çağrı" value={data.requestCount.toLocaleString('tr-TR')} accent="brand" />
            <StatCard icon={Layers} label="Sağlayıcı" value={byProvider.length} accent="amber" />
            <StatCard icon={Calendar} label="Aktif Gün" value={byDate.length} accent="sky" />
          </div>

          {/* Daily spend chart */}
          {byDate.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-4 w-4 text-brand" />
                  <p className="font-semibold">Günlük Maliyet</p>
                </div>
                <div className="flex items-end gap-1 h-40">
                  {byDate.map(([d, v]) => {
                    const h = (v / dailyMax) * 100;
                    return (
                      <div key={d} className="flex-1 flex flex-col items-center gap-1 group" title={`${d}: $${v.toFixed(2)}`}>
                        <div
                          className="w-full bg-emerald-500/60 hover:bg-emerald-500 transition-colors rounded-sm"
                          style={{ height: `${h}%` }}
                        />
                        <span className="text-[8px] text-muted-foreground/60 truncate w-full text-center">{d.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Provider breakdown */}
          <div className="grid md:grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-5 space-y-3">
                <p className="font-semibold">Sağlayıcı Dağılımı</p>
                <div className="space-y-2">
                  {byProvider.map(([prov, cost]) => {
                    const pct = total > 0 ? (cost / total) * 100 : 0;
                    return (
                      <div key={prov}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="font-medium capitalize">{prov}</span>
                          <span className="font-mono text-xs">${cost.toFixed(2)} ({pct.toFixed(1)}%)</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={cn('h-full', PROVIDER_COLORS[prov] ?? 'bg-muted-foreground')} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {byProvider.length === 0 && <p className="text-sm text-muted-foreground">Bu dönemde AI çağrısı yok.</p>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5 space-y-3">
                <p className="font-semibold">Context (Kullanım Alanı)</p>
                <div className="divide-y -mx-2">
                  {byContext.slice(0, 12).map(([ctx, cost]) => {
                    const pct = total > 0 ? (cost / total) * 100 : 0;
                    return (
                      <div key={ctx} className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
                        <span className="truncate font-mono text-xs">{ctx}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">{pct.toFixed(0)}%</span>
                          <span className="font-mono">${cost.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })}
                  {byContext.length === 0 && <p className="text-sm text-muted-foreground py-2">Veri yok.</p>}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, accent,
}: {
  icon: any; label: string; value: string | number;
  accent: 'emerald' | 'brand' | 'amber' | 'sky';
}) {
  const styles = {
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    brand: 'bg-brand/10 text-brand',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn('h-9 w-9 rounded-lg grid place-items-center', styles[accent])}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
