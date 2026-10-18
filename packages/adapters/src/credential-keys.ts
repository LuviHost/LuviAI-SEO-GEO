/**
 * Kimlik bilgisi / ayar alanini birden cok adla okur — ilk dolu dize kazanir.
 *
 * NEDEN: panel formu alan adlarini API katalogundan alir
 * (apps/api/src/publish-targets/publish-target-catalog.ts; eski ad → katalog
 * adi tablosu LEGACY_CREDENTIAL_KEYS), bazi adaptorler ise baska adlar okuyordu:
 *   Ghost    apiUrl                          ↔ siteUrl
 *   Strapi   baseUrl / token / collection    ↔ strapiUrl / apiToken / contentType
 *   WHMCS    baseUrl / apiIdentifier / apiSecret ↔ whmcsUrl / identifier / secret
 * Panelden eklenen bu hedefler adres ve anahtar bulamadigi icin hic
 * calismiyordu. Katalog adi ONCE okunur; eski adla (API ya da betikle)
 * kaydedilmis hedefler de calismaya devam eder.
 *
 * Bos ya da yalniz bosluk olan deger "yok" sayilir (form bos alan
 * gonderebilir); kopyala-yapistirdan kalan bas/son bosluk atilir.
 */
export function pickString(
  record: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const v = record?.[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** Adresin sonundaki egik cizgileri atar: yol eklenirken cift "/" olusmasin. */
export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
