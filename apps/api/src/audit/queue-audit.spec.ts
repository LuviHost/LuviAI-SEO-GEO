import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AuditService } from './audit.service.js';
import { AUDIT_REUSE_WINDOW_MS, pickReusableAuditJob } from './audit-reuse.js';

/**
 * POST /audit/run sozlesmesi — is kimligi HER ZAMAN `id` adiyla donmeli.
 *
 * NEDEN VAR: iki ayri kusur ust uste bindi ve uc canlida sessizce bozuldu.
 *
 *  1. queueAudit once yalnizca prisma.job.create ile DB satiri yaziyordu;
 *     BullMQ'ya hicbir sey eklenmiyordu. Worker BullMQ tuketicisi oldugu icin
 *     is sonsuza kadar QUEUED kaliyor, hic calismiyordu.
 *  2. enqueue'ya baglandiktan sonra ham donusu (`{ dbJobId, bullJobId }`)
 *     oldugu gibi geciriyordu. Panel `job.id` okuyup `undefined` aliyor,
 *     ardindan GET /jobs/undefined cagiriyor ve yoklama ilk istekte
 *     Prisma dogrulama hatasiyla dusuyordu.
 *
 * Ikincisini tsc yakalamadi: web kendi donus tipini (`{ id, status }`)
 * bagimsiz beyan ediyor, yani iki taraf birbirini dogrulamiyor. Bu dosya
 * sunucu tarafini otorite kabul edip sekli sabitler.
 */

/** enqueue cagrisini kaydeden, gercek servisin donus seklini taklit eden sahte kuyruk. */
function fakeQueue() {
  const calls: any[] = [];
  return {
    calls,
    // Gercek JobQueueService.enqueue TAM OLARAK bunu doner — `id` yok.
    enqueue: async (opts: any) => {
      calls.push(opts);
      return { dbJobId: 'job_123', bullJobId: 987 };
    },
  };
}

function service(queue: any, runningJobs: any[] = [], seenWhere: any[] = []): AuditService {
  const prisma = {
    site: {
      findUniqueOrThrow: async () => ({ id: 'site_1', userId: 'user_1', url: 'https://ofsayt.com' }),
    },
    job: {
      findMany: async (args: any) => {
        seenWhere.push(args.where);
        return runningJobs;
      },
    },
  } as never;
  const n = null as never;
  // Kuyruk son kurucu parametresi; digerleri bu yolda hic kullanilmiyor.
  return new AuditService(prisma, n, n, n, n, n, queue);
}

describe('queueAudit — uc sozlesmesi', () => {
  it('is kimligini `id` alaninda doner (istemci bunu yokluyor)', async () => {
    const res = await service(fakeQueue()).queueAudit('site_1');
    expect(res.id).toBe('job_123');
    expect(typeof res.id).toBe('string');
    expect(res.status).toBe('QUEUED');
  });

  it('ham `dbJobId` sizmiyor — sekil yeniden adlandirilmis olmali', async () => {
    const res: any = await service(fakeQueue()).queueAudit('site_1');
    expect(res.dbJobId, 'ham enqueue donusu oldugu gibi geciriliyor').toBeUndefined();
  });

  it('BullMQ kuyruguna GERCEKTEN ekliyor — sadece DB satiri degil', async () => {
    const q = fakeQueue();
    await service(q).queueAudit('site_1');
    expect(q.calls.length, 'enqueue hic cagrilmadi — is QUEUED\'da asili kalir').toBe(1);
    expect(q.calls[0].type).toBe('SITE_AUDIT');
    expect(q.calls[0].userId).toBe('user_1');
    expect(q.calls[0].siteId).toBe('site_1');
    // Worker payload'dan okuyor; url dusrse tarama hedefsiz kalir.
    expect(q.calls[0].payload).toMatchObject({ siteId: 'site_1', url: 'https://ofsayt.com' });
  });

  it('dogrudan prisma.job.create kullanmiyor — BullMQ atlanmis olur', () => {
    const src = readFileSync(new URL('./audit.service.ts', import.meta.url), 'utf8');
    const govde = src.slice(src.indexOf('async queueAudit'), src.indexOf('async runAudit'));
    expect(govde).not.toMatch(/prisma\.job\.create/);
    expect(govde).toContain('jobQueue.enqueue');
  });
});

