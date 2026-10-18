import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { STUCK_UNQUEUED_JOB_GRACE_MS, queueStuckRecoveries } from './stuck-batch-result.js';
import { StuckPageRecoveryService } from './stuck-page-recovery.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { STUCK_RECOVER_JOB_PRIORITY, autoRecoveryBlockText } from './stuck-page-autopilot.js';
import { STUCK_ALREADY_QUEUED } from './stuck-page-messages.js';

/**
 * Takili sayfa toplu onarimi (stuck-batch-result.ts queueStuckRecoveries):
 * dogrulama turunda bulunan uc yan etki:
 *  - S9: kuyruga alma anindaki plan kapisi site SAHIBININ planina bakiyor,
 *    PlanFeatureGuard ise yoneticiyi (ADMIN) muaf tutuyordu. Plani dusmus
 *    sahibin sitesinde yoneticinin toplu onarimi 'plan' ile reddediliyordu.
 *  - S19: bekleyen OTOPILOT isi kullanicinin acik istegini "zaten sırada" diye
 *    karsiliyordu; o is otopilot kurallarini uygulayip atliyor (Yari otomatik),
 *    kullanicinin istedigi duzeltme hic yapilmiyordu.
 *  - S24: kuyruga eklenemeyen isin kimliksiz DB kaydi 5 dk "bekleyen is"
 *    sayiliyor, "biraz sonra tekrar dene" diyen musteriye "zaten sırada"
 *    deniyordu.
 * Dunya: GERCEK JobQueueService (BullMQ kuyrugu sahte), GERCEK
 * StuckPageRecoveryService; Prisma ve yapay zeka sahte. Uyarlanan tekrar
 * uretim: rv15/e2e/edges.spec.ts.
 */

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

afterEach(() => {
  vi.useRealTimers();
});

const BODY = '# Yazı\n\nEski cümle burada.\n\nİkinci paragraf.';
const PROPOSAL = {
  diagnosis: 'Entity eksik',
  edits: [{ type: 'sentence_replace', before: 'Eski cümle burada.', after: 'KDV beyanı ile güncellenmiş cümle.', reason: 'KDV', entityAdded: 'KDV beyanı' }],
  entitiesAdded: ['KDV beyanı'], paragraphAdded: null, entityScoreEstimate: 74,
};
const url = (slug: string) => `https://site.com/blog/${slug}.html`;
const ftpEntry = (slug: string) => ({
  targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: `ftp://h/public_html/blog/${slug}.html`, updatedAt: new Date(Date.now() - 60 * 864e5).toISOString(),
});
const liveArticle = (id: string) => ({
  id, siteId: 's1', status: 'PUBLISHED', slug: id, title: id, metaTitle: null, metaDescription: null, bodyMd: BODY, bodyHtml: '<p>x</p>',
  publishedAt: new Date(Date.now() - 90 * 864e5), publishedTo: [ftpEntry(id)],
});

type JobRow = { id: string; type: string; status: string; bullJobId: string | null; queuedAt: Date; payload: Record<string, any>; error?: string | null };

