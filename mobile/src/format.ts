/**
 * Sayı / tarih biçimleri — saf modül (format.spec.ts). Dil uygulamanin TR/EN
 * secimidir; tarih saat dilimi sunucu raporlariyla ayni (Europe/Istanbul).
 */
export type UiLang = 'tr' | 'en';

const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

/** 12400 → "12.400" (tr) / "12,400" (en) */
export function formatInt(n: number, lang: UiLang): string {
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(n);
  const s = Math.abs(r).toString().replace(THOUSANDS, lang === 'tr' ? '.' : ',');
  return r < 0 ? `-${s}` : s;
}

/** 4.567 → "4,6" (tr) / "4.6" (en) — tek ondalik */
export function formatDecimal(n: number, lang: UiLang, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  const s = n.toFixed(digits);
  return lang === 'tr' ? s.replace('.', ',') : s;
}

/** 0.1234 → "%12,3" (tr) / "12.3%" (en) */
export function formatPercent(ratio: number, lang: UiLang): string {
  if (!Number.isFinite(ratio)) return '—';
  const v = formatDecimal(ratio * 100, lang, 1);
  return lang === 'tr' ? `%${v}` : `${v}%`;
}

/** ISO tarih → "18 Eki 2026" / "18 Oct 2026"; gecersizse '' */
export function formatDate(iso: string | null | undefined, lang: UiLang): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Istanbul',
  });
}

/** ISO tarih → "18 Eki 14:05" / "18 Oct 14:05"; gecersizse '' */
export function formatDateTime(iso: string | null | undefined, lang: UiLang): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  });
}
