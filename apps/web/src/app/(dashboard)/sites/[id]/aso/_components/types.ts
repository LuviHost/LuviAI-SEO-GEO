/**
 * ASO çalışma alanının ortak tipleri. Eskiden tek 1.865 satırlık sayfanın
 * tepesindeydi; artık her rota (genel bakış, anahtar kelimeler, metadata,
 * yorumlar, görseller) aynı tanımı paylaşıyor.
 */

export type Store = 'IOS' | 'ANDROID';

export interface TrackedApp {
  id: string;
  name: string;
  appStoreId: string | null;
  playStoreId: string | null;
  country: string;
  iconUrl: string | null;
  developer: string | null;
  category: string | null;
  iosRating: number | null;
  iosReviewCount: number | null;
  androidRating: number | null;
  androidReviewCount: number | null;
  lastFetchedAt: string | null;
  createdAt: string;
  _count?: { keywords: number; reviews: number };
}

export interface TrackedKeyword {
  id: string;
  keyword: string;
  store: Store;
  popularity: number | null;
  /** Mağazanın otomatik tamamlaması bu terimi öneriyor mu — talepten AYRI sinyal */
  suggested?: boolean | null;
  difficulty: number | null;
  traffic: number | null;
  currentRank: number | null;
  previousRank: number | null;
  bestRank: number | null;
  source: string;
  lastCheckedAt: string | null;
}

export interface AppDetail extends TrackedApp {
  keywords: TrackedKeyword[];
}

export interface SearchResult {
  id: string;
  store: Store;
  name: string;
  developer?: string;
  icon?: string;
  rating?: number | null;
  reviewCount?: number | null;
  category?: string | null;
}

export type Severity = 'ok' | 'warning' | 'error' | 'info';

export interface AuditFinding {
  severity: Severity;
  store: Store | 'BOTH';
  field: string;
  label: string;
  current: string | number | null;
  message?: string;
  recommendation?: string;
}

export interface AuditResult {
  score: number;
  grade: string;
  summary: { ok: number; warning: number; error: number; info: number };
  findings: AuditFinding[];
  currentMetadata: {
    ios: {
      title?: string | null;
      subtitle?: string | null;
      description?: string | null;
      /** Mağazadaki "Yenilikler" (sürüm notları) — promosyon metni DEĞİL */
      releaseNotes?: string | null;
      screenshots?: string[];
      version?: string | null;
    } | null;
    android: {
      title?: string | null;
      summary?: string | null;
      description?: string | null;
      screenshots?: string[];
      headerImage?: string | null;
      video?: string | null;
    } | null;
  };
}

export interface AiKeywordSuggestion {
  keyword: string;
  source: string;
  relevance: number;
}

/** API'nin politika bekçisi: AI metninden çıkardığı ya da işaretlediği ifade (metadata-guard.ts) */
export interface GuardIssue {
  field: string;
  code: string;
  action: 'removed' | 'flagged';
  excerpt: string;
  message: string;
  source: string;
}

export interface OptimizeResult {
  title?: string;
  /** iOS: alt başlık · Android: kısa açıklama */
  subtitle?: string;
  keywordField?: string;
  description?: string;
  suggestions?: string[];
  issues?: GuardIssue[];
}

export interface AscApp {
  id: string;
  appleAppId: string;
  bundleId: string;
  name: string;
  latestVersion: string | null;
  latestReleaseAt: string | null;
}

export const STORE_LABEL: Record<Store, string> = { IOS: 'iOS', ANDROID: 'Android' };

/** Duygu → rozet tonu (durum renkleri yalnız token'dan) */
export const SENTIMENT_BADGE: Record<string, 'success' | 'danger' | 'secondary' | 'warning'> = {
  POSITIVE: 'success',
  NEGATIVE: 'danger',
  NEUTRAL: 'secondary',
  MIXED: 'warning',
};