describe('web istemcisi sunucu sekliyle ayni', () => {
  it('api.ts queueAudit donus tipi `id` bekliyor', () => {
    // Iki taraf bagimsiz beyan ediyor; en azindan ayni adi kullandiklarini
    // sabitleyelim ki `dbJobId`'ye geri donen bir degisiklik burada patlasin.
    const web = readFileSync(
      new URL('../../../web/src/lib/api.ts', import.meta.url),
      'utf8',
    );
    const satir = web.slice(web.indexOf('queueAudit:'), web.indexOf('queueAudit:') + 220);
    expect(satir).toContain('id: string');
    expect(satir).not.toContain('dbJobId');
  });
});

describe('queueAudit — ayni site icin tekrar tarama eklenmez', () => {
  const simdi = () => new Date();
  const calisan = (over: any = {}) => ({
    id: 'job_eski', status: 'PROCESSING', payload: { siteId: 'site_1' },
    queuedAt: simdi(), bullJobId: '555', ...over,
  });

  it('kullanici taramasi calisiyorsa yenisi kuyruga eklenmez, mevcut is doner', async () => {
    const q = fakeQueue();
    const res = await service(q, [calisan()]).queueAudit('site_1');
    expect(q.calls.length, 'ikinci tarama kuyruga eklendi — olcum hakki iki kez duser').toBe(0);
    expect(res).toEqual({ id: 'job_eski', status: 'QUEUED', bullJobId: '555', reused: true });
  });

  it('sirada bekleyen (QUEUED) kullanici taramasi da yeniden kullanilir', async () => {
    const q = fakeQueue();
    const res = await service(q, [calisan({ status: 'QUEUED' })]).queueAudit('site_1');
    expect(q.calls.length).toBe(0);
    expect(res.id).toBe('job_eski');
  });

  it('sistem (haftalik) taramasi varken kullanici taramasi yine eklenir', async () => {
    const q = fakeQueue();
    const res = await service(q, [calisan({ status: 'QUEUED', payload: { siteId: 'site_1', trigger: 'system' } })]).queueAudit('site_1');
    expect(q.calls.length).toBe(1);
    expect(res.id).toBe('job_123');
  });

  it('pencereden eski kayit kopmus sayilir, yeni tarama eklenir', async () => {
    const q = fakeQueue();
    const eski = new Date(Date.now() - AUDIT_REUSE_WINDOW_MS - 60_000);
    await service(q, [calisan({ queuedAt: eski })]).queueAudit('site_1');
    expect(q.calls.length).toBe(1);
  });

  it('kuyruga hic eklenememis (bullJobId yok) kayit yeniden kullanilmaz', async () => {
    const q = fakeQueue();
    await service(q, [calisan({ bullJobId: null })]).queueAudit('site_1');
    expect(q.calls.length).toBe(1);
  });

  it('sorgu yalnizca bu sitenin, canli durumdaki tarama islerine bakar', async () => {
    const where: any[] = [];
    await service(fakeQueue(), [], where).queueAudit('site_1');
    expect(where[0]).toMatchObject({ siteId: 'site_1', type: 'SITE_AUDIT', status: { in: ['QUEUED', 'PROCESSING'] } });
    expect(where[0].queuedAt.gte).toBeInstanceOf(Date);
  });

  it('sistem taramasi (cron) tekrar denetimine girmez, her zaman kuyruga eklenir', async () => {
    const q = fakeQueue();
    const where: any[] = [];
    await service(q, [calisan()], where).queueAudit('site_1', { trigger: 'system', priority: 50 });
    expect(where.length, 'cron yolu tekrar sorgusu yapmamali').toBe(0);
    expect(q.calls.length).toBe(1);
  });
});

describe('pickReusableAuditJob', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const j = (over: any = {}) => ({ id: 'a', status: 'QUEUED', payload: {}, queuedAt: now, bullJobId: '1', ...over });

  it('bitmis/basarisiz isleri atlar, ilk uygun canli isi secer', () => {
    expect(pickReusableAuditJob([j({ id: 'x', status: 'COMPLETED' }), j({ id: 'y', status: 'FAILED' }), j({ id: 'z' })], now)?.id).toBe('z');
  });

  it("trigger: 'user' acikca yazilmissa da kullanici taramasi sayilir", () => {
    expect(pickReusableAuditJob([j({ payload: { trigger: 'user' } })], now)?.id).toBe('a');
  });

  it('bos listede null', () => {
    expect(pickReusableAuditJob([], now)).toBeNull();
  });
});