function world(opts: { pages?: string[]; ownerPlan?: string; actors?: Record<string, string>; approval?: 'auto_publish' | 'manual_approve' } = {}) {
  const ids = opts.pages ?? ['p1'];
  const store = ids.map((id) => ({
    id, siteId: 's1', status: 'DETECTED', articleId: `a-${id}`, url: url(`a-${id}`), title: id, position: 7, impressions: 400, ctr: 0.01, topQueries: [],
    updatedAt: new Date(Date.now() - 3 * 864e5),
  }));
  const arts = new Map(ids.map((id) => [`a-${id}`, liveArticle(`a-${id}`) as Record<string, any>]));
  const jobsTable: JobRow[] = [];
  const bull = new Map<string, string>();
  const kv = new Map<string, string>();
  const recoveries: Array<Record<string, any>> = [];
  const byId = (id: string) => store.find((s) => s.id === id);
  const statusIs = (row: any, want: any) => want === undefined || (typeof want === 'string' ? row.status === want : (want.in ?? []).includes(row.status));
  const prisma: any = {
    site: {
      findUnique: vi.fn(async ({ select }: any) => (select?.publishApprovalMode
        ? { autopilot: true, publishApprovalMode: opts.approval ?? 'auto_publish', user: { plan: 'PRO' } }
        : { userId: 'owner-1', name: 'Site', ...(opts.ownerPlan ? { user: { plan: opts.ownerPlan } } : {}) })),
    },
    user: { findUnique: vi.fn(async ({ where }: any) => (opts.actors?.[where.id] ? { role: opts.actors[where.id] } : null)) },
    stuckPage: {
      findMany: vi.fn(async ({ where }: any) => store.filter((s) => s.siteId === where.siteId && (where.id?.in as string[]).includes(s.id)).map((s) => ({ ...s }))),
      findUnique: vi.fn(async ({ where, select }: any) => {
        const s = byId(where.id);
        if (!s) return null;
        return select ? Object.fromEntries(Object.keys(select).map((k) => [k, (s as any)[k]])) : { ...s };
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(byId(where.id)!, { ...data, updatedAt: data.updatedAt ?? new Date() })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const s = byId(where.id);
        if (!s || !statusIs(s, where.status)) return { count: 0 };
        if (where.updatedAt instanceof Date && where.updatedAt.getTime() !== s.updatedAt.getTime()) return { count: 0 };
        Object.assign(s, { ...data, updatedAt: data.updatedAt ?? new Date() });
        return { count: 1 };
      }),
    },
    article: {
      findMany: vi.fn(async ({ where }: any) => [...arts.values()].filter((a) => (where.id.in as string[]).includes(a.id) && a.siteId === where.siteId).map((a) => ({ ...a }))),
      findUnique: vi.fn(async ({ where }: any) => (arts.has(where.id) ? { ...arts.get(where.id) } : null)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const a = arts.get(where.id);
        if (!a || (where.bodyMd !== undefined && a.bodyMd !== where.bodyMd) || (where.status !== undefined && a.status !== where.status)) return { count: 0 };
        Object.assign(a, data);
        return { count: 1 };
      }),
    },
    publishTarget: { findMany: vi.fn(async () => [{ id: 't-ftp', type: 'FTP', isActive: true }]) },
    job: {
      create: vi.fn(async ({ data }: any) => {
        const row: JobRow = { id: `job-${jobsTable.length + 1}`, bullJobId: null, queuedAt: new Date(), error: null, ...data };
        jobsTable.push(row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(jobsTable.find((j) => j.id === where.id)!, data)),
      // liveStuckRecoverJobs'un sorgusu: tur, durum ve payload.stuckPageId (select: id, bullJobId, queuedAt, payload)
      findMany: vi.fn(async ({ where }: any) => jobsTable
        .filter((j) => j.type === where.type && (where.status?.in ?? []).includes(j.status) && (where.OR as any[]).some((c) => j.payload.stuckPageId === c.payload.equals))
        .sort((a, b) => b.queuedAt.getTime() - a.queuedAt.getTime())
        .map((j) => ({ id: j.id, bullJobId: j.bullJobId, queuedAt: j.queuedAt, payload: j.payload }))),
    },
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => (kv.has(where.key) ? { value: kv.get(where.key) } : null)),
      upsert: vi.fn(async ({ where, create, update }: any) => { kv.set(where.key, kv.has(where.key) ? update.value : create.value); return {}; }),
    },
    stuckPageRecovery: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `r${recoveries.length + 1}`, appliedAt: new Date(), ...data };
        recoveries.push(row);
        return { ...row };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const rows = recoveries.filter((r) => r.stuckPageId === where.stuckPageId && (!where.appliedAt?.gte || r.appliedAt.getTime() >= where.appliedAt.gte.getTime()));
        return rows.sort((a, b) => b.appliedAt - a.appliedAt)[0] ?? null;
      }),
      delete: vi.fn(async ({ where }: any) => { recoveries.splice(recoveries.findIndex((r) => r.id === where.id), 1); return {}; }),
    },
  };
  // Sahte BullMQ kuyrugu: oncelikli is 'prioritized' (bullmq 5 getJobState)
  let bullSeq = 0;
  const queue = {
    add: vi.fn(async (_name: string, _data: unknown, o: { priority?: number }) => {
      const id = `b${(bullSeq += 1)}`;
      bull.set(id, o?.priority ? 'prioritized' : 'waiting');
      return { id };
    }),
    getJob: vi.fn(async () => null),
    getJobState: vi.fn(async (id: string) => bull.get(id) ?? 'unknown'),
  };
  const jobs = new JobQueueService(prisma);
  (jobs as any).queue = queue;
  const settings = { getBoolean: vi.fn(async () => false) };
  const svc = new StuckPageRecoveryService(prisma, { notify: vi.fn() } as any, jobs, { runAudit: vi.fn(async () => ({ score: 50 })) } as any, settings as any);
  const llm = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(PROPOSAL) }] }));
  (svc as any).anthropic = { messages: { create: llm } };
  /** Haftalik taramanin kuyruga attigi otopilot isi (runStuckPageSweep ile ayni veri) */
  const autopilotJob = (stuckPageId: string) => jobs.enqueue({
    type: 'STUCK_PAGE_RECOVER', userId: 'owner-1', siteId: 's1',
    payload: { stuckPageId, triggeredBy: 'autopilot', requestedAt: new Date().toISOString() },
    priority: STUCK_RECOVER_JOB_PRIORITY,
  });
  /** Kuyruktaki isi worker gibi calistir (BullMQ 'active', sonra bitti) */
  const runJob = async (dbJobId: string) => {
    const j = jobsTable.find((x) => x.id === dbJobId)!;
    bull.set(j.bullJobId!, 'active');
    j.status = 'PROCESSING';
    const r = await svc.recover(j.payload.stuckPageId, { triggeredBy: j.payload.triggeredBy, jobId: j.bullJobId!, requestedAt: j.payload.requestedAt });
    bull.set(j.bullJobId!, 'completed');
    j.status = 'COMPLETED';
    return r;
  };
  return { svc, prisma, jobs, queue, settings, llm, store, jobsTable, bull, recoveries, autopilotJob, runJob, byId };
}

