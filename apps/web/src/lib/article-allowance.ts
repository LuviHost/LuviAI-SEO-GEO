import { isTrialPlan, readArticleQuota } from './article-quota';
import { PLAN_LOCK_COPY, UPGRADE_HREF } from './plan-lock';
import { readUpgradeOffer, type UpgradeOffer } from './plan-limit';

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

export type GenerationLockReason = 'trial_used' | 'monthly_used' | 'allowance_used' | 'source_required' | 'no_article_plan';

export interface GenerationLock {
  locked: boolean;
  reason: GenerationLockReason | null;
  /** Kilitli dugmenin etiketi */
  label: string;
  /** Kilitli dugmenin gittigi yer: fiyatlandirma ya da (kaynak yoksa) sitenin yayin hedefleri */
  href: string;
  /** Neden kilitli — dugmenin title'i / ekran okuyucu metni; acikken null */
  hint: string | null;
  /**
   * Hesabin makale yukseltme yolu — sunucudan (GET /billing/users/:id/current
   * `articleUpgrade`; api billing/plan-limit.ts). Dugme bununla yazilir: kartla alinan
   * planda "Profesyonel'e geç", teklifle satilanda "Teklif al". Yoksa (eski API) null:
   * dugme satis vaat etmez.
   *
   * Kilit durumundan BAGIMSIZ tasinir. Uretim dugmesi acikken ya da yayin hedefi
   * beklenirken de takvimde plana kilitli yazilar olabilir (denemenin ilk gununden);
   * o satirlarin ve seridin yukseltme dugmesi yolu buradan okur. Yalniz hak bittiginde
   * tasinsaydi en yaygin deneme durumunda dugme "Planları gör" derdi (inceleme 15.11.2026).
   */
  offer: UpgradeOffer | null;
}

// 11.11.2026 paket yapisi (api billing/plans.ts): makale uretimi yalniz Profesyonel ve ustunde;
// Baslangic makale uretmez. Deneme metni "planini yukselt" diyordu — Baslangic'i da kapsardi.
// Sunucunun deneme 403'u ile ayni yonlendirme (quota.service articleQuotaError).
export const GENERATION_LOCK_COPY = {
  trial: (limit: number) =>
    `Ücretsiz denemedeki ${limit} makale hakkını kullandın. Yeni makale üretmek için Profesyonel plana geç.`,
  monthly: (limit: number) =>
    `Bu ayki ${limit} makale hakkını kullandın. Hakkın gelecek ayın başında yenilenir; beklemeden devam etmek için planını yükselt.`,
  // Ust plan yalniz teklifle (Profesyonel → Kurumsal): "planını yükselt" kartla alinacak
  // bir plan varmis gibi okunur; dugme de "Teklif al" der
  monthlyQuote: (limit: number, planName: string) =>
    `Bu ayki ${limit} makale hakkını kullandın. Hakkın gelecek ayın başında yenilenir; daha yüksek hak ${planName} planında, teklifle sunuluyor.`,
  // Hicbir plan kaldirmiyor (en ust plan): yukseltme vaat edilmez
  monthlyWait: (limit: number) =>
    `Bu ayki ${limit} makale hakkını kullandın. Hakkın gelecek ayın başında yenilenir.`,
  // Plan okunamadi ama sayilar hakkin bittigini soyluyor: "ay basinda yenilenir"
  // denemede yalan olurdu, o yuzden yenilenme iddiasi yok
  generic: (limit: number) =>
    `${limit} makale hakkının tamamını kullandın. Yeni makale üretmek için planını yükselt; makale üretimi Profesyonel ve üstü planlardadır.`,
  // Makale uretimi olmayan paket (Baslangic). Sunucunun 403'u ile AYNI cumle
  // (api billing/quota.service articleQuotaError, limit 0).
  noArticles: 'Makale üretimi bu pakette yok. Makale üretmek için Profesyonel plana geç.',
  // Plani biten eski musteri deneme duzeyine duser (api trial-policy 'lapsed'). Ona
  // "ücretsiz denemedeki 2 makale hakkını kullandın" demek yanlis hitapti (15.11.2026).
  lapsed: 'Planın sona erdi; hesabın deneme düzeyinde ve makale hakkın kalmadı. Yeni makale üretmek için Profesyonel plana geç.',
} as const;

/**
 * Denemede "Uret" icin kaynak sarti (sahip karari 21.10.2026): sitede en az bir yayin
 * hedefi. Karar sunucuda (api billing/trial-policy.ts hasGenerationSource; GET
 * /sites/:siteId/generation-readiness); panel yalniz gosterir.
 */
export const SOURCE_REQUIRED_COPY = {
  label: 'Önce yayın hedefini bağla',
  hint: 'Ücretsiz denemede makale üretmek için önce sitene bir yayın hedefi bağla (WordPress ya da Markdown ZIP).',
} as const;

