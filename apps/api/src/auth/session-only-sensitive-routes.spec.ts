import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { encode } from 'next-auth/jwt';
import { AuthGuard } from './auth.guard.js';
import { SESSION_ONLY_KEY } from './session-only.decorator.js';
import { ApiKeysService, DEFAULT_SCOPES } from '../api-keys/api-keys.service.js';
import { BillingController } from '../billing/billing.controller.js';
import { PublishTargetsController } from '../publish-targets/publish-targets.controller.js';
import { SiteAiKeysController } from '../sites/site-ai-keys.controller.js';
import { SitesController } from '../sites/sites.controller.js';
import { SettingsController } from '../settings/settings.controller.js';
import { AscController } from '../aso/asc/asc.controller.js';
import { AuthController } from './auth.controller.js';
import { OAuthController } from '../oauth/oauth.controller.js';
import { ChatController } from '../chat/chat.controller.js';
import { GbpController, GbpPublicController } from '../gbp/gbp.controller.js';

/**
 * API anahtarinin etki alani: scope haritasinda OLMAYAN kaynaklar.
 *
 * NEDEN VAR: api-keys.service ROUTE_RESOURCE yalniz sites/articles/audit/ads/
 * analytics/social'i taniyor. /billing, /publish-targets, /sites/:id/ai-keys,
 * /sites/:id/webhook, /admin/settings, /aso, /auth ve /oauth bilinmeyen kaynak;
 * AuthGuard orada geriye donuk uyum icin HERHANGI bir ':write' anahtarini
 * (orn. yalniz 'social:write') yeterli sayiyordu. Odeme/iptal, yayin hedefi
 * kimlikleri, BYOK anahtarlari, bildirim adresi, platform ayarlari, App Store
 * Connect anahtari, Google (GSC/GA) baglantisi ve reklam hesabi secimi insan
 * karari: bu uclar @SessionOnly — anahtar 403, panel oturumu gecer.
 *
 * Sohbet (/sites/:id/chat) de bilinmeyen kaynak: POST .../chat/messages
 * modelin MCP araclarini (run_audit, create_article ...) kaynak scope'u
 * denetlenmeden calistirmasina yol aciyordu; MCP ucunda ayni arac audit:write /
 * articles:write ister (R21). Sohbeti yalniz panel kullanir: ChatController
 * SINIF duzeyinde @SessionOnly.
 */

