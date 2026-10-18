import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';

/**
 * main.ts CORS — MCP Server Card on ucusu (SEP-2127), persona sohbet widget'i
 * + diger yollar AYNEN.
 *
 * NEDEN VAR: Server Card her kokenden okunabilmeli; controller GET cevabina
 * basliklari yaziyor ama OPTIONS on ucusunu global CORS ara katmani rotalardan
 * ONCE cevapliyor. Izin listesi disindaki kokene Allow-Origin donmedigi icin
 * If-None-Match'li okuma tarayicida reddediliyordu. Persona widget'i da musteri
 * sitesinden JSON POST atar (on ucus gerekir); ayni nedenle hic cevap alamiyordu.
 *
 * GERCEK main.ts yuklenir: yan etkili moduller (dotenv, Sentry, undici, tam
 * AppModule) sahtelenir, NestFactory.create sahte uygulama doner ve
 * enableCors'a verilen ayar yakalanir. Yakalanan ayar gercek bir Nest/Express
 * yiginina takilip HTTP ile denenir; Server Card disindaki her yol eski statik
 * ayarla (origin listesi + credentials) birebir karsilastirilir. DB yok.
 */

const yakalanan = vi.hoisted(() => ({ cors: undefined as unknown, prefix: undefined as unknown }));

vi.mock('dotenv/config', () => ({}));
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  httpIntegration: vi.fn(),
  consoleIntegration: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('undici', () => ({ setGlobalDispatcher: vi.fn(), Agent: class {} }));
vi.mock('./app.module.js', () => ({ AppModule: class AppModuleSahte {} }));
vi.mock('@nestjs/core', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@nestjs/core')>();
  return {
    ...orig,
    NestFactory: {
      create: vi.fn(async () => ({
        enableCors: (o: unknown) => { yakalanan.cors = o; },
        // Govde sinirlari ve icerik butcesi gercek HTTP ile main-body-limit.spec.ts'te sinaniyor
        useBodyParser: () => undefined,
        // 2 MiB yukleme ayristiricisi adaptor uzerinden kurulur (main.ts, inceleme S1)
        getHttpAdapter: () => ({ useBodyParser: () => undefined }),
        use: () => undefined,
        useGlobalPipes: () => undefined,
        setGlobalPrefix: (p: unknown) => { yakalanan.prefix = p; },
        useGlobalFilters: () => undefined,
        listen: async () => undefined,
      })),
    },
  };
});

/** Basliksiz sahte uclar: CORS basliklari yalniz ara katmandan gelir */
@Controller('mcp')
class SahteMcpController {
  @Get('server-card')
  kart() { return { ok: true }; }

  @Get('server-card-x')
  benzer() { return { ok: true }; }

  @Get()
  mcp() { return { ok: true }; }
}

@Controller('baska')
class BaskaController {
  @Get()
  get() { return { ok: true }; }
}

/** Persona sohbet ucu (audit.controller personaChatAsk) ve ayni onekteki baska bir uc */
@Controller('sites/:siteId/audit')
class SahteAuditController {
  @Post('persona/chat')
  @HttpCode(201)
  sohbet() { return { reply: 'ok' }; }

  @Post('prompts')
  prompt() { return { ok: true }; }

  @Get('persona/chat/gecmis')
  gecmis() { return { ok: true }; }
}

const ORIGINS = 'http://localhost:3000,https://ranksup.ai';
const DISARIDAN = 'https://baska-istemci.example';
const CORS_BASLIKLARI = [
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'access-control-max-age',
  'vary',
];

type CorsCb = (err: Error | null, options: Record<string, unknown>) => void;
type Delegate = (req: { url?: string; originalUrl?: string }, cb: CorsCb) => void;

async function uygulama(cors: unknown): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ controllers: [SahteMcpController, BaskaController, SahteAuditController] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.enableCors(cors as never);
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

function ozet(r: request.Response) {
  return { status: r.status, ...Object.fromEntries(CORS_BASLIKLARI.map((h) => [h, r.headers[h]])) };
}

