import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  PaytrService,
  CHECKOUT_TEST_MODE_MESSAGE,
  CHECKOUT_TEST_MODE_MESSAGE_EN,
  TEST_PAYMENT_FAILURE_CODE,
  TEST_PAYMENT_FAILURE_REASON,
} from './paytr.service.js';
import { BillingController } from './billing.controller.js';

/**
 * PayTR TEST MODU ucretli plan dagitmamali.
 *
 * NEDEN VAR: uretim PAYTR_TEST_MODE=1 ile calisiyordu. Test modunda PayTR odeme
 * sayfasi herkese acik test kartini kendisi doldurur ve basarili bildirim
 * gonderir (dev.paytr.com direkt-api/test-kart-bilgileri: "iFrame API ödeme
 * yönteminde test kart bilgileri otomatik olarak gelmektedir"); markInvoicePaid
 * plani aciyordu. Dahasi: /billing/dev-confirm her hesaba acikti, basari sayfasi
 * onu kendiliginden cagiriyordu — deneme kullanicisi PayTR'ye hic ugramadan
 * ucretli plan alabiliyordu. Gercek tahsilat ancak PayTR canliya gecisi onayladiktan
 * sonra baslar (dev.paytr.com home/iframe-api-entegrasyon-sureci).
 *
 * Kural: test modunda yalniz YONETICI odeme baslatir/onaylar; test odemesi
 * yonetici olmayan hesapta plan acmaz (fatura FAILED). Canli modda degisiklik yok.
 */

const KEY = 'test-merchant-key';
const SALT = 'test-merchant-salt';
const ADMIN = 'admin0001';
const CUSTOMER = 'cust00001';
/** LUVI + kullanici kimliginin ilk 8 karakteri + plan kodu + zaman (parseOrderId bu duzene bakar) */
const OID = (who: string, plan = 'PRO', ts = 1700000000000) => `LUVI${who.slice(0, 8)}${plan}${ts}`;

type Row = Record<string, any>;

function pick(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in v) row[k] = (row[k] ?? 0) + (v as any).increment;
    else row[k] = v;
  }
}

/** PayTR bildirim imzasi: base64(HMAC-SHA256(anahtar, merchant_oid + tuz + status + total_amount)) */
function signed(payload: Record<string, string>): Record<string, string> {
  const hash = createHmac('sha256', KEY).update(`${payload.merchant_oid}${SALT}${payload.status}${payload.total_amount}`).digest('base64');
  return { ...payload, hash };
}

let seq = 0;

