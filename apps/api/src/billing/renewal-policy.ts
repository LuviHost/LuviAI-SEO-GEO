/**
 * Abonelik yenileme karari — saf fonksiyon (I/O yok, test edilebilir).
 *
 * Kurallar (kullanici karari, 14.10.2026):
 *  - Karti kayitli + otomatik yenileme acik: donem sonunda kayitli karttan cekilir.
 *    Basarisizsa gunde 1 kez, toplam 3 deneme; ucuncusu da olmazsa plan duser.
 *  - Karti kayitli degil (eski abonelik ya da otomatik yenileme kapali): donem
 *    bitmeden 3 gun once "yenileme gerekli" e-postasi; donem sonu + 7 gun icinde
 *    odeme gelmezse plan duser.
 *  - Admin hesaplari ve faturasiz (elle atanmis / hediye) planlar dokunulmaz.
 */

export const RENEWAL_MAX_ATTEMPTS = 3;
/** Iki cekim denemesi arasi en az sure (gunluk cron saat kaymasina tolerans) */
export const RENEWAL_RETRY_GAP_MS = 20 * 3_600_000;
export const RENEWAL_NOTICE_LEAD_DAYS = 3;
export const RENEWAL_GRACE_DAYS = 7;

const DAY_MS = 86_400_000;

export type RenewalAction = 'none' | 'charge' | 'notice' | 'downgrade';

export interface RenewalInput {
  now: Date;
  plan: string;
  status: string;
  isAdmin: boolean;
  /** Son odenen fatura + dongu; fatura yoksa null */
  periodEnd: Date | null;
  /** PayTR tekrarlayan odeme ozelligi acik mi (PAYTR_RECURRING_ENABLED) */
  recurringEnabled: boolean;
  autoRenew: boolean;
  hasUtoken: boolean;
  failCount: number;
  lastAttemptAt: Date | null;
  noticeAt: Date | null;
}

export function decideRenewal(i: RenewalInput): RenewalAction {
  if (i.plan === 'TRIAL') return 'none';
  if (i.status !== 'ACTIVE' && i.status !== 'PAST_DUE') return 'none'; // CANCELED ayri cron'da
  if (i.isAdmin) return 'none';
  if (!i.periodEnd) return 'none'; // faturasiz (elle atanmis) plan — dokunma

  const now = i.now.getTime();
  const end = i.periodEnd.getTime();

  // Otomatik yol: kayitli kart + onay + ozellik acik
  if (i.recurringEnabled && i.autoRenew && i.hasUtoken) {
    if (now < end) return 'none';
    if (i.failCount >= RENEWAL_MAX_ATTEMPTS) return 'downgrade';
    if (i.lastAttemptAt && now - i.lastAttemptAt.getTime() < RENEWAL_RETRY_GAP_MS) return 'none';
    return 'charge';
  }

  // Elle yenileme yolu
  if (now < end - RENEWAL_NOTICE_LEAD_DAYS * DAY_MS) return 'none';
  if (!i.noticeAt) return 'notice';
  const graceStart = Math.max(end, i.noticeAt.getTime());
  if (now >= graceStart + RENEWAL_GRACE_DAYS * DAY_MS) return 'downgrade';
  return 'none';
}
