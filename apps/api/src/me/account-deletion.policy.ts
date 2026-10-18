/**
 * Hesap silme politikasi — saf fonksiyonlar (I/O yok, testli).
 *
 * POLITIKA (web, mobil, gizlilik metni ve e-postalar AYNI seyi soyler):
 *  - Talep aninda: erisim kapanir (giris + API), abonelik iptal edilir ve yeni
 *    odeme alinmaz, API anahtarlari iptal edilir, otomasyonlar durur, ucuncu
 *    taraf baglanti bilgileri (yayin hedefi, sosyal kanal, reklam/ASA/ASC
 *    anahtarlari) silinir.
 *  - Talepten 30 gun sonra: hesap ve bagli tum icerik kalici silinir.
 *  - Fatura ve odeme kayitlari kalir, kisiyle baglantisi kaldirilir
 *    (VUK md. 253: 5 yil, TTK md. 82: 10 yil saklama yukumlulugu).
 *  - Uygulama icinden geri alma YOK (metinler "geri alinamaz" der).
 *
 * 30 gun gizlilik politikasindaki taahhut (apps/web/.../privacy/page.tsx).
 * Apple: "Inform the person how long it will take to delete the account" —
 * https://developer.apple.com/support/offering-account-deletion-in-your-app/
 *
 * Bu politikayi soyleyen metinler (biri degisirse hepsi degismeli):
 * account-deletion.emails.ts, apps/web/.../billing/delete-account-section.tsx,
 * apps/web/.../privacy/page.tsx, apps/web/src/app/(auth)/signin/page.tsx
 * (AccountDeleted giris hatasi "30 gun" der), mobile/app/delete-account.tsx,
 * mobile/app/connect.tsx. Sabit gun sayisi yazan metinleri
 * account-deletion.policy.spec.ts denetler.
 */

export const ACCOUNT_PURGE_AFTER_DAYS = 30;

/** Istemci bu degeri acikca gondermeli — yanlislikla / sahte istekle silme olmasin */
export const DELETE_ACCOUNT_CONFIRMATION = 'DELETE_MY_ACCOUNT';

const DAY_MS = 86_400_000;

/** Bu andan sonra kalici silinir (gunluk is bu tarihi gectigi ilk calismada siler) */
export function purgeAfter(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + ACCOUNT_PURGE_AFTER_DAYS * DAY_MS);
}

/** deletionRequestedAt bu andan once/esitse silme zamani gelmistir */
export function purgeCutoff(now: Date): Date {
  return new Date(now.getTime() - ACCOUNT_PURGE_AFTER_DAYS * DAY_MS);
}

export function isPurgeDue(requestedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!requestedAt) return false;
  return requestedAt.getTime() <= purgeCutoff(now).getTime();
}

/** Yalniz odenmis/aktif abonelik iptal edilir; deneme ya da bitmis plan icin iptal anlamsiz */
export function shouldCancelSubscription(status: string | null | undefined): boolean {
  return status === 'ACTIVE' || status === 'PAST_DUE';
}

export type DeletionBlocker =
  | { code: 'agency_has_clients'; clientCount: number; message: string }
  | { code: 'admin_account'; message: string };

/**
 * Silmeyi engelleyen durumlar.
 *  - Ajans sahibinin bagli musteri hesaplari varsa once baglantilar kaldirilmali:
 *    musteri hesaplari ayri hesaplardir ve silinmez, ama ajansa bagliliklari
 *    (whitelabel, ajans paneli) sessizce kopmamali.
 *  - Yonetici hesabi uygulamadan silinemez: platformun yonetimi tek tikla
 *    kilitlenmesin.
 */
export function deletionBlockers(input: { role: string | null | undefined; clientCount: number }): DeletionBlocker[] {
  const out: DeletionBlocker[] = [];
  if (input.role === 'ADMIN') {
    out.push({
      code: 'admin_account',
      message: 'Yönetici hesapları uygulamadan silinemez; önce bu hesabın yönetici yetkisi kaldırılmalıdır.',
    });
  }
  if (input.clientCount > 0) {
    out.push({
      code: 'agency_has_clients',
      clientCount: input.clientCount,
      message: `Hesabınıza bağlı ${input.clientCount} müşteri hesabı var. Silmeden önce bu hesapların ajansınızla bağlantısını kaldırın; müşteri hesapları ve verileri silinmez.`,
    });
  }
  return out;
}

/**
 * Silme ekraninda "hangi hesap silinecek" gostergesi: "a***@gmail.com".
 *
 * NEDEN: kisi farkli bir Google hesabiyla ya da Apple'in "E-postami Gizle"
 * adresiyle girince sessizce YENI, bos bir hesap acilir; ekran hesabi
 * gostermezse gercek hesabi sildigini sanip bos hesabi silebilir. Alan adi
 * acik kalir (privaterelay.appleid.com gibi adres hangi girisin kullanildigini
 * soyler); yerel kisimdan yalniz ilk karakter.
 */
export function maskEmail(email: string | null | undefined): string | null {
  const e = String(email ?? '').trim();
  if (!e) return null;
  const at = e.lastIndexOf('@');
  if (at <= 0 || at === e.length - 1) return '***';
  return `${e.slice(0, 1)}***@${e.slice(at + 1)}`;
}

/** "17 Kasım 2026" — Istanbul saatine gore */
export function formatTrDate(d: Date): string {
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
}

/** Silme talebi olan hesapla giris denendiginde gosterilen mesaj */
export function deletedAccountMessage(requestedAt: Date): string {
  return `Bu hesap için silme talebi alındı ve erişim kapatıldı. Verileriniz ${formatTrDate(purgeAfter(requestedAt))} tarihinden sonra kalıcı olarak silinecek.`;
}

/** Talep zaten varsa ikinci istek ayni sonucu doner (cift tiklama, yeniden deneme) */
export function deletionSummary(requestedAt: Date) {
  return {
    deletionRequestedAt: requestedAt.toISOString(),
    purgeAfter: purgeAfter(requestedAt).toISOString(),
    purgeAfterDays: ACCOUNT_PURGE_AFTER_DAYS,
  };
}
