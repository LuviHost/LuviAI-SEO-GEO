import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../auth/auth.guard.js';
import { ApiKeysController } from './api-keys.controller.js';
import { ApiKeysService } from './api-keys.service.js';

/**
 * Uretimdeki yetki yukseltme zinciri (uctan uca, AuthGuard dahil):
 * /api-keys scope haritasinda yok → requiredScope null → mutasyonda HERHANGI
 * bir ':write' yetiyordu. 'social:write' tasiyan dar bir anahtar POST
 * /api-keys ile tum scope'lu ve suresiz yeni bir anahtar uretebiliyordu.
 * Gercek ApiKeysService.requiredScope kullanilir ki "kaynak eslesmiyor"
 * davranisi taklit degil, kodun kendisi olsun.
 */
function guardFor(scopes: string[]) {
  const real = new ApiKeysService({} as never);
  const apiKeys = {
    validate: vi.fn(async () => ({ userId: 'u1', scopes, keyId: 'k-dar' })),
    requiredScope: (m: string, p: string) => real.requiredScope(m, p),
    hasScopeForRoute: (s: string[], r: string) => real.hasScopeForRoute(s, r),
  };
  const prisma = { user: { findUnique: vi.fn(async () => ({ id: 'u1', role: 'USER' })) } };
  return new AuthGuard(prisma as any, new Reflector(), apiKeys as any);
}

function ctx(handler: (...args: any[]) => unknown, method: string, path: string) {
  const req: any = { method, path, headers: { authorization: 'Bearer luvi_dar_anahtar' } };
  return {
    req,
    ctx: {
      getHandler: () => handler,
      getClass: () => ApiKeysController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as any,
  };
}

describe('API anahtari ile anahtar uretme/iptal — AuthGuard', () => {
  it('on kosul: /api-keys bilinen bir scope kaynagi degil (eski kaba kurala dusuyordu)', () => {
    expect(new ApiKeysService({} as never).requiredScope('POST', '/api/api-keys')).toBeNull();
  });

  it("dar yetkili ('social:write') anahtar POST /api-keys cagiramaz → 403, req.user kurulmaz", async () => {
    const { ctx: c, req } = ctx(ApiKeysController.prototype.create, 'POST', '/api/api-keys');
    await expect(guardFor(['social:write']).canActivate(c)).rejects.toBeInstanceOf(ForbiddenException);
    expect(req.user).toBeUndefined();
  });

  it("'*' kapsamli anahtar bile baska anahtari iptal edemez (DELETE /api-keys/:id → 403)", async () => {
    const { ctx: c } = ctx(ApiKeysController.prototype.revoke, 'DELETE', '/api/api-keys/k-baska');
    await expect(guardFor(['*']).canActivate(c)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('listeleme (GET) anahtarla okunabilir kalir', async () => {
    const { ctx: c, req } = ctx(ApiKeysController.prototype.list, 'GET', '/api/api-keys');
    await expect(guardFor(['sites:read']).canActivate(c)).resolves.toBe(true);
    expect(req.apiKey).toBeTruthy();
  });
});
