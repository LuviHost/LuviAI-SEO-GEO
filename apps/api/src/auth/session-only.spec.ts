import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { SessionOnly } from './session-only.decorator.js';
import { AscMetadataController } from '../aso/asc/asc-metadata.controller.js';

class Ctl {
  @SessionOnly()
  guarded() {}
  open() {}
}

function ctxFor(handler: Function, cls: Function) {
  const req: any = {
    method: 'POST',
    path: '/api/sites/s1/aso/asc/apps/a1/metadata/apply',
    headers: { authorization: 'Bearer luvi_test' },
  };
  return {
    req,
    ctx: {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => req }),
    } as any,
  };
}

function guard() {
  const prisma = { user: { findUnique: vi.fn(async () => ({ id: 'u1' })) } };
  const apiKeys = {
    validate: vi.fn(async () => ({ userId: 'u1', scopes: ['*'] })),
    requiredScope: vi.fn(() => null),
    hasScopeForRoute: vi.fn(() => true),
  };
  return new AuthGuard(prisma as any, new Reflector(), apiKeys as any);
}

describe('@SessionOnly', () => {
  it("'*' kapsamlı API anahtarı bile işaretli rotada 403 alır", async () => {
    const { ctx, req } = ctxFor(Ctl.prototype.guarded, Ctl);
    await expect(guard().canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(req.user).toBeUndefined();
  });

  it('işaretsiz rotada API anahtarı geçer', async () => {
    const { ctx, req } = ctxFor(Ctl.prototype.open, Ctl);
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
    expect(req.apiKey).toBeTruthy();
  });

  it('ASC metadata denetleyicisi sınıf düzeyinde işaretli (tüm uçlar)', async () => {
    const { ctx } = ctxFor(AscMetadataController.prototype.history, AscMetadataController);
    await expect(guard().canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
