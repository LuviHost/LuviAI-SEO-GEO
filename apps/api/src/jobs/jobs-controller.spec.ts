import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

/**
 * /jobs uclari.
 *
 * NEDEN VAR: POST /jobs/:id/retry sahiplik denetimi yapmadan isi QUEUED'a
 * cekiyor ve payload/result'iyla tum satiri donduruyordu (is kimligini bilen
 * herkes, /jobs scope haritasinda olmadigi icin her ':write' API anahtari).
 * BullMQ'ya yeniden kuyruklamadigi icin is sonsuza dek QUEUED kaliyordu.
 * Hicbir istemci cagirmiyordu; uc kaldirildi. Yonetici yeniden denemesi
 * POST /admin/queue/jobs/:jobId/retry'da (BullMQ job.retry()).
 */
function routesOf(cls: { prototype: object }) {
  const proto = cls.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .map((name) => ({
      name,
      path: Reflect.getMetadata(PATH_METADATA, proto[name] as object),
      method: Reflect.getMetadata(METHOD_METADATA, proto[name] as object),
    }))
    .filter((r) => r.path !== undefined);
}

describe('JobsController', () => {
  it('yalniz GET /jobs/:id var — sahipliksiz POST /jobs/:id/retry yok', () => {
    expect(Reflect.getMetadata(PATH_METADATA, JobsController)).toBe('jobs');
    expect(routesOf(JobsController)).toEqual([{ name: 'get', path: ':id', method: RequestMethod.GET }]);
    expect((JobsService.prototype as any).retry).toBeUndefined();
  });

  it('GET /jobs/:id sahiplik denetimi: sahibi ve ADMIN okur, baskasi 403, olmayan is 404', async () => {
    const job = { id: 'j1', userId: 'u1', status: 'COMPLETED', payload: { siteId: 's1' } };
    const prisma = { job: { findUnique: vi.fn(async ({ where }: any) => (where.id === 'j1' ? job : null)) } };
    const ctl = new JobsController(new JobsService(prisma as any));
    const req = (user: any) => ({ user }) as any;
    await expect(ctl.get('j1', req({ id: 'u1', role: 'USER' }))).resolves.toEqual(job);
    await expect(ctl.get('j1', req({ id: 'adm', role: 'ADMIN' }))).resolves.toEqual(job);
    await expect(ctl.get('j1', req({ id: 'u2', role: 'USER' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.get('yok', req({ id: 'u1', role: 'USER' }))).rejects.toBeInstanceOf(NotFoundException);
  });
});
