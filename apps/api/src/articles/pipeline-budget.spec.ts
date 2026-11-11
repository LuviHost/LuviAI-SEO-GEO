import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Uretim hatti ve aylik AI butcesi (sahip karari 11.11.2026, "zarar etmeyelim").
 *
 * NEDEN VAR: makale ajanlari LLM'i kimliksiz cagiriyordu; makale basina yaklasik $0.75
 * harcama sahibin butce sayacina hic islemiyor, butce doluyken de uretim suruyordu.
 * Kural: butce olcum disindaki her AI harcamasini kapsar; dolunca makale uretimi
 * (kullanicinin baslattigi + takvim / otomatik) ay yenilenene kadar durur.
 *  - Her ajan cagrisi SITE SAHIBININ kimligiyle (sayac + site basina dokum).
 *  - Butce doluysa hat BASLAMAZ: hicbir ajan cagrilmaz, yazi onceki durumuna doner,
 *    dusulen makale hakki iade edilir, sonuc hata degil tipli "atlandi" sonucudur
 *    (worker isi COMPLETED yazar, BullMQ uc kez yeniden denemez).
 * GERCEK QuotaService ve gercek iade kurallari (allowance-refund.ts) bellek ici bir
 * veritabaniyla calisir.
 */

// GEO kapisi deterministik ve kendi testleri var (geo-gate.spec.ts): gecer sayilir
vi.mock('@luviai/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@luviai/shared')>();
  return {
    ...real,
    checkGeoGate: () => ({
      pass: true,
      issues: [],
      feedback: '',
      stats: { questionRatio: 1, tables: 1, shortAnswerCovered: 1, contentH2: 1, unsourcedNumericClaims: 0 },
    }),
  };
});

const { PipelineService } = await import('./pipeline.service.js');
const { QuotaService, AI_BUDGET_EXHAUSTED_CODE } = await import('../billing/quota.service.js');
const { hasAllowanceCharge, hasAllowanceRefund } = await import('./article-scheduler.service.js');

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

const OWNER = 'sahip-1';
const NOW = new Date();
const MONTH_START = new Date(NOW.getFullYear(), NOW.getMonth(), 1);
const CHARGE_AT = NOW.toISOString();
const charge = (source: string) => ({ allowanceCharge: { at: CHARGE_AT, source } });
const BUDGET_FULL_TEXT = 'Aylık AI kullanım bütçen doldu ($120.00 / $120). Bütçe yeni ayın başında sıfırlanır.';

const DRAFT = ['---', 'title: "Kira Artış Oranı"', 'slug: kira-artis-orani', '---', '# Kira Artış Oranı', '', 'Gövde.'].join('\n');
const EDITOR_PASS = ['```json', JSON.stringify({ verdict: 'PASS', scores: { yapi: 9 }, total: 80, blocking_issues: [] }), '```'].join('\n');

type ArticleRow = { id: string; siteId: string; status: string; slug: string; title: string; scheduledAt: Date | null; agentOutputs: any; publishedAt?: Date | null; publishedTo?: unknown };
type JobRow = { id: string; bullJobId: string; userId: string; siteId: string; type: string; status: string; queuedAt: Date; payload: any };

