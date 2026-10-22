import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { ArgumentsHost, ExceptionFilter, INestApplication } from '@nestjs/common';
import { Catch, Controller, Get, HttpException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { McpController } from './mcp.controller.js';
import { McpWellKnownController, MCP_WELL_KNOWN_PREFIX_EXCLUDE } from './mcp-well-known.controller.js';
import { McpToolsService } from './mcp-tools.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { PaytrService } from '../billing/paytr.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  MCP_SERVER_INFO,
  SERVER_CARD_MEDIA_TYPE,
  buildProtectedResourceMetadata,
  buildServerCard,
  mcpEndpointUrl,
  protectedResourceMetadataUrl,
} from './mcp-discovery.js';

/**
 * MCP KESIF + 401 ZINCIRI — HTTP UCTAN UCA.
 *
 * NEDEN VAR: 401'i McpController degil global AuthGuard atar. Basligi ekleyen
 * filtre controller'a bagli; guard istisnasinin o filtreye ulastigini ve
 * main.ts'teki catch-all (Sentry) filtresinin onu EZMEDIGINI yalnizca gercek
 * Nest yigini gosterebilir. Ayni yigin 'api' onek istisnasini (RFC 9728
 * metadatasi kokte) ve Server Card basliklarini da dogrular. DB yok.
 */

/** design:paramtypes shim — esbuild decorator metadata uretmiyor (bkz. ingest-e2e.spec.ts) */
function shimParamTypes(target: unknown, deps: unknown[]): void {
  if (!Reflect.getMetadata('design:paramtypes', target as object)) {
    Reflect.defineMetadata('design:paramtypes', deps, target as object);
  }
}
shimParamTypes(McpController, [McpToolsService, QuotaService, ApiKeysService, PaytrService]);
shimParamTypes(AuthGuard, [PrismaService, Reflector, ApiKeysService]);

/** main.ts SentryExceptionFilter ile ayni yanit bicimi: @Catch() — her seyi yakalar */
@Catch()
class CatchAllLikeMain implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const isHttp = exception instanceof HttpException;
    const body = isHttp ? (exception as HttpException).getResponse() : { statusCode: 500, message: 'Internal server error' };
    res.status(isHttp ? (exception as HttpException).getStatus() : 500).json(typeof body === 'string' ? { message: body } : body);
  }
}

/** MCP disi korumali bir uc — 401'i WWW-Authenticate TASIMAMALI (filtre yalnizca MCP'de) */
@Controller('baska')
class BaskaController {
  @Get()
  get() {
    return { ok: true };
  }
}

const ORIGIN = 'https://api.ranksup.ai';
const GOOD_KEY = 'luvi_dogru_anahtar_0123456789';

