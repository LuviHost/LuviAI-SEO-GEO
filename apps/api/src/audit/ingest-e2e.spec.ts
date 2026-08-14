import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { TrackerController } from './tracker.controller.js';
import { LiveCrawlerService } from './live-crawler.service.js';
import { AiReferrerService } from './ai-referrer.service.js';
import { PersonaChatService } from './persona-chat.service.js';
import { WebhookNotifierService } from './webhook-notifier.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  computeIngestSignature,
  INGEST_SIGNATURE_HEADER,
  INGEST_TIMESTAMP_HEADER,
  INGEST_TIMESTAMP_TOLERANCE_MS,
} from './ingest-auth.js';

/**
 * INGEST ZINCIRI — HTTP UCTAN UCA.
 *
 * NEDEN VAR: ingest-auth.spec.ts imza fonksiyonlarini saf birim olarak sinar,
 * ama ZINCIRI sinamaz. Imza dogru hesaplansa bile su uc kablodan biri koparsa
 * TUM ingest sessizce 401'e duser ve mevcut birim testleri yine yesil kalir:
 *
 *   1) rawBody: main.ts'te NestFactory.create(AppModule, { rawBody: true })
 *      olmazsa req.rawBody undefined kalir, controller bos string imzalar.
 *   2) header adlari: express basliklari KUCUK HARFE cevirir; controller
 *      headers[INGEST_SIGNATURE_HEADER] ile okur. Sabit buyuk harfli olsaydi
 *      lookup daima undefined donerdi.
 *   3) @SkipThrottle({ default: false }) + @Throttle override: sinif
 *      seviyesindeki @SkipThrottle() ingest ucunu de muaf birakirdi.
 *
 * Bu dosya gercek Nest HTTP yiginini (global AuthGuard + ThrottlerGuard +
 * ValidationPipe + 'api' prefix) ayaga kaldirir; yalnizca Prisma ve yan etki
 * servisleri sahtedir. DB'ye BAGLANMAZ.
 */

// ── Sabitler ────────────────────────────────────────────────────────────────
const SITE_ID = 'site_e2e_1';
const SECRET = 'luvi_ing_0123456789abcdef0123456789abcdef0123456789abcdef';
const ROUTE = '/api/tracker/events';

/**
 * design:paramtypes shim.
 *
 * NEDEN: apps/api'de vitest yapilandirmasi yok, yani testler esbuild ile
 * derleniyor ve esbuild `emitDecoratorMetadata` DESTEKLEMIYOR. Bu yuzden
 * kaynak siniflarda constructor tip metadatasi olusmuyor ve Nest'in DI'si
 * bagimliliklari cozemiyor ("Nest can't resolve dependencies"). Burada
 * tsc'nin uretecegi metadatanin AYNISINI elle yaziyoruz — uretim davranisi
 * degismiyor, yalnizca test kosucusunun eksigi kapatiliyor.
 *
 * Bagimlilik SIRASI kaynaktaki constructor ile birebir ayni olmak zorunda;
 * degisirse mock'lar yanlis parametreye enjekte olur ve testler patlar (ki
 * bu da istenen uyaridir).
 */
function shimParamTypes(target: unknown, deps: unknown[]): void {
  if (!Reflect.getMetadata('design:paramtypes', target as object)) {
    Reflect.defineMetadata('design:paramtypes', deps, target as object);
  }
}

shimParamTypes(TrackerController, [AiReferrerService, PersonaChatService, LiveCrawlerService]);
shimParamTypes(LiveCrawlerService, [PrismaService, NotificationsService, WebhookNotifierService]);
shimParamTypes(AuthGuard, [PrismaService, Reflector, ApiKeysService]);