function build(opts: {
  owner?: Record<string, unknown>;
  article?: Partial<ArticleRow> | null;
  jobs?: JobRow[];
  userReadFails?: boolean;
} = {}) {
  const state = {
    user: { id: OWNER, plan: 'PRO', role: 'USER', articlesUsedThisMonth: 10, articlesQuotaResetAt: MONTH_START, aiCostThisMonthUsd: 0, ...opts.owner } as any,
    articles: (opts.article === null ? [] : [{ id: 'a1', siteId: 's1', status: 'GENERATING', slug: 'generating-x', title: 'Kira', scheduledAt: null, agentOutputs: charge('user_start'), ...opts.article }]) as ArticleRow[],
    jobs: opts.jobs ?? [],
  };
  const site = { id: 's1', userId: OWNER, name: 'Site', url: 'https://ornek.com', niche: 'emlak', language: 'tr', socialProfiles: [], brain: { brandVoice: {}, personas: [], competitors: [], seoStrategy: {}, glossary: [] } };
  const statusOk = (r: ArticleRow, c: any) => (c === undefined ? true : typeof c === 'string' ? r.status === c : c.in.includes(r.status));
  const chargeAtOk = (v: any, c: any) => !c || (c.path === '$.allowanceCharge.at' && v?.allowanceCharge?.at === c.equals);
  const prisma: any = {
    state,
    site: {
      findUniqueOrThrow: vi.fn(async () => site),
      findUnique: vi.fn(async () => ({ ...site, user: { id: OWNER, email: 'sahip@ornek.com', name: 'Ayşe' } })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        if (opts.userReadFails) throw new Error('db yok');
        if (where.id !== state.user.id) throw new Error('No User found');
        return { ...state.user };
      }),
      update: vi.fn(async ({ data }: any) => { Object.assign(state.user, data); return { ...state.user }; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const u = state.user;
        if (where.articlesUsedThisMonth?.gt !== undefined && !(u.articlesUsedThisMonth > where.articlesUsedThisMonth.gt)) return { count: 0 };
        if (where.articlesQuotaResetAt?.lte && !(u.articlesQuotaResetAt.getTime() <= where.articlesQuotaResetAt.lte.getTime())) return { count: 0 };
        u.articlesUsedThisMonth -= data.articlesUsedThisMonth?.decrement ?? 0;
        return { count: 1 };
      }),
    },
    article: {
      findUnique: vi.fn(async ({ where }: any) => {
        const a = state.articles.find((r) => r.id === where.id);
        return a
          ? { ...a, agentOutputs: structuredClone(a.agentOutputs), wordCount: 9, frontmatter: {}, editorScore: 80, site: { userId: OWNER, user: { plan: state.user.plan, articlesQuotaResetAt: state.user.articlesQuotaResetAt } } }
          : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const a = state.articles.find((r) => r.id === where.id && statusOk(r, where.status) && chargeAtOk(r.agentOutputs, where.agentOutputs));
        if (!a) return { count: 0 };
        Object.assign(a, data, data.agentOutputs === Prisma.DbNull ? { agentOutputs: null } : {});
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const a = state.articles.find((r) => r.id === where.id)!;
        Object.assign(a, data);
        return { ...a };
      }),
      create: vi.fn(async ({ data }: any) => ({ id: 'a-new', ...data })),
      count: vi.fn(async () => 0),
    },
    job: {
      findMany: vi.fn(async ({ where }: any) => state.jobs
        .filter((j) => j.type === where.type && j.siteId === where.siteId && where.status.in.includes(j.status) && j.payload?.articleId === where.payload.equals)
        .map((j) => ({ bullJobId: j.bullJobId, payload: structuredClone(j.payload) }))),
      findUnique: vi.fn(async ({ where }: any) => {
        const j = state.jobs.find((r) => r.bullJobId === where.bullJobId);
        return j ? { ...j, payload: structuredClone(j.payload), user: { plan: state.user.plan, articlesQuotaResetAt: state.user.articlesQuotaResetAt } } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const j = state.jobs.find((r) => r.id === where.id && chargeAtOk(r.payload, where.payload));
        if (!j) return { count: 0 };
        Object.assign(j, data);
        return { count: 1 };
      }),
    },
    publishTarget: { findMany: vi.fn(async () => []) },
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
  const runner = {
    run: vi.fn(async ({ agentName }: any) => ({
      output: agentName === '03-writer' ? DRAFT : agentName === '04-editor' ? EDITOR_PASS : `${agentName} cikti`,
      usage: {},
      costUsd: 0.2,
    })),
  };
  const email = { send: vi.fn(async () => undefined) };
  const schemaClassifier = { classify: vi.fn(async () => ({ primary: ['Article'], reasoning: 'test' })), buildJsonLd: vi.fn(() => []) };
  const settings = { getBoolean: vi.fn(async () => false) };
  const urlInventory = { getInventory: vi.fn(async () => []), isInternal: vi.fn(() => false), normalizePath: vi.fn(() => null) };
  const linkValidator = { validateArticleMarkdown: vi.fn(async (_s: string, md: string) => ({ bodyMd: md, report: { remapped: 0, unlinked: 0 } })) };
  const qaGate = { checkSafe: vi.fn(async () => undefined) };
  const quota = new QuotaService(prisma);
  const svc = new PipelineService(
    prisma, runner as any, email as any, schemaClassifier as any, settings as any,
    urlInventory as any, linkValidator as any, qaGate as any, quota,
  );
  return { svc, prisma, state, runner, quota };
}

const run = (c: ReturnType<typeof build>, extra: Record<string, unknown> = {}) =>
  c.svc.runPipeline({ siteId: 's1', topic: 'Kira', articleId: 'a1', ...extra });

