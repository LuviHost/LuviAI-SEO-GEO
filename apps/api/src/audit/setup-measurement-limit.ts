import { findPlan } from '../billing/plans.js';

/**
 * OTOMATIK KURULUM OLCUMU SINIRI — saf kural (sahip karari 11.11.2026).
 *
 * Site eklenince kurulum zinciri (worker ONBOARDING_CHAIN) kullanici istemeden bir AI
 * gorunurluk olcumu alir ("sistem" olcumu: aylik calistirma tavanina ve haftalik olcum
 * hakkina sayilmaz). Profesyonel'de tek olcum 5 soru x 3 tekrar x 7 asistandir; siteyi
 * silip yeniden ekleyen hesap bunu sinirsiz tekrarlatabiliyordu ("zarar etmeyelim":
 * hicbir hesap odediginden pahaliya gelmesin). Kurallar:
 *
 *  1. Hesap basina, kayan 30 gunde en fazla N otomatik kurulum olcumu; N = planin site
 *     siniri (plans.ts BASE_PLANS[...].sites — sayi burada KOPYALANMAZ).
 *  2. Ayni alan adi icin hesap basina kayan 30 gunde en fazla 1 (sil + yeniden ekle
 *     yeniden olcturmez). Alan adi = adresin host'u, kucuk harf, bastaki "www." atilir.
 *  3. ADMIN muaf (plan sinirlarindaki genel kural).
 *
 * Sinir dolunca kurulum olcumsuz surer; musteri ilk olcumu haftalik olcum hakkiyla
 * kendisi baslatir (o yol degismedi ve sayilir). Depo ve akis: setup-measurement.ts.
 */

/** Kayan pencere (gun) — musteri metinleri bu sayiyi yazar (public-docs.spec denetler) */
export const SETUP_MEASUREMENT_WINDOW_DAYS = 30;
export const SETUP_MEASUREMENT_WINDOW_MS = SETUP_MEASUREMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Denetimin AI bolumundeki atlama kodu (checks.aiCitations.skipped.code) */
export const SETUP_MEASUREMENT_LIMIT_CODE = 'SETUP_MEASUREMENT_LIMIT';

/** Bir otomatik kurulum olcumu: hangi alan adi icin, ne zaman (ISO) */
export interface SetupMeasurementRecord {
  host: string;
  at: string;
}

export type SetupMeasurementBlock =
  /** Bu alan adi son 30 gunde bu hesapta otomatik olculdu */
  | 'domain'
  /** Hesap son 30 gunde planinin site siniri kadar otomatik kurulum olcumu aldi */
  | 'account';

export type SetupMeasurementDecision =
  | { allowed: true; exempt: boolean }
  | { allowed: false; reason: SetupMeasurementBlock; limit: number; used: number };

/**
 * Planin 30 gunluk otomatik kurulum olcumu siniri = planin site siniri (plans.ts).
 * Bilinmeyen plan en dar sinira (deneme) duser: tanimsiz bir plan adi siniri acmasin.
 */
export function setupMeasurementLimit(plan: string | null | undefined): number {
  const p = findPlan(String(plan ?? '').toLowerCase()) ?? findPlan('trial');
  return p?.sites ?? 1;
}

/**
 * Site adresinden alan adi: host, kucuk harf, sondaki nokta ve bastaki "www." olmadan.
 * "https://www.Ornek.com/blog" ve "ornek.com" ayni alan adidir (yeniden eklerken
 * www / yol / protokol degistirmek siniri asmasin). Ayristirilamayan deger kirpilmis
 * haliyle doner (bos ise bos): ayni bozuk deger yine kendisiyle eslesir.
 */
export function setupHost(url: string | null | undefined): string {
  const raw = String(url ?? '').trim().toLowerCase();
  if (!raw) return '';
  let host = raw;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    host = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0];
  }
  return host.replace(/\.+$/, '').replace(/^www\./, '');
}

/** Depodaki deger (JSON dizi) → kayitlar. Bozuk ya da bos deger: bos liste (sinir kaydi yok sayilir). */
export function parseSetupRecords(value: string | null | undefined): SetupMeasurementRecord[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is SetupMeasurementRecord =>
        !!r && typeof r === 'object' && typeof (r as SetupMeasurementRecord).host === 'string'
        && typeof (r as SetupMeasurementRecord).at === 'string' && Number.isFinite(Date.parse((r as SetupMeasurementRecord).at)))
      .map((r) => ({ host: r.host, at: r.at }));
  } catch {
    return [];
  }
}

/** Pencerenin icindeki kayitlar (30 gunden eskiler dusurulur; her yazimda uygulanir) */
export function pruneSetupRecords(records: SetupMeasurementRecord[], now: Date): SetupMeasurementRecord[] {
  const cutoff = now.getTime() - SETUP_MEASUREMENT_WINDOW_MS;
  return records.filter((r) => Date.parse(r.at) > cutoff);
}

/**
 * Saf karar: bu hesap `host` icin SIMDI otomatik kurulum olcumu alabilir mi.
 * Once alan adi kurali (nedeni daha belirli), sonra hesap tavani.
 */
export function decideSetupMeasurement(
  now: Date,
  records: SetupMeasurementRecord[],
  plan: string | null | undefined,
  role: string | null | undefined,
  host: string,
): SetupMeasurementDecision {
  if (role === 'ADMIN') return { allowed: true, exempt: true };
  const active = pruneSetupRecords(records, now);
  const limit = setupMeasurementLimit(plan);
  if (host && active.some((r) => r.host === host)) return { allowed: false, reason: 'domain', limit, used: active.length };
  if (active.length >= limit) return { allowed: false, reason: 'account', limit, used: active.length };
  return { allowed: true, exempt: false };
}

/**
 * Musteriye gosterilen neden (denetimin AI bolumu; panel "Ölçülmedi: …" diye yazar).
 * Ne oldugunu ve ne yapabilecegini soyler: olcum kendisi baslatilabilir (haftalik hak).
 */
export function setupLimitMessage(reason: SetupMeasurementBlock, limit: number): string {
  return reason === 'domain'
    ? `Bu alan adının otomatik kurulum ölçümü son ${SETUP_MEASUREMENT_WINDOW_DAYS} gün içinde yapıldı; yeni ölçümü haftalık ölçüm hakkınla başlatabilirsin.`
    : `Otomatik kurulum ölçümü sınırı doldu (${SETUP_MEASUREMENT_WINDOW_DAYS} günde en fazla ${limit} site); ilk ölçümü haftalık ölçüm hakkınla başlatabilirsin.`;
}
