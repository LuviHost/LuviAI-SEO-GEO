/**
 * "AI'dan gelen trafik" — panel tarafı saf yardımcılar (test: ai-traffic.spec.mts).
 * Hesap sunucuda (api analytics/ai-traffic.ts); burada metin ve biçim.
 */

export type AiTrafficReason = 'not_connected' | 'auth_error' | 'permission' | 'unavailable';

export interface AiTrafficMetrics {
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  revenue: number | null;
}

export interface AiTrafficGa {
  totals: AiTrafficMetrics & { engagementRate: number | null };
  byAssistant: Array<AiTrafficMetrics & { key: string; label: string; engagementRate: number | null }>;
  landingPages: Array<{ page: string; sessions: number; engagedSessions: number; keyEvents: number; byAssistant: Record<string, number> }>;
  daily: Array<{ date: string; total: number; byAssistant: Record<string, number> }>;
  siteSessions: number;
  aiShare: number | null;
  revenueAvailable: boolean;
  pagesTruncated: boolean;
  unclassifiedSessions: number;
  generatedAt: string;
}

export interface AiTrafficTracker {
  totalHits: number;
  byAssistant: Array<{ key: string; label: string; hits: number }>;
  daily: Array<{ date: string; total: number; byAssistant: Record<string, number> }>;
  topPages: Array<{ url: string; count: number }>;
}

export interface AiTrafficResponse {
  days: number;
  dateRange: { startDate: string; endDate: string };
  ga: AiTrafficGa | null;
  reason?: AiTrafficReason;
  tracker: AiTrafficTracker;
  measurement: { assistants: Array<{ key: string; label: string }>; gaSourceDomains: string[] };
}

/** GA4 verisi yoksa kullanıcıya gösterilecek açıklama */
export const GA_REASON_TEXT: Readonly<Record<AiTrafficReason, { title: string; body: string; cta: boolean }>> = {
  not_connected: {
    title: 'GA4 bağlı değil',
    body: 'AI asistanlarından gelen oturumları, etkileşimi ve önemli etkinlikleri görmek için Google Analytics 4 mülkünü bağla. Aşağıdaki RanksUp izleme kodu verisi GA4 olmadan da çalışır.',
    cta: true,
  },
  auth_error: {
    title: 'GA4 bağlantısının yetkisi geçersiz',
    body: 'Bağlantıyı kesip yeniden bağla. O zamana kadar yalnız RanksUp izleme kodu verisi görünür.',
    cta: true,
  },
  permission: {
    title: 'Seçili GA4 mülkü okunamıyor',
    body: 'Bağlı Google hesabının bu mülkü okuma yetkisi yok. Bağlantılar sayfasından mülkü kontrol et.',
    cta: true,
  },
  unavailable: {
    title: 'GA4 şu an yanıt vermedi',
    body: 'Birazdan tekrar dene. RanksUp izleme kodu verisi aşağıda.',
    cta: false,
  },
};

/** Ölçüm notu — kartın altında; GA4 ve izleme kodu neden farklı sayar */
export const MEASUREMENT_NOTE = [
  'Bir ziyaret, tarayıcının gönderdiği yönlendiren adres (chatgpt.com, perplexity.ai gibi) ya da bağlantıdaki utm_source değeri (ChatGPT bağlantılara utm_source=chatgpt.com ekler) bir AI asistanını gösteriyorsa AI kaynaklı sayılır.',
  'Uygulamadan açılan ve iki sinyali de taşımayan ziyaretler “doğrudan” görünür ve sayılamaz.',
  'GA4, çerez onayı verilmeyen ziyaretleri eksik sayabilir; RanksUp izleme kodu oturum başına bir kez sayar. İki kaynak farklı şeyleri ölçtüğü için toplanmaz.',
] as const;

/** Çubuk genişliği (%): sıfır değilse en az 4 (görünür kalsın) */
export function barPct(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.max(4, Math.min(100, Math.round((value / max) * 100)));
}

/** AI payı: 0..1 → "%1,2"; çok küçük ama sıfır değilse "%0,1'den az" */
export function shareText(share: number | null | undefined): string {
  if (typeof share !== 'number' || !Number.isFinite(share)) return '—';
  if (share > 0 && share < 0.001) return '%0,1’den az';
  return new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 1 }).format(share);
}

/** "2026-10-23" → "23 Eki" (grafik ekseni) */
export function shortDay(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t)
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(t))
    : iso;
}

/** Seride en az bir sıfır olmayan gün var mı (boş grafik çizilmesin) */
export function hasSeries(daily: ReadonlyArray<{ total: number }> | null | undefined): boolean {
  return !!daily?.some((d) => d.total > 0);
}
