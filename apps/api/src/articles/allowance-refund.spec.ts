import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { QuotaService } from '../billing/quota.service.js';
import { ArticlesService } from './articles.service.js';
import { ArticleSchedulerService } from './article-scheduler.service.js';
import {
  allowanceRefundDecision, failGenerationWithRefund, refundJobAllowanceCharge, settleUnstartedGeneration,
} from './allowance-refund.js';

/**
 * Basarisiz uretimin makale hakki iadesi (sahip karari 20.10.2026).
 *
 * Kural: uretim makale cikmadan biterse (FAILED) o denemenin dusulen hakki TAM BIR KEZ
 * geri verilir. REVIZE_NEEDED / basari iade almaz (makale uretildi), ayni basarisizlik
 * iki kez gelse de tek iade, ay donduyse yeni ayin sayaci azalmaz, deneme hesabi hakkini
 * geri alir, yeniden deneme hakki yeniden dusurur.
 *
 * Sahte veritabani gercek bir veritabani gibi davranir: kosullu guncellemeler atomik,
 * okumalar bir tur bekler (iki olay ayni anda okur), etkilesimli islem hata firlatinca
 * tum yazimlar geri alinir.
 */

const NOW = new Date(2026, 9, 20, 15, 0, 0); // yerel saat: QuotaService ay tanimi da yerel
const CHARGE_AT = new Date(2026, 9, 20, 14, 0, 0).toISOString();

type UserRow = { id: string; plan: string; articlesUsedThisMonth: number; articlesQuotaResetAt: Date; aiCitationQuotaResetAt: Date };
type ArticleRow = { id: string; siteId: string; topic: string; status: string; agentOutputs: any; publishedTo?: unknown };
type JobRow = { id: string; bullJobId: string; userId: string; payload: any };

const tick = () => new Promise((r) => setTimeout(r, 0));
const chargeAtOf = (v: any) => v?.allowanceCharge?.at;

function db(opts: { user?: Partial<UserRow>; articles?: ArticleRow[]; jobs?: JobRow[] } = {}) {
  const state = {
    user: { id: 'u1', plan: 'PRO', articlesUsedThisMonth: 3, articlesQuotaResetAt: new Date(2026, 9, 1), aiCitationQuotaResetAt: new Date(2026, 9, 1), ...opts.user } as UserRow,
    articles: opts.articles ?? [],
    jobs: opts.jobs ?? [],
  };
  const site = { id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'manual_approve', user: { id: 'u1' }, publishTargets: [] };
  const statusOk = (r: ArticleRow, c: any) => (c === undefined ? true : typeof c === 'string' ? r.status === c : c.in.includes(r.status));
  const jsonOk = (v: any, c: any) => !c || (c.path === '$.allowanceCharge.at' && chargeAtOf(v) === c.equals);
  const prisma: any = {
    state,
    user: {
      findUniqueOrThrow: vi.fn(async () => { await tick(); return { ...state.user }; }),
      update: vi.fn(async ({ data }: any) => { Object.assign(state.user, data); return { ...state.user }; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        await tick();
        const u = state.user;
        const c = where.articlesUsedThisMonth ?? {};
        if (c.lt !== undefined && !(u.articlesUsedThisMonth < c.lt)) return { count: 0 };
        if (c.gt !== undefined && !(u.articlesUsedThisMonth > c.gt)) return { count: 0 };
        if (where.articlesQuotaResetAt?.lte && !(u.articlesQuotaResetAt.getTime() <= where.articlesQuotaResetAt.lte.getTime())) return { count: 0 };
        const d = data.articlesUsedThisMonth;
        u.articlesUsedThisMonth += typeof d?.increment === 'number' ? d.increment : -(d?.decrement ?? 0);
        return { count: 1 };
      }),
    },
    article: {
      findUnique: vi.fn(async ({ where }: any) => {
        await tick();
        const a = state.articles.find((r) => r.id === where.id);
        return a ? { ...a, agentOutputs: structuredClone(a.agentOutputs), site: { userId: 'u1', user: { plan: state.user.plan, articlesQuotaResetAt: state.user.articlesQuotaResetAt } } } : null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const a = state.articles.find((r) => r.id === where.id && r.siteId === where.siteId);
        return a ? { ...a, agentOutputs: structuredClone(a.agentOutputs), site } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const a = state.articles.find((r) => r.id === where.id && (where.siteId === undefined || r.siteId === where.siteId)
          && statusOk(r, where.status) && jsonOk(r.agentOutputs, where.agentOutputs));
        if (!a) return { count: 0 };
        Object.assign(a, data, data.agentOutputs === Prisma.DbNull ? { agentOutputs: null } : {});
        return { count: 1 };
      }),
    },
    job: {
      findUnique: vi.fn(async ({ where }: any) => {
        await tick();
        const j = state.jobs.find((r) => r.bullJobId === where.bullJobId);
        return j ? { ...j, payload: structuredClone(j.payload), user: { plan: state.user.plan, articlesQuotaResetAt: state.user.articlesQuotaResetAt } } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const j = state.jobs.find((r) => r.id === where.id && jsonOk(r.payload, where.payload));
        if (!j) return { count: 0 };
        Object.assign(j, data);
        return { count: 1 };
      }),
    },
    // Etkilesimli islem: hata firlarsa tum yazimlar geri alinir
    $transaction: vi.fn(async (fn: any) => {
      const snapshot = structuredClone({ user: state.user, articles: state.articles, jobs: state.jobs });
      try {
        return await fn(prisma);
      } catch (err) {
        Object.assign(state.user, snapshot.user);
        state.articles.splice(0, state.articles.length, ...snapshot.articles);
        state.jobs.splice(0, state.jobs.length, ...snapshot.jobs);
        throw err;
      }
    }),
  };
  return prisma;
}

