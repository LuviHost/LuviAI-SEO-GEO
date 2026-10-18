import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { VALIDATION_MESSAGE_LIMIT, VALIDATION_MORE_ERRORS_MESSAGE } from './common/validation-errors.js';
import { jsonBodyTooManyNodesMessage } from './common/json-body-budget.js';
import { PERSONA_CHAT_JSON_BODY_BUDGET } from './request-body.js';

/**
 * Inceleme R1 regresyonu — herkese acik persona sohbeti GERCEK zincirle.
 *
 * NEDEN VAR: global 2 MiB JSON siniri + PersonaChatDto'nun oge oge dogrulamasi
 * yuzunden kimliksiz tek bir istek ({"history":[{},{},...]}, uydurma bir
 * kanonik site kimligiyle) tek API surecini ~3,5 sn kilitliyor, RSS'i ~2 GB
 * buyutuyor ve 108 MB'lik bir 400 donuyordu; global 60/dk icinde kalan tek
 * IP sureci surekli kilitli tutabiliyordu. Uydurma kimlikler ayrica her
 * istekte yeni hiz siniri kovalari aciyordu.
 *
 * GERCEK main.ts (CORS, uc basina ayristiricilar, icerik butcesi,
 * ValidationPipe, filtre) + GERCEK AuditController rotasi (@Public +
 * PersonaChatThrottlerGuard) + app.module.ts sirasindaki GERCEK global
 * guard'lar (ProxyThrottlerGuard, AuthGuard, SiteAccessGuard,
 * PlanFeatureGuard) + ayni ThrottlerModule ayari. Prisma sahte: yalniz
 * persona guard'inin site varlik sorgusuna cevap verir, baska her erisim
 * hata firlatir. Model cagrisi yok (PersonaChatService.ask sahte).
 */

