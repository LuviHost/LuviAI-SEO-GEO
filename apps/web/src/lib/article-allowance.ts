import { isTrialPlan, readArticleQuota } from './article-quota';
import { PLAN_LOCK_COPY, UPGRADE_HREF } from './plan-lock';

/**
 * Makale hakki bitti mi — uretim dugmesi kilitli mi? Saf, test edilir
 * (article-allowance.spec.mts).
 *
 * NEDEN: hak dolunca "Uret", "Makale uret", "Simdi uret", "Takvime ekle" sunucudan
 * 403 donuyordu; musteri once tiklayip sonra hata okuyordu. Dugme artik once
 * kilidi gosterir (kilit + "Planini yukselt" → /pricing).
 *
 * ASIL KAPI SUNUCUDA KALIR (api billing/quota.service consumeArticleAllowance,
 * article-scheduler scheduleTopic). Buradaki karar yalniz gorunum: sayi yoksa,
 * bicim disiysa ya da tutarsizsa kilit GOSTERILMEZ (fail open), sunucu yine korur.
 *
 * Hak SITENIN SAHIBININ hesabindan duser (sunucu site.userId); yonetici baskasinin
 * sitesinde sahibin hakkina bakar, kendi hakkina degil. Kural planin limitine
 * bakar: deneme hakki omur boyu (ay basinda yenilenmez), ucretli planin hakki
 * takvim ayi basinda sifirlanir (quota.service maybeResetMonthlyQuota).
 */

export type GenerationLockReason = 'trial_used' | 'monthly_used' | 'allowance_used';

export interface GenerationLock {
  locked: boolean;
  reason: GenerationLockReason | null;
  /** Kilitli dugmenin etiketi */
  label: string;
  /** Kilitli dugmenin gittigi yer (fiyatlandirma) */
  href: typeof UPGRADE_HREF;
  /** Neden kilitli — dugmenin title'i / ekran okuyucu metni; acikken null */
  hint: string | null;
}

export const GENERATION_LOCK_COPY = {
  trial: (limit: number) =>
    `Ücretsiz denemedeki ${limit} makale hakkını kullandın. Yeni makale üretmek için planını yükselt.`,
  monthly: (limit: number) =>
    `Bu ayki ${limit} makale hakkını kullandın. Hakkın gelecek ayın başında yenilenir; beklemeden devam etmek için planını yükselt.`,
  // Plan okunamadi ama sayilar hakkin bittigini soyluyor: "ay basinda yenilenir"
  // denemede yalan olurdu, o yuzden yenilenme iddiasi yok
  generic: (limit: number) =>
    `${limit} makale hakkının tamamını kullandın. Yeni makale üretmek için planını yükselt.`,
} as const;

const OPEN: GenerationLock = { locked: false, reason: null, label: PLAN_LOCK_COPY.cta, href: UPGRADE_HREF, hint: null };

/** Plan bilinmiyor mu? (null/bos) — deneme mi ucretli mi ayirt edilemez */
function planKnown(plan: unknown): boolean {
  if (typeof plan === 'string') return plan.trim() !== '';
  return !!plan && typeof plan === 'object' && String((plan as { id?: unknown }).id ?? '').trim() !== '';
}

/**
 * quota: API'nin articleQuota alani ({ limit, remaining, used }); plan: /me/dashboard
 * enum'u ('TRIAL') ya da /billing/users/:id/current plan tanimi ({ id: 'trial' }).
 */
export function generationLock(quota: unknown, plan: unknown): GenerationLock {
  const q = readArticleQuota(quota);
  if (!q) return OPEN;
  // Kilit yalniz sayilar birbirini tutuyorsa: limit > 0 (sunucuda limit 0 olan plan
  // yok; 0 bozuk/bilinmeyen veri demek), kalan 0 ve kullanilan limite ulasmis.
  // Tutarsiz sayiyla dugme kilitlenmez, karar sunucunun.
  if (q.limit <= 0 || q.remaining > 0 || q.used < q.limit) return OPEN;
  if (isTrialPlan(plan)) {
    return { locked: true, reason: 'trial_used', label: PLAN_LOCK_COPY.cta, href: UPGRADE_HREF, hint: GENERATION_LOCK_COPY.trial(q.limit) };
  }
  if (planKnown(plan)) {
    return { locked: true, reason: 'monthly_used', label: PLAN_LOCK_COPY.cta, href: UPGRADE_HREF, hint: GENERATION_LOCK_COPY.monthly(q.limit) };
  }
  return { locked: true, reason: 'allowance_used', label: PLAN_LOCK_COPY.cta, href: UPGRADE_HREF, hint: GENERATION_LOCK_COPY.generic(q.limit) };
}

