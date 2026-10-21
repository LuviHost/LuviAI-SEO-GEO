/**
 * Musteri marka renginden okunur palet. Girdi herhangi bir renk olabilir (sari, acik mavi,
 * koyu lacivert...); metin renkleri WCAG kontrast oranina gore OTOMATIK secilir:
 *   - accentText : acik zeminde marka renginde metin, >= 4.5:1 olana kadar koyulastirilir
 *   - onPrimary  : marka renkli zeminde metin, beyaz ya da koyu murekkep (hangisi daha okunursa)
 * Renk bulunamazsa / gecersizse RanksUp turuncusu (#f97316) kullanilir.
 */

export const FALLBACK_PRIMARY = '#f97316';

type RGB = [number, number, number];

export function parseHex(input: string | undefined | null): RGB | null {
  if (!input) return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

const toHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

export function mix(a: string, b: string, t: number): string {
  const A = parseHex(a)!;
  const B = parseHex(b)!;
  return toHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t) as RGB);
}

export function luminance(hex: string): number {
  const c = parseHex(hex)!.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** hex + alfa -> rgba() */
export function rgba(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex)!;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export type BrandPalette = {
  primary: string;
  /** primary'nin degrade ucu (onPrimary kontrastini bozmayacak yonde) */
  primaryDeep: string;
  onPrimary: string;
  bg: string;
  paper: string;
  ink: string;
  body: string;
  muted: string;
  accentText: string;
  /** acik zeminde dekoratif seritler (ilerleme cubugu, vurgu cizgisi) icin >= 2.2:1 */
  primaryUi: string;
  hair: string;
  usedFallback: boolean;
};

export function brandPalette(input?: string): BrandPalette {
  const usedFallback = !parseHex(input);
  const primary = usedFallback ? FALLBACK_PRIMARY : toHex(parseHex(input)!);
  // marka tonunda cok hafif renklenmis notr yuzeyler; murekkep markanin cok koyu tonu
  const bg = mix('#fbfaf8', primary, 0.035);
  const paper = '#ffffff';
  let ink = mix('#14110f', primary, 0.1);
  if (contrast(ink, bg) < 12) ink = '#14110f';
  const body = mix(ink, bg, 0.22);
  const muted = mix(ink, bg, 0.45);

  let accentText = primary;
  for (let i = 0; i < 14 && contrast(accentText, bg) < 4.5; i++) accentText = mix(accentText, '#000000', 0.1);

  let primaryUi = primary;
  for (let i = 0; i < 14 && contrast(primaryUi, bg) < 2.2; i++) primaryUi = mix(primaryUi, '#000000', 0.08);

  // 'buyuk metin' esigi 3:1 — beyaz yetiyorsa beyaz (marka hissi daha guclu), yoksa murekkep
  const whiteC = contrast('#ffffff', primary);
  const inkC = contrast(ink, primary);
  const onPrimary = whiteC >= 3 || whiteC >= inkC ? '#ffffff' : ink;
  const primaryDeep = onPrimary === '#ffffff' ? mix(primary, '#000000', 0.18) : mix(primary, '#ffffff', 0.22);

  return { primary, primaryDeep, onPrimary, bg, paper, ink, body, muted, accentText, primaryUi, hair: rgba(ink, 0.1), usedFallback };
}
