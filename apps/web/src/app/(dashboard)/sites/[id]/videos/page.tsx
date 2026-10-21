'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Clapperboard, Download, FileText, Loader2, Trash2 } from 'lucide-react';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import { siteHref } from '@/lib/site-routes';
import {
  ARTICLE_VIDEO_COPY, VIDEO_STATUS_LABEL, VIDEO_STATUS_TONE, activeVideoFor, canRequestVideo, formatVideoSize, hasActiveVideos,
  quotaLine, videoFileName, type ArticleVideo, type VideoQuota,
} from '@/lib/article-video';
import { SectionHeader } from '@/components/ui/section-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ArticleVideoDialog, LockedVideoPreview } from '@/components/article-video';

/**
 * Videolar — RanksUp Video ciktilari (sitenin yayindaki makalelerinden 15 sn dikey video).
 * Liste ve silme her planda acik (plani dusen kullanici eski videolarini indirebilir); yeni
 * video yalniz Profesyonel ve ustu. Sirada / hazirlanan video varken liste 5 sn'de bir tazelenir.
 */

const BADGE: Record<string, 'secondary' | 'info' | 'success' | 'destructive'> = {
  neutral: 'secondary',
  info: 'info',
  success: 'success',
  danger: 'destructive',
};

export default function VideosPage() {
  const { site, articles } = useSiteContext();
  const { can } = useEntitlements();
  const feature = can('articleVideo');
  const confirm = useConfirm();
  const [videos, setVideos] = useState<ArticleVideo[] | null>(null);
  const [quota, setQuota] = useState<VideoQuota | null>(null);
  const [pick, setPick] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const published = useMemo(
    () => (articles ?? []).filter((a: any) => canRequestVideo(a)).sort((a: any, b: any) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))),
    [articles],
  );
  const picked = published.find((a: any) => a.id === pick) ?? null;

  const load = useCallback(async () => {
    try {
      const [list, q] = await Promise.all([api.listVideos(site.id), api.getVideoQuota(site.id)]);
      setVideos(list);
      setQuota(q);
    } catch (err: any) {
      toast.error(err?.message ?? 'Videolar yüklenemedi.');
      setVideos((v) => v ?? []);
    }
  }, [site.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Sirada / hazirlanan video varken yokla; hepsi bitince durur
  useEffect(() => {
    if (!hasActiveVideos(videos)) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [videos, load]);

  const remove = async (v: ArticleVideo) => {
    const ok = await confirm({
      title: 'Video silinsin mi?',
      description: v.status === 'queued' ? 'Video henüz üretilmedi; silersen sıradan çıkar ve video hakkın iade edilir.' : 'Video dosyası ve kaydı kalıcı olarak silinir. Bu işlem geri alınamaz.',
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    setBusy(v.id);
    try {
      const r = await api.deleteVideo(site.id, v.id);
      toast.success(r.refunded ? 'Video silindi, hakkın iade edildi.' : 'Video silindi.');
      await load();
    } catch (err: any) {
      toast.error(err?.message ?? 'Video silinemedi.');
    } finally {
      setBusy(null);
    }
  };

  const lockedNew = feature === false || (quota !== null && !quota.allowed);

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Clapperboard}
        title="Videolar"
        description={`${ARTICLE_VIDEO_COPY.product} — yayındaki makalelerinden sitenin adı, logosu ve rengiyle 15 saniyelik dikey video (Reels, Shorts, TikTok).`}
      />

      {lockedNew ? (
        (videos ?? []).length === 0 ? <LockedVideoPreview seed={site.id} /> : null
      ) : (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <label htmlFor="video-article" className="text-sm font-medium">Yayındaki makale</label>
              <select
                id="video-article"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <option value="">{published.length ? 'Makale seç…' : 'Yayında makale yok'}</option>
                {published.map((a: any) => (
                  <option key={a.id} value={a.id} disabled={activeVideoFor(videos, a.id)}>
                    {(a.title || a.topic || a.slug || a.id).slice(0, 90)}{activeVideoFor(videos, a.id) ? ' — hazırlanıyor' : ''}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={() => setDialogOpen(true)} disabled={!picked || feature !== true}>
              <Clapperboard className="mr-1.5 h-4 w-4" aria-hidden />
              {ARTICLE_VIDEO_COPY.action}
            </Button>
            <p className="w-full text-label text-muted-foreground">{quotaLine(quota) ?? ' '}</p>
          </CardContent>
        </Card>
      )}

      {picked && (
        <ArticleVideoDialog
          siteId={site.id}
          article={picked}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onRequested={() => {
            setPick('');
            void load();
          }}
        />
      )}

      {videos === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-80 w-full" />)}
        </div>
      ) : videos.length === 0 ? (
        lockedNew ? null : (
          <EmptyState
            icon={Clapperboard}
            title="Henüz video yok"
            description="Yayındaki bir makaleyi seç; sitenin markasıyla 15 saniyelik dikey video genellikle 1-3 dakikada hazır olur."
          />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <li key={v.id}>
              <Card className="h-full">
                <CardContent className="space-y-3 p-4">
                  <div className="flex aspect-[9/16] max-h-[26rem] w-full items-center justify-center overflow-hidden rounded-lg border bg-muted">
                    {v.status === 'ready' && v.videoUrl ? (
                      <video
                        src={v.videoUrl}
                        poster={v.posterUrl ?? undefined}
                        controls
                        preload="none"
                        playsInline
                        className="h-full w-full object-contain"
                        aria-label={`${v.title} videosu`}
                      />
                    ) : v.status === 'failed' ? (
                      <p className="px-4 text-center text-sm text-danger">{v.error}</p>
                    ) : (
                      <span className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                        {v.status === 'queued' ? 'Sırada bekliyor…' : 'Video hazırlanıyor…'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-medium">{v.title}</p>
                    <Badge variant={BADGE[VIDEO_STATUS_TONE[v.status]]}>{VIDEO_STATUS_LABEL[v.status]}</Badge>
                  </div>
                  <p className="text-label text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}
                    {v.durationSec ? ` · ${v.durationSec} sn` : ''}
                    {formatVideoSize(v.fileSize) ? ` · ${formatVideoSize(v.fileSize)}` : ''}
                    {v.copyStrategy === 'extractive' ? ' · makalenin kendi cümleleri' : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {v.status === 'ready' && v.videoUrl && (
                      <Button asChild size="sm">
                        <a href={v.videoUrl} download={videoFileName(v.title, v.id)}>
                          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> İndir
                        </a>
                      </Button>
                    )}
                    {v.articleId && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`${siteHref(site.id, 'articles')}/${v.articleId}`}>
                          <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Makale
                        </Link>
                      </Button>
                    )}
                    {v.status !== 'rendering' && (
                      <Button size="sm" variant="outline" onClick={() => void remove(v)} disabled={busy === v.id} aria-label="Videoyu sil">
                        {busy === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
