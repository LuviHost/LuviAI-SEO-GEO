/**
 * Panel sohbeti (Asistan) kimlere acik — TEK YER.
 *
 * 18.11.2026 sahip karari: "asistan sayfasini gizleyelim". Menude ve komut paletinde yok; sayfa
 * yalniz yoneticiye acilir (web sites/[id]/chat), mesaj ucu da musteriye kapali: adres elle
 * yazilsa ya da eski bir sekmeden gonderilse bile model cagrisi (mesaj basina ~$0.05-0.25)
 * olusmaz. Platformun haftalik plan isi (weekly-plan.cron) bu kapiya bagli degildir.
 * Yeniden acmak: ASSISTANT_OPEN_TO_CUSTOMERS = true + web lib/site-nav'a menu ogesi.
 */
export const ASSISTANT_OPEN_TO_CUSTOMERS = false;

export const ASSISTANT_CLOSED_MESSAGE = 'Asistan şu an kullanıma kapalı.';

export function assistantOpenFor(role: string | null | undefined): boolean {
  return ASSISTANT_OPEN_TO_CUSTOMERS || role === 'ADMIN';
}
