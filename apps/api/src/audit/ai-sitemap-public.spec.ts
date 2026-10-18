import { describe, it, expect, vi, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard.js';
import { SiteAccessGuard } from '../auth/site-access.guard.js';
import { AiSitemapThrottlerGuard, AI_SITEMAP_IP_THROTTLE, AI_SITEMAP_IP_LIMIT } from './ai-sitemap-throttler.guard.js';

/**
 * sitemap-ai.xml herkese acik olmali.
 *
 * NEDEN VAR: panel musteriye bu adresi robots.txt'e eklemesini soyluyor;
 * uc global AuthGuard'in arkasindaydi ve arama motoru botlari 401 aliyordu.
 * Robots.txt'teki `Sitemap:` satiri baska host'taki haritayi gosterebilir
 * (sitemaps.org "Sitemaps & Cross Submits"); harita yalniz kimliksiz
 * okunabiliyorsa ise yarar.
 */
const { AuditController } = await import('./audit.controller.js');
const proto = AuditController.prototype as any;

const storages: ThrottlerStorageService[] = [];
afterEach(() => {
  for (const s of storages.splice(0)) s.onApplicationShutdown();
});

function routeCtx(req: any) {
  return {
    getHandler: () => proto.aiSitemapXml,
    getClass: () => AuditController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ header: () => undefined }) }),
  } as any;
}

describe('GET /sites/:siteId/audit/sitemap-ai.xml — herkese acik', () => {
  it('@Public + IP/site hiz siniri guard\'i', () => {
    expect(Reflect.getMetadata('isPublic', proto.aiSitemapXml)).toBe(true);
    expect(Reflect.getMetadata('__guards__', proto.aiSitemapXml)).toContain(AiSitemapThrottlerGuard);
  });

  it('oturumsuz istek AuthGuard\'dan ve site sahipligi guard\'indan gecer (eskiden 401)', async () => {
    const req = { method: 'GET', path: '/api/sites/s1/audit/sitemap-ai.xml', headers: {}, params: { siteId: 's1' } };
    const auth = new AuthGuard({} as any, new Reflector(), {} as any);
    await expect(auth.canActivate(routeCtx(req))).resolves.toBe(true);
    const siteAccess = new SiteAccessGuard({ site: { findUnique: vi.fn() } } as any, new Reflector());
    await expect(siteAccess.canActivate(routeCtx(req))).resolves.toBe(true);
  });

  function controller(xml: string | null) {
    const ctl = Object.create(AuditController.prototype) as any;
    ctl.aiSitemap = { getPublicXml: vi.fn(async () => xml), build: vi.fn() };
    const headers: Record<string, string> = {};
    const res = { setHeader: vi.fn((k: string, v: string) => { headers[k] = v; }), send: vi.fn() };
    return { ctl, res, headers };
  }

  it('XML onbellekli servisten; Content-Type ve 10 dk Cache-Control', async () => {
    const { ctl, res, headers } = controller('<?xml version="1.0"?><urlset/>');
    await ctl.aiSitemapXml('s1', res);
    expect(ctl.aiSitemap.getPublicXml).toHaveBeenCalledWith('s1');
    expect(ctl.aiSitemap.build).not.toHaveBeenCalled();
    expect(headers['Content-Type']).toBe('application/xml; charset=utf-8');
    expect(headers['Cache-Control']).toBe('public, max-age=600');
    expect(res.send).toHaveBeenCalledWith('<?xml version="1.0"?><urlset/>');
  });

  it('bilinmeyen site 404; XML basligi yazilmaz (JSON hata govdesi XML diye gitmesin)', async () => {
    const { ctl, res } = controller(null);
    await expect(ctl.aiSitemapXml('yok', res)).rejects.toBeInstanceOf(NotFoundException);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
    expect(Reflect.getMetadata('__headers__', proto.aiSitemapXml)).toBeUndefined();
  });
});

describe('AiSitemapThrottlerGuard — IP + site basina 10 dakikada 30 istek', () => {
  async function makeGuard() {
    const storage = new ThrottlerStorageService();
    storages.push(storage);
    const guard = new AiSitemapThrottlerGuard([{ ttl: 60_000, limit: 60 }], storage, new Reflector());
    await guard.onModuleInit();
    return guard;
  }

  function ctx(siteId: string, ip: string) {
    const headers: Record<string, unknown> = {};
    const req = { params: { siteId }, headers: { 'cf-connecting-ip': ip }, ip: '127.0.0.1' };
    const res = { header: (k: string, v: unknown) => { headers[k] = v; } };
    return {
      headers,
      context: {
        getHandler: () => proto.aiSitemapXml,
        getClass: () => AuditController,
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      } as any,
    };
  }

  it('31. istek 429 + Turkce neden; baska IP ve baska site ayri kova (bot cok musterinin haritasini okuyabilir)', async () => {
    expect(AI_SITEMAP_IP_LIMIT).toEqual({ limit: 30, ttl: 10 * 60_000 });
    const guard = await makeGuard();
    for (let i = 0; i < 30; i++) {
      await expect(guard.canActivate(ctx('s1', '203.0.113.7').context)).resolves.toBe(true);
    }
    const blocked = ctx('s1', '203.0.113.7');
    const err = await guard.canActivate(blocked.context).catch((e) => e);
    expect(err).toBeInstanceOf(ThrottlerException);
    expect(err.getStatus()).toBe(429);
    expect(String(err.message)).toMatch(/^Bu site haritası kısa sürede çok fazla istendi\. Yaklaşık \d+ dakika sonra tekrar deneyin\.$/);
    expect(blocked.headers[`Retry-After-${AI_SITEMAP_IP_THROTTLE}`]).toBeGreaterThan(0);

    await expect(guard.canActivate(ctx('s1', '198.51.100.1').context)).resolves.toBe(true);
    await expect(guard.canActivate(ctx('s2', '203.0.113.7').context)).resolves.toBe(true);
  });
});
