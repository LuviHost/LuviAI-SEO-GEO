'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RotateCcw, Eye, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FilterChip } from '@/components/ui/filter-chip';
import { cn } from '@/lib/utils';

/**
 * App Store Connect metadata: çek → düzenle → farkı gör (dry-run) → onayla →
 * uygula → gerekirse geri al. Plan 15 dk geçerli; uygulamadan önce sunucu
 * değerleri yeniden çeker, arada ASC'de değişen alan varsa hiçbir şey yazmaz.
 * İncelemeye gönderme yok.
 */

type Field = 'name' | 'subtitle' | 'keywords' | 'promotionalText' | 'description' | 'whatsNew';

const FIELDS: { key: Field; label: string; limit: number; multiline?: boolean }[] = [
  { key: 'name', label: 'Ad', limit: 30 },
  { key: 'subtitle', label: 'Alt başlık', limit: 30 },
  { key: 'keywords', label: 'Anahtar kelimeler', limit: 100 },
  { key: 'promotionalText', label: 'Promosyon metni', limit: 170, multiline: true },
  { key: 'description', label: 'Açıklama', limit: 4000, multiline: true },
  { key: 'whatsNew', label: 'Yenilikler', limit: 4000, multiline: true },
];
const LABEL: Record<string, string> = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
const chars = (s: string) => [...(s ?? '')].length;

function lockReason(field: Field, snap: any): string | null {
  if (field === 'name' || field === 'subtitle') {
    return snap.appInfo?.editable ? null : `Ad/alt başlık yalnız yeni sürüm hazırlanırken değişir (${snap.appInfo?.state ?? '—'})`;
  }
  if (field === 'promotionalText') return snap.version ? null : 'Sürüm yok';
  if (!snap.version?.editable) return `Sürüm ${snap.version?.versionString ?? '—'} düzenlenemez (${snap.version?.state ?? '—'})`;
  if (field === 'whatsNew' && snap.isFirstVersion) return 'İlk sürümde girilemez';
  return null;
}

