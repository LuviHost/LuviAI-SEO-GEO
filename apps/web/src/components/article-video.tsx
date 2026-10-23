'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { toast } from 'sonner';
import { Clapperboard, ImageOff, Loader2, Lock, Palette } from 'lucide-react';
import { api } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import { siteHref } from '@/lib/site-routes';
import { placeholderParagraphs } from '@/lib/plan-lock';
import {
  ARTICLE_VIDEO_COPY, DEFAULT_VIDEO_STYLE, DEFAULT_VIDEO_TEMPO, VIDEO_STYLES, VIDEO_STYLE_HINT, VIDEO_STYLE_LABEL, VIDEO_TEMPOS, VIDEO_TEMPO_HINT, VIDEO_TEMPO_LABEL,
  canRequestVideo, nextRadioValue, normalizeHex, quotaLine, tempoDurationLabel, videoRequestBody, videoStylePreview,
  type ArticleVideo, type VideoBrandPreview, type VideoQuota, type VideoStyle, type VideoTarget, type VideoTempo,
} from '@/lib/article-video';
import { Button } from '@/components/ui/button';
import { FilterChip } from '@/components/ui/filter-chip';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PlanUpgradeButton } from '@/components/locked-article';
import { cn } from '@/lib/utils';

/*
 * RanksUp Video — "Video üret" dugmesi, marka diyalogu (makale, site ve urun tanitimi icin ortak)
 * ve kilitli onizleme.
 *
 * Plan kapisi sunucuda (@RequiresPlan('articleVideo') + site sahibinin hakki). Panel
 * entitlements'tan "kapali" ogrenirse (Deneme / Buyume) diyalog yalniz kilitli onizlemeyi
 * gosterir: marka indirmesi, model cagrisi ya da render ISTEGI ATILMAZ. Kurallar
 * lib/article-video.ts'te (saf, test edilir).
 */

/** Kilitli onizleme — bulanik 9:16 yer tutucu + yukseltme (locked-article.tsx kalibi) */
export function LockedVideoPreview({ seed, compact = false }: { seed: string; compact?: boolean }) {
  const lines = useMemo(() => placeholderParagraphs(seed, { paragraphs: 3, sentences: 1 }), [seed]);
  return (
    <div className={cn('relative overflow-hidden rounded-lg border bg-card', compact ? 'min-h-[22rem]' : 'min-h-[30rem]')}>
      <div aria-hidden className="pointer-events-none flex select-none justify-center p-6 blur-sm">
        <div className="flex aspect-[9/16] w-44 flex-col justify-between rounded-2xl border bg-muted p-4">
          <div className="h-2 w-2/3 rounded bg-brand/40" />
          <div className="space-y-2">
            {lines.map((l, i) => (
              <p key={i} className="text-label leading-snug text-muted-foreground">{l}</p>
            ))}
          </div>
          <div className="h-6 w-full rounded-full bg-brand/30" />
        </div>
      </div>
      <div className="absolute inset-0 grid place-items-center bg-background/60 p-4">
        <div className="w-full max-w-md space-y-3 rounded-lg border bg-card p-5 text-center shadow-sm">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-brand/10 text-brand">
            <Lock className="h-5 w-5" aria-hidden />
          </span>
          <h3 className="font-semibold">{ARTICLE_VIDEO_COPY.lockedTitle}</h3>
          <p className="text-sm text-muted-foreground">{ARTICLE_VIDEO_COPY.lockedBody}</p>
          <p className="text-label text-muted-foreground">{ARTICLE_VIDEO_COPY.lockedNote}</p>
          <PlanUpgradeButton size="default" />
        </div>
      </div>
    </div>
  );
}

/** Makale satirina / sayfasina konan dugme; diyalogu kendisi acar */
export function ArticleVideoButton({
  siteId,
  article,
  size = 'sm',
  variant = 'outline',
  label = ARTICLE_VIDEO_COPY.action,
  onRequested,
}: {
  siteId: string;
  article: { id: string; title?: string | null; topic?: string | null; status?: unknown };
  size?: 'sm' | 'default';
  variant?: 'default' | 'outline';
  label?: string;
  onRequested?: (video: ArticleVideo) => void;
}) {
  const [open, setOpen] = useState(false);
  const { can } = useEntitlements();
  const locked = can('articleVideo') === false;
  if (!canRequestVideo(article)) return null;
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)} title={locked ? ARTICLE_VIDEO_COPY.lockedTitle : `${ARTICLE_VIDEO_COPY.product} — dikey video`}>
        {locked ? <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden /> : <Clapperboard className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
        {label}
      </Button>
      <ArticleVideoDialog siteId={siteId} article={article} open={open} onOpenChange={setOpen} onRequested={onRequested} />
    </>
  );
}

