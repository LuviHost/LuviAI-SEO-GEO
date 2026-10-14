/**
 * Ham enum değerlerinin Türkçe karşılıkları — arayüze READY_TO_PUBLISH,
 * critical, AUDIT_COMPLETE gibi değerler sızmasın.
 */
export const ARTICLE_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Taslak',
  SCHEDULED: 'Planlandı',
  GENERATING: 'Yazılıyor',
  EDITING: 'Düzenleniyor',
  REVIZE_NEEDED: 'Revize gerekli',
  READY_TO_PUBLISH: 'Yayına hazır',
  PUBLISHED: 'Yayında',
  FAILED: 'Başarısız',
  ARCHIVED: 'Arşivde',
};

export const SITE_STATUS_LABEL: Record<string, string> = {
  ONBOARDING: 'Kurulum',
  AUDIT_PENDING: 'Tarama bekliyor',
  AUDIT_COMPLETE: 'Tarandı',
  ACTIVE: 'Aktif',
  PAUSED: 'Duraklatıldı',
  ERROR: 'Hata',
};

export const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Kritik',
  error: 'Hata',
  warning: 'Uyarı',
  info: 'Bilgi',
};

export const SENTIMENT_LABEL: Record<string, string> = {
  POSITIVE: 'Olumlu',
  NEGATIVE: 'Olumsuz',
  NEUTRAL: 'Nötr',
  MIXED: 'Karışık',
};

/** Haritada yoksa ham değeri "Baş harfi büyük" gösterir — boş kalmaz */
export function label(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '—';
  return map[value] ?? map[value.toUpperCase()] ?? map[value.toLowerCase()] ?? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}
