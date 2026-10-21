/**
 * RanksUp Video — durum yasam dongusu ve panel gorunumu (saf; test edilir).
 *
 * Video tablosu eski Video Factory'den kalma (VideoStatus enum'u degismedi, migration yok):
 *   PENDING    -> 'queued'     istek alindi, hak dusuldu, kuyrukta
 *   GENERATING -> 'rendering'  worker isi aldi (marka, metin, render)
 *   READY      -> 'ready'      mp4 + poster /videos/<siteId>/ altinda
 *   FAILED     -> 'failed'     hata; hak iade edildi (errorMsg kullaniciya gosterilir)
 * PUBLISHED bu ozellikte kullanilmaz (ready sayilir).
 */

export type ArticleVideoStatus = 'queued' | 'rendering' | 'ready' | 'failed';

export const DB_TO_VIEW_STATUS: Record<string, ArticleVideoStatus> = {
  PENDING: 'queued',
  GENERATING: 'rendering',
  READY: 'ready',
  PUBLISHED: 'ready',
  FAILED: 'failed',
};

/** Gecerli gecisler — her yazim kosullu UPDATE ile bu kurala uyar (cift iade / cift yazim yok) */
export const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING: ['GENERATING', 'FAILED'],
  // GENERATING -> GENERATING: worker yeniden baslayip takili isi tekrar aldi (stalled)
  GENERATING: ['GENERATING', 'READY', 'FAILED'],
  READY: [],
  FAILED: [],
};

export function canTransition(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export interface VideoRowLike {
  id: string;
  siteId: string;
  articleId: string | null;
  title: string;
  status: string;
  durationSec: number | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  fileSize: number | null;
  errorMsg: string | null;
  providerRaw?: unknown;
  createdAt: Date;
  startedAt?: Date | null;
  completedAt: Date | null;
}

export interface ArticleVideoView {
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

const rawOf = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

export function toVideoView(row: VideoRowLike): ArticleVideoView {
  const raw = rawOf(row.providerRaw);
  const status = DB_TO_VIEW_STATUS[row.status] ?? 'failed';
  const brand = raw.brand && typeof raw.brand === 'object'
    ? { name: String(raw.brand.name ?? ''), primary: typeof raw.brand.primary === 'string' ? raw.brand.primary : null, hasLogo: raw.brand.hasLogo === true }
    : null;
  return {
    id: row.id,
    articleId: row.articleId,
    title: row.title,
    status,
    // Hazir olmayan videonun adresi gosterilmez (dosya yok ya da yarim)
    videoUrl: status === 'ready' ? row.videoUrl : null,
    posterUrl: status === 'ready' ? row.thumbnailUrl : null,
    durationSec: row.durationSec,
    fileSize: row.fileSize,
    error: status === 'failed' ? row.errorMsg ?? 'Video üretilemedi.' : null,
    copyStrategy: raw.copy?.strategy === 'llm' || raw.copy?.strategy === 'extractive' ? raw.copy.strategy : null,
    brand,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}
