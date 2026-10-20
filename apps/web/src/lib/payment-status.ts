import type { CheckoutAvailability } from './api';
import { readCheckout } from './checkout-availability';

/**
 * Odeme donus sayfasi (/billing/success) karari — saf, test edilir
 * (payment-status.spec.mts).
 *
 * NEDEN: sayfa her durumda "Odeme Basarili! Aboneliginiz aktif edildi." diyor ve
 * herkes icin dev-confirm cagiriyordu. PayTR'de kullanicinin bu sayfaya
 * yonlenmesi siparisin onaylandigi anlamina gelmez:
 *  - "Uyarı: Müşteri bu sayfaya ulaştığında henüz sipariş onaylanmış olmaz"
 *    (dev.paytr.com/direkt-api/direkt-api-1-adim, merchant_ok_url)
 *  - "Bu sayfa siparişi onaylayacağınız sayfa değildir! Yalnızca müşterinizi
 *    bilgilendireceğiniz sayfadır!" (dev.paytr.com/iframe-api/iframe-api-1-adim)
 * Onay bildirim ucuna gelen imzali bildirimle olur (api billing/paytr.service.ts
 * handleWebhook -> markInvoicePaid -> activateSubscription). Bildirim gecikebilir
 * ya da odeme reddedilebilir (PayTR test modunda yonetici disi odeme FAILED +
 * TEST_MODE olur). Sayfa bu yuzden gercek durumu okur ve yalniz ucretli plan
 * gercekten ACTIVE iken "aktif" der:
 *  - GET /billing/users/:id/current: subscriptionStatus + plan
 *  - GET /billing/users/:id/invoices: bu odemenin faturasi (paytrTransactionId = merchantOid)
 */

/** iFrame akisi (fiyat sayfasi, yukseltme penceresi) siparis numarasini burada birakir */
export const PENDING_MERCHANT_OID_KEY = 'luviai-pending-merchantOid';

/** Onay bu sure icinde gelmezse sayfa beklemeyi birakir (unconfirmed); yeniden kontrol dugmesi kalir */
export const PAYMENT_WAIT_MS = 60_000;
/**
 * Bekleme sirasinda durum bu aralikla yeniden okunur (her turda 2 GET). API'nin genel
 * siniri IP basina dakikada 60 istek (app.module ThrottlerModule varsayilani); sayfa
 * yukseltme penceresinin iframe'inde acildiginda pencere de 4 sn'de bir kota okur.
 * 5 sn = dakikada 24 istek: ikisi birlikte sinirin altinda kalir.
 */
export const PAYMENT_POLL_MS = 5_000;

/** PayTR merchant_oid yalniz harf ve rakam (api paytr.service generateOrderId: LUVI + ...) */
const MERCHANT_OID = /^[A-Za-z0-9]{1,64}$/;

/** Siparis numarasindaki plan kodu — api paytr.service parseOrderId planMap ile ayni */
const PLAN_CODES: Readonly<Record<string, string>> = { STA: 'starter', PRO: 'pro', AGE: 'agency' };

/**
 * Bu siparisle satin alinan plan. Bicim api paytr.service generateOrderId:
 * `LUVI` + userId'nin ilk 8 karakteri + plan kodu (3) + zaman; parseOrderId
 * ayni yerden (12-15) okur. Bicim disiysa null (karar plana bakmadan verilir).
 */
export function purchasedPlanId(merchantOid: string): string | null {
  if (!merchantOid.startsWith('LUVI')) return null;
  return PLAN_CODES[merchantOid.slice(12, 15)] ?? null;
}

export interface SubscriptionView {
  /** subscriptionStatus: TRIAL | ACTIVE | PAST_DUE | CANCELED | EXPIRED */
  status: string;
  /** plans.ts kimligi (trial, starter, pro, agency, enterprise) */
  planId: string | null;
  planName: string | null;
  checkout: CheckoutAvailability | null;
}

