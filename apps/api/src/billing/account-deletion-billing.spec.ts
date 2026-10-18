import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { PaytrService } from './paytr.service.js';

/**
 * Hesap silme ile odeme akisi: silme talebinden sonra gec gelen PayTR bildirimi
 * aboneligi YENIDEN ACMAMALI, otomatik yenilemeyi geri getirmemeli ve kalici
 * silinmis (userId NULL) faturada patlamamali.
 *
 * Kimlik bilgileri test icinde sabitlenir: PaytrService anahtar/tuzu kurulurken
 * process.env'den okur. Eskiden test bos anahtarla imzaliyordu — yalniz PayTR
 * kimlik bilgisi olmayan makinede geciyordu ve servisin bos anahtari kabul
 * etmesine (herkese acik uc icin acik kapi) dayaniyordu.
 */
const KEY = 'test-merchant-key';
const SALT = 'test-merchant-salt';

/** PayTR bildirim imzasi: base64(HMAC-SHA256(anahtar, merchant_oid + tuz + status + total_amount)) */
function sign(payload: Record<string, string>, key = KEY, salt = SALT): string {
  return createHmac('sha256', key).update(`${payload.merchant_oid}${salt}${payload.status}${payload.total_amount}`).digest('base64');
}

beforeEach(() => {
  vi.stubEnv('PAYTR_MERCHANT_KEY', KEY);
  vi.stubEnv('PAYTR_MERCHANT_SALT', SALT);
});
afterEach(() => { vi.unstubAllEnvs(); });

function make(opts: { deletionRequestedAt?: Date | null; invoiceUserId?: string | null; isRenewal?: boolean; storeCard?: boolean } = {}) {
  const invoice: any = {
    id: 'inv1',
    userId: opts.invoiceUserId === undefined ? 'u1' : opts.invoiceUserId,
    status: 'PENDING',
    amount: 1499,
    isRenewal: !!opts.isRenewal,
    storeCard: !!opts.storeCard,
    paytrTransactionId: 'LUVIabcdefghPRO1700000000000',
    description: 'RanksUp Pro — monthly',
  };
  const user = { id: 'u1', email: 'a@b.co', name: 'A', plan: 'PRO', renewalFailCount: 0, deletionRequestedAt: opts.deletionRequestedAt ?? null };
  const prisma: any = {
    invoice: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== invoice.id || where.status !== invoice.status) return { count: 0 };
        Object.assign(invoice, data);
        return { count: 1 };
      }),
      findUnique: vi.fn(async () => ({ ...invoice })),
      findUniqueOrThrow: vi.fn(async () => ({ ...invoice })),
      findFirst: vi.fn(async () => null),
    },
    user: {
      update: vi.fn(async ({ data }: any) => ({ ...user, ...data })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      findUnique: vi.fn(async () => ({ ...user })),
      findUniqueOrThrow: vi.fn(async () => ({ ...user })),
    },
  };
  const affiliate: any = { recordCommission: vi.fn(async () => {}) };
  const email: any = { send: vi.fn(async () => ({ ok: true })) };
  const svc = new PaytrService(prisma, affiliate, email, {} as any);
  return { svc, prisma, affiliate, email, invoice };
}

describe('silme talebi sonrasi odeme bildirimi', () => {
  it('odeme tahsil edildiyse fatura PAID olur ama abonelik acilmaz, komisyon ve e-posta yok', async () => {
    const t = make({ deletionRequestedAt: new Date() });
    expect(await t.svc.markInvoicePaid('inv1')).toBe(true);
    expect(t.invoice.status).toBe('PAID');
    expect(t.prisma.user.update).not.toHaveBeenCalled();
    expect(t.affiliate.recordCommission).not.toHaveBeenCalled();
    expect(t.email.send).not.toHaveBeenCalled();
  });

  it('kalici silinmis hesabin (userId NULL) faturasi hata vermeden PAID olur', async () => {
    const t = make({ invoiceUserId: null });
    expect(await t.svc.markInvoicePaid('inv1')).toBe(true);
    expect(t.invoice.status).toBe('PAID');
    expect(t.prisma.user.update).not.toHaveBeenCalled();
  });

  it('kart saklama bildirimi silme talebi olan hesapta otomatik yenilemeyi geri acmaz', async () => {
    const t = make({ deletionRequestedAt: new Date(), storeCard: true });
    const payload: Record<string, string> = { merchant_oid: t.invoice.paytrTransactionId, status: 'success', total_amount: '149900', utoken: 'ut-1' };
    payload.hash = sign(payload);
    expect(await t.svc.handleWebhook(payload)).toBe('OK');
    expect(t.prisma.user.updateMany).toHaveBeenCalledTimes(1);
    const call = t.prisma.user.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'u1', deletionRequestedAt: null });
    expect(t.prisma.user.update).not.toHaveBeenCalled();
    // Fatura yine PAID (para tahsil edildi), abonelik acilmadi
    expect(t.invoice.status).toBe('PAID');
  });

  it('basarisiz odeme: silme talebi olan hesaba "odeme basarisiz" e-postasi gitmez', async () => {
    const t = make({ deletionRequestedAt: new Date() });
    expect(await t.svc.markInvoiceFailed('inv1', '51', 'Yetersiz bakiye')).toBe(true);
    expect(t.email.send).not.toHaveBeenCalled();
  });

  it('basarisiz yenileme iptal edilmis aboneligi PAST_DUE\'ya geri dondurmez', async () => {
    const t = make({ deletionRequestedAt: new Date(), isRenewal: true });
    await t.svc.markInvoiceFailed('inv1', '51', 'Yetersiz bakiye');
    expect(t.prisma.user.update).not.toHaveBeenCalled();
  });
});

