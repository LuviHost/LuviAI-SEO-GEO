'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Radar, RefreshCw, AlertTriangle, CheckCircle2, Scale, Sprout, Clock,
  ExternalLink, Play, Rss, FileText, Plug, Zap, ChevronDown,
} from 'lucide-react';

/**
 * Sektor Istihbarati — GEO/SEO/ASO dunyasinda ne degisti, hangi iddia
 * dogru, RanksUp'in nesini etkiliyor?
 *
 * Panelin merkezinde IDDIA DEFTERI var; ham yayin akisi ikincil. Cunku
 * degerli olan "bugun kac yazi geldi" degil, "neye guvenebiliriz".
 */

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function call<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}/api/intel${path}`, { credentials: 'include', ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const STATUS_META: Record<string, { label: string; icon: any; cls: string }> = {
  MYTH: { label: 'Mit', icon: AlertTriangle, cls: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/25' },
  CONFIRMED: { label: 'Doğrulandı', icon: CheckCircle2, cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
  CONTESTED: { label: 'Çekişmeli', icon: Scale, cls: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25' },
  EMERGING: { label: 'Yeni sinyal', icon: Sprout, cls: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25' },
  STALE: { label: 'Bayat', icon: Clock, cls: 'text-slate-500 bg-slate-500/10 border-slate-500/25' },
};

const GRADE_LABEL: Record<string, string> = {
  'official-doc': 'Resmî doküman',
  'large-n-study': 'Büyük örneklem',
  'controlled-test': 'Kontrollü test',
  'case-study': 'Vaka çalışması',
  'expert-opinion': 'Uzman görüşü',
  anecdote: 'Anekdot',
  speculation: 'Spekülasyon',
};

const TIER_LABEL: Record<string, string> = {
  official: 'Resmî',
  'primary-research': 'Araştırma',
  practitioner: 'Uygulayıcı',
  news: 'Haber',
  community: 'Topluluk',
};

type Tab = 'claims' | 'sources' | 'feed' | 'digest';

export default function AdminIntelPage() {
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('claims');
  const [running, setRunning] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await call('/overview'));
    } catch (err: any) {
      toast.error(`Genel durum alınamadı: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const runStage = async (stage: string, label: string) => {
    setRunning(stage);
    try {
      const res = await call(`/run/${stage}`, { method: 'POST' });
      toast.success(`${label} tamamlandı: ${JSON.stringify(res)}`);
      loadOverview();
    } catch (err: any) {
      toast.error(`${label} hatası: ${err.message}`);
    } finally {
      setRunning(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const claims = overview?.claims ?? {};

  return (
    <div className="space-y-6">
      {/* ── Başlık ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Radar className="h-6 w-6 text-primary" />
            Sektör İstihbaratı
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Her sabah 09:30&apos;da özet. GEO/SEO/ASO dünyasında ne değişti, hangi iddia kanıtla ayakta duruyor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => runStage('collect', 'Toplama')} disabled={!!running}>
            {running === 'collect' ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Rss className="h-3.5 w-3.5 mr-1.5" />}
            Topla
          </Button>
          <Button size="sm" variant="outline" onClick={() => runStage('triage', 'Triage')} disabled={!!running}>
            {running === 'triage' ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
            Ele
          </Button>
          <Button size="sm" variant="outline" onClick={() => runStage('analyze', 'Analiz')} disabled={!!running}>
            {running === 'analyze' ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            Analiz et
          </Button>
          <Button size="sm" variant="outline" onClick={() => runStage('recompute', 'Yeniden tartım')} disabled={!!running}>
            <Scale className="h-3.5 w-3.5 mr-1.5" />
            Yeniden tart
          </Button>
        </div>
      </div>

      {/* ── İddia durumu kartları ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {(['MYTH', 'CONFIRMED', 'CONTESTED', 'EMERGING', 'STALE'] as const).map((s) => {
          const meta = STATUS_META[s];
          const Icon = meta.icon;
          return (
            <Card key={s} className={cn('border', meta.cls)}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs font-medium opacity-80">
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </div>
                <div className="text-3xl font-semibold mt-2 tabular-nums">{claims[s] ?? 0}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Boru hattı özeti ── */}
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <Stat label="Son 7 gün toplanan" value={overview?.items?.last7Days ?? 0} />
          <Stat label="Elenmeyi bekleyen" value={overview?.items?.byStatus?.PENDING ?? 0} />
          <Stat label="Analiz sırasında" value={overview?.items?.byStatus?.RELEVANT ?? 0} />
          <Stat label="Analiz edilmiş" value={overview?.items?.byStatus?.ANALYZED ?? 0} />
          <Stat label="Elenmiş" value={overview?.items?.byStatus?.IRRELEVANT ?? 0} muted />
          <Stat label="Açık aksiyon" value={overview?.openActions ?? 0} />
          <div className="flex items-center gap-1.5 text-xs">
            <Plug className={cn('h-3.5 w-3.5', overview?.xSearchEnabled ? 'text-emerald-500' : 'text-muted-foreground')} />
            <span className="text-muted-foreground">
              X araması {overview?.xSearchEnabled ? 'açık' : 'kapalı (XAI_API_KEY yok)'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Sekmeler ── */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {([
          ['claims', 'İddia Defteri'],
          ['sources', `Kaynaklar (${overview?.sources?.length ?? 0})`],
          ['feed', 'Ham Akış'],
          ['digest', 'Özetler'],
        ] as Array<[Tab, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors',
              tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'claims' && <ClaimsTab onChange={loadOverview} />}
      {tab === 'sources' && <SourcesTab sources={overview?.sources ?? []} disabled={overview?.disabledSources ?? []} onChange={loadOverview} />}
      {tab === 'feed' && <FeedTab />}
      {tab === 'digest' && <DigestTab />}
    </div>
  );
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums', muted && 'text-muted-foreground')}>{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  İDDİA DEFTERİ
// ═══════════════════════════════════════════════════════════════

function ClaimsTab({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<string>('');
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = status ? `?status=${status}` : '';
      setClaims(await call(`/claims${qs}`));
    } catch (err: any) {
      toast.error(`İddialar alınamadı: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const setAction = async (id: string, actionStatus: string) => {
    try {
      await call(`/claims/${id}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionStatus }),
      });
      toast.success('Aksiyon güncellendi');
      load();
      onChange();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {[['', 'Tümü'], ['MYTH', 'Mit'], ['CONFIRMED', 'Doğrulandı'], ['CONTESTED', 'Çekişmeli'], ['EMERGING', 'Yeni'], ['STALE', 'Bayat']].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setStatus(v)}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs border transition-colors',
              status === v ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted',
            )}
          >
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : claims.length === 0 ? (
        <EmptyState
          title="Defter henüz boş"
          desc="Boru hattı çalıştıkça iddialar burada birikir. Üstteki Topla → Ele → Analiz et adımlarını sırayla çalıştırabilirsin."
        />
      ) : (
        claims.map((c) => {
          const meta = STATUS_META[c.status] ?? STATUS_META.EMERGING;
          const Icon = meta.icon;
          const isOpen = open === c.id;
          return (
            <Card key={c.id}>
              <CardContent className="p-4">
                <button className="w-full text-left" onClick={() => setOpen(isOpen ? null : c.id)}>
                  <div className="flex items-start gap-3">
                    <span className={cn('mt-0.5 shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium', meta.cls)}>
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium leading-snug">{c.statement}</div>
                      <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono">{c.slug}</span>
                        <span>{c._count?.evidences ?? 0} kanıt</span>
                        <span>destek {c.supportWeight} / karşıt {c.refuteWeight}</span>
                        {Array.isArray(c.topics) && c.topics.length > 0 && (
                          <span className="flex gap-1">
                            {c.topics.map((t: string) => (
                              <span key={t} className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{t}</span>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronDown className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', isOpen && 'rotate-180')} />
                  </div>
                </button>

                {c.guidance && (
                  <div className="mt-3 text-sm bg-muted/50 rounded-md px-3 py-2 border-l-2 border-primary/40">
                    <span className="font-medium">Nasıl kullanılır: </span>{c.guidance}
                  </div>
                )}

                {isOpen && (
                  <div className="mt-4 space-y-3 border-t pt-3">
                    <div className="text-xs font-medium text-muted-foreground">KANIT ZİNCİRİ</div>
                    {(c.evidences ?? []).map((e: any, i: number) => (
                      <div key={i} className="text-sm border rounded-md p-3 bg-muted/20">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className={cn(
                            'px-1.5 py-0.5 rounded font-medium',
                            e.stance === 'refutes' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                              : e.stance === 'supports' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                          )}>
                            {e.stance === 'refutes' ? 'çürütüyor' : e.stance === 'supports' ? 'destekliyor' : 'kısmen'}
                          </span>
                          <span className="font-medium">{GRADE_LABEL[e.grade] ?? e.grade}</span>
                          {e.sampleSize && <span className="text-muted-foreground">N={e.sampleSize.toLocaleString('tr-TR')}</span>}
                          <span className="text-muted-foreground">ağırlık {e.weight}</span>
                          <span className="text-muted-foreground">· {e.item?.source?.name}</span>
                          {e.item?.source?.tier && (
                            <span className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{TIER_LABEL[e.item.source.tier] ?? e.item.source.tier}</span>
                          )}
                        </div>
                        {e.quote && (
                          <blockquote className="mt-2 text-xs text-muted-foreground border-l-2 pl-2.5 italic">
                            {e.quote}
                          </blockquote>
                        )}
                        {e.item?.url && (
                          <a
                            href={e.item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            {e.item.title?.slice(0, 90)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    ))}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-xs text-muted-foreground">Ürün tarafı:</span>
                      {Array.isArray(c.productAreas) && c.productAreas.map((a: string) => (
                        <span key={a} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-mono">{a}</span>
                      ))}
                      <div className="ml-auto flex gap-1.5">
                        {['OPEN', 'PLANNED', 'APPLIED', 'REJECTED'].map((s) => (
                          <button
                            key={s}
                            onClick={() => setAction(c.id, s)}
                            className={cn(
                              'px-2 py-1 rounded text-[11px] border transition-colors',
                              c.actionStatus === s ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted',
                            )}
                          >
                            {s === 'OPEN' ? 'Açık' : s === 'PLANNED' ? 'Planlandı' : s === 'APPLIED' ? 'Uygulandı' : 'Reddedildi'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  KAYNAKLAR
// ═══════════════════════════════════════════════════════════════

function SourcesTab({ sources, disabled, onChange }: { sources: any[]; disabled: any[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (id: string, enabled: boolean) => {
    setBusy(id);
    try {
      await call(`/sources/${id}/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      onChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const collectOne = async (id: string, name: string) => {
    setBusy(id);
    try {
      const res: any = await call(`/sources/${id}/collect`, { method: 'POST' });
      if (res.ok) toast.success(`${name}: ${res.newItems} yeni kayıt`);
      else toast.error(`${name}: ${res.error}`);
      onChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Kaynak</th>
                <th className="px-3 py-2 font-medium">Katman</th>
                <th className="px-3 py-2 font-medium">Tip</th>
                <th className="px-3 py-2 font-medium text-right">Ağırlık</th>
                <th className="px-3 py-2 font-medium text-right">Sıklık</th>
                <th className="px-3 py-2 font-medium text-right">Kayıt</th>
                <th className="px-3 py-2 font-medium">Son çekim</th>
                <th className="px-3 py-2 font-medium">Durum</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className={cn('border-b last:border-0', !s.enabled && 'opacity-55')}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{s.key}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{TIER_LABEL[s.tier] ?? s.tier}</td>
                  <td className="px-3 py-2 text-xs uppercase text-muted-foreground">{s.kind}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.weight}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">{s.intervalHours}sa</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s._count?.items ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {s.lastFetchedAt ? new Date(s.lastFetchedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {!s.enabled ? (
                      <span className="text-xs text-rose-600 dark:text-rose-400" title={s.lastError ?? ''}>Devre dışı</span>
                    ) : s.failCount > 0 ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400" title={s.lastError ?? ''}>{s.failCount} hata</span>
                    ) : s.lastError ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400" title={s.lastError}>uyarı</span>
                    ) : (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">Sağlam</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => collectOne(s.id, s.name)}
                      disabled={busy === s.id}
                      className="text-xs px-2 py-1 rounded hover:bg-muted disabled:opacity-50"
                    >
                      Çek
                    </button>
                    <button
                      onClick={() => toggle(s.id, !s.enabled)}
                      disabled={busy === s.id}
                      className="text-xs px-2 py-1 rounded hover:bg-muted disabled:opacity-50"
                    >
                      {s.enabled ? 'Kapat' : 'Aç'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {disabled.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium mb-2">Denenmiş, erişilemeyen kaynaklar</div>
            <div className="space-y-1.5">
              {disabled.map((d, i) => (
                <div key={i} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{d.name}</span> — {d.reason}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  HAM AKIŞ — triage denetimi
// ═══════════════════════════════════════════════════════════════

function FeedTab() {
  const [status, setStatus] = useState('RELEVANT');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    call(`/items?status=${status}&limit=100`)
      .then(setItems)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {[['RELEVANT', 'Alakalı'], ['PENDING', 'Bekleyen'], ['ANALYZED', 'Analiz edilmiş'], ['IRRELEVANT', 'Elenmiş'], ['FAILED', 'Hatalı']].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setStatus(v)}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs border transition-colors',
              status === v ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted',
            )}
          >
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState title="Bu durumda kayıt yok" desc="Farklı bir filtre dene." />
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {items.map((it) => (
              <div key={it.id} className="p-3 flex items-start gap-3">
                <div className="shrink-0 w-12 text-center">
                  <div className={cn(
                    'text-sm font-semibold tabular-nums',
                    (it.relevance ?? 0) >= 75 ? 'text-emerald-600 dark:text-emerald-400'
                      : (it.relevance ?? 0) >= 55 ? 'text-amber-600 dark:text-amber-400'
                      : 'text-muted-foreground',
                  )}>
                    {it.relevance ?? '—'}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <a href={it.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline inline-flex items-start gap-1">
                    {it.title}
                    <ExternalLink className="h-3 w-3 mt-1 shrink-0 opacity-60" />
                  </a>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span>{it.source?.name}</span>
                    {it.publishedAt && <span>{new Date(it.publishedAt).toLocaleDateString('tr-TR')}</span>}
                    {it.engagement != null && <span>{it.engagement} etkileşim</span>}
                    {Array.isArray(it.topics) && it.topics.map((t: string) => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{t}</span>
                    ))}
                  </div>
                  {it.triageNote && (
                    <div className="text-[11px] text-muted-foreground mt-1 italic">{it.triageNote}</div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  ÖZETLER
// ═══════════════════════════════════════════════════════════════

function DigestTab() {
  const [digest, setDigest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDigest(await call('/digest/latest'));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const build = async (period: 'daily' | 'weekly') => {
    setBuilding(true);
    try {
      await call('/digest/build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // send:false — panelden elle uretimde e-posta gitmesin
        body: JSON.stringify({ period, send: false }),
      });
      toast.success('Özet üretildi');
      load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => build('daily')} disabled={building}>
          <FileText className="h-3.5 w-3.5 mr-1.5" />
          Günlük özet üret
        </Button>
        <Button size="sm" variant="outline" onClick={() => build('weekly')} disabled={building}>
          <FileText className="h-3.5 w-3.5 mr-1.5" />
          Haftalık özet üret
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-96" />
      ) : !digest ? (
        <EmptyState title="Henüz özet yok" desc="Yukarıdaki butonlarla ilk özeti üretebilirsin." />
      ) : (
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground mb-3">
              {digest.period === 'daily' ? 'Günlük' : 'Haftalık'} ·{' '}
              {new Date(digest.date).toLocaleDateString('tr-TR')} ·{' '}
              {digest.emailedAt ? 'e-posta gönderildi' : 'e-posta gönderilmedi'}
            </div>
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{digest.body}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <Card>
      <CardContent className="p-10 text-center">
        <Radar className="h-8 w-8 mx-auto text-muted-foreground/40" />
        <div className="mt-3 font-medium">{title}</div>
        <div className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{desc}</div>
      </CardContent>
    </Card>
  );
}
