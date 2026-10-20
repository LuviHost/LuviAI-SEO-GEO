/**
 * Odeme donus sayfasi (/billing/success): aktivasyonu yalniz plan gercekten
 * acikken soyler; dev-confirm yalniz test modundaki yoneticide cagrilir.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_POLL_MS,
  PAYMENT_WAIT_MS,
  PENDING_MERCHANT_OID_KEY,
  directCheckoutOid,
  findPaymentInvoice,
  keepPolling,
  mayDevConfirm,
  paymentMessage,
  paymentOutcome,
  paymentTestMode,
  purchasedPlanId,
  readSubscription,
  type PaymentInvoice,
  type PaymentOutcome,
} from './payment-status';

// api paytr.service generateOrderId bicimi: LUVI + userId ilk 8 + plan kodu + zaman
const OID_PRO = 'LUVIck3x9a2bPRO1760790000000';
const OID_STA = 'LUVIck3x9a2bSTA1760780000000';

const LIVE = { open: true, testMode: false, message: null };
const ADMIN_IN_TEST = { open: true, testMode: true, message: null };
const CUSTOMER_IN_TEST = { open: false, testMode: true, message: 'Ödeme altyapısı şu an test modunda; satın alma henüz açık değil.' };

const current = (status: string, planId: string, checkout: unknown = LIVE) => ({
  status,
  plan: { id: planId, name: ({ trial: 'Ücretsiz Deneme', starter: 'Büyüme', pro: 'Profesyonel', agency: 'Ajans' } as Record<string, string>)[planId] ?? planId },
  checkout,
});
const inv = (merchantOid: string, status: string, createdAt = 1): PaymentInvoice => ({ merchantOid, status, createdAt });

describe('paymentOutcome: aktivasyon yalniz plan gercekten acikken', () => {
  it('denemedeki kullanici, fatura PENDING (bildirim gelmedi): doğrulanıyor; süre dolunca onaylanmadı', () => {
    const c = current('TRIAL', 'trial');
    expect(paymentOutcome({ current: c, invoice: inv(OID_PRO, 'PENDING'), timedOut: false })).toEqual({ kind: 'verifying' });
    expect(paymentOutcome({ current: c, invoice: inv(OID_PRO, 'PENDING'), timedOut: true })).toEqual({ kind: 'unconfirmed' });
  });

  it('fatura PAID ve satın alınan plan ACTIVE: aktif, ödeme onaylı', () => {
    expect(paymentOutcome({ current: current('ACTIVE', 'pro'), invoice: inv(OID_PRO, 'PAID'), timedOut: false }))
      .toEqual({ kind: 'active', planName: 'Profesyonel', paymentConfirmed: true });
  });

  it('üst plana geçiş: eski plan zaten ACTIVE ama bu ödeme PENDING ise "aktif" denmez', () => {
    const c = current('ACTIVE', 'starter');
    expect(paymentOutcome({ current: c, invoice: inv(OID_PRO, 'PENDING'), timedOut: false })).toEqual({ kind: 'verifying' });
    expect(paymentOutcome({ current: c, invoice: inv(OID_PRO, 'PENDING'), timedOut: true })).toEqual({ kind: 'unconfirmed' });
  });

  it('fatura PAID ama plan henüz güncellenmedi (markInvoicePaid -> activateSubscription arası): eski planın adıyla "aktif" denmez', () => {
    expect(paymentOutcome({ current: current('ACTIVE', 'starter'), invoice: inv(OID_PRO, 'PAID'), timedOut: false })).toEqual({ kind: 'verifying' });
  });

  it('aynı planın yeniden alınması (elle yenileme): PENDING iken "aktif" denmez, PAID olunca aktif', () => {
    expect(paymentOutcome({ current: current('ACTIVE', 'starter'), invoice: inv(OID_STA, 'PENDING'), timedOut: false })).toEqual({ kind: 'verifying' });
    expect(paymentOutcome({ current: current('ACTIVE', 'starter'), invoice: inv(OID_STA, 'PAID'), timedOut: false }))
      .toEqual({ kind: 'active', planName: 'Büyüme', paymentConfirmed: true });
  });

  it('sipariş numarasından plan okunamazsa karar yalnız faturaya bakar: PENDING doğrulanıyor, PAID aktif', () => {
    const c = current('ACTIVE', 'pro');
    expect(paymentOutcome({ current: c, invoice: inv('ESKIBICIM123', 'PENDING'), timedOut: true })).toEqual({ kind: 'unconfirmed' });
    expect(paymentOutcome({ current: c, invoice: inv('ESKIBICIM123', 'PAID'), timedOut: false }))
      .toEqual({ kind: 'active', planName: 'Profesyonel', paymentConfirmed: true });
  });

  it('fatura FAILED (ör. test modunda yönetici dışı ödeme, TEST_MODE): tamamlanmadı — eski plan ACTIVE olsa da', () => {
    expect(paymentOutcome({ current: current('TRIAL', 'trial', CUSTOMER_IN_TEST), invoice: inv(OID_PRO, 'FAILED'), timedOut: false })).toEqual({ kind: 'failed' });
    expect(paymentOutcome({ current: current('ACTIVE', 'starter'), invoice: inv(OID_PRO, 'FAILED'), timedOut: true })).toEqual({ kind: 'failed' });
  });

  it('ödeme bilinmiyor (depo kapalı / liste okunamadı): plan açıksa yalnız planın açık olduğu söylenir', () => {
    expect(paymentOutcome({ current: current('ACTIVE', 'agency'), invoice: null, timedOut: false }))
      .toEqual({ kind: 'active', planName: 'Ajans', paymentConfirmed: false });
    expect(paymentOutcome({ current: current('TRIAL', 'trial'), invoice: null, timedOut: false })).toEqual({ kind: 'verifying' });
    expect(paymentOutcome({ current: current('TRIAL', 'trial'), invoice: null, timedOut: true })).toEqual({ kind: 'unconfirmed' });
  });

  it('ACTIVE dışı durumlar ve deneme planı ücretli plan sayılmaz', () => {
    for (const status of ['PAST_DUE', 'CANCELED', 'EXPIRED', 'TRIAL']) {
      expect(paymentOutcome({ current: current(status, 'pro'), invoice: null, timedOut: true }).kind, status).toBe('unconfirmed');
    }
    expect(paymentOutcome({ current: current('ACTIVE', 'trial'), invoice: null, timedOut: true }).kind).toBe('unconfirmed');
  });

  it('abonelik okunamadı (oturum yok 401, ağ hatası, biçim dışı): bilinmiyor — başarı iddiası yok', () => {
    for (const raw of [null, undefined, 'x', {}, { statusCode: 401, message: 'Unauthorized' }, { status: 401 }]) {
      expect(paymentOutcome({ current: raw, invoice: inv(OID_PRO, 'PAID'), timedOut: false }), JSON.stringify(raw)).toEqual({ kind: 'unknown' });
    }
  });
});

describe('mayDevConfirm: yalnız test modundaki yönetici', () => {
  it('sunucu bu hesaba "test modu + satın alma açık" diyorsa (yönetici) ve fatura PENDING ise', () => {
    expect(mayDevConfirm(current('TRIAL', 'trial', ADMIN_IN_TEST), inv(OID_PRO, 'PENDING'))).toBe(true);
  });

  it('test modunda müşteri, canlı mod, alanı olmayan eski API: asla', () => {
    expect(mayDevConfirm(current('TRIAL', 'trial', CUSTOMER_IN_TEST), inv(OID_PRO, 'PENDING'))).toBe(false);
    expect(mayDevConfirm(current('TRIAL', 'trial', LIVE), inv(OID_PRO, 'PENDING'))).toBe(false);
    expect(mayDevConfirm({ status: 'TRIAL', plan: { id: 'trial' } }, inv(OID_PRO, 'PENDING'))).toBe(false);
    expect(mayDevConfirm({ statusCode: 403 }, inv(OID_PRO, 'PENDING'))).toBe(false);
  });

  it('onaylanacak fatura yoksa (PAID, FAILED, bulunamadı) yönetici için de çağrılmaz', () => {
    for (const i of [inv(OID_PRO, 'PAID'), inv(OID_PRO, 'FAILED'), null]) {
      expect(mayDevConfirm(current('TRIAL', 'trial', ADMIN_IN_TEST), i)).toBe(false);
    }
  });
});

describe('paymentMessage: metin sonuçla aynı', () => {
  const aktiflik = /aktif|alındı|başarılı|açıldı/i;

  it('aktivasyonu yalnız "active" söyler; plan adı API\'den', () => {
    const m = paymentMessage({ kind: 'active', planName: 'Profesyonel', paymentConfirmed: true });
    expect(m.tone).toBe('success');
    expect(`${m.title} ${m.body}`).toContain('Profesyonel planın aktif');
    expect(paymentMessage({ kind: 'active', planName: 'Ajans', paymentConfirmed: false }).title).toBe('Planın aktif');
    expect(paymentMessage({ kind: 'active', planName: 'Ajans', paymentConfirmed: false }).body).not.toMatch(/alındı/);
  });

  it('doğrulanıyor / onaylanmadı / tamamlanmadı / okunamadı ve ilk okuma: aktiflik ya da ödeme alındı iddiası yok', () => {
    const digerleri: Array<PaymentOutcome | null> = [null, { kind: 'verifying' }, { kind: 'unconfirmed' }, { kind: 'failed' }, { kind: 'unknown' }];
    for (const o of digerleri) {
      const m = paymentMessage(o);
      expect(`${m.title} ${m.body}`, JSON.stringify(o)).not.toMatch(aktiflik);
      expect(m.tone).not.toBe('success');
    }
    expect(paymentMessage({ kind: 'verifying' }).title).toBe('Ödemen doğrulanıyor');
    expect(paymentMessage({ kind: 'failed' }).body).toContain('yeni plan açılmadı');
    // Ust plana geciste eski plan acik kalir: "plan acik degil" gibi bir yanlis yok
    expect(paymentMessage({ kind: 'unconfirmed' }).title).toBe('Yeni planın henüz açılmadı');
  });
});

describe('yardımcılar', () => {
  it('readSubscription yalnız bilinen alanları alır', () => {
    expect(readSubscription(current('ACTIVE', 'pro', ADMIN_IN_TEST))).toEqual({ status: 'ACTIVE', planId: 'pro', planName: 'Profesyonel', checkout: ADMIN_IN_TEST });
    expect(readSubscription({ status: 'TRIAL' })).toEqual({ status: 'TRIAL', planId: null, planName: null, checkout: null });
    expect(readSubscription({ statusCode: 401 })).toBeNull();
  });

  it('findPaymentInvoice: adaylardan faturası olan en yenisi; geçersiz ya da eşleşmeyen yok sayılır', () => {
    const list = [
      { paytrTransactionId: OID_STA, status: 'PENDING', createdAt: '2026-10-17T10:00:00.000Z' },
      { paytrTransactionId: OID_PRO, status: 'PAID', createdAt: '2026-10-18T10:00:00.000Z' },
      { paytrTransactionId: 'LUVIbaskaHESAPPRO1', status: 'PAID', createdAt: '2026-10-19T10:00:00.000Z' },
    ];
    expect(findPaymentInvoice(list, [OID_STA, OID_PRO])).toEqual({ merchantOid: OID_PRO, status: 'PAID', createdAt: Date.parse('2026-10-18T10:00:00.000Z') });
    expect(findPaymentInvoice(list, [OID_STA, null])?.merchantOid).toBe(OID_STA);
    expect(findPaymentInvoice(list, [null, undefined, '', 'a b'])).toBeNull();
    expect(findPaymentInvoice({ statusCode: 401 }, [OID_PRO])).toBeNull();
    expect(findPaymentInvoice([null, 'x', { paytrTransactionId: OID_PRO }], [OID_PRO])).toBeNull();
  });

  it('directCheckoutOid: Direkt API formunun sekme kaydından', () => {
    expect(directCheckoutOid(JSON.stringify({ mode: 'direct', merchantOid: OID_PRO }))).toBe(OID_PRO);
    expect(directCheckoutOid('{bozuk')).toBeNull();
    expect(directCheckoutOid(null)).toBeNull();
    expect(directCheckoutOid(JSON.stringify({ merchantOid: 5 }))).toBeNull();
  });

  it('purchasedPlanId: sipariş numarasındaki plan kodu', () => {
    expect(purchasedPlanId(OID_PRO)).toBe('pro');
    expect(purchasedPlanId(OID_STA)).toBe('starter');
    expect(purchasedPlanId('LUVIck3x9a2bAGE1760790000000')).toBe('agency');
    expect(purchasedPlanId('LVCRck3x9a2b1760790000000')).toBeNull();
    expect(purchasedPlanId('LUVIck3x9a2bXYZ1760790000000')).toBeNull();
  });

  it('paymentTestMode: not satırı yalnız test modunda', () => {
    expect(paymentTestMode(current('ACTIVE', 'pro', ADMIN_IN_TEST))).toBe(true);
    expect(paymentTestMode(current('ACTIVE', 'pro', LIVE))).toBe(false);
    expect(paymentTestMode(null)).toBe(false);
  });

  it('keepPolling: onay bekleniyorsa ve geçici okuma hatasında süre bitene kadar', () => {
    expect(keepPolling({ kind: 'verifying' }, false)).toBe(true);
    expect(keepPolling({ kind: 'unknown' }, false)).toBe(true);
    expect(keepPolling({ kind: 'unknown' }, true)).toBe(false);
    for (const o of [{ kind: 'active', planName: 'Büyüme', paymentConfirmed: true }, { kind: 'failed' }, { kind: 'unconfirmed' }] as PaymentOutcome[]) {
      expect(keepPolling(o, false), o.kind).toBe(false);
    }
  });

  it('bekleme süresi makul: en az birkaç yeniden okuma', () => {
    expect(PAYMENT_WAIT_MS / PAYMENT_POLL_MS).toBeGreaterThanOrEqual(10);
  });
});

// --- Kaynak denetimi: siparis numarasi bicimi ve sayfanin karari kullanmasi ---

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Yorumlar neyin neden kaldirildigini anlatir; yalniz kod taranir */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

