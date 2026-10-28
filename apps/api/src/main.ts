import 'dotenv/config';

// IPv4 once DNS resolution — sunucuda IPv6 calismadigi icin happy-eyeballs IPv6'yi
// once denerse "request to oauth2.googleapis.com failed" hatasi verir (googleapis,
// gaxios, vb. libraries undici'den bagimsiz Node DNS kullanir). DNS sirasi +
// happy-eyeballs kapatma tek yerde (ipv4-pin.ts; worker da ayni fonksiyonu
// cagirir). ALLOW_IPV6=1 sabitlemeyi (asagidaki undici family=4 dahil) kapatir.
import { pinProcessToIpv4 } from './ipv4-pin.js';
const ipv4Pinned = pinProcessToIpv4();

// Sentry — error tracking. En basta init edilmeli ki sonraki cagrilari yakalasin.
import * as Sentry from '@sentry/node';
import { sentryOlayTemizle } from './common/sentry-scrub.js';
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
    tracesSampleRate: 0.1,
    integrations: [Sentry.httpIntegration(), Sentry.consoleIntegration()],
    // Cerez/govde/kimlik basliklari gonderilmez (gizlilik metni bunu soyler) — bkz. common/sentry-scrub.ts
    sendDefaultPii: false,
    beforeSend: (e) => sentryOlayTemizle(e),
    beforeSendTransaction: (e) => sentryOlayTemizle(e),
  });
}

// IPv4'e zorla (sunucularda public IPv6 yoksa Node fetch ETIMEDOUT verir).
// ESM uyumlu top-level import — eski require() versiyonu ESNext modunda silently fail ediyordu.
import { setGlobalDispatcher as undiciSetGlobalDispatcher, Agent as UndiciAgent } from 'undici';
undiciSetGlobalDispatcher(new UndiciAgent({
  connect: (ipv4Pinned ? { family: 4 } : {}) as any,
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
}));

