import { duzen, h, p, liste, bilgiKutusu, kacisla } from '../email/email-layout.js';

/**
 * Hesap silme e-postalari — talep ani ve silme tamamlandiginda.
 *
 * NEDEN IKISI DE VAR: Apple "provide a confirmation when the deletion is
 * complete" der (https://developer.apple.com/support/offering-account-deletion-in-your-app/).
 * Talep e-postasi ayrica hesabi ele gecirilmis birine erken uyari verir.
 * Metinler account-deletion.policy.ts politikasiyla birebir ayni olmali.
 */

const DESTEK = 'destek@luvihost.com';

/**
 * "Merhaba Ayse" ya da ad yoksa yalniz "Merhaba". Apple ile Giris adi yalniz
 * ilk yetkilendirmede ve kullanici paylasirsa verir; adi bos hesap cok.
 * Eskiden yedek kelime 'merhaba' idi ve sablon "Merhaba merhaba," yaziyordu.
 */
export function selamla(name?: string | null): string {
  const ad = name?.trim();
  return ad ? `Merhaba ${kacisla(ad)}` : 'Merhaba';
}

/**
 * Hangi hesabin silindigi: kisi birden cok hesap acmis olabilir (baska bir
 * Google hesabi, Apple'in "E-postami Gizle" adresi). E-posta zaten bu adrese
 * gittigi icin tam adres yazilir.
 */
function hesapSatiri(email?: string | null): string {
  const e = email?.trim();
  return e ? p(`Hesap: <strong>${kacisla(e)}</strong>`) : '';
}

export function deletionRequestedEmail(o: {
  name?: string | null;
  email?: string | null;
  purgeAfterText: string;
  /**
   * Bu talepte aktif abonelik gercekten iptal edildi mi. Deneme ya da bitmis
   * planda iptal edilecek abonelik yoktur; "Aboneligin iptal edildi" demek yanlis olurdu.
   */
  subscriptionCanceled?: boolean;
  baseUrl?: string;
}) {
  const subject = 'Hesap silme talebin alındı';
  const govde =
    h(subject) +
    p(`${selamla(o.name)}, RanksUp hesabını silme talebini aldık. Hesabına erişim kapatıldı.`) +
    hesapSatiri(o.email) +
    liste([
      // Panelin silme penceresiyle ayni ayrim (billing/delete-account-section.tsx)
      o.subscriptionCanceled
        ? 'Aboneliğin iptal edildi; kartından yeni ödeme alınmaz.'
        : 'Kartından ödeme alınmaz; otomatik yenileme kapatıldı.',
      'API anahtarların ve oturumların geçersiz kılındı; otomatik yayın, sosyal paylaşım ve reklam işlemleri durduruldu.',
      `Sitelerin, içeriklerin ve raporların dahil tüm verilerin <strong>${kacisla(o.purgeAfterText)}</strong> tarihinden sonra kalıcı olarak silinecek.`,
      'Fatura ve ödeme kayıtları, vergi ve ticaret mevzuatı gereği saklanması zorunlu olduğundan kişisel bağlantısı kaldırılarak saklanır.',
    ]) +
    bilgiKutusu('Bu talebi sen yapmadıysan', `Hemen <a href="mailto:${DESTEK}">${DESTEK}</a> adresine yaz.`);
  return { subject, html: duzen(subject, govde, { onizleme: `Verilerin ${o.purgeAfterText} tarihinden sonra kalıcı olarak silinecek.`, baseUrl: o.baseUrl }) };
}

export function deletionCompletedEmail(o: { name?: string | null; email?: string | null; baseUrl?: string }) {
  const subject = 'Hesabın silindi';
  const govde =
    h(subject) +
    p(`${selamla(o.name)}, RanksUp hesabın ve hesaba bağlı tüm veriler kalıcı olarak silindi.`) +
    hesapSatiri(o.email) +
    p('Fatura ve ödeme kayıtları yasal saklama yükümlülüğü nedeniyle, kişisel bağlantısı kaldırılarak saklanmaya devam eder.') +
    p('Yeniden kullanmak istersen istediğin zaman yeni bir hesap açabilirsin.');
  return { subject, html: duzen(subject, govde, { onizleme: 'Hesabın ve bağlı veriler kalıcı olarak silindi.', baseUrl: o.baseUrl }) };
}
