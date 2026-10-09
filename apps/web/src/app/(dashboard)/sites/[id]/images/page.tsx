'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ImageOff, Sparkles, CheckCircle2, AlertTriangle, Loader2, ExternalLink } from 'lucide-react';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MetricCard } from '@/components/ui/metric';
import { FilterChip } from '@/components/ui/filter-chip';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Görsel alt metni — öner → düzenle/onayla → (sonra) siteye yaz.
 * Kaynaklar: Google Search Central "Google Images best practices" (alt metni
 * kullanılır, anahtar kelime doldurma) + W3C WAI (süs görseline alt="" doğru).
 */

const ALT_MAX = 250;

type Filter = 'todo' | 'suggested' | 'approved' | 'applied' | 'dismissed' | 'all';
const FILTERS: Array<{ id: Filter; label: string; status?: string }> = [
  { id: 'todo', label: 'Yapılacak', status: 'NEW,FAILED' },
  { id: 'suggested', label: 'Öneri hazır', status: 'SUGGESTED,DECORATIVE_SUGGESTED' },
  { id: 'approved', label: 'Onaylandı', status: 'APPROVED,DECORATIVE' },
  { id: 'applied', label: 'Uygulandı', status: 'APPLYING,APPLIED,PARTIAL,VERIFIED' },
  { id: 'dismissed', label: 'Yoksayıldı', status: 'DISMISSED' },
  { id: 'all', label: 'Tümü' },
];

const STATUS_LABEL: Record<string, { text: string; variant: 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
  NEW: { text: 'Alt metni yok', variant: 'warning' },
  SUGGESTED: { text: 'Öneri hazır', variant: 'secondary' },
  DECORATIVE_SUGGESTED: { text: 'Süs görseli önerildi', variant: 'secondary' },
  APPROVED: { text: 'Onaylandı', variant: 'success' },
  DECORATIVE: { text: 'Süs görseli (alt="")', variant: 'success' },
  DISMISSED: { text: 'Yoksayıldı', variant: 'outline' },
  APPLYING: { text: 'Yazılıyor…', variant: 'secondary' },
  APPLIED: { text: 'Uygulandı', variant: 'success' },
  PARTIAL: { text: 'Kısmen uygulandı', variant: 'warning' },
  FAILED: { text: 'Hata', variant: 'destructive' },
  VERIFIED: { text: 'Sayfada doğrulandı', variant: 'success' },
};

function pathOf(url: string): string {
  try { return new URL(url).pathname || '/'; } catch { return url; }
}

