/**
 * Ortaklik panelinde davetlinin etiketi — KVKK veri minimizasyonu (6698 sk. md. 4/2'deki
 * "islendikleri amacla baglantili, sinirli ve olculu olma" ilkesi; kvkk.gov.tr Ingilizce
 * metni ve Anayasa Mahkemesi Kararlar Dergisi alintisi, 2026-10-19).
 *
 * NEDEN: getStats ortaga 1. ve 2. seviye davetlilerin tam adini ve e-posta adresini
 * donduruyordu (referredName / referredEmail). Panel yalniz kisaltilmis bir etiket
 * gosteriyordu ve 2. seviyeden komisyon yok; yani tam ad ve e-posta amacsiz olarak
 * ortagin tarayicisina gidiyordu. Artik API ortaga yalniz bu etiketi verir; panel
 * (apps/web/src/app/(dashboard)/affiliate/page.tsx refLabel) ayni kisaltmayi uygular,
 * kisaltma idempotent oldugu icin API'nin etiketi ikinci kez bozulmaz.
 *
 * Kural panelin eski kuraliyla AYNI: ad varsa ad, yoksa e-postanin @ oncesi; 14
 * karakterden uzunsa ilk 12 karakter + '…'. E-postanin alan adi hic gosterilmez.
 */

/** Bundan uzun etiket kisaltilir */
export const REFERRAL_LABEL_MAX = 14;
/** Kisaltilan etiketin korunan bas kismi */
export const REFERRAL_LABEL_KEEP = 12;

/** Panelin kisaltmasi: 14 karakterden uzunsa ilk 12 karakter + '…'. Idempotent. */
export function shortenReferralLabel(s: string): string {
  return s.length > REFERRAL_LABEL_MAX ? `${s.slice(0, REFERRAL_LABEL_KEEP)}…` : s;
}

/**
 * Davetlinin etiketi: ad varsa kisaltilmis ad; yoksa e-postanin @ oncesi kisaltilmis hali.
 * Ikisi de yoksa (ornegin hesap silinmis) null; panel "Davetli N" yazar.
 */
export function referralLabel(name: string | null | undefined, email: string | null | undefined): string | null {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed) return shortenReferralLabel(trimmed);
  if (typeof email === 'string' && email) {
    const at = email.indexOf('@');
    // @ ile baslayan (yerel kismi olmayan) degerde alan adi gosterilmez
    const local = (at >= 0 ? email.slice(0, at) : email).trim();
    return local ? shortenReferralLabel(local) : null;
  }
  return null;
}