describe('S9 yan etkisi — yonetici (ADMIN) kuyruga alma anindaki plan kapisindan muaf (PlanFeatureGuard gibi)', () => {
  it('site sahibinin plani Takili Sayfalar\'i kapsamiyor: yoneticinin toplu onarimi kuyruga girer; sahibin kendi istegi reddedilir', async () => {
    const w = world({ pages: ['p1', 'p2'], ownerPlan: 'STARTER', actors: { 'admin-1': 'ADMIN', 'owner-1': 'USER' } });
    const admin = await w.svc.queueBatch('s1', ['p1'], 'admin-1', 50);
    expect(admin.results).toEqual([{ stuckPageId: 'p1', id: 'p1', queued: true, jobId: 'job-1' }]);
    // Is site sahibine bagli, denetim kaydinda yonetici
    expect(w.jobsTable[0]).toMatchObject({ userId: 'owner-1', payload: { stuckPageId: 'p1', triggeredBy: 'admin-1' } });
    const owner = await w.svc.queueBatch('s1', ['p2'], 'owner-1', 50);
    expect(owner.results[0]).toMatchObject({ queued: false, notProcessed: true, code: 'plan' });
    expect(owner.results[0].reason).toContain('planına dahildir; düzeltme kuyruğa alınmadı.');
  });

  it('rol yalniz kapi kapaliyken okunur; okunamazsa ya da rol yuzeyi yoksa kapi uygulanir', async () => {
    const pro = world({ ownerPlan: 'PRO', actors: { 'admin-1': 'ADMIN' } });
    expect((await pro.svc.queueBatch('s1', ['p1'], 'user-9', 50)).results[0]).toMatchObject({ queued: true });
    expect(pro.prisma.user.findUnique).not.toHaveBeenCalled();

    const broken = world({ ownerPlan: 'STARTER' });
    broken.prisma.user.findUnique.mockRejectedValueOnce(new Error('DB yok'));
    expect((await broken.svc.queueBatch('s1', ['p1'], 'admin-1', 50)).results[0]).toMatchObject({ code: 'plan' });

    // Eski cagiran (rol yuzeyi yok): yonetici taninmaz, kapi uygulanir
    const enqueue = vi.fn();
    const r = await queueStuckRecoveries({
      prisma: {
        site: { findUnique: async () => ({ userId: 'owner-1', user: { plan: 'STARTER' } }) },
        stuckPage: { findMany: async () => [{ id: 'p1', status: 'DETECTED' }] },
      },
      jobs: { enqueue },
    }, { siteId: 's1', stuckPageIds: ['p1'], triggeredBy: 'admin-1', max: 50 });
    expect(r.results[0]).toMatchObject({ code: 'plan' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('S19 yan etkisi — kullanicinin istegini yalniz bekleyen KULLANICI isi karsilar', () => {
  it('bekleyen otopilot isi varken kullanicinin secimi kendi isini kuyruga alir ("zaten sırada" denmez)', async () => {
    const w = world();
    await w.autopilotJob('p1');
    const r = await w.svc.queueBatch('s1', ['p1'], 'user-9', 50);
    // Eskiden: { queued: false, code: 'already_queued', jobId: 'job-1' } (otopilot isi)
    expect(r.results).toEqual([{ stuckPageId: 'p1', id: 'p1', queued: true, jobId: 'job-2' }]);
    expect(w.jobsTable.map((j) => j.payload.triggeredBy)).toEqual(['autopilot', 'user-9']);
  });

  it('bekleyen kullanici isi (baska bir kullanicinin da) yine "zaten sırada" der; otopilot isi de bekliyorsa satir kullanici isini gosterir', async () => {
    const w = world();
    await w.autopilotJob('p1');
    const first = await w.svc.queueBatch('s1', ['p1'], 'user-9', 50);
    expect(first.results[0]).toMatchObject({ queued: true, jobId: 'job-2' });
    for (const actor of ['user-9', 'admin-1']) {
      const again = await w.svc.queueBatch('s1', ['p1'], actor, 50);
      expect(again.results, actor).toEqual([{ stuckPageId: 'p1', id: 'p1', queued: false, notProcessed: true, code: 'already_queued', reason: STUCK_ALREADY_QUEUED, jobId: 'job-2' }]);
    }
    expect(w.jobsTable).toHaveLength(2);
  });

  it('ikinci asama isi (triggeredBy tasimaz) her istegi karsilamaya devam eder', async () => {
    const w = world();
    await w.jobs.enqueue({ type: 'STUCK_PAGE_RECOVER', userId: 'owner-1', siteId: 's1', payload: { phase: 'republish', stuckPageId: 'p1', recoveryId: 'r1', articleId: 'a-p1', mode: 'recover' } });
    const r = await w.svc.queueBatch('s1', ['p1'], 'user-9', 50);
    expect(r.results[0]).toMatchObject({ queued: false, code: 'already_queued', jobId: 'job-1' });
  });

  it('uctan uca: site Yari otomatige gecti — otopilot isi atlar, kullanicinin isi kosar; yapay zeka TAM bir kez', async () => {
    const w = world({ approval: 'manual_approve' });
    const auto = await w.autopilotJob('p1');
    const user = await w.svc.queueBatch('s1', ['p1'], 'user-9', 50);
    expect(user.results[0]).toMatchObject({ queued: true, jobId: 'job-2' });
    // BullMQ ayni oncelikte sirayla verir: once otopilot isi
    expect(await w.runJob(String(auto.dbJobId))).toEqual({ success: false, skipped: true, reason: autoRecoveryBlockText('manual_approve') });
    expect(w.llm).not.toHaveBeenCalled();
    // Eskiden musterinin istegi burada biterdi; simdi kendi isi duzeltmeyi yapar
    expect(await w.runJob('job-2')).toMatchObject({ success: true, needsRepublish: true });
    expect(w.llm).toHaveBeenCalledTimes(1);
    expect(w.recoveries).toHaveLength(1);
  });

  it('uctan uca: otopilot kurallari gecerse once o duzeltir; kullanicinin isi yapay zeka cagirmadan atlar', async () => {
    const w = world({ approval: 'auto_publish' });
    const auto = await w.autopilotJob('p1');
    const user = await w.svc.queueBatch('s1', ['p1'], 'user-9', 50);
    expect(user.results[0]).toMatchObject({ queued: true });
    const userJobId = user.results[0].jobId!;
    expect(w.jobsTable.find((j) => j.id === userJobId)?.payload.triggeredBy).toBe('user-9');
    expect(await w.runJob(String(auto.dbJobId))).toMatchObject({ success: true });
    expect(w.llm).toHaveBeenCalledTimes(1);
    // Sayfa otopilot isinin sahipliginde (ikinci asama kuyrukta): kullanici isi yapay zeka cagirmaz
    const second = await w.runJob(userJobId);
    expect(second).toMatchObject({ success: false, skipped: true });
    expect(w.llm).toHaveBeenCalledTimes(1);
    expect(w.recoveries).toHaveLength(1);
  });
});

describe('S24 yan etkisi — kuyruga hic eklenemeyen is "zaten sırada" saydirmaz', () => {
  it(`BullMQ kimligi olmayan kayit ${STUCK_UNQUEUED_JOB_GRACE_MS / 1000} sn boyunca eklenmekte sayilir; daha eskisi engel degil`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const T0 = Date.parse('2026-10-19T08:00:00.000Z');
    vi.setSystemTime(T0);
    const w = world();
    // Baska bir istek su an kuyruga ekliyor (kimlik henuz yazilmadi)
    w.jobsTable.push({ id: 'job-x', type: 'STUCK_PAGE_RECOVER', status: 'QUEUED', bullJobId: null, queuedAt: new Date(T0 - 10_000), payload: { stuckPageId: 'p1', triggeredBy: 'user-9' } });
    expect((await w.svc.queueBatch('s1', ['p1'], 'user-9', 50)).results[0]).toMatchObject({ queued: false, code: 'already_queued', jobId: 'job-x' });
    // Ayni kayit 31 sn sonra hala kimliksiz: eklenemedi (surec oldu), engel sayilmaz
    vi.setSystemTime(T0 + STUCK_UNQUEUED_JOB_GRACE_MS - 10_000 + 1_000);
    expect((await w.svc.queueBatch('s1', ['p1'], 'user-9', 50)).results[0]).toMatchObject({ queued: true, jobId: 'job-2' });
  });

  it('uctan uca (gercek JobQueueService): ilk istekte BullMQ eklemesi hata verdi; kayit FAILED, bir dakika sonraki yeniden deneme kuyruga alinir', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const T0 = Date.parse('2026-10-19T08:00:00.000Z');
    vi.setSystemTime(T0);
    const w = world();
    w.queue.add.mockRejectedValueOnce(new Error('Connection is closed.'));
    const first = await w.svc.queueBatch('s1', ['p1'], 'user-9', 50);
    expect(first.results[0]).toEqual({ stuckPageId: 'p1', id: 'p1', queued: false, error: 'Düzeltme kuyruğa alınamadı; biraz sonra tekrar dene.' });
    expect(w.jobsTable[0]).toMatchObject({ status: 'FAILED', bullJobId: null, error: 'İş kuyruğa eklenemedi: Connection is closed.' });
    // Musteri "biraz sonra" yeniden dener (eskiden 5 dk boyunca "zaten sırada" + 30 dk donen kart)
    vi.setSystemTime(T0 + 60_000);
    const retry = await w.svc.queueBatch('s1', ['p1'], 'user-9', 50);
    expect(retry.results).toEqual([{ stuckPageId: 'p1', id: 'p1', queued: true, jobId: 'job-2' }]);
    expect(w.bull.get(w.jobsTable[1].bullJobId!)).toBe('prioritized');
  });
});