const charged = (source = 'user_start', at = CHARGE_AT) => ({ allowanceCharge: { at, source } });
const generating = (agentOutputs: any = charged(), status = 'GENERATING'): ArticleRow => ({ id: 'a1', siteId: 's1', topic: 'Konu', status, agentOutputs });
/** Worker'in son denemesindeki cagri (apps/worker/src/index.ts) */
const workerFail = (prisma: any, now = NOW) => failGenerationWithRefund(prisma, { articleId: 'a1', where: { id: 'a1', status: { in: ['GENERATING', 'EDITING'] as any } }, now });

describe('failGenerationWithRefund — basarisiz uretimin hakki tek kez iade edilir', () => {
  it('hakki dusulmus uretim basarisiz: yazi FAILED, sayac 1 azalir, isaret iade izine doner', async () => {
    const prisma = db({ articles: [generating()] });
    await expect(workerFail(prisma)).resolves.toEqual({ failed: true, refunded: true });
    expect(prisma.state.user.articlesUsedThisMonth).toBe(2);
    const a = prisma.state.articles[0];
    expect(a.status).toBe('FAILED');
    expect(a.agentOutputs.allowanceCharge).toBeUndefined();
    expect(a.agentOutputs.allowanceRefund).toEqual({ at: NOW.toISOString(), chargeAt: CHARGE_AT, source: 'user_start' });
  });

  it('EDITING asamasinda basarisiz (editor turu) da iade alir; takvim ve Simdi uret isaretleri de', async () => {
    for (const source of ['calendar', 'trigger_now']) {
      const prisma = db({ articles: [generating(charged(source), 'EDITING')] });
      await expect(workerFail(prisma), source).resolves.toEqual({ failed: true, refunded: true });
      expect(prisma.state.user.articlesUsedThisMonth).toBe(2);
    }
  });

  it('ayni basarisizlik iki kez (worker + supurucu, ya da tekrarlanan olay) ayni anda: tek iade', async () => {
    const prisma = db({ articles: [generating()] });
    const sweeperWhere = { id: 'a1', status: 'GENERATING' as any };
    const [r1, r2] = await Promise.all([
      workerFail(prisma),
      failGenerationWithRefund(prisma, { articleId: 'a1', where: sweeperWhere, now: NOW }),
    ]);
    expect([r1.refunded, r2.refunded].filter(Boolean)).toHaveLength(1);
    expect(prisma.state.user.articlesUsedThisMonth).toBe(2);
    // Arka arkaya ucuncu olay: yazi zaten FAILED, isaret yok
    await expect(workerFail(prisma)).resolves.toMatchObject({ failed: false, refunded: false });
    expect(prisma.state.user.articlesUsedThisMonth).toBe(2);
  });

  it('REVIZE_NEEDED / basari: hat makaleyi yazdi (isaret silindi, durum GENERATING degil) — iade yok', async () => {
    for (const status of ['REVIZE_NEEDED', 'READY_TO_PUBLISH']) {
      // Hat basarida agentOutputs'u yeniden yazar: isaret kalmaz
      const prisma = db({ articles: [generating({ writer: { output: 'metin' } }, status)] });
      await expect(workerFail(prisma), status).resolves.toMatchObject({ failed: false, refunded: false });
      expect(prisma.state.articles[0].status).toBe(status);
      expect(prisma.state.user.articlesUsedThisMonth).toBe(3);
    }
  });

  it('isaretsiz yazi ve ucretli planin ucretsiz onboarding yazisi: FAILED olur, iade yok', async () => {
    for (const outputs of [null, charged('onboarding_free')]) {
      const prisma = db({ articles: [generating(outputs)] });
      const r = await workerFail(prisma);
      expect(r).toMatchObject({ failed: true, refunded: false });
      expect(prisma.state.user.articlesUsedThisMonth).toBe(3);
    }
  });

  it('ay dondu (dusus gecen ay): yeni ayin sayaci azalmaz; yazi yine FAILED', async () => {
    const lastMonth = new Date(2026, 8, 30, 23, 50).toISOString();
    const prisma = db({ articles: [generating(charged('calendar', lastMonth))] });
    await expect(workerFail(prisma)).resolves.toEqual({ failed: true, refunded: false, reason: 'period_rolled' });
    expect(prisma.state.user.articlesUsedThisMonth).toBe(3);
  });

  it('sayac dususten sonra sifirlandi (ay basi ya da plan degisimi): iade yok', async () => {
    const prisma = db({ user: { articlesQuotaResetAt: new Date(2026, 9, 20, 14, 30) }, articles: [generating()] });
    await expect(workerFail(prisma)).resolves.toMatchObject({ failed: true, refunded: false, reason: 'period_rolled' });
    expect(prisma.state.user.articlesUsedThisMonth).toBe(3);
  });

  it('karar ile yazma arasinda sayac sifirlandi: islem geri alinir, isaret yerinde, yazi FAILED', async () => {
    const prisma = db({ articles: [generating()] });
    // Kararin okumasindan sonra ay basi sifirlamasi araya girer
    prisma.article.findUnique.mockImplementationOnce(async ({ where }: any) => {
      const a = prisma.state.articles.find((r: ArticleRow) => r.id === where.id);
      const snap = { ...a, agentOutputs: structuredClone(a.agentOutputs), site: { userId: 'u1', user: { plan: 'PRO', articlesQuotaResetAt: prisma.state.user.articlesQuotaResetAt } } };
      Object.assign(prisma.state.user, { articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date(2026, 9, 20, 14, 30) });
      return snap;
    });
    await expect(workerFail(prisma)).resolves.toEqual({ failed: true, refunded: false, reason: 'counter_empty' });
    expect(prisma.state.user.articlesUsedThisMonth).toBe(0);
    expect(prisma.state.articles[0].agentOutputs.allowanceCharge.at).toBe(CHARGE_AT);
  });

  it('deneme hesabi: basarisiz deneme 2 hakkindan birini yemez (ay kosulu yok, sayac omur boyu)', async () => {
    const twoMonthsAgo = new Date(2026, 7, 5).toISOString();
    const prisma = db({ user: { plan: 'TRIAL', articlesUsedThisMonth: 2, articlesQuotaResetAt: new Date(2026, 7, 1) }, articles: [generating(charged('calendar', twoMonthsAgo))] });
    await expect(workerFail(prisma)).resolves.toEqual({ failed: true, refunded: true });
    expect(prisma.state.user.articlesUsedThisMonth).toBe(1);
    // Geri gelen hakla yeni uretim baslar
    const quota = new QuotaService(prisma);
    await expect(quota.consumeArticleAllowance('u1')).resolves.toEqual({ remaining: 0 });
  });

  it('veritabani hatasi: iade yok ama yazi yine FAILED (eski davranis; takili kalmaz)', async () => {
    const prisma = db({ articles: [generating()] });
    prisma.$transaction.mockRejectedValueOnce(new Error('baglanti koptu'));
    await expect(workerFail(prisma)).resolves.toEqual({ failed: true, refunded: false, reason: 'error' });
    expect(prisma.state.user.articlesUsedThisMonth).toBe(3);
  });
});

