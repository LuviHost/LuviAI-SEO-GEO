import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { encode } from 'next-auth/jwt';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthGuard } from '../../auth/auth.guard.js';
import { SESSION_ONLY_KEY } from '../../auth/session-only.decorator.js';
import { ApiKeysService, DEFAULT_SCOPES } from '../../api-keys/api-keys.service.js';
import { AsaController } from './asa.controller.js';
import { AdminController } from '../../admin/admin.controller.js';

/**
 * Para hareketi yalniz panelden: Apple Search Ads ve admin mutasyonlari.
 *
 * NEDEN VAR: /aso ve /admin yollari API anahtari kapsam haritasinda yok
 * (api-keys.service ROUTE_RESOURCE). AuthGuard bilinmeyen kaynakta geriye
 * donuk uyum icin HERHANGI bir ':write' anahtarini (orn. yalniz
 * 'social:write') yeterli sayiyordu: boyle bir anahtar musterinin Apple
 * reklam butcesiyle kampanya acabiliyor, teklif yukseltebiliyor, otopilotu
 * acabiliyordu; yonetici anahtari kuyrugu durdurup isleri silebiliyordu.
 * Bu uclar @SessionOnly — anahtar 403, panel oturumu gecer.
 */

const SECRET = 'test-secret-asa-admin-session-only-0123456789abcdef';
let savedSecret: string | undefined;
beforeAll(() => { savedSecret = process.env.NEXTAUTH_SECRET; process.env.NEXTAUTH_SECRET = SECRET; });
afterAll(() => { if (savedSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = savedSecret; });

type Ctor = abstract new (...args: never[]) => unknown;
type Route = { cls: Ctor; handler: string; method: string; path: string };

const MONEY_MOVING: Route[] = [
  { cls: AsaController, handler: 'connect', method: 'POST', path: '/api/sites/s1/aso/asa/connect' },
  { cls: AsaController, handler: 'disconnect', method: 'DELETE', path: '/api/aso/asa/accounts/acc1' },
  { cls: AsaController, handler: 'createCampaign', method: 'POST', path: '/api/aso/asa/campaigns' },
  { cls: AsaController, handler: 'updateBid', method: 'PUT', path: '/api/aso/asa/keyword-bids/kw1' },
  { cls: AsaController, handler: 'setAutoPilot', method: 'PUT', path: '/api/aso/asa/accounts/acc1/autopilot' },
  { cls: AsaController, handler: 'runAutoPilotNow', method: 'POST', path: '/api/aso/asa/accounts/acc1/autopilot/run' },
  { cls: AdminController, handler: 'queueRetryJob', method: 'POST', path: '/api/admin/queue/jobs/12/retry' },
  { cls: AdminController, handler: 'queuePromoteJob', method: 'POST', path: '/api/admin/queue/jobs/12/promote' },
  { cls: AdminController, handler: 'queueRemoveJob', method: 'POST', path: '/api/admin/queue/jobs/12/remove' },
  { cls: AdminController, handler: 'queuePause', method: 'POST', path: '/api/admin/queue/pause' },
  { cls: AdminController, handler: 'queueResume', method: 'POST', path: '/api/admin/queue/resume' },
  { cls: AdminController, handler: 'emailTest', method: 'POST', path: '/api/admin/email-test' },
  { cls: AdminController, handler: 'resetSpend', method: 'POST', path: '/api/admin/users/u2/reset-spend' },
];

/** Anahtarla calismaya devam eden uclar — geriye donuk uyum */
const STILL_OPEN: Route[] = [
  { cls: AsaController, handler: 'listAccounts', method: 'GET', path: '/api/sites/s1/aso/asa/accounts' },
  { cls: AsaController, handler: 'listCampaigns', method: 'GET', path: '/api/sites/s1/aso/asa/campaigns' },
  { cls: AsaController, handler: 'performance', method: 'GET', path: '/api/sites/s1/aso/asa/performance' },
  { cls: AsaController, handler: 'syncCampaigns', method: 'POST', path: '/api/aso/asa/accounts/acc1/sync' },
  { cls: AdminController, handler: 'queueStats', method: 'GET', path: '/api/admin/queue/stats' },
  { cls: AdminController, handler: 'usersSpendStatus', method: 'GET', path: '/api/admin/users-spend-status' },
];

function ctxFor(r: Route, authorization: string, handlerFn?: (...args: never[]) => unknown) {
  const req: any = { method: r.method, path: r.path, headers: { authorization } };
  const handler = handlerFn ?? (r.cls.prototype as any)[r.handler];
  return {
    req,
    ctx: {
      getHandler: () => handler,
      getClass: () => r.cls,
      switchToHttp: () => ({ getRequest: () => req }),
    } as any,
  };
}

/** Gercek scope kurali (requiredScope / hasScopeForRoute) — yalniz validate sahte */
function guard(scopes: string[]) {
  const real = new ApiKeysService({} as never);
  const prisma = { user: { findUnique: vi.fn(async () => ({ id: 'u1', role: 'ADMIN', deletionRequestedAt: null })) } };
  const apiKeys = {
    validate: vi.fn(async () => ({ userId: 'u1', scopes, keyId: 'k1' })),
    requiredScope: real.requiredScope.bind(real),
    hasScopeForRoute: real.hasScopeForRoute.bind(real),
  };
  return new AuthGuard(prisma as any, new Reflector(), apiKeys as any);
}

const label = (r: Route) => [`${r.method} ${r.path}`, r] as const;

describe('ASA ve admin mutasyonlari yalniz panel oturumuyla (@SessionOnly)', () => {
  it.each(MONEY_MOVING.map(label))('%s: isaretli', (_l, r) => {
    expect(Reflect.getMetadata(SESSION_ONLY_KEY, (r.cls.prototype as any)[r.handler])).toBe(true);
  });

  it.each(MONEY_MOVING.map(label))("%s: '*' anahtari da, yalniz 'social:write' anahtari da 403 alir", async (_l, r) => {
    for (const scopes of [['*'], ['social:write']]) {
      const { ctx, req } = ctxFor(r, 'Bearer luvi_test');
      const err = await guard(scopes).canActivate(ctx).catch((e) => e);
      expect(err, scopes.join(',')).toBeInstanceOf(ForbiddenException);
      expect(err.message).toContain('yalnız RanksUp panelinden');
      expect(req.user).toBeUndefined();
    }
  });

  it('isaret olmasaydi: kapsam haritasi bu yollari tanimiyor, yalniz social:write anahtari gecerdi', async () => {
    const real = new ApiKeysService({} as never);
    for (const r of MONEY_MOVING) expect(real.requiredScope(r.method, r.path), r.path).toBeNull();
    const unmarked = function unmarked() {};
    const { ctx } = ctxFor(MONEY_MOVING[2], 'Bearer luvi_test', unmarked);
    await expect(guard(['social:write']).canActivate(ctx)).resolves.toBe(true);
  });

  it('panel oturumu (NextAuth JWT) isaretli ucta gecer — web paneli ve mobil etkilenmez', async () => {
    const token = await encode({ token: { sub: 'u1' }, secret: SECRET, salt: 'authjs.session-token', maxAge: 3600 });
    for (const r of MONEY_MOVING) {
      const { ctx, req } = ctxFor(r, `Bearer ${token}`);
      await expect(guard(['*']).canActivate(ctx), r.path).resolves.toBe(true);
      expect(req.user.id).toBe('u1');
    }
  });

  it.each(STILL_OPEN.map(label))('%s: isaretsiz, anahtarla calismaya devam eder', async (_l, r) => {
    expect(Reflect.getMetadata(SESSION_ONLY_KEY, (r.cls.prototype as any)[r.handler])).toBeUndefined();
    const scopes = r.method === 'GET' ? [...DEFAULT_SCOPES] : ['sites:write'];
    const { ctx, req } = ctxFor(r, 'Bearer luvi_test');
    await expect(guard(scopes).canActivate(ctx)).resolves.toBe(true);
    expect(req.apiKey).toBeTruthy();
  });
});

describe('SDK ve MCP bu uclari kullanmiyor (anahtarli entegrasyon kirilmaz)', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const roots = [join(here, '../../mcp'), join(here, '../../../../../packages/sdk/src')];
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [p] : [];
  });

  it('mcp ve packages/sdk kaynaginda aso/asa ya da admin mutasyon yolu yok', () => {
    const all = roots.flatMap(files);
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/aso\/asa|\/admin\/(queue|email-test|users\/)/);
    }
  });
});