import { NestFactory } from '@nestjs/core';
import type { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { Catch, ArgumentsHost, ExceptionFilter, HttpException } from '@nestjs/common';
import type { CorsOptions, CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import { AppModule } from './app.module.js';
import { MCP_WELL_KNOWN_PREFIX_EXCLUDE } from './mcp/mcp-well-known.controller.js';
import { JSON_BODY_PARSERS, bodyParseErrorMiddleware, clientHttpErrorBody, jsonBodyBudgetFor, rejectUploadWithoutCredentials } from './request-body.js';
import { createJsonBodyBudgetMiddleware } from './common/json-body-budget.js';
import { createGlobalValidationPipe } from './common/validation-errors.js';

/**
 * MCP Server Card (SEP-2127) herkese acik, salt-okuma bir belge; tarayicidaki
 * istemciler onu her kokenden okuyabilmeli (ext-server-card docs/discovery.md:
 * CORS basliklari MUST). Controller GET cevabina basliklari kendisi yaziyor,
 * ama OPTIONS on ucusunu global CORS ara katmani rotalardan ONCE cevapliyor:
 * izin listesi disindaki kokene Allow-Origin donmedigi icin If-None-Match'li
 * (on ucus gerektiren) okuma tarayicida reddediliyordu. Bu yuzden istek basina
 * secim: YALNIZ bu yol (tam yol; sondaki / ve sorgu serbest) '*' alir,
 * kimlik bilgisi tasimaz; geri kalan her yol eski izin listesiyle aynen kalir.
 */
const MCP_SERVER_CARD_PATH = '/api/mcp/server-card';

const MCP_SERVER_CARD_CORS: CorsOptions = {
  origin: '*',
  methods: 'GET',
  // mcp.controller.ts serverCard() ile birebir ayni basliklar
  allowedHeaders: 'Content-Type, If-None-Match',
  exposedHeaders: 'ETag',
  credentials: false,
};

function isMcpServerCardPath(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0];
  return path === MCP_SERVER_CARD_PATH || path === `${MCP_SERVER_CARD_PATH}/`;
}

/**
 * Persona sohbet widget'i (persona-chat.service.ts buildWidgetJs) MUSTERI
 * sitelerinde calisir ve bu uca Content-Type: application/json ile POST atar.
 * JSON govdesi "basit istek" degildir; tarayici once OPTIONS on ucusu yapar
 * (https://fetch.spec.whatwg.org/#cors-safelisted-request-header — Content-Type
 * yalniz form/text/plain degerlerinde on ucussuz). Izin listesi (CORS_ORIGINS)
 * yalniz panel kokenlerini icerdigi icin musteri sitesinin on ucusu Allow-Origin
 * almiyor, widget hic cevap alamiyordu. Uc @Public; oturum/cerez kullanmaz,
 * kotuye kullanim PersonaChatThrottlerGuard (IP + site kovasi) ile sinirli.
 * Bu yuzden YALNIZ bu tam yol '*' alir, kimlik bilgisi tasimaz (credentials
 * false: tarayici cerez gondermez); geri kalan her yol izin listesinde kalir.
 */
const PERSONA_CHAT_PATH = /^\/api\/sites\/[^/]+\/audit\/persona\/chat\/?$/;

const PERSONA_CHAT_CORS: CorsOptions = {
  origin: '*',
  methods: 'POST',
  allowedHeaders: 'Content-Type',
  credentials: false,
};

function isPersonaChatPath(url: string | undefined): boolean {
  return PERSONA_CHAT_PATH.test((url ?? '').split('?')[0]);
}

@Catch()
class SentryExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const isHttpError = exception instanceof HttpException;
    // Nest disi istemci hatasi (body-parser/raw-body'nin http-errors nesnesi:
    // 413 govde siniri, 415 kodlama, 400 yarim govde) eskiden 500 + Sentry
    // oluyordu ve panel "Internal server error" gosteriyordu. Nest'in kendi
    // filtresi gibi gercek 4xx doner; mesaj Turkce (request-body.ts).
    const clientError = isHttpError ? null : clientHttpErrorBody(exception);
    const status = isHttpError ? (exception as HttpException).getStatus() : clientError?.statusCode ?? 500;
    // Sadece beklenmedik (5xx) hatalar Sentry'e gitsin; client error (4xx) gurultu yapmasin
    if (status >= 500) {
      Sentry.captureException(exception);
    }

    // Standart NestJS davranisina geri don
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const message = isHttpError
      ? (exception as HttpException).getResponse()
      : clientError ?? { statusCode: 500, message: 'Internal server error' };
    response.status(status).json(typeof message === 'string' ? { message } : message);
  }
}