describe('kaynak: sipariş numarası biçimi API ile aynı', () => {
  it('generateOrderId / parseOrderId değişirse purchasedPlanId de güncellenmeli', () => {
    const paytr = read('../../../api/src/billing/paytr.service.ts');
    expect(paytr).toContain('return `LUVI${userId.slice(0, 8)}${planId.slice(0, 3).toUpperCase()}${ts}`;');
    expect(paytr).toContain('const planPart = orderId.slice(12, 15);');
    expect(paytr).toMatch(/STA: 'starter', PRO: 'pro', AGE: 'agency'/);
  });

  it('yeniden okuma API\'nin genel hız sınırının yarısını aşmıyor (yükseltme penceresinin kendi okumasına yer kalır)', () => {
    const app = read('../../../api/src/app.module.ts');
    const ttl = Number(app.match(/ttl: parseInt\(process\.env\.RATE_LIMIT_WINDOW_MS \?\? '(\d+)', 10\)/)?.[1]);
    const limit = Number(app.match(/limit: parseInt\(process\.env\.RATE_LIMIT_MAX \?\? '(\d+)', 10\)/)?.[1]);
    expect(ttl > 0 && limit > 0, 'ThrottlerModule varsayilanlari bulunamadi').toBe(true);
    // Her turda 2 GET (/current + /invoices)
    expect((ttl / PAYMENT_POLL_MS) * 2).toBeLessThanOrEqual(limit / 2);
  });

  it('iFrame akışındaki anahtar fiyat sayfası ve yükseltme penceresiyle aynı', () => {
    expect(PENDING_MERCHANT_OID_KEY).toBe('luviai-pending-merchantOid');
    expect(read('../app/(marketing)/pricing/page.tsx')).toContain(`localStorage.setItem('${PENDING_MERCHANT_OID_KEY}', data.merchantOid)`);
    expect(stripComments(read('../components/upgrade-plan-modal.tsx'))).toContain('localStorage.setItem(PENDING_MERCHANT_OID_KEY, data.merchantOid)');
  });
});

