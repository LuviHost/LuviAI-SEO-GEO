import { describe, expect, it, vi } from 'vitest';
import { AdminService } from './admin.service.js';
import { BillingService } from '../billing/billing.service.js';
import { QuotaService } from '../billing/quota.service.js';

/**
 * G16 — panel ve mobil ozetindeki makale sayilari.
 *
 * NEDEN VAR: /me/dashboard (getMyDashboard) ve getCurrentPlan
 * User.articlesUsedThisMonth'u HAM okuyordu; ay basi sifirlamasi yalniz bir
 * kota kontrolu calistiginda olur. Ucretli musteri 1 Kasim'da paneli/mobil
 * uygulamayi acinca "Bu ay uretilen: 15" goruyordu (Ekim'in sayaci). Web paneli
 * de deneme hakkini '/1' diye sabit yaziyordu; gercek hak 2 ve API artik
 * { limit, remaining, used } donuyor. Gercek QuotaService kullanilir: kural
 * (limit + sifirlama) tek yerde kalir.
 */

const gecenAy = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - 1, 15, 12, 0, 0);
};

function db(user: Record<string, unknown>) {
  const row: Record<string, any> = { id: 'u1', role: 'USER', subscriptionStatus: 'ACTIVE', trialEndsAt: null, ...user };
  return {
    row,
    user: {
      findUnique: vi.fn(async () => ({ ...row })),
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return { ...row }; }),
    },
    site: { count: vi.fn(async () => 1) },
    article: { count: vi.fn(async () => 0) },
    invoice: { findFirst: vi.fn(async () => null) },
  };
}

describe('getMyDashboard — ay basi sifirlamasi uygulanmis kota', () => {
  it('ucretli plan, gecen ayin sayaci: 15 degil 0; kota { limit, remaining, used }', async () => {
    const prisma = db({ plan: 'STARTER', articlesUsedThisMonth: 15, articlesQuotaResetAt: gecenAy() });
    const svc = new AdminService(prisma as never, new QuotaService(prisma as never));
    const d = await svc.getMyDashboard('u1');
    expect(d.articlesUsedThisMonth).toBe(0); // eski mobil surumler de bu alani okur
    expect(d.articleQuota).toEqual({ limit: 15, remaining: 15, used: 0 });
    expect(prisma.row.articlesUsedThisMonth).toBe(0); // sifirlama kota kontroluyle ayni yazim
  });

  it('deneme hesabi: limit 2 (eski panel "/1" yaziyordu), ay basinda sifirlanmaz', async () => {
    const prisma = db({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', articlesUsedThisMonth: 1, articlesQuotaResetAt: gecenAy() });
    const d = await new AdminService(prisma as never, new QuotaService(prisma as never)).getMyDashboard('u1');
    expect(d.articleQuota).toEqual({ limit: 2, remaining: 1, used: 1 });
    expect(d.articlesUsedThisMonth).toBe(1);
  });

  it('limit asilmis sayac (plan dusurme) kalan hakki eksiye goturmez', async () => {
    const prisma = db({ plan: 'TRIAL', subscriptionStatus: 'EXPIRED', articlesUsedThisMonth: 9, articlesQuotaResetAt: new Date() });
    const d = await new AdminService(prisma as never, new QuotaService(prisma as never)).getMyDashboard('u1');
    expect(d.articleQuota).toEqual({ limit: 2, remaining: 0, used: 9 });
  });

  it('kota servisi yoksa ya da hata verirse ozet dusmez, kota alani null (sayi uydurulmaz)', async () => {
    const prisma = db({ plan: 'PRO', articlesUsedThisMonth: 3, articlesQuotaResetAt: new Date() });
    expect((await new AdminService(prisma as never).getMyDashboard('u1')).articleQuota).toBeNull();
    const bozuk = { checkArticleQuota: vi.fn(async () => { throw new Error('db yok'); }) };
    const d = await new AdminService(prisma as never, bozuk as never).getMyDashboard('u1');
    expect(d.articleQuota).toBeNull();
    expect(d.articlesUsedThisMonth).toBe(3);
  });
});

describe('getCurrentPlan — ayni kural', () => {
  it('gecen ayin sayaci yeni ayda donmez', async () => {
    const prisma = db({
      plan: 'PRO', articlesUsedThisMonth: 40, articlesQuotaResetAt: gecenAy(),
      autoRenew: false, paytrUtoken: null, renewalFailCount: 0,
    });
    const svc = new BillingService(prisma as never, { getRate: async () => ({ rate: 1 }) } as never, new QuotaService(prisma as never));
    const r = await svc.getCurrentPlan('u1');
    expect(r.articlesUsedThisMonth).toBe(0);
    expect(r.articleQuota).toEqual({ limit: 40, remaining: 40, used: 0 });
    expect(new Date(r.articlesQuotaResetAt).getMonth()).toBe(new Date().getMonth());
  });
});

describe('getCurrentPlan — deneme durumu (trialAccess, panel bandi/modali bunu okur)', () => {
  const svcFor = (user: Record<string, unknown>) => {
    const prisma = db({ articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date(), autoRenew: false, paytrUtoken: null, renewalFailCount: 0, ...user });
    return new BillingService(prisma as never, { getRate: async () => ({ rate: 1 }) } as never, new QuotaService(prisma as never));
  };
  it('suresi dolan deneme: satin alma acikken salt okunur, kapaliyken (ya da bilinmiyorsa) degil', async () => {
    const expired = { plan: 'TRIAL', subscriptionStatus: 'EXPIRED', trialEndsAt: new Date(Date.now() - 86_400_000) };
    expect((await svcFor(expired).getCurrentPlan('u1', { checkoutOpen: true })).trialAccess).toMatchObject({ phase: 'expired', readOnly: true });
    expect((await svcFor(expired).getCurrentPlan('u1', { checkoutOpen: false })).trialAccess).toMatchObject({ phase: 'expired', readOnly: false });
    expect((await svcFor(expired).getCurrentPlan('u1')).trialAccess).toMatchObject({ readOnly: false });
  });
  it('suren deneme: kalan gun', async () => {
    const r = await svcFor({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: new Date(Date.now() + 3.5 * 86_400_000) }).getCurrentPlan('u1', { checkoutOpen: false });
    expect(r.trialAccess).toMatchObject({ phase: 'trial', daysLeft: 4, readOnly: false });
  });
  it('inceleme: plani dusen eski musteri (PAID faturasi var): lapsed, kilit ve "deneme doldu" modali yok', async () => {
    const prisma = db({ articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date(), autoRenew: false, paytrUtoken: null, renewalFailCount: 0, plan: 'TRIAL', subscriptionStatus: 'EXPIRED', trialEndsAt: null });
    prisma.invoice.findFirst = vi.fn(async () => ({ paidAt: new Date('2026-08-01'), createdAt: new Date('2026-08-01'), description: 'RanksUp Pro — monthly' })) as any;
    const svc = new BillingService(prisma as never, { getRate: async () => ({ rate: 1 }) } as never, new QuotaService(prisma as never));
    expect((await svc.getCurrentPlan('u1', { checkoutOpen: true })).trialAccess).toEqual({ phase: 'lapsed', endsAt: null, daysLeft: null, checkoutOpen: true, readOnly: false });
  });
});
