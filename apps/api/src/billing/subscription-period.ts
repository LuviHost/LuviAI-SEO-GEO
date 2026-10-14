/**
 * Abonelik donemi — son odenen faturadan turetilir.
 *
 * NEDEN: User tablosunda donem sonu alani yok ve PayTR akisi tek seferlik
 * odeme (otomatik yenileme yok). Iptal yalniz subscriptionStatus=CANCELED
 * yapiyordu; plan/kota kontrolleri ise yalniz `plan` alanina baktigi icin
 * iptal eden kullanici ucretli ozellikleri suresiz kullanmaya devam ediyordu.
 * Donem sonu, odenen son faturanin paidAt'ine dongu suresi eklenerek bulunur;
 * dongu fatura aciklamasinda yaziyor (paytr.service: `RanksUp X — monthly|annual (...)`).
 */

export type BillingCycle = 'monthly' | 'annual';

const DAY_MS = 86_400_000;
const CYCLE_DAYS: Record<BillingCycle, number> = { monthly: 30, annual: 365 };

/** Fatura aciklamasindan dongu; taninmazsa aylik (kisa olan — fazladan erisim verilmez). */
export function cycleFromDescription(description: string | null | undefined): BillingCycle {
  return /—\s*annual\b/i.test(description ?? '') ? 'annual' : 'monthly';
}

/** Odeme tarihinden donem sonu */
export function periodEndFrom(paidAt: Date, cycle: BillingCycle): Date {
  return new Date(paidAt.getTime() + CYCLE_DAYS[cycle] * DAY_MS);
}

/**
 * Son odenen faturadan donem sonu. Odenmis fatura yoksa null
 * (cagiran taraf "erisim hemen biter" olarak yorumlar).
 */
export function periodEndFromInvoice(
  invoice: { paidAt: Date | null; createdAt: Date; description: string | null } | null | undefined,
): Date | null {
  if (!invoice) return null;
  return periodEndFrom(invoice.paidAt ?? invoice.createdAt, cycleFromDescription(invoice.description));
}

/** Iptal edilmis abonelik su an dusurulmeli mi? */
export function shouldDowngrade(periodEnd: Date | null, now: Date = new Date()): boolean {
  return periodEnd === null || periodEnd.getTime() <= now.getTime();
}
