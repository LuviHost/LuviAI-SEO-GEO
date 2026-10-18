import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { JobQueueService } from './job-queue.service.js';

/**
 * JobQueueService: kuyruga eklenemeyen isin DB kaydi ve yonetici kuyruk izleyicisi.
 *
 * NEDEN VAR:
 *  - inceleme S24'un yan etkisi: enqueue once DB kaydini acip sonra BullMQ'ya
 *    ekliyor. queue.add hata verince kayit QUEUED ve bullJobId'siz kaliyor,
 *    takili sayfa toplu onarimi onu "bekleyen is" sayip musterinin yeniden
 *    denemesine "zaten sırada" diyordu (hic kosmayacak bir is).
 *  - inceleme S15'in yan etkisi: toplu onarim ve otopilot isleri oncelikle (50)
 *    eklenir; BullMQ 5 onlari 'prioritized' kumesine koyar. Yonetici izleyicisi
 *    bu turu hic sormadigi icin 50 bekleyen is 0 gorunuyordu.
 * Redis yok: kuyruk sahtesi servise elle verilir (onModuleInit cagrilmaz).
 */

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

type JobRow = Record<string, any>;

function world() {
  const rows: JobRow[] = [];
  const prisma = {
    job: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `db-${rows.length + 1}`, bullJobId: null, error: null, finishedAt: null, queuedAt: new Date(), ...data };
        rows.push(row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('kayit yok');
        Object.assign(row, data);
        return { ...row };
      }),
    },
  };
  const queue = {
    add: vi.fn<(name: string, data: unknown, opts: unknown) => Promise<{ id: string }>>(async () => ({ id: '77' })),
    getJob: vi.fn<(id: string) => Promise<any>>(async () => null),
    getJobCounts: vi.fn(async (...types: string[]) => Object.fromEntries(types.map((t) => [t, 0]))),
    getJobs: vi.fn<(types: string[], start: number, end: number, asc: boolean) => Promise<any[]>>(async () => []),
  };
  const svc = new JobQueueService(prisma as any);
  (svc as any).queue = queue;
  return { svc, prisma, queue, rows };
}

const sahteIs = (id: string) => ({
  id, name: 'STUCK_PAGE_RECOVER', data: { stuckPageId: id }, opts: { priority: 50, attempts: 3 }, attemptsMade: 0,
  timestamp: 1, processedOn: null, finishedOn: null, delay: 0, getState: vi.fn(async () => 'prioritized'),
});

beforeEach(() => warn.mockClear());

describe('S24 yan etkisi — kuyruga eklenemeyen isin DB kaydi FAILED olur', () => {
  it('queue.add hata verdi: kayit FAILED + Turkce neden + bitis ani; hata aynen firlatilir; bullJobId yazilmaz', async () => {
    const w = world();
    const redis = new Error('Connection is closed.');
    w.queue.add.mockRejectedValueOnce(redis);
    await expect(w.svc.enqueue({ type: 'STUCK_PAGE_RECOVER', userId: 'u1', siteId: 's1', payload: { stuckPageId: 'p1' }, priority: 50 })).rejects.toBe(redis);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({ status: 'FAILED', error: 'İş kuyruğa eklenemedi: Connection is closed.', bullJobId: null });
    expect(w.rows[0].finishedAt).toBeInstanceOf(Date);
    // Tek guncelleme: FAILED (bullJobId yazimi yok)
    expect(w.prisma.job.update).toHaveBeenCalledTimes(1);
  });

  it('ozel jobId ile yeniden zamanlamada eski isin okunmasi hata verdi: kayit yine FAILED, add denenmez', async () => {
    const w = world();
    w.queue.getJob.mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:6379'));
    await expect(w.svc.enqueue({ type: 'GENERATE_ARTICLE', userId: 'u1', payload: {}, jobId: 'scheduled-a1', delay: 1000 })).rejects.toThrow('ECONNREFUSED');
    expect(w.rows[0]).toMatchObject({ status: 'FAILED', error: 'İş kuyruğa eklenemedi: ECONNREFUSED 127.0.0.1:6379' });
    expect(w.queue.add).not.toHaveBeenCalled();
  });

  it('FAILED yazimi da basarisizsa asil kuyruk hatasi kaybolmaz (loglanir)', async () => {
    const w = world();
    w.queue.add.mockRejectedValueOnce(new Error('Connection is closed.'));
    w.prisma.job.update.mockRejectedValueOnce(new Error('DB yok'));
    await expect(w.svc.enqueue({ type: 'SITE_AUDIT', userId: 'u1', payload: {} })).rejects.toThrow('Connection is closed.');
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).toContain('FAILED yapilamadi');
  });

  it('kontrol: basarili eklemede kayit QUEUED kalir, bullJobId yazilir, kimlikler doner', async () => {
    const w = world();
    const r = await w.svc.enqueue({ type: 'STUCK_PAGE_RECOVER', userId: 'u1', siteId: 's1', payload: { stuckPageId: 'p1' }, priority: 50 });
    expect(r).toEqual({ dbJobId: 'db-1', bullJobId: '77' });
    expect(w.rows[0]).toMatchObject({ status: 'QUEUED', bullJobId: '77', error: null, priority: 50 });
    expect(w.queue.add).toHaveBeenCalledWith('STUCK_PAGE_RECOVER', { stuckPageId: 'p1' }, expect.objectContaining({ priority: 50, attempts: 3 }));
  });
});

describe('S15 yan etkisi — oncelikli bekleyen isler yonetici kuyruk izleyicisinde gorunur', () => {
  it('sayac BullMQ\'nun \'prioritized\' turunu da sorar; Bekliyor karti (waiting) onlari icerir, alt kirilim ayrica doner', async () => {
    const w = world();
    w.queue.getJobCounts.mockImplementationOnce(async (...types: string[]) => ({
      ...Object.fromEntries(types.map((t) => [t, 0])), waiting: 3, prioritized: 50, active: 2,
    }));
    const counts = await w.svc.getQueueCounts();
    expect(w.queue.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'delayed', 'completed', 'failed', 'paused', 'prioritized');
    // Eskiden: waiting 3 (50 sayfalik toplu onarim hic gorunmuyordu)
    expect(counts).toMatchObject({ waiting: 53, prioritized: 50, active: 2, delayed: 0, completed: 0, failed: 0, paused: 0 });
  });

  it('Bekliyor listesi once wait, sonra oncelik kumesi; iki turun araligi limit\'e kirpilir; diger durumlar degismez', async () => {
    const w = world();
    w.queue.getJobs.mockImplementationOnce(async () => [sahteIs('w1'), sahteIs('p1'), sahteIs('p2'), sahteIs('p3')]);
    const list = await w.svc.listJobs('waiting', 3);
    expect(w.queue.getJobs).toHaveBeenCalledWith(['waiting', 'prioritized'], 0, 2, false);
    expect(list.map((j) => [j.id, j.state])).toEqual([['w1', 'prioritized'], ['p1', 'prioritized'], ['p2', 'prioritized']]);
    await w.svc.listJobs('delayed', 10);
    expect(w.queue.getJobs).toHaveBeenLastCalledWith(['delayed'], 0, 9, false);
  });
});
