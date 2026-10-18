import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../auth/auth.guard.js';
import { MeController } from './me.controller.js';

/** Hesap silme uclari API anahtariyla cagrilamaz ve yalniz JSON govde kabul eder. */
function apiKeyCtx(handler: (...args: any[]) => unknown) {
  const req: any = { method: 'POST', path: '/api/me/delete-account', headers: { authorization: 'Bearer luvi_test' } };
  return {
    getHandler: () => handler,
    getClass: () => MeController,
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

function guard() {
  const prisma = { user: { findUnique: vi.fn(async () => ({ id: 'u1', deletionRequestedAt: null })) } };
  const apiKeys = {
    validate: vi.fn(async () => ({ userId: 'u1', scopes: ['*'], keyId: 'k1' })),
    requiredScope: vi.fn(() => null),
    hasScopeForRoute: vi.fn(() => true),
  };
  return new AuthGuard(prisma as any, new Reflector(), apiKeys as any);
}

describe('hesap silme uclari', () => {
  it("'*' kapsamli API anahtari bile silme, durum ve musteri ayirma uclarinda 403 alir", async () => {
    for (const h of [MeController.prototype.deleteAccount, MeController.prototype.deletionStatus, MeController.prototype.detachAgencyClients]) {
      await expect(guard().canActivate(apiKeyCtx(h))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('JSON olmayan govde reddedilir (baska siteden form istegi)', () => {
    const deletion = { requestDeletion: vi.fn() };
    const ctl = new MeController({} as any, deletion as any);
    const req: any = { user: { id: 'u1' }, is: (t: string) => (t === 'application/json' ? false : null) };
    expect(() => ctl.deleteAccount(req, { confirm: 'DELETE_MY_ACCOUNT' })).toThrow(BadRequestException);
    expect(deletion.requestDeletion).not.toHaveBeenCalled();
  });

  it('JSON govdeyle oturumdaki kullanici icin servis cagrilir', async () => {
    const deletion = { requestDeletion: vi.fn(async () => ({ ok: true })) };
    const ctl = new MeController({} as any, deletion as any);
    const req: any = { user: { id: 'u1' }, is: (t: string) => (t === 'application/json' ? 'application/json' : false) };
    await ctl.deleteAccount(req, { confirm: 'DELETE_MY_ACCOUNT', appleAuthorizationCode: 'c' });
    expect(deletion.requestDeletion).toHaveBeenCalledWith('u1', { confirm: 'DELETE_MY_ACCOUNT', appleAuthorizationCode: 'c' });
  });
});