describe('MCP kesif + 401 (HTTP)', () => {
  let app: INestApplication;
  const eskiApiBase = process.env.API_BASE_URL;

  beforeAll(async () => {
    process.env.API_BASE_URL = ORIGIN;
    const prismaForTools = { user: { findUniqueOrThrow: async () => ({ plan: 'ENTERPRISE' }) } } as never;
    const n = null as never;
    const tools = new McpToolsService(prismaForTools, n, new QuotaService(prismaForTools), n, n, n, n, n, n, n, n, n);
    const apiKeys = {
      validate: vi.fn(async (t: string) => (t === GOOD_KEY ? { userId: 'u1', scopes: ['*'] } : null)),
      requiredScope: () => null,
      hasScopeForRoute: () => true,
    };
    const prisma = { user: { findUnique: vi.fn(async () => ({ id: 'u1', role: 'USER', plan: 'ENTERPRISE' })) } };

    const moduleRef = await Test.createTestingModule({
      controllers: [McpController, McpWellKnownController, BaskaController],
      providers: [
        { provide: McpToolsService, useValue: tools },
        { provide: QuotaService, useValue: { enforcePlanFeature: vi.fn(async () => {}) } },
        { provide: ApiKeysService, useValue: apiKeys },
        { provide: PaytrService, useValue: { checkoutStatus: vi.fn(async () => ({ open: true })), hasEverPaid: vi.fn(async () => false) } },
        { provide: PrismaService, useValue: prisma },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // main.ts ile ayni sira. CORS BIREBIR AYNI DEGIL: main.ts istek basina
    // delege kullanir (Server Card yolu MCP_SERVER_CARD_CORS, diger yollar
    // izin listesi + credentials); delege src/main-cors.spec.ts'te sinanir.
    // Burada yalniz varsayilan kolun statik karsiligi var — Server Card'in
    // CORS basliklarini bu testte controller'in kendisi yazar.
    app.enableCors({ origin: ['http://localhost:3000'], credentials: true });
    app.setGlobalPrefix('api', { exclude: [MCP_WELL_KNOWN_PREFIX_EXCLUDE] });
    app.useGlobalFilters(new CatchAllLikeMain());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (eskiApiBase === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = eskiApiBase;
  });

  const metadataUrl = protectedResourceMetadataUrl(mcpEndpointUrl(ORIGIN));

  it('kimliksiz MCP istegi: 401 + WWW-Authenticate resource_metadata (hata kodu yok)', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toBe(`Bearer resource_metadata="${metadataUrl}"`);
    expect(metadataUrl).toBe('https://api.ranksup.ai/.well-known/oauth-protected-resource/api/mcp');
  });

  it('gecersiz anahtar: 401 + error="invalid_token"', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/mcp')
      .set('Authorization', 'Bearer luvi_yanlis')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toBe(`Bearer error="invalid_token", resource_metadata="${metadataUrl}"`);
  });

  it('GET /api/mcp (SSE yok) kimliksizken de basligi tasir', async () => {
    const r = await request(app.getHttpServer()).get('/api/mcp');
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toContain('resource_metadata=');
  });

  it('MCP disi 401 degismedi: WWW-Authenticate yok', async () => {
    const r = await request(app.getHttpServer()).get('/api/baska');
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toBeUndefined();
  });

  it('RFC 9728 metadatasi kokte: /.well-known/oauth-protected-resource/api/mcp', async () => {
    const r = await request(app.getHttpServer()).get('/.well-known/oauth-protected-resource/api/mcp');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^application\/json/);
    expect(r.body).toEqual(buildProtectedResourceMetadata(ORIGIN));
    // Yetkilendirme sunucusu YOK — uydurulmadi
    expect(r.body).not.toHaveProperty('authorization_servers');
    // Onek altinda yayimlanmiyor
    const yanlis = await request(app.getHttpServer()).get('/api/.well-known/oauth-protected-resource/api/mcp');
    expect(yanlis.status).not.toBe(200);
  });

  it('Server Card: herkese acik, dogru medya turu, CORS ve onbellek basliklari', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/mcp/server-card')
      .set('Origin', 'http://localhost:3000')
      .set('Accept', SERVER_CARD_MEDIA_TYPE);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe(SERVER_CARD_MEDIA_TYPE);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(r.headers['access-control-allow-methods']).toBe('GET');
    expect(r.headers['access-control-allow-headers']).toBe('Content-Type, If-None-Match');
    expect(r.headers['access-control-expose-headers']).toBe('ETag');
    expect(r.headers['access-control-allow-credentials']).toBeUndefined();
    expect(r.headers['cache-control']).toBe('public, max-age=3600');
    expect(r.headers.etag).toBeTruthy();
    expect(JSON.parse(r.text)).toEqual(buildServerCard(ORIGIN));
  });

  it('Server Card: If-None-Match ayni ETag ile 304', async () => {
    const ilk = await request(app.getHttpServer()).get('/api/mcp/server-card');
    const r = await request(app.getHttpServer()).get('/api/mcp/server-card').set('If-None-Match', ilk.headers.etag);
    expect(r.status).toBe(304);
  });

  it('initialize kartla celismiyor: surum, baslik, protokol surumleri', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/mcp')
      .set('Authorization', `Bearer ${GOOD_KEY}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(r.status).toBe(200);
    const card = buildServerCard(ORIGIN);
    expect(r.body.result.serverInfo).toEqual(MCP_SERVER_INFO);
    expect(card.version).toBe(r.body.result.serverInfo.version);
    expect(card.title).toBe(r.body.result.serverInfo.title);
    expect(card.name.split('/')[1]).toBe(r.body.result.serverInfo.name);
    expect(card.remotes[0].supportedProtocolVersions).toContain(r.body.result.protocolVersion);
  });

  it('tools/list: gercek kayittaki her arac annotations ile doner', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/mcp')
      .set('Authorization', `Bearer ${GOOD_KEY}`)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(r.status).toBe(200);
    const list = r.body.result.tools as Array<{ name: string; title: string; annotations: Record<string, unknown> }>;
    expect(list.length).toBeGreaterThan(20);
    for (const t of list) {
      expect(t.annotations.title, t.name).toBe(t.title);
      expect(typeof t.annotations.readOnlyHint, t.name).toBe('boolean');
      expect(typeof t.annotations.destructiveHint, t.name).toBe('boolean');
    }
  });
});
