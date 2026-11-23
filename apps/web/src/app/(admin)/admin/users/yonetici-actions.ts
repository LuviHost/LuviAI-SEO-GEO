'use server';

import { auth, prisma } from '@/auth';
import { isAdminUnlocked } from '@/lib/admin-unlock';
import { kurucuListesi, kurucuMu, yetkiIslemiKontrol, type YetkiIslemi } from '@/lib/admin-yetki';

/**
 * Panelden yonetici ekleme / cikarma — YALNIZ KURUCU (bkz. lib/admin-yetki.ts).
 *
 * NEDEN sunucu eylemi (API ucu degil): kurucu listesi (ADMIN_EMAILS) web sunucusunun
 * ortaminda; OTP kapisi da burada. API tarafi yalniz rolu (ADMIN) okur; rol ve yetki
 * damgasi ayni yazimda degisir, oturum bir sonraki istekte DB'den tazelenir (auth.ts jwt).
 */

async function yapan() {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.email || u.role !== 'ADMIN') return null;
  // Admin kilidi (OTP / PIN) acilmamis oturum yetki degistiremez
  if (!(await isAdminUnlocked(u.id))) return null;
  return u;
}

/** Bu sayfayi goren kisi kurucu mu + listedeki hangi hesaplar kurucu (dugmeleri gostermek icin) */
export async function yoneticiBilgisi(emails: string[]): Promise<{ benKurucu: boolean; kurucular: string[] }> {
  const u = await yapan();
  const liste = kurucuListesi();
  if (!u) return { benKurucu: false, kurucular: [] };
  return {
    benKurucu: kurucuMu(u.email, liste),
    kurucular: emails.filter((e) => kurucuMu(e, liste)),
  };
}

export async function yoneticiYetkisi(
  userId: string,
  islem: YetkiIslemi,
): Promise<{ ok: true; role: string; adminYetkiAt: string | null } | { ok: false; neden: string }> {
  const u = await yapan();
  if (!u) return { ok: false, neden: 'Oturum ya da admin kilidi geçersiz; sayfayı yenileyip tekrar dene' };
  const liste = kurucuListesi();
  const hedef = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { id: true, email: true, role: true, adminYetkiAt: true, deletionRequestedAt: true },
  });
  const k = yetkiIslemiKontrol(islem, u, hedef, liste);
  if (!k.ok) return k;

  const veri = islem === 'ver'
    ? { role: 'ADMIN' as const, adminYetkiAt: new Date(), adminYetkiVeren: u.email!.toLowerCase() }
    : { role: 'USER' as const, adminYetkiAt: null, adminYetkiVeren: null };
  // Yaris korumasi: kontrol ile yazim arasinda rol degistiyse hicbir sey yazilmaz
  const r = await prisma.user.updateMany({
    where: { id: hedef!.id, role: hedef!.role, ...(islem === 'ver' ? { deletionRequestedAt: null } : {}) },
    data: veri,
  });
  if (r.count === 0) return { ok: false, neden: 'Hesap bu arada değişti; sayfayı yenileyip tekrar dene' };
  console.warn(`[yonetici] ${islem === 'ver' ? 'yetki verildi' : 'yetki alindi'}: ${hedef!.email} (yapan ${u.email})`);
  return { ok: true, role: veri.role, adminYetkiAt: veri.adminYetkiAt ? veri.adminYetkiAt.toISOString() : null };
}
