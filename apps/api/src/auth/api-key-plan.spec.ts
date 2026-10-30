import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, API_KEY_PLAN_MESSAGE } from './auth.guard.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';

/**
 * REST API anahtari plan dusunce de calismaz — kapi yalniz uretimde degil.
 *
 * NEDEN VAR: api-keys.controller yalniz YENI anahtar uretiminde apiAccess
 * (Kurumsal) bakiyordu; AuthGuard anahtari dogrularken plana bakmiyordu.
 * Kurumsal'da uretilmis anahtar, hesap denemeye (TRIAL) dustukten sonra da
 * tum REST uclarini acmaya devam ediyordu. MCP tasima ucu haric: McpController
 * mcpAccess'i kendisi JSON-RPC hatasi olarak doner.
 */

function kur(user: { plan: string; role?: string }) {
  const real = new ApiKeysService({} as never);
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ id: 'u1', role: 'USER', deletionRequestedAt: null, ...user })) },
  };
  const apiKeys = {
    validate: vi.fn(async () => ({ userId: 'u1', scopes: ['*'], keyId: 'k1' })),
    requiredScope: real.requiredScope.bind(real),
    hasScopeForRoute: real.hasScopeForRoute.bind(real),
  };
  return new AuthGuard(prisma as any, new Reflector(), apiKeys as any);
}

function ctx(method: string, path: string) {
  const handler = function handler() {};
  const req: any = { method, path, headers: { authorization: 'Bearer luvi_test' } };
  return {
    req,
    ctx: {
      getHandler: () => handler,
      getClass: () => class Ctrl {},
      switchToHttp: () => ({ getRequest: () => req }),
    } as any,
  };
}

describe('AuthGuard — API anahtari isteginde apiAccess', () => {
  it('Kurumsal hesap anahtariyla gecer', async () => {
    const { ctx: c, req } = ctx('GET', '/api/sites');
    await expect(kur({ plan: 'ENTERPRISE' }).canActivate(c)).resolves.toBe(true);
    expect(req.user.id).toBe('u1');
  });

  it('plani dusen hesap (Ajans, Profesyonel, TRIAL) 403 — anlasilir Turkce neden', async () => {
    for (const plan of ['AGENCY', 'PRO', 'STARTER', 'TRIAL']) {
      for (const [method, path] of [['GET', '/api/sites'], ['POST', '/api/sites/s1/articles'], ['GET', '/api/looker/mention-rate']]) {
        const { ctx: c, req } = ctx(method!, path!);
        const err = await kur({ plan }).canActivate(c).catch((e) => e);
        expect(err, `${plan} ${method} ${path}`).toBeInstanceOf(ForbiddenException);
        expect(err.message).toBe(API_KEY_PLAN_MESSAGE);
        expect(req.user).toBeUndefined();
      }
    }
    expect(API_KEY_PLAN_MESSAGE).toMatch(/REST API erişimi Kurumsal planına dahil/);
    expect(API_KEY_PLAN_MESSAGE).toMatch(/planını yükselttiğinde yeniden çalışır/);
  });

  it('ADMIN sahipli anahtar (or. yonetimden uretilen onizleme anahtari) planindan bagimsiz calisir', async () => {
    const { ctx: c } = ctx('GET', '/api/sites');
    await expect(kur({ plan: 'TRIAL', role: 'ADMIN' }).canActivate(c)).resolves.toBe(true);
  });

  it('MCP tasima ucu bu kapidan muaf — McpController mcpAccess\'i JSON-RPC hatasiyla doner', async () => {
    for (const path of ['/api/mcp', '/api/mcp/', '/mcp']) {
      const { ctx: c, req } = ctx('POST', path);
      await expect(kur({ plan: 'TRIAL' }).canActivate(c), path).resolves.toBe(true);
      expect(req.apiKey).toBeTruthy();
    }
  });

  it('MCP disindaki /mcp ile biten yol muaf degil', async () => {
    const { ctx: c } = ctx('POST', '/api/sites/s1/x/mcp');
    await expect(kur({ plan: 'TRIAL' }).canActivate(c)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
