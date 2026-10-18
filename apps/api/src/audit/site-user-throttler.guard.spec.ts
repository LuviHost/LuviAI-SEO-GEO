import { describe, it, expect, afterEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { SiteUserThrottlerGuard, SITE_USER_THROTTLE } from './site-user-throttler.guard.js';

/**
 * Snippet uretimi (istek basina 8'e kadar model cagrisi) kullanici + site
 * basina sinirlanir. Guard elle kurulur: vitest dekorator metadata'si
 * uretmez; ThrottlerGuard'in bagimliliklari (secenekler, depo, Reflector)
 * dogrudan verilir. Rota limitleri AuditController'daki @Throttle'dan okunur.
 */
const { AuditController } = await import('./audit.controller.js');

const storages: ThrottlerStorageService[] = [];
afterEach(() => { for (const s of storages.splice(0)) s.onApplicationShutdown(); });

async function makeGuard() {
  const storage = new ThrottlerStorageService();
  storages.push(storage);
  const guard = new SiteUserThrottlerGuard([{ ttl: 60_000, limit: 60 }], storage, new Reflector());
  await guard.onModuleInit();
  return guard;
}

function ctx(handler: (...a: any[]) => any, user: string | null, siteId: string, ip = '203.0.113.7') {
  const headers: Record<string, unknown> = {};
  const req = { user: user ? { id: user } : undefined, params: { siteId }, headers: { 'cf-connecting-ip': ip }, ip: '127.0.0.1' };
  const res = { header: (k: string, v: unknown) => { headers[k] = v; } };
  return {
    headers,
    context: {
      getHandler: () => handler,
      getClass: () => AuditController,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as any,
  };
}

describe('SiteUserThrottlerGuard — snippet uretimi kullanici + site basina', () => {
  it('rota metadata: guard bagli; sayfa snippet 20/saat, optimize 30/saat', () => {
    const proto = AuditController.prototype as any;
    expect(Reflect.getMetadata('__guards__', proto.getSnippets)).toContain(SiteUserThrottlerGuard);
    expect(Reflect.getMetadata(`THROTTLER:LIMIT${SITE_USER_THROTTLE}`, proto.getSnippets)).toBe(20);
    expect(Reflect.getMetadata(`THROTTLER:TTL${SITE_USER_THROTTLE}`, proto.getSnippets)).toBe(60 * 60_000);
    expect(Reflect.getMetadata('__guards__', proto.snippetOptimize)).toContain(SiteUserThrottlerGuard);
    expect(Reflect.getMetadata(`THROTTLER:LIMIT${SITE_USER_THROTTLE}`, proto.snippetOptimize)).toBe(30);
  });

  it('21. istek 429 + Turkce neden + Retry-After; baska kullanici ve baska site ayri kova', async () => {
    const guard = await makeGuard();
    const handler = (AuditController.prototype as any).getSnippets;
    for (let i = 0; i < 20; i++) {
      await expect(guard.canActivate(ctx(handler, 'u1', 's1').context)).resolves.toBe(true);
    }
    const blocked = ctx(handler, 'u1', 's1');
    const err = await guard.canActivate(blocked.context).catch((e) => e);
    expect(err).toBeInstanceOf(ThrottlerException);
    expect(err.getStatus()).toBe(429);
    expect(String(err.message)).toMatch(/Bu site için kısa sürede çok fazla üretim isteği gönderildi \(60 dakikada en fazla 20\)/);
    expect(blocked.headers[`Retry-After-${SITE_USER_THROTTLE}`]).toBeGreaterThan(0);

    await expect(guard.canActivate(ctx(handler, 'u2', 's1').context)).resolves.toBe(true);
    await expect(guard.canActivate(ctx(handler, 'u1', 's2').context)).resolves.toBe(true);
  });

  it('IP degistirmek ayni kullanici + sitenin kovasini sifirlamaz', async () => {
    const guard = await makeGuard();
    const handler = (AuditController.prototype as any).getSnippets;
    for (let i = 0; i < 20; i++) await guard.canActivate(ctx(handler, 'u1', 's1', `198.51.100.${i}`).context);
    await expect(guard.canActivate(ctx(handler, 'u1', 's1', '192.0.2.99').context)).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('rota kovalari ayri: optimize sayaci sayfa snippet sayacini tuketmez', async () => {
    const guard = await makeGuard();
    const proto = AuditController.prototype as any;
    for (let i = 0; i < 20; i++) await guard.canActivate(ctx(proto.getSnippets, 'u1', 's1').context);
    await expect(guard.canActivate(ctx(proto.snippetOptimize, 'u1', 's1').context)).resolves.toBe(true);
  });
});