describe('kaynak: /billing/success gerçek durumu okur', () => {
  const page = stripComments(read('../app/(marketing)/billing/success/page.tsx'));

  it('koşulsuz başarı metni yok; metin ve karar lib/payment-status.ts\'ten', () => {
    expect(page).not.toMatch(/Ödeme Başarılı|Aboneliğiniz aktif edildi|aktif edildi/);
    expect(page).toContain("from '@/lib/payment-status'");
    expect(page).toContain('paymentMessage(outcome)');
    expect(page).toContain('paymentOutcome({ current, invoice, timedOut })');
    expect(page).toContain('keepPolling(next, timedOut)');
    expect(page).toContain('/users/${userId}/current');
    expect(page).toContain('/users/${userId}/invoices');
  });

  it('dev-confirm tek yerde ve yalnız mayDevConfirm (test modundaki yönetici) doğruysa çağrılır', () => {
    expect(page.split('dev-confirm').length - 1).toBe(1);
    const guard = page.indexOf('mayDevConfirm(current, invoice)');
    expect(guard).toBeGreaterThan(-1);
    const call = page.indexOf('dev-confirm');
    expect(call).toBeGreaterThan(guard);
    // Guard ile cagri ayni if blogunda: aradaki metinde blok kapanmiyor
    expect(page.slice(guard, call)).not.toContain('}');
  });

  it('rapora ve kurulum sihirbazına otomatik dönüş yalnız plan açıkken', () => {
    expect(page).toContain("const active = outcome?.kind === 'active';");
    expect(page).toContain('if (!active || !unlockDomain) return;');
    expect(page).toContain('if (!active || unlockDomain) return;');
    expect(page.match(/router\.push\(/g)?.length).toBe(3);
  });
});
