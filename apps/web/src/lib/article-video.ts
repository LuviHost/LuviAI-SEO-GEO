/**
 * RanksUp Video (makaleden 15 sn dikey video) — panel kurallari, saf (article-video.spec.mts).
 *
 * Kapi ve hak SUNUCUDA: plan ozelligi `articleVideo` (api billing/plans.ts, Profesyonel ve ustu)
 * ve aylik hak (VIDEOS_PER_MONTH) /sites/:id/videos/quota ile hazir gelir. Panel kural bilmez;
 * yalniz "yayinda mi", durum metni ve renk dogrulamasi gibi sunum kararlarini verir.
 */

export type ArticleVideoStatus = 'queued' | 'rendering' | 'ready' | 'failed';

export interface ArticleVideo {
  id: string;
  articleId: string | null;
  title: string;
  status: ArticleVideoStatus;
  videoUrl: string | null;
  posterUrl: string | null;
  durationSec: number | null;
  fileSize: number | null;
  error: string | null;
  copyStrategy: 'llm' | 'extractive' | null;
  brand: { name: string; primary: string | null; hasLogo: boolean } | null;
  createdAt: string;
  completedAt: string | null;
}

export interface VideoQuota {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
}

export interface VideoBrandPreview {
  name: string;
  domain: string;
  primary: string | null;
  colorSource: string;
  /** Renk bulunamazsa sablonun kullandigi renk (sunucudan; panelde sabit renk yazilmaz) */
  fallbackPrimary: string;
  logoDataUri: string | null;
  notes: string[];
}

/** Urun adi ve kilitli onizleme metinleri — tek yer */
export const ARTICLE_VIDEO_COPY = {
  product: 'RanksUp Video',
  action: 'Video üret',
  lockedTitle: 'RanksUp Video Profesyonel planda',
  lockedBody: 'Yayındaki makalenden sitenin adı, logosu ve rengiyle 15 saniyelik dikey video (Reels, Shorts, TikTok biçimi) üretir. Metin yalnız makalenin kendi cümlelerinden ve sayılarından oluşur.',
  lockedNote: 'Aşağıdaki bulanık görsel yalnızca yer tutucudur; video üretilmedi.',
  notPublished: 'Video yalnız yayındaki makaleden üretilir.',
} as const;

export const VIDEO_STATUS_LABEL: Record<ArticleVideoStatus, string> = {
  queued: 'Sırada',
  rendering: 'Hazırlanıyor',
  ready: 'Hazır',
  failed: 'Üretilemedi',
};

export const VIDEO_STATUS_TONE: Record<ArticleVideoStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  queued: 'neutral',
  rendering: 'info',
  ready: 'success',
  failed: 'danger',
};

/** Video istenebilir mi (sunucu da ayni kurali uygular: yalniz PUBLISHED) */
export function canRequestVideo(article: { status?: unknown } | null | undefined): boolean {
  return article?.status === 'PUBLISHED';
}

/** Liste yoklamasi: sirada ya da hazirlanan video varsa panel birkac saniyede bir tazeler */
export function hasActiveVideos(videos: ReadonlyArray<Pick<ArticleVideo, 'status'>> | null | undefined): boolean {
  return (videos ?? []).some((v) => v.status === 'queued' || v.status === 'rendering');
}

/** Bu makale icin suren video var mi (ikinci istek sunucuda 409 doner; dugme once kilitlenir) */
export function activeVideoFor(videos: ReadonlyArray<Pick<ArticleVideo, 'status' | 'articleId'>> | null | undefined, articleId: string): boolean {
  return (videos ?? []).some((v) => v.articleId === articleId && (v.status === 'queued' || v.status === 'rendering'));
}

/** Renk secici degeri: yalniz #rrggbb (kucuk harf); 3 haneli kisa yazim acilir; degilse null */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

/**
 * Istek govdesi: kullanicinin duzeltmeleri. Renk sayfadakiyle ayniysa gonderilmez (sunucu yine
 * sitenin rengini kullanir); "sablon rengi" secildiyse null. Ad degismediyse gonderilmez.
 */
export function videoRequestBody(input: {
  articleId: string;
  brand: Pick<VideoBrandPreview, 'name' | 'primary'> | null;
  color: string | null;
  useTemplateColor: boolean;
  useLogo: boolean;
  name: string;
}): { articleId: string; primaryColor?: string | null; useLogo: boolean; brandName?: string } {
  const body: { articleId: string; primaryColor?: string | null; useLogo: boolean; brandName?: string } = { articleId: input.articleId, useLogo: input.useLogo };
  if (input.useTemplateColor) body.primaryColor = null;
  else {
    const c = normalizeHex(input.color);
    if (c && c !== (input.brand?.primary ?? null)) body.primaryColor = c;
  }
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (name && name !== (input.brand?.name ?? '')) body.brandName = name;
  return body;
}

/** "3 / 20 video kullanıldı · 17 kaldı" — sinirsiz (yonetici) ve kapali plan ayri metin */
export function quotaLine(q: VideoQuota | null | undefined): string | null {
  if (!q) return null;
  if (q.unlimited) return 'Yönetici hesabı: video hakkı sınırı uygulanmaz.';
  if (!q.allowed || q.limit <= 0) return null;
  return `Bu ay ${q.used} / ${q.limit} video kullanıldı · ${q.remaining} kaldı`;
}

/** Indirme dosya adi: makale basligindan ASCII slug + .mp4 */
export function videoFileName(title: string, id: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  const slug = title
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'ranksup-video'}-${id.slice(-6)}.mp4`;
}

/** "4,2 MB" */
export function formatVideoSize(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('tr-TR', { maximumFractionDigits: 1, minimumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}
