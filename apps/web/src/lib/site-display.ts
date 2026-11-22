/**
 * Sitenin panelde gosterilen adi (22.11.2026): ana sayfadan tespit edilen ya da yoneticinin
 * yazdigi marka adi (Site.brandDisplay), yoksa site adi. YALNIZ GOSTERIM — olcum eslesmesi
 * site adi ve diger adlarla yapilir (api sites/brand-detect.ts).
 */
export function siteDisplayName(site: { name?: string | null; brandDisplay?: string | null } | null | undefined): string {
  return (site?.brandDisplay ?? '').trim() || (site?.name ?? '');
}
