/**
 * UCRETSIZ DENEME KURALLARI — tek kaynak (sahip karari 21.10.2026).
 *
 *  1. Deneme 14 gun surer: kayit aninda trialEndsAt = kayit + 14 gun
 *     (AuthService.ensureTrialStarted; web NextAuth kaydi ayni degeri yazar).
 *  2. Denemede yapay zeka makaleyi KENDILIGINDEN yazmaz: onboarding ve takvim
 *     yalniz konu basligi uretir. Makaleyi kullanici "Uret" ile baslatir (toplam 2
 *     hak degismedi: QuotaService LIMITS.TRIAL). Kullanici tiklamadan makale icin
 *     LLM harcanmaz (article-scheduler.service: tarama, gecikmeli is, onboarding).
 *  3. Denemede uretim ancak sitede bir yayin hedefi bagliyken baslar
 *     (hasGenerationSource). "Kaynak baglansin" karari tek fonksiyonda: ileride
 *     Search Console gibi baska bir kaynaga cevrilecekse yalniz burasi degisir.
 *  4. Sure dolunca (durum EXPIRED) hesap salt okunur: yapay zeka eylemi yok,
 *     goruntuleme / disa aktarma / cikis / hesap silme / odeme acik. Ama satin alma
 *     kapaliyken (PayTR test modu: yalniz yonetici odeyebilir) kullanici plan
 *     SECEMEZ; o zaman sert kilit uygulanmaz, panel kapatilabilir uyari gosterir ve
 *     yalniz 2 makale hakki kurali gecerli kalir (trialAccess).
 *  5. Kilit YALNIZ gercek deneme hesabina: hic odenmis faturasi olmayan hesap. Plani
 *     biten eski musteri (iptal edip donemi biten ya da odemesi alinamayan; plan
 *     TRIAL'a duser) deneme duzeyindeki haklarla devam eder, kilitlenmez
 *     (LAPSED_CUSTOMER_READ_ONLY; e-posta ve abonelik sayfasi "hesabin deneme
 *     duzeyine gecer" diyor).
 */

/** Deneme suresi (gun) */
export const TRIAL_DAYS = 14;

const DAY_MS = 86_400_000;

/** Kayit anindan deneme bitisi */
export function trialEndsAtFrom(start: Date): Date {
  return new Date(start.getTime() + TRIAL_DAYS * DAY_MS);
}

/** Kurallarin okudugu kullanici alanlari (Prisma User satirinin alt kumesi) */
export interface TrialSubject {
  plan?: string | null;
  subscriptionStatus?: string | null;
  trialEndsAt?: Date | string | null;
  role?: string | null;
}