describe('yeniden deneme hakki yeniden dusurur — iade bir sonraki denemeyi bedava yapmaz', () => {
  it('FAILED + iade → "Simdi uret": hak yeniden duser, yeni isaret; o da basarisizsa yine tek iade', async () => {
    const prisma = db({ articles: [generating()] });
    await workerFail(prisma);
    expect(prisma.state.user.articlesUsedThisMonth).toBe(2);

    const quota = new QuotaService(prisma);
    const jobQueue = { enqueue: vi.fn(async () => ({ dbJobId: 'j2', bullJobId: '9' })), removeJob: vi.fn(async () => true) };
    const svc = new ArticlesService(prisma, jobQueue as any, quota, {} as any);
    await svc.triggerNow('s1', 'a1');
    expect(prisma.state.user.articlesUsedThisMonth).toBe(3);
    const a = prisma.state.articles[0];
    expect(a.status).toBe('GENERATING');
    expect(a.agentOutputs.allowanceCharge.source).toBe('trigger_now');

    // Ikinci deneme de basarisiz: yeni dusus iade edilir (eski iade izi buna engel degil)
    await expect(workerFail(prisma, new Date())).resolves.toEqual({ failed: true, refunded: true });
    expect(prisma.state.user.articlesUsedThisMonth).toBe(2);
  });

  it('iadesi yapilmis FAILED yaziya gec kalan uretim isi uretmez (attempt_refunded)', async () => {
    const prisma = db({ articles: [generating()] });
    await workerFail(prisma);
    prisma.article.findUnique.mockImplementationOnce(async ({ where }: any) => {
      const a = prisma.state.articles.find((r: ArticleRow) => r.id === where.id);
      return { status: a.status, agentOutputs: a.agentOutputs, site: { userId: 'u1' } };
    });
    const scheduler = new ArticleSchedulerService(prisma, {} as any, {} as any);
    await expect(scheduler.claimForGeneration('a1')).resolves.toBe('attempt_refunded');
  });
});

