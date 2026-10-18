/**
 * ASO sekmesinin canlı veri yardımcıları — saf modül (aso-live.spec.ts).
 *
 * Eskiden ASO sekmesi bagli kullaniciya "Canli" rozeti altinda sabit bir skor
 * (78/71, "+5 bu hafta"), sabit anahtar kelime siralari, "247 KW" ve uydurma
 * Apple Search Ads rakamlari gosteriyordu. Artik yalniz API'den gelen takip
 * edilen uygulamalar, anahtar kelime siralari ve (bagliysa) ASA toplamlari cizilir.
 * Sira etiketleri web panelindeki anahtar kelime tablosuyla ayni kurali izler
 * (apps/web/src/app/(dashboard)/sites/[id]/aso/[appId]/keywords/page.tsx).
 */
import type { AsoAppDetail, AsoKeyword, AsoTrackedApp } from './api';

export type StoreTab = 'ios' | 'play';
export type ApiStore = 'IOS' | 'ANDROID';

export const API_STORE: Record<StoreTab, ApiStore> = { ios: 'IOS', play: 'ANDROID' };

/** Uygulamanin bu magaza surumu bagli mi */
export function hasStore(app: Pick<AsoTrackedApp, 'appStoreId' | 'playStoreId'>, store: StoreTab): boolean {
  return store === 'ios' ? !!app.appStoreId : !!app.playStoreId;
}

/**
 * Magaza puani ve sayaci (TrackedApp'in son cekimdeki degerleri). Iki magazada sayac
 * FARKLI seydir (apps/api/src/aso/aso-score-inputs.ts): App Store'da degerlendirme
 * (userRatingCount), Google Play'de yalniz yazili yorum sayisi. Etiket buna gore secilir.
 */
export function storeRating(
  app: AsoTrackedApp,
  store: StoreTab,
): { rating: number | null; count: number | null; countKind: 'ratings' | 'reviews' } {
  return store === 'ios'
    ? { rating: app.iosRating ?? null, count: app.iosReviewCount ?? null, countKind: 'ratings' }
    : { rating: app.androidRating ?? null, count: app.androidReviewCount ?? null, countKind: 'reviews' };
}

/**
 * Secili magazanin aktif anahtar kelimeleri: siralananlar once (kucuk sira = iyi),
 * sirasizlar sona. Sunucu currentRank'e gore artan siralar ama MySQL'de null'lar
 * en basa gelir — "sirada yok" satirlari listenin tepesine cikmasin diye yeniden siralanir.
 */
export function keywordsForStore(keywords: AsoKeyword[], store: StoreTab): AsoKeyword[] {
  const target = API_STORE[store];
  return keywords
    .filter((k) => k.store === target && k.isActive !== false)
    .sort((a, b) => {
      if (a.currentRank != null && b.currentRank != null) return a.currentRank - b.currentRank;
      if (a.currentRank != null) return -1;
      if (b.currentRank != null) return 1;
      return 0;
    });
}

/** Sira degisimi: pozitif = yukseldi (sira sayisi kuculdu); iki olcum yoksa null (web ile ayni) */
export function rankDelta(k: Pick<AsoKeyword, 'currentRank' | 'previousRank'>): number | null {
  if (k.currentRank == null || k.previousRank == null) return null;
  return k.previousRank - k.currentRank;
}

/** Sira hucresi: "#3" ya da "—" (sirasiz) */
export function rankLabel(k: Pick<AsoKeyword, 'currentRank'>): string {
  return k.currentRank != null ? `#${k.currentRank}` : '—';
}

/**
 * Sirasiz satirin anlami (erisilebilirlik etiketi): olculduyse ilk sonuclarda yok,
 * hic olculmediyse "henuz olculmedi". Magaza aramasi App Store'da ~100, Google
 * Play'de ~30 sonuc doner — web tablosundaki ipucuyla ayni.
 */
export function unrankedReason(k: Pick<AsoKeyword, 'currentRank' | 'lastCheckedAt' | 'store'>, lang: 'tr' | 'en'): string | null {
  if (k.currentRank != null) return null;
  if (!k.lastCheckedAt) return lang === 'tr' ? 'Henüz ölçülmedi' : 'Not measured yet';
  const n = k.store === 'IOS' ? '~100' : '~30';
  return lang === 'tr' ? `İlk ${n} sonuçta yok` : `Not in the first ${n} results`;
}

/** Anahtar kelimelerin en son olculdugu an (ISO) — hic olculmediyse null */
export function latestCheck(keywords: Pick<AsoKeyword, 'lastCheckedAt'>[]): string | null {
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const k of keywords) {
    if (!k.lastCheckedAt) continue;
    const t = new Date(k.lastCheckedAt).getTime();
    if (Number.isNaN(t)) continue;
    if (best == null || t > best) {
      best = t;
      bestIso = k.lastCheckedAt;
    }
  }
  return bestIso;
}

/** ASA gunluk satirlarindan en yeni veri gunu (ISO) — satir yoksa null */
export function latestDataDay(rows: { date: string }[]): string | null {
  return latestCheck(rows.map((r) => ({ lastCheckedAt: r.date })));
}

/** Liste degisince secimi koru; secili uygulama artik yoksa ilkini sec */
export function pickAppId(apps: Pick<AsoTrackedApp, 'id'>[], current: string | null): string | null {
  if (current && apps.some((a) => a.id === current)) return current;
  return apps[0]?.id ?? null;
}

/** Detay cevabinin secili uygulamaya ait oldugunu dogrular (yaris: hizli sekme degisimi) */
export function detailMatches(detail: AsoAppDetail | null, appId: string | null): detail is AsoAppDetail {
  return !!detail && !!appId && detail.id === appId;
}