/** GET /current govdesi; hata govdesi (401/403) ya da bicim disi ise null */
export function readSubscription(raw: unknown): SubscriptionView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.status !== 'string') return null;
  const plan = r.plan && typeof r.plan === 'object' ? (r.plan as Record<string, unknown>) : null;
  return {
    status: r.status,
    planId: typeof plan?.id === 'string' ? plan.id : null,
    planName: typeof plan?.name === 'string' && plan.name.trim() ? plan.name : null,
    checkout: readCheckout(r.checkout),
  };
}

/** Direkt API akisinin sekme deposundaki imzali form kaydindan siparis numarasi */
export function directCheckoutOid(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { merchantOid?: unknown } | null;
    return typeof parsed?.merchantOid === 'string' ? parsed.merchantOid : null;
  } catch {
    return null;
  }
}

export interface PaymentInvoice {
  merchantOid: string;
  /** PENDING | PAID | FAILED | REFUNDED */
  status: string;
  createdAt: number;
}

/**
 * Bu tarayicida baslatilan odemelerden faturasi bulunan EN YENISI. Aday iki
 * yerden gelir (iFrame: localStorage, Direkt API: sekme deposu); eski bir
 * denemenin numarasi kalmis olabilir, fatura tarihi hangisinin bu odeme
 * oldugunu soyler. Liste okunamazsa ya da hicbiri bulunmazsa null.
 */
export function findPaymentInvoice(raw: unknown, candidates: ReadonlyArray<string | null | undefined>): PaymentInvoice | null {
  if (!Array.isArray(raw)) return null;
  const wanted = new Set(candidates.filter((c): c is string => typeof c === 'string' && MERCHANT_OID.test(c)));
  if (wanted.size === 0) return null;
  let best: PaymentInvoice | null = null;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const i = item as Record<string, unknown>;
    if (typeof i.paytrTransactionId !== 'string' || !wanted.has(i.paytrTransactionId) || typeof i.status !== 'string') continue;
    const created = typeof i.createdAt === 'string' ? Date.parse(i.createdAt) : Number.NaN;
    const found = { merchantOid: i.paytrTransactionId, status: i.status, createdAt: Number.isFinite(created) ? created : 0 };
    if (!best || found.createdAt > best.createdAt) best = found;
  }
  return best;
}

export type PaymentOutcome =
  /** Ucretli plan acik. paymentConfirmed: bu odemenin faturasi PAID; false ise yalniz planin acik oldugu biliniyor */
  | { kind: 'active'; planName: string; paymentConfirmed: boolean }
  /** Onay bekleniyor: bildirim henuz gelmedi, sayfa yeniden okur */
  | { kind: 'verifying' }
  /** Bu odemenin faturasi FAILED: plan acilmadi */
  | { kind: 'failed' }
  /** Bekleme suresi doldu, plan hala acik degil */
  | { kind: 'unconfirmed' }
  /** Abonelik durumu okunamadi (oturum yok, ag hatasi) */
  | { kind: 'unknown' };

export function paymentOutcome(input: { current: unknown; invoice: PaymentInvoice | null; timedOut: boolean }): PaymentOutcome {
  const sub = readSubscription(input.current);
  if (!sub) return { kind: 'unknown' };
  const { invoice } = input;
  if (invoice?.status === 'FAILED') return { kind: 'failed' };
  const paidPlanActive = sub.status === 'ACTIVE' && sub.planId !== null && sub.planId !== 'trial';
  const planName = sub.planName ?? sub.planId ?? '';
  // Odeme bilinmiyorsa (depo kapali, liste okunamadi) yalniz planin acik oldugu soylenir
  if (paidPlanActive && invoice === null) return { kind: 'active', planName, paymentConfirmed: false };
  // Odeme biliniyorsa yalniz PAID iken ve satin alinan plan acikken "aktif": ust plana
  // geciste eski ucretli plan zaten ACTIVE'dir; PENDING fatura ya da fatura PAID olup
  // plan henuz guncellenmemisken (markInvoicePaid -> activateSubscription arasi) eski
  // planin adiyla "acildi" demek yanlis olurdu.
  if (paidPlanActive && invoice?.status === 'PAID') {
    const bought = purchasedPlanId(invoice.merchantOid);
    if (bought === null || bought === sub.planId) return { kind: 'active', planName, paymentConfirmed: true };
  }
  return { kind: input.timedOut ? 'unconfirmed' : 'verifying' };
}

