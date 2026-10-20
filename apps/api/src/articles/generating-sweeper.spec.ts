import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GENERATING_STALE_MS, GENERATING_SWEEP_MAX_REQUEUES, GENERATING_SWEEP_EVERY_MS, LIVE_QUEUE_SCAN_LIMIT,
  bullmqQueueInspector, generatingSweepLockName, runGeneratingSweep, sweepStuckGenerating,
  type QueueInspector,
} from './generating-sweeper.js';

/**
 * GENERATING'de takili kalan yazilarin supurucusu.
 *
 * NEDEN VAR: worker sahiplenme ile kuyruga atma arasinda olurse ya da is
 * maxStalledCount'u asarsa yazi sonsuza kadar "Üretiliyor" kaliyordu; takvim
 * onu bir daha almiyordu. Supurucu canli isi olmayani geri koyar ya da FAILED
 * yapar — ama bekleyen bir is varken ASLA (ikinci uretim = iki kat LLM
 * maliyeti, Tam otomatikte iki yayin).
 */

const NOW = new Date('2026-10-18T10:05:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

type ArticleRow = {
  id: string; siteId: string; status: string; scheduledAt: Date | null; updatedAt: Date;
  agentOutputs?: any;
  site: { url: string; userId?: string; user: { deletionRequestedAt: Date | null; plan?: string; articlesQuotaResetAt?: Date } };
};
type JobRow = { type: string; bullJobId: string | null; queuedAt: Date; payload: Record<string, unknown> };

const article = (over: Partial<ArticleRow> = {}): ArticleRow => ({
  id: 'a1', siteId: 's1', status: 'GENERATING', scheduledAt: hoursAgo(5), updatedAt: hoursAgo(3),
  site: { url: 'https://ornek.com', user: { deletionRequestedAt: null } },
  ...over,
});
const job = (over: Partial<JobRow> & { articleId?: string } = {}): JobRow => ({
  type: 'GENERATE_ARTICLE', bullJobId: 'b1', queuedAt: hoursAgo(3), payload: { articleId: over.articleId ?? 'a1' }, ...over,
});

/** Prisma'nin kullanilan yuzeyi — kosullar gercek sorgu gibi uygulanir */
function fakePrisma(opts: { articles?: ArticleRow[]; jobs?: JobRow[]; kv?: Record<string, { value: string; expiresAt: Date | null }>; used?: number } = {}) {
  const articles = opts.articles ?? [];
  const jobs = opts.jobs ?? [];
  const kv = opts.kv ?? {};
  // Makale hakki sayaci (iade yolu): 0'in altina inmez
  const counter = { used: opts.used ?? 0 };
  const prisma: any = {
    articles, kv, counter,
    user: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!(counter.used > where.articlesUsedThisMonth.gt)) return { count: 0 };
        counter.used -= data.articlesUsedThisMonth.decrement;
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
    article: {
      findUnique: vi.fn(async ({ where }: any) => {
        const a = articles.find((r) => r.id === where.id);
        return a ? { agentOutputs: a.agentOutputs ?? null, site: { userId: a.site.userId ?? 'u1', user: { plan: a.site.user.plan ?? 'PRO', articlesQuotaResetAt: a.site.user.articlesQuotaResetAt ?? new Date(0) } } } : null;
      }),
      findMany: vi.fn(async ({ where, take }: any) => articles
        .filter((a) => a.status === where.status
          && a.updatedAt.getTime() < where.updatedAt.lt.getTime()
          && a.site.url !== where.site.url.not
          && a.site.user.deletionRequestedAt === where.site.user.deletionRequestedAt)
        .sort((x, y) => x.updatedAt.getTime() - y.updatedAt.getTime())
        .slice(0, take)
        .map(({ id, siteId, scheduledAt, updatedAt }) => ({ id, siteId, scheduledAt, updatedAt }))),
      // Tek SQL UPDATE gibi: yalniz kosullar hala gecerliyse yazar
      updateMany: vi.fn<(args: any) => Promise<{ count: number }>>(async ({ where, data }: any) => {
        const row = articles.find((a) => a.id === where.id && a.status === where.status && a.updatedAt.getTime() < where.updatedAt.lt.getTime()
          && (!where.agentOutputs || a.agentOutputs?.allowanceCharge?.at === where.agentOutputs.equals));
        if (!row) return { count: 0 };
        row.status = data.status;
        if (data.agentOutputs !== undefined) row.agentOutputs = data.agentOutputs;
        row.updatedAt = NOW;
        return { count: 1 };
      }),
    },
    job: {
      findMany: vi.fn(async ({ where }: any) => jobs
        .filter((j) => j.type === where.type && j.queuedAt.getTime() >= where.queuedAt.gte.getTime()
          && where.OR.some((c: any) => c.payload.path === '$.articleId' && j.payload.articleId === c.payload.equals))
        .map(({ bullJobId, queuedAt, payload }) => ({ bullJobId, queuedAt, payload }))),
    },
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => kv[where.key] ?? null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        kv[where.key] = kv[where.key] ? { ...kv[where.key], ...update } : { value: create.value, expiresAt: create.expiresAt };
        return kv[where.key];
      }),
      // acquireCronLock: anahtar birincil; ikinci create benzersizlik hatasi
      create: vi.fn(async ({ data }: any) => {
        if (kv[data.key]) throw new Error('Unique constraint failed');
        kv[data.key] = { value: data.value, expiresAt: data.expiresAt };
        return kv[data.key];
      }),
    },
  };
  return prisma;
}