/**
 * Webhook kapali basarisizlik: PAYTR_MERCHANT_KEY/SALT tanimsizken bildirim
 * islenmez. Bos anahtarla HMAC herkesce hesaplanir; eskiden boyle bir surecte
 * herkese acik POST /billing/webhooks/paytr'ye gelen sahte status=success
 * PENDING faturayi PAID yapip plani aciyordu.
 */
describe('PayTR bildirimi — kimlik bilgisi yoksa islenmez', () => {
  function forged(t: ReturnType<typeof make>, key = '', salt = '') {
    const payload: Record<string, string> = { merchant_oid: t.invoice.paytrTransactionId, status: 'success', total_amount: '149900' };
    payload.hash = sign(payload, key, salt);
    return payload;
  }

  it('anahtar ve tuz yoksa bos anahtarla imzalanmis sahte "success" faturayi PAID yapmaz, plan acilmaz', async () => {
    vi.stubEnv('PAYTR_MERCHANT_KEY', undefined);
    vi.stubEnv('PAYTR_MERCHANT_SALT', undefined);
    const t = make();
    const logError = vi.spyOn((t.svc as any).log, 'error').mockImplementation(() => undefined);
    expect(await t.svc.handleWebhook(forged(t))).toBe('OK');
    expect(t.invoice.status).toBe('PENDING');
    expect(t.prisma.invoice.updateMany).not.toHaveBeenCalled();
    expect(t.prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(t.prisma.user.update).not.toHaveBeenCalled();
    expect(String(logError.mock.calls[0]?.[0])).toContain('PAYTR_MERCHANT_KEY');
  });

  it('yalniz biri eksikse (bos dize dahil) de islenmez', async () => {
    for (const [key, salt] of [['', SALT], [KEY, ''], [KEY, undefined]] as const) {
      vi.stubEnv('PAYTR_MERCHANT_KEY', key);
      vi.stubEnv('PAYTR_MERCHANT_SALT', salt);
      const t = make();
      vi.spyOn((t.svc as any).log, 'error').mockImplementation(() => undefined);
      expect(await t.svc.handleWebhook(forged(t, key, salt ?? ''))).toBe('OK');
      expect(t.invoice.status, `${key}/${salt}`).toBe('PENDING');
    }
  });

  it('kimlik bilgisi varken: yanlis imza reddedilir, PayTR gibi imzalanmis bildirim islenir', async () => {
    const bad = make();
    vi.spyOn((bad.svc as any).log, 'error').mockImplementation(() => undefined);
    expect(await bad.svc.handleWebhook(forged(bad))).toBe('OK');
    expect(bad.invoice.status).toBe('PENDING');

    const good = make();
    const payload: Record<string, string> = { merchant_oid: good.invoice.paytrTransactionId, status: 'success', total_amount: '149900' };
    payload.hash = sign(payload);
    expect(await good.svc.handleWebhook(payload)).toBe('OK');
    expect(good.invoice.status).toBe('PAID');
    expect(good.prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ plan: 'PRO', subscriptionStatus: 'ACTIVE' }) }));
  });
});

describe('cancelSubscription secenekleri', () => {
  it('varsayilan davranis degismedi: iptal + e-posta', async () => {
    const t = make();
    await t.svc.cancelSubscription('u1');
    expect(t.prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { subscriptionStatus: 'CANCELED', autoRenew: false } }));
    expect(t.email.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'plan_canceled' }));
  });

  it('silme akisi: verilen transaction istemcisini kullanir, e-posta gondermez', async () => {
    const t = make();
    const tx: any = {
      user: { update: vi.fn(async ({ data }: any) => ({ id: 'u1', email: 'a@b.co', name: 'A', plan: 'PRO', ...data })) },
      invoice: { findFirst: vi.fn(async () => null) },
    };
    const r = await t.svc.cancelSubscription('u1', { notify: false, db: tx });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(t.prisma.user.update).not.toHaveBeenCalled();
    expect(t.email.send).not.toHaveBeenCalled();
    expect(r.status).toBe('CANCELED');
  });
});