export function ArticleVideoDialog({
  siteId,
  article,
  open,
  onOpenChange,
  onRequested,
}: {
  siteId: string;
  article: { id: string; title?: string | null; topic?: string | null; status?: unknown };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequested?: (video: ArticleVideo) => void;
}) {
  const title = article.title || article.topic || 'Makale';
  return (
    <VideoRequestDialog
      siteId={siteId}
      target={{ type: 'article', articleId: article.id }}
      seed={article.id}
      description={articleDialogDescription(title)}
      open={open}
      onOpenChange={onOpenChange}
      onRequested={onRequested}
    />
  );
}

/** Makale videosunun diyalog aciklamasi (sure tempoya bagli: diyalogdaki tempo secimi) */
export function articleDialogDescription(title: string): string {
  return `“${title}” makalesinden dikey video (1080×1920). Metin makalenin kendi başlık, cümle ve sayılarından oluşur; makalede olmayan bilgi eklenmez.`;
}

/** Tanitim videolarinin diyalog aciklamasi (tur + bicim; sure tempoya bagli) */
export function promoDialogDescription(target: Exclude<VideoTarget, { type: 'article' }>): string {
  const size = target.format === 'horizontal' ? 'yatay (1920×1080)' : 'dikey (1080×1920)';
  if (target.type === 'site') {
    return `Sitenin ana sayfasından ve marka profilinden ${size} tanıtım videosu. Metin sitenin kendi başlık ve cümlelerinden oluşur; sitede olmayan bilgi ya da sayı eklenmez.`;
  }
  return `Ürün/hizmet sayfasından ${size} tanıtım videosu. Ad, özellikler ve görsel sayfanın kendisinden alınır; fiyat yalnız sayfada açıkça yazıyor ve doğrulanabiliyorsa gösterilir.`;
}

/**
 * Tempo secimi (Hizli / Normal / Yavas) — her secenekte bu tur ve bicimin yaklasik suresi.
 * Sure tablosu lib/article-video.ts VIDEO_TEMPO_SECONDS (apps/video okunurluk denetimi dogrular).
 */
/**
 * Radyo grubu klavye davranisi: yalniz secili oge sekme sirasinda (roving tabindex), ok tuslari / Home /
 * End secimi degistirir ve odagi yeni ogeye tasir.
 */
function useRadioKeys<T extends string>(values: readonly T[], value: T, onChange: (v: T) => void, disabled: readonly T[] = []) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());
  return {
    ref: (v: T) => (el: HTMLButtonElement | null) => { refs.current.set(v, el); },
    tabIndex: (v: T) => (v === value || (disabled.includes(value) && v === values.find((x) => !disabled.includes(x))) ? 0 : -1),
    onKeyDown: (e: React.KeyboardEvent) => {
      const next = nextRadioValue(values, value, e.key, disabled);
      if (next === null) return;
      e.preventDefault();
      onChange(next);
      refs.current.get(next)?.focus();
    },
  };
}

function TempoPicker({ target, value, onChange }: { target: VideoTarget; value: VideoTempo; onChange: (t: VideoTempo) => void }) {
  const format = target.type === 'article' ? 'vertical' : target.format;
  const keys = useRadioKeys(VIDEO_TEMPOS, value, onChange);
  return (
    <div className="space-y-2">
      <span id="video-tempo-label" className="text-sm font-medium">Tempo</span>
      <div role="radiogroup" aria-labelledby="video-tempo-label" className="flex flex-wrap gap-2" onKeyDown={keys.onKeyDown}>
        {VIDEO_TEMPOS.map((t) => (
          <FilterChip key={t} ref={keys.ref(t)} tabIndex={keys.tabIndex(t)} role="radio" aria-checked={value === t} aria-pressed={undefined} selected={value === t} onClick={() => onChange(t)}>
            {VIDEO_TEMPO_LABEL[t]}
            <span className="text-muted-foreground">· {tempoDurationLabel(target.type, format, t)}</span>
          </FilterChip>
        ))}
      </div>
      <p className="text-label text-muted-foreground">
        {VIDEO_TEMPO_HINT[value]} Normal ve yavaşta süre metnin uzunluğuna göre belirlenir; her tempo bir video hakkı kullanır.
      </p>
    </div>
  );
}

/**
 * Video stili secimi — kart basina Turkce ad, tek satir aciklama ve statik onizleme
 * (public/video-styles/<stil>.jpg; ornek render'lardan, mavi ornek marka). Stil yalniz gorsel: metin,
 * sure ve muzik ayni; video musterinin kendi rengi ve logosuyla uretilir.
 */
