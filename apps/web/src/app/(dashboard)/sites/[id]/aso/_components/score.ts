import type { AuditResult, TrackedKeyword } from './types';

/**
 * TEK ASO skoru. Eskiden iki ayrı skor vardı: Optimize sekmesindeki "ASO
 * Sağlık Skoru" (mağaza denetimi: iyi / (iyi+uyarı+hata)) ve /health
 * sayfasındaki 4 boyutlu ağırlıklı skor. İkincisi dönüşüm verisi olmadan
 * hesaplanıyordu (her uygulamayı haksız yere düşürüyordu) ve anahtar kelime
 * sıralarını hiç almıyordu.
 *
 * Birleşik skor = eldeki boyutların ortalaması:
 *  - Mağaza sayfası  → denetim skoru (metin, görsel, yorum kuralları)
 *  - Puan ve yorumlar → sağlık skorunun ratings_reviews boyutu
 *  - Anahtar kelime sıraları → keyword_performance (izlenen kelimelerin
 *    GERÇEK sıralarıyla); hiç ölçüm yoksa skora katılmaz
 * Dönüşüm boyutu veri olmadığı için hesaba katılmaz.
 */

/**
 * Son 30 gündeki YORUM sayısı (çekilen yorumlardan; yalnız yıldız verenler
 * dahil değil). Bilinmiyorsa ya da yalnız alt sınırı biliniyorsa ("en az N":
 * son çekim eski ya da tavana dayandı) API bu alt bileşeni skora katmaz,
 * sıfır saymaz. Yorumlar yalnız istenince çekildiği için son çekim zamanı
 * kullanıcıya gösterilir (eski API yanıtında lastFetchAt/staleStores yok).
 */
export type RecentReviewSignal =
  | {
      status: 'known';
      count: number;
      lowerBound: boolean;
      windowDays: number;
      label: string;
      lastFetchAt?: string;
      staleStores?: Array<'IOS' | 'ANDROID'>;
    }
  | { status: 'unknown'; windowDays: number; reason: string; label: string };

/** Puan ve yorumlar satırının alt metni: API etiketi + son çekim zamanı */
export function recentReviewDetail(signal: RecentReviewSignal | undefined): string | undefined {
  if (!signal) return undefined;
  if (signal.status !== 'known' || !signal.lastFetchAt) return signal.label;
  const at = new Date(signal.lastFetchAt);
  if (Number.isNaN(at.getTime())) return signal.label;
  const when = at.toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${signal.label} · Son çekim: ${when}`;
}

export type HealthResult = {
  breakdown: Record<string, { score: number; weight: number; weighted_contribution: number; notes?: string[] }>;
  recommendations: Array<{ category: string; priority: 'high' | 'medium' | 'low'; action: string; details: string; expected_impact: string }>;
  /** Eski API yanıtında yok — opsiyonel */
  signals?: { recentReviews30d?: RecentReviewSignal };
};

export type ScorePart = { key: 'store' | 'ratings' | 'keywords'; label: string; score: number | null; note?: string; detail?: string };

export function keywordPerformance(keywords: TrackedKeyword[]) {
  const ranked = keywords.filter((k) => k.currentRank != null);
  return {
    top_10: ranked.filter((k) => k.currentRank! <= 10).length,
    top_50: ranked.filter((k) => k.currentRank! <= 50).length,
    top_100: ranked.filter((k) => k.currentRank! <= 100).length,
    improving_keywords: keywords.filter((k) => k.previousRank != null && k.currentRank != null && k.currentRank < k.previousRank).length,
  };
}

export function targetKeywords(keywords: TrackedKeyword[]): string[] {
  return Array.from(new Set(keywords.map((k) => k.keyword.trim()).filter(Boolean))).slice(0, 25);
}

export function mergeScore(audit: AuditResult | null, health: HealthResult | null, keywords: TrackedKeyword[]) {
  const measured = keywords.some((k) => k.lastCheckedAt);
  const parts: ScorePart[] = [
    { key: 'store', label: 'Mağaza sayfası', score: audit ? audit.score : null },
    {
      key: 'ratings',
      label: 'Puan ve yorumlar',
      score: health ? Math.round(health.breakdown.ratings_reviews?.score ?? 0) : null,
      detail: recentReviewDetail(health?.signals?.recentReviews30d),
    },
    {
      key: 'keywords',
      label: 'Anahtar kelime sıraları',
      score: health && measured ? Math.round(health.breakdown.keyword_performance?.score ?? 0) : null,
      note: measured ? undefined : keywords.length === 0 ? 'Kelime yok' : 'Henüz ölçülmedi',
    },
  ];
  const available = parts.filter((p) => p.score != null) as Array<ScorePart & { score: number }>;
  const score = available.length > 0 ? Math.round(available.reduce((a, p) => a + p.score, 0) / available.length) : null;
  return { score, parts };
}

export function scoreTone(score: number | null): { label: string; text: string; bar: string } {
  if (score == null) return { label: '—', text: 'text-muted-foreground', bar: 'bg-muted-foreground/30' };
  if (score >= 80) return { label: 'İyi', text: 'text-success', bar: 'bg-success' };
  if (score >= 60) return { label: 'Orta', text: 'text-warning', bar: 'bg-warning' };
  return { label: 'Zayıf', text: 'text-danger', bar: 'bg-danger' };
}