const FULL = { plan: 'PRO', aiCostThisMonthUsd: 120 };

describe('butce acik — her ajan cagrisi site sahibinin kimligiyle', () => {
  it('bes ajanin hepsi siteId + userId (site sahibi) + conversationId (makale) tasir; hat her zamanki gibi biter', async () => {
    const c = build({ owner: { aiCostThisMonthUsd: 119 } });
    const r = await run(c);
    expect(r.skipped).toBeUndefined();
    expect(r.editorVerdict).toBe('PASS');
    const agents = c.runner.run.mock.calls.map((x: any[]) => x[0]);
    expect(agents.map((a) => a.agentName)).toEqual(['01-keyword', '02-outline', '03-writer', '04-editor', '05-visuals']);
    for (const a of agents) expect(a, a.agentName).toMatchObject({ siteId: 's1', userId: OWNER, conversationId: 'a1' });
    // Butce SAHIBIN satirindan okundu
    expect(c.prisma.user.findUniqueOrThrow.mock.calls.every((x: any[]) => x[0].where.id === OWNER)).toBe(true);
  });

  it('ADMIN sahip butceyi asmis olsa da uretim baslar (muafiyet sahibin rolune bakar)', async () => {
    const c = build({ owner: { ...FULL, role: 'ADMIN' } });
    expect((await run(c)).skipped).toBeUndefined();
    expect(c.runner.run).toHaveBeenCalled();
  });

  it('butce sayaci okunamazsa uretim ENGELLENMEZ (hata yonu: acik)', async () => {
    const c = build({ userReadFails: true });
    expect((await run(c)).skipped).toBeUndefined();
    expect(c.runner.run).toHaveBeenCalled();
  });
});

