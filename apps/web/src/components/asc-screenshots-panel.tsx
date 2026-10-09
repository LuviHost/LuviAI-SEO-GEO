'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Upload, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FilterChip } from '@/components/ui/filter-chip';
import { cn } from '@/lib/utils';

/**
 * Ekran görüntüleri → App Store Connect. Her dosya sunucuda kontrol edilir
 * (boyut, biçim, alfa), onaydan sonra TEK TEK yüklenir. "Değiştir" mevcut
 * görüntüleri kalıcı olarak siler. İncelemeye gönderilmez.
 */

type Row = { file: File; check?: any; status: 'checking' | 'ok' | 'invalid' | 'uploading' | 'done' | 'failed'; message?: string };

export function AscScreenshotsPanel({ siteId, ascAppId }: { siteId: string; ascAppId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [locale, setLocale] = useState<string | undefined>(undefined);
  const [displayType, setDisplayType] = useState('APP_IPHONE_67');
  const [rows, setRows] = useState<Row[]>([]);
  const [replace, setReplace] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const load = async (l?: string) => {
    setLoading(true);
    try {
      const d = await api.getAscScreenshots(siteId, ascAppId, l);
      setData(d);
      setLocale(d?.locale ?? undefined);
    } catch (e: any) {
      toast.error(e?.message ?? 'Ekran görüntüleri alınamadı');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [siteId, ascAppId]);

  const set = data?.sets?.find((s: any) => s.displayType === displayType);
  const existing = set?.screenshots ?? [];
  const max = data?.maxPerSet ?? 10;
  const editable = !!data?.version?.editable;
  const okRows = rows.filter((r) => r.status === 'ok');
  const capacity = replace ? max : max - existing.length;
  const overCapacity = okRows.length > capacity;

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list: Row[] = Array.from(files).slice(0, max).map((file) => ({ file, status: 'checking' }));
    setRows(list);
    setConfirmed(false);
    for (let i = 0; i < list.length; i++) {
      try {
        const check = await api.checkAscScreenshot(siteId, ascAppId, list[i].file, displayType);
        list[i] = { ...list[i], check, status: check.ok ? 'ok' : 'invalid', message: check.ok ? check.note ?? undefined : check.errors.join(' · ') };
      } catch (e: any) {
        list[i] = { ...list[i], status: 'invalid', message: e?.message ?? 'Kontrol edilemedi' };
      }
      setRows([...list]);
    }
  };

  const run = async () => {
    if (!locale) return;
    setRunning(true);
    const list = [...rows];
    try {
      if (replace && existing.length > 0) {
        const r = await api.clearAscScreenshots(siteId, ascAppId, locale, displayType);
        toast.info(`${r.deleted} eski görüntü silindi`);
      }
      for (let i = 0; i < list.length; i++) {
        if (list[i].status !== 'ok') continue;
        list[i] = { ...list[i], status: 'uploading' };
        setRows([...list]);
        try {
          const r = await api.uploadAscScreenshot(siteId, ascAppId, list[i].file, locale, displayType);
          list[i] = { ...list[i], status: r.state === 'FAILED' ? 'failed' : 'done', message: r.state === 'COMPLETE' ? 'Yüklendi' : `Apple işliyor (${r.state})` };
        } catch (e: any) {
          list[i] = { ...list[i], status: 'failed', message: e?.message ?? 'Yüklenemedi' };
        }
        setRows([...list]);
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'İşlem durdu');
    } finally {
      setRunning(false);
      setConfirmed(false);
      setReplace(false);
      await load(locale);
    }
  };

  const removeOne = async (id: string) => {
    try {
      await api.deleteAscScreenshot(siteId, ascAppId, id);
      toast.success('Görüntü silindi');
      setPendingDelete(null);
      await load(locale);
    } catch (e: any) {
      toast.error(e?.message ?? 'Silinemedi');
    }
  };

  if (loading && !data) {
    return <div className="mt-3 grid place-items-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }
  if (!data) return null;
  const types = Object.entries(data.displayTypes ?? {}) as Array<[string, { label: string; sizes: number[][] }]>;

  return (
    <div className="mt-3 pt-3 border-t space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">Sürüm {data.version?.versionString ?? '—'}</span>
        <Badge variant={editable ? 'success' : 'secondary'}>{data.version?.state ?? 'sürüm yok'}</Badge>
        {!editable && <span className="text-muted-foreground">Bu durumda ekran görüntüsü değişmez — yeni sürüm oluştur.</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {(data.locales ?? []).map((l: string) => (
          <FilterChip key={l} selected={l === locale} onClick={() => { setRows([]); load(l); }}>{l}</FilterChip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {types.map(([key, t]) => (
          <FilterChip key={key} selected={key === displayType} onClick={() => { setDisplayType(key); setRows([]); setReplace(false); }}>{t.label}</FilterChip>
        ))}
      </div>
      <p className="text-label text-muted-foreground">
        Kabul edilen boyutlar: {(data.displayTypes?.[displayType]?.sizes ?? []).map((s: number[]) => `${s[0]}×${s[1]}`).join(', ')} (dikey ya da yatay) · PNG/JPEG · en fazla {max}
      </p>

      <div>
        <p className="text-xs font-medium mb-2">Mevcut: {existing.length}/{max}</p>
        {existing.length === 0 ? (
          <p className="text-xs text-muted-foreground">Bu boyutta görüntü yok.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {existing.map((s: any) => (
              <div key={s.id} className="relative w-16">
                {s.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.thumb} alt={s.fileName} className="w-16 rounded border" />
                ) : (
                  <div className="w-16 h-32 rounded border bg-muted" />
                )}
                {editable && (pendingDelete === s.id ? (
                  <div className="absolute inset-0 bg-background/90 rounded grid place-items-center gap-1 p-1">
                    <Button size="sm" variant="destructive" className="h-6 px-2 text-label" onClick={() => removeOne(s.id)}>Sil</Button>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-label" onClick={() => setPendingDelete(null)}>Vazgeç</Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label={`${s.fileName} sil`}
                    onClick={() => setPendingDelete(s.id)}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border grid place-items-center"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ))}
                {s.state !== 'COMPLETE' && <p className="text-label text-muted-foreground mt-0.5 truncate">{s.state}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {editable && (
        <div className="space-y-3">
          <label className="text-xs font-medium block">
            Yüklenecek görüntüler (Studio dışa aktarımları dahil — alfa kanalı sunucuda kaldırılır)
            <input
              type="file"
              accept="image/png,image/jpeg"
              multiple
              disabled={running}
              onChange={(e) => pickFiles(e.target.files)}
              className="mt-1 block text-xs"
            />
          </label>

          {rows.length > 0 && (
            <div className="space-y-1">
              {rows.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {r.status === 'checking' || r.status === 'uploading' ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 mt-0.5" />
                    : r.status === 'ok' || r.status === 'done' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    : <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />}
                  <span className="min-w-0">
                    <span className="font-medium">{r.file.name}</span>
                    {r.check?.width ? <span className="text-muted-foreground"> · {r.check.width}×{r.check.height}</span> : null}
                    {r.message && <span className={cn(r.status === 'invalid' || r.status === 'failed' ? 'text-rose-600' : 'text-muted-foreground')}> · {r.message}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {okRows.length > 0 && !running && (
            <div className="space-y-2">
              {existing.length > 0 && (
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5" />
                  <span>Değiştir: mevcut {existing.length} görüntü <strong>kalıcı olarak silinsin</strong>, sonra yüklensin (geri alınamaz).</span>
                </label>
              )}
              {overCapacity && (
                <p className="text-xs text-rose-600">Sette yer yok: {okRows.length} görüntü için {capacity} yer var. Değiştir&apos;i seç ya da daha az görüntü seç.</p>
              )}
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
                <span>{okRows.length} görüntü {locale} · {data.displayTypes?.[displayType]?.label} setine yüklenecek. İncelemeye gönderilmez.</span>
              </label>
              <Button size="sm" onClick={run} disabled={!confirmed || overCapacity || !locale}>
                <Upload className="h-4 w-4 mr-1" /> Yükle
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
