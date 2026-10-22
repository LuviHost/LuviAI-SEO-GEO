import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PaytrService } from './paytr.service.js';
import { QuotaService } from './quota.service.js';
import { findPlan } from './plans.js';

/**
 * Odeme sonrasi plan etkinlestirme ve aylik makale sayaci.
 *
 * NEDEN VAR: activateSubscription her basarili odemede (yenileme dahil)
 * articlesUsedThisMonth'u sifirliyordu; QuotaService ise takvim ayi basinda
 * sifirliyor. Ayin 15'inde yenileyen Baslangic (15 makale) musterisi ayda 30
 * makale uretebiliyordu; SSS, yardim ve sozluk sayacin her takvim ayinin
 * basinda sifirlandigini soyluyor. Sayac artik yalniz GERCEK plan degisiminde
 * sifirlanir.
 */
type Row = Record<string, any>;

/** Yerel saatle gun ortasi: QuotaService ay sinirini sunucunun yerel saatiyle hesaplar */
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in v) row[k] = (row[k] ?? 0) + (v as any).increment;
    else row[k] = v;
  }
}

let seq = 0;
function world(userInit: Row, opts: { jobs?: any } = {}) {
  const user: Row = {
    id: 'u1', email: 'a@b.co', name: 'A', deletionRequestedAt: null, renewalFailCount: 0,
    videosUsedThisMonth: 0, aiCostThisMonthUsd: 0,
    _count: { sites: 0 }, // checkSiteQuota'nin include'u
    ...userInit,
  };
  const invoices = new Map<string, Row>();
  const prisma: any = {
    // Deneme: uretim icin sitede aktif yayin hedefi sarti (trial-policy.ts); burada bagli
    publishTarget: { findMany: async () => [{ type: 'WORDPRESS_REST', isActive: true }] },
    invoice: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const inv = invoices.get(where.id);
        if (!inv || inv.status !== where.status) return { count: 0 };
        Object.assign(inv, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ ...invoices.get(where.id) })),
    },
    user: {
      findUnique: vi.fn(async () => ({ ...user })),
      findUniqueOrThrow: vi.fn(async () => ({ ...user })),
      update: vi.fn(async ({ data }: any) => { apply(user, data); return { ...user }; }),
      // QuotaService consumeArticleAllowance: tek kosullu UPDATE (articlesUsedThisMonth < hak)
      updateMany: vi.fn(async ({ where, data }: any) => {
        const c = where.articlesUsedThisMonth ?? {};
        if (c.lt !== undefined && !(user.articlesUsedThisMonth < c.lt)) return { count: 0 };
        if (c.gt !== undefined && !(user.articlesUsedThisMonth > c.gt)) return { count: 0 };
        const d = data.articlesUsedThisMonth;
        user.articlesUsedThisMonth += typeof d?.increment === 'number' ? d.increment : -(d?.decrement ?? 0);
        return { count: 1 };
      }),
    },
  };
  const email: any = { send: vi.fn(async () => ({ ok: true })) };
  const paytr = new PaytrService(prisma, { recordCommission: vi.fn(async () => {}) } as any, email, {} as any, opts.jobs);
  const quota = new QuotaService(prisma);

  /** Odenmis fatura (plan kodu: STA | PRO | AGE) */
  async function pay(planCode: 'STA' | 'PRO' | 'AGE', isRenewal: boolean) {
    const id = `inv${++seq}`;
    invoices.set(id, {
      id, userId: 'u1', status: 'PENDING', amount: 1499, isRenewal, storeCard: false,
      paytrTransactionId: `LUVIabcdefgh${planCode}${1700000000000 + seq}`, description: 'RanksUp — monthly',
    });
    expect(await paytr.markInvoicePaid(id)).toBe(true);
  }

  /** ArticlesService ile ayni kapi (consumeArticleAllowance); engellenene kadar uretir */
  async function generateUntilBlocked(max = 100): Promise<number> {
    let n = 0;
    for (; n < max; n++) {
      try { await quota.consumeArticleAllowance('u1', 's1'); } catch (err) {
        if (err instanceof ForbiddenException) break;
        throw err;
      }
    }
    return n;
  }

  return { user, prisma, email, paytr, quota, pay, generateUntilBlocked };
}

/** activateSubscription'in yazdigi veri (ACTIVE yazan update cagrisi) */
function activationData(prisma: any): Row {
  const call = prisma.user.update.mock.calls.find((c: any[]) => c[0].data.subscriptionStatus === 'ACTIVE');
  expect(call, 'plan etkinlestirilmedi').toBeTruthy();
  return call[0].data;
}

