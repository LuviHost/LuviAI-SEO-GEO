'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Pause,
  Play,
  RefreshCw,
  ChevronUp,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

type JobState = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'paused';

type Counts = Record<JobState, number>;

type Job = {
  id: string;
  name: string;
  data: any;
  opts: { delay?: number; priority?: number; attempts?: number };
  attemptsMade: number;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  delay: number;
  fireAt: number | null;
  failedReason: string | null;
  returnvalue: any;
  state: JobState;
};

const STATE_CONFIG: Record<JobState, { label: string; Icon: any; color: string; bg: string; ring: string }> = {
  waiting:   { label: 'Bekliyor',  Icon: Clock,         color: 'text-blue-600 dark:text-blue-400',     bg: 'bg-blue-500/10',     ring: 'ring-blue-500/30' },
  active:    { label: 'Çalışıyor', Icon: Loader2,       color: 'text-brand',                            bg: 'bg-brand/10',        ring: 'ring-brand/30' },
  delayed:   { label: 'Geciktirildi', Icon: Clock,      color: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-500/10',    ring: 'ring-amber-500/30' },
  completed: { label: 'Tamam',     Icon: CheckCircle2,  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30' },
  failed:    { label: 'Başarısız', Icon: XCircle,       color: 'text-red-500',                          bg: 'bg-red-500/10',      ring: 'ring-red-500/30' },
  paused:    { label: 'Pause',     Icon: Pause,         color: 'text-muted-foreground',                 bg: 'bg-muted/30',        ring: 'ring-muted/30' },
};

const STATES_ORDER: JobState[] = ['waiting', 'active', 'delayed', 'completed', 'failed', 'paused'];

export default function AdminQueuePage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [paused, setPaused] = useState(false);
  const [activeTab, setActiveTab] = useState<JobState>('delayed');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const [stats, list] = await Promise.all([
        api.adminQueueStats(),
        api.adminQueueJobs(activeTab, 100),
      ]);
      setCounts(stats.counts as unknown as Counts);
      setPaused(stats.paused);
      setJobs(list);
    } catch (err: any) {
      toast.error(err.message || 'Yükleme hatası');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const action = async (fn: () => Promise<any>, msg = 'Tamam') => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Queue Monitor</h1>
          <p className="text-xs text-muted-foreground mt-1">
            BullMQ kuyruğu — gerçek zamanlı (5sn refresh). Job state'leri, delayed timer, retry/promote/remove.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-1', loading && 'animate-spin')} /> Yenile
          </Button>
          {paused ? (
            <Button
              size="sm"
              onClick={() => action(api.adminQueueResume, 'Queue çalıştırıldı')}
              disabled={busy}
            >
              <Play className="h-4 w-4 mr-1" /> Resume
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => action(api.adminQueuePause, 'Queue durduruldu')}
              disabled={busy}
              className="border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
            >
              <Pause className="h-4 w-4 mr-1" /> Pause
            </Button>
          )}
        </div>
      </div>

      {paused && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400 inline-flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> Queue PAUSED — yeni jobs işlenmiyor (resume basana kadar).
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {STATES_ORDER.map((s) => {
          const cfg = STATE_CONFIG[s];
          const Icon = cfg.Icon;
          const value = counts?.[s] ?? 0;
          const isActive = activeTab === s;
          return (
            <button
              key={s}
              onClick={() => setActiveTab(s)}
              className={cn(
                'rounded-xl border p-3 text-left transition-all hover:shadow-sm',
                isActive ? `ring-2 ${cfg.ring}` : 'border-border',
                isActive && cfg.bg,
              )}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <Icon className={cn('h-3.5 w-3.5', cfg.color, s === 'active' && 'animate-spin')} />
                <span className={cn('text-[10px] font-mono uppercase tracking-widest', cfg.color)}>
                  {cfg.label}
                </span>
              </div>
              <div className={cn('text-3xl font-bold tabular-nums', cfg.color)}>{value}</div>
            </button>
          );
        })}
      </div>

      {/* Jobs table */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-2 bg-muted/30 flex items-center justify-between">
            <p className="text-sm font-semibold">
              {STATE_CONFIG[activeTab].label} ({jobs.length})
            </p>
            <span className="text-[11px] text-muted-foreground font-mono">
              filter: state = {activeTab}
            </span>
          </div>
          {jobs.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Bu state'te job yok.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/20 text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Job ID</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-left px-3 py-2 font-medium">Data preview</th>
                    <th className="text-left px-3 py-2 font-medium">Eklendi</th>
                    {activeTab === 'delayed' && (
                      <th className="text-left px-3 py-2 font-medium">Tetiklenecek</th>
                    )}
                    {activeTab === 'failed' && (
                      <th className="text-left px-3 py-2 font-medium">Hata</th>
                    )}
                    <th className="text-left px-3 py-2 font-medium">Deneme</th>
                    <th className="text-right px-3 py-2 font-medium">Aksiyon</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {jobs.map((j) => {
                    const dataPreview = (() => {
                      try {
                        const s = JSON.stringify(j.data);
                        return s.length > 80 ? s.slice(0, 80) + '…' : s;
                      } catch {
                        return '—';
                      }
                    })();
                    return (
                      <tr key={j.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-[11px] truncate max-w-[200px]" title={String(j.id)}>
                          {j.id}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="font-mono text-[10px]">{j.name}</Badge>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground truncate max-w-[260px]" title={dataPreview}>
                          {dataPreview}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(j.timestamp).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short' })}
                        </td>
                        {activeTab === 'delayed' && (
                          <td className="px-3 py-2 text-amber-600 font-mono">
                            {j.fireAt ? new Date(j.fireAt).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short' }) : '—'}
                          </td>
                        )}
                        {activeTab === 'failed' && (
                          <td className="px-3 py-2 text-red-500 truncate max-w-[260px]" title={j.failedReason ?? ''}>
                            {j.failedReason ?? '—'}
                          </td>
                        )}
                        <td className="px-3 py-2 text-muted-foreground">
                          {j.attemptsMade}/{j.opts.attempts ?? 1}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            {activeTab === 'delayed' && (
                              <button
                                onClick={() => action(() => api.adminQueuePromoteJob(String(j.id)), 'Şimdi çalıştırılacak')}
                                disabled={busy}
                                title="Hemen çalıştır (delay'i atla)"
                                className="p-1.5 rounded hover:bg-brand/10 text-brand transition-colors"
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {activeTab === 'failed' && (
                              <button
                                onClick={() => action(() => api.adminQueueRetryJob(String(j.id)), 'Tekrar denenecek')}
                                disabled={busy}
                                title="Yeniden dene"
                                className="p-1.5 rounded hover:bg-emerald-500/10 text-emerald-600 transition-colors"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                if (!confirm(`Job sil: ${j.id}?`)) return;
                                action(() => api.adminQueueRemoveJob(String(j.id)), 'Job silindi');
                              }}
                              disabled={busy}
                              title="Sil"
                              className="p-1.5 rounded hover:bg-red-500/10 text-red-500 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