describe('butce dolu — hat baslamaz, hata firlatmaz (yeniden denenmeyen tipli sonuc)', () => {
  it('takvim yazisi: hicbir ajan cagrilmaz; yazi takvime doner (SCHEDULED), makale hakki iade edilir', async () => {
    const c = build({ owner: FULL, article: { scheduledAt: new Date(NOW.getTime() - 3_600_000), agentOutputs: charge('calendar') } });
    const r = await run(c);
    expect(c.runner.run).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      articleId: 'a1', skipped: true, reason: AI_BUDGET_EXHAUSTED_CODE, message: BUDGET_FULL_TEXT,
      articleStatus: 'SCHEDULED', editorVerdict: 'REVIZE', totalCostUsd: 0,
    });
    const a = c.state.articles[0];
    expect(a.status).toBe('SCHEDULED');
    // Hak isareti silindi: butce yenilenince tarama yaziyi alirken hak yeniden (o ay) duser
    expect(hasAllowanceCharge(a.agentOutputs)).toBe(false);
    expect(hasAllowanceRefund(a.agentOutputs)).toBe(true);
    expect(c.state.user.articlesUsedThisMonth).toBe(9);
  });

  it('kullanicinin baslattigi yer tutucu (takvim disi): FAILED + iade — kullanici "Şimdi üret" ile yeniden baslatir', async () => {
    const c = build({ owner: FULL, article: { scheduledAt: null, agentOutputs: charge('user_start') } });
    const r = await run(c);
    expect(c.runner.run).not.toHaveBeenCalled();
    expect(r).toMatchObject({ skipped: true, reason: AI_BUDGET_EXHAUSTED_CODE, articleStatus: 'FAILED' });
    expect(c.state.articles[0].status).toBe('FAILED');
    expect(c.state.user.articlesUsedThisMonth).toBe(9);
  });

  it('ayni yazi icin ikinci kez gelse de hak TEK kez iade edilir', async () => {
    const c = build({ owner: FULL, article: { scheduledAt: new Date(), agentOutputs: charge('calendar') } });
    await run(c);
    c.state.articles[0].status = 'GENERATING'; // tarama yeniden sahiplendi ama hak dusmedi (isaret yok) varsayimi
    await run(c);
    expect(c.state.user.articlesUsedThisMonth).toBe(9);
  });

  it('ucretli planda onboarding\'in ucretsiz ilk yazisi: takvime doner, iade YOK (hak hic dusmemisti), isaret durur', async () => {
    const c = build({ owner: FULL, article: { scheduledAt: new Date(), agentOutputs: charge('onboarding_free') } });
    const r = await run(c);
    expect(r.articleStatus).toBe('SCHEDULED');
    expect(c.state.user.articlesUsedThisMonth).toBe(10);
    expect(hasAllowanceCharge(c.state.articles[0].agentOutputs)).toBe(true);
  });

  it('yayindaki yazinin otomatik yeniden yazimi (icerik pivotu): yaziya DOKUNULMAZ, sonuc atlandi', async () => {
    const c = build({ owner: FULL, article: { status: 'PUBLISHED', slug: 'canli', agentOutputs: { writer: {} } } });
    const r = await run(c, { automatedRewrite: true });
    expect(c.runner.run).not.toHaveBeenCalled();
    expect(r).toMatchObject({ skipped: true, reason: AI_BUDGET_EXHAUSTED_CODE, articleStatus: 'PUBLISHED', slug: 'canli' });
    expect(c.prisma.article.updateMany).not.toHaveBeenCalled();
    expect(c.prisma.article.update).not.toHaveBeenCalled();
    expect(c.state.articles[0].status).toBe('PUBLISHED');
  });

  it('yayindaki yazinin kullanici baslattigi guncellemesi (kapali dongu): is verisindeki hak izi uzerinden iade', async () => {
    const job: JobRow = {
      id: 'j1', bullJobId: 'b1', userId: OWNER, siteId: 's1', type: 'GENERATE_ARTICLE', status: 'PROCESSING', queuedAt: new Date(),
      payload: { siteId: 's1', topic: 'Kira', articleId: 'a1', ...charge('user_start') },
    };
    const c = build({ owner: FULL, article: { status: 'PUBLISHED', agentOutputs: null }, jobs: [job] });
    const r = await run(c);
    expect(r).toMatchObject({ skipped: true, articleStatus: 'PUBLISHED' });
    expect(c.state.user.articlesUsedThisMonth).toBe(9);
    expect(hasAllowanceCharge(c.state.jobs[0].payload)).toBe(false);
    expect(hasAllowanceRefund(c.state.jobs[0].payload)).toBe(true);
    expect(c.state.articles[0].status).toBe('PUBLISHED');
  });

  it('baska yazinin ya da bitmis bir isin hak izi iade edilmez', async () => {
    const jobs: JobRow[] = [
      { id: 'j1', bullJobId: 'b1', userId: OWNER, siteId: 's1', type: 'GENERATE_ARTICLE', status: 'PROCESSING', queuedAt: new Date(), payload: { articleId: 'baska', ...charge('user_start') } },
      { id: 'j2', bullJobId: 'b2', userId: OWNER, siteId: 's1', type: 'GENERATE_ARTICLE', status: 'COMPLETED', queuedAt: new Date(), payload: { articleId: 'a1', ...charge('user_start') } },
    ];
    const c = build({ owner: FULL, article: { status: 'PUBLISHED', agentOutputs: null }, jobs });
    await run(c);
    expect(c.state.user.articlesUsedThisMonth).toBe(10);
    expect(c.state.jobs.every((j) => hasAllowanceCharge(j.payload))).toBe(true);
  });

  it('yer tutucusuz cagri (senkron run-now): 403 AI_BUDGET_EXHAUSTED — cagiran hakki geri verir; ajan cagrilmaz', async () => {
    const c = build({ owner: FULL, article: null });
    let err: unknown;
    try {
      await c.svc.runPipeline({ siteId: 's1', topic: 'Kira' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(((err as ForbiddenException).getResponse() as any)).toMatchObject({ code: AI_BUDGET_EXHAUSTED_CODE, message: BUDGET_FULL_TEXT });
    expect(c.runner.run).not.toHaveBeenCalled();
  });

  it('kayit bu arada silinmisse de hata vermez (atlandi doner)', async () => {
    const c = build({ owner: FULL, article: null });
    const r = await run(c);
    expect(r).toMatchObject({ skipped: true, articleStatus: null });
  });

  it('yaziyi geri alma sirasinda veritabani hatasi sonucu degistirmez (takili uretim supurucusu kapatir)', async () => {
    const c = build({ owner: FULL, article: { scheduledAt: new Date(), agentOutputs: charge('calendar') } });
    c.prisma.article.updateMany.mockRejectedValue(new Error('db yok'));
    c.prisma.$transaction.mockRejectedValue(new Error('db yok'));
    const r = await run(c);
    expect(r).toMatchObject({ skipped: true, reason: AI_BUDGET_EXHAUSTED_CODE });
    expect(c.runner.run).not.toHaveBeenCalled();
  });
});