function fakeInspector(opts: { states?: Record<string, string>; live?: string[] | null } = {}) {
  return {
    jobState: vi.fn(async (id: string) => opts.states?.[id] ?? 'unknown'),
    liveArticleIds: vi.fn(async () => (opts.live === null ? null : new Set(opts.live ?? []))),
  } satisfies QueueInspector;
}

const quietLog = () => ({ log: vi.fn(), warn: vi.fn() });

async function sweep(prisma: ReturnType<typeof fakePrisma>, inspector: QueueInspector, log = quietLog()) {
  return sweepStuckGenerating({ prisma: prisma as any, inspector, log, now: NOW });
}

afterEach(() => { vi.useRealTimers(); });

describe('sweepStuckGenerating — canli isi olmayan bayat GENERATING', () => {
  it('takvim yazisi takvime geri konur (SCHEDULED), sayac 1; guncelleme kosullu', async () => {
    const prisma = fakePrisma({ articles: [article()], jobs: [job()] });
    const inspector = fakeInspector({ states: { b1: 'failed' } });
    const log = quietLog();
    const r = await sweep(prisma, inspector, log);
    expect(r).toEqual({ candidates: 1, requeued: 1, failed: 0, refunded: 0, live: 0, unverified: 0, raced: 0 });
    expect(prisma.articles[0].status).toBe('SCHEDULED');
    expect(prisma.kv['generating-sweep:a1'].value).toBe('1');
    // Kayit 7 gun sonra temizlenir (KvSweepCron)
    expect(prisma.kv['generating-sweep:a1'].expiresAt!.getTime()).toBe(NOW.getTime() + 7 * 86_400_000);
    expect(prisma.article.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', status: 'GENERATING', updatedAt: { lt: new Date(NOW.getTime() - GENERATING_STALE_MS) } },
      data: { status: 'SCHEDULED' },
    });
    expect(log.warn.mock.calls[0][0]).toMatch(/a1 ~3 saattir GENERATING ve canlı işi yok → takvime geri kondu \(1\/2\)/);
  });

  it('takvim disi yazi (Uret, MCP, icerik firsati) FAILED olur; sayac yazilmaz', async () => {
    const prisma = fakePrisma({ articles: [article({ scheduledAt: null })], jobs: [job()] });
    const r = await sweep(prisma, fakeInspector({ states: { b1: 'completed' } }));
    expect(r).toMatchObject({ requeued: 0, failed: 1 });
    expect(prisma.articles[0].status).toBe('FAILED');
    expect(prisma.kvStore.upsert).not.toHaveBeenCalled();
  });

  it(`takvim yazisi en fazla ${GENERATING_SWEEP_MAX_REQUEUES} kez geri konur; sonrakinde FAILED`, async () => {
    const prisma = fakePrisma({
      articles: [article()],
      kv: { 'generating-sweep:a1': { value: String(GENERATING_SWEEP_MAX_REQUEUES), expiresAt: new Date(NOW.getTime() + 86_400_000) } },
    });
    const r = await sweep(prisma, fakeInspector());
    expect(r).toMatchObject({ requeued: 0, failed: 1 });
    expect(prisma.articles[0].status).toBe('FAILED');
    // Suresi dolmus sayac sayilmaz
    const expired = fakePrisma({
      articles: [article()],
      kv: { 'generating-sweep:a1': { value: '5', expiresAt: hoursAgo(1) } },
    });
    expect(await sweep(expired, fakeInspector())).toMatchObject({ requeued: 1 });
    expect(expired.kv['generating-sweep:a1'].value).toBe('1');
  });

  it('is hic olusmadiysa (sahiplenme ile kuyruga atma arasinda olum) de supurulur', async () => {
    const prisma = fakePrisma({ articles: [article()], jobs: [] });
    expect(await sweep(prisma, fakeInspector())).toMatchObject({ requeued: 1 });
  });

  it('kayit kimligi BullMQ\'da yoksa (silinmis/bitmis) olu sayilir; kimligi hic yazilmamis eski kayit da', async () => {
    const prisma = fakePrisma({ articles: [article()], jobs: [job({ bullJobId: 'b9' }), job({ bullJobId: null })] });
    expect(await sweep(prisma, fakeInspector())).toMatchObject({ requeued: 1 });
  });
});

