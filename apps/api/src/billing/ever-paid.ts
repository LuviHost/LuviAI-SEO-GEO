/**
 * "Bu hesap hic odeme yapti mi?" — TEK TANIM: en az bir PAID faturasi var mi.
 *
 * Deneme kilidi (trial-policy.ts trialAccess) yalniz GERCEK deneme hesabina uygulanir;
 * plani TRIAL'a dusmus eski musteri (iptal edip donemi biten ya da odemesi alinamayan)
 * bu yuklemle ayrilir. Tek sorgu, Invoice @@index([userId, createdAt]) onekini kullanir
 * (kullanicinin faturalari az; status suzgeci onlarin icinde). Yalniz pahali olmayan
 * yerde sorulur: kapi (trial-expiry.guard.ts) onu yalniz deneme suresi dolmus hesabin
 * degistirici isteginde cagirir.
 *
 * Iade edilen odeme de PAID kalir (fatura durumu degismez): odeyip iade alan hesap eski
 * musteri sayilir, guvenli taraf (kilit uygulanmaz).
 */
export interface EverPaidDb {
  invoice: { findFirst(args: { where: { userId: string; status: 'PAID' }; select: { id: true } }): Promise<{ id: string } | null> };
}

export async function hasEverPaid(db: EverPaidDb, userId: string): Promise<boolean> {
  const paid = await db.invoice.findFirst({ where: { userId, status: 'PAID' }, select: { id: true } });
  return paid !== null;
}
