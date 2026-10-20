import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

type Row = { id: string; siteId: string; topic: string; status: string; site: any; agentOutputs?: unknown };

function build(opts: { rows?: Row[]; site?: any; limit?: number } = {}) {
  const rows = opts.rows ?? [];
  const site = opts.site ?? { id: 's1', userId: 'u1', language: 'tr' };
  // Kosullu guncelleme: yalniz where.status (ve varsa hak isaretinin JSON yolu) hala
  // gecerliyse yazar (tek SQL UPDATE gibi)
  const statusOk = (r: Row, c: any) => (typeof c === 'string' ? r.status === c : Array.isArray(c?.in) ? c.in.includes(r.status) : true);
  const pathOk = (r: Row, c: any) => !c || ((r.agentOutputs as any)?.allowanceCharge?.at === c.equals && c.path === '$.allowanceCharge.at');
  const prisma: any = {
    site: { findUniqueOrThrow: vi.fn(async () => site) },
    article: {
      // Yer tutucu tabloya girer (iade yolu onu okur ve gunceller)
      create: vi.fn(async ({ data }: any) => {
        const created = { id: 'a-new', ...data, site: { userId: site.userId, user: { plan: 'TRIAL', articlesQuotaResetAt: new Date(0) } } };
        rows.push(created);
        return created;
      }),
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.siteId === where.siteId) ?? null),
      findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      updateMany: vi.fn<(args: any) => Promise<{ count: number }>>(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id && (where.siteId === undefined || r.siteId === where.siteId) && statusOk(r, where.status) && pathOk(r, where.agentOutputs));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    // Iade sayaci azaltmasi quota.used uzerinde (0'in altina inmez)
    user: {
      updateMany: vi.fn(async () => {
        if (quota.used <= 0) return { count: 0 };
        quota.used--;
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
  const jobQueue = {
    enqueue: vi.fn<(opts: any) => Promise<{ dbJobId: string; bullJobId: string }>>(async () => ({ dbJobId: 'j1', bullJobId: '7' })),
    removeJob: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  };
  // Hak sayaci: consumeArticleAllowance tek kosullu UPDATE'i taklit eder (hak doluysa
  // 403, sayac degismez); refundArticleAllowance geri verir
  const quota = {
    used: 0,
    limit: opts.limit ?? 15,
    consumeArticleAllowance: vi.fn(async () => {
      if (quota.used >= quota.limit) throw new ForbiddenException(`Deneme hesabındaki ${quota.limit} ücretsiz makale hakkını kullandın. Devam etmek için plan seç.`);
      quota.used++;
      return { remaining: quota.limit - quota.used };
    }),
    refundArticleAllowance: vi.fn(async () => { if (quota.used > 0) quota.used--; }),
  };
  const svc = new ArticlesService(prisma as any, jobQueue as any, quota as any, {} as any);
  return { svc, prisma, jobQueue, quota, rows };
}

const siteRow = (over: Record<string, unknown> = {}) => ({
  id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'manual_approve',
  user: { id: 'u1' }, publishTargets: [{ id: 't1' }], ...over,
});
const row = (status: string, site = siteRow()): Row => ({ id: 'a1', siteId: 's1', topic: 'Konu', status, site });

/** "Simdi uret"in sahiplenmede yazdigi hak isareti (takvime geri donerse ikinci kez dusmesin) */
const TRIGGER_MARK = { allowanceCharge: { at: expect.any(String), source: 'trigger_now' } };

describe('queueGeneration — acik "uret ve yayinla" istegi', () => {
  it('hedef secilmisse publishApproved: worker Yari otomatikte de yayinlar (kullanicinin onayi)', async () => {
    const { svc, jobQueue, quota } = build();
    await svc.queueGeneration('s1', 'Konu', ['t1']);
    const job = jobQueue.enqueue.mock.calls[0][0] as any;
    expect(job.payload).toMatchObject({ articleId: 'a-new', targetIds: ['t1'], autoPublish: true, publishApproved: true });
    expect(quota.used).toBe(1);

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
    expect(ctx.prisma.article.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', siteId: 's1', status: 'SCHEDULED' }, data: { status: 'GENERATING', agentOutputs: TRIGGER_MARK } });
    const job = ctx.jobQueue.enqueue.mock.calls[0][0] as any;
    expect(job).toMatchObject({ type: 'GENERATE_ARTICLE', userId: 'u1', siteId: 's1' });
    // Yari otomatik: yayin istenmez (takvim isiyle ayni kural); hedefler is kaydinda
    expect(job.payload).toMatchObject({ articleId: 'a1', autoPublish: false, targetIds: ['t1'] });
    expect(ctx.jobQueue.removeJob).toHaveBeenCalledWith('gen:article:a1');
    expect(ctx.quota.used).toBe(1);
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
    expect(ctx.quota.used).toBe(1);
  });

  it('uretimde ya da bitmis yazi tetiklenmez; kota bile denetlenmez', async () => {
    for (const status of ['GENERATING', 'EDITING', 'READY_TO_PUBLISH', 'PUBLISHED', 'ARCHIVED']) {
      const ctx = build({ rows: [row(status)] });
      await expect(ctx.svc.triggerNow('s1', 'a1'), status).rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.quota.consumeArticleAllowance).not.toHaveBeenCalled();
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
      expect(ctx.prisma.article.updateMany, status).toHaveBeenCalledWith({ where: { id: 'a1', siteId: 's1', status }, data: { status: 'GENERATING', agentOutputs: TRIGGER_MARK } });
      expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    }
  });

  it('okuma ile yazma arasinda takvim isi / saatlik tarama aldiysa (count 0): 400, kuyruk ve kota yok', async () => {
    const ctx = build({ rows: [row('SCHEDULED')] });
    ctx.prisma.article.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(ctx.svc.triggerNow('s1', 'a1')).rejects.toThrow('Bu yazı az önce üretime alındı.');
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    expect(ctx.quota.used).toBe(0);
  });

  it('kuyruga atilamazsa yazi eski durumuna doner, kota dusulmez, hata firlar', async () => {
    const ctx = build({ rows: [row('FAILED')] });
    ctx.jobQueue.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    await expect(ctx.svc.triggerNow('s1', 'a1')).rejects.toThrow('redis yok');
    // Sahiplenmede yazilan hak isareti de geri alinir (agentOutputs eski hali: bos)
    expect(ctx.prisma.article.updateMany).toHaveBeenLastCalledWith({ where: { id: 'a1', status: 'GENERATING' }, data: { status: 'FAILED', agentOutputs: Prisma.DbNull } });
    expect(ctx.rows[0].status).toBe('FAILED');
    expect(ctx.quota.used).toBe(0);
    expect(ctx.jobQueue.removeJob).not.toHaveBeenCalled();
  });

  it('gecikmeli isin silinememesi istegi bozmaz (en iyi caba)', async () => {
    const ctx = build({ rows: [row('SCHEDULED')] });
    ctx.jobQueue.removeJob.mockRejectedValueOnce(new Error('kilitli'));
    await expect(ctx.svc.triggerNow('s1', 'a1')).resolves.toMatchObject({ articleId: 'a1' });
    expect(ctx.quota.used).toBe(1);
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
      expect(ctx.quota.consumeArticleAllowance).not.toHaveBeenCalled();
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

  /**
   * Markdown ZIP canli siteye dokunmayan bir disa aktarim dosyasidir (republish-policy
   * siteLiveEntries). Karar eskiden liveEntries'le veriliyordu: yalniz ZIP kaydi olan yazi
   * "Bu yazının önceki hâli sitende yayında" metniyle reddediliyordu (sitede olmayan bir
   * sayfa icin yanlis iddia) ve yeniden uretilemiyordu.
   */
  const zipExport = {
    targetId: 'z1', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/luviai-exports/yazi.zip',
    publishedAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-01T08:00:00.000Z',
  };
  const wpOnSite = { targetId: 't1', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: 'https://s.example/yazi/' };

  it('yalniz Markdown ZIP disa aktarimi olan yazi sitede yayinda sayilmaz: "önceki hâli sitende yayında" denmez, uretime alinir', async () => {
    for (const status of ['REVIZE_NEEDED', 'FAILED', 'DRAFT']) {
      const ctx = build({ rows: [{ ...row(status), publishedTo: [zipExport] } as Row] });
      await expect(ctx.svc.triggerNow('s1', 'a1'), status).resolves.toMatchObject({ articleId: 'a1' });
      expect(ctx.rows[0].status, status).toBe('GENERATING');
      expect(ctx.quota.consumeArticleAllowance, status).toHaveBeenCalledTimes(1);
      expect(ctx.jobQueue.enqueue, status).toHaveBeenCalledTimes(1);
    }
  });

  it('ZIP yaninda sitede canli kopya varsa reddedilir; sitedeki kopya emekliye ayrildiysa ZIP tek basina yayinda saydirmaz', async () => {
    const live = build({ rows: [{ ...row('REVIZE_NEEDED'), publishedTo: [zipExport, wpOnSite] } as Row] });
    await expect(live.svc.triggerNow('s1', 'a1')).rejects.toThrow(TRIGGER_NOW_LIVE_REFUSED);
    expect(live.jobQueue.enqueue).not.toHaveBeenCalled();

    const retiredWp = { ...wpOnSite, missingAt: '2026-10-20T02:20:00.000Z', missingReason: 'public_url_gone' };
    const gone = build({ rows: [{ ...row('REVIZE_NEEDED'), publishedTo: [zipExport, retiredWp] } as Row] });
    await gone.svc.triggerNow('s1', 'a1');
    expect(gone.rows[0].status).toBe('GENERATING');
    expect(gone.jobQueue.enqueue).toHaveBeenCalledTimes(1);
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

/**
 * Deneme hesabi toplam 2 makale (sahip karari 20.10.2026). Kullanicinin baslattigi her
 * uretim hakki uretim BASLAMADAN duser; baslatilamazsa geri verilir. Hak doluysa kilitli
 * takvim yazisi "Simdi uret" ile de uretilmez (403, sahiplenme ve kuyruk yok).
 */
describe('makale hakki — kullanicinin baslattigi uretim (deneme: toplam 2)', () => {
  it('deneme hakki dolu: kilitli takvim yazisi "Simdi uret" ile uretilmez — 403, yazi SCHEDULED, kuyruk yok', async () => {
    const ctx = build({ rows: [row('SCHEDULED')], limit: 2 });
    ctx.quota.used = 2;
    await expect(ctx.svc.triggerNow('s1', 'a1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.rows[0].status).toBe('SCHEDULED');
    expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    expect(ctx.quota.used).toBe(2);
  });

  it('hakki zaten dusulmus, takvime geri donmus yazi (isaretli) "Simdi uret"te ikinci kez dusmez', async () => {
    const mark = { allowanceCharge: { at: '2026-10-20T10:00:00.000Z', source: 'calendar' } };
    const ctx = build({ rows: [{ ...row('SCHEDULED'), agentOutputs: mark }], limit: 2 });
    ctx.quota.used = 2;
    await expect(ctx.svc.triggerNow('s1', 'a1')).resolves.toMatchObject({ articleId: 'a1' });
    expect(ctx.quota.consumeArticleAllowance).not.toHaveBeenCalled();
    expect(ctx.prisma.article.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', siteId: 's1', status: 'SCHEDULED' }, data: { status: 'GENERATING' } });
    expect(ctx.quota.used).toBe(2);
  });

  it('Uret: deneme hesabi 2. makaleden sonra 403; ucuncu yer tutucu ve is acilmaz', async () => {
    const ctx = build({ limit: 2 });
    await ctx.svc.queueGeneration('s1', 'Konu 1');
    await ctx.svc.queueGeneration('s1', 'Konu 2');
    await expect(ctx.svc.queueGeneration('s1', 'Konu 3')).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(2);
    expect(ctx.prisma.article.create).toHaveBeenCalledTimes(2);
    expect(ctx.quota.used).toBe(2);
  });

  it('Uret: is kuyruga girmezse hak geri verilir — yer tutucunun isaretiyle, tek kez (yer tutucu FAILED)', async () => {
    const ctx = build({ limit: 2 });
    ctx.jobQueue.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    await expect(ctx.svc.queueGeneration('s1', 'Konu')).rejects.toThrow('redis yok');
    expect(ctx.quota.used).toBe(0);
    // Duz iade yok: yer tutucu GENERATING kalsaydi supurucu ayni hakki ikinci kez iade ederdi
    expect(ctx.quota.refundArticleAllowance).not.toHaveBeenCalled();
    const placeholder = ctx.rows.find((r) => r.id === 'a-new') as any;
    expect(placeholder.status).toBe('FAILED');
    expect(placeholder.agentOutputs.allowanceCharge).toBeUndefined();
    expect(placeholder.agentOutputs.allowanceRefund).toMatchObject({ source: 'user_start', chargeAt: expect.any(String) });
  });

  it('Uret: yer tutucu acilamadiysa duz iade', async () => {
    const ctx = build({ limit: 2 });
    ctx.prisma.article.create.mockRejectedValueOnce(new Error('db yok'));
    await expect(ctx.svc.queueGeneration('s1', 'Konu')).rejects.toThrow('db yok');
    expect(ctx.quota.used).toBe(0);
    expect(ctx.quota.refundArticleAllowance).toHaveBeenCalledTimes(1);
  });

  it('Uret: yer tutucu hak isaretiyle acilir (user_start) — basarisiz uretimin iadesi buna dayanir', async () => {
    const ctx = build({ limit: 2 });
    await ctx.svc.queueGeneration('s1', 'Konu');
    expect(ctx.prisma.article.create.mock.calls[0][0].data.agentOutputs).toEqual({ allowanceCharge: { at: expect.any(String), source: 'user_start' } });
  });

  it('Simdi uret (takvim yazisi) kuyruga girmezse hak isareti de geri alinir: tarama onu bedava uretmez', async () => {
    const ctx = build({ rows: [row('SCHEDULED')], limit: 2 });
    ctx.jobQueue.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    await expect(ctx.svc.triggerNow('s1', 'a1')).rejects.toThrow('redis yok');
    expect(ctx.rows[0].status).toBe('SCHEDULED');
    expect(ctx.rows[0].agentOutputs).toBe(Prisma.DbNull);
    expect(ctx.quota.used).toBe(0);
  });

  it('run-now: hak hat baslamadan duser; hat hata verirse geri verilir, hak doluysa hat hic calismaz', async () => {
    const ctx = build({ limit: 2 });
    const pipeline = { runPipeline: vi.fn(async () => { throw new Error('LLM hatasi'); }) };
    const svc = new ArticlesService(ctx.prisma as any, ctx.jobQueue as any, ctx.quota as any, pipeline as any);
    await expect(svc.runPipelineNow({ siteId: 's1', topic: 'Konu' })).rejects.toThrow('LLM hatasi');
    expect(ctx.quota.used).toBe(0);
    ctx.quota.used = 2;
    await expect(svc.runPipelineNow({ siteId: 's1', topic: 'Konu' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(pipeline.runPipeline).toHaveBeenCalledTimes(1);
  });
});