export function StylePicker({ value, onChange, unavailable = [] }: { value: VideoStyle; onChange: (s: VideoStyle) => void; unavailable?: readonly VideoStyle[] }) {
  const keys = useRadioKeys(VIDEO_STYLES, value, onChange, unavailable);
  return (
    <div className="space-y-2">
      <span id="video-style-label" className="text-sm font-medium">Video stili</span>
      <div role="radiogroup" aria-labelledby="video-style-label" className="grid grid-cols-2 gap-2 sm:grid-cols-4" onKeyDown={keys.onKeyDown}>
        {VIDEO_STYLES.map((s) => {
          const selected = value === s;
          const off = unavailable.includes(s);
          return (
            <button
              key={s}
              ref={keys.ref(s)}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={off || undefined}
              disabled={off}
              tabIndex={keys.tabIndex(s)}
              onClick={() => onChange(s)}
              className={cn(
                'group flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
                off ? 'cursor-not-allowed opacity-50' : selected ? 'border-brand ring-2 ring-brand/30' : 'border-border hover:border-brand/40',
              )}
            >
              <Image src={videoStylePreview(s)} alt="" width={240} height={320} unoptimized className="aspect-[3/4] w-full bg-muted object-cover" />
              <span className="space-y-0.5 p-2">
                <span className={cn('block text-sm font-medium', selected && 'text-brand')}>{VIDEO_STYLE_LABEL[s]}</span>
                <span className="block text-label leading-snug text-muted-foreground">{off ? 'Bu stil şu an hazırlanıyor; başka bir stil seç.' : VIDEO_STYLE_HINT[s]}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-label text-muted-foreground">
        Stil yalnız görünümü değiştirir; metin, süre ve müzik aynı kalır. Video sitenin kendi rengi ve logosuyla üretilir; önizlemeler örnek markayla.
      </p>
    </div>
  );
}

/**
 * Ortak marka diyalogu: ad, renk, logo onayi + istek. Haklar kesin acik degilse (Deneme / Buyume)
 * hicbir istek atilmaz; kilitli onizleme gosterilir.
 */
export function VideoRequestDialog({
  siteId,
  target,
  seed,
  description,
  open,
  onOpenChange,
  onRequested,
}: {
  siteId: string;
  target: VideoTarget;
  seed: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequested?: (video: ArticleVideo) => void;
}) {
  const { can } = useEntitlements();
  const feature = can('articleVideo');

  const [quota, setQuota] = useState<VideoQuota | null>(null);
  const [brand, setBrand] = useState<VideoBrandPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [useTemplateColor, setUseTemplateColor] = useState(false);
  const [useLogo, setUseLogo] = useState(true);
  const [tempo, setTempo] = useState<VideoTempo>(DEFAULT_VIDEO_TEMPO);
  const [style, setStyle] = useState<VideoStyle>(DEFAULT_VIDEO_STYLE);
  const [submitting, setSubmitting] = useState(false);

  // Haklar kesin "acik" degilse hicbir istek atilmaz (kilitli planda marka indirmesi yok)
  useEffect(() => {
    if (!open || feature !== true) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const q = await api.getVideoQuota(siteId);
        if (!alive) return;
        setQuota(q);
        if (!q.allowed) return;
        const b = await api.getVideoBrand(siteId);
        if (!alive) return;
        setBrand(b);
        setName(b.name);
        setColor(b.primary ?? b.fallbackPrimary);
        setUseTemplateColor(!b.primary);
        setUseLogo(!!b.logoDataUri);
      } catch (err: any) {
        if (alive) setLoadError(err?.message ?? 'Marka bilgisi okunamadı.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, feature, siteId]);

  const locked = feature === false || (quota !== null && !quota.allowed);
  const exhausted = !!quota && !quota.unlimited && quota.allowed && quota.remaining <= 0;
  const validColor = normalizeHex(color);
  const swatch = useTemplateColor ? brand?.fallbackPrimary : validColor ?? brand?.fallbackPrimary;

  const submit = async () => {
    setSubmitting(true);
    try {
      const body = videoRequestBody({ target, brand, color, useTemplateColor, useLogo: useLogo && !!brand?.logoDataUri, name, tempo, style });
      const r = await api.requestVideo(siteId, body);
      toast.success('Video sıraya alındı', {
        description: `Genellikle 1-3 dakikada hazır olur; Videolar sayfasında görünür. Bu ay ${r.remaining} video hakkın kaldı.`,
      });
      onRequested?.(r.video);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message ?? 'Video isteği gönderilemedi.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-brand" aria-hidden />
            {ARTICLE_VIDEO_COPY.product}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {locked ? (
          <DialogBody>
            <LockedVideoPreview seed={seed} compact />
          </DialogBody>
        ) : (
          <>
            <DialogBody className="space-y-5">
              {loading || feature === null ? (
                <div className="space-y-3" aria-busy="true">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <p className="text-label text-muted-foreground">Sitenin adı, logosu ve rengi okunuyor…</p>
                </div>
              ) : loadError ? (
                <p role="alert" className="text-sm text-danger">{loadError}</p>
              ) : (
                <>
                  <StylePicker value={style} onChange={setStyle} unavailable={quota?.unavailableStyles ?? []} />

                  <TempoPicker target={target} value={tempo} onChange={setTempo} />

                  <div className="space-y-1.5">
                    <label htmlFor="video-brand-name" className="text-sm font-medium">Marka adı</label>
                    <Input id="video-brand-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                    <p className="text-label text-muted-foreground">Videonun kapanışında logonun yanında görünür.</p>
                  </div>

                  <div className="space-y-2">
                    <span className="text-sm font-medium">Marka rengi</span>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="h-9 w-9 shrink-0 rounded-lg border" style={{ backgroundColor: swatch }} aria-hidden />
                      <input
                        type="color"
                        aria-label="Renk seç"
                        value={validColor ?? brand?.fallbackPrimary ?? ''}
                        disabled={useTemplateColor}
                        onChange={(e) => setColor(e.target.value)}
                        className="h-9 w-14 cursor-pointer rounded border bg-background disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <Input
                        aria-label="Renk kodu"
                        value={color}
                        disabled={useTemplateColor}
                        onChange={(e) => setColor(e.target.value)}
                        className={cn('w-32 font-mono', !useTemplateColor && !validColor && 'border-danger')}
                      />
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={useTemplateColor} onChange={(e) => setUseTemplateColor(e.target.checked)} />
                        RanksUp turuncusunu kullan
                      </label>
                    </div>
                    <p className="text-label text-muted-foreground">
                      <Palette className="mr-1 inline h-3 w-3" aria-hidden />
                      {brand?.primary ? 'Sitenden okunan renk; istersen değiştir.' : 'Sitende belirgin bir marka rengi bulunamadı.'} Yazı renkleri okunurluğa göre otomatik ayarlanır.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <span className="text-sm font-medium">Logo</span>
                    {brand?.logoDataUri ? (
                      <div className="flex flex-wrap items-center gap-4">
                        {/* data: URI (sunucuda en fazla 256 px PNG'ye cevrildi) */}
                        <img src={brand.logoDataUri} alt="Sitenin logosu" className={cn('h-16 w-16 rounded-lg border bg-white object-contain p-1', !useLogo && 'opacity-30')} />
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={useLogo} onChange={(e) => setUseLogo(e.target.checked)} />
                          Logoyu videoda kullan
                        </label>
                      </div>
                    ) : (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <ImageOff className="h-4 w-4" aria-hidden />
                        Sitende kullanılabilir bir logo bulunamadı; videoda marka adının baş harfi kullanılır.
                      </p>
                    )}
                  </div>

                  <p className="text-label text-muted-foreground">
                    Logo ve marka öğeleri yalnızca bu videoyu üretmek için kullanılır.
                    {target.type === 'product' ? ' Ürün görseli ve sayfa içeriği sitenin kendi sayfasından alınır; bunları kullanma hakkın olduğunu onaylarsın.' : ''}
                    {' '}Videoyu nerede yayınlayacağın senin kararın ve sorumluluğundadır (
                    <Link href="/terms" className="underline">Kullanım Şartları</Link>).
                  </p>
                </>
              )}
            </DialogBody>
            <DialogFooter className="justify-between">
              <span className={cn('text-label', exhausted ? 'text-danger' : 'text-muted-foreground')}>
                {exhausted ? `Bu ayki ${quota!.limit} video hakkını kullandın; hak yeni ayda yenilenir.` : quotaLine(quota)}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Vazgeç</Button>
                <Button
                  size="sm"
                  onClick={submit}
                  disabled={submitting || loading || !!loadError || exhausted || feature !== true || (!useTemplateColor && !validColor)}
                >
                  {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Clapperboard className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                  {ARTICLE_VIDEO_COPY.action}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
        {!locked && (
          <p className="px-5 pb-4 text-label text-muted-foreground">
            Üretilen videolar: <Link href={siteHref(siteId, 'videos')} className="underline">Videolar</Link>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