/**
 * Yeniden okunacak mi? Onay bekleniyorsa evet. Durum okunamadiysa (429 hiz siniri,
 * ag kesintisi) bekleme bitene kadar yine evet: gecici bir hata sonucu "okunamadi"ya
 * cevirmesin; sayfa bu sirada ekrandaki son durumu korur.
 */
export function keepPolling(outcome: PaymentOutcome, timedOut: boolean): boolean {
  return outcome.kind === 'verifying' || (outcome.kind === 'unknown' && !timedOut);
}

/**
 * Yonetici test odemesi kisayolu (POST /billing/dev-confirm/:merchantOid).
 * Yalniz sunucu bu hesaba "test modu + satin alma acik" diyorsa cagrilir:
 * PayTR test modunda bu yalniz yoneticide olur (api paytr.service checkoutStatus;
 * devConfirmPayment ayni kapidan gecer, digerlerine 403). Eski API'de alan
 * yoksa cagrilmaz. Fatura PENDING degilse onaylanacak bir sey yoktur.
 */
export function mayDevConfirm(current: unknown, invoice: PaymentInvoice | null): boolean {
  const checkout = readSubscription(current)?.checkout;
  return !!checkout && checkout.testMode && checkout.open && invoice?.status === 'PENDING';
}

/** Odeme altyapisi test modunda mi (not satiri icin); okunamazsa false */
export function paymentTestMode(current: unknown): boolean {
  return readSubscription(current)?.checkout?.testMode === true;
}

export type PaymentTone = 'success' | 'pending' | 'error' | 'neutral';

export interface PaymentMessage {
  title: string;
  body: string;
  tone: PaymentTone;
}

/**
 * Sayfada gosterilen metin. Aktivasyonu yalniz 'active' soyler; digerleri
 * dogrulaniyor / tamamlanmadi / okunamadi der. null = ilk okuma bekleniyor.
 */
export function paymentMessage(outcome: PaymentOutcome | null): PaymentMessage {
  if (!outcome) {
    return { title: 'Ödeme durumu kontrol ediliyor…', body: 'Bu birkaç saniye sürebilir.', tone: 'pending' };
  }
  switch (outcome.kind) {
    case 'active':
      // Yenilemede (ayni plan yeniden alininca) de dogru kalsin diye "yeni plan" denmez
      return outcome.paymentConfirmed
        ? { title: 'Ödemen alındı, planın aktif', body: `${outcome.planName} planın aktif. Plan haklarını hemen kullanabilirsin.`, tone: 'success' }
        : {
          title: 'Planın aktif',
          body: `${outcome.planName} planın şu an aktif. Bu ödemenin durumunu abonelik sayfasındaki faturalar listesinde görebilirsin.`,
          tone: 'success',
        };
    case 'verifying':
      return {
        title: 'Ödemen doğrulanıyor',
        body: 'PayTR’den ödeme onayı bekleniyor. Onay gelince yeni planın otomatik açılır; bu sayfa kendiliğinden güncellenir.',
        tone: 'pending',
      };
    case 'failed':
      return {
        title: 'Ödeme tamamlanmadı',
        body: 'Bu ödeme onaylanmadı, yeni plan açılmadı. Faturanın durumu ve varsa nedeni abonelik sayfasında görünür.',
        tone: 'error',
      };
    case 'unconfirmed':
      // Ust plana geciste eski plan acik kalir: "plan acik degil" denmez, yeni plan anilir
      return {
        title: 'Yeni planın henüz açılmadı',
        body: 'PayTR’den gelen onay gecikebilir; onay gelince yeni planın otomatik açılır. Durumu abonelik sayfasından izleyebilirsin.',
        tone: 'neutral',
      };
    case 'unknown':
      return {
        title: 'Ödeme durumu okunamadı',
        body: 'Oturumun kapanmış ya da bağlantı kesilmiş olabilir. Giriş yapıp planını abonelik sayfasından kontrol edebilirsin.',
        tone: 'neutral',
      };
  }
}
