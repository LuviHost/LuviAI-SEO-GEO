/**
 * PANELDEN YONETICI EKLEME — saf kurallar (23.11.2026).
 *
 * NEDEN: yonetici eklemek icin hem veritabaninda rol (ADMIN) hem sunucu ortam degiskeninde
 * ADMIN_EMAILS listesi elle degistiriliyordu. Sahip karari: panelden eklensin, ama yalniz
 * KURUCU (ADMIN_EMAILS'teki hesap) yonetici ekleyip cikarabilsin.
 *
 * KURAL:
 *  - Kurucu = e-postasi ADMIN_EMAILS (ya da ADMIN_EMAIL) listesinde olan hesap. Panelden
 *    yoneticilikten cikarilamaz.
 *  - Panel yoneticisi = rolu ADMIN ve adminYetkiAt dolu (kurucunun verdigi) hesap.
 *  - Admin girisi (OTP) ikisinden birine acilir. Rolu ADMIN olup ikisi de olmayan eski
 *    hesaplar eskisi gibi giremez (kapi gevsemez).
 *  - Yalniz rolu USER olan, silme talebi olmayan hesap yonetici yapilabilir (ajans sahibinin
 *    rolu ezilmesin; geri alinca USER'a donulur).
 */

export type Rol = 'USER' | 'ADMIN' | 'AGENCY_OWNER';

/** ADMIN_EMAILS ya da ADMIN_EMAIL ortam degiskeninden kurucu e-postalari (kucuk harf) */
export function kurucuListesi(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ADMIN_EMAILS ?? env.ADMIN_EMAIL ?? '')
    .split(',')
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
}

export function kurucuMu(email: string | null | undefined, liste: readonly string[]): boolean {
  const e = (email ?? '').toLowerCase().trim();
  return !!e && liste.includes(e);
}

/** Admin girisine (OTP) izin var mi: kurucu ya da panelden yetki verilmis ADMIN */
export function adminGirisIzni(
  u: { email?: string | null; role?: string | null; adminYetkili?: boolean | null },
  liste: readonly string[],
): boolean {
  if (u.role !== 'ADMIN') return false;
  return kurucuMu(u.email, liste) || u.adminYetkili === true;
}

export type YetkiIslemi = 'ver' | 'al';

export interface Hedef {
  email: string;
  role: Rol;
  adminYetkiAt: Date | string | null;
  deletionRequestedAt: Date | string | null;
}

/** Islem yapilabilir mi; yapilamazsa ekranda gosterilecek Turkce neden */
export function yetkiIslemiKontrol(
  islem: YetkiIslemi,
  yapan: { email?: string | null; role?: string | null },
  hedef: Hedef | null,
  liste: readonly string[],
): { ok: true } | { ok: false; neden: string } {
  if (yapan.role !== 'ADMIN' || !kurucuMu(yapan.email, liste)) {
    return { ok: false, neden: 'Yönetici ekleyip çıkarmayı yalnız kurucu hesabı yapabilir' };
  }
  if (!hedef) return { ok: false, neden: 'Kullanıcı bulunamadı' };
  if (kurucuMu(hedef.email, liste)) return { ok: false, neden: 'Kurucu hesabı panelden değiştirilemez' };
  if (islem === 'ver') {
    if (hedef.deletionRequestedAt) return { ok: false, neden: 'Bu hesap silme talebinde; yönetici yapılamaz' };
    if (hedef.role === 'ADMIN') return { ok: false, neden: 'Bu hesap zaten yönetici' };
    if (hedef.role !== 'USER') return { ok: false, neden: 'Yalnız normal kullanıcı hesabı yönetici yapılabilir (ajans hesabı değil)' };
    return { ok: true };
  }
  if (hedef.role !== 'ADMIN' || !hedef.adminYetkiAt) {
    return { ok: false, neden: 'Bu hesabın yöneticiliği panelden verilmemiş; buradan kaldırılamaz' };
  }
  return { ok: true };
}