function endsAtMs(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Deneme suresi doldu mu? Yalniz plan TRIAL (ucretli plan ASLA). Iki yol:
 *  - durum EXPIRED (gunluk 04:00 isi expireOldTrials, iptal edilip donemi biten ya da
 *    odemesi alinamayan abonelik);
 *  - durum ne olursa olsun (TRIAL, CANCELED, ACTIVE, PAST_DUE, bos) bitis gecmis.
 * NEDEN ikincisi her durumda: is gunde bir kez calisir ve yalniz durum TRIAL olani
 * EXPIRED yapar. Plan TRIAL iken durumu CANCELED/ACTIVE/PAST_DUE olan satir tutarsizdir
 * (eskiden denemedeki hesap "aboneligi iptal et" ile CANCELED olabiliyordu; artik
 * cancelSubscription reddeder, eski satirlari trial-backfill.ts duzeltir). Durumu
 * okuyup bitise bakmamak o hesabi sonsuza dek tam yetkili birakiyordu.
 */
export function isTrialExpired(u: TrialSubject, now: Date = new Date()): boolean {
  if (u.plan !== 'TRIAL') return false;
  if (u.subscriptionStatus === 'EXPIRED') return true;
  const end = endsAtMs(u.trialEndsAt);
  return end !== null && end <= now.getTime();
}

/**
 * SAHIP KARARI BEKLIYOR — plani biten eski musteri (en az bir PAID faturasi olan, plani
 * TRIAL'a dusmus hesap) de salt okunur kilide girsin mi?
 *
 * false (guvenli varsayilan): girmez. Deneme duzeyindeki haklarla devam eder (kayitli
 * metinler boyle: plan_canceled / subscription_expired e-postalari ve abonelik sayfasi
 * "hesabin deneme duzeyine gecer" diyor); panel "Deneme süren doldu" modali yerine
 * kapatilabilir "Planın sona erdi — yeniden abone ol" bandi gosterir (phase 'lapsed').
 * true: gercek deneme gibi davranir (phase 'expired', satin alma acikken salt okunur).
 * Cevirmeden once e-posta ve abonelik sayfasi metinleri de degismeli.
 */
export const LAPSED_CUSTOMER_READ_ONLY = false;

export type TrialPhase = 'paid' | 'trial' | 'expired' | 'lapsed';

/** Panelin ve sunucu kapisinin okudugu deneme durumu */
export interface TrialAccess {
  /**
   * paid: ucretli plan ya da yonetici; trial: deneme suruyor; expired: deneme doldu;
   * lapsed: plani biten eski musteri (deneme duzeyi, kilit yok — LAPSED_CUSTOMER_READ_ONLY)
   */
  phase: TrialPhase;
  /** Denemenin bitis ani (ISO); bilinmiyorsa null */
  endsAt: string | null;
  /** Bitise kalan tam gun (yukari yuvarlanir, en az 0); deneme disinda null */
  daysLeft: number | null;
  /** Satin alma bu hesap icin acik mi (PayTR checkoutStatus.open) */
  checkoutOpen: boolean;
  /**
   * Hesap salt okunur mu (sunucu yapay zeka eylemlerini reddeder)? YALNIZ deneme
   * dolmus VE satin alma acikken. Kapaliyken plan secilemez: kilit kullaniciyi
   * cikissiz birakirdi.
   */
  readOnly: boolean;
}

/**
 * TEK KARAR NOKTASI: deneme durumu + salt okunur kilidi. Sunucu kapisi
 * (trial-expiry.guard.ts) ve panel (GET /billing/users/:id/current trialAccess)
 * ayni sonucu kullanir.
 *
 * everPaid: hesabin en az bir PAID faturasi var mi (hasEverPaid). Zorunlu: kilidin
 * eski musteriye uygulanip uygulanmayacagi buna bagli; tahminle verilmesin.
 */
export function trialAccess(u: TrialSubject, opts: { checkoutOpen: boolean; everPaid: boolean; now?: Date }): TrialAccess {
  const now = opts.now ?? new Date();
  const end = endsAtMs(u.trialEndsAt);
  const endsAt = end === null ? null : new Date(end).toISOString();
  // Yonetici (platform sahibi/ekip) deneme kurallarina takilmaz — site/uygulama kotasiyla ayni gerekce
  if (u.role === 'ADMIN' || u.plan !== 'TRIAL') {
    return { phase: 'paid', endsAt: u.plan === 'TRIAL' ? endsAt : null, daysLeft: null, checkoutOpen: opts.checkoutOpen, readOnly: false };
  }
  // Plani biten eski musteri bir deneme hesabi degil: geri sayim da kilit de yok
  if (opts.everPaid && !LAPSED_CUSTOMER_READ_ONLY) {
    return { phase: 'lapsed', endsAt: null, daysLeft: null, checkoutOpen: opts.checkoutOpen, readOnly: false };
  }
  if (isTrialExpired(u, now)) {
    return { phase: 'expired', endsAt, daysLeft: 0, checkoutOpen: opts.checkoutOpen, readOnly: opts.checkoutOpen };
  }
  const daysLeft = end === null ? null : Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
  return { phase: 'trial', endsAt, daysLeft, checkoutOpen: opts.checkoutOpen, readOnly: false };
}

/** Deneme hesabinda "aboneligi iptal et": iptal edilecek ucretli abonelik yok (400) */
export const TRIAL_CANCEL_NOT_ALLOWED_MESSAGE =
  'Ücretsiz denemede iptal edilecek bir abonelik yok; deneme süresi dolunca senden ücret alınmaz. Hesabını kapatmak istersen Abonelik sayfasındaki “Hesabı sil” bölümünü kullanabilirsin.';

/** Sure dolmus ve satin alma acik hesabin yapay zeka eylemine 403 metni */
export const TRIAL_EXPIRED_READ_ONLY_MESSAGE =
  'Deneme süren doldu; hesabın şu an salt okunur. Verilerini görüntüleyip indirebilirsin. Yapay zekâ ile üretim, ölçüm ve analiz için bir plan seç.';

/** 403 govdesindeki makine kodu (panel bununla modal acar) */
export const TRIAL_EXPIRED_CODE = 'TRIAL_EXPIRED';

// ────────────────────────────────────────────────────────
//  Uretim kaynagi (denemede "Uret" icin yayin hedefi sarti)
// ────────────────────────────────────────────────────────

/** Kaynak kararinin okudugu yayin hedefi alanlari */
export interface GenerationSourceTarget {
  type?: string | null;
  isActive?: boolean | null;
}

/**
 * Kaynak sayilmayan hedef tipleri. Bugun bos: sahip "en az bir yayin hedefi" dedi
 * ve deneme planinda eklenebilen hedefler yalniz Markdown ZIP ile WordPress REST
 * (QuotaService LIMITS.TRIAL.publishTargets). ZIP'i saymamak WordPress disi
 * siteleri denemede tamamen uretimsiz birakirdi. Sahip ZIP'i kaynak saymamaya
 * karar verirse 'MARKDOWN_ZIP' buraya eklenir.
 */
export const GENERATION_SOURCE_EXCLUDED_TYPES: readonly string[] = Object.freeze([]);

/**
 * TEK KARAR: sitede uretime izin veren bir kaynak bagli mi? Bugun: en az bir AKTIF
 * yayin hedefi (pasif hedef bagli sayilmaz). Kaynak tanimi degisecekse (ornegin
 * Search Console) yalniz bu fonksiyon ve sorgusu (QuotaService.generationReadiness)
 * degisir.
 */
export function hasGenerationSource(targets: ReadonlyArray<GenerationSourceTarget> | null | undefined): boolean {
  return (targets ?? []).some((t) => t?.isActive !== false && !GENERATION_SOURCE_EXCLUDED_TYPES.includes(String(t?.type ?? '')));
}

/** Kaynak sarti hangi planlarda? Yalniz deneme (ucretli planlar degismedi) */
export function requiresGenerationSource(plan: string | null | undefined): boolean {
  return plan === 'TRIAL';
}

/** Kaynak yokken "Uret"in 403 metni (panel ayni metni dugmede gosterir) */
export const TRIAL_SOURCE_REQUIRED_MESSAGE =
  'Ücretsiz denemede makale üretmek için önce sitene bir yayın hedefi bağla (WordPress ya da Markdown ZIP). Yayın Hedefleri sayfasından birkaç adımda ekleyebilirsin.';

/** 403 govdesindeki makine kodu */
export const TRIAL_SOURCE_REQUIRED_CODE = 'TRIAL_SOURCE_REQUIRED';

/** GET /sites/:siteId/generation-readiness cevabi */
export interface GenerationReadiness {
  /** Bu sitede uretim icin kaynak sarti var mi (denemede true) */
  requiresSource: boolean;
  /** Sart saglaniyor mu (sart yoksa hep true) */
  ready: boolean;
  /** Hazir degilse gosterilecek metin; hazirsa null */
  message: string | null;
}

// ────────────────────────────────────────────────────────
//  Otomatik uretim (denemede yok)
// ────────────────────────────────────────────────────────

/**
 * Bu planda otomasyon (onboarding'in ilk yazisi, saatlik tarama, takvimin
 * gecikmeli isi, sahiplenmemis takvim yazisi) makale URETEBILIR mi? Denemede
 * hayir: konu basligi uretilir, makaleyi kullanici baslatir. (plan DB'de zorunlu
 * bir enum; sorgular onu her yolda okur.)
 */
export function automaticGenerationAllowed(plan: string | null | undefined): boolean {
  return plan !== 'TRIAL';
}