describe('main.ts CORS', () => {
  let yeni: INestApplication;
  let eski: INestApplication;
  const eskiCorsOrigins = process.env.CORS_ORIGINS;

  beforeAll(async () => {
    process.env.CORS_ORIGINS = ORIGINS;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await import('./main.js');
    await vi.waitFor(() => {
      if (!yakalanan.cors) throw new Error('enableCors cagrilmadi');
    });
    log.mockRestore();
    yeni = await uygulama(yakalanan.cors);
    // Degisiklikten onceki main.ts ayari — karsilastirma tabani
    eski = await uygulama({ origin: ORIGINS.split(','), credentials: true });
  });

  afterAll(async () => {
    await yeni?.close();
    await eski?.close();
    if (eskiCorsOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = eskiCorsOrigins;
  });

  it('istek basina secim yapan bir fonksiyon verilir; global onek degismedi', () => {
    expect(typeof yakalanan.cors).toBe('function');
    expect(yakalanan.prefix).toBe('api');
  });

  it('secim: yalniz tam Server Card yolu (sondaki / ve sorgu serbest) herkese acik ayar alir', () => {
    const sec = (req: { url?: string; originalUrl?: string }) => {
      let secilen: Record<string, unknown> | undefined;
      (yakalanan.cors as Delegate)(req, (err, o) => { expect(err).toBeNull(); secilen = o; });
      return secilen!;
    };
    const kart = { origin: '*', methods: 'GET', allowedHeaders: 'Content-Type, If-None-Match', exposedHeaders: 'ETag', credentials: false };
    const varsayilan = { origin: ORIGINS.split(','), credentials: true };
    for (const url of ['/api/mcp/server-card', '/api/mcp/server-card/', '/api/mcp/server-card?v=1', '/api/mcp/server-card/?v=1']) {
      expect(sec({ url }), url).toEqual(kart);
    }
    for (const url of ['/api/mcp', '/api/mcp/server-cardx', '/api/mcp/server-card/fazla', '/api/mcp/server-card.json', '/mcp/server-card', '/api/baska?u=/api/mcp/server-card', '']) {
      expect(sec({ url }), url).toEqual(varsayilan);
    }
    expect(sec({ originalUrl: '/api/mcp/server-card', url: '/server-card' })).toEqual(kart);
  });

  it('secim: yalniz persona sohbet yolu (sondaki / ve sorgu serbest) widget ayarini alir', () => {
    const sec = (req: { url?: string; originalUrl?: string }) => {
      let secilen: Record<string, unknown> | undefined;
      (yakalanan.cors as Delegate)(req, (err, o) => { expect(err).toBeNull(); secilen = o; });
      return secilen!;
    };
    const widget = { origin: '*', methods: 'POST', allowedHeaders: 'Content-Type', credentials: false };
    const varsayilan = { origin: ORIGINS.split(','), credentials: true };
    for (const url of [
      '/api/sites/s1/audit/persona/chat', '/api/sites/cmoj14abc/audit/persona/chat/',
      '/api/sites/s1/audit/persona/chat?x=1', '/api/sites/s%2F1/audit/persona/chat',
    ]) {
      expect(sec({ url }), url).toEqual(widget);
    }
    for (const url of [
      '/api/sites/s1/audit/persona', '/api/sites/s1/audit/persona/chat/x', '/api/sites/s1/audit/persona/chatx',
      '/api/sites/s1/audit/prompts', '/api/sites//audit/persona/chat', '/api/sites/a/b/audit/persona/chat',
      '/sites/s1/audit/persona/chat', '/api/baska?u=/api/sites/s1/audit/persona/chat', '/api/sites/s1/audit/PERSONA/chat',
    ]) {
      expect(sec({ url }), url).toEqual(varsayilan);
    }
    expect(sec({ originalUrl: '/api/sites/s1/audit/persona/chat', url: '/persona/chat' })).toEqual(widget);
  });

  it('persona on ucusu: musteri sitesinden *, POST, Content-Type; kimlik bilgisi yok', async () => {
    for (const yol of ['/api/sites/s1/audit/persona/chat', '/api/sites/s1/audit/persona/chat/']) {
      const r = await request(yeni.getHttpServer())
        .options(yol)
        .set('Origin', DISARIDAN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type');
      expect(r.status, yol).toBe(204);
      expect(r.headers['access-control-allow-origin'], yol).toBe('*');
      expect(r.headers['access-control-allow-methods'], yol).toBe('POST');
      expect(r.headers['access-control-allow-headers'], yol).toBe('Content-Type');
      expect(r.headers['access-control-allow-credentials'], yol).toBeUndefined();
    }
  });

  it('persona POST cevabi her kokende okunabilir; eski ayar musteri sitesine Allow-Origin donmuyordu', async () => {
    for (const origin of [DISARIDAN, 'https://ranksup.ai']) {
      const r = await request(yeni.getHttpServer())
        .post('/api/sites/s1/audit/persona/chat')
        .set('Origin', origin)
        .set('Content-Type', 'application/json')
        .send({ history: [{ role: 'user', content: 'Merhaba' }] });
      expect(r.status, origin).toBe(201);
      expect(r.headers['access-control-allow-origin'], origin).toBe('*');
      expect(r.headers['access-control-allow-credentials'], origin).toBeUndefined();
    }
    // Duzeltilen hata: izin listesi disindaki musteri sitesinin on ucusu Allow-Origin almiyordu
    const eskiOnUcus = await request(eski.getHttpServer())
      .options('/api/sites/s1/audit/persona/chat')
      .set('Origin', DISARIDAN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(eskiOnUcus.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('Server Card on ucusu: izin listesi disindaki kokene de *, GET, If-None-Match; kimlik bilgisi yok', async () => {
    for (const yol of ['/api/mcp/server-card', '/api/mcp/server-card/', '/api/mcp/server-card?v=1']) {
      const r = await request(yeni.getHttpServer())
        .options(yol)
        .set('Origin', DISARIDAN)
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'if-none-match');
      expect(r.status, yol).toBe(204);
      expect(r.headers['access-control-allow-origin'], yol).toBe('*');
      expect(r.headers['access-control-allow-methods'], yol).toBe('GET');
      expect(r.headers['access-control-allow-headers'], yol).toBe('Content-Type, If-None-Match');
      expect(r.headers['access-control-expose-headers'], yol).toBe('ETag');
      expect(r.headers['access-control-allow-credentials'], yol).toBeUndefined();
    }
  });

  it('eski ayar ayni on ucusta Allow-Origin donmuyordu (duzeltilen hata)', async () => {
    const r = await request(eski.getHttpServer())
      .options('/api/mcp/server-card')
      .set('Origin', DISARIDAN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'if-none-match');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('Server Card GET: her kokene *, ETag okunabilir, kimlik bilgisi basligi yok', async () => {
    for (const origin of [DISARIDAN, 'http://localhost:3000']) {
      const r = await request(yeni.getHttpServer()).get('/api/mcp/server-card').set('Origin', origin);
      expect(r.status, origin).toBe(200);
      expect(r.headers['access-control-allow-origin'], origin).toBe('*');
      expect(r.headers['access-control-expose-headers'], origin).toBe('ETag');
      expect(r.headers['access-control-allow-credentials'], origin).toBeUndefined();
    }
  });

  it('diger her yol eski statik ayarla birebir ayni (durum + CORS basliklari)', async () => {
    const yollar = [
      '/api/mcp', '/api/baska', '/api/mcp/server-card-x', '/api/mcp/server-card/fazla', '/api/mcp/SERVER-CARD',
      // persona sohbetine benzeyen ama o yol olmayan uclar izin listesinde kalir
      '/api/sites/s1/audit/prompts', '/api/sites/s1/audit/persona/chat/gecmis',
    ];
    const kokenler = ['http://localhost:3000', 'https://ranksup.ai', DISARIDAN, undefined];
    let denenen = 0;
    for (const yol of yollar) {
      for (const origin of kokenler) {
        for (const yontem of ['options', 'get'] as const) {
          const istek = (app: INestApplication) => {
            let r = request(app.getHttpServer())[yontem](yol);
            if (origin) r = r.set('Origin', origin);
            if (yontem === 'options') r = r.set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type,authorization');
            return r;
          };
          const [a, b] = await Promise.all([istek(yeni), istek(eski)]);
          expect(ozet(a), `${yontem} ${yol} ${origin ?? '(koken yok)'}`).toEqual(ozet(b));
          denenen++;
        }
      }
    }
    expect(denenen).toBe(56);
    // Ornek: izinli kokene yansitma + credentials korunuyor
    const r = await request(yeni.getHttpServer()).get('/api/baska').set('Origin', 'https://ranksup.ai');
    expect(r.headers['access-control-allow-origin']).toBe('https://ranksup.ai');
    expect(r.headers['access-control-allow-credentials']).toBe('true');
  });
});
