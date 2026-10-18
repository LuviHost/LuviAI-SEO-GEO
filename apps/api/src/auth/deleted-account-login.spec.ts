import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { encode } from 'next-auth/jwt';
import { AuthGuard, DELETED_ACCOUNT_MESSAGE } from './auth.guard.js';
import { AuthController, assertNotDeletionRequested } from './auth.controller.js';

/**
 * Silme talebi olan hesap: o andan itibaren ne oturum JWT'si (web cerezi, mobil
 * Bearer) ne API anahtari ne de mobil Google/Apple girisi calisir.
 */
const SECRET = 'test-secret-deleted-account-spec-0123456789abcdef';
let savedSecret: string | undefined;
beforeAll(() => { savedSecret = process.env.NEXTAUTH_SECRET; process.env.NEXTAUTH_SECRET = SECRET; });
afterAll(() => { if (savedSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = savedSecret; });

class Ctl { handler() {} }

function ctx(authorization: string) {
  const req: any = { method: 'GET', path: '/api/sites', headers: { authorization } };
  return {
    req,
    ctx: { getHandler: () => Ctl.prototype.handler, getClass: () => Ctl, switchToHttp: () => ({ getRequest: () => req }) } as any,
  };
}

function guardFor(user: any) {
  const prisma = { user: { findUnique: vi.fn(async () => user) } };
  const apiKeys = {
    validate: vi.fn(async () => ({ userId: user.id, scopes: ['*'], keyId: 'k1' })),
    requiredScope: vi.fn(() => null),
    hasScopeForRoute: vi.fn(() => true),
  };
  return new AuthGuard(prisma as any, new Reflector(), apiKeys as any);
}

describe('silme talebi olan hesap erisemez', () => {
  it('oturum JWT\'si (web/mobil Bearer) 401 alir', async () => {
    const token = await encode({ token: { sub: 'u1' }, secret: SECRET, salt: 'authjs.session-token', maxAge: 3600 });
    const { ctx: c, req } = ctx(`Bearer ${token}`);
    const err = await guardFor({ id: 'u1', deletionRequestedAt: new Date() }).canActivate(c).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe(DELETED_ACCOUNT_MESSAGE);
    expect(req.user).toBeUndefined();
  });

  it('ayni JWT talep yokken gecer (kontrol yalniz silinen hesabi keser)', async () => {
    const token = await encode({ token: { sub: 'u1' }, secret: SECRET, salt: 'authjs.session-token', maxAge: 3600 });
    const { ctx: c, req } = ctx(`Bearer ${token}`);
    await expect(guardFor({ id: 'u1', deletionRequestedAt: null }).canActivate(c)).resolves.toBe(true);
    expect(req.user.id).toBe('u1');
  });

  it('iptal edilmemis bir API anahtari bile 401 alir', async () => {
    const { ctx: c } = ctx('Bearer luvi_abc');
    await expect(guardFor({ id: 'u1', deletionRequestedAt: new Date() }).canActivate(c)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('mobil Google/Apple girisi', () => {
  it('silme talebi olan hesap icin silinme tarihini soyleyen 403', () => {
    expect(() => assertNotDeletionRequested({ deletionRequestedAt: new Date('2026-10-18T10:00:00Z') })).toThrow(ForbiddenException);
    expect(() => assertNotDeletionRequested({ deletionRequestedAt: new Date('2026-10-18T10:00:00Z') })).toThrow(/17 Kasım 2026/);
    expect(() => assertNotDeletionRequested({ deletionRequestedAt: null })).not.toThrow();
  });

  function controller(prisma: any) {
    return new AuthController({} as any, {} as any, {} as any, {} as any, prisma, { captureRefreshToken: vi.fn() } as any);
  }

  it('bagli hesapla gelen giris reddedilir', async () => {
    const prisma = {
      account: { findUnique: vi.fn(async () => ({ userId: 'u1' })), upsert: vi.fn() },
      user: { findUnique: vi.fn(async () => ({ id: 'u1', deletionRequestedAt: new Date() })), create: vi.fn() },
    };
    await expect((controller(prisma) as any).resolveOAuthUser({ provider: 'apple', sub: 's1' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('e-postayla eslesen silinmekte olan hesaba yeni giris BAGLANMAZ, yeni hesap da acilmaz', async () => {
    const prisma = {
      account: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
      user: { findUnique: vi.fn(async () => ({ id: 'u1', email: 'a@b.co', deletionRequestedAt: new Date() })), create: vi.fn() },
    };
    await expect((controller(prisma) as any).resolveOAuthUser({ provider: 'google', sub: 'g1', email: 'a@b.co' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.account.upsert).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