// ── Sahte Prisma — gercek DB'ye hicbir baglanti yok ─────────────────────────
function makePrismaMock() {
  return {
    site: {
      findUnique: vi.fn(async () => ({
        id: SITE_ID,
        userId: 'user_1',
        name: 'E2E Site',
        ingestSecret: SECRET,
      })),
    },
    crawlerHitEvent: {
      count: vi.fn(async () => 0),
      createMany: vi.fn(async (args: any) => ({ count: args?.data?.length ?? 0 })),
    },
    // Gunluk toplamlar fire-and-forget cagriliyor; tanimsiz kalirsa
    // yalnizca warn loglar ama gurultu yapmasin diye sahtelendi.
    aiCrawlerHit: { upsert: vi.fn(async () => ({})) },
    kvStore: { create: vi.fn(async () => ({})) },
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

async function createIngestApp(): Promise<{ app: INestApplication; prisma: PrismaMock }> {
  const prisma = makePrismaMock();

  const moduleRef = await Test.createTestingModule({
    // Global throttler varsayilani KASITLI olarak cok dusuk (2/dk): ingest ucu
    // kendi @Throttle({ limit: 300 }) override'ini uygulamazsa ucuncu istek
    // 429 doner ve test patlar.
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }])],
    controllers: [TrackerController],
    providers: [
      LiveCrawlerService,
      { provide: PrismaService, useValue: prisma },
      { provide: NotificationsService, useValue: { create: vi.fn(async () => ({})) } },
      { provide: WebhookNotifierService, useValue: { notify: vi.fn(async () => ({})) } },
      { provide: AiReferrerService, useValue: { record: vi.fn(async () => ({})) } },
      { provide: PersonaChatService, useValue: { buildWidgetJs: vi.fn(() => '') } },
      { provide: ApiKeysService, useValue: { validate: vi.fn(async () => null) } },
      // Uretimdeki global guard'lar — @Public() gercekten calisiyor mu,
      // throttle override gercekten uygulaniyor mu buradan gorulur.
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_GUARD, useClass: ThrottlerGuard },
    ],
  }).compile();

  // main.ts ile AYNI uygulama ayarlari: rawBody, ValidationPipe, 'api' prefix.
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.setGlobalPrefix('api');
  await app.init();

  return { app, prisma };
}

/** Ham govdeyi imzalayip basliklarla birlikte gonder. */
function signedPost(
  app: INestApplication,
  rawBody: string,
  opts: { secret?: string; timestamp?: number; signature?: string } = {},
) {
  const ts = opts.timestamp ?? Date.now();
  const signature =
    opts.signature ?? computeIngestSignature(opts.secret ?? SECRET, ts, rawBody);

  return request(app.getHttpServer())
    .post(ROUTE)
    .set('Content-Type', 'application/json')
    // Basliklar BILEREK karisik harfli gonderiliyor: controller sabitleri
    // kucuk harfli, express de kucuk harfe cevirir. Bu esleme koparsa
    // dogru imzali istekler bile 401 olurdu.
    .set('X-RanksUp-Signature', signature)
    .set('X-RanksUp-Timestamp', String(ts))
    .send(rawBody);
}

