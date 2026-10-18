'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Copy, Info, AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api, type AutoFixPreview } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Kök dosya düzeltmesi önizlemesi — yazmadan önce mevcut içerik, önerilen
 * içerik ve satır farkı gösterilir; uygulama açık onay ister.
 *
 * NEDEN: eski "Otomatik Düzelt" düğmesi müşterinin robots.txt / sitemap.xml
 * dosyasının üzerine sormadan yazıyordu. Artık API önizleme anahtarı
 * (previewToken) olmadan robots.txt'ye yazmaz; dosya önizlemeden sonra
 * değiştiyse uygulamayı reddeder.
 */

const ACTION_LABEL: Record<AutoFixPreview['action'], { text: string; variant: 'success' | 'info' | 'warning' | 'secondary' }> = {
  merge: { text: 'Mevcut dosyaya ekleme', variant: 'info' },
  create: { text: 'Yeni dosya', variant: 'info' },
  regenerate: { text: 'RanksUp dosyasını yenileme', variant: 'info' },
  none: { text: 'Değişiklik gerekmiyor', variant: 'success' },
  refuse: { text: 'Otomatik uygulanamaz', variant: 'warning' },
};

type Row = { kind: 'line'; op: 'same' | 'add' | 'del'; text: string } | { kind: 'gap'; count: number };

/** Uzun değişmeyen blokları katla — fark okunur kalsın */
function collapse(diff: AutoFixPreview['diff']): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < diff.length) {
    if (diff[i].op !== 'same') { rows.push({ kind: 'line', ...diff[i] }); i++; continue; }
    let j = i;
    while (j < diff.length && diff[j].op === 'same') j++;
    const run = diff.slice(i, j);
    if (run.length > 8) {
      run.slice(0, 3).forEach((l) => rows.push({ kind: 'line', ...l }));
      rows.push({ kind: 'gap', count: run.length - 6 });
      run.slice(-3).forEach((l) => rows.push({ kind: 'line', ...l }));
    } else {
      run.forEach((l) => rows.push({ kind: 'line', ...l }));
    }
    i = j;
  }
  return rows;
}