export function AscMetadataPanel({ siteId, ascAppId }: { siteId: string; ascAppId: string }) {
  const [snap, setSnap] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [locale, setLocale] = useState<string>('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<any>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'plan' | 'apply' | 'revert' | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[] | null>(null);

  const load = async (keepLocale?: string) => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        api.getAscMetadata(siteId, ascAppId),
        api.getAscMetadataHistory(siteId, ascAppId).catch(() => []),
      ]);
      setSnap(s);
      setHistory(h ?? []);
      const locales = Object.keys(s?.locales ?? {});
      const next = keepLocale && locales.includes(keepLocale) ? keepLocale : locales.includes('tr') ? 'tr' : locales[0] ?? '';
      setLocale(next);
      setDraft({ ...(s?.locales?.[next]?.values ?? {}) });
    } catch (e: any) {
      toast.error(e?.message ?? 'Metadata çekilemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [siteId, ascAppId]);

  const current = snap?.locales?.[locale]?.values ?? {};
  const changed = useMemo(
    () => Object.fromEntries(FIELDS.filter((f) => (draft[f.key] ?? '') !== (current[f.key] ?? '')).map((f) => [f.key, draft[f.key] ?? ''])),
    [draft, current],
  );

  const switchLocale = (l: string) => {
    setLocale(l);
    setDraft({ ...(snap?.locales?.[l]?.values ?? {}) });
    setPlan(null);
    setConflicts(null);
  };

  const makePlan = async () => {
    setBusy('plan');
    setConflicts(null);
    setConfirmed(false);
    try {
      setPlan(await api.planAscMetadata(siteId, ascAppId, { locale, fields: changed }));
    } catch (e: any) {
      toast.error(e?.message ?? 'Plan oluşturulamadı');
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!plan?.planId) return;
    setBusy('apply');
    try {
      const r = await api.applyAscMetadata(siteId, ascAppId, plan.planId);
      const failed = (r.results ?? []).filter((x: any) => !x.ok);
      if (failed.length === 0) toast.success('App Store Connect güncellendi');
      else failed.forEach((f: any) => toast.error(f.error));
      setPlan(null);
      await load(locale);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) setConflicts((e.rawBody as any)?.conflicts ?? []);
      toast.error(e?.message ?? 'Uygulanamadı');
      setPlan(null);
    } finally {
      setBusy(null);
    }
  };

  const revert = async (fixId: string) => {
    setBusy('revert');
    setConflicts(null);
    setConfirmed(false);
    try {
      const p = await api.revertAscMetadata(siteId, ascAppId, fixId);
      setPlan(p);
      if (!p?.planId) toast.info('Geri alınacak uygulanabilir değişiklik yok');
    } catch (e: any) {
      toast.error(e?.message ?? 'Geri alma planı oluşturulamadı');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="mt-3 grid place-items-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }
  if (!snap) return null;
  const locales = Object.keys(snap.locales ?? {});

  return (
    <div className="mt-3 pt-3 border-t space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">Sürüm {snap.version?.versionString ?? '—'}</span>
        <Badge variant={snap.version?.editable ? 'success' : 'secondary'}>{snap.version?.state ?? 'sürüm yok'}</Badge>
        <span className="text-muted-foreground">App bilgisi:</span>
        <Badge variant={snap.appInfo?.editable ? 'success' : 'secondary'}>{snap.appInfo?.state ?? '—'}</Badge>
      </div>

      {locales.length === 0 ? (
        <p className="text-xs text-muted-foreground">Bu sürümde yerelleştirme yok.</p>
      ) : (
        <>
          {locales.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {locales.map((l) => <FilterChip key={l} selected={l === locale} onClick={() => switchLocale(l)}>{l}</FilterChip>)}
            </div>
          )}

          <div className="space-y-3">
            {FIELDS.map((f) => {
              const lock = lockReason(f.key, snap);
              const v = draft[f.key] ?? '';
              const n = chars(v);
              const Comp: any = f.multiline ? Textarea : Input;
              return (
                <div key={f.key}>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor={`asc-${f.key}`} className="text-xs font-medium">{f.label}</label>
                    <span className={cn('text-label', n > f.limit ? 'text-rose-600' : 'text-muted-foreground')}>{n}/{f.limit}</span>
                  </div>
                  <Comp
                    id={`asc-${f.key}`}
                    value={v}
                    disabled={!!lock}
                    onChange={(e: any) => { setDraft({ ...draft, [f.key]: e.target.value }); setPlan(null); }}
                    className={cn(f.key === 'keywords' && 'font-mono', f.key === 'description' && 'min-h-[140px]')}
                  />
                  {lock && <p className="text-label text-muted-foreground mt-1">{lock}</p>}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={makePlan} disabled={busy !== null || Object.keys(changed).length === 0}>
              {busy === 'plan' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Eye className="h-4 w-4 mr-1" />} Farkı gör
            </Button>
            {Object.keys(changed).length > 0 && (
              <Button size="sm" variant="outline" onClick={() => { setDraft({ ...current }); setPlan(null); }}>Değişiklikleri sıfırla</Button>
            )}
          </div>
        </>
      )}

      {conflicts && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs space-y-1">
          <p className="font-medium">Plandan sonra App Store Connect&apos;te değişmiş — hiçbir şey yazılmadı:</p>
          {conflicts.map((c: any, i: number) => <p key={i}>{c.locale} · {LABEL[c.field] ?? c.field}: şu an &quot;{c.actual}&quot;</p>)}
        </div>
      )}

      {plan && (
        <div className="rounded-md border p-3 space-y-3">
          <p className="text-xs font-semibold">Değişiklik planı (henüz hiçbir şey yazılmadı)</p>
          {plan.changes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Değişiklik yok.</p>
          ) : (
            <div className="space-y-2">
              {plan.changes.map((c: any, i: number) => (
                <div key={i} className={cn('rounded border p-2 text-xs space-y-1', c.ok ? 'border-emerald-500/20' : 'border-rose-500/30 bg-rose-500/5')}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.locale} · {LABEL[c.field] ?? c.field}</span>
                    <span className="text-muted-foreground">{c.length}/{c.limit}</span>
                    {!c.ok && <Badge variant="destructive">yazılmaz</Badge>}
                  </div>
                  <p className="text-muted-foreground line-through break-words whitespace-pre-wrap">{c.from || '(boş)'}</p>
                  <p className="break-words whitespace-pre-wrap">{c.to || '(boş)'}</p>
                  {c.reason && <p className="text-rose-600">{c.reason}</p>}
                </div>
              ))}
            </div>
          )}
          {plan.keywordAudit?.findings?.length > 0 && (
            <div className="space-y-1 text-xs">
              <p className="font-medium">Anahtar kelime denetimi</p>
              {plan.keywordAudit.findings.map((f: any, i: number) => (
                <p key={i} className={f.severity === 'error' ? 'text-rose-600' : f.severity === 'warning' ? 'text-amber-600' : 'text-muted-foreground'}>• {f.message}</p>
              ))}
            </div>
          )}
          {plan.planId ? (
            <>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
                <span>Yeşil işaretli alanlar App Store Connect&apos;teki kayda şimdi yazılacak. İncelemeye gönderilmez; geri alınabilir. Plan 15 dakika geçerli.</span>
              </label>
              <Button size="sm" onClick={apply} disabled={!confirmed || busy !== null}>
                {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />} Uygula
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Uygulanabilir değişiklik yok.</p>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold">Geçmiş</p>
          {history.map((h: any) => (
            <div key={h.id} className="rounded border p-2 text-xs flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <p>
                  <span className="font-medium">{h.detail?.locale}</span> · {Object.keys(h.detail?.fields ?? {}).map((f) => LABEL[f] ?? f).join(', ') || '—'}
                  <span className="text-muted-foreground"> · {new Date(h.appliedAt).toLocaleString('tr-TR')}</span>
                </p>
                {h.error && <p className="text-rose-600">{h.error}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={h.status === 'APPLIED' ? 'success' : h.status === 'FAILED' ? 'destructive' : 'secondary'}>
                  {h.status === 'APPLIED' ? 'uygulandı' : h.status === 'FAILED' ? 'başarısız' : 'geri alındı'}
                </Badge>
                {h.status === 'APPLIED' && (
                  <Button size="sm" variant="outline" onClick={() => revert(h.id)} disabled={busy !== null}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Geri al
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