describe('sweepStuckGenerating — guvenlik kosulu: canli is varken DOKUNULMAZ', () => {
  it.each(['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'])('kaydin BullMQ durumu %s: canli', async (state) => {
    const prisma = fakePrisma({ articles: [article()], jobs: [job()] });
    const r = await sweep(prisma, fakeInspector({ states: { b1: state } }));
    expect(r).toMatchObject({ live: 1, requeued: 0, failed: 0 });
    expect(prisma.articles[0].status).toBe('GENERATING');
    expect(prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('kuyrukta bekleyen is (DB kaydi olmasa bile) canli', async () => {
    const prisma = fakePrisma({ articles: [article()], jobs: [] });
    expect(await sweep(prisma, fakeInspector({ live: ['a1'] }))).toMatchObject({ live: 1, requeued: 0 });
    expect(prisma.articles[0].status).toBe('GENERATING');
  });

  it('son 2 saatte kuyruga atilmis kayit canli sayilir (BullMQ kimligi henuz yazilmamis olabilir)', async () => {
    const prisma = fakePrisma({ articles: [article()], jobs: [job({ bullJobId: null, queuedAt: hoursAgo(0.5) })] });
    expect(await sweep(prisma, fakeInspector())).toMatchObject({ live: 1 });
  });

  it('takvimin gecikmeli isi (gen:article:<id>) canli sayilmaz: GENERATING yaziyi hic uretmez', async () => {
    const prisma = fakePrisma({ articles: [article()], jobs: [job({ bullJobId: 'gen:article:a1', queuedAt: hoursAgo(0.5) })] });
    const inspector = fakeInspector({ states: { 'gen:article:a1': 'delayed' } });
    expect(await sweep(prisma, inspector)).toMatchObject({ requeued: 1, live: 0 });
    expect(inspector.jobState).not.toHaveBeenCalled();
  });

  it('kuyruk okunamazsa ya da tavani asarsa tur hicbir yaziya dokunmaz', async () => {
    for (const inspector of [
      fakeInspector({ live: null }),
      { ...fakeInspector(), liveArticleIds: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) },
    ]) {
      const prisma = fakePrisma({ articles: [article(), article({ id: 'a2' })] });
      const r = await sweep(prisma, inspector);
      expect(r).toEqual({ candidates: 2, requeued: 0, failed: 0, refunded: 0, live: 0, unverified: 2, raced: 0 });
      expect(prisma.article.updateMany).not.toHaveBeenCalled();
      expect(prisma.job.findMany).not.toHaveBeenCalled();
    }
  });

  it('Redis yanit vermezse (baglanti yokken komut suresiz bekler) 5 sn sonra dogrulanamadi sayilir', async () => {
    vi.useFakeTimers();
    const prisma = fakePrisma({ articles: [article()] });
    const hanging = { ...fakeInspector(), liveArticleIds: vi.fn(() => new Promise<Set<string> | null>(() => undefined)) };
    const pending = sweep(prisma, hanging);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toMatchObject({ unverified: 1, requeued: 0 });
    expect(prisma.articles[0].status).toBe('GENERATING');
  });

  it('tek isin durumu okunamazsa yalniz o yaziya dokunulmaz; digerleri islenir', async () => {
    const prisma = fakePrisma({
      articles: [article(), article({ id: 'a2', updatedAt: hoursAgo(4) })],
      jobs: [job(), job({ articleId: 'a2', bullJobId: 'b2' })],
    });
    const inspector = fakeInspector({ states: { b2: 'failed' } });
    inspector.jobState.mockImplementation(async (id: string) => {
      if (id === 'b1') throw new Error('READONLY');
      return 'failed';
    });
    const r = await sweep(prisma, inspector);
    expect(r).toMatchObject({ unverified: 1, requeued: 1 });
    expect(prisma.articles.find((a) => a.id === 'a1')!.status).toBe('GENERATING');
    expect(prisma.articles.find((a) => a.id === 'a2')!.status).toBe('SCHEDULED');
  });
});

describe('sweepStuckGenerating — aday secimi ve yaris', () => {
  it('2 saatten yeni yazi aday degil; demo sitesi ve silme talepli hesap haric', async () => {
    const prisma = fakePrisma({
      articles: [
        article({ id: 'yeni', updatedAt: hoursAgo(1) }),
        article({ id: 'demo', site: { url: 'https://demo.luviai.com', user: { deletionRequestedAt: null } } }),
        article({ id: 'silinen', site: { url: 'https://x.com', user: { deletionRequestedAt: hoursAgo(10) } } }),
        article({ id: 'hazir', status: 'READY_TO_PUBLISH' }),
      ],
    });
    const r = await sweep(prisma, fakeInspector());
    expect(r.candidates).toBe(0);
    const where = (prisma.article.findMany.mock.calls[0][0] as any).where;
    expect(where).toEqual({
      status: 'GENERATING',
      updatedAt: { lt: new Date(NOW.getTime() - GENERATING_STALE_MS) },
      site: { url: { not: 'https://demo.luviai.com' }, user: { deletionRequestedAt: null } },
    });
  });

  it('is kayitlari: yalniz GENERATE_ARTICLE, son 7 gun, payload $.articleId (MySQL JSON yolu)', async () => {
    const prisma = fakePrisma({ articles: [article()] });
    await sweep(prisma, fakeInspector());
    const where = (prisma.job.findMany.mock.calls[0][0] as any).where;
    expect(where.type).toBe('GENERATE_ARTICLE');
    expect(where.queuedAt.gte).toEqual(new Date(NOW.getTime() - 7 * 86_400_000));
    expect(where.OR).toEqual([{ payload: { path: '$.articleId', equals: 'a1' } }]);
  });

  it('okuma ile yazma arasinda uretim bittiyse (kosullu guncelleme 0 satir) raced; yazi degismez', async () => {
    const prisma = fakePrisma({ articles: [article()] });
    prisma.article.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await sweep(prisma, fakeInspector())).toMatchObject({ raced: 1, requeued: 0 });
  });

  it('geri koyma sayaci yazilamazsa yazi geri konmaz (tavan islemezse coken uretim sonsuz tekrarlanirdi)', async () => {
    const prisma = fakePrisma({ articles: [article()] });
    prisma.kvStore.upsert.mockRejectedValueOnce(new Error('DB yok'));
    const r = await sweep(prisma, fakeInspector());
    expect(r).toMatchObject({ unverified: 1, requeued: 0 });
    expect(prisma.articles[0].status).toBe('GENERATING');
  });

  it('aday yoksa kuyruga hic sorulmaz', async () => {
    const inspector = fakeInspector();
    expect(await sweep(fakePrisma(), inspector)).toEqual({ candidates: 0, requeued: 0, failed: 0, refunded: 0, live: 0, unverified: 0, raced: 0 });
    expect(inspector.liveArticleIds).not.toHaveBeenCalled();
  });
});

describe('runGeneratingSweep — cift-calisma kilidi', () => {
  it('ayni yarim saatte ikinci tur atlanir; sonraki yarim saatte yeniden calisir', async () => {
    const prisma = fakePrisma({ articles: [article()] });
    const log = quietLog();
    const first = await runGeneratingSweep({ prisma: prisma as any, inspector: fakeInspector(), log, now: NOW });
    expect(first).toMatchObject({ requeued: 1 });
    expect(log.log.mock.calls[0][0]).toContain('1 aday: 1 takvime geri, 0 FAILED');
    const again = await runGeneratingSweep({ prisma: prisma as any, inspector: fakeInspector(), log, now: NOW });
    expect(again).toEqual({ skipped: true, reason: 'LOCKED' });
  });

  it('kilit adi yarim saat dilimini tasir (cron-lock en ince saatlik)', () => {
    expect(generatingSweepLockName(new Date('2026-10-18T10:05:00Z'))).toBe('generating-sweep-0');
    expect(generatingSweepLockName(new Date('2026-10-18T10:35:00Z'))).toBe('generating-sweep-1');
    expect(GENERATING_SWEEP_EVERY_MS).toBe(30 * 60_000);
  });
});

describe('bullmqQueueInspector', () => {
  const queue = (jobs: any[], counts: Record<string, number> = { active: 1, waiting: jobs.length }) => ({
    getJobState: vi.fn(async (id: string) => (id === 'b1' ? 'active' : 'unknown')),
    getJobCounts: vi.fn(async () => counts),
    getJobs: vi.fn(async () => jobs),
  });

  it('yalniz takvim disi GENERATE_ARTICLE islerinin yazi kimlikleri; bekleyen ve islenen listeler', async () => {
    const q = queue([
      { id: '11', name: 'GENERATE_ARTICLE', data: { articleId: 'a1' } },
      { id: 'gen:article:a2', name: 'GENERATE_ARTICLE', data: { articleId: 'a2' } },
      { id: '12', name: 'PUBLISH_ARTICLE', data: { articleId: 'a3' } },
      { id: '13', name: 'GENERATE_ARTICLE', data: {} },
      undefined,
    ]);
    const inspector = bullmqQueueInspector(q as any);
    expect([...(await inspector.liveArticleIds())!]).toEqual(['a1']);
    expect(q.getJobs).toHaveBeenCalledWith(['active', 'waiting', 'prioritized', 'paused', 'waiting-children'], 0, LIVE_QUEUE_SCAN_LIMIT);
    expect(await inspector.jobState('b1')).toBe('active');
  });

  it('kuyruk tavandan kalabaliksa null (hepsini okumadan "isi yok" denemez)', async () => {
    const q = queue([], { waiting: LIVE_QUEUE_SCAN_LIMIT, active: 1 });
    expect(await bullmqQueueInspector(q as any).liveArticleIds()).toBeNull();
    expect(q.getJobs).not.toHaveBeenCalled();
  });
});

describe('worker kablolamasi (apps/worker/src/index.ts) — supurucu', () => {
  // Worker'in test kosucusu yok; kayit kaynaktan denetlenir
  const src = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');

  it('isleyici api/dist\'teki turu worker Queue\'su uzerinden cagirir', () => {
    expect(src).toMatch(/import \{ runGeneratingSweep, bullmqQueueInspector \} from '\.\.\/\.\.\/api\/dist\/articles\/generating-sweeper\.js'/);
    expect(src).toMatch(/SWEEP_STUCK_GENERATING: async \(\) => \{\s*return runGeneratingSweep\(\{ prisma: services\.prisma, inspector: bullmqQueueInspector\(sweepQueue\(\)\), log \}\);/);
  });

  it('30 dakikalik tekrar isi olarak kayitli; ozet log gercek araliklari yazar', () => {
    expect(src).toMatch(/'SWEEP_STUCK_GENERATING',\s*\{ trigger: 'cron' \},\s*\{\s*repeat: \{ every: 30 \* 60 \* 1000 \},\s*jobId: 'cron:sweep-stuck-generating'/);
    expect(src).toContain('SWEEP_STUCK_GENERATING 30dk');
    // PROCESS_SCHEDULED tekrar araligi 60 dk; ozet eskiden "30dk" diyordu
    expect(src).toMatch(/'PROCESS_SCHEDULED',\s*\{ trigger: 'cron' \},\s*\{\s*repeat: \{ every: 60 \* 60 \* 1000 \}/);
    expect(src).toContain('PROCESS_SCHEDULED 60dk');
    expect(src).not.toContain('PROCESS_SCHEDULED 30dk');
  });
});

/**
 * Basarisiz uretimin makale hakki iadesi (sahip karari 20.10.2026; allowance-refund.ts).
 * Supurucunun FAILED karari uretimin makale cikmadan bittigi anlamina gelir: hakki dusulen
 * deneme TAM BIR KEZ iade edilir. Takvime geri konan yazi iade almaz (yeniden uretilirken
 * ikinci kez dusmez).
 */
describe('sweepStuckGenerating — FAILED kararinda makale hakki iadesi', () => {
  const CHARGE = { allowanceCharge: { at: '2026-10-18T06:00:00.000Z', source: 'user_start' } };

  it('takvim disi yazi FAILED olurken hakki iade edilir; isaret iade izine doner', async () => {
    const prisma = fakePrisma({ articles: [article({ scheduledAt: null, agentOutputs: { ...CHARGE } })], jobs: [job()], used: 5 });
    const r = await sweep(prisma, fakeInspector({ states: { b1: 'failed' } }));
    expect(r).toMatchObject({ failed: 1, refunded: 1 });
    expect(prisma.counter.used).toBe(4);
    expect(prisma.articles[0].status).toBe('FAILED');
    expect(prisma.articles[0].agentOutputs.allowanceCharge).toBeUndefined();
    expect(prisma.articles[0].agentOutputs.allowanceRefund).toEqual({ at: NOW.toISOString(), chargeAt: CHARGE.allowanceCharge.at, source: 'user_start' });
  });

  it('takvime geri konan yazi iade almaz (isaret yazida kalir, yeniden uretimde ikinci kez dusmez)', async () => {
    const prisma = fakePrisma({ articles: [article({ agentOutputs: { allowanceCharge: { ...CHARGE.allowanceCharge, source: 'calendar' } } })], jobs: [job()], used: 5 });
    const r = await sweep(prisma, fakeInspector({ states: { b1: 'failed' } }));
    expect(r).toMatchObject({ requeued: 1, refunded: 0 });
    expect(prisma.counter.used).toBe(5);
    expect(prisma.articles[0].agentOutputs.allowanceCharge.source).toBe('calendar');
  });

  it('yeniden deneme hakki biten takvim yazisi FAILED olur ve hakki iade edilir', async () => {
    const prisma = fakePrisma({
      articles: [article({ agentOutputs: { allowanceCharge: { ...CHARGE.allowanceCharge, source: 'calendar' } } })],
      jobs: [job()],
      kv: { 'generating-sweep:a1': { value: String(GENERATING_SWEEP_MAX_REQUEUES), expiresAt: null } },
      used: 1,
    });
    const r = await sweep(prisma, fakeInspector({ states: { b1: 'failed' } }));
    expect(r).toMatchObject({ failed: 1, refunded: 1 });
    expect(prisma.counter.used).toBe(0);
  });

  it('isaretsiz (hakki hic dusmemis) ya da ucretsiz onboarding yazisi: FAILED olur, iade yok', async () => {
    const prisma = fakePrisma({
      articles: [
        article({ id: 'a1', scheduledAt: null }),
        article({ id: 'a2', scheduledAt: null, agentOutputs: { allowanceCharge: { ...CHARGE.allowanceCharge, source: 'onboarding_free' } } }),
      ],
      jobs: [job({ articleId: 'a1', bullJobId: 'b1' }), job({ articleId: 'a2', bullJobId: 'b2' })],
      used: 3,
    });
    const r = await sweep(prisma, fakeInspector({ states: { b1: 'failed', b2: 'failed' } }));
    expect(r).toMatchObject({ failed: 2, refunded: 0 });
    expect(prisma.counter.used).toBe(3);
  });
});