describe('settleUnstartedGeneration — baslatilamayan uretim', () => {
  it('yer tutucu acildi: isaretiyle iade, yer tutucu FAILED; duz iade cagrilmaz (cift iade yok)', async () => {
    const prisma = db({ articles: [generating()] });
    const quota = { refundArticleAllowance: vi.fn(async () => undefined) };
    await settleUnstartedGeneration(prisma, quota, { userId: 'u1', articleId: 'a1' });
    expect(prisma.state.user.articlesUsedThisMonth).toBe(2);
    expect(prisma.state.articles[0].status).toBe('FAILED');
    expect(quota.refundArticleAllowance).not.toHaveBeenCalled();
    // Sonra supurucu / worker ayni yazi icin gelse de ikinci iade yok
    await expect(workerFail(prisma)).resolves.toMatchObject({ refunded: false });
    expect(prisma.state.user.articlesUsedThisMonth).toBe(2);
  });

  it('yer tutucu yok: duz iade', async () => {
    const prisma = db();
    const quota = { refundArticleAllowance: vi.fn(async () => undefined) };
    await settleUnstartedGeneration(prisma, quota, { userId: 'u1', articleId: null });
    expect(quota.refundArticleAllowance).toHaveBeenCalledWith('u1');
  });

  it('isaretli iade veritabani hatasiyla yapilamadi ama yer tutucu FAILED oldu: duz iade (supurucu FAILED yaziya dokunmaz)', async () => {
    const prisma = db({ articles: [generating()] });
    prisma.$transaction.mockRejectedValueOnce(new Error('kilit zaman asimi'));
    const quota = { refundArticleAllowance: vi.fn(async () => undefined) };
    await settleUnstartedGeneration(prisma, quota, { userId: 'u1', articleId: 'a1' });
    expect(prisma.state.articles[0].status).toBe('FAILED');
    expect(quota.refundArticleAllowance).toHaveBeenCalledTimes(1);
  });
});