export default function SiteImagesPage() {
  const { site } = useSiteContext();
  const [filter, setFilter] = useState<Filter>('todo');
  const [summary, setSummary] = useState<any>(null);
  const [items, setItems] = useState<any[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [bulk, setBulk] = useState<{ jobIds: string[]; queued: number } | null>(null);

  const load = useCallback(async () => {
    const f = FILTERS.find((x) => x.id === filter);
    const [s, l] = await Promise.all([
      api.getSiteImagesSummary(site.id).catch(() => null),
      api.listSiteImages(site.id, { status: f?.status }).catch((e: any) => { toast.error(e.message); return null; }),
    ]);
    setSummary(s);
    setItems(l?.items ?? []);
  }, [site.id, filter]);

  useEffect(() => { setItems(null); load(); }, [load]);

  // Toplu öneri işleri bitene kadar yokla
  useEffect(() => {
    if (!bulk) return;
    const t = setInterval(async () => {
      const states = await Promise.all(bulk.jobIds.map((id) => api.getJob(id).catch(() => null)));
      const done = states.every((j: any) => j && ['COMPLETED', 'FAILED', 'CANCELED'].includes(j.status));
      if (done) {
        clearInterval(t);
        setBulk(null);
        const failed = states.filter((j: any) => j?.status === 'FAILED').length;
        if (failed) toast.error(`${failed} öneri işi başarısız oldu`);
        else toast.success('Öneriler hazır — kontrol edip onayla');
        load();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [bulk, load]);

  const counts = useMemo(() => {
    const st = summary?.byStatus ?? {};
    const as = summary?.byAltState ?? {};
    return {
      missing: as.absent ?? 0,
      suspicious: as.present ?? 0,
      pending: (st.SUGGESTED ?? 0) + (st.DECORATIVE_SUGGESTED ?? 0),
      applied: (st.APPLIED ?? 0) + (st.VERIFIED ?? 0),
    };
  }, [summary]);

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try { await fn(); } catch (e: any) { toast.error(e.message); } finally { setBusy((b) => ({ ...b, [id]: false })); }
  };

  const suggestOne = (id: string) => withBusy(id, async () => {
    const r = await api.suggestSiteImage(site.id, id);
    if (r?.outcome?.result === 'failed' || r?.outcome?.result === 'skipped') {
      toast.warning(r.image?.suggestionNote ?? 'Öneri üretilemedi');
    }
    setItems((list) => (list ?? []).map((x) => (x.id === id ? r.image : x)));
    setDrafts((d) => { const { [id]: _, ...rest } = d; return rest; });
  });

  const decide = (id: string, decision: 'approve' | 'decorative' | 'dismiss' | 'reset', approvedAlt?: string) =>
    withBusy(id, async () => {
      const updated = await api.decideSiteImage(site.id, id, { decision, approvedAlt });
      setItems((list) => (list ?? []).map((x) => (x.id === id ? updated : x)));
      api.getSiteImagesSummary(site.id).then(setSummary).catch(() => {});
    });

  const suggestAll = async () => {
    try {
      const r = await api.suggestSiteImages(site.id, { all: true, max: 50 });
      if (r.queued === 0) { toast.message('Öneri bekleyen görsel yok'); return; }
      setBulk({ jobIds: r.jobIds, queued: r.queued });
      toast.message(`${r.queued} görsel için öneri üretiliyor…`);
    } catch (e: any) { toast.error(e.message); }
  };

  const capability = summary?.writeCapability as 'wordpress' | 'static' | 'snippet' | undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-h6 font-semibold tracking-tight">Görsel alt metinleri</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Alt metni olmayan görseller ekran okuyucuda dosya adı olarak okunur, Google da görselin konusunu daha zor anlar.
            Öneriler görseli <em>görerek</em> üretilir; her birini kontrol edip onaylarsın. Süs görselleri için boş alt (alt=&quot;&quot;) doğrudur.
          </p>
        </div>
        <Button onClick={suggestAll} disabled={!!bulk || counts.missing + counts.suspicious === 0}>
          {bulk ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
          {bulk ? `${bulk.queued} öneri üretiliyor…` : 'Eksiklere öneri üret (50)'}
        </Button>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Alt metni yok" value={counts.missing} icon={ImageOff} accent="rose" size="sm" />
        <MetricCard label="Şüpheli alt (dosya adı vb.)" value={counts.suspicious} icon={AlertTriangle} accent="amber" size="sm" />
        <MetricCard label="Onay bekleyen öneri" value={counts.pending} icon={Sparkles} accent="violet" size="sm" />
        <MetricCard label="Sitede uygulandı" value={counts.applied} icon={CheckCircle2} accent="emerald" size="sm" />
      </div>

      {summary && (
        <p className="text-label text-muted-foreground">
          {capability === 'wordpress' && 'Yayın hedefi WordPress: onaylanan alt metinleri medya kütüphanesine ve gönderideki görsel etiketine yazılabilir. '}
          {capability === 'static' && 'Yayın hedefi dosya tabanlı (FTP/SFTP/cPanel): onaylanan alt metinleri sayfa HTML\'ine cerrahi olarak yazılabilir. '}
          {capability === 'snippet' && 'Bu yayın hedefi alt metni yazmayı desteklemiyor: onayladıklarını kopyala-yapıştır ile uygularsın. '}
          Bugün kalan öneri hakkı: {summary.suggestionsLeftToday}/{summary.dailyCap}. {summary.note}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <FilterChip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</FilterChip>
        ))}
      </div>

      {items === null ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : items.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Bu filtrede görsel yok. Görsel listesi her site taramasında güncellenir.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {items.map((img) => {
            const draft = drafts[img.id] ?? img.approvedAlt ?? img.suggestedAlt ?? '';
            const st = STATUS_LABEL[img.status] ?? { text: img.status, variant: 'outline' as const };
            const isBusy = !!busy[img.id];
            const decided = ['APPROVED', 'DECORATIVE', 'DISMISSED', 'APPLIED', 'VERIFIED', 'PARTIAL'].includes(img.status);
            return (
              <Card key={img.id}>
                <CardContent className="p-4 flex flex-col md:flex-row gap-4">
                  <a href={img.src} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.src} alt="" loading="lazy" referrerPolicy="no-referrer"
                      className="h-24 w-32 rounded-md border object-contain bg-muted" />
                  </a>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-label">
                      <Badge variant={st.variant}>{st.text}</Badge>
                      {img.altState === 'present' && <Badge variant="outline">mevcut: {img.currentAlt}</Badge>}
                      {img.linked && <Badge variant="outline">bağlantılı görsel</Badge>}
                      <a href={img.firstPageUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-brand inline-flex items-center gap-1 truncate">
                        {pathOf(img.firstPageUrl)} <ExternalLink className="h-3 w-3" />
                      </a>
                      {img.pageCount > 1 && <span className="text-muted-foreground">· {img.pageCount} sayfada</span>}
                    </div>
                    <Textarea
                      value={draft}
                      maxLength={ALT_MAX}
                      rows={2}
                      disabled={isBusy || img.status === 'APPLYING'}
                      placeholder={img.status === 'DECORATIVE_SUGGESTED' ? 'Süs görseli — boş alt önerildi' : 'Görseli anlatan kısa, özgül bir açıklama'}
                      onChange={(e) => setDrafts((d) => ({ ...d, [img.id]: e.target.value }))}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-label text-muted-foreground tabular-nums">{draft.length}/{ALT_MAX}</span>
                      {img.suggestionNote && <span className="text-label text-muted-foreground">· {img.suggestionNote}</span>}
                      <div className="ml-auto flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => suggestOne(img.id)}>
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                          {img.suggestedAlt ? 'Yeniden öner' : 'Öner'}
                        </Button>
                        <Button size="sm" disabled={isBusy || !draft.trim()} onClick={() => decide(img.id, 'approve', draft)}>Onayla</Button>
                        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => decide(img.id, 'decorative')}>Süs görseli</Button>
                        {decided
                          ? <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => decide(img.id, 'reset')}>Sıfırla</Button>
                          : <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => decide(img.id, 'dismiss')}>Yoksay</Button>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
