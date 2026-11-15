/**
 * Dondurulmus rapor baglantisi ve rapor gecmisindeki "kim uretti" etiketi.
 *
 * NEDEN VAR (15.11.2026): aylik rapor e-postasi artik gonderiliyor (API
 * analytics/monthly-report.cron.ts). E-postadaki "Raporu aç" baglantisi
 * `/sites/<id>/report?rapor=<raporId>` tasir; sayfa o dondurulmus raporla acilmali, yoksa musteri
 * e-postadaki sayilari gecmis listesinde aramak zorunda kalir.
 */

/** Adresteki `?rapor=` degeri; yoksa ya da kimlik bicimine uymuyorsa null */
export function reportIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('rapor');
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/**
 * Arama farki (tiklama / gosterim) NEDEN yok — fark varsa null.
 *
 * API farki iki durumda null doner (reports.service): onceki donemde hic olcum yok, ya da veri
 * var ama o donem bastan sona olculmemis (olcum ortasinda baslamis; `oncekiDonemTam: false`).
 * Ikincisinde birkac gunluk toplam tam bir donemin yanina konup sahte buyume gosterirdi.
 * `oncekiDonemTam` alani olmayan eski dondurulmus raporlar eskisi gibi davranir.
 */
export function previousPeriodNote(
  search: { oncekiDonemVeriVar?: boolean; oncekiDonemTam?: boolean } | null | undefined,
): string | null {
  if (search?.oncekiDonemVeriVar === false) return 'önceki dönemde ölçüm yok';
  if (search?.oncekiDonemTam === false) return 'önceki dönem baştan sona ölçülmedi';
  return null;
}

/** Ayni adres, `rapor` parametresi olmadan (diger parametreler ve # korunur) */
export function urlWithoutReportParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('rapor');
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Donem sinirinin gun adi.
 *
 * Ozel donem ("1–31 Ekim", aylik otomatik rapor dahil) UTC GUNUYLE tanimlidir (API
 * analytics.controller donemParametresi, analytics/monthly-report.ts): bitis ani ayin son
 * gununun sonudur. Izleyenin saat diliminde yazilirsa Turkiye'de (UTC+3) bir gun ileri kayar ve
 * Ekim raporu "1 Eki – 1 Kas" diye gorunur. Hazir donemler (son 7 / 30 / 365 gun) "su an"dan
 * geriye sayilir; onlar izleyenin saatinde yazilir.
 */
export function periodDayLabel(
  iso: string,
  period: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Date(iso).toLocaleDateString('tr-TR', { ...options, ...(period === 'custom' ? { timeZone: 'UTC' } : {}) });
}

/**
 * Gecmis listesinde tarihin yanindaki etiket. Kullanicinin kendi calistirdigi raporda etiket
 * yok (null). Eskiden ham deger basiliyordu: otomatik raporun yaninda "cron" yaziyordu.
 */
export function reportTriggerLabel(trigger: string | null | undefined): string | null {
  if (!trigger || trigger === 'manual') return null;
  if (trigger === 'cron') return 'otomatik';
  if (trigger === 'api') return 'API';
  return trigger;
}
