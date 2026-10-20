import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaytrService } from './paytr.service.js';

/**
 * Bildirim tekrari guvenligi. PayTR "OK" alamazsa ayni bildirimi yeniden
 * gonderir; eskiden her tekrar plani yeniden etkinlestirip ortaklik
 * komisyonunu bir kez daha yaziyordu.
 *
 * CANLI mod (PAYTR_TEST_MODE=0) davranisi: degisken tanimsizken servis test
 * modunda kurulur ('1' varsayilan) ve test odemesi yonetici olmayan hesapta
 * plan acmaz (paytr-test-mode.spec.ts). Servis env'i kurulurken okur; bu
 * yuzden stub, makeService'ten ONCE calisan ust duzey beforeEach'te.
 */
beforeEach(() => { vi.stubEnv('PAYTR_TEST_MODE', '0'); });
afterEach(() => { vi.unstubAllEnvs(); });

function makeService() {
  const invoices: Record<string, any> = {
    inv1: { id: 'inv1', userId: 'u1', status: 'PENDING', amount: 1000, isRenewal: false, storeCard: false, paytrTransactionId: 'LUVIabcdefghPRO1700000000000', description: 'RanksUp Pro — monthly' },
    inv2: { id: 'inv2', userId: 'u1', status: 'PENDING', amount: 1000, isRenewal: true, storeCard: false, paytrTransactionId: 'LUVIabcdefghPRO1700000000001', description: 'RanksUp Pro — monthly yenileme' },
  };
  const user = { id: 'u1', email: 'a@b.c', name: 'A', plan: 'PRO', renewalFailCount: 0 };
  const prisma: any = {
    invoice: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const inv = invoices[where.id];
        if (!inv || inv.status !== where.status) return { count: 0 };
        Object.assign(inv, data);
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }: any) => invoices[where.id] ?? Object.values(invoices).find((i: any) => i.paytrTransactionId === where.paytrTransactionId) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => invoices[where.id]),
    },
    user: {
      update: vi.fn(async ({ data }: any) => {
        if (data.renewalFailCount?.increment) user.renewalFailCount += data.renewalFailCount.increment;
        if (data.plan) user.plan = data.plan;
        return { ...user };
      }),
      findUnique: vi.fn(async () => ({ ...user })),
      findUniqueOrThrow: vi.fn(async () => ({ ...user })),
    },
  };
  const affiliate: any = { recordCommission: vi.fn(async () => {}) };
  const email: any = { send: vi.fn(async () => {}) };
  const svc = new PaytrService(prisma, affiliate, email, {} as any);
  return { svc, prisma, affiliate, email, invoices, user };
}

describe('odeme bildirimi tekrar guvenligi', () => {
  let t: ReturnType<typeof makeService>;
  beforeEach(() => { t = makeService(); });

  it('ayni fatura iki kez odendi isaretlenirse plan ve komisyon bir kez islenir', async () => {
    expect(await t.svc.markInvoicePaid('inv1')).toBe(true);
    expect(await t.svc.markInvoicePaid('inv1')).toBe(false);
    expect(t.affiliate.recordCommission).toHaveBeenCalledTimes(1);
    const activations = t.prisma.user.update.mock.calls.filter((c: any[]) => c[0].data.subscriptionStatus === 'ACTIVE');
    expect(activations).toHaveLength(1);
  });

  it('odenmis faturaya sonradan gelen basarisiz bildirim durumu bozmaz', async () => {
    await t.svc.markInvoicePaid('inv1');
    expect(await t.svc.markInvoiceFailed('inv1', 'X', 'gec gelen')).toBe(false);
    expect(t.invoices.inv1.status).toBe('PAID');
  });

  it('yenileme faturasi basarisizsa sayac artar; tekrar bildirim sayaci iki kez artirmaz', async () => {
    expect(await t.svc.markInvoiceFailed('inv2', '51', 'Yetersiz bakiye')).toBe(true);
    expect(await t.svc.markInvoiceFailed('inv2', '51', 'Yetersiz bakiye')).toBe(false);
    expect(t.user.renewalFailCount).toBe(1);
    expect(t.email.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'renewal_failed' }));
  });

  it('ucuncu basarisiz yenilemede plan deneme duzeyine duser', async () => {
    t.user.renewalFailCount = 2;
    await t.svc.markInvoiceFailed('inv2', '51', 'Yetersiz bakiye');
    expect(t.user.plan).toBe('TRIAL');
    expect(t.email.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'subscription_expired' }));
  });
});
