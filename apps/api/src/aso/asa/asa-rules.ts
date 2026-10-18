import type { AsaApiVersion, AsaMetrics } from './asa-types.js';

/**
 * ASA servisinin karar kurallari — saf fonksiyonlar (spec'lerde dogrudan test edilir).
 */

/** KvStore anahtarlari (sema degisikligi olmadan kucuk durum) */
export const asaKvKeys = {
  /** Platform API'de secilen reklam hesabi (adAccountId) */
  platformAdAccount: (accountId: string) => `asa:platform-ad-account:${accountId}`,
  /** Son basarili kampanya senkronunun API surumu */
  syncApiVersion: (accountId: string) => `asa:sync-api-version:${accountId}`,
  /** Yukleme sayisi duzeltmesinden sonra 85 gunluk geri doldurma yapildi mi */
  perfBackfill: (accountId: string) => `asa:perf-installs-backfill:${accountId}`,
};

/** Otopilot durdurma esigi: son 7 gunde en az bu kadar dokunma ve sifir yukleme. */
export const AUTO_PILOT_MIN_TAPS = 20;

/**
 * Bir anahtar kelime durdurulmali mi? KELIME duzeyindeki metrikle karar verilir.
 * Eski kod kampanya toplamina bakip kampanyadaki TUM kelimeleri durduruyordu;
 * v5 alan adi hatasi yuzunden yukleme hep 0 okundugundan 20+ dokunmali her
 * kampanyada calisan kelimeler de duruyordu.
 */
export function shouldPauseKeyword(stats: Pick<AsaMetrics, 'taps' | 'installs'> | undefined | null): boolean {
  if (!stats) return false; // veri yoksa karar yok
  return stats.taps >= AUTO_PILOT_MIN_TAPS && stats.installs === 0;
}

/** Yukleme duzeltmesinden sonra bir kez geriye donuk doldurulacak gun sayisi (Apple DAILY ust siniri 90). */
export const ASA_PERF_BACKFILL_DAYS = 85;

/**
 * API surumu degistikten sonraki ilk senkronda kampanya kimlikleri hic
 * eslesmiyorsa yetim silme TUM kampanyalari (ad group, kelime, performans
 * gecmisiyle birlikte) silerdi. v5 ve Platform kimliklerinin ayni oldugu
 * dokumanda yazmiyor; bu durumda senkron durdurulur.
 */
export function idSpaceMismatch(
  previousVersion: AsaApiVersion | null,
  currentVersion: AsaApiVersion,
  dbIds: string[],
  apiIds: string[],
): boolean {
  if (!previousVersion || previousVersion === currentVersion) return false;
  if (dbIds.length === 0 || apiIds.length === 0) return false;
  const api = new Set(apiIds);
  return !dbIds.some((id) => api.has(id));
}
