/**
 * Hesap kimliği yardımcıları — saf modül (account.spec.ts).
 *
 * NEDEN: Hesap silme akisi hangi hesabin silinecegini hic gostermiyordu. API
 * anahtariyla bagli kullanici "Google ya da Apple ile giris yap" talimatini
 * izleyip FARKLI bir hesapla (or. Apple "E-postami Gizle") girince sunucu yeni,
 * bos bir hesap aciyor; kullanici o bos hesabi silip gercek hesabinin (ve
 * aboneliginin) silindigini saniyordu. Silme ve baglanti ekranlari artik GET /me
 * e-postasini maskeli gosterir: adres taninir ama omuz uzerinden tam okunmaz.
 */

/** "emir@gmail.com" → "e***@gmail.com"; gecersiz/bos girdi → '' (ekran yedek metin gosterir) */
export function maskEmail(email: string | null | undefined): string {
  const e = (email ?? '').trim();
  const at = e.lastIndexOf('@');
  if (at <= 0 || at === e.length - 1) return '';
  const first = Array.from(e.slice(0, at))[0];
  return `${first}***@${e.slice(at + 1)}`;
}

/** Profil rozeti icin bas harfler: ad-soyad → "EB", tek ad → "E", ad yoksa e-postanin ilk harfi */
export function initialsFrom(name: string | null | undefined, email?: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const picks = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  const letters = picks.length > 0
    ? picks.map((w) => Array.from(w)[0])
    : [Array.from((email ?? '').trim())[0]].filter((c): c is string => !!c);
  // Uygulama Turkce oncelikli: "irem" → "İ" (tr-TR buyuk harf kurali)
  return letters.join('').toLocaleUpperCase('tr-TR');
}
