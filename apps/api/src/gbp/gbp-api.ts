/**
 * Google Business Profile API istemcisi (OAuth erisim anahtariyla). Yalniz GBP API erisimi onaylandiktan sonra
 * calisir (onaysiz projede kota 0 → 403/429). Kullanilan uclar (Ekim 2026 itibariyla aktif):
 *  - Account Management v1: hesaplar
 *  - Business Information v1: konumlar (readMask zorunlu)
 *  - My Business v4: yorumlar (list, updateReply) ve yerel gonderiler (localPosts list/create)
 *    https://developers.google.com/my-business/content/review-data · /posts-data
 *  - Business Profile Performance v1: gunluk metrikler (fetchMultiDailyMetricsTimeSeries)
 * Q&A API 03.11.2025'te kapatildi; KULLANILMAZ. Urun gonderisi API ile olusturulamaz.
 */
import { googleJson } from './google-istek.js';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface GbpHesap { name: string; accountName?: string; type?: string }
export interface GbpKonum {
  /** "locations/123" */
  name: string;
  title?: string;
  websiteUri?: string;
  storefrontAddress?: { locality?: string; administrativeArea?: string; addressLines?: string[] };
  metadata?: { placeId?: string; mapsUri?: string; newReviewUri?: string };
}

export interface GbpYorum {
  /** "accounts/1/locations/2/reviews/abc" */
  name: string;
  reviewId: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE' | 'STAR_RATING_UNSPECIFIED';
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

export interface GbpGonderi {
  name?: string;
  summary?: string;
  topicType?: string;
  state?: string;
  createTime?: string;
  searchUrl?: string;
  callToAction?: { actionType?: string; url?: string };
}

export const YILDIZ: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export async function hesaplar(token: string): Promise<GbpHesap[]> {
  const r = await googleJson<{ accounts?: GbpHesap[] }>({ method: 'GET', url: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20', headers: auth(token) });
  return r.accounts ?? [];
}

export async function konumlar(token: string, hesap: string): Promise<GbpKonum[]> {
  if (!/^accounts\/[\w-]+$/.test(hesap)) throw new Error('Geçersiz hesap');
  const readMask = 'name,title,websiteUri,storefrontAddress,metadata';
  const r = await googleJson<{ locations?: GbpKonum[] }>({
    method: 'GET',
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${hesap}/locations?pageSize=100&readMask=${encodeURIComponent(readMask)}`,
    headers: auth(token),
  });
  return r.locations ?? [];
}

/** v4 yolu: "accounts/{a}/locations/{l}" */
export function v4Konum(hesap: string, konum: string): string {
  const a = hesap.match(/^accounts\/([\w-]+)$/)?.[1];
  const l = konum.match(/^locations\/([\w-]+)$/)?.[1];
  if (!a || !l) throw new Error('Geçersiz hesap/konum');
  return `accounts/${a}/locations/${l}`;
}

export async function yorumlar(token: string, v4: string, sayfaToken?: string): Promise<{ yorumlar: GbpYorum[]; sonraki?: string; ortalama?: number; toplam?: number }> {
  const q = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc' });
  if (sayfaToken) q.set('pageToken', sayfaToken);
  const r = await googleJson<{ reviews?: GbpYorum[]; nextPageToken?: string; averageRating?: number; totalReviewCount?: number }>({
    method: 'GET', url: `https://mybusiness.googleapis.com/v4/${v4}/reviews?${q}`, headers: auth(token),
  });
  return { yorumlar: r.reviews ?? [], sonraki: r.nextPageToken, ortalama: r.averageRating, toplam: r.totalReviewCount };
}

export async function yorumYanitla(token: string, v4: string, reviewId: string, metin: string): Promise<void> {
  if (!/^[\w-]{4,200}$/.test(reviewId)) throw new Error('Geçersiz yorum');
  await googleJson({ method: 'PUT', url: `https://mybusiness.googleapis.com/v4/${v4}/reviews/${reviewId}/reply`, headers: auth(token), body: { comment: metin } });
}

export async function gonderiler(token: string, v4: string): Promise<GbpGonderi[]> {
  const r = await googleJson<{ localPosts?: GbpGonderi[] }>({ method: 'GET', url: `https://mybusiness.googleapis.com/v4/${v4}/localPosts?pageSize=20`, headers: auth(token) });
  return r.localPosts ?? [];
}

export async function gonderiOlustur(token: string, v4: string, g: { metin: string; url?: string | null }): Promise<GbpGonderi> {
  return googleJson<GbpGonderi>({
    method: 'POST',
    url: `https://mybusiness.googleapis.com/v4/${v4}/localPosts`,
    headers: auth(token),
    body: {
      languageCode: 'tr',
      summary: g.metin,
      topicType: 'STANDARD',
      ...(g.url ? { callToAction: { actionType: 'LEARN_MORE', url: g.url } } : {}),
    },
  });
}

export const PERFORMANS_METRIKLERI = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS',
] as const;

/** Son N gunun metrik toplamlari (Performance API gunluk seri) */
export async function performans(token: string, konum: string, gun = 28, simdi = new Date()): Promise<Record<string, number>> {
  if (!/^locations\/[\w-]+$/.test(konum)) throw new Error('Geçersiz konum');
  // Performance verisi birkac gun gecikmeli; bitis 3 gun once
  const bitis = new Date(simdi.getTime() - 3 * 86_400_000);
  const bas = new Date(bitis.getTime() - (gun - 1) * 86_400_000);
  const q = new URLSearchParams();
  for (const m of PERFORMANS_METRIKLERI) q.append('dailyMetrics', m);
  q.set('dailyRange.start_date.year', String(bas.getUTCFullYear()));
  q.set('dailyRange.start_date.month', String(bas.getUTCMonth() + 1));
  q.set('dailyRange.start_date.day', String(bas.getUTCDate()));
  q.set('dailyRange.end_date.year', String(bitis.getUTCFullYear()));
  q.set('dailyRange.end_date.month', String(bitis.getUTCMonth() + 1));
  q.set('dailyRange.end_date.day', String(bitis.getUTCDate()));
  const r = await googleJson<{ multiDailyMetricTimeSeries?: Array<{ dailyMetricTimeSeries?: Array<{ dailyMetric?: string; timeSeries?: { datedValues?: Array<{ value?: string }> } }> }> }>({
    method: 'GET',
    url: `https://businessprofileperformance.googleapis.com/v1/${konum}:fetchMultiDailyMetricsTimeSeries?${q}`,
    headers: auth(token),
  });
  const toplam: Record<string, number> = {};
  for (const grup of r.multiDailyMetricTimeSeries ?? []) {
    for (const s of grup.dailyMetricTimeSeries ?? []) {
      const ad = s.dailyMetric ?? '';
      toplam[ad] = (toplam[ad] ?? 0) + (s.timeSeries?.datedValues ?? []).reduce((a, v) => a + (Number(v.value) || 0), 0);
    }
  }
  return toplam;
}
