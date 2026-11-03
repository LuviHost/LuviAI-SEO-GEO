/**
 * "AI'dan gelen trafik" — panel tarafı saf yardımcılar (test: ai-traffic.spec.mts).
 * Hesap sunucuda (api analytics/ai-traffic.ts); burada metin ve biçim.
 */

export type AiTrafficReason = 'not_connected' | 'auth_error' | 'permission' | 'api_disabled' | 'unavailable';

export interface AiTrafficMetrics {
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  revenue: number | null;
}

export interface AiTrafficGa {
  totals: AiTrafficMetrics & { engagementRate: number | null };
  byAssistant: Array<AiTrafficMetrics & { key: string; label: string; engagementRate: number | null }>;
  landingPages: Array<{ host: string; page: string; sessions: number; engagedSessions: number; keyEvents: number; byAssistant: Record<string, number> }>;
  daily: Array<{ date: string; total: number; byAssistant: Record<string, number> }>;
  siteSessions: number;
  aiShare: number | null;
  revenueAvailable: boolean;
  pagesTruncated: boolean;
  unclassifiedSessions: number;
  multiHost: boolean;
  thresholded: boolean;
  generatedAt: string;
}

export interface AiTrafficTracker {
  totalHits: number;
  byAssistant: Array<{ key: string; label: string; hits: number }>;
  daily: Array<{ date: string; total: number; byAssistant: Record<string, number> }>;
  topPages: Array<{ url: string; count: number }>;
}

export type AiTrafficPeriod = 28 | 90 | 'ay';

/** Doğrulanmış AI bot isteği / AI ziyareti (sunucu: aiBotRatio) */
export interface AiBotRatio {
  verified: number;
  unverified: number;
  unknown: number;
  referrals: number;
  referralSource: 'ga4' | 'tracker' | null;
  ratio: number | null;
}

export interface AiTrafficResponse {
  period: AiTrafficPeriod;
  days: number;
  dateRange: { startDate: string; endDate: string };
  ga: AiTrafficGa | null;
  reason?: AiTrafficReason;
  tracker: AiTrafficTracker;
  bots: AiBotRatio;
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
  api_disabled: {
    title: 'GA4 verisi şu an okunamıyor',
    body: 'Google Analytics Data API RanksUp tarafında kapalı görünüyor; senin ayarınla ilgili değil. Ekibimiz düzeltene kadar yalnız RanksUp izleme kodu verisi görünür.',
    cta: false,
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

export const THRESHOLD_NOTE =
  'GA4 bu raporda eşik uyguladı: Google sinyalleri açık mülklerde düşük sayılar kişi gizliliği için gizlenir, bu yüzden sayılar eksik olabilir.';

/** Panelde bağlantı olarak gösterilecek adres: yalnız http(s). Sunucu ayrıca yalnız sitenin kendi adreslerini döndürür. */
export function isHttpUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

/** Açılış sayfası etiketi: birden çok host varsa host + yol */
export function pageLabel(p: { host: string; page: string }, multiHost: boolean): string {
  return multiHost && p.host ? `${p.host}${p.page === '(not set)' ? ' (not set)' : p.page}` : p.page;
}

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

/** Dönem seçenekleri (sıra panelde görünen sıra) */
export const PERIOD_OPTIONS: ReadonlyArray<{ value: AiTrafficPeriod; label: string }> = [
  { value: 28, label: '28 gün' },
  { value: 90, label: '90 gün' },
  { value: 'ay', label: 'Bu ay' },
];

/** Oran: 340 → "340 : 1"; 10'dan küçükse bir ondalık ("2,5 : 1") */
export function ratioText(ratio: number | null | undefined): string {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) return '—';
  const n = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: ratio < 10 ? 1 : 0 }).format(ratio);
  return `${n} : 1`;
}

/**
 * Oran kartının altındaki notlar. Clarity aynı oranı bot adına (kullanıcı ajanı)
 * güvenerek hesaplıyor; taklit istekler oranı şişirir. Burada yalnız IP'si
 * doğrulanan istekler sayılır — dışarıda kalanlar açıkça yazılır.
 */
export function botRatioNotes(b: AiBotRatio): string[] {
  const out: string[] = [];
  const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);
  if (b.unverified > 0) out.push(`${nf(b.unverified)} istek AI botu adı taşıdığı hâlde IP adresi botun sağlayıcısına ait değildi (taklit olabilir); orana katılmadı.`);
  if (b.unknown > 0) out.push(`${nf(b.unknown)} istek IP bilgisi olmadan geldiği için doğrulanamadı (eski izleme kodu ya da log yükleme); orana katılmadı. İzleme kodunu güncellemek bunu çözer.`);
  if (b.referralSource === 'tracker') out.push('GA4 bağlı olmadığı için ziyaret sayısı RanksUp izleme kodundan.');
  return out;
}
