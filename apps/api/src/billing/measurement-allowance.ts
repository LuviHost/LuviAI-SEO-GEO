import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Haftalik AI olcum hakki — saf kurallar + istek baglami.
 *
 * KURAL (Ekim 2026): bir hesap 7 gunde 1 AI olcumu yapabilir. "Olcum" =
 * kullanici tetikli, ucretli AI saglayicilarina soru soran her eylem: AI testi,
 * anlik goruntu, yol haritasi, sayfa bazli test, GEO isi haritasi, Prompt Lab
 * (tek soru / tumu), urun radari, firsat yeniden olcumu, ASO Prompt Lab, tam
 * rapor kilidi, MCP run_prompt ve site denetimi icindeki AI testi. Hepsi AYNI
 * haftalik hakki paylasir. Platformun kendi otomasyonu (trigger 'system') ve
 * ADMIN sayilmaz.
 *
 * Pencere kayan 7 gun: son sayilan olcumden 7 gun sonra yeni hak acilir.
 *
 * SITE BASINA (18.11.2026, sahip: "her site haftada 1, site basina ayda en fazla 4"): hak artik
 * SITEYE baglidir — 2 siteli hesap her siteyi haftada bir olcer; bir site takvim ayinda
 * (Istanbul) en fazla 4 kez olculur. Siteye bagli olmayan olcum (kayit sirasindaki alan adi
 * testi) eskisi gibi hesap anahtarindan duser.
 */
export const MEASUREMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Bir sitenin takvim ayindaki (Europe/Istanbul) en fazla olcum sayisi */
export const MONTHLY_MEASUREMENTS_PER_SITE = 4;

export const WEEKLY_MEASUREMENT_LIMIT_CODE = 'WEEKLY_MEASUREMENT_LIMIT';

export interface MeasurementAllowance {
  /** false = sinirsiz (ADMIN) */
  limited: boolean;
  allowed: boolean;
  lastMeasuredAt: string | null;
  nextAvailableAt: string | null;
  /** Site basina hakta: bu ay yapilan olcum ve aylik sinir (hesap anahtarinda yok) */
  monthlyUsed?: number;
  monthlyLimit?: number;
}

/** Istanbul saatiyle "2026-11" — aylik site sayacinin anahtari */
export function istanbulMonthKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return `${y}-${m}`;
}

/** Bir sonraki takvim ayinin basi, Istanbul 00:00 (Turkiye 2016'dan beri sabit UTC+3) */
export function nextIstanbulMonthStart(now: Date): Date {
  const [y, m] = istanbulMonthKey(now).split('-').map(Number);
  return new Date(Date.UTC(y, m, 1, 0, 0, 0) - 3 * 60 * 60 * 1000);
}

/**
 * Site basina hak: 7 gun penceresi + takvim ayinda en fazla MONTHLY_MEASUREMENTS_PER_SITE.
 * Ayin hakki dolduysa sonraki hak, pencere ile ay basindan GEC olanidir.
 */
export function computeSiteAllowance(lastIso: string | null | undefined, monthlyUsed: number, now: Date): MeasurementAllowance {
  const w = computeAllowance(lastIso, now);
  const used = Number.isFinite(monthlyUsed) && monthlyUsed > 0 ? Math.floor(monthlyUsed) : 0;
  const base = { ...w, monthlyUsed: used, monthlyLimit: MONTHLY_MEASUREMENTS_PER_SITE };
  if (used < MONTHLY_MEASUREMENTS_PER_SITE) return base;
  const ay = nextIstanbulMonthStart(now).getTime();
  const pencere = w.nextAvailableAt ? Date.parse(w.nextAvailableAt) : 0;
  return { ...base, allowed: false, nextAvailableAt: new Date(Math.max(ay, pencere)).toISOString() };
}

/** Son sayilan olcum zamanindan (ISO) hak durumunu hesaplar. */
export function computeAllowance(lastIso: string | null | undefined, now: Date): MeasurementAllowance {
  const last = lastIso ? Date.parse(lastIso) : NaN;
  if (!Number.isFinite(last)) {
    return { limited: true, allowed: true, lastMeasuredAt: null, nextAvailableAt: null };
  }
  const next = last + MEASUREMENT_WINDOW_MS;
  return {
    limited: true,
    allowed: now.getTime() >= next,
    lastMeasuredAt: new Date(last).toISOString(),
    nextAvailableAt: new Date(next).toISOString(),
  };
}

/** "23 Ekim 14:05" — hata mesajlari Istanbul saatiyle */
export function formatTrDateTime(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

// ────────────────────────────────────────────────────────────
//  ISTEK BAGLAMI
// ────────────────────────────────────────────────────────────
//
// NEDEN AsyncLocalStorage: tek bir istek AI servisini BIRDEN FAZLA kez
// cagirabiliyor (Prompt Lab = ana soru + fan-out dallari, urun radari = her
// kategori sorgusu ayri runQueries). Hak, cagri basina degil ISTEK basina
// dusmeli. Rota sarmalayicisi (MeasurementSessionInterceptor) baglami acar;
// AI servisleri baglam varsa hak zaten ayrilmis sayar, gercek olcum yaptiginda
// noteMeasured() ile isaretler. Baglam yoksa (worker'daki site denetimi gibi)
// servis hakki kendisi ayirir — yeni bir uc sarmalanmayi unutsa bile sinir
// delinmez.

export interface MeasurementSessionStore {
  /** ADMIN ya da hak zaten ayrilmis */
  exempt: boolean;
  /** Bu istekte en az bir gercek (HATA olmayan) olcum yapildi mi */
  measured: boolean;
}

export const measurementSession = new AsyncLocalStorage<MeasurementSessionStore>();

export function currentMeasurementSession(): MeasurementSessionStore | undefined {
  return measurementSession.getStore();
}

/** AI servisleri gercek bir olcum yaptiginda cagirir; baglam yoksa etkisiz. */
export function noteMeasured(): void {
  const store = measurementSession.getStore();
  if (store) store.measured = true;
}
