'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Clapperboard, Download, ExternalLink, FileText, Loader2, Trash2 } from 'lucide-react';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import { siteHref } from '@/lib/site-routes';
import {
  ARTICLE_VIDEO_COPY, VIDEO_FORMAT_OPTIONS, VIDEO_STATUS_LABEL, VIDEO_STATUS_TONE, VIDEO_TEMPO_LABEL, VIDEO_TYPE_LABEL, activePromoVideo, activeVideoFor,
  canRequestVideo, formatVideoSize, hasActiveVideos, productUrlProblem, quotaLine, videoFileName, videoTempoOf, videoTypeOf,
  type ArticleVideo, type VideoFormat, type VideoQuota, type VideoTarget, type VideoType,
} from '@/lib/article-video';
import { SectionHeader } from '@/components/ui/section-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FilterChip } from '@/components/ui/filter-chip';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { LockedVideoPreview, VideoRequestDialog, articleDialogDescription, promoDialogDescription } from '@/components/article-video';
import { cn } from '@/lib/utils';

/**
 * Videolar — RanksUp Video ciktilari: makaleden, site tanitimi (anasayfa + marka profili) ve urun
 * tanitimi (sitenin kendi urun/hizmet sayfasi). "Yeni video" karti tur secer; marka diyalogu uc
 * turde ortak. Liste ve silme her planda acik (plani dusen kullanici eski videolarini indirebilir);
 * yeni video yalniz Profesyonel ve ustu. Sirada / hazirlanan video varken liste 5 sn'de bir tazelenir.
 */

