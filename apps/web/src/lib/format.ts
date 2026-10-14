/**
 * tr-TR sayı / yüzde / sıra biçimleri — TEK kaynak.
 * Eskiden ekranlar arasında "12.34%", "%12" ve ham tamsayı karışıktı.
 */
const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const pct = (digits: number) => new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** 1234567 → "1.234.567" */
export function formatNum(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? nf0.format(n) : '—';
}

/** 0..1 oranı → "%12,3" (tr-TR yüzde işareti önde) */
export function formatPct(ratio: number | null | undefined, digits = 1): string {
  return typeof ratio === 'number' && Number.isFinite(ratio) ? pct(digits).format(ratio) : '—';
}

/** Ortalama sıra → "4,7" */
export function formatPos(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? nf1.format(n) : '—';
}

/** Saniye → "1 dk 05 sn" / "42 sn" */
export function formatDuration(sec: number | null | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)} dk ${String(s % 60).padStart(2, '0')} sn` : `${s} sn`;
}
