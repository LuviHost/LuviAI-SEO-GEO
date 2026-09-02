'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/info-tooltip';
import { PlanLockedCard } from '@/components/plan-locked-card';
import { api } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
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
  ChevronDown,
  X,
  Lightbulb,
  Send,
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

// Status icin hover hint (title attribute)
function getStatusHint(status: string): string {
  switch (status) {
    case 'DETECTED':   return 'AI henüz dokunmadı. AI Düzelt tıklayarak recovery başlatabilirsin.';
    case 'RECOVERING': return 'AI şu an çalışıyor. ~30 saniye sürer.';
    case 'RECOVERED':  return 'AI ile iyileştirildi ve yeniden yayınlandı. 24-48 saatte Google etkisi başlar, 30 gün sonra otomatik performans ölçümü.';
    case 'FAILED':     return 'Recovery uygulanamadı. Sebep: içerik çok ince, LLM önerisi üretemedi VEYA external sayfa için publish target eksik.';
    case 'REVERTED':   return 'AI iyileştirmesi geri alındı, sayfanın eski hali tekrar yayında.';
    case 'IGNORED':    return 'Bu sayfa "dokunma" işaretiyle gözardı edildi.';
    default: return '';
  }
}

// Pozisyon icin beklenen CTR (Sistrix ortalamasi) — tooltip'lerde kullaniliyor
function expectedCtrFor(position: number): number {
  const map: Record<number, number> = {
    1: 27, 2: 15, 3: 11, 4: 8, 5: 6, 6: 4.5, 7: 3.5, 8: 3, 9: 2.5, 10: 2.5,
    11: 2, 12: 1.8, 13: 1.5, 14: 1.2, 15: 1,
  };
  const r = Math.max(1, Math.min(15, Math.round(position)));
  return map[r] ?? 1;
}

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
  selected,
  onSelect,
  selectable,
}: {
  page: StuckPageRow;
  busy: boolean;
  onRecover: () => void;
  onIgnore: () => void;
  onRevert: (recoveryId: string) => void;
  expanded: boolean;
  onToggle: () => void;
  selected: boolean;
  onSelect: () => void;
  selectable: boolean;
}) {
  const lastRecovery = page.recoveries?.[0];
  const status = STATUS_LABEL[page.status] ?? STATUS_LABEL.DETECTED;
  const canRecover = page.status === 'DETECTED' || page.status === 'FAILED';
  const isRecovering = page.status === 'RECOVERING';
  const canRevert = page.status === 'RECOVERED' && lastRecovery && !lastRecovery.revertedAt;

  return (
    <Card className={cn('transition-all', expanded && 'ring-2 ring-brand/30', selected && 'ring-2 ring-brand/50 bg-brand/[0.02]')}>
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          {selectable && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              className="mt-1 h-4 w-4 rounded border-2 border-muted-foreground/30 text-brand focus:ring-2 focus:ring-brand/30 cursor-pointer shrink-0"
              aria-label="Bu sayfayi sec"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span
                className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium', status.cls)}
                title={getStatusHint(page.status)}
              >
                {status.text}
              </span>
              <span title={`Öncelik skoru (0-100): ${page.stuckScore}. Yüksek = daha çok kurtarmaya değer. Formül: impressions × CTR boşluğu × pozisyon.`}>
                <ScoreBadge score={page.stuckScore} />
              </span>
              {page.articleId === null && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium bg-zinc-500/10 text-zinc-600 border-zinc-500/30"
                  title="Bu sayfa RanksUp ile değil, sitende elle yazılmış. Recovery için site'ne WordPress / FTP / SFTP / cPanel publish target bağlamalısın."
                >
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
                <div className="text-muted-foreground inline-flex items-center gap-1">
                  Pozisyon
                  <InfoTooltip text={`Google'da ortalama sıralama. Şu an #${Math.round(page.position)}. Top 3'e çıkması hedefleniyor — biraz iyileştirmeyle ulaşılabilir mesafede.`} />
                </div>
                <div className="font-semibold">#{Math.round(page.position)}</div>
              </div>
              <div>
                <div className="text-muted-foreground inline-flex items-center gap-1">
                  Gösterim (30g)
                  <InfoTooltip text="Son 30 günde Google arama sonuçlarında bu sayfa kaç kez gösterildi. Yüksek = sayfa zaten görünüyor, sadece tıklama almıyor." />
                </div>
                <div className="font-semibold">{page.impressions.toLocaleString('tr-TR')}</div>
              </div>
              <div>
                <div className="text-muted-foreground inline-flex items-center gap-1">
                  CTR
                  <InfoTooltip text={`Görenlerin yüzde kaçı tıkladı. Pozisyon #${Math.round(page.position)} için beklenen CTR ~%${expectedCtrFor(page.position).toFixed(1)}. Şu anki: %${(page.ctr * 100).toFixed(2)}. Aradaki fark = kayıp potansiyel.`} />
                </div>
                <div className="font-semibold">%{(page.ctr * 100).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted-foreground inline-flex items-center gap-1">
                  Tıklama
                  <InfoTooltip text="Son 30 günde gerçek tıklama sayısı. AI ile recovery sonrası 24-48 saatte artış başlar, asıl etki 2-4 hafta sonra." />
                </div>
                <div className="font-semibold">{page.clicks}</div>
              </div>
            </div>
            {Array.isArray(page.topQueries) && page.topQueries.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1.5">
                  <span>Top sorgular</span>
                  <InfoTooltip text="Bu sayfanın çıktığı arama terimleri (GSC son 30 gün). AI recovery bu sorgulara optimize cümle önerileri üretir." />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {page.topQueries.slice(0, 5).map((q) => (
                    <span key={q} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {q}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            {canRecover && page.articleId && (
              <Button
                onClick={onRecover} disabled={busy} size="sm" className="gap-1.5"
                title="Claude Sonnet 4.6 ile cümle-seviye edit. ~30 saniye. Başlık, slug ve yapı korunur — sadece eksik anahtar kelimeler doğal akışta eklenir."
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                AI Düzelt
              </Button>
            )}
            {canRecover && !page.articleId && (
              <Link
                href={`/sites/${page.siteId}/publish-targets` as any}
                title="External sayfaları (RanksUp dışı) kurtarmak için WordPress / FTP / SFTP / cPanel publish target bağlamak gerek."
                className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-dashed border-brand-500/40 text-brand-600 hover:bg-brand-500/10 transition-colors"
              >
                <Send className="h-3.5 w-3.5" /> Target bağla
              </Link>
            )}
            {isRecovering && (
              <Button disabled size="sm" variant="outline" className="gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Çalışıyor
              </Button>
            )}
            {canRevert && (
              <Button
                onClick={() => onRevert(lastRecovery!.id)} disabled={busy} size="sm" variant="outline" className="gap-1.5"
                title="AI edit'leri sil, sayfanın recovery öncesi haline yeniden publish et."
              >
                <Undo2 className="h-3.5 w-3.5" /> Geri Al
              </Button>
            )}
            {page.status === 'DETECTED' && (
              <Button
                onClick={onIgnore} disabled={busy} size="sm" variant="ghost" className="gap-1.5 text-muted-foreground"
                title="Bu sayfayı bir daha öneri listesinde gösterme. Detay'dan tekrar açabilirsin."
              >
                <EyeOff className="h-3.5 w-3.5" /> Gözardı
              </Button>
            )}
            {(page.recoveries?.length ?? 0) > 0 && (
              <Button
                onClick={onToggle} size="sm" variant="ghost" className="gap-1.5"
                title="Audit trail: hangi cümleler değişti, eklenen entity'ler, before/after — hepsi burada."
              >
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

// Guide content — kullanici bu sayfayi anlamak icin
const GUIDE_STEPS = [
  {
    icon: TrendingDown,
    title: 'Stuck sayfa nedir?',
    body: 'Google\'da ilk sayfada (pozisyon 4-15) ama top 3\'te değil. Yarı yolda kalmış, biraz iyileştirmeyle yukarı çıkabilir.',
  },
  {
    icon: Sparkles,
    title: 'AI ne yapıyor?',
    body: 'Claude Sonnet 4.6 cümle-seviye edit yapar: eksik anahtar kelimeleri doğal akışta ekler, thin paragraf varsa genişletir. Başlık + slug + yapı dokunulmaz.',
  },
  {
    icon: Send,
    title: 'Etki ne zaman?',
    body: 'AI Düzelt sonrası ~30 sn'+'de yayın güncellenir. Google 24-48 saatte yeniden tarar. 30 gün sonra otomatik performans ölçümü yapılır.',
  },
  {
    icon: AlertTriangle,
    title: '"RanksUp dışı" rozeti?',
    body: 'Bu sayfa RanksUp ile yazılmadı, sitende elle yazılmış. Recovery için WordPress / FTP / SFTP / cPanel publish target bağlı olmalı.',
  },
];

export default function StuckPagesPage() {
  const { site } = useSiteContext();
  const [rows, setRows] = useState<StuckPageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'DETECTED' | 'RECOVERED' | 'FAILED' | 'IGNORED'>('all');
  // ENH#3 — Bulk recovery: multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Guide visibility — localStorage persist
  const [showGuide, setShowGuide] = useState(true);
  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem('luviai_stuck_guide_dismissed');
      if (dismissed === '1') setShowGuide(false);
    } catch {/* noop */}
  }, []);
  const dismissGuide = () => {
    setShowGuide(false);
    try { window.localStorage.setItem('luviai_stuck_guide_dismissed', '1'); } catch {/* noop */}
  };
  const restoreGuide = () => {
    setShowGuide(true);
    try { window.localStorage.removeItem('luviai_stuck_guide_dismissed'); } catch {/* noop */}
  };
  const [bulkBusy, setBulkBusy] = useState(false);

  const { can, requirementFor } = useEntitlements();
  const allowed = can('stuckPages');

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

  // Haklar KESIN gelene kadar istek atilmaz — kapali planda bos 200/403 gurultusu olmasin.
  useEffect(() => {
    if (allowed !== true) return;
    refresh();
  }, [refresh, allowed]);

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

  // ENH#3 — Bulk recovery
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = (ids: string[]) => {
    setSelectedIds(new Set(ids));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkRecover = async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const result = await api.recoverStuckPagesBatch(site.id, Array.from(selectedIds));
      const okCount = result.results.filter((r) => r.ok).length;
      const failCount = result.results.length - okCount;
      if (failCount === 0) {
        toast.success(`Toplu recovery: ${okCount} sayfa düzeltildi`);
      } else {
        toast.warning(`${okCount} başarılı, ${failCount} başarısız — detay için sayfayı yenile`);
      }
      clearSelection();
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Bulk recovery hata');
    } finally {
      setBulkBusy(false);
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

  if (allowed === false) {
    return (
      <PlanLockedCard
        requirement={requirementFor('stuckPages')}
        description="Sıralaması takılmış sayfaları tespit eder ve tek tıkla toplu kurtarma uygular."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center">
          <Wrench className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-h6 font-semibold tracking-tight">Stuck Pages</h2>
            <InfoTooltip text="Google'da ilk sayfada (pozisyon 4-15) ama top 3'te değil olan sayfaların listesi. Yeniden tarama her hafta otomatik (Pazartesi 06:00 UTC) yapılır; manuel tetiklemek için sağ üstte 'Yeniden Tara'." />
          </div>
          <p className="text-sm text-muted-foreground">
            Google'da ilk sayfada ama ilk 3'te değil — AI ile cümle seviyesinde tamir, başlık ve yapı korunur.
            {!showGuide && (
              <>
                {' · '}
                <button onClick={restoreGuide} className="text-brand-600 hover:underline">
                  Nasıl çalışır?
                </button>
              </>
            )}
          </p>
        </div>
        <Button onClick={handleDetect} disabled={detecting} variant="outline" size="sm" className="shrink-0">
          <RefreshCw className={cn('h-4 w-4 mr-1.5', detecting && 'animate-spin')} />
          {detecting ? 'Taranıyor…' : 'Yeniden Tara'}
        </Button>
      </div>

      {/* "Nasıl çalışır" guide — dismissible, localStorage persist */}
      {showGuide && (
        <Card className="border-brand-500/30 bg-gradient-to-br from-brand-500/[0.04] to-transparent">
          <CardContent className="p-5">
            <div className="flex items-start gap-3 mb-4">
              <Lightbulb className="h-5 w-5 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-sm">Nasıl çalışır?</p>
                <p className="text-xs text-muted-foreground mt-0.5">4 adımda Stuck Page Recovery sistemi</p>
              </div>
              <button
                onClick={dismissGuide}
                className="h-7 w-7 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                aria-label="Rehberi kapat"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {GUIDE_STEPS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <div key={i} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400 grid place-items-center shrink-0">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground">0{i + 1}</span>
                      <p className="text-sm font-medium tracking-[-0.01em]">{s.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground leading-[1.55]">{s.body}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-border/60 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                💡 İlk önce <strong className="text-foreground">en yüksek gösterim alan</strong> sayfayı dene — etki orada daha hızlı görünür.
              </span>
              <Link href={`/sites/${site.id}/publish-targets` as any} className="text-brand-600 hover:underline font-medium inline-flex items-center gap-1">
                <Send className="h-3 w-3" /> Yayın hedefi ekle
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI cards — InfoTooltip ile her durum aciklamali */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          label="Toplam"
          tooltip="Algılanan tüm stuck sayfalar — DETECTED + RECOVERED + FAILED + IGNORED toplamı."
          value={counts.total} active={filter === 'all'} onClick={() => setFilter('all')}
        />
        <KpiCard
          label="Tespit"
          tooltip="AI henüz dokunmadı. 'AI Düzelt' tıklayarak recovery başlatabilirsin. Auto-Pilot ON ise her hafta otomatik düzeltilir."
          value={counts.detected} active={filter === 'DETECTED'} onClick={() => setFilter('DETECTED')} accent="amber"
        />
        <KpiCard
          label="Düzeltildi"
          tooltip="AI ile cümle-seviye iyileştirme uygulandı. 24-48 saat sonra Google ranking'i yansır. 30 gün sonra otomatik performans ölçümü yapılır."
          value={counts.recovered} active={filter === 'RECOVERED'} onClick={() => setFilter('RECOVERED')} accent="emerald"
        />
        <KpiCard
          label="Başarısız"
          tooltip="Recovery uygulanamadı. Genelde 2 sebep: (1) içerik çok ince, AI tamir önerisi üretemedi (2) external sayfa için uygun publish target (WP/FTP/SFTP/cPanel) bağlı değil."
          value={counts.failed} active={filter === 'FAILED'} onClick={() => setFilter('FAILED')} accent="red"
        />
        <KpiCard
          label="Gözardı"
          tooltip="'Bu sayfaya dokunulmasın' diye işaretledin. Listede bir daha öneri olarak çıkmaz, ama Detay'dan tekrar açabilirsin."
          value={counts.ignored} active={filter === 'IGNORED'} onClick={() => setFilter('IGNORED')} accent="zinc"
        />
      </div>

      {/* ENH#3 — Bulk toolbar: DETECTED durumdaki secilecek sayfa varsa goster */}
      {filteredRows.some((r) => r.status === 'DETECTED' && r.articleId) && (
        <Card className="border-brand/30 bg-brand/5">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <div className="text-sm flex-1 min-w-0 inline-flex items-center gap-1.5">
              <span className="font-semibold">{selectedIds.size}</span>{' '}
              sayfa seçili
              <InfoTooltip text="Sadece DETECTED durumdaki + RanksUp içi sayfalar bulk seçilebilir. External (RanksUp dışı) sayfalar publish target gerektirdiği için tek tek elle yapılmalı." />
              {selectedIds.size > 0 && (
                <button onClick={clearSelection} className="ml-2 text-xs text-muted-foreground hover:text-foreground underline">
                  temizle
                </button>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => selectAllVisible(
                filteredRows.filter((r) => r.status === 'DETECTED' && r.articleId).map((r) => r.id),
              )}
              title="Görünür listedeki tüm DETECTED + RanksUp içi sayfaları seç (filter aktifse sadece filtreli olanlar)"
            >
              Tümünü seç (DETECTED)
            </Button>
            <Button
              size="sm"
              onClick={handleBulkRecover}
              disabled={selectedIds.size === 0 || bulkBusy}
              className="gap-1.5"
              title={`Seçili ${selectedIds.size} sayfa için AI Düzelt'i sırayla çalıştır. Her biri ~30 sn, toplam yaklaşık ${Math.max(1, selectedIds.size * 30)} sn.`}
            >
              {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Seçilenleri AI ile Düzelt ({selectedIds.size})
            </Button>
          </CardContent>
        </Card>
      )}

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
              selected={selectedIds.has(row.id)}
              selectable={row.status === 'DETECTED' && !!row.articleId}
              onSelect={() => toggleSelected(row.id)}
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
  tooltip,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  accent?: 'brand' | 'amber' | 'emerald' | 'red' | 'zinc';
  tooltip?: string;
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
    <button onClick={onClick} className={cn('rounded-xl border bg-card p-3 text-left transition-all relative group', ring)}>
      <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
        {label}
        {tooltip && (
          <span onClick={(e) => e.stopPropagation()} className="inline-block">
            <InfoTooltip text={tooltip} iconClassName="opacity-60 group-hover:opacity-100" />
          </span>
        )}
      </div>
      <div className={cn('text-metric-lg tabular-nums', colorMap[accent])}>{value}</div>
    </button>
  );
}
