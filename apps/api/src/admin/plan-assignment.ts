/**
 * Yoneticinin elle plan atamasi (18.11.2026) — saf kurallar.
 *
 * NEDEN: havale / EFT ile odeyen musterinin ve is ortagi markalarinin plani panelden
 * baslatilamiyordu (paytr.service "plani sahip baslatir" diyor ama bir yol yoktu); is ortagi
 * plani (PARTNER) hic satilmadigi icin yalniz bu yoldan atanir.
 *
 * Kurallar:
 *  - TRIAL atamak plani KAPATIR: deneme suresi yeniden baslamaz, durum EXPIRED (salt okunur
 *    hesap, yenileme cron'unun dusurmesiyle ayni son durum).
 *  - Ucretli plan: durum ACTIVE, yenileme sayaclari sifirlanir.
 *  - PARTNER: otomatik yenileme kapatilir. Odeme elle; kayitli bir kart varsa bile PayTR'den
 *    cekim yapilmamali (yenileme ve iptal cron'lari zaten PARTNER'e dokunmaz).
 *  - Fatura OLUSTURULMAZ: faturasiz plan yenileme cron'unda "elle atanmis" sayilir ve dusmez
 *    (renewal-policy.ts). Plani bitirmek yine bu yoldan, TRIAL atayarak yapilir.
 */
export const ASSIGNABLE_PLANS = ['TRIAL', 'STARTER', 'PRO', 'PARTNER', 'AGENCY', 'ENTERPRISE'] as const;
export type AssignablePlan = (typeof ASSIGNABLE_PLANS)[number];

export function isAssignablePlan(v: unknown): v is AssignablePlan {
  return typeof v === 'string' && (ASSIGNABLE_PLANS as readonly string[]).includes(v);
}

export interface PlanAssignmentData {
  plan: AssignablePlan;
  subscriptionStatus: 'ACTIVE' | 'EXPIRED';
  renewalFailCount: number;
  renewalNoticeAt: null;
  autoRenew?: boolean;
}

export function planAssignmentData(plan: AssignablePlan): PlanAssignmentData {
  if (plan === 'TRIAL') {
    return { plan, subscriptionStatus: 'EXPIRED', renewalFailCount: 0, renewalNoticeAt: null };
  }
  return {
    plan,
    subscriptionStatus: 'ACTIVE',
    renewalFailCount: 0,
    renewalNoticeAt: null,
    ...(plan === 'PARTNER' ? { autoRenew: false } : {}),
  };
}
