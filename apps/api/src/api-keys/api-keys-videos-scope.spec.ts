import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../auth/auth.guard.js';
import { ApiKeysService } from './api-keys.service.js';
import { VideosController } from '../videos/videos.controller.js';

/**
 * RanksUp Video ucu (/sites/:id/videos) scope haritasinda yoktu (inceleme bulgusu): requiredScope
 * null -> mutasyonda "herhangi bir ':write'" kaba kurali -> yalniz 'social:write' tasiyan dar bir
 * anahtar POST /sites/:id/videos ile site sahibinin aylik video hakkini harcayabiliyordu.
 * Video makaleden uretilir: makale kaynagina baglandi (GET -> articles:read, POST/DELETE -> articles:write).
 */
const svc = new ApiKeysService({} as never);

function guardFor(scopes: string[]) {
  const apiKeys = {
    validate: vi.fn(async () => ({ userId: 'u1', scopes, keyId: 'k1' })),
    requiredScope: (m: string, p: string) => svc.requiredScope(m, p),
    hasScopeForRoute: (s: string[], r: string) => svc.hasScopeForRoute(s, r),
  };
  const prisma = { user: { findUnique: vi.fn(async () => ({ id: 'u1', role: 'USER' })) } };
  return new AuthGuard(prisma as any, new Reflector(), apiKeys as any);
}

function ctx(handler: (...args: any[]) => unknown, method: string, path: string) {
  const req: any = { method, path, headers: { authorization: 'Bearer luvi_anahtar' } };
  return {
    req,
    ctx: { getHandler: () => handler, getClass: () => VideosController, switchToHttp: () => ({ getRequest: () => req }) } as any,
  };
}

describe('API anahtari scope — /sites/:id/videos makale kaynagi', () => {
  it('scope eslemesi: GET -> articles:read, POST/DELETE -> articles:write (harf duyarsiz)', () => {
    expect(svc.requiredScope('GET', '/api/sites/s1/videos')).toBe('articles:read');
    expect(svc.requiredScope('GET', '/api/sites/s1/videos/brand')).toBe('articles:read');
    expect(svc.requiredScope('POST', '/api/sites/s1/videos')).toBe('articles:write');
    expect(svc.requiredScope('DELETE', '/api/sites/s1/videos/v1')).toBe('articles:write');
    expect(svc.requiredScope('POST', '/api/sites/s1/VIDEOS')).toBe('articles:write');
  });

  it("yalniz 'social:write' tasiyan anahtar video isteyemez (403) — video hakki harcanmaz", async () => {
    const { ctx: c, req } = ctx(VideosController.prototype.request, 'POST', '/api/sites/s1/videos');
    await expect(guardFor(['social:write']).canActivate(c)).rejects.toBeInstanceOf(ForbiddenException);
    expect(req.user).toBeUndefined();
    const del = ctx(VideosController.prototype.remove, 'DELETE', '/api/sites/s1/videos/v1');
    await expect(guardFor(['social:write', 'sites:read']).canActivate(del.ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("'articles:write' anahtari video isteyebilir; 'articles:read' listeleyebilir ama isteyemez", async () => {
    await expect(guardFor(['articles:write']).canActivate(ctx(VideosController.prototype.request, 'POST', '/api/sites/s1/videos').ctx)).resolves.toBe(true);
    await expect(guardFor(['articles:read']).canActivate(ctx(VideosController.prototype.list, 'GET', '/api/sites/s1/videos').ctx)).resolves.toBe(true);
    await expect(guardFor(['articles:read']).canActivate(ctx(VideosController.prototype.request, 'POST', '/api/sites/s1/videos').ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