/** Bellek ici dunya: yonetici + musteri; servis istenen PAYTR_TEST_MODE ile kurulur */
function world(testMode: string | undefined) {
  const users = new Map<string, Row>([
    [ADMIN, {
      id: ADMIN, role: 'ADMIN', email: 'admin@ranksup.test', name: 'Yönetici', plan: 'PRO', subscriptionStatus: 'ACTIVE',
      deletionRequestedAt: null, paytrUtoken: null, autoRenew: false, renewalFailCount: 0, articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date(),
      grandfatheredUntil: null, legacyMonthlyPriceTry: null,
    }],
    [CUSTOMER, {
      id: CUSTOMER, role: 'USER', email: 'musteri@ranksup.test', name: 'Müşteri', plan: 'TRIAL', subscriptionStatus: 'TRIAL',
      deletionRequestedAt: null, paytrUtoken: null, autoRenew: false, renewalFailCount: 0, articlesUsedThisMonth: 2, articlesQuotaResetAt: new Date(),
      grandfatheredUntil: null, legacyMonthlyPriceTry: null,
    }],
  ]);
  const invoices = new Map<string, Row>();
  const findInvoice = (where: Row) => (where.id ? invoices.get(where.id) : [...invoices.values()].find((i) => i.paytrTransactionId === where.paytrTransactionId));
  const prisma: any = {
    user: {
      findUnique: vi.fn(async ({ where, select }: any) => { const u = users.get(where.id); return u ? pick(u, select) : null; }),
      findUniqueOrThrow: vi.fn(async ({ where, select }: any) => { const u = users.get(where.id); if (!u) throw new Error('yok'); return pick(u, select); }),
      update: vi.fn(async ({ where, data, select }: any) => { const u = users.get(where.id)!; apply(u, data); return pick(u, select); }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const u = users.get(where.id);
        if (!u || (where.deletionRequestedAt === null && u.deletionRequestedAt)) return { count: 0 };
        apply(u, data);
        return { count: 1 };
      }),
    },
    invoice: {
      create: vi.fn(async ({ data }: any) => { const row = { id: `inv${++seq}`, ...data }; invoices.set(row.id, row); return { ...row }; }),
      findUnique: vi.fn(async ({ where }: any) => { const i = findInvoice(where); return i ? { ...i } : null; }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => { const i = findInvoice(where); if (!i) throw new Error('yok'); return { ...i }; }),
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const i = invoices.get(where.id);
        if (!i || i.status !== where.status) return { count: 0 };
        Object.assign(i, data);
        return { count: 1 };
      }),
    },
  };
  const affiliate = { recordCommission: vi.fn(async () => {}) };
  const email = { send: vi.fn(async () => ({ ok: true })) };
  const fx = { getRate: vi.fn(async () => ({ rate: 40, source: 'TCMB', stale: false, fetchedAt: new Date().toISOString() })) };

  /** Ayni veritabaninda (ornegin ortam canliya cevrildikten sonra) yeni servis */
  function service(mode: string | undefined = testMode) {
    vi.stubEnv('PAYTR_TEST_MODE', mode);
    return new PaytrService(prisma, affiliate as any, email as any, fx as any);
  }
  const svc = service();

  function pendingInvoice(userId: string | null, extra: Row = {}) {
    const row: Row = {
      id: `inv${++seq}`, userId, status: 'PENDING', amount: 13960, isRenewal: false, storeCard: false,
      paytrTransactionId: OID(userId ?? 'deleted0', 'PRO', 1700000000000 + seq), description: 'RanksUp Pro — monthly ($349 @ 40)',
      ...extra,
    };
    invoices.set(row.id, row);
    return row;
  }

  /** Plani ACTIVE yapan update cagrisi var mi */
  const activations = () => prisma.user.update.mock.calls.filter((c: any[]) => c[0].data.subscriptionStatus === 'ACTIVE');
  /** Rol sorgusu (yalniz test modu kararinda yapilir) */
  const roleLookups = () => prisma.user.findUnique.mock.calls.filter((c: any[]) => c[0].select?.role);

  return { svc, service, prisma, users, invoices, affiliate, email, fx, pendingInvoice, activations, roleLookups };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('PAYTR_MERCHANT_ID', 'test-merchant-id');
  vi.stubEnv('PAYTR_MERCHANT_KEY', KEY);
  vi.stubEnv('PAYTR_MERCHANT_SALT', SALT);
  vi.stubEnv('PAYTR_RECURRING_ENABLED', '0');
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({ json: async () => ({ status: 'success', token: 'paytr-tok-1' }) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const checkout = (userId: string, planId: 'starter' | 'pro' = 'pro') => ({
  userId, planId, cycle: 'monthly' as const, userIp: '203.0.113.7', userEmail: `${userId}@ranksup.test`, userName: userId,
});

/** Nest istisnasinin istemciye giden govdesi */
async function rejection(p: Promise<unknown>) {
  const err: any = await p.then(() => null, (e) => e);
  expect(err, 'istek reddedilmeliydi').toBeTruthy();
  return { err, body: typeof err.getResponse === 'function' ? err.getResponse() : null };
}

describe('odeme baslatma kapisi (iFrame jetonu ve Direkt API formu)', () => {
  it('test modunda yonetici olmayan hesap 403 + panelde gosterilen metni alir; PayTR\'ye istek gitmez, fatura acilmaz', async () => {
    for (const role of ['USER', 'AGENCY_OWNER']) {
      const w = world('1');
      w.users.get(CUSTOMER)!.role = role;
      vi.spyOn((w.svc as any).log, 'warn').mockImplementation(() => undefined);
      const { err, body } = await rejection(w.svc.createPaymentToken(checkout(CUSTOMER)));
      expect(err, role).toBeInstanceOf(ForbiddenException);
      expect(body).toMatchObject({ statusCode: 403, message: CHECKOUT_TEST_MODE_MESSAGE, code: 'PAYTR_TEST_MODE' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(w.prisma.invoice.create).not.toHaveBeenCalled();
    }
  });

  it('metin sahibin istedigi gibi', () => {
    expect(CHECKOUT_TEST_MODE_MESSAGE).toBe('Ödeme altyapısı şu an test modunda; satın alma henüz açık değil. Bilgi için bizimle iletişime geç.');
  });

  it('Direkt API (otomatik yenileme acik) ayni kapidan gecer: musteri 403, yonetici imzali formu alir', async () => {
    vi.stubEnv('PAYTR_RECURRING_ENABLED', '1');
    const w = world('1');
    vi.spyOn((w.svc as any).log, 'warn').mockImplementation(() => undefined);
    const { err } = await rejection(w.svc.createPaymentToken(checkout(CUSTOMER)));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(w.prisma.invoice.create).not.toHaveBeenCalled();

    const r: any = await w.svc.createPaymentToken(checkout(ADMIN));
    expect(r.mode).toBe('direct');
    expect(r.fields.test_mode).toBe('1');
    expect(w.invoices.get(`inv${seq}`)).toMatchObject({ userId: ADMIN, status: 'PENDING' });
  });

  it('test modunda yonetici odeme baslatir (canliya gecis icin PayTR test odemesi ister)', async () => {
    const w = world('1');
    const r: any = await w.svc.createPaymentToken(checkout(ADMIN));
    expect(r).toMatchObject({ mode: 'iframe', token: 'paytr-tok-1', iframeUrl: 'https://www.paytr.com/odeme/guvenli/paytr-tok-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('test_mode')).toBe('1');
    expect([...w.invoices.values()]).toEqual([expect.objectContaining({ userId: ADMIN, status: 'PENDING', paytrTransactionId: r.merchantOid })]);
  });

  it('canli modda (PAYTR_TEST_MODE=0) davranis degismez: musteri odeme baslatir, rol sorgusu yapilmaz', async () => {
    const w = world('0');
    const r: any = await w.svc.createPaymentToken(checkout(CUSTOMER));
    expect(r.mode).toBe('iframe');
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('test_mode')).toBe('0');
    expect([...w.invoices.values()]).toEqual([expect.objectContaining({ userId: CUSTOMER, status: 'PENDING' })]);
    expect(w.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('tanimsiz ya da bozuk deger test sayilir (kapali basarisizlik); yalniz "0" canli', async () => {
    // undefined: .env'de yok → servis varsayilani '1'. "1  # 1=test": pm2 satir ici yorumu silmez (.env.example).
    for (const mode of [undefined, '1', '', '1  # 1=test', 'true', 'false']) {
      const w = world(mode);
      vi.spyOn((w.svc as any).log, 'warn').mockImplementation(() => undefined);
      expect(w.svc.testModeOn, String(mode)).toBe(true);
      const { err } = await rejection(w.svc.createPaymentToken(checkout(CUSTOMER)));
      expect(err, String(mode)).toBeInstanceOf(ForbiddenException);
    }
    for (const mode of ['0', '0 ']) expect(world(mode).svc.testModeOn, JSON.stringify(mode)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('test onayi ucu (dev-confirm) yalniz yonetici', () => {
  it('musteri kendi PENDING faturasini onaylayamaz: 403, fatura PENDING kalir, plan acilmaz', async () => {
    const w = world('1');
    vi.spyOn((w.svc as any).log, 'warn').mockImplementation(() => undefined);
    const inv = w.pendingInvoice(CUSTOMER);
    const { err, body } = await rejection(w.svc.devConfirmPayment(CUSTOMER, inv.paytrTransactionId));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(body).toMatchObject({ message: CHECKOUT_TEST_MODE_MESSAGE });
    expect(w.invoices.get(inv.id)!.status).toBe('PENDING');
    expect(w.activations()).toHaveLength(0);
    expect(w.users.get(CUSTOMER)!.plan).toBe('TRIAL');
  });

  it('yonetici test onayiyla akisi dener: fatura PAID, plan acilir', async () => {
    const w = world('1');
    const inv = w.pendingInvoice(ADMIN);
    await expect(w.svc.devConfirmPayment(ADMIN, inv.paytrTransactionId)).resolves.toEqual({ ok: true, planId: 'pro' });
    expect(w.invoices.get(inv.id)!.status).toBe('PAID');
    expect(w.activations()).toHaveLength(1);
  });

  it('canli modda uc kapali (eski davranis: 400)', async () => {
    const w = world('0');
    const inv = w.pendingInvoice(ADMIN);
    const { err } = await rejection(w.svc.devConfirmPayment(ADMIN, inv.paytrTransactionId));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(w.invoices.get(inv.id)!.status).toBe('PENDING');
  });
});

describe('basarili PayTR bildirimi — test odemesi yonetici olmayan hesapta plan acmaz', () => {
  const success = (inv: Row, extra: Record<string, string> = {}) =>
    signed({ merchant_oid: inv.paytrTransactionId, status: 'success', total_amount: '1396000', ...extra });

  it('fatura FAILED + neden; plan, komisyon, e-posta yok; test kartinin utoken\'i saklanmaz; yanit OK', async () => {
    const w = world('1');
    const logError = vi.spyOn((w.svc as any).log, 'error').mockImplementation(() => undefined);
    const inv = w.pendingInvoice(CUSTOMER, { storeCard: true });
    await expect(w.svc.handleWebhook(success(inv, { test_mode: '1', utoken: 'ut-test' }))).resolves.toBe('OK');

    const after = w.invoices.get(inv.id)!;
    expect(after.status).toBe('FAILED');
    expect(after.failedAt).toBeInstanceOf(Date);
    expect(after.description).toBe(`RanksUp Pro — monthly ($349 @ 40) — ${TEST_PAYMENT_FAILURE_CODE}: ${TEST_PAYMENT_FAILURE_REASON}`);
    expect(w.activations()).toHaveLength(0);
    expect(w.users.get(CUSTOMER)).toMatchObject({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', paytrUtoken: null, autoRenew: false });
    expect(w.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(w.affiliate.recordCommission).not.toHaveBeenCalled();
    expect(w.email.send).not.toHaveBeenCalled();
    expect(String(logError.mock.calls[0]?.[0])).toContain('plan AÇILMADI');
  });

  it('PayTR test_mode alanini gondermese de bizim bayragimiz yeter', async () => {
    const w = world('1');
    vi.spyOn((w.svc as any).log, 'error').mockImplementation(() => undefined);
    const inv = w.pendingInvoice(CUSTOMER);
    await w.svc.handleWebhook(success(inv));
    expect(w.invoices.get(inv.id)!.status).toBe('FAILED');
    expect(w.activations()).toHaveLength(0);
  });

  it('tekrar bildirim ve sonradan canliya gecis faturayi PAID yapamaz (FAILED kalicidir)', async () => {
    const w = world('1');
    const logError = vi.spyOn((w.svc as any).log, 'error').mockImplementation(() => undefined);
    const inv = w.pendingInvoice(CUSTOMER, { storeCard: true });
    const payload = success(inv, { test_mode: '1', utoken: 'ut-test' });
    await w.svc.handleWebhook(payload);
    await w.svc.handleWebhook(payload); // PayTR ayni bildirimi yeniden gonderebilir
    expect(logError).toHaveBeenCalledTimes(1); // gecis bir kez olur, tekrar sessiz

    // Operator PAYTR_TEST_MODE=0 yapti; gecikmis tekrar ve dogrudan onay denemesi
    const live = w.service('0');
    await expect(live.handleWebhook(payload)).resolves.toBe('OK');
    await expect(live.markInvoicePaid(inv.id)).resolves.toBe(false);

    expect(w.invoices.get(inv.id)!.status).toBe('FAILED');
    expect(w.activations()).toHaveLength(0);
    expect(w.users.get(CUSTOMER)).toMatchObject({ plan: 'TRIAL', paytrUtoken: null, autoRenew: false });
    expect(w.affiliate.recordCommission).not.toHaveBeenCalled();
  });

  it('PAYTR_TEST_MODE=0 iken PayTR bildirimde test_mode=1 diyorsa (magaza henuz canliya alinmamis) yine plan acilmaz', async () => {
    const w = world('0');
    vi.spyOn((w.svc as any).log, 'error').mockImplementation(() => undefined);
    const inv = w.pendingInvoice(CUSTOMER);
    await w.svc.handleWebhook(success(inv, { test_mode: '1' }));
    expect(w.invoices.get(inv.id)!.status).toBe('FAILED');
    expect(w.activations()).toHaveLength(0);
  });

  it('PAYTR_TEST_MODE=0 + bildirimde test_mode=1: yonetici canliya alinmamis magazada akisi yine dener', async () => {
    const w = world('0');
    const inv = w.pendingInvoice(ADMIN);
    await w.svc.handleWebhook(success(inv, { test_mode: '1' }));
    expect(w.invoices.get(inv.id)!.status).toBe('PAID');
    expect(w.activations()).toHaveLength(1);
  });

  it('canli modda odenmis (gercek) fatura test moduna donulunce bozulmaz: tekrar bildirim FAILED yazmaz', async () => {
    const w = world('1');
    const inv = w.pendingInvoice(CUSTOMER, { status: 'PAID', paidAt: new Date() });
    await expect(w.svc.markInvoicePaid(inv.id)).resolves.toBe(false);
    await expect(w.svc.handleWebhook(success(inv))).resolves.toBe('OK');
    expect(w.invoices.get(inv.id)!.status).toBe('PAID');
    expect(w.activations()).toHaveLength(0);
  });

  it('yonetici hesabinin test odemesi plani acar ve karti saklar (canliya gecis oncesi uctan uca deneme)', async () => {
    const w = world('1');
    w.users.get(ADMIN)!.plan = 'STARTER';
    const inv = w.pendingInvoice(ADMIN, { storeCard: true });
    await w.svc.handleWebhook(success(inv, { test_mode: '1', utoken: 'ut-admin' }));
    expect(w.invoices.get(inv.id)!.status).toBe('PAID');
    expect(w.users.get(ADMIN)).toMatchObject({ plan: 'PRO', subscriptionStatus: 'ACTIVE', paytrUtoken: 'ut-admin', autoRenew: true });
  });

  it('canli odeme (PAYTR_TEST_MODE=0, test_mode yok) eskisi gibi: PAID + plan + komisyon + e-posta, rol sorgusu yok', async () => {
    const w = world('0');
    const inv = w.pendingInvoice(CUSTOMER, { storeCard: true });
    await expect(w.svc.handleWebhook(success(inv, { utoken: 'ut-live' }))).resolves.toBe('OK');
    expect(w.invoices.get(inv.id)!.status).toBe('PAID');
    expect(w.users.get(CUSTOMER)).toMatchObject({ plan: 'PRO', subscriptionStatus: 'ACTIVE', paytrUtoken: 'ut-live', autoRenew: true });
    expect(w.affiliate.recordCommission).toHaveBeenCalledTimes(1);
    expect(w.email.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'plan_upgraded' }));
    expect(w.roleLookups()).toHaveLength(0);
  });

  it('kalici silinmis hesabin (userId NULL) test odemesi PAID sayilmaz (canli modda para tahsil edildigi icin PAID olur)', async () => {
    const w = world('1');
    vi.spyOn((w.svc as any).log, 'error').mockImplementation(() => undefined);
    const inv = w.pendingInvoice(null);
    await w.svc.handleWebhook(success(inv, { test_mode: '1' }));
    expect(w.invoices.get(inv.id)!.status).toBe('FAILED');
    expect(w.prisma.user.update).not.toHaveBeenCalled();
  });

  it('basarisiz bildirim test modunda da eski yoldan gider (FAILED + PayTR nedeni + e-posta)', async () => {
    const w = world('1');
    vi.spyOn((w.svc as any).log, 'warn').mockImplementation(() => undefined);
    const inv = w.pendingInvoice(CUSTOMER);
    await w.svc.handleWebhook(signed({
      merchant_oid: inv.paytrTransactionId, status: 'failed', total_amount: '1396000',
      failed_reason_code: '6', failed_reason_msg: 'Müşteri ödemeden vazgeçti', test_mode: '1',
    }));
    expect(w.invoices.get(inv.id)!.description).toContain('— 6: Müşteri ödemeden vazgeçti');
    expect(w.email.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'payment_failed' }));
  });
});

describe('markInvoicePaid savunma derinligi (bildirim disi yollar)', () => {
  it('test modunda yonetici olmayan hesabin faturasi: false, FAILED, plan acilmaz', async () => {
    const w = world('1');
    vi.spyOn((w.svc as any).log, 'error').mockImplementation(() => undefined);
    const inv = w.pendingInvoice(CUSTOMER);
    await expect(w.svc.markInvoicePaid(inv.id)).resolves.toBe(false);
    expect(w.invoices.get(inv.id)!.status).toBe('FAILED');
    expect(w.activations()).toHaveLength(0);
  });

  it('yenileme faturasi: yenileme sayaci artmaz, "yenileme basarisiz" e-postasi gitmez, plan dusmez', async () => {
    const w = world('1');
    vi.spyOn((w.svc as any).log, 'error').mockImplementation(() => undefined);
    Object.assign(w.users.get(CUSTOMER)!, { plan: 'PRO', subscriptionStatus: 'ACTIVE', renewalFailCount: 2 });
    const inv = w.pendingInvoice(CUSTOMER, { isRenewal: true });
    await expect(w.svc.markInvoicePaid(inv.id)).resolves.toBe(false);
    expect(w.invoices.get(inv.id)!.status).toBe('FAILED');
    expect(w.users.get(CUSTOMER)).toMatchObject({ plan: 'PRO', subscriptionStatus: 'ACTIVE', renewalFailCount: 2 });
    expect(w.prisma.user.update).not.toHaveBeenCalled();
    expect(w.email.send).not.toHaveBeenCalled();
  });

  it('isaret yalniz daha siki karar verir: canli modda providerTestMode verilmezse eski yol', async () => {
    const w = world('0');
    const inv = w.pendingInvoice(CUSTOMER);
    await expect(w.svc.markInvoicePaid(inv.id)).resolves.toBe(true);
    expect(w.activations()).toHaveLength(1);
    expect(w.prisma.invoice.findUnique).not.toHaveBeenCalled();

    const w2 = world('0');
    vi.spyOn((w2.svc as any).log, 'error').mockImplementation(() => undefined);
    const inv2 = w2.pendingInvoice(CUSTOMER);
    await expect(w2.svc.markInvoicePaid(inv2.id, { providerTestMode: true })).resolves.toBe(false);
    expect(w2.invoices.get(inv2.id)!.status).toBe('FAILED');
  });
});

describe('kayitli karttan yenileme cekimi', () => {
  it('test modunda denenmez: skipped (deneme sayilmaz), fatura acilmaz, PayTR\'ye istek gitmez', async () => {
    const w = world('1');
    vi.spyOn((w.svc as any).log, 'error').mockImplementation(() => undefined);
    Object.assign(w.users.get(CUSTOMER)!, { plan: 'PRO', subscriptionStatus: 'ACTIVE', paytrUtoken: 'ut-1', autoRenew: true });
    await expect(w.svc.chargeStoredCard(CUSTOMER)).resolves.toEqual({ result: 'skipped', reason: 'PayTR test modunda; gerçek tahsilat yapılamaz' });
    expect(w.prisma.invoice.create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(w.users.get(CUSTOMER)!.renewalFailCount).toBe(0);
  });

  it('canli modda eski yol calisir (kart listesi istenir, kart yoksa fatura FAILED)', async () => {
    const w = world('0');
    vi.spyOn((w.svc as any).log, 'warn').mockImplementation(() => undefined);
    Object.assign(w.users.get(CUSTOMER)!, { plan: 'PRO', subscriptionStatus: 'ACTIVE', paytrUtoken: 'ut-1', autoRenew: true });
    fetchMock.mockImplementation(async () => ({ json: async () => [] }));
    await expect(w.svc.chargeStoredCard(CUSTOMER)).resolves.toEqual({ result: 'failed', reason: 'Kayıtlı kart bulunamadı' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.paytr.com/odeme/capi/list');
    expect([...w.invoices.values()]).toEqual([expect.objectContaining({ isRenewal: true, status: 'FAILED' })]);
  });
});

describe('checkoutStatus — panel ve fiyat sayfasinin okudugu alan', () => {
  it('test modunda: anonim ve musteri kapali (TR/EN metin), yonetici acik', async () => {
    const w = world('1');
    await expect(w.svc.checkoutStatus(null)).resolves.toEqual({ open: false, testMode: true, message: CHECKOUT_TEST_MODE_MESSAGE });
    await expect(w.svc.checkoutStatus(null, 'en')).resolves.toEqual({ open: false, testMode: true, message: CHECKOUT_TEST_MODE_MESSAGE_EN });
    await expect(w.svc.checkoutStatus(CUSTOMER)).resolves.toEqual({ open: false, testMode: true, message: CHECKOUT_TEST_MODE_MESSAGE });
    await expect(w.svc.checkoutStatus('yok-boyle-biri')).resolves.toMatchObject({ open: false });
    await expect(w.svc.checkoutStatus(ADMIN)).resolves.toEqual({ open: true, testMode: true, message: null });
  });

  it('canli modda herkese acik, veritabanina gitmez', async () => {
    const w = world('0');
    for (const who of [null, CUSTOMER, ADMIN]) {
      await expect(w.svc.checkoutStatus(who)).resolves.toEqual({ open: true, testMode: false, message: null });
    }
    expect(w.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('gizli bilgi tasimaz (anahtar, tuz, magaza no yok)', async () => {
    const w = world('1');
    const s = await w.svc.checkoutStatus(null);
    expect(Object.keys(s).sort()).toEqual(['message', 'open', 'testMode']);
    const json = JSON.stringify(s);
    for (const secret of [KEY, SALT, 'test-merchant-id']) expect(json).not.toContain(secret);
  });
});

describe('BillingController — GET alanlari ve odeme ucu gercek servisle', () => {
  const req = (userId: string, role: string) => ({ user: { id: userId, role }, headers: {}, socket: { remoteAddress: '127.0.0.1' } });

  function controller(w: ReturnType<typeof world>) {
    const billing = {
      getPlansWithFx: vi.fn(async () => ({ plans: [{ id: 'pro' }], fx: { rate: 40 } })),
      getCurrentPlan: vi.fn(async (userId: string) => ({ plan: { id: 'trial' }, status: 'TRIAL', userId })),
    };
    return { ctrl: new BillingController(billing as never, w.svc, {} as never, {} as never), billing };
  }

  it('GET /billing/plans: plan listesi + fx + anonim checkout (locale\'e gore metin)', async () => {
    const w = world('1');
    const { ctrl, billing } = controller(w);
    await expect(ctrl.plans()).resolves.toEqual({
      plans: [{ id: 'pro' }], fx: { rate: 40 }, checkout: { open: false, testMode: true, message: CHECKOUT_TEST_MODE_MESSAGE },
    });
    expect((await ctrl.plans('en')).checkout.message).toBe(CHECKOUT_TEST_MODE_MESSAGE_EN);
    expect(billing.getPlansWithFx).toHaveBeenLastCalledWith('en');
    expect((await controller(world('0')).ctrl.plans()).checkout).toEqual({ open: true, testMode: false, message: null });
  });

  it('GET /billing/users/:id/current: checkout istenen hesaba gore (yonetici musteriye bakarsa musterinin durumu)', async () => {
    const w = world('1');
    const { ctrl } = controller(w);
    expect((await ctrl.current(req(CUSTOMER, 'USER') as never, CUSTOMER)).checkout.open).toBe(false);
    expect((await ctrl.current(req(ADMIN, 'ADMIN') as never, ADMIN)).checkout.open).toBe(true);
    const viewed = await ctrl.current(req(ADMIN, 'ADMIN') as never, CUSTOMER);
    expect(viewed).toMatchObject({ status: 'TRIAL', userId: CUSTOMER, checkout: { open: false, message: CHECKOUT_TEST_MODE_MESSAGE } });
  });

  it('POST /billing/subscribe: musteri 403 metni alir, yonetici odeme sayfasini; yonetici musteri adina baslatamaz', async () => {
    const w = world('1');
    vi.spyOn((w.svc as any).log, 'warn').mockImplementation(() => undefined);
    const { ctrl } = controller(w);
    const body = (userId: string) => ({ userId, planId: 'pro' as const, cycle: 'monthly' as const, userEmail: 'a@b.co', userName: 'A' });

    const { body: res } = await rejection(ctrl.subscribe(req(CUSTOMER, 'USER') as never, body(CUSTOMER)));
    expect(res).toMatchObject({ statusCode: 403, message: CHECKOUT_TEST_MODE_MESSAGE });
    const { err } = await rejection(ctrl.subscribe(req(ADMIN, 'ADMIN') as never, body(CUSTOMER)));
    expect(err).toBeInstanceOf(ForbiddenException);
    await expect(ctrl.subscribe(req(ADMIN, 'ADMIN') as never, body(ADMIN))).resolves.toMatchObject({ mode: 'iframe' });
    expect([...w.invoices.values()].map((i) => i.userId)).toEqual([ADMIN]);
  });
});