const TYPES: VideoType[] = ['article', 'site', 'product'];

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
  const [type, setType] = useState<VideoType>('article');
  const [format, setFormat] = useState<VideoFormat>('vertical');
  const [pageUrl, setPageUrl] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const published = useMemo(
    () => (articles ?? []).filter((a: any) => canRequestVideo(a)).sort((a: any, b: any) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))),
    [articles],
  );
  const picked = published.find((a: any) => a.id === pick) ?? null;
  const urlProblem = type === 'product' ? productUrlProblem(pageUrl, site.url) : null;
  const siteHost = useMemo(() => {
    try {
      return new URL(site.url).hostname.replace(/^www\./, '');
    } catch {
      return 'siten.com';
    }
  }, [site.url]);

  // Diyaloga giden hedef; secim tamam degilse null (dugme kapali)
  const target: VideoTarget | null = type === 'article'
    ? (picked ? { type: 'article', articleId: picked.id } : null)
    : type === 'site'
      ? { type: 'site', format }
      : (pageUrl.trim() && !urlProblem ? { type: 'product', pageUrl: pageUrl.trim(), format } : null);
  const busySource = type === 'site'
    ? activePromoVideo(videos, 'site', format)
    : type === 'product' && pageUrl.trim()
      ? activePromoVideo(videos, 'product', format, pageUrl)
      : false;

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
        description={`${ARTICLE_VIDEO_COPY.product} — yayındaki makalenden, sitenin ana sayfasından ya da bir ürün/hizmet sayfandan; sitenin adı, logosu ve rengiyle kısa video (dikey Reels, Shorts, TikTok; site ve ürün tanıtımında yatay da).`}
      />

      {lockedNew ? (
        (videos ?? []).length === 0 ? <LockedVideoPreview seed={site.id} /> : null
      ) : (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="space-y-2">
              <span className="text-sm font-medium">Yeni video</span>
              <div role="group" aria-label="Video türü" className="flex flex-wrap gap-2">
                {TYPES.map((t) => (
                  <FilterChip key={t} selected={type === t} onClick={() => { setType(t); setFormat('vertical'); }}>
                    {VIDEO_TYPE_LABEL[t]}
                  </FilterChip>
                ))}
              </div>
            </div>

            {type === 'article' ? (
              <div className="space-y-1.5">
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
            ) : (
              <>
                {type === 'site' ? (
                  <p className="text-sm text-muted-foreground">
                    Sitenin ana sayfası ({siteHost}) ve marka profilinden işletmeni tanıtan video: ne yaptığın, üç hizmetin ve alan adın.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <label htmlFor="video-page-url" className="text-sm font-medium">Ürün ya da hizmet sayfası</label>
                    <Input
                      id="video-page-url"
                      inputMode="url"
                      autoComplete="off"
                      placeholder={`https://${siteHost}/urun/...`}
                      value={pageUrl}
                      maxLength={2000}
                      onChange={(e) => setPageUrl(e.target.value)}
                      aria-invalid={!!urlProblem}
                      aria-describedby="video-page-url-hint"
                      className={cn(urlProblem && 'border-danger')}
                    />
                    <p id="video-page-url-hint" className={cn('text-label', urlProblem ? 'text-danger' : 'text-muted-foreground')}>
                      {urlProblem ?? `Yalnız ${siteHost} alan adındaki sayfalar. Ad, özellikler ve görsel sayfadan okunur; fiyat yalnız sayfada açıkça yazıyorsa gösterilir.`}
                    </p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">Biçim</span>
                  <div role="group" aria-label="Biçim" className="flex flex-wrap gap-2">
                    {VIDEO_FORMAT_OPTIONS[type].map((o) => (
                      <FilterChip key={o.format} selected={format === o.format} onClick={() => setFormat(o.format)}>
                        {o.label}
                        <span className="text-muted-foreground">· {o.hint}</span>
                      </FilterChip>
                    ))}
                  </div>
                  <p className="text-label text-muted-foreground">Her video (her biçim ayrı) bir video hakkı kullanır. Tempoyu (hızlı, normal, yavaş) bir sonraki adımda seçersin.</p>
                </div>
              </>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-label text-muted-foreground">
                {busySource ? 'Bu kaynak için bu biçimde bir video zaten hazırlanıyor.' : quotaLine(quota) ?? ' '}
              </p>
              <Button onClick={() => setDialogOpen(true)} disabled={!target || busySource || feature !== true}>
                <Clapperboard className="mr-1.5 h-4 w-4" aria-hidden />
                {ARTICLE_VIDEO_COPY.action}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {target && (
        <VideoRequestDialog
          siteId={site.id}
          target={target}
          seed={site.id}
          description={target.type === 'article' ? articleDialogDescription(picked?.title || picked?.topic || 'Makale') : promoDialogDescription(target)}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onRequested={() => {
            setPick('');
            setPageUrl('');
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
            description="Yayındaki bir makaleyi, site tanıtımını ya da bir ürün sayfanı seç; sitenin markasıyla video genellikle 1-3 dakikada hazır olur."
          />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <li key={v.id}>
              <Card className="h-full">
                <CardContent className="space-y-3 p-4">
                  <div className={cn('flex w-full items-center justify-center overflow-hidden rounded-lg border bg-muted', v.format === 'horizontal' ? 'aspect-video' : 'aspect-[9/16] max-h-[26rem]')}>
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
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      <Badge variant="brand">{VIDEO_TYPE_LABEL[videoTypeOf(v)]}</Badge>
                      <Badge variant="outline" title="Tempo">{VIDEO_TEMPO_LABEL[videoTempoOf(v)]}</Badge>
                      <Badge variant={BADGE[VIDEO_STATUS_TONE[v.status]]}>{VIDEO_STATUS_LABEL[v.status]}</Badge>
                    </div>
                  </div>
                  <p className="text-label text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}
                    {v.durationSec ? ` · ${v.durationSec} sn` : ''}
                    {formatVideoSize(v.fileSize) ? ` · ${formatVideoSize(v.fileSize)}` : ''}
                    {v.format === 'horizontal' ? ' · yatay 16:9' : ''}
                    {v.copyStrategy === 'extractive' ? (videoTypeOf(v) === 'article' ? ' · makalenin kendi cümleleri' : ' · sitenin kendi cümleleri') : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {v.status === 'ready' && v.videoUrl && (
                      <Button asChild size="sm">
                        <a href={v.videoUrl} download={videoFileName(v.title, v.id)}>
                          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> İndir
                        </a>
                      </Button>
                    )}
                    {videoTypeOf(v) === 'product' && v.sourceUrl && (
                      <Button asChild size="sm" variant="outline">
                        <a href={v.sourceUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Sayfa
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
