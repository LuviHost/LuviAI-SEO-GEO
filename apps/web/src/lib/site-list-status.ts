/**
 * Panel "Sitelerim" listesindeki durum rozeti ve yoneticinin "Durdur" dugmesi.
 *
 * jobState yalniz YONETICI listesinde gelir (api sites.service list → jobs/site-job-cancel.ts
 * siteJobStates): running = kuyrukta bekleyen ya da calisan arka plan isi var,
 * canceled = sitenin en son taramasi (kurulum zinciri / site taramasi) durduruldu.
 * Musterinin listesinde alan yok: rozet eskisi gibi site durumundan gelir, dugme cikmaz.
 */

export type SiteBadgeTone = 'warning' | 'info' | 'success' | 'secondary' | 'danger';

export const SITE_CANCELED_LABEL = 'Vazgeçildi';

const STATUS_TONE: Record<string, SiteBadgeTone> = {
  ONBOARDING: 'warning',
  AUDIT_PENDING: 'info',
  AUDIT_COMPLETE: 'info',
  ACTIVE: 'success',
  PAUSED: 'secondary',
  ERROR: 'danger',
};

/** Kurulumu bitmemis durumlar: durdurulan tarama rozetin yerini alir */
const SETUP_STATUSES = new Set(['ONBOARDING', 'AUDIT_PENDING', 'AUDIT_COMPLETE']);

export interface SiteListRow {
  status?: string | null;
  jobState?: { running?: boolean; canceled?: boolean } | null;
}

/**
 * Rozet: kurulumdaki site durdurulduysa (ve yeniden baslatilmadiysa) "Vazgeçildi",
 * notr gri ton. Kurulumu bitmis (Aktif, Duraklatildi) sitede durdurulan bir tarama
 * site durumunu degistirmez; rozet durumu gostermeye devam eder.
 */
export function siteListBadge(site: SiteListRow, statusLabel: (status: string | null | undefined) => string): { label: string; tone: SiteBadgeTone } {
  const status = site.status ?? '';
  if (site.jobState?.canceled && !site.jobState.running && SETUP_STATUSES.has(status)) {
    return { label: SITE_CANCELED_LABEL, tone: 'secondary' };
  }
  return { label: statusLabel(site.status), tone: STATUS_TONE[status] ?? 'secondary' };
}

/** "Durdur" yalniz yoneticiye ve yalniz arka planda bekleyen / calisan is varken */
export function canStopSiteJobs(site: SiteListRow, isAdmin: boolean): boolean {
  return isAdmin && site.jobState?.running === true;
}
