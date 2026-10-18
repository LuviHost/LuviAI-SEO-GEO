import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ArticlesService, TRIGGER_NOW_LIVE_REFUSED } from './articles.service.js';
import { decideGeneratedArticlePublish } from './publish-approval.js';

/**
 * ArticlesService — acik uretim istekleri.
 *  - queueGeneration: hedef secilerek "uret ve yayinla" denmisse bu onayin
 *    kendisidir (publishApproved); Yari otomatikte bekletilmez.
 *  - triggerNow ("Simdi uret"): sahiplenme atomik; zaten uretilen yazi ikinci kez
 *    uretime girmez, kota iki kez dusmez.
 * Vitest dekorator metadatasi uretmez: servis elle kurulur.
 */

type Row = { id: string; siteId: string; topic: string; status: string; site: any };

function build(opts: { rows?: Row[]; site?: any } = {}) {
  const rows = opts.rows ?? [];
  const site = opts.site ?? { id: 's1', userId: 'u1', language: 'tr' };
  const prisma = {
    site: { findUniqueOrThrow: vi.fn(async () => site) },
    article: {
      create: vi.fn(async ({ data }: any) => ({ id: 'a-new', ...data })),
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.siteId === where.siteId) ?? null),
      // Kosullu guncelleme: yalniz where.status hala gecerliyse yazar (tek SQL UPDATE gibi)
      updateMany: vi.fn<(args: any) => Promise<{ count: number }>>(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id && (where.siteId === undefined || r.siteId === where.siteId) && r.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };
  const jobQueue = {
    enqueue: vi.fn<(opts: any) => Promise<{ dbJobId: string; bullJobId: string }>>(async () => ({ dbJobId: 'j1', bullJobId: '7' })),
    removeJob: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  };
  const quota = {
    enforceArticleQuota: vi.fn(async () => undefined),
    incrementArticleUsage: vi.fn(async () => undefined),
  };
  const svc = new ArticlesService(prisma as any, jobQueue as any, quota as any, {} as any);
  return { svc, prisma, jobQueue, quota, rows };
}

const siteRow = (over: Record<string, unknown> = {}) => ({
  id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'manual_approve',
  user: { id: 'u1' }, publishTargets: [{ id: 't1' }], ...over,
});
const row = (status: string, site = siteRow()): Row => ({ id: 'a1', siteId: 's1', topic: 'Konu', status, site });

describe('queueGeneration — acik "uret ve yayinla" istegi', () => {
  it('hedef secilmisse publishApproved: worker Yari otomatikte de yayinlar (kullanicinin onayi)', async () => {
    const { svc, jobQueue, quota } = build();
    await svc.queueGeneration('s1', 'Konu', ['t1']);
    const job = jobQueue.enqueue.mock.calls[0][0] as any;
    expect(job.payload).toMatchObject({ articleId: 'a-new', targetIds: ['t1'], autoPublish: true, publishApproved: true });
    expect(quota.incrementArticleUsage).toHaveBeenCalledTimes(1);

    // Uctan uca: worker'in karari (site Yari otomatik) bu is verisiyle yayin
    const siteReader = { site: { findUnique: vi.fn(async () => ({ autopilot: true, publishApprovalMode: 'manual_approve' })) } };
    expect(await decideGeneratedArticlePublish(siteReader as any, { siteId: 's1', ...job.payload }))
      .toEqual({ publish: true, reason: 'user_approved', targetIds: ['t1'] });
  });

  it('hedefsiz istek (panel "Uret", MCP): yayin istenmez, onay bayragi YOK', async () => {
    for (const targets of [undefined, []]) {
      const { svc, jobQueue } = build();
      await svc.queueGeneration('s1', 'Konu', targets);
      const payload = (jobQueue.enqueue.mock.calls[0][0] as any).payload;
      expect(payload.autoPublish).toBe(false);
      expect(payload).not.toHaveProperty('publishApproved');
    }
  });
});