/** Sunucunun generation-readiness cevabi; bicim disiysa null (kilit gosterilmez) */
export function readGenerationReadiness(raw: unknown): { requiresSource: boolean; ready: boolean; message: string | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ready !== 'boolean' || typeof r.requiresSource !== 'boolean') return null;
  return { requiresSource: r.requiresSource, ready: r.ready, message: typeof r.message === 'string' && r.message.trim() ? r.message : null };
}

const OPEN: GenerationLock = { locked: false, reason: null, label: PLAN_LOCK_COPY.cta, href: UPGRADE_HREF, hint: null, offer: null };

/** Plan bilinmiyor mu? (null/bos) — deneme mi ucretli mi ayirt edilemez */
function planKnown(plan: unknown): boolean {
  if (typeof plan === 'string') return plan.trim() !== '';
  return !!plan && typeof plan === 'object' && String((plan as { id?: unknown }).id ?? '').trim() !== '';
}

/**
 * quota: API'nin articleQuota alani ({ limit, remaining, used }); plan: /me/dashboard
 * enum'u ('TRIAL') ya da /billing/users/:id/current plan tanimi ({ id: 'trial' }).
 */
export function generationLock(
  quota: unknown,
  plan: unknown,
  source?: { readiness?: unknown; publishTargetsHref?: string | null },
  /** Hesap durumu: yukseltme yolu (`articleUpgrade`) ve deneme evresi (`trialAccess.phase`) */
  account?: { upgrade?: unknown; phase?: unknown },
): GenerationLock {
  const q = readArticleQuota(quota);
  const offer = readUpgradeOffer(account?.upgrade);
  const open: GenerationLock = offer ? { ...OPEN, offer } : OPEN;
  const hakBitti = !!q && q.limit > 0 && q.remaining === 0 && q.used >= q.limit;
  // Kaynak sarti: hak bitmediyse once bu soylenir (hak bittiyse yukseltme daha dogru yol)
  const r = readGenerationReadiness(source?.readiness);
  if (!hakBitti && r && r.requiresSource && !r.ready && source?.publishTargetsHref) {
    return {
      locked: true,
      reason: 'source_required',
      label: SOURCE_REQUIRED_COPY.label,
      href: source.publishTargetsHref,
      hint: r.message ?? SOURCE_REQUIRED_COPY.hint,
      offer,
    };
  }
  if (!q) return open;
  // Kilit yalniz sayilar birbirini tutuyorsa: limit > 0, kalan 0 ve kullanilan limite ulasmis.
  // Tutarsiz sayiyla dugme kilitlenmez, karar sunucunun.
  // Makale uretimi olmayan paket (11.11.2026: Baslangic, api plans.ts articlesPerMonth 0).
  // Sunucu kurali: deneme DISI plan + limit 0 → 403 "Makale üretimi bu pakette yok…"
  // (quota.service articleQuotaError). Dugme ayni kuralla onceden kilitlenir; musteri tiklayip
  // hata okumaz. Plan okunamadiysa ya da deneme ise limit 0 bozuk veridir: kilit gosterilmez.
  if (q.limit === 0 && q.remaining === 0 && planKnown(plan) && !isTrialPlan(plan)) {
    return { locked: true, reason: 'no_article_plan', label: PLAN_LOCK_COPY.cta, href: UPGRADE_HREF, hint: GENERATION_LOCK_COPY.noArticles, offer };
  }
  if (q.limit <= 0 || q.remaining > 0 || q.used < q.limit) return open;
  if (isTrialPlan(plan)) {
    // Plani biten eski musteri de deneme planindadir; ona "ücretsiz deneme" denmez
    const hint = account?.phase === 'lapsed' ? GENERATION_LOCK_COPY.lapsed : GENERATION_LOCK_COPY.trial(q.limit);
    return { locked: true, reason: 'trial_used', label: PLAN_LOCK_COPY.cta, href: UPGRADE_HREF, hint, offer };
  }
  if (planKnown(plan)) {
    const hint = offer?.kind === 'quote' && offer.planName
      ? GENERATION_LOCK_COPY.monthlyQuote(q.limit, offer.planName)
      : offer?.kind === 'wait'
        ? GENERATION_LOCK_COPY.monthlyWait(q.limit)
        : GENERATION_LOCK_COPY.monthly(q.limit);
    return { locked: true, reason: 'monthly_used', label: PLAN_LOCK_COPY.cta, href: UPGRADE_HREF, hint, offer };
  }
  return { locked: true, reason: 'allowance_used', label: PLAN_LOCK_COPY.cta, href: UPGRADE_HREF, hint: GENERATION_LOCK_COPY.generic(q.limit), offer };
}

