import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ADMIN_CANCEL_ERROR, JobCanceledError, cancelSiteJobs, isJobCanceledError, jobCancelCheck,
  removeCanceledOnboardingArticles, siteJobStates,
} from './site-job-cancel.js';
import { SitesService } from '../sites/sites.service.js';
import { AdminController } from '../admin/admin.controller.js';
import { SESSION_ONLY_KEY } from '../auth/session-only.decorator.js';
import { SITE_STATUS_REPAIR_WHERE } from '../sites/site-status-repair.js';

/**
 * Yoneticinin "Durdur"u (sahip istegi 21.11.2026): yanlislikla baslatilan tarama ve
 * olcum, worker'i yeniden baslatmadan (baska sitelerin zincirine dokunmadan) durur;
 * site listesinde "Vazgecildi" gorunur. Kural: site-job-cancel.ts.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('jobCancelCheck — calisan isin adim siniri denetimi', () => {
  const prismaWith = (row: { status: string } | null | Error) => ({
    job: {
      findUnique: vi.fn(async () => {
        if (row instanceof Error) throw row;
        return row;
      }),
    },
  });

  it('is satiri CANCELED ise JobCanceledError firlatir (adim adiyla)', async () => {
    const prisma = prismaWith({ status: 'CANCELED' });
    const check = jobCancelCheck(prisma, 'b1');
    const err = await check('konu motoru oncesi').catch((e) => e);
    expect(err).toBeInstanceOf(JobCanceledError);
    expect(isJobCanceledError(err)).toBe(true);
    expect(err.step).toBe('konu motoru oncesi');
    expect(prisma.job.findUnique).toHaveBeenCalledWith({ where: { bullJobId: 'b1' }, select: { status: true } });
  });

  it.each([
    ['calisan is', { status: 'PROCESSING' }],
    ['kaydi olmayan is (cron tekrari)', null],
    ['okunamayan satir (DB hatasi isi dusurmez)', new Error('db yok')],
  ])('%s: devam eder', async (_l, row) => {
    await expect(jobCancelCheck(prismaWith(row as any), 'b1')('adim')).resolves.toBeUndefined();
  });

  it('BullMQ kimligi yoksa sorgu bile atmaz', async () => {
    const prisma = prismaWith({ status: 'CANCELED' });
    await expect(jobCancelCheck(prisma, undefined)('adim')).resolves.toBeUndefined();
    expect(prisma.job.findUnique).not.toHaveBeenCalled();
  });

  it('isJobCanceledError siradan hatayi iptal saymaz', () => {
    expect(isJobCanceledError(new Error('x'))).toBe(false);
    expect(isJobCanceledError(null)).toBe(false);
    expect(isJobCanceledError({ jobCanceled: true })).toBe(true);
  });
});

function fakeDb(opts: {
  jobs?: Array<{ id: string; type: string; status: string; bullJobId: string | null; queuedAt: Date }>;
  articles?: Array<{ id: string; status: string; agentOutputs: unknown }>;
  updated?: number;
} = {}) {
  return {
    job: {
      findMany: vi.fn(async () => opts.jobs ?? []),
      updateMany: vi.fn(async () => ({ count: opts.updated ?? (opts.jobs ?? []).length })),
    },
    article: {
      findMany: vi.fn(async () => opts.articles ?? []),
      deleteMany: vi.fn(async (args: any) => ({ count: args.where.id.in.length })),
    },
  };
}

const T0 = new Date('2026-11-21T10:00:00Z');

describe('cancelSiteJobs — API tarafi', () => {
  it('canli isleri CANCELED yapar, bekleyeni kuyruktan siler, calisani adim sinirina birakir', async () => {
    const prisma = fakeDb({
      jobs: [
        { id: 'j1', type: 'ONBOARDING_CHAIN', status: 'PROCESSING', bullJobId: '11', queuedAt: T0 },
        { id: 'j2', type: 'GENERATE_ARTICLE', status: 'QUEUED', bullJobId: '12', queuedAt: new Date(T0.getTime() + 60_000) },
      ],
      articles: [{ id: 'a1', status: 'GENERATING', agentOutputs: { allowanceCharge: { at: T0.toISOString(), source: 'onboarding_free' } } }],
    });
    const removeJob = vi.fn(async () => true);
    const now = new Date('2026-11-21T10:05:00Z');
    const r = await cancelSiteJobs({ prisma, removeJob }, 's1', { now });

    expect(r).toEqual({ canceled: 2, running: 1, removedFromQueue: 1, deletedArticles: 1 });
    expect((prisma.job.findMany.mock.calls[0] as any[])[0]).toMatchObject({ where: { siteId: 's1', status: { in: ['QUEUED', 'PROCESSING'] } } });
    // Kosullu: arada biten is geri CANCELED'a cekilmez; iz Job.error'da
    expect(prisma.job.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['j1', 'j2'] }, status: { in: ['QUEUED', 'PROCESSING'] } },
      data: { status: 'CANCELED', error: ADMIN_CANCEL_ERROR, finishedAt: now },
    });
    // Calisan is silinemez (kilitli); yalniz bekleyen silinir
    expect(removeJob).toHaveBeenCalledTimes(1);
    expect(removeJob).toHaveBeenCalledWith('12');
    // Kurulumun yazilari zincirin kuyruga girdigi andan sonrakiler
    expect((prisma.article.findMany.mock.calls[0] as any[])[0].where).toMatchObject({
      siteId: 's1', createdAt: { gte: T0 }, status: { in: ['SCHEDULED', 'GENERATING'] }, publishedAt: null, bodyMd: null,
    });
  });

  it('takvimin gecikmeli uretim tetigine (gen:article:*) dokunmaz', async () => {
    const prisma = fakeDb({
      jobs: [
        { id: 'j1', type: 'GENERATE_ARTICLE', status: 'QUEUED', bullJobId: 'gen:article:a9', queuedAt: T0 },
        { id: 'j2', type: 'SITE_AUDIT', status: 'QUEUED', bullJobId: '20', queuedAt: T0 },
      ],
    });
    const removeJob = vi.fn(async () => true);
    const r = await cancelSiteJobs({ prisma, removeJob }, 's1');
    expect((prisma.job.updateMany.mock.calls[0] as any[])[0].where.id.in).toEqual(['j2']);
    expect(removeJob).toHaveBeenCalledWith('20');
    expect(removeJob).not.toHaveBeenCalledWith('gen:article:a9');
    // Kurulum zinciri iptal edilmediyse yazi silinmez
    expect(prisma.article.findMany).not.toHaveBeenCalled();
    expect(r.deletedArticles).toBe(0);
  });

  it('canli is yoksa hicbir sey yazmaz', async () => {
    const prisma = fakeDb();
    const r = await cancelSiteJobs({ prisma, removeJob: vi.fn(async () => true) }, 's1');
    expect(r).toEqual({ canceled: 0, running: 0, removedFromQueue: 0, deletedArticles: 0 });
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
  });

  it('kuyruktan silme hatasi ve yazi temizligi hatasi iptali dusurmez', async () => {
    const prisma = fakeDb({ jobs: [{ id: 'j1', type: 'ONBOARDING_CHAIN', status: 'QUEUED', bullJobId: '30', queuedAt: T0 }] });
    prisma.article.findMany.mockRejectedValueOnce(new Error('db'));
    const removeJob = vi.fn(async () => { throw new Error('redis yok'); });
    const r = await cancelSiteJobs({ prisma, removeJob }, 's1');
    expect(r).toEqual({ canceled: 1, running: 0, removedFromQueue: 0, deletedArticles: 0 });
  });
});

describe('removeCanceledOnboardingArticles — uretilmemis kurulum yazilari', () => {
  it('isaretsiz ve ucretsiz ilk yaziyi siler; hakki dusulmus yaziya dokunmaz', async () => {
    const db = fakeDb({
      articles: [
        { id: 'free', status: 'GENERATING', agentOutputs: { allowanceCharge: { at: 'x', source: 'onboarding_free' } } },
        { id: 'plain', status: 'SCHEDULED', agentOutputs: null },
        { id: 'charged', status: 'GENERATING', agentOutputs: { allowanceCharge: { at: 'y', source: 'calendar' } } },
      ],
    });
    expect(await removeCanceledOnboardingArticles(db, 's1', T0)).toBe(2);
    // Silme de kosullu: arada uretime gecen / yayinlanan yazi silinmez
    expect(db.article.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['free', 'plain'] }, siteId: 's1', status: { in: ['SCHEDULED', 'GENERATING'] }, publishedAt: null, bodyMd: null },
    });
  });

  it('silinecek yazi yoksa silme cagrisi yok', async () => {
    const db = fakeDb({ articles: [{ id: 'charged', status: 'SCHEDULED', agentOutputs: { allowanceCharge: { at: 'y', source: 'user_start' } } }] });
    expect(await removeCanceledOnboardingArticles(db, 's1', T0)).toBe(0);
    expect(db.article.deleteMany).not.toHaveBeenCalled();
  });
});

describe('siteJobStates — liste rozeti ve Durdur dugmesinin girdisi', () => {
  const at = (m: number) => new Date(T0.getTime() + m * 60_000);

  it('canli is → running; en son tarama iptal → canceled; sonra yeni tarama → artik degil', () => {
    const states = siteJobStates(
      ['a', 'b', 'c', 'd'],
      [{ siteId: 'a', bullJobId: '1' }, { siteId: 'd', bullJobId: 'gen:article:x' }],
      new Map([['b', at(5)], ['c', at(9)]]),
      new Map([['b', at(5)], ['c', at(5)]]),
    );
    expect(states.get('a')).toEqual({ running: true, canceled: false });
    expect(states.get('b')).toEqual({ running: false, canceled: true });
    // Iptalden sonra yeniden tarandi (kurulum yeniden baslatildi)
    expect(states.get('c')).toEqual({ running: false, canceled: false });
    // Takvim tetigi "calisan tarama" sayilmaz
    expect(states.get('d')).toEqual({ running: false, canceled: false });
  });

  it('iptalden SONRA olcum yapildiysa "Vazgecildi" degil; kurulumun iptal oncesi olcumu sayilmaz', () => {
    const scan = new Map([['e', at(0)], ['f', at(0)], ['g', at(0)]]);
    const states = siteJobStates(['e', 'f', 'g'], [], scan, scan, {
      canceledAt: new Map([['e', at(10)], ['f', at(10)], ['g', at(10)]]),
      // e: iptalden sonra elle olculdu; f: yalniz kurulumun kendi olcumu (iptalden once); g: olcum yok
      lastMeasuredAt: new Map([['e', at(60)], ['f', at(8)]]),
    });
    expect(states.get('e')).toEqual({ running: false, canceled: false });
    expect(states.get('f')).toEqual({ running: false, canceled: true });
    expect(states.get('g')).toEqual({ running: false, canceled: true });
  });
});

describe('SitesService.list — is durumu yalniz yoneticiye', () => {
  function svc() {
    const prisma = {
      site: { findMany: vi.fn(async () => [{ id: 's1', status: 'ONBOARDING' }, { id: 's2', status: 'ACTIVE' }]) },
      job: {
        findMany: vi.fn(async () => [{ siteId: 's2', bullJobId: '5' }]),
        groupBy: vi.fn(async (args: any) => (args.where.status === 'CANCELED'
          ? [{ siteId: 's1', _max: { queuedAt: T0, finishedAt: T0 } }]
          : [{ siteId: 's1', _max: { queuedAt: T0 } }, { siteId: 's2', _max: { queuedAt: T0 } }])),
      },
      aiCitationRun: { groupBy: vi.fn(async () => [] as any[]) },
    };
    return { s: new SitesService(prisma as any, {} as any, {} as any), prisma };
  }

  it('yonetici: her siteye jobState eklenir', async () => {
    const { s, prisma } = svc();
    const rows: any[] = await s.list({ id: 'admin', role: 'ADMIN' });
    expect(rows.map((r) => [r.id, r.jobState])).toEqual([
      ['s1', { running: false, canceled: true }],
      ['s2', { running: true, canceled: false }],
    ]);
    const groupWhere = (prisma.job.groupBy.mock.calls[0] as any[])[0].where;
    expect(groupWhere.type).toEqual({ in: ['ONBOARDING_CHAIN', 'SITE_AUDIT'] });
  });

  it('yonetici: iptalden sonra olculen site "Vazgecildi" sayilmaz', async () => {
    const { s, prisma } = svc();
    prisma.aiCitationRun.groupBy.mockResolvedValueOnce([{ siteId: 's1', _max: { runAt: new Date(T0.getTime() + 3_600_000) } }]);
    const rows: any[] = await s.list({ id: 'admin', role: 'ADMIN' });
    expect(rows.find((r) => r.id === 's1').jobState).toEqual({ running: false, canceled: false });
  });

  it('musteri: liste eskisi gibi — ek sorgu ve alan yok', async () => {
    const { s, prisma } = svc();
    const rows: any[] = await s.list({ id: 'u1', role: 'USER' });
    expect(rows).toEqual([{ id: 's1', status: 'ONBOARDING' }, { id: 's2', status: 'ACTIVE' }]);
    expect(prisma.job.findMany).not.toHaveBeenCalled();
    expect(prisma.job.groupBy).not.toHaveBeenCalled();
    expect((prisma.site.findMany.mock.calls[0] as any[])[0].where).toEqual({ userId: 'u1' });
  });

  it('is durumu okunamazsa liste yine doner (rozet eski haliyle)', async () => {
    const { s, prisma } = svc();
    prisma.job.groupBy.mockRejectedValueOnce(new Error('db'));
    const rows: any[] = await s.list({ id: 'admin', role: 'ADMIN' });
    expect(rows.every((r) => r.jobState === undefined)).toBe(true);
  });
});

describe('POST /admin/sites/:siteId/cancel-jobs', () => {
  function ctrl(site: { id: string } | null = { id: 's1' }) {
    const prisma = {
      site: { findUnique: vi.fn(async () => site) },
      ...fakeDb({ jobs: [{ id: 'j1', type: 'ONBOARDING_CHAIN', status: 'QUEUED', bullJobId: '7', queuedAt: T0 }] }),
    };
    const jobQueue = { removeJob: vi.fn(async () => true) };
    const c = new AdminController({} as any, {} as any, {} as any, jobQueue as any, prisma as any, {} as any);
    return { c, prisma, jobQueue };
  }
  const req = (role: string) => ({ user: { id: 'u1', role } }) as any;

  it('yalniz panel oturumuyla (API anahtari 403)', () => {
    const flag = new Reflector().getAllAndOverride<boolean>(SESSION_ONLY_KEY, [AdminController.prototype.cancelJobs, AdminController]);
    expect(flag).toBe(true);
  });

  it('yonetici olmayan 403 alir, hicbir sey iptal edilmez', async () => {
    const { c, prisma } = ctrl();
    await expect(c.cancelJobs(req('USER'), 's1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
  });

  it('olmayan site 404', async () => {
    const { c } = ctrl(null);
    await expect(c.cancelJobs(req('ADMIN'), 'yok')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('yonetici: isler iptal edilir, bekleyen kuyruktan silinir', async () => {
    const { c, jobQueue } = ctrl();
    const r = await c.cancelJobs(req('ADMIN'), 's1');
    expect(r).toMatchObject({ ok: true, canceled: 1, removedFromQueue: 1 });
    expect(jobQueue.removeJob).toHaveBeenCalledWith('7');
  });
});

describe('iptal edilen kurulum otomatik onarimla ACTIVE olmaz', () => {
  it('onarim yalniz COMPLETED zincir ya da kurulum Kaydet kanitini kabul eder', () => {
    // site-status-repair.ts: CANCELED zincir "kurulumu bitti" kaniti degil
    expect(SITE_STATUS_REPAIR_WHERE.OR).toEqual([
      { onboardingCompletedAt: { not: null } },
      { jobs: { some: { type: 'ONBOARDING_CHAIN', status: 'COMPLETED' } } },
    ]);
  });
});

describe('worker: adim sinirlari ve iptal sonucu (kaynak denetimi)', () => {
  const worker = fs.readFileSync(path.resolve(HERE, '../../../worker/src/index.ts'), 'utf8');
  const chain = worker.slice(worker.indexOf('ONBOARDING_CHAIN: async'), worker.indexOf('PROCESS_SCHEDULED: async'));

  it('zincir pahali her adimdan once is satirina bakar', () => {
    for (const step of ['beyin ve denetim sonrasi', 'konu motoru oncesi', 'takvim yerlesimi oncesi', 'auto-fix oncesi', 'kurulum sonu']) {
      expect(chain, step).toContain(`await iptal('${step}')`);
    }
    // Olcum kapanisi asistanlara sormadan once bakar; denetim taramadan sonra
    expect(chain).toContain("await iptal('kurulum olcumu oncesi')");
    expect(chain).toContain('iptalKontrol: iptal');
    // Siralama: denetim → konu motoru → takvim → auto-fix → ACTIVE
    const order = ['beyin ve denetim sonrasi', 'services.topics.runEngine', 'takvim yerlesimi oncesi', 'scheduleInitialBatch', 'auto-fix oncesi', 'runAutoFix', 'kurulum sonu', "status: 'ACTIVE'"];
    const idx = order.map((s) => chain.indexOf(s));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('denetim taramadan sonra, ucretli adimlardan (PageSpeed, GEO, AI) once bakar', () => {
    const audit = fs.readFileSync(path.resolve(HERE, '../audit/audit.service.ts'), 'utf8');
    const run = audit.slice(audit.indexOf('async runAudit('));
    const check = run.indexOf("await opts.iptalKontrol('denetim taramasi sonrasi')");
    expect(check).toBeGreaterThan(run.indexOf('this.crawler.crawl('));
    expect(check).toBeLessThan(run.indexOf('this.pagespeed.runAudit('));
  });

  it('makale hatti baslamadan once bakar', () => {
    const gen = worker.slice(worker.indexOf('GENERATE_ARTICLE: async'), worker.indexOf('PUBLISH_ARTICLE: async'));
    expect(gen.indexOf("('makale hatti oncesi')")).toBeGreaterThan(0);
    expect(gen.indexOf("('makale hatti oncesi')")).toBeLessThan(gen.indexOf('services.pipeline.runPipeline'));
  });

  it('iptal hatasi isi CANCELED birakir: completed/failed olaylari CANCELED satiri ezmez', () => {
    expect(worker).toContain("if (isJobCanceledError(err)) {");
    expect(worker).toContain("const canceled: AccountSkip = { skipped: true, reason: 'job_canceled' };");
    expect(worker).toMatch(/status === 'COMPLETED' \? \{ status: \{ not: 'CANCELED' as const \} \}/);
    const failed = worker.slice(worker.indexOf("worker.on('failed'"), worker.indexOf("worker.on('failed'") + 800);
    expect(failed).toContain("status: { not: 'CANCELED' }");
  });
});

describe('panel: rozet ve Durdur dugmesi', async () => {
  const WEB = path.resolve(HERE, '../../../web/src');
  const lib = await import(/* @vite-ignore */ path.join(WEB, 'lib/site-list-status.ts'));
  const statusLabel = (s: string | null | undefined) => `L:${s}`;

  it('kurulumdaki site durdurulduysa "Vazgeçildi" (notr gri)', () => {
    for (const status of ['ONBOARDING', 'AUDIT_PENDING', 'AUDIT_COMPLETE']) {
      expect(lib.siteListBadge({ status, jobState: { running: false, canceled: true } }, statusLabel)).toEqual({ label: 'Vazgeçildi', tone: 'secondary' });
    }
  });

  it('kurulumu bitmis site durumunu gostermeye devam eder; yeniden calisiyorsa da', () => {
    expect(lib.siteListBadge({ status: 'ACTIVE', jobState: { running: false, canceled: true } }, statusLabel)).toEqual({ label: 'L:ACTIVE', tone: 'success' });
    expect(lib.siteListBadge({ status: 'ONBOARDING', jobState: { running: true, canceled: true } }, statusLabel)).toEqual({ label: 'L:ONBOARDING', tone: 'warning' });
    // Musterinin listesinde jobState yok: eski davranis
    expect(lib.siteListBadge({ status: 'AUDIT_PENDING' }, statusLabel)).toEqual({ label: 'L:AUDIT_PENDING', tone: 'info' });
  });

  it('Durdur yalniz yoneticiye ve yalniz canli is varken', () => {
    expect(lib.canStopSiteJobs({ jobState: { running: true } }, true)).toBe(true);
    expect(lib.canStopSiteJobs({ jobState: { running: true } }, false)).toBe(false);
    expect(lib.canStopSiteJobs({ jobState: { running: false } }, true)).toBe(false);
    expect(lib.canStopSiteJobs({}, true)).toBe(false);
  });

  it('liste sayfasi rozeti ve dugmeyi bu kurallardan cizer, onay metni sahibin cumlesi', () => {
    const page = fs.readFileSync(path.join(WEB, 'app/(dashboard)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain("session?.user?.role === 'ADMIN'");
    expect(page).toContain('canStopSiteJobs(s, isAdmin)');
    expect(page).toContain('siteListBadge(site');
    expect(page).toContain('Arka plandaki tarama ve ölçüm durdurulsun mu? Harcanan kısım geri gelmez.');
    const api = fs.readFileSync(path.join(WEB, 'lib/api.ts'), 'utf8');
    expect(api).toContain('/admin/sites/${encodeURIComponent(siteId)}/cancel-jobs');
  });
});
