import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PromptLabRunAllJobs } from './prompt-lab-run-all-jobs.js';

type RunAllOpts = { onProgress?: (p: { requested: number; done: number; failed: number }) => void };

/** allowance.run benzeri: once rezerve et (hata = 429), sonra fn */
function allowanceStub(opts: { limitHit?: boolean } = {}) {
  return {
    run: vi.fn(async (_user: unknown, fn: () => Promise<unknown>) => {
      if (opts.limitHit) throw new HttpException('Bu haftaki AI ölçüm hakkını kullandın.', 429);
      return fn();
    }),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('PromptLabRunAllJobs', () => {
  it('hak ayrilinca is bitmeden doner, ilerleme ve sonuc durumdan okunur', async () => {
    const gate = deferred<void>();
    const lab = {
      runAll: vi.fn(async (_siteId: string, o: RunAllOpts) => {
        o.onProgress?.({ requested: 3, done: 0, failed: 0 });
        o.onProgress?.({ requested: 3, done: 1, failed: 0 });
        await gate.promise;
        o.onProgress?.({ requested: 3, done: 3, failed: 1 });
        return { ran: 2, requested: 3, failed: [{ promptId: 'p3', error: 'x' }] };
      }),
    };
    const jobs = new PromptLabRunAllJobs(lab as any, allowanceStub() as any);

    const started = await jobs.start('s1', { id: 'u1' }, { limit: 25 });
    expect(started.status).toBe('running');
    expect(jobs.status('s1')).toMatchObject({ status: 'running', requested: 3, done: 1 });

    gate.resolve();
    await flush();
    expect(jobs.status('s1')).toMatchObject({ status: 'done', ran: 2, failed: 1, done: 3, requested: 3 });
    expect((jobs.status('s1') as any).finishedAt).toBeTruthy();
  });

  it('haftalik hak doluysa 429 aninda firlar ve is kaydi kalmaz', async () => {
    const lab = { runAll: vi.fn() };
    const jobs = new PromptLabRunAllJobs(lab as any, allowanceStub({ limitHit: true }) as any);

    await expect(jobs.start('s1', { id: 'u1' })).rejects.toMatchObject({ status: 429 });
    expect(lab.runAll).not.toHaveBeenCalled();
    expect(jobs.status('s1')).toEqual({ status: 'idle' });
  });

  it('calisan is varken ikinci start yeni hak ayirmaz, ayni isi dondurur', async () => {
    const gate = deferred<void>();
    const lab = { runAll: vi.fn(async () => { await gate.promise; return { ran: 1, requested: 1, failed: [] }; }) };
    const allowance = allowanceStub();
    const jobs = new PromptLabRunAllJobs(lab as any, allowance as any);

    const [a, b] = await Promise.all([jobs.start('s1', { id: 'u1' }), jobs.start('s1', { id: 'u1' })]);
    expect(a.status).toBe('running');
    expect(b.alreadyRunning).toBe(true);
    expect(allowance.run).toHaveBeenCalledTimes(1);
    expect(lab.runAll).toHaveBeenCalledTimes(1);

    gate.resolve();
    await flush();
    expect(jobs.status('s1')).toMatchObject({ status: 'done', ran: 1 });
  });

  it('is yarida patlarsa durum failed olur, hata metni kisaltilir', async () => {
    const lab = { runAll: vi.fn(async () => { await flush(); throw new Error('db koptu'); }) };
    const jobs = new PromptLabRunAllJobs(lab as any, allowanceStub() as any);

    await jobs.start('s1', { id: 'u1' });
    await flush();
    await flush();
    expect(jobs.status('s1')).toMatchObject({ status: 'failed', error: 'db koptu' });
  });

  it('siteler birbirinden bagimsiz', async () => {
    const lab = { runAll: vi.fn(async () => ({ ran: 0, requested: 0, failed: [] })) };
    const jobs = new PromptLabRunAllJobs(lab as any, allowanceStub() as any);
    await jobs.start('s1', { id: 'u1' });
    await flush();
    expect(jobs.status('s2')).toEqual({ status: 'idle' });
  });
});