describe('triggerNow — "Simdi uret" atomik sahiplenir', () => {
  it('takvimdeki yazi: kosullu GENERATING, uretim isi, gecikmeli takvim isi silinir, kota bir kez', async () => {
    const ctx = build({ rows: [row('SCHEDULED')] });
    const r = await ctx.svc.triggerNow('s1', 'a1');
    expect(r).toMatchObject({ dbJobId: 'j1', articleId: 'a1' });
    expect(ctx.prisma.article.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', siteId: 's1', status: 'SCHEDULED' }, data: { status: 'GENERATING' } });
    const job = ctx.jobQueue.enqueue.mock.calls[0][0] as any;
    expect(job).toMatchObject({ type: 'GENERATE_ARTICLE', userId: 'u1', siteId: 's1' });
    // Yari otomatik: yayin istenmez (takvim isiyle ayni kural); hedefler is kaydinda
    expect(job.payload).toMatchObject({ articleId: 'a1', autoPublish: false, targetIds: ['t1'] });
    expect(ctx.jobQueue.removeJob).toHaveBeenCalledWith('gen:article:a1');
    expect(ctx.quota.incrementArticleUsage).toHaveBeenCalledTimes(1);
    expect(ctx.rows[0].status).toBe('GENERATING');
  });

  it('Tam otomatik + akis acik: varsayilan hedefe yayin istenir', async () => {
    const ctx = build({ rows: [row('SCHEDULED', siteRow({ publishApprovalMode: 'auto_publish' }))] });
    await ctx.svc.triggerNow('s1', 'a1');
    expect((ctx.jobQueue.enqueue.mock.calls[0][0] as any).payload).toMatchObject({ autoPublish: true, targetIds: ['t1'] });
  });

  it('cift tiklama: ikinci istek "zaten uretiliyor" (400), ikinci uretim ve ikinci kota yok', async () => {
    const ctx = build({ rows: [row('SCHEDULED')] });
    await ctx.svc.triggerNow('s1', 'a1');
    await expect(ctx.svc.triggerNow('s1', 'a1')).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(ctx.quota.incrementArticleUsage).toHaveBeenCalledTimes(1);
  });

  it('uretimde ya da bitmis yazi tetiklenmez; kota bile denetlenmez', async () => {
    for (const status of ['GENERATING', 'EDITING', 'READY_TO_PUBLISH', 'PUBLISHED', 'ARCHIVED']) {
      const ctx = build({ rows: [row(status)] });
      await expect(ctx.svc.triggerNow('s1', 'a1'), status).rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.quota.enforceArticleQuota).not.toHaveBeenCalled();
      expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    }
    const busy = build({ rows: [row('GENERATING')] });
    await expect(busy.svc.triggerNow('s1', 'a1')).rejects.toThrow('Bu yazı zaten üretiliyor.');
  });

  it('basarisiz / taslak / revizyondaki yazi yeniden uretime alinabilir', async () => {
    for (const status of ['FAILED', 'DRAFT', 'REVIZE_NEEDED']) {
      const ctx = build({ rows: [row(status)] });
      await ctx.svc.triggerNow('s1', 'a1');
      expect(ctx.prisma.article.updateMany, status).toHaveBeenCalledWith({ where: { id: 'a1', siteId: 's1', status }, data: { status: 'GENERATING' } });
      expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    }
  });

  it('okuma ile yazma arasinda takvim isi / saatlik tarama aldiysa (count 0): 400, kuyruk ve kota yok', async () => {
    const ctx = build({ rows: [row('SCHEDULED')] });
    ctx.prisma.article.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(ctx.svc.triggerNow('s1', 'a1')).rejects.toThrow('Bu yazı az önce üretime alındı.');
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    expect(ctx.quota.incrementArticleUsage).not.toHaveBeenCalled();
  });

  it('kuyruga atilamazsa yazi eski durumuna doner, kota dusulmez, hata firlar', async () => {
    const ctx = build({ rows: [row('FAILED')] });
    ctx.jobQueue.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    await expect(ctx.svc.triggerNow('s1', 'a1')).rejects.toThrow('redis yok');
    expect(ctx.prisma.article.updateMany).toHaveBeenLastCalledWith({ where: { id: 'a1', status: 'GENERATING' }, data: { status: 'FAILED' } });
    expect(ctx.rows[0].status).toBe('FAILED');
    expect(ctx.quota.incrementArticleUsage).not.toHaveBeenCalled();
    expect(ctx.jobQueue.removeJob).not.toHaveBeenCalled();
  });

  it('gecikmeli isin silinememesi istegi bozmaz (en iyi caba)', async () => {
    const ctx = build({ rows: [row('SCHEDULED')] });
    ctx.jobQueue.removeJob.mockRejectedValueOnce(new Error('kilitli'));
    await expect(ctx.svc.triggerNow('s1', 'a1')).resolves.toMatchObject({ articleId: 'a1' });
    expect(ctx.quota.incrementArticleUsage).toHaveBeenCalledTimes(1);
  });

  it('baska sitenin ya da olmayan yazi: 404', async () => {
    const ctx = build({ rows: [row('SCHEDULED')] });
    await expect(ctx.svc.triggerNow('s2', 'a1')).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('K11: YAYINDAKI yazi (bilinen canli kopyasi var) yeniden uretilmez — GENERATING olmaz, basarisiz uretim onu FAILED yapamaz; kota ve kuyruk yok', async () => {
    const wpLive = { targetId: 't1', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: 'https://s.example/yazi/' };
    for (const status of ['REVIZE_NEEDED', 'FAILED', 'DRAFT']) {
      const ctx = build({ rows: [{ ...row(status), publishedTo: [wpLive] } as Row] });
      await expect(ctx.svc.triggerNow('s1', 'a1'), status).rejects.toThrow(TRIGGER_NOW_LIVE_REFUSED);
      expect(ctx.rows[0].status, status).toBe(status);
      expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
      expect(ctx.quota.enforceArticleQuota).not.toHaveBeenCalled();
      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    }
  });

  it('K11: tek kopyasi cop kutusunda / kaydi basarisiz olan yazi yayinda sayilmaz — uretime alinabilir', async () => {
    for (const publishedTo of [
      [{ targetId: 't1', ok: true, externalId: '41', trashedAt: '2026-10-01T00:00:00.000Z' }],
      [{ targetId: 't1', ok: false, error: 'WP REST 403' }],
    ]) {
      const ctx = build({ rows: [{ ...row('REVIZE_NEEDED'), publishedTo } as Row] });
      await ctx.svc.triggerNow('s1', 'a1');
      expect(ctx.rows[0].status).toBe('GENERATING');
      expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    }
  });
});

describe('queuePublish — acik ustune yazma onayi (C1) ve yayini baslatan (D2)', () => {
  const pubRow = { id: 'a1', siteId: 's1', topic: 'K', status: 'PUBLISHED', qaStatus: null, site: { userId: 'u1' } } as unknown as Row;

  it('overwriteRemoteEdits yalniz true verilince is verisinde true; verilmezse false; is her zaman initiator "user" tasir', async () => {
    const ctx = build({ rows: [pubRow] });
    await ctx.svc.queuePublish('s1', 'a1', ['t1'], { overwriteRemoteEdits: true });
    await ctx.svc.queuePublish('s1', 'a1', [], {});
    const payloads = ctx.jobQueue.enqueue.mock.calls.map((c: any[]) => c[0].payload);
    expect(payloads).toEqual([
      { articleId: 'a1', targetIds: ['t1'], overrideQa: false, overwriteRemoteEdits: true, initiator: 'user' },
      { articleId: 'a1', targetIds: [], overrideQa: false, overwriteRemoteEdits: false, initiator: 'user' },
    ]);
    expect(ctx.jobQueue.enqueue.mock.calls[0][0]).toMatchObject({ type: 'PUBLISH_ARTICLE', userId: 'u1', siteId: 's1' });
  });
});
