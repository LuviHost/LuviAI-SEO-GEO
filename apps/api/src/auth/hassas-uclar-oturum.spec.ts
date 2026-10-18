import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { AuthController } from './auth.controller.js';
import { OAuthController } from '../oauth/oauth.controller.js';
import { AscController } from '../aso/asc/asc.controller.js';

/**
 * Baglanti kesme / hesap secme uclari musterinin canli entegrasyonunu
 * degistirir: API anahtariyla degil yalniz panel oturumuyla cagrilabilir.
 * GSC/GA kesme ve baslatma uclari siteId'yi govde/sorgudan aldigi icin
 * global SiteAccessGuard devreye girmiyordu; sahiplik controller'da.
 */
type Fn = (...args: any[]) => unknown;
type Cls = abstract new (...args: any[]) => unknown;

function keyGuard() {
  const prisma = { user: { findUnique: vi.fn(async () => ({ id: 'u1', role: 'USER' })) } };
  const apiKeys = {
    validate: vi.fn(async () => ({ userId: 'u1', scopes: ['*'] })),
    requiredScope: vi.fn(() => null),
    hasScopeForRoute: vi.fn(() => true),
  };
  return new AuthGuard(prisma as any, new Reflector(), apiKeys as any);
}

function keyCtx(handler: Fn, cls: Cls) {
  const req: any = { method: 'POST', path: '/api/x', headers: { authorization: 'Bearer luvi_test' } };
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('hassas baglanti uclari — yalniz panel oturumu', () => {
  const cases: Array<[string, Fn, Cls]> = [
    ['AuthController.disconnectGsc', AuthController.prototype.disconnectGsc, AuthController],
    ['AuthController.disconnectGa', AuthController.prototype.disconnectGa, AuthController],
    ['OAuthController.selectGoogleAds', OAuthController.prototype.selectGoogleAds, OAuthController],
    ['OAuthController.selectMetaAds', OAuthController.prototype.selectMetaAds, OAuthController],
    ['AscController.connect', AscController.prototype.connect, AscController],
    ['AscController.disconnect', AscController.prototype.disconnect, AscController],
  ];
  for (const [name, handler, cls] of cases) {
    it(`${name}: '*' kapsamli API anahtari 403`, async () => {
      await expect(keyGuard().canActivate(keyCtx(handler, cls))).rejects.toBeInstanceOf(ForbiddenException);
    });
  }
});

describe('GSC/GA kesme ve baslatma — sahiplik', () => {
  function controller() {
    const prisma = {
      // MySQL gibi harf duyarsiz eslesme: 'S1' de 's1' satirini bulur.
      site: { findUnique: vi.fn(async ({ where }: any) => (String(where.id).toLowerCase() === 's1' ? { id: 's1', userId: 'sahip' } : null)) },
      // OAuth state'i kullaniciya + siteye bagli, tek kullanimlik kayit (oauth-state.ts)
      kvStore: { deleteMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({})) },
    };
    const gsc = { disconnect: vi.fn(async () => ({ ok: true })), buildAuthorizationUrl: vi.fn(() => 'https://accounts.google.com/x') };
    const ga = { disconnect: vi.fn(async () => ({ ok: true })), buildAuthorizationUrl: vi.fn(() => 'https://accounts.google.com/y') };
    const ctl = new AuthController({} as any, gsc as any, ga as any, {} as any, prisma as any, {} as any);
    return { ctl, gsc, ga, prisma };
  }
  const req = (id: string, role = 'USER') => ({ user: { id, role } }) as any;

  it('baskasinin sitesinde GSC/GA kesilemez → 403, servis cagrilmaz', async () => {
    const { ctl, gsc, ga } = controller();
    await expect(ctl.disconnectGsc({ siteId: 's1' }, req('yabanci'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.disconnectGa({ siteId: 's1' }, req('yabanci'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(gsc.disconnect).not.toHaveBeenCalled();
    expect(ga.disconnect).not.toHaveBeenCalled();
  });

  it('baskasinin sitesi icin OAuth baslatilamaz → 403', async () => {
    const { ctl, gsc, ga } = controller();
    await expect(ctl.startGscOAuth('s1', req('yabanci'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.startGaOAuth('s1', req('yabanci'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(gsc.buildAuthorizationUrl).not.toHaveBeenCalled();
    expect(ga.buildAuthorizationUrl).not.toHaveBeenCalled();
  });

  it('harf varyanti 404, eksik siteId 400', async () => {
    const { ctl } = controller();
    await expect(ctl.disconnectGsc({ siteId: 'S1' }, req('sahip'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctl.disconnectGa({} as any, req('sahip'))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('site sahibi ve ADMIN kesebilir/baslatabilir; state kullaniciya ve siteye bagli', async () => {
    const { ctl, gsc, ga, prisma } = controller();
    await ctl.disconnectGsc({ siteId: 's1' }, req('sahip'));
    await ctl.disconnectGa({ siteId: 's1' }, req('admin', 'ADMIN'));
    expect(gsc.disconnect).toHaveBeenCalledWith('s1');
    expect(ga.disconnect).toHaveBeenCalledWith('s1');
    await expect(ctl.startGscOAuth('s1', req('sahip'))).resolves.toEqual({ url: 'https://accounts.google.com/x' });
    // Google'a giden state cipla site kimligi degil, kayitli tek kullanimlik bir anahtar
    const state = (gsc.buildAuthorizationUrl.mock.calls[0] as any[])[0];
    expect(state).not.toBe('s1');
    const saved = (prisma.kvStore.create.mock.calls[0] as any[])[0].data;
    expect(saved.key.endsWith(state)).toBe(true);
    expect(JSON.parse(saved.value)).toMatchObject({ userId: 'sahip', siteId: 's1', provider: 'gsc' });
  });
});
