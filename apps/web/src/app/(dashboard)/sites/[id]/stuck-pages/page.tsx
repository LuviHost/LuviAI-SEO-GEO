'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import {
  Wrench,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Eye,
  EyeOff,
  Undo2,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type StuckPageRow = Awaited<ReturnType<typeof api.listStuckPages>>[number];

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  DETECTED:   { text: 'Tespit edildi', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  RECOVERING: { text: 'Düzeltiliyor',  cls: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  RECOVERED:  { text: 'Düzeltildi',    cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  FAILED:     { text: 'Başarısız',     cls: 'bg-red-500/10 text-red-600 border-red-500/30' },
  REVERTED:   { text: 'Geri alındı',   cls: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30' },
  IGNORED:    { text: 'Gözardı',       cls: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30' },
};

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 70
    ? 'bg-red-500/10 text-red-600 border-red-500/30'
    : score >= 50
    ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
    : 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30';
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium', cls)}>
      <TrendingDown className="h-3 w-3" /> Stuck #{score}
    </span>
  );
}

function StuckPageCard({
  page,
  busy,
  onRecover,
  onIgnore,
  onRevert,
  expanded,
  onToggle,
}: {
  page: StuckPageRow;
  busy: boolean;
  onRecover: () => void;
  onIgnore: () => void;
  onRevert: (recoveryId: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const lastRecovery = page.recoveries?.[0];
  const status = STATUS_LABEL[page.status] ?? STATUS_LABEL.DETECTED;
  const canRecover = page.status === 'DETECTED' || page.status === 'FAILED';
  const isRecovering = page.status === 'RECOVERING';
  const canRevert = page.status === 'RECOVERED' && lastRecovery && !lastRecovery.revertedAt;

  return (
    <Card className={cn('transition-all', expanded && 'ring-2 ring-brand/30')}>
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium', status.cls)}>
                {status.text}
              </span>
              <ScoreBadge score={page.stuckScore} />
              {page.articleId === null && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium bg-zinc-500/10 text-zinc-600 border-zinc-500/30">
                  <AlertTriangle className="h-3 w-3" /> RanksUp dışı
                </span>
              )}
            </div>
            <h3 className="font-semibold text-base truncate">{page.title || page.url}</h3>
            <a href={page.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline truncate block">
              {page.url}
            </a>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
              <div>
                <div className="text-muted-foreground">Pozisyon</div>
                <div className="font-semibold">#{Math.round(page.position)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Gösterim (30g)</div>
                <div className="font-semibold">{page.impressions.toLocaleString('tr-TR')}</div>
              </div>
              <div>
                <div className="text-muted-foreground">CTR</div>
                <div className="font-semibold">%{(page.ctr * 100).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Tıklama</div>
                <div className="font-semibold">{page.clicks}</div>
              </div>
            </div>
            {Array.isArray(page.topQueries) && page.topQueries.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {page.topQueries.slice(0, 5).map((q) => (
                  <span key={q} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {q}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            {canRecover && page.articleId && (
              <Button onClick={onRecover} disabled={busy} size="sm" className="gap-1.5">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                AI Düzelt
              </Button>
            )}
            {isRecovering && (
              <Button disabled size="sm" variant="outline" className="gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Çalışıyor
              </Button>
            )}
            {canRevert && (
              <Button onClick={() => onRevert(lastRecovery!.id)} disabled={busy} size="sm" variant="outline" className="gap-1.5">
                <Undo2 className="h-3.5 w-3.5" /> Geri Al
              </Button>
            )}
            {page.status === 'DETECTED' && (
              <Button onClick={onIgnore} disabled={busy} size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
                <EyeOff className="h-3.5 w-3.5" /> Gözardı
              </Button>
            )}
            {(page.recoveries?.length ?? 0) > 0 && (
              <Button onClick={onToggle} size="sm" variant="ghost" className="gap-1.5">
                <Eye className="h-3.5 w-3.5" /> {expanded ? 'Detay Kapat' : 'Detay'}
              </Button>
            )}
          </div>
        </div>

        {expanded && lastRecovery && (
          <div className="mt-4 pt-4 border-t space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">Son Recovery — {new Date(lastRecovery.appliedAt).toLocaleString('tr-TR')}</span>
            </div>
            <div className="text-xs">
              <span className="text-muted-foreground">Eklenen entity'ler:</span>{' '}
              {Array.isArray(lastRecovery.entitiesAdded) && lastRecovery.entitiesAdded.length > 0 ? (
                lastRecovery.entitiesAdded.map((e: string) => (
                  <span key={e} className="inline-block ml-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 text-[11px]">
                    {e}
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            {Array.isArray(lastRecovery.edits) && lastRecovery.edits.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium">Uygulanan değişiklikler ({lastRecovery.edits.length}):</div>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {lastRecovery.edits.map((e: any, i: number) => (
                    <div key={i} className="rounded-lg border bg-muted/30 p-3 text-xs">
                      <div className="text-red-600 line-through">{e.before}</div>
                      <div className="text-emerald-700 mt-1">+ {e.after}</div>
                      {e.reason && <div className="mt-1.5 text-muted-foreground italic">{e.reason}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {lastRecovery.revertedAt && (
              <div className="text-xs text-muted-foreground">
                Geri alındı: {new Date(lastRecovery.revertedAt).toLocaleString('tr-TR')}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function StuckPagesPage() {
  const { site } = useSiteContext();
  const [rows, setRows] = useState<StuckPageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'DETECTED' | 'RECOVERED' | 'FAILED' | 'IGNORED'>('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listStuckPages(site.id);
      setRows(data);
    } catch (err: any) {
      toast.error(err.message || 'Liste alınamadı');
    } finally {
      setLoading(false);
    }
  }, [site.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const result = await api.detectStuckPages(site.id);
      if (result.found === 0) {
        toast.success('Tarama tamam — stuck sayfa bulunamadı 🎉');
      } else {
        toast.success(`${result.found} stuck sayfa bulundu (${result.created} yeni)`);
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Tarama başarısız');
    } finally {
      setDetecting(false);
    }
  };

  const setBusy = (id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleRecover = async (id: string) => {
    setBusy(id, true);
    try {
      const r = await api.recoverStuckPage(site.id, id);
      if (r.success) {
        toast.success(`Düzeltildi: ${r.editsCount} değişiklik uygulandı. Re-publish kuyruğa alındı.`);
      } else {
        toast.error(`Düzeltme başarısız: ${r.reason ?? 'bilinmiyor'}`);
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Recovery hata');
    } finally {
      setBusy(id, false);
    }
  };

  const handleIgnore = async (id: string) => {
    setBusy(id, true);
    try {
      await api.ignoreStuckPage(site.id, id);
      toast.success('Bu sayfa gözardı edildi');
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'İşlem hata');
    } finally {
      setBusy(id, false);
    }
  };

  const handleRevert = async (stuckPageId: string, recoveryId: string) => {
    setBusy(stuckPageId, true);
    try {
      await api.revertStuckPageRecovery(site.id, recoveryId);
      toast.success('Recovery geri alındı, eski hali yeniden yayınlanıyor');
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Revert hata');
    } finally {
      setBusy(stuckPageId, false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c = { total: rows.length, detected: 0, recovered: 0, failed: 0, ignored: 0 };
    for (const r of rows) {
      if (r.status === 'DETECTED') c.detected++;
      else if (r.status === 'RECOVERED') c.recovered++;
      else if (r.status === 'FAILED') c.failed++;
      else if (r.status === 'IGNORED') c.ignored++;
    }
    return c;
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center">
          <Wrench className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">Stuck Pages</h2>
          <p className="text-sm text-muted-foreground">
            Google'da ilk sayfada ama ilk 3'te değil — AI ile cümle seviyesinde tamir, başlık ve yapı korunur.
          </p>
        </div>
        <Button onClick={handleDetect} disabled={detecting} variant="outline" size="sm" className="shrink-0">
          <RefreshCw className={cn('h-4 w-4 mr-1.5', detecting && 'animate-spin')} />
          {detecting ? 'Taranıyor…' : 'Yeniden Tara'}
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Toplam" value={counts.total} active={filter === 'all'} onClick={() => setFilter('all')} />
        <KpiCard label="Tespit" value={counts.detected} active={filter === 'DETECTED'} onClick={() => setFilter('DETECTED')} accent="amber" />
        <KpiCard label="Düzeltildi" value={counts.recovered} active={filter === 'RECOVERED'} onClick={() => setFilter('RECOVERED')} accent="emerald" />
        <KpiCard label="Başarısız" value={counts.failed} active={filter === 'FAILED'} onClick={() => setFilter('FAILED')} accent="red" />
        <KpiCard label="Gözardı" value={counts.ignored} active={filter === 'IGNORED'} onClick={() => setFilter('IGNORED')} accent="zinc" />
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-12 grid place-items-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </CardContent>
        </Card>
      ) : filteredRows.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-3">
            <div className="h-12 w-12 mx-auto rounded-full bg-emerald-500/10 text-emerald-600 grid place-items-center">
              <TrendingUp className="h-6 w-6" />
            </div>
            <h3 className="font-semibold">
              {filter === 'all' ? 'Stuck sayfa yok' : 'Bu filtrede sonuç yok'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {filter === 'all'
                ? 'GSC verilerine göre tüm sayfaların ya ilk 3 sırada ya da yeterli izlenebilir gösterimi yok. Tarama haftalık otomatik çalışır.'
                : 'Filtre seçimini değiştirerek diğer kayıtları görebilirsiniz.'}
            </p>
            {filter === 'all' && (
              <Button onClick={handleDetect} disabled={detecting} variant="outline" size="sm">
                Şimdi tara
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRows.map((row) => (
            <StuckPageCard
              key={row.id}
              page={row}
              busy={busyIds.has(row.id)}
              expanded={expandedIds.has(row.id)}
              onToggle={() => toggleExpand(row.id)}
              onRecover={() => handleRecover(row.id)}
              onIgnore={() => handleIgnore(row.id)}
              onRevert={(recoveryId) => handleRevert(row.id, recoveryId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  active,
  onClick,
  accent = 'brand',
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  accent?: 'brand' | 'amber' | 'emerald' | 'red' | 'zinc';
}) {
  const ring = active
    ? 'ring-2 ring-offset-1 ring-brand/30'
    : 'hover:bg-muted/50';
  const colorMap: Record<string, string> = {
    brand: 'text-foreground',
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
    red: 'text-red-600',
    zinc: 'text-zinc-600',
  };
  return (
    <button onClick={onClick} className={cn('rounded-xl border bg-card p-3 text-left transition-all', ring)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-xl font-bold', colorMap[accent])}>{value}</div>
    </button>
  );
}
