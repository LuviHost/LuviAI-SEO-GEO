/**
 * Teaser satis duvarindan /pricing'e giderken saklanan domain.
 *
 * NEDEN AYRI DOSYA: Next.js sayfa dosyalari yalnizca belirli isimleri
 * export edebilir (default, metadata, revalidate...). Sabiti page.tsx'ten
 * export etmek typegen'i kiriyordu.
 *
 * PayTR'in ok_url'i sabit oldugu icin query param tasinamiyor; hedef domain
 * localStorage ile /billing/success'e tasinip oradan /unlock'a donuluyor.
 */
export const UNLOCK_DOMAIN_KEY = 'ranksup-unlock-domain';