describe('POST /api/tracker/events — ingest zinciri (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  beforeAll(async () => {
    ({ app, prisma } = await createIngestApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    prisma.crawlerHitEvent.createMany.mockClear();
    prisma.crawlerHitEvent.count.mockClear();
    prisma.site.findUnique.mockClear();
  });

  it('dogru imzali istek kabul edilir ve event servise ULASIR', async () => {
    const rawBody = JSON.stringify({
      site: SITE_ID,
      source: 'worker',
      events: [{ ua: 'Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)', path: '/blog/geo', status: 200 }],
    });

    const res = await signedPost(app, rawBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ accepted: 1, skipped: 0 });

    // Zincirin sonu: satir gercekten yazma cagrisina ulasti mi?
    expect(prisma.crawlerHitEvent.createMany).toHaveBeenCalledTimes(1);
    const written = prisma.crawlerHitEvent.createMany.mock.calls[0][0].data;
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      siteId: SITE_ID,
      bot: 'GPTBot',
      path: '/blog/geo',
      status: 200,
      source: 'worker',
      isCiteFetch: false,
    });
  });

  it('imzasiz istek 401 doner ve hicbir sey yazilmaz', async () => {
    const rawBody = JSON.stringify({
      site: SITE_ID,
      events: [{ ua: 'GPTBot/1.1', path: '/', status: 200 }],
    });

    const res = await request(app.getHttpServer())
      .post(ROUTE)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(401);
    expect(prisma.crawlerHitEvent.createMany).not.toHaveBeenCalled();
  });

  it('yanlis imza 401 doner', async () => {
    const rawBody = JSON.stringify({
      site: SITE_ID,
      events: [{ ua: 'GPTBot/1.1', path: '/', status: 200 }],
    });

    // Baska bir sirla uretilmis, bicimi tamamen gecerli bir imza.
    const res = await signedPost(app, rawBody, { secret: SECRET + 'x' });

    expect(res.status).toBe(401);
    expect(prisma.crawlerHitEvent.createMany).not.toHaveBeenCalled();
  });

  it('eski zaman damgasi 401 doner (replay penceresi disi)', async () => {
    const rawBody = JSON.stringify({
      site: SITE_ID,
      events: [{ ua: 'GPTBot/1.1', path: '/', status: 200 }],
    });

    // Imza bu eski damgayla DOGRU hesaplaniyor; reddin tek sebebi pencere.
    const stale = Date.now() - INGEST_TIMESTAMP_TOLERANCE_MS - 60_000;
    const res = await signedPost(app, rawBody, { timestamp: stale });

    expect(res.status).toBe(401);
    expect(prisma.crawlerHitEvent.createMany).not.toHaveBeenCalled();
  });

  it('imzalandiktan sonra govde degistirilirse 401 (ham govde uzerinden dogrulama)', async () => {
    const signedBody = JSON.stringify({
      site: SITE_ID,
      events: [{ ua: 'GPTBot/1.1', path: '/fiyatlar', status: 200 }],
    });
    const tamperedBody = JSON.stringify({
      site: SITE_ID,
      events: [{ ua: 'GPTBot/1.1', path: '/fiyatlar', status: 500 }],
    });

    const ts = Date.now();
    const res = await request(app.getHttpServer())
      .post(ROUTE)
      .set('Content-Type', 'application/json')
      .set('X-RanksUp-Signature', computeIngestSignature(SECRET, ts, signedBody))
      .set('X-RanksUp-Timestamp', String(ts))
      .send(tamperedBody);

    expect(res.status).toBe(401);
    expect(prisma.crawlerHitEvent.createMany).not.toHaveBeenCalled();
  });

  it('HAM metin imzalanir — bosluk/anahtar sirasi farkli govde de gecerli sayilir', async () => {
    // Bu test 5. testin AYNASI: orada degisen govde reddedilmeli, burada ise
    // JSON.stringify'in URETMEYECEGI bir metin (girintili, anahtarlari ters
    // sirali) kabul edilmeli. Dogrulama parse edilmis nesneyi yeniden
    // serilestirseydi imza tutmaz ve bu istek 401 olurdu.
    const rawBody = `{\n  "events" : [ { "bot": "ChatGPT-User", "path": "/urun/geo", "status": 200 } ],\n  "source":"wp",\n  "site":"${SITE_ID}"\n}`;
    expect(rawBody).not.toBe(JSON.stringify(JSON.parse(rawBody)));

    const res = await signedPost(app, rawBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ accepted: 1, skipped: 0 });
    const written = prisma.crawlerHitEvent.createMany.mock.calls[0][0].data;
    expect(written[0]).toMatchObject({ bot: 'ChatGPT-User', path: '/urun/geo', source: 'wp', isCiteFetch: true });
  });

  it('bilinmeyen site 404 doner (imza dogrulamasindan once site lookup)', async () => {
    prisma.site.findUnique.mockResolvedValueOnce(null as any);
    const rawBody = JSON.stringify({ site: 'yok', events: [{ ua: 'GPTBot/1.1' }] });

    const res = await signedPost(app, rawBody);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/tracker/events — throttle override', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Global varsayilan 2 istek/dk; ingest ucu 300'e cikariyor.
    ({ app } = await createIngestApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sinif seviyesindeki @SkipThrottle ingest ucunu muaf BIRAKMAZ, ama override limiti yukseltir', async () => {
    const rawBody = JSON.stringify({
      site: SITE_ID,
      events: [{ ua: 'GPTBot/1.1', path: '/', status: 200 }],
    });
    const server = app.getHttpServer();

    // 1) Global limit (2) asilsa bile ingest ucu 429 vermemeli — override etkin.
    for (let i = 0; i < 5; i++) {
      const res = await request(server)
        .post(ROUTE)
        .set('Content-Type', 'application/json')
        .send(rawBody);
      expect(res.status).toBe(401); // imzasiz; ama throttle'a takilmadi
    }

    // 2) SkipThrottle({ default: false }) gercekten muafiyeti kaldirdi mi:
    //    300'luk pencere dolunca 429 gelmeli. Gelmezse uc tamamen limitsizdir
    //    ve imzasiz istekle ucuz CPU/DB tuketimi vektoru acik kalir.
    //
    // ISTEKLER BILEREK SIRAYLA: paralel partiler denendi ve ECONNRESET verdi
    // (uc 429 dondurunce soket kapaniyor, ayni partideki ucan istekler
    // reddediliyor). Olculdu — sirali hali normalde 340ms-1sn suruyor, yani
    // test yavas DEGIL. Bir kez 60sn tavanina carpti cunku ayni anda agir
    // uretim isleri kosuyordu ve surec CPU'dan ac kaldi. Cozum testi
    // hizlandirmak degil, tavani gercekci yapmak: 120sn'de bile normal
    // kosumda 1 saniye harciyoruz, yalnizca sistem mesgulken yanlis
    // kirmizi vermiyoruz.
    let sawTooMany = false;
    for (let i = 0; i < 400 && !sawTooMany; i++) {
      const res = await request(server)
        .post(ROUTE)
        .set('Content-Type', 'application/json')
        .send(rawBody);
      if (res.status === 429) sawTooMany = true;
    }
    expect(sawTooMany, 'ingest ucu tamamen limitsiz — imzasiz istekle CPU tuketilebilir').toBe(true);
  }, 120_000);
});