async function bootstrap() {
  // rawBody: Live Crawler ingest ucu (POST /api/tracker/events) govdenin HAM
  // halini HMAC ile dogrular. Parse edilmis nesneyi yeniden serilestirmek
  // anahtar sirasi/bosluk farki yuzunden gecerli imzalari sessizce dusururdu,
  // bu yuzden express'in gordugu byte dizisi saklanmali.
  const app: NestExpressApplication = await NestFactory.create(AppModule, { rawBody: true });

  // Eski statik ayar AYNEN korunur (ayni nesne, acilista bir kez okunur);
  // cors paketi statik ayari da istek basina ayni nesneyle cagiriyordu.
  const defaultCors: CorsOptions = {
    origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  };
  const corsDelegate: CorsOptionsDelegate<{ url?: string; originalUrl?: string }> = (req, cb) => {
    const url = req.originalUrl ?? req.url;
    cb(null, isMcpServerCardPath(url) ? MCP_SERVER_CARD_CORS : isPersonaChatPath(url) ? PERSONA_CHAT_CORS : defaultCors);
  };
  app.enableCors(corsDelegate);

  // Yukleme uclarina (LARGE_JSON_BODY_ROUTES) kimliksiz gelen istek govde
  // okunmadan AuthGuard'in 401'iyle doner (request-body.ts
  // rejectUploadWithoutCredentials). CORS'tan SONRA (401 CORS basliklarini
  // tasir), ayristiricilardan ONCE: eskiden 100 KB ayristiricida 413 "en fazla
  // 100 KB" aliyor, oturumu dusen panel sekmesi yanlis bir sinir gosteriyordu.
  app.use(rejectUploadWithoutCredentials);

  // JSON govde sinirlari UC BASINA (gerekce request-body.ts): varsayilan
  // 100 KB, yalniz oturumlu yukleme uclari (access.log, GSC CSV, HARO, el
  // fotografi) 2 MiB, herkese acik persona sohbeti 64 KB. Eskiden tek global
  // 2 MiB sinir vardi; govde guard'lardan once ayristirildigi icin kimliksiz
  // tek bir istek API'yi saniyelerce kilitleyebiliyordu (inceleme R1).
  // Ayristiricilar SIRAYLA kurulur; istegi ilk secen okur, digerleri
  // req._body isaretini gorup atlar. Nest her app.useBodyParser cagrisina
  // rawBody:true'yu kendisi gecirir (verify -> req.rawBody, tracker HMAC'i
  // bozulmaz) ve init'te varsayilan jsonParser'i eklemez.
  // urlencoded varsayilan ayariyla (extended) burada acikca kurulur ki asagidaki
  // icerik butcesi onu da kapsasin; PayTR bildirimi ve Meta deauthorize form
  // govdesi yollar (PayTR ornek kodu form alanlarini okur:
  // https://dev.paytr.com/en/iframe-api/iframe-api-2-adim).
  // SIRA ONEMLI, CORS'tan SONRA: ayristirici once calissaydi 413 cevabi CORS
  // basliksiz kalirdi. Panel API'yi ayri kokenden cagirdiginda (DEPLOYMENT.md:
  // ranksup.ai -> api.ranksup.ai) tarayici cevabi okuyamaz, kullanici
  // "Bağlantı kurulamadı" gorurdu.
  // verify'li ayristirici (2 MiB yukleme: yogun govdeyi JSON.parse'tan ONCE
  // keser, inceleme S1) app.useBodyParser ile KURULAMAZ: rawBody:true iken
  // Nest ayardaki verify'i kendi rawBodyParser'iyla ezer (platform-express
  // 10.4 adapters/utils/get-body-parser-options.util.js `{ ...parserOptions,
  // verify: rawBodyParser }`; nest-application.js useBodyParser rawBody'yi
  // appOptions'tan gecirir). Adaptorun useBodyParser'i rawBody=false ile
  // ayari body-parser'a aynen verir; req.rawBody'yi verify kendisi yazar.
  // Ayni express yiginina ayni sirayla eklenir (ikisi de httpAdapter.use).
  const expressAdapter = app.getHttpAdapter() as ExpressAdapter;
  for (const options of JSON_BODY_PARSERS) {
    if (options.verify) expressAdapter.useBodyParser('json', false, options);
    else app.useBodyParser('json', options);
  }
  app.useBodyParser('urlencoded', { extended: true });
  // Bozuk JSON'un Ingilizce SyntaxError metni yerine Turkce 400 (request-body.ts)
  app.use(bodyParseErrorMiddleware);
  // Oge sayisi/derinlik butcesi: asiri govde guard'lara ve pipe'a ulasmadan
  // 413/400 alir (common/json-body-budget.ts); herkese acik persona sohbeti
  // daha dar butce alir (request-body.ts PERSONA_CHAT_JSON_BODY_BUDGET)
  app.use(createJsonBodyBudgetMiddleware(jsonBodyBudgetFor));

  // Ayarlar eskisiyle ayni (whitelist, transform, forbidNonWhitelisted); 400
  // cevabi kisa (en fazla 20 mesaj) ve Turkce (common/validation-errors.ts)
  app.useGlobalPipes(createGlobalValidationPipe());

  // RFC 9728: MCP korunan kaynak metadatasi kokte aranir (/.well-known/...),
  // /api altinda degil — yalnizca bu GET onekten haric (mcp-well-known.controller.ts).
  app.setGlobalPrefix('api', { exclude: [MCP_WELL_KNOWN_PREFIX_EXCLUDE] });

  // Sentry global exception filter
  app.useGlobalFilters(new SentryExceptionFilter());

  const port = parseInt(process.env.API_PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`🚀 RanksUp API listening on http://localhost:${port}`);
}

bootstrap();