const SECRET = 'test-secret-session-only-sensitive-0123456789abcdef';
let savedSecret: string | undefined;
beforeAll(() => { savedSecret = process.env.NEXTAUTH_SECRET; process.env.NEXTAUTH_SECRET = SECRET; });
afterAll(() => { if (savedSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = savedSecret; });

type Ctor = abstract new (...args: never[]) => unknown;
type Handler = (...args: never[]) => unknown;
type Route = { cls: Ctor; handler: string; method: string; path: string };

const SENSITIVE: Route[] = [
  { cls: BillingController, handler: 'subscribe', method: 'POST', path: '/api/billing/subscribe' },
  { cls: BillingController, handler: 'cancel', method: 'POST', path: '/api/billing/users/u1/cancel' },
  { cls: BillingController, handler: 'devConfirm', method: 'POST', path: '/api/billing/dev-confirm/LUVI123' },
  { cls: PublishTargetsController, handler: 'create', method: 'POST', path: '/api/sites/s1/publish-targets' },
  { cls: PublishTargetsController, handler: 'update', method: 'PUT', path: '/api/publish-targets/t1' },
  { cls: PublishTargetsController, handler: 'remove', method: 'DELETE', path: '/api/publish-targets/t1' },
  { cls: PublishTargetsController, handler: 'test', method: 'POST', path: '/api/publish-targets/t1/test' },
  { cls: SiteAiKeysController, handler: 'upsert', method: 'POST', path: '/api/sites/s1/ai-keys' },
  { cls: SiteAiKeysController, handler: 'remove', method: 'DELETE', path: '/api/sites/s1/ai-keys/openai' },
  { cls: SiteAiKeysController, handler: 'retest', method: 'POST', path: '/api/sites/s1/ai-keys/openai/test' },
  { cls: SitesController, handler: 'setWebhook', method: 'PATCH', path: '/api/sites/s1/webhook' },
  { cls: SettingsController, handler: 'update', method: 'PUT', path: '/api/admin/settings/AI_GLOBAL_DISABLED' },
  // Sitenin App Store Connect .p8 anahtarini ezer / baglantiyi (uygulama + surum kayitlariyla) siler
  { cls: AscController, handler: 'connect', method: 'POST', path: '/api/sites/s1/aso/asc/connect' },
  { cls: AscController, handler: 'disconnect', method: 'DELETE', path: '/api/aso/asc/accounts/a1' },
  // Google token'larini siler — analitik durur
  { cls: AuthController, handler: 'disconnectGsc', method: 'POST', path: '/api/auth/gsc/disconnect' },
  { cls: AuthController, handler: 'disconnectGa', method: 'POST', path: '/api/auth/ga/disconnect' },
  // Reklam otopilotunun yonettigi hesabi degistirir
  { cls: OAuthController, handler: 'selectGoogleAds', method: 'POST', path: '/api/oauth/google-ads/select' },
  { cls: OAuthController, handler: 'selectMetaAds', method: 'POST', path: '/api/oauth/meta-ads/select' },
  // Sohbet modeli kullanici adina MCP araclarini calistirir (denetim, olcum, makale uretimi)
  { cls: ChatController, handler: 'send', method: 'POST', path: '/api/sites/s1/chat/messages' },
  { cls: ChatController, handler: 'remove', method: 'DELETE', path: '/api/sites/s1/chat/conversations/c1' },
];

/** Sohbetin okuma uclari: sinif duzeyindeki isaretle bunlar da yalniz panelden */
const CHAT_READS: Route[] = [
  { cls: ChatController, handler: 'skills', method: 'GET', path: '/api/sites/s1/chat/skills' },
  { cls: ChatController, handler: 'conversations', method: 'GET', path: '/api/sites/s1/chat/conversations' },
  { cls: ChatController, handler: 'conversation', method: 'GET', path: '/api/sites/s1/chat/conversations/c1' },
];

const reflector = new Reflector();
/** AuthGuard ile AYNI okuma: handler ya da sinif duzeyindeki @SessionOnly */
const sessionOnly = (cls: Ctor, handler: string) =>
  reflector.getAllAndOverride<boolean>(SESSION_ONLY_KEY, [(cls.prototype as any)[handler], cls]);

/** Anahtarla okunmaya devam eden uclar — geriye donuk uyum */
const READS: Route[] = [
  { cls: BillingController, handler: 'current', method: 'GET', path: '/api/billing/users/u1/current' },
  { cls: BillingController, handler: 'invoices', method: 'GET', path: '/api/billing/users/u1/invoices' },
  { cls: BillingController, handler: 'getQuota', method: 'GET', path: '/api/billing/users/u1/quota' },
  { cls: PublishTargetsController, handler: 'list', method: 'GET', path: '/api/sites/s1/publish-targets' },
  { cls: PublishTargetsController, handler: 'catalog', method: 'GET', path: '/api/publish-targets/catalog' },
  { cls: SiteAiKeysController, handler: 'status', method: 'GET', path: '/api/sites/s1/ai-keys' },
  { cls: SettingsController, handler: 'list', method: 'GET', path: '/api/admin/settings' },
];

function ctxFor(r: Route, authorization: string, handlerFn?: Handler) {
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
  // REST API anahtari Kurumsal planda (auth.guard apiAccess) — kapinin kendisi api-key-plan.spec'te
  const prisma = { user: { findUnique: vi.fn(async () => ({ id: 'u1', deletionRequestedAt: null, plan: 'ENTERPRISE' })) } };
  const apiKeys = {
    validate: vi.fn(async () => ({ userId: 'u1', scopes, keyId: 'k1' })),
    requiredScope: real.requiredScope.bind(real),
    hasScopeForRoute: real.hasScopeForRoute.bind(real),
  };
  return new AuthGuard(prisma as any, new Reflector(), apiKeys as any);
}

describe('hassas mutasyonlar yalniz panel oturumuyla (@SessionOnly)', () => {
  it.each(SENSITIVE.map((r) => [`${r.method} ${r.path}`, r] as const))('%s: isaretli', (_label, r) => {
    expect(sessionOnly(r.cls, r.handler)).toBe(true);
  });

  it.each(SENSITIVE.map((r) => [`${r.method} ${r.path}`, r] as const))("%s: '*' anahtari da, yalniz 'social:write' anahtari da 403 alir", async (_label, r) => {
    for (const scopes of [['*'], ['social:write']]) {
      const { ctx, req } = ctxFor(r, 'Bearer luvi_test');
      const err = await guard(scopes).canActivate(ctx).catch((e) => e);
      expect(err, `${scopes.join(',')}`).toBeInstanceOf(ForbiddenException);
      expect(err.message).toContain('yalnız RanksUp panelinden');
      expect(req.user).toBeUndefined();
    }
  });

  it('isaret olmasaydi: bilinmeyen kaynakta yalniz social:write anahtari mutasyon yapabiliyordu', async () => {
    // Bu yollarin hicbiri scope haritasinda degil — eski kaba kural gecerli
    const real = new ApiKeysService({} as never);
    for (const r of SENSITIVE) expect(real.requiredScope(r.method, r.path), r.path).toBeNull();
    const unmarked = function unmarked() {};
    const { ctx } = ctxFor(SENSITIVE[0], 'Bearer luvi_test', unmarked);
    await expect(guard(['social:write']).canActivate(ctx)).resolves.toBe(true);
  });

  it('panel oturumu (NextAuth JWT) isaretli ucta gecer', async () => {
    const token = await encode({ token: { sub: 'u1' }, secret: SECRET, salt: 'authjs.session-token', maxAge: 3600 });
    for (const r of SENSITIVE) {
      const { ctx, req } = ctxFor(r, `Bearer ${token}`);
      await expect(guard(['*']).canActivate(ctx), r.path).resolves.toBe(true);
      expect(req.user.id).toBe('u1');
    }
  });

  it.each(READS.map((r) => [`${r.method} ${r.path}`, r] as const))('%s: varsayilan (salt okuma) anahtarla okunmaya devam eder', async (_label, r) => {
    expect(sessionOnly(r.cls, r.handler)).toBeUndefined();
    const { ctx, req } = ctxFor(r, 'Bearer luvi_test');
    await expect(guard([...DEFAULT_SCOPES]).canActivate(ctx)).resolves.toBe(true);
    expect(req.apiKey).toBeTruthy();
  });

  it('SitesController: yalniz webhook isaretli — SDK\'nin kullandigi site CRUD anahtarla calisir', () => {
    for (const h of ['create', 'list', 'get', 'update', 'remove', 'setAutopilot', 'setCompetitors']) {
      expect(sessionOnly(SitesController, h), h).toBeUndefined();
    }
  });

  it('ayni denetleyicilerde okuma/senkron uclari anahtarla calismaya devam eder', () => {
    for (const [cls, h] of [
      [AscController, 'listAccounts'], [AscController, 'syncApps'],
      [OAuthController, 'optionsGoogleAds'], [OAuthController, 'optionsMetaAds'],
    ] as const) {
      expect(sessionOnly(cls, h), h).toBeUndefined();
    }
  });
});

describe('ChatController — sinif duzeyinde @SessionOnly (sohbeti yalniz panel kullanir)', () => {
  it('isaret sinifta: denetleyicinin TUM handler\'lari kapsanir (sonradan eklenen de)', () => {
    expect(Reflect.getMetadata(SESSION_ONLY_KEY, ChatController)).toBe(true);
    const handlers = Object.getOwnPropertyNames(ChatController.prototype).filter((n) => n !== 'constructor');
    expect(handlers.length).toBeGreaterThanOrEqual(5);
    for (const h of handlers) expect(sessionOnly(ChatController, h), h).toBe(true);
  });

  it.each(CHAT_READS.map((r) => [`${r.method} ${r.path}`, r] as const))("%s: varsayilan (salt okuma) ve '*' anahtari da 403 alir", async (_label, r) => {
    for (const scopes of [[...DEFAULT_SCOPES], ['*']]) {
      const { ctx, req } = ctxFor(r, 'Bearer luvi_test');
      const err = await guard(scopes).canActivate(ctx).catch((e) => e);
      expect(err, scopes.join(',')).toBeInstanceOf(ForbiddenException);
      expect(err.message).toContain('yalnız RanksUp panelinden');
      expect(req.user).toBeUndefined();
    }
  });

  it('isaret olmasaydi: yalniz social:write anahtari sohbet mesaji gonderebiliyordu (chat scope haritasinda yok)', async () => {
    const real = new ApiKeysService({} as never);
    expect(real.requiredScope('POST', '/api/sites/s1/chat/messages')).toBeNull();
    const send = SENSITIVE.find((r) => r.cls === ChatController && r.handler === 'send')!;
    const unmarked = function unmarked() {};
    class IsaretsizSohbet {}
    const req: any = { method: send.method, path: send.path, headers: { authorization: 'Bearer luvi_test' } };
    const ctx = { getHandler: () => unmarked, getClass: () => IsaretsizSohbet, switchToHttp: () => ({ getRequest: () => req }) } as any;
    await expect(guard(['social:write']).canActivate(ctx)).resolves.toBe(true);
  });

  it('panel oturumu (NextAuth JWT) sohbet okuma uclarinda da gecer', async () => {
    const token = await encode({ token: { sub: 'u1' }, secret: SECRET, salt: 'authjs.session-token', maxAge: 3600 });
    for (const r of CHAT_READS) {
      const { ctx, req } = ctxFor(r, `Bearer ${token}`);
      await expect(guard([...DEFAULT_SCOPES]).canActivate(ctx), r.path).resolves.toBe(true);
      expect(req.user.id).toBe('u1');
    }
  });
});

/**
 * Scope denetimi yol harfine duyarsiz.
 *
 * NEDEN VAR: Express /api/SITES/:id'yi /api/sites/:id handler'ina yollar; scope
 * haritasi eskiden harf duyarliydi ve buyuk harfli yol "bilinmeyen kaynak"
 * sayilip herhangi bir ':write' ile gecerdi (GET'te hic scope aranmazdi).
 */
describe('AuthGuard scope denetimi — buyuk/kucuk harf varyantlari', () => {
  const unmarked = function unmarked() {};
  class Ctl {}
  function ctx(method: string, path: string) {
    const req: any = { method, path, headers: { authorization: 'Bearer luvi_test' } };
    return {
      req,
      ctx: { getHandler: () => unmarked, getClass: () => Ctl, switchToHttp: () => ({ getRequest: () => req }) } as any,
    };
  }

  it.each([
    ['DELETE', '/api/SITES/s1', 'sites:write'],
    ['PATCH', '/api/sites/s1/ADS/google-ads', 'ads:write'],
    ['POST', '/api/sites/s1/Ads/c1/launch', 'ads:write'],
    ['POST', '/api/sites/s1/AUDIT/auto-fix-now', 'audit:write'],
    ['PATCH', '/API/sites/s1/ads/google-ads', 'ads:write'],
  ])("yalniz 'social:write' anahtari %s %s icin 403 alir (%s gerekir)", async (method, path, scope) => {
    const { ctx: c, req } = ctx(method, path);
    const err = await guard(['social:write']).canActivate(c).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toContain(`"${scope}"`);
    expect(req.user).toBeUndefined();
  });

  it("yalniz 'social:read' anahtari buyuk harfli site/analitik GET'lerini okuyamaz", async () => {
    for (const path of ['/api/SITES', '/api/sites/s1/ANALYTICS/overview']) {
      const { ctx: c } = ctx('GET', path);
      await expect(guard(['social:read']).canActivate(c), path).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('dogru scope\'lu anahtar buyuk harfli yolda da gecer', async () => {
    const { ctx: c, req } = ctx('DELETE', '/api/SITES/s1');
    await expect(guard(['sites:write']).canActivate(c)).resolves.toBe(true);
    expect(req.apiKey).toBeTruthy();
  });

  it('MCP transport\'u yalniz /api/mcp yolunda (harf duyarsiz) muaf; /mcp ile biten baska yol muaf degil', async () => {
    const readOnly = [...DEFAULT_SCOPES];
    // Okuma tool'lari salt-okunur anahtarla calisir; yazma denetimi McpController'da
    for (const path of ['/api/mcp', '/api/MCP', '/api/Mcp/']) {
      const { ctx: c } = ctx('POST', path);
      await expect(guard(readOnly).canActivate(c), path).resolves.toBe(true);
    }
    // Ileride eklenecek .../mcp rotasi scope denetimini sessizce atlamasin
    const { ctx: other } = ctx('POST', '/api/sites/s1/audit/mcp');
    await expect(guard(readOnly).canActivate(other)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('GbpController — sinif duzeyinde @SessionOnly (canli Google profiline yazar)', () => {
  it('panel uclarinin TUMU yalniz oturumla; herkese acik karne ayri sinifta ve isaretsiz', () => {
    expect(Reflect.getMetadata(SESSION_ONLY_KEY, GbpController)).toBe(true);
    const handlers = Object.getOwnPropertyNames(GbpController.prototype).filter((n) => n !== 'constructor' && typeof (GbpController.prototype as any)[n] === 'function');
    for (const h of ['ara', 'denetle', 'yanit', 'gonderiOlustur', 'konumSec', 'oauthBaslat']) expect(handlers, h).toContain(h);
    for (const h of handlers) expect(sessionOnly(GbpController, h), h).toBe(true);
    expect(Reflect.getMetadata(SESSION_ONLY_KEY, GbpPublicController)).toBeUndefined();
  });

  it('yalniz social:write anahtari yorum yanitina 403 alir', async () => {
    const r: Route = { cls: GbpController, handler: 'yanit', method: 'POST', path: '/api/sites/s1/gbp/yorumlar/r1/yanit' };
    const { ctx, req } = ctxFor(r, 'Bearer luvi_test');
    const err = await guard(['social:write']).canActivate(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(req.user).toBeUndefined();
  });
});