const h = vi.hoisted(() => ({
  app: undefined as INestApplication | undefined,
  siteLookups: [] as string[],
  otherDbAccess: [] as string[],
  ask: undefined as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('dotenv/config', () => ({}));
vi.mock('@sentry/node', () => ({ init: vi.fn(), httpIntegration: vi.fn(), consoleIntegration: vi.fn(), captureException: vi.fn() }));
vi.mock('undici', () => ({ setGlobalDispatcher: vi.fn(), Agent: class {} }));
vi.mock('./ipv4-pin.js', () => ({ pinProcessToIpv4: () => false }));
vi.mock('./app.module.js', () => ({ AppModule: class AppModuleSahte {} }));
vi.mock('@nestjs/core', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@nestjs/core')>();
  return {
    ...orig,
    NestFactory: {
      create: vi.fn(async (_m: unknown, options: Record<string, unknown> = {}) => {
        const { Test } = await import('@nestjs/testing');
        const { ThrottlerModule } = await import('@nestjs/throttler');
        const { ProxyThrottlerGuard } = await import('./common/proxy-throttler.guard.js');
        const { AuthGuard } = await import('./auth/auth.guard.js');
        const { SiteAccessGuard } = await import('./auth/site-access.guard.js');
        const { PlanFeatureGuard } = await import('./billing/plan-feature.guard.js');
        const { AuditController } = await import('./audit/audit.controller.js');
        const { PersonaChatDto } = await import('./audit/audit.dto.js');
        const { PrismaService } = await import('./prisma/prisma.service.js');
        const { MeasurementAllowanceService } = await import('./billing/measurement-allowance.service.js');
        // nest build personaChatAsk(@Param siteId: string, @Body body: PersonaChatDto) icin bunu yazar;
        // vitest/esbuild dekorator metadata'si uretmez
        Reflect.defineMetadata('design:paramtypes', [String, PersonaChatDto], AuditController.prototype, 'personaChatAsk');
        const site = {
          findUnique: async ({ where }: { where: { id: string } }) => {
            h.siteLookups.push(where.id);
            return where.id === 'site1' ? { id: 'site1' } : null;
          },
        };
        // Nest saglayicinin yasam dongusu kancalarini yoklar; onlar DB erisimi degil
        const nestKancalari = new Set(['onModuleInit', 'onApplicationBootstrap', 'onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationShutdown', 'constructor']);
        const prisma = new Proxy({ site } as Record<string, unknown>, {
          get(target, k) {
            if (k === 'site') return target.site;
            if (k === 'then' || typeof k === 'symbol' || nestKancalari.has(k)) return undefined;
            h.otherDbAccess.push(String(k));
            throw new Error(`DB'ye beklenmeyen erisim: ${String(k)}`);
          },
        });
        const moduleRef = await Test.createTestingModule({
          imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
          controllers: [AuditController],
          providers: [
            // PersonaChatThrottlerGuard bunu acik belirtecle (@Inject(PrismaService)) alir
            { provide: PrismaService, useValue: prisma },
            // Yalniz baska rotalarin olcum interceptor'i icin; persona rotasinda kullanilmaz
            { provide: MeasurementAllowanceService, useValue: {} },
            { provide: orig.APP_GUARD, useClass: ProxyThrottlerGuard },
            { provide: orig.APP_GUARD, useFactory: (r: any) => new AuthGuard(prisma as any, r, {} as any), inject: [orig.Reflector] },
            { provide: orig.APP_GUARD, useFactory: (r: any) => new SiteAccessGuard(prisma as any, r), inject: [orig.Reflector] },
            { provide: orig.APP_GUARD, useFactory: (r: any) => new PlanFeatureGuard(r, {} as any), inject: [orig.Reflector] },
          ],
        }).compile();
        // Controller bagimliliksiz kuruldu (metadata yok): yalniz persona servisi sahtelenir
        h.ask = vi.fn(async () => ({ reply: 'Merhaba!', sources: [], cited: false }));
        (moduleRef.get(AuditController) as any).personaChat = { ask: h.ask };
        const app = moduleRef.createNestApplication({ ...options, logger: false });
        h.app = app;
        return app;
      }),
    },
  };
});

const MUSTERI_SITESI = 'https://musteri-sitesi.example';

/** {"history":[{},{},...]} — R1 saldiri govdesi, en fazla `bayt` uzunlugunda */
function bosGecmis(bayt: number): string {
  const bas = '{"history":[';
  const n = Math.floor((bayt - bas.length - 2 + 1) / 3);
  return `${bas}${Array(n).fill('{}').join(',')}]}`;
}

describe('R1: persona sohbeti gercek zincirde (main.ts + AuditController + global guard\'lar)', () => {
  const eskiEnv = { CORS_ORIGINS: process.env.CORS_ORIGINS, API_PORT: process.env.API_PORT };
  let ipSayac = 0;
  /** Her test kendi IP'sinden: global 60/dk kovasi testleri birbirine baglamasin */
  const yeniIp = () => `203.0.113.${++ipSayac}`;
  const sohbet = (siteId: string, govde: string, ip: string) =>
    request(h.app!.getHttpServer())
      .post(`/api/sites/${siteId}/audit/persona/chat`)
      .set('Content-Type', 'application/json')
      .set('Origin', MUSTERI_SITESI)
      .set('CF-Connecting-IP', ip)
      .send(govde);

  beforeAll(async () => {
    process.env.CORS_ORIGINS = 'https://ranksup.ai';
    process.env.API_PORT = '0';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await import('./main.js');
    await vi.waitFor(() => {
      expect(log).toHaveBeenCalledWith(expect.stringContaining('listening'));
    }, { timeout: 30_000 });
    log.mockRestore();
  });

  beforeEach(() => {
    h.siteLookups.length = 0;
    h.ask.mockClear();
    vi.mocked(Sentry.captureException).mockClear();
  });

  afterAll(async () => {
    await h.app?.close();
    for (const [ad, deger] of Object.entries(eskiEnv)) {
      if (deger === undefined) delete process.env[ad];
      else process.env[ad] = deger;
    }
  });

  it('gecerli widget govdesi zincirden gecer ve cevap doner (rota, guard\'lar, pipe bagli)', async () => {
    const r = await sohbet('site1', JSON.stringify({ history: [{ role: 'user', content: 'Merhaba' }] }), yeniIp());
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ reply: 'Merhaba!', sources: [], cited: false });
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(h.ask).toHaveBeenCalledWith('site1', [{ role: 'user', content: 'Merhaba' }]);
    expect(h.otherDbAccess).toEqual([]);
  });

  it('2 MiB bos ogeli gecmis, uydurma site kimligi: hizli 413, kucuk cevap; guard/DB/pipe hic calismaz', async () => {
    const govde = bosGecmis(2 * 1024 * 1024);
    const t0 = performance.now();
    const r = await sohbet('x9uydurma', govde, yeniIp());
    const sure = performance.now() - t0;
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ statusCode: 413, message: 'Gönderilen veri çok büyük (en fazla 64 KB).' });
    // Eskiden: 400, 114.310.266 bayt, ~3.600 ms olay dongusu kilidi, +1,9 GB RSS
    expect(Buffer.byteLength(r.text)).toBeLessThan(1024);
    expect(sure).toBeLessThan(1_000);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(h.siteLookups).toEqual([]);
    expect(h.ask).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('64 KB\'a sigan ~21 bin bos oge: persona icerik butcesi guard\'lardan once 413 (DB\'ye gidilmez)', async () => {
    const t0 = performance.now();
    const r = await sohbet('x9uydurma', bosGecmis(64 * 1024), yeniIp());
    const sure = performance.now() - t0;
    expect(r.status).toBe(413);
    expect(r.body.message).toBe(jsonBodyTooManyNodesMessage(PERSONA_CHAT_JSON_BODY_BUDGET.maxNodes));
    expect(Buffer.byteLength(r.text)).toBeLessThan(1024);
    expect(sure).toBeLessThan(1_000);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(h.siteLookups).toEqual([]);
  });

  it('butce icindeki gecersiz gecmis: 400 en fazla 20 mesaj + ozet, birkac KB (Nest varsayilaniyla 900 mesaj)', async () => {
    const r = await sohbet('site1', JSON.stringify({ history: Array.from({ length: 300 }, () => ({})) }), yeniIp());
    expect(r.status).toBe(400);
    expect(r.body.message).toHaveLength(VALIDATION_MESSAGE_LIMIT + 1);
    expect(r.body.message[VALIDATION_MESSAGE_LIMIT]).toBe(VALIDATION_MORE_ERRORS_MESSAGE);
    expect(Buffer.byteLength(r.text)).toBeLessThan(4 * 1024);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(h.ask).not.toHaveBeenCalled();
  });

  it('uydurma kimlik dondurmek yeni kova acmaz: ayni IP 20 mesajdan sonra 429 (eskiden her kimlik taze kova)', async () => {
    const ip = yeniIp();
    const govde = JSON.stringify({ history: [{ role: 'user', content: 'Merhaba' }] });
    const durumlar: number[] = [];
    for (let i = 0; i < 22; i++) durumlar.push((await sohbet(`x9uydurma${i}`, govde, ip)).status);
    expect(durumlar.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(durumlar.slice(20)).toEqual([429, 429]);
    // Gercek site kendi kovasinda: ayni IP'den yine gecer
    expect((await sohbet('site1', govde, ip)).status).toBe(201);
    expect(h.otherDbAccess).toEqual([]);
  });
});
