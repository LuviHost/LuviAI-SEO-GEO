import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClientReportController, PublicClientReportController } from './client-report.controller.js';
import { SiteAccessGuard } from '../auth/site-access.guard.js';
import { TrialExpiryGuard } from '../billing/trial-expiry.guard.js';
import { SESSION_ONLY_KEY } from '../auth/session-only.decorator.js';
import { PLAN_FEATURE_KEY } from '../billing/plan-feature.decorator.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';

/**
 * Erisim: rapor sahibe (ve yoneticiye) acik, baskasina kapali; herkese acik
 * uc yalniz token ile ve hiz sinirli; deneme dahil her planda acik (AI maliyeti
 * yok) ve suresi dolan denemede paylasim olusturulabilir.
 *
 * Gercek denetleyici siniflari kullanilir: dekorator metadatasi gercekten okunur.
 */
const SITE = 'cmsitemukellef00000000001';
const TOKEN = 'A'.repeat(32);

function ctx(cls: any, handler: string, opts: { method?: string; siteId?: string; user?: unknown; token?: string } = {}): ExecutionContext {
  const fn = cls.prototype[handler];
  if (typeof fn !== 'function') throw new Error(`${cls.name}.${handler} yok`);
  const req: any = { method: opts.method ?? 'GET', params: { siteId: opts.siteId, token: opts.token }, user: opts.user };
  return {
    getType: () => 'http',
    getHandler: () => fn,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function siteGuard() {
  const prisma = { site: { findUnique: vi.fn(async ({ where }: any) => (where.id === SITE ? { id: SITE, userId: 'sahip' } : null)) } };
  return new SiteAccessGuard(prisma as any, new Reflector());
}

describe('sahip uclari — SiteAccessGuard', () => {
  for (const h of ['report', 'shares', 'createShare', 'revokeShare']) {
    it(`${h}: sahibi gecer, baskasinin sitesi 403, olmayan site 404, yonetici gecer`, async () => {
      const g = siteGuard();
      await expect(g.canActivate(ctx(ClientReportController, h, { siteId: SITE, user: { id: 'sahip', role: 'USER' } }))).resolves.toBe(true);
      await expect(g.canActivate(ctx(ClientReportController, h, { siteId: SITE, user: { id: 'baska', role: 'USER' } }))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(g.canActivate(ctx(ClientReportController, h, { siteId: 'cmyokyokyokyokyokyokyokyo', user: { id: 'sahip', role: 'USER' } }))).rejects.toBeInstanceOf(NotFoundException);
      await expect(g.canActivate(ctx(ClientReportController, h, { siteId: SITE, user: { id: 'adm', role: 'ADMIN' } }))).resolves.toBe(true);
    });
  }

  it('hicbir uc plana bagli degil (deneme dahil tum planlarda acik)', () => {
    const r = new Reflector();
    for (const h of ['report', 'shares', 'createShare', 'revokeShare']) {
      expect(r.getAllAndOverride(PLAN_FEATURE_KEY, [ClientReportController.prototype[h as keyof ClientReportController] as any, ClientReportController])).toBeUndefined();
    }
  });

  it('paylasim olusturma/geri alma yalniz panel oturumuyla (API anahtari veriyi herkese acamaz)', () => {
    const r = new Reflector();
    expect(r.get(SESSION_ONLY_KEY, ClientReportController.prototype.createShare)).toBe(true);
    expect(r.get(SESSION_ONLY_KEY, ClientReportController.prototype.revokeShare)).toBe(true);
    expect(r.get(SESSION_ONLY_KEY, ClientReportController.prototype.report)).toBeUndefined();
  });

  it('API anahtari kapsami: rapor okumasi analytics:read', () => {
    const k = new ApiKeysService({} as any);
    expect(k.requiredScope('GET', `/api/sites/${SITE}/client-report`)).toBe('analytics:read');
  });
});

describe('suresi dolan deneme (salt okunur) — rapor ve paylasim acik', () => {
  const EXPIRED = { id: 'u1', role: 'USER', plan: 'TRIAL', subscriptionStatus: 'EXPIRED', trialEndsAt: new Date(Date.now() - 86_400_000) };
  const guard = () => new TrialExpiryGuard(new Reflector(), {
    checkoutStatus: vi.fn(async () => ({ open: true, testMode: false, message: null })),
    hasEverPaid: vi.fn(async () => false),
  } as any);

  it('GET rapor/liste, POST paylasim (@TrialReadOnlyExempt), DELETE geri alma gecer', async () => {
    const g = guard();
    await expect(g.canActivate(ctx(ClientReportController, 'report', { method: 'GET', user: EXPIRED }))).resolves.toBe(true);
    await expect(g.canActivate(ctx(ClientReportController, 'shares', { method: 'GET', user: EXPIRED }))).resolves.toBe(true);
    await expect(g.canActivate(ctx(ClientReportController, 'createShare', { method: 'POST', user: EXPIRED }))).resolves.toBe(true);
    await expect(g.canActivate(ctx(ClientReportController, 'revokeShare', { method: 'DELETE', user: EXPIRED }))).resolves.toBe(true);
  });

  it('karsi ornek: isaretsiz bir POST ayni hesapta 403 (kapi gercekten calisiyor)', async () => {
    class Isaretsiz { yaz() { return null; } }
    await expect(guard().canActivate(ctx(Isaretsiz, 'yaz', { method: 'POST', user: EXPIRED }))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('herkese acik uc — /api/public/rapor/:token', () => {
  it('@Public: kimlik istemez, SiteAccessGuard sahiplik sormaz', async () => {
    const r = new Reflector();
    expect(r.get('isPublic', PublicClientReportController.prototype.goster)).toBe(true);
    const prisma = { site: { findUnique: vi.fn() } };
    const g = new SiteAccessGuard(prisma as any, r);
    await expect(g.canActivate(ctx(PublicClientReportController, 'goster', { token: TOKEN }))).resolves.toBe(true);
    expect(prisma.site.findUnique).not.toHaveBeenCalled();
  });

  it('hiz siniri: IP basina dakikada 30', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', PublicClientReportController.prototype.goster)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', PublicClientReportController.prototype.goster)).toBe(60_000);
  });

  it('gecersiz token servise gitmeden 404; gecerli token servise iletilir', async () => {
    const svc = { getPublic: vi.fn(async () => ({ rapor: {}, paylasim: {} })) };
    const c = new PublicClientReportController(svc as any);
    await expect(c.goster('../../x')).rejects.toBeInstanceOf(NotFoundException);
    expect(svc.getPublic).not.toHaveBeenCalled();
    await c.goster(TOKEN);
    expect(svc.getPublic).toHaveBeenCalledWith(TOKEN);
  });
});
