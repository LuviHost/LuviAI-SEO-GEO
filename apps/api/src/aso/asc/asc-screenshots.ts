/**
 * App Store ekran goruntusu kurallari (saf).
 *
 * Kabul edilen boyutlar IKI kaynaktan, birebir ayni:
 *  - Apple "Screenshot specifications" (ASC yardim): iPhone 6.9" grubu
 *    1260×2736 / 1290×2796 / 1320×2868; iPhone 6.5" 1242×2688 / 1284×2778;
 *    iPad 13" 2048×2732 / 2064×2752 — dikey ve yatay.
 *  - rorkai/App-Store-Connect-CLI `screenshotcatalog` (MIT): APP_IPHONE_67 (69
 *    takma adi buna kanoniklesir), APP_IPHONE_65, APP_IPAD_PRO_3GEN_129.
 * Ortak kurallar (Apple): set basina en fazla 10; .png/.jpg/.jpeg; alfa kanali
 * ve saydamlik YOK.
 */

export const MAX_PER_SET = 10;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export type DisplayType = 'APP_IPHONE_67' | 'APP_IPHONE_65' | 'APP_IPAD_PRO_3GEN_129';
type Size = readonly [number, number];

export const DISPLAY_TYPES: Record<DisplayType, { label: string; sizes: readonly Size[] }> = {
  APP_IPHONE_67: { label: 'iPhone 6.9"', sizes: [[1260, 2736], [1290, 2796], [1320, 2868]] },
  APP_IPHONE_65: { label: 'iPhone 6.5"', sizes: [[1242, 2688], [1284, 2778]] },
  APP_IPAD_PRO_3GEN_129: { label: 'iPad 13"', sizes: [[2048, 2732], [2064, 2752]] },
};
// `in` miras anahtarlari da kabul eder ("toString") → yalniz kendi anahtarlari
export const isDisplayType = (v: unknown): v is DisplayType => typeof v === 'string' && Object.prototype.hasOwnProperty.call(DISPLAY_TYPES, v);

const accepts = (t: DisplayType, w: number, h: number) =>
  DISPLAY_TYPES[t].sizes.some(([a, b]) => (w === a && h === b) || (w === b && h === a));

/** Bu boyut hangi gorunum turune uyar? (yanlis tur secildiyse oneri icin) */
export function displayTypeForSize(w: number, h: number): DisplayType | null {
  return (Object.keys(DISPLAY_TYPES) as DisplayType[]).find((t) => accepts(t, w, h)) ?? null;
}

export interface ImageFacts {
  format?: string;     // sharp metadata.format: png | jpeg | ...
  width?: number;
  height?: number;
  bytes: number;
}

/** Hata listesi (bos = yuklenebilir). Alfa burada hata DEGIL: sunucu duzlestirir. */
export function validateScreenshot(img: ImageFacts, displayType: DisplayType): string[] {
  const errors: string[] = [];
  if (img.format !== 'png' && img.format !== 'jpeg') errors.push(`Biçim ${img.format ?? 'bilinmiyor'} — yalnız PNG ya da JPEG`);
  if (img.bytes > MAX_FILE_BYTES) errors.push(`Dosya ${(img.bytes / 1048576).toFixed(1)} MB — en fazla 15 MB`);
  const w = img.width ?? 0;
  const h = img.height ?? 0;
  if (!accepts(displayType, w, h)) {
    const sizes = DISPLAY_TYPES[displayType].sizes.map(([a, b]) => `${a}×${b}`).join(', ');
    const other = displayTypeForSize(w, h);
    errors.push(
      `${w}×${h} ${DISPLAY_TYPES[displayType].label} için kabul edilmiyor (${sizes}, dikey ya da yatay)` +
        (other ? ` — bu boyut ${DISPLAY_TYPES[other].label} için uygun` : ''),
    );
  }
  return errors;
}

/** Apple imageAsset.templateUrl → kucuk resim adresi ({w}x{h}bb.{f}) */
export function thumbnailUrl(imageAsset: { templateUrl?: string; width?: number; height?: number } | null | undefined, width = 160): string | null {
  const t = imageAsset?.templateUrl;
  if (!t) return null;
  const ratio = imageAsset?.width && imageAsset?.height ? imageAsset.height / imageAsset.width : 2.17;
  return t.replace('{w}', String(width)).replace('{h}', String(Math.round(width * ratio))).replace('{f}', 'png');
}