describe('refundJobAllowanceCharge — kapali dongu guncellemesi (iz is verisinde)', () => {
  const job = (payload: any): JobRow => ({ id: 'j1', bullJobId: '42', userId: 'u1', payload: { siteId: 's1', articleId: 'p1', ...payload } });

  it('son denemede hata: hak bir kez iade edilir; ikinci olay (tekrar) iade etmez', async () => {
    const prisma = db({ jobs: [job(charged())] });
    const [r1, r2] = await Promise.all([
      refundJobAllowanceCharge(prisma, { bullJobId: '42', now: NOW }),
      refundJobAllowanceCharge(prisma, { bullJobId: '42', now: NOW }),
    ]);
    expect([r1.refunded, r2.refunded].filter(Boolean)).toHaveLength(1);
    expect(prisma.state.user.articlesUsedThisMonth).toBe(2);
    expect(prisma.state.jobs[0].payload.allowanceCharge).toBeUndefined();
    expect(prisma.state.jobs[0].payload.allowanceRefund.chargeAt).toBe(CHARGE_AT);
  });

  it('izsiz is (otomatik yeniden yazim, icerik pivotu): iade yok', async () => {
    const prisma = db({ jobs: [job({ automatedRewrite: true })] });
    await expect(refundJobAllowanceCharge(prisma, { bullJobId: '42', now: NOW })).resolves.toEqual({ refunded: false, reason: 'not_charged' });
    expect(prisma.state.user.articlesUsedThisMonth).toBe(3);
  });
});

describe('allowanceRefundDecision — saf kural', () => {
  const base = { plan: 'PRO', quotaResetAt: new Date(2026, 9, 1), now: NOW };
  it('isaret yok / bicim disi → not_charged; ucretsiz onboarding → free', () => {
    expect(allowanceRefundDecision({ ...base, carrier: null })).toEqual({ refund: false, reason: 'not_charged' });
    expect(allowanceRefundDecision({ ...base, carrier: { allowanceCharge: { at: 'tarih degil', source: 'calendar' } } })).toEqual({ refund: false, reason: 'not_charged' });
    expect(allowanceRefundDecision({ ...base, carrier: charged('onboarding_free') })).toEqual({ refund: false, reason: 'free' });
  });
  it('ayni ay ve son sifirlamadan sonra → iade; gecen ay → period_rolled (deneme hesabinda ay kosulu yok)', () => {
    expect(allowanceRefundDecision({ ...base, carrier: charged() })).toEqual({ refund: true, chargeAt: CHARGE_AT });
    const sep = new Date(2026, 8, 29).toISOString();
    expect(allowanceRefundDecision({ ...base, quotaResetAt: new Date(2026, 8, 1), carrier: charged('calendar', sep) })).toEqual({ refund: false, reason: 'period_rolled' });
    expect(allowanceRefundDecision({ ...base, plan: 'TRIAL', quotaResetAt: new Date(2026, 8, 1), carrier: charged('calendar', sep) })).toEqual({ refund: true, chargeAt: sep });
  });
});