// CANLI mod (PAYTR_TEST_MODE=0): degisken tanimsizken servis test modunda
// kurulur ve test odemesi yonetici olmayan hesapta plan acmaz
// (paytr-test-mode.spec.ts). Servis env'i kurulurken okur — world() test icinde.
beforeEach(() => { vi.stubEnv('PAYTR_TEST_MODE', '0'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('activateSubscription — sayac yalniz gercek plan degisiminde sifirlanir', () => {
  const thisMonth = () => new Date(Date.now() - 60_000);

  it('ayni planin otomatik yenilemesi sayaca ve ay isaretcisine dokunmaz', async () => {
    const reset = thisMonth();
    const w = world({ plan: 'PRO', subscriptionStatus: 'ACTIVE', articlesUsedThisMonth: 37, articlesQuotaResetAt: reset });
    await w.pay('PRO', true);
    const data = activationData(w.prisma);
    expect(data).not.toHaveProperty('articlesUsedThisMonth');
    expect(data).not.toHaveProperty('articlesQuotaResetAt');
    expect(w.user.articlesUsedThisMonth).toBe(37);
    expect(w.user.articlesQuotaResetAt).toBe(reset);
    // Yenileme sayaclari yine sifirlanir, plan acik kalir
    expect(data).toMatchObject({ plan: 'PRO', subscriptionStatus: 'ACTIVE', renewalFailCount: 0, renewalLastAttemptAt: null, renewalNoticeAt: null });
  });

  it('ayni planin elle yeniden satin alinmasi (isRenewal=false, otomatik yenileme kapaliyken canli yol) sifirlamaz', async () => {
    const w = world({ plan: 'STARTER', subscriptionStatus: 'ACTIVE', articlesUsedThisMonth: 15, articlesQuotaResetAt: thisMonth() });
    await w.pay('STA', false);
    expect(activationData(w.prisma)).not.toHaveProperty('articlesUsedThisMonth');
    expect(w.user.articlesUsedThisMonth).toBe(15);
  });

  it('PAST_DUE ya da CANCELED ayni plan odemesi de sifirlamaz', async () => {
    for (const subscriptionStatus of ['PAST_DUE', 'CANCELED']) {
      const w = world({ plan: 'PRO', subscriptionStatus, articlesUsedThisMonth: 12, articlesQuotaResetAt: thisMonth() });
      await w.pay('PRO', subscriptionStatus === 'PAST_DUE');
      expect(w.user.articlesUsedThisMonth, subscriptionStatus).toBe(12);
      expect(w.user.subscriptionStatus).toBe('ACTIVE');
    }
  });

  it('denemeden (TRIAL) ucretli plana gecis sifirlar', async () => {
    const w = world({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', articlesUsedThisMonth: 2, articlesQuotaResetAt: thisMonth() });
    await w.pay('STA', false);
    expect(w.user.articlesUsedThisMonth).toBe(0);
    expect(w.user.plan).toBe('STARTER');
  });

  it('suresi dolmus (EXPIRED) hesap ayni plani yeniden alirsa sifirlar', async () => {
    // Odeme alinamayip duserken plan TRIAL'a iner; eski kayitlarda plan kalmis olabilir
    for (const plan of ['TRIAL', 'PRO']) {
      const w = world({ plan, subscriptionStatus: 'EXPIRED', articlesUsedThisMonth: 9, articlesQuotaResetAt: thisMonth() });
      await w.pay('PRO', false);
      expect(w.user.articlesUsedThisMonth, plan).toBe(0);
    }
  });

  it('plan degisimi (yukseltme) sifirlar', async () => {
    const w = world({ plan: 'STARTER', subscriptionStatus: 'ACTIVE', articlesUsedThisMonth: 15, articlesQuotaResetAt: thisMonth() });
    await w.pay('PRO', false);
    expect(w.user.articlesUsedThisMonth).toBe(0);
    expect(w.user.plan).toBe('PRO');
  });

  it('isaretci onceki aydaysa plan degisimi bekleyen takvim sifirlamasini da yapar (video + AI maliyeti yutulmaz)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(local(2026, 11, 5));
    const w = world({
      plan: 'TRIAL', subscriptionStatus: 'TRIAL', articlesUsedThisMonth: 2,
      articlesQuotaResetAt: local(2026, 9, 10), videosUsedThisMonth: 1, aiCostThisMonthUsd: 2.9,
    });
    await w.pay('PRO', false);
    expect(w.user).toMatchObject({ articlesUsedThisMonth: 0, videosUsedThisMonth: 0, aiCostThisMonthUsd: 0 });
    expect(w.user.articlesQuotaResetAt).toEqual(local(2026, 11, 5));
    expect((await w.quota.checkAiCostBudget('u1')).used).toBe(0);
  });

  it('isaretci bu aydaysa plan degisimi yalniz makale sayacini sifirlar (bu ayin harcamasi korunur)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(local(2026, 11, 20));
    const w = world({
      plan: 'STARTER', subscriptionStatus: 'ACTIVE', articlesUsedThisMonth: 15,
      articlesQuotaResetAt: local(2026, 11, 1), videosUsedThisMonth: 1, aiCostThisMonthUsd: 4.5,
    });
    await w.pay('PRO', false);
    expect(w.user).toMatchObject({ articlesUsedThisMonth: 0, videosUsedThisMonth: 1, aiCostThisMonthUsd: 4.5 });
  });
});

describe('takvim ayi tek donem: ay ortasi yenileme ikinci kota vermez', () => {
  it('her ayin 14\'unde yenileyen Baslangic musterisi Kasim\'da 15 makale uretir (eskiden 30)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const limit = findPlan('starter')!.articlesPerMonth;
    vi.setSystemTime(local(2026, 11, 1));
    const w = world({ plan: 'STARTER', subscriptionStatus: 'ACTIVE', articlesUsedThisMonth: limit, articlesQuotaResetAt: local(2026, 10, 15) });

    let november = await w.generateUntilBlocked(); // 1 Kasim: takvim sifirlamasi
    expect(november).toBe(limit);

    vi.setSystemTime(local(2026, 11, 14));
    await w.pay('STA', true); // otomatik yenileme
    november += await w.generateUntilBlocked();
    vi.setSystemTime(local(2026, 11, 20));
    await w.pay('STA', false); // ayni plani elle yeniden alma
    november += await w.generateUntilBlocked();
    expect(november).toBe(limit);

    vi.setSystemTime(local(2026, 12, 1));
    expect(await w.generateUntilBlocked()).toBe(limit);
  });
});

describe('plan_upgraded e-postasi gercek kotayi soyler', () => {
  it('sayilar plans.ts\'ten ve uygulanan kota ile ayni (eskiden Pro icin "50 makale, 3 site")', async () => {
    for (const [code, id, plan] of [['STA', 'starter', 'STARTER'], ['PRO', 'pro', 'PRO'], ['AGE', 'agency', 'AGENCY']] as const) {
      const w = world({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date() });
      await w.pay(code, false);
      const mail = w.email.send.mock.calls.find((c: any[]) => c[0].template === 'plan_upgraded')?.[0];
      expect(mail, id).toBeTruthy();
      expect(mail.data.articleQuota).toBe(findPlan(id)!.articlesPerMonth);
      expect(mail.data.siteQuota).toBe(findPlan(id)!.sites);
      // E-postadaki sayi kota kapisinin uyguladigi sinirla ayni
      expect(w.user.plan).toBe(plan);
      expect((await w.quota.checkArticleQuota('u1')).limit).toBe(mail.data.articleQuota);
      expect((await w.quota.checkSiteQuota('u1')).limit).toBe(mail.data.siteQuota);
    }
  });

  it('yenilemede plan_upgraded gitmez', async () => {
    const w = world({ plan: 'PRO', subscriptionStatus: 'ACTIVE', articlesUsedThisMonth: 3, articlesQuotaResetAt: new Date() });
    await w.pay('PRO', true);
    expect(w.email.send).not.toHaveBeenCalled();
  });
});

/**
 * Plan yukseltme sonrasi takvim (sahip karari 20.10.2026): deneme hesabinin hakki asan
 * takvim yazilari SCHEDULED bekler (panelde kilitli). Plan acilinca o kullanicinin
 * taramasi hemen kuyruga atilir ki vadesi gecmis yazilar yeni hak yettigince uretilsin;
 * kuyruk hatasi plan etkinlestirmesini bozmaz.
 */
describe('plan yukseltme → bekleyen takvim yazilari icin kullanici taramasi', () => {
  const jobsFake = () => ({ enqueue: vi.fn<(o: any) => Promise<{ dbJobId: string; bullJobId: string }>>(async () => ({ dbJobId: 'j1', bullJobId: '1' })) });

  it('denemeden ucretli plana gecis: PROCESS_SCHEDULED yalniz bu kullanici icin kuyruga girer', async () => {
    const jobs = jobsFake();
    const w = world({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', articlesUsedThisMonth: 2, articlesQuotaResetAt: new Date() }, { jobs });
    await w.pay('PRO', false);
    expect(w.user.plan).toBe('PRO');
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobs.enqueue.mock.calls[0][0]).toEqual({ type: 'PROCESS_SCHEDULED', userId: 'u1', payload: { userId: 'u1', reason: 'plan_upgrade' } });
  });

  it('kuyruk hata verse de plan acilir ve odeme bildirimi basarili doner', async () => {
    const jobs = jobsFake();
    jobs.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    const w = world({ plan: 'TRIAL', subscriptionStatus: 'EXPIRED', articlesUsedThisMonth: 2, articlesQuotaResetAt: new Date() }, { jobs });
    await w.pay('STA', false);
    expect(w.user.plan).toBe('STARTER');
    expect(w.user.subscriptionStatus).toBe('ACTIVE');
  });

  it('ayni planin yenilemesi tarama atmaz (hak degismedi)', async () => {
    const jobs = jobsFake();
    const w = world({ plan: 'PRO', subscriptionStatus: 'ACTIVE', articlesUsedThisMonth: 3, articlesQuotaResetAt: new Date() }, { jobs });
    await w.pay('PRO', true);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});