export function AutoFixPreviewDialog({
  siteId, fixKey, checkName, open, onOpenChange, onApplied,
}: {
  siteId: string;
  fixKey: string | null;
  checkName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}) {
  const [preview, setPreview] = useState<AutoFixPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [aiTrain, setAiTrain] = useState<'yes' | 'no'>('yes');
  const isRobots = fixKey === 'robots_txt' || fixKey === 'robots';

  const load = useCallback(async (train: 'yes' | 'no') => {
    if (!fixKey) return;
    setLoading(true);
    setConfirmed(false);
    setLoadError(null);
    try {
      setPreview(await api.previewAutoFix(siteId, fixKey, isRobots ? { aiTrain: train } : undefined));
    } catch (err: any) {
      setPreview(null);
      setLoadError(err.message ?? 'Önizleme alınamadı.');
    } finally {
      setLoading(false);
    }
  }, [siteId, fixKey, isRobots]);

  // Her açılışta varsayılan (ai-train=yes) ile taze önizleme
  useEffect(() => {
    if (!open || !fixKey) return;
    setPreview(null);
    setAiTrain('yes');
    load('yes');
  }, [open, fixKey, load]);

  const rows = useMemo(() => (preview ? collapse(preview.diff) : []), [preview]);

  const apply = async () => {
    if (!fixKey || !preview?.previewToken) return;
    setApplying(true);
    try {
      const res: any = await api.applyAutoFix(siteId, [fixKey], { [fixKey]: preview.previewToken });
      const file = Array.isArray(res?.files) ? res.files[0] : null;
      if (Array.isArray(res?.applied) && res.applied.length > 0) {
        if (file?.verified) toast.success(`${preview.filename} yüklendi ve sitede doğrulandı.`);
        else toast.warning(`${preview.filename} yüklendi ama sitede henüz görünmüyor — önbellek (CDN) ya da yayın hedefindeki kök dizin ayarı olabilir.`, { duration: 9000 });
        onOpenChange(false);
        onApplied();
        return;
      }
      const e = res?.errors?.[0];
      toast.error(e?.error ?? res?.unchanged?.[0]?.reason ?? 'Değişiklik uygulanmadı.', { duration: 9000 });
      if (e?.code === 'preview_stale' || e?.code === 'preview_expired') load(aiTrain);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setApplying(false);
    }
  };

  // Dosya varsa yalnız eklenecek satırlar kopyalanır: tam içeriği kopyalayıp
  // yapıştırmak, sunucudaki dosyanın görmediğimiz kısmını ezebilirdi
  const copyProposed = () => {
    if (!preview?.proposed) return;
    const text = preview.current.exists
      ? preview.diff.filter((l) => l.op === 'add').map((l) => l.text).join('\n') + '\n'
      : preview.proposed;
    navigator.clipboard.writeText(text).then(
      () => toast.success(preview.current.exists ? 'Eklenecek satırlar kopyalandı' : 'Önerilen içerik kopyalandı'),
      () => toast.error('Kopyalanamadı'),
    );
  };

  const action = preview ? ACTION_LABEL[preview.action] : null;
  const writable = !!preview && (preview.action === 'merge' || preview.action === 'create' || preview.action === 'regenerate');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{preview ? `${preview.filename} önizlemesi` : `${checkName} — önizleme`}</DialogTitle>
          <DialogDescription>
            {preview ? preview.reason : loadError ? 'Önizleme alınamadı.' : 'Sitedeki mevcut dosya okunuyor…'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {loadError && !loading ? (
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-px shrink-0 text-danger" aria-hidden />
              <span>{loadError}</span>
            </div>
          ) : loading || !preview ? (
            <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Mevcut dosya okunuyor ve öneri hazırlanıyor…
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {action && <Badge variant={action.variant}>{action.text}</Badge>}
                <span className="text-xs text-muted-foreground break-all">{preview.url}</span>
                {preview.diff.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    <span className="text-success">+{preview.stats.added}</span>
                    {' / '}
                    <span className={preview.stats.removed > 0 ? 'text-danger' : undefined}>−{preview.stats.removed}</span> satır
                  </span>
                )}
              </div>

              {isRobots && writable && (
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="text-xs font-medium">İçerik kullanım sinyali (Content-Signal) — AI eğitimi</div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={aiTrain === 'yes' ? 'default' : 'outline'} disabled={loading}
                      onClick={() => { if (aiTrain !== 'yes') { setAiTrain('yes'); load('yes'); } }}>
                      İzin ver (ai-train=yes)
                    </Button>
                    <Button size="sm" variant={aiTrain === 'no' ? 'default' : 'outline'} disabled={loading}
                      onClick={() => { if (aiTrain !== 'no') { setAiTrain('no'); load('no'); } }}>
                      İzin verme (ai-train=no)
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Bu bir beyandır, teknik engel değildir. search ve ai-input her durumda &quot;yes&quot; yazılır; dosyanda zaten bir Content-Signal satırı varsa yenisi eklenmez.
                  </p>
                  {/* Cloudflare'in kendi belgesi: robots.txt tercih bildirir, engellemeyi
                      paneldeki AI bot politikalari yapar (blog.cloudflare.com/accountable-mixed-use-ai-crawlers) */}
                  <p className="text-xs text-muted-foreground">
                    Cloudflare kullanıyorsan Googlebot, Bingbot ve Applebot&apos;u etkileyen bu seçim değil, Cloudflare panelindeki AI bot politikalarıdır: Training için &quot;Block&quot; bu botları arama dahil durdurur; aramada kalıp yalnız eğitimi reddetmek için &quot;Disallow AI Training&quot; seçeneği var.
                  </p>
                </div>
              )}

              {preview.notes.length > 0 && (
                <ul className="space-y-1">
                  {preview.notes.map((n, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden /> <span>{n}</span>
                    </li>
                  ))}
                </ul>
              )}

              {rows.length > 0 && (
                <div className="rounded-md border bg-muted/30 max-h-80 overflow-auto" aria-label="Satır farkı">
                  <pre className="text-xs font-mono leading-relaxed p-2 min-w-max">
                    {rows.map((r, i) => r.kind === 'gap' ? (
                      <div key={i} className="text-muted-foreground italic px-2 py-0.5">… {r.count} satır değişmedi …</div>
                    ) : (
                      <div
                        key={i}
                        className={cn(
                          'px-2 whitespace-pre',
                          r.op === 'add' && 'bg-success/10 text-success',
                          r.op === 'del' && 'bg-danger/10 text-danger line-through',
                          r.op === 'same' && 'text-muted-foreground',
                        )}
                      >
                        {r.op === 'add' ? '+ ' : r.op === 'del' ? '− ' : '  '}{r.text || ' '}
                      </div>
                    ))}
                  </pre>
                </div>
              )}

              {!preview.canApply && preview.proposed && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
                  <div className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0 text-warning" aria-hidden />
                    <span>
                      {preview.current.exists
                        ? `Bu değişiklik otomatik uygulanamıyor. Yukarıdaki "+" satırlarını kopyalayıp sunucundaki ${preview.filename} dosyasının sonuna elle ekleyebilirsin; mevcut satırlara dokunma.`
                        : `Bu değişiklik otomatik uygulanamıyor. Önerilen içeriği kopyalayıp site köküne ${preview.filename} olarak elle yükleyebilirsin.`}
                    </span>
                  </div>
                  <Button size="sm" variant="outline" onClick={copyProposed}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> {preview.current.exists ? 'Eklenecek satırları kopyala' : 'Önerilen içeriği kopyala'}
                  </Button>
                </div>
              )}

              {preview.canApply && (
                <label className="flex items-start gap-2 rounded-lg border p-3 text-xs cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  <span>
                    Değişiklikleri inceledim; {preview.filename} dosyası {preview.target?.name ? `"${preview.target.name}" yayın hedefi` : 'yayın hedefi'} üzerinden yazılsın.
                    {preview.current.exists ? ' Mevcut içerik yedeklenir; dosya o günden beri değişmediyse geri alınabilir.' : ''}
                  </span>
                </label>
              )}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Kapat</Button>
          {preview?.canApply && (
            <Button size="sm" onClick={apply} disabled={!confirmed || applying || loading}>
              {applying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
              Onayla ve uygula
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
