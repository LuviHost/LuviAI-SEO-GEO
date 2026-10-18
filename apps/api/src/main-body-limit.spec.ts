import 'reflect-metadata';
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { INestApplication, RawBodyRequest, Type } from '@nestjs/common';
import { Body, Controller, Get, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import * as Sentry from '@sentry/node';
import { CrawlerIngestDto, HaroParseDto, PersonaChatDto } from './audit/audit.dto.js';
import { GscAiCsvImportDto, GscAiCsvPreviewDto } from './analytics/analytics-body.dto.js';
import { HandPhotoDto, HAND_PHOTO_MAX_BASE64_CHARS } from './aso/aso.dto.js';
import {
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  JSON_BODY_LIMIT_BYTES,
  LARGE_JSON_BODY_TOO_DENSE_MESSAGE,
  PERSONA_CHAT_JSON_BODY_BUDGET,
  PERSONA_CHAT_JSON_BODY_LIMIT_BYTES,
} from './request-body.js';
import {
  JSON_BODY_MAX_DEPTH,
  JSON_BODY_MAX_NODES,
  JSON_BODY_TOO_DEEP_MESSAGE,
  JSON_BODY_TOO_MANY_NODES_MESSAGE,
  jsonBodyTooManyNodesMessage,
} from './common/json-body-budget.js';
import { VALIDATION_MESSAGE_LIMIT, VALIDATION_MORE_ERRORS_MESSAGE } from './common/validation-errors.js';

/**
 * main.ts — uc basina JSON govde sinirlari, icerik butcesi, rawBody, Turkce
 * 4xx ve kisa dogrulama cevabi (GERCEK HTTP).
 *
 * NEDEN VAR (inceleme R1): JSON siniri tek ve global 2 MiB'ti; govde
 * guard'lardan once ayristirildigi icin kimliksiz persona sohbeti 2 MiB'lik
 * {"history":[{},...]} govdesiyle tek API surecini ~3,5 sn kilitliyor, ~2 GB
 * RSS ve 108 MB'lik 400 cevabi uretiyordu. Simdi: varsayilan 100 KB, yalniz
 * oturumlu yukleme uclari 2 MiB, persona 64 KB; oge/derinlik butcesi ve en
 * fazla 20 mesajlik 400. Daha once (G10) 100 KB'nin access.log, GSC CSV ve
 * HARO yuklemelerini kestigi hata da geri gelmemeli: yukleme uclari GERCEK
 * yollarinda ve GERCEK DTO'larla sinanir.
 *
 * Inceleme S1: 2 MiB yukleme uclarinda kimliksiz [{},{},...] govdesi
 * guard'lardan once JSON.parse ediliyor, istek basina ~700 bin nesne kuruyor
 * ve saniyede tek istekle RSS'i PM2'nin 800 MB sinirinin ustune tasiyordu.
 * Simdi 2 MiB yalniz kimlik bilgili istege acik ve ham govde JSON.parse'tan
 * once taranir; testler JSON.parse'i gozleyerek "nesne agaci hic kurulmadi"
 * der. Kimliksiz yukleme istegi govde okunmadan AuthGuard'in 401'ini alir
 * (eskiden 100 KB ayristiricida yaniltici "en fazla 100 KB" 413'u aliyordu).
 *
 * GERCEK main.ts yuklenir. NestFactory.create, main.ts'in verdigi seceneklerle
 * (rawBody dahil) sahte uclu GERCEK bir Nest/Express uygulamasi doner. main.ts
 * ayarlarinin hepsini (CORS, govde ayristiricilari, butce, ValidationPipe,
 * onek, filtre) kendisi uygular ve API_PORT=0 ile gercekten dinler. Yan etkili
 * moduller (dotenv, Sentry, undici, IPv4 sabitleme, tam AppModule) sahtedir.
 * DB yok. Persona ucunun GERCEK controller + guard zinciri
 * main-persona-body.spec.ts'te.
 */

const kayit = vi.hoisted(() => ({
  controllers: [] as Type[],
  app: undefined as INestApplication | undefined,
  options: undefined as Record<string, unknown> | undefined,
}));

vi.mock('dotenv/config', () => ({}));
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  httpIntegration: vi.fn(),
  consoleIntegration: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('undici', () => ({ setGlobalDispatcher: vi.fn(), Agent: class {} }));
// Surec geneli DNS ayarina dokunmasin (diger test dosyalari ayni surecte kosabilir)
vi.mock('./ipv4-pin.js', () => ({ pinProcessToIpv4: () => false }));
vi.mock('./app.module.js', () => ({ AppModule: class AppModuleSahte {} }));
vi.mock('@nestjs/core', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@nestjs/core')>();
  return {
    ...orig,
    NestFactory: {
      create: vi.fn(async (_module: unknown, options: Record<string, unknown> = {}) => {
        const { Test } = await import('@nestjs/testing');
        const moduleRef = await Test.createTestingModule({ controllers: kayit.controllers }).compile();
        // main.ts'in secenekleri AYNEN: rawBody dusurulurse req.rawBody testi kirmizi olur
        const app = moduleRef.createNestApplication({ ...options, logger: false });
        kayit.app = app;
        kayit.options = options;
        return app;
      }),
    },
  };
});

/** http-errors'in urettigi nesnenin bicimi (body-parser/raw-body bunu firlatir) */
function httpErrors(status: number, message: string) {
  return Object.assign(new Error(message), { status, statusCode: status, expose: status < 500 });
}

const sha256 = (veri: string | Buffer) => createHash('sha256').update(veri).digest('hex');

function rawBodyOzeti(req: RawBodyRequest<Request>) {
  return {
    rawBodyBayt: Buffer.isBuffer(req.rawBody) ? req.rawBody.length : null,
    rawBodySha256: Buffer.isBuffer(req.rawBody) ? sha256(req.rawBody) : null,
  };
}

/** Varsayilan sinirli bir uc (yukleme listesinde DEGIL) + hata filtresini gozleyen uclar */
@Controller('govde')
class GovdeController {
  // Tracker ingest'i (tracker.controller.ts) gibi: HMAC, req.rawBody'nin ham baytlariyla hesaplanir
  @Post('json')
  @HttpCode(200)
  json(@Body() body: { veri?: unknown }, @Req() req: RawBodyRequest<Request>) {
    return { veriUzunlugu: typeof body?.veri === 'string' ? body.veri.length : null, ...rawBodyOzeti(req) };
  }

  // Yukleme ucunun yolu degil ama ayni DTO: 2 MiB yalniz yola bagli olmali
  @Post('crawler')
  @HttpCode(200)
  crawler(@Body() body: CrawlerIngestDto) {
    return { uzunluk: body.logContent.length };
  }

  // PayTR bildirimi ve Meta deauthorize form govdesi yollar: urlencoded ayristirici kalmali
  @Post('form')
  @HttpCode(200)
  form(@Body() body: Record<string, unknown>) {
    return body;
  }

  @Get('http-errors-404')
  httpErrors404() { throw httpErrors(404, 'Not Found'); }

  @Get('http-errors-503')
  httpErrors503() { throw httpErrors(503, 'Service Unavailable'); }

  // Anthropic/OpenAI/gaxios hatasi gibi: yalniz status (dis servisin cevabi)
  @Get('sdk-401')
  sdk401() { throw Object.assign(new Error('upstream 401'), { status: 401 }); }

  @Get('beklenmeyen')
  beklenmeyen() { throw new Error('beklenmeyen'); }

  @Get('nest-403')
  nest403() { throw new HttpException('Bu işlem için yetkin yok.', 403); }
}

/** Yukleme uclari GERCEK yollarinda (audit.controller.ts) + persona sohbeti */
@Controller('sites/:siteId/audit')
class SahteAuditController {
  @Post('crawler/ingest')
  @HttpCode(200)
  crawler(@Body() body: CrawlerIngestDto, @Req() req: RawBodyRequest<Request>) {
    return { uzunluk: body.logContent.length, ...rawBodyOzeti(req) };
  }

  @Post('haro/parse')
  @HttpCode(200)
  haro(@Body() body: HaroParseDto) {
    return { uzunluk: body.emailContent.length };
  }

  @Post('persona/chat')
  @HttpCode(201)
  persona(@Body() body: PersonaChatDto) {
    return { mesaj: body.history.length };
  }
}

/** analytics.controller.ts GSC AI CSV uclari */
@Controller('sites/:siteId/analytics')
class SahteAnalyticsController {
  @Post('gsc-ai-csv')
  @HttpCode(200)
  csv(@Body() body: GscAiCsvImportDto) {
    return { uzunluk: body.csv?.length ?? 0, dosya: body.fileName ?? null };
  }

  @Post('gsc-ai-csv/preview')
  @HttpCode(200)
  onizleme(@Body() body: GscAiCsvPreviewDto) {
    return { uzunluk: body.csv?.length ?? 0 };
  }
}

/** aso.controller.ts el fotografi ucu */
@Controller('sites/:siteId/aso')
class SahteAsoController {
  @Post('apps/:appId/screenshots/hand-photo-with-screenshot')
  @HttpCode(200)
  elFotografi(@Body() body: HandPhotoDto) {
    return { uzunluk: body.screenshotBase64.length };
  }
}

// esbuild decorator metadata uretmez: ValidationPipe'in gercek DTO'yu gormesi icin elle
const paramtypes = (cls: Type, metot: string, tipler: unknown[]) => Reflect.defineMetadata('design:paramtypes', tipler, cls.prototype, metot);
paramtypes(GovdeController, 'crawler', [CrawlerIngestDto]);
paramtypes(SahteAuditController, 'crawler', [CrawlerIngestDto, Object]);
paramtypes(SahteAuditController, 'haro', [HaroParseDto]);
paramtypes(SahteAuditController, 'persona', [PersonaChatDto]);
paramtypes(SahteAnalyticsController, 'csv', [GscAiCsvImportDto]);
paramtypes(SahteAnalyticsController, 'onizleme', [GscAiCsvPreviewDto]);
paramtypes(SahteAsoController, 'elFotografi', [HandPhotoDto]);
kayit.controllers = [GovdeController, SahteAuditController, SahteAnalyticsController, SahteAsoController];

const PANEL = 'https://ranksup.ai';
const MUSTERI_SITESI = 'https://musteri-sitesi.example';
const SINIR_MESAJI = (metin: string) => ({ statusCode: 413, message: `Gönderilen veri çok büyük (en fazla ${metin}).` });
/** AuthGuard'in kimliksiz istege verdigi cevap (UnauthorizedException('Token yok').getResponse()) */
const KIMLIK_YOK = { statusCode: 401, message: 'Token yok', error: 'Unauthorized' };

/** Tam olarak `bayt` uzunlugunda JSON govdesi: {"veri":"aaa..."} */
function jsonGovde(bayt: number, alan = 'veri'): string {
  return `{"${alan}":"${'a'.repeat(bayt - `{"${alan}":""}`.length)}"}`;
}

/** Gercekci Apache combined log (crawler-analytics parseApacheLog bicimi), en fazla `karakter` uzunlugunda */
function apacheLog(karakter: number): string {
  const satirlar: string[] = [];
  let uzunluk = 0;
  for (let i = 0; ; i++) {
    const satir = `66.249.66.${i % 250} - - [10/Oct/2026:13:${String(i % 60).padStart(2, '0')}:36 +0300] `
      + `"GET /blog/yazi-${i}?utm_source=x HTTP/1.1" 200 5120 "-" `
      + `"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)"\n`;
    if (uzunluk + satir.length > karakter) break;
    satirlar.push(satir);
    uzunluk += satir.length;
  }
  return satirlar.join('');
}

/** {"history":[{},{},...]} — R1 saldiri govdesi, en fazla `bayt` uzunlugunda */
function bosGecmis(bayt: number): string {
  const bas = '{"history":[';
  const n = Math.floor((bayt - bas.length - 2 + 1) / 3);
  return `${bas}${Array(n).fill('{}').join(',')}]}`;
}

/** `ac` + n x `oge` (virgulle) + `kapa`; toplam en fazla `bayt` */
function tekrar(bayt: number, ac: string, oge: (i: number) => string, kapa: string): string {
  const parcalar: string[] = [];
  let uzunluk = ac.length + kapa.length;
  for (let i = 0; ; i++) {
    const p = oge(i);
    if (uzunluk + p.length + 1 > bayt) break;
    parcalar.push(p);
    uzunluk += p.length + 1;
  }
  return `${ac}${parcalar.join(',')}${kapa}`;
}

/**
 * S1 saldiri govdeleri (hepsi gecerli JSON, ~2 MiB). Olcum (tek JSON.parse,
 * 2 MiB): bos nesneler ~43 MB heap / ~100 MB RSS, bos diziler ~29 / ~67,
 * cok anahtar ~20 / ~41, sifirlar ~10 / ~34. Sonuncusu yogun kismi uzun bir
 * metnin ARDINA koyar: taramanin metin icini atlayip sonrasini saydigini sinar.
 */
const YOGUN_GOVDELER: Record<string, (bayt: number) => string> = {
  'bos nesneler [{},...]': (b) => tekrar(b, '[', () => '{}', ']'),
  'bos diziler [[],...]': (b) => tekrar(b, '[', () => '[]', ']'),
  'tek nesnede cok anahtar {"0":0,...}': (b) => tekrar(b, '{', (i) => `"${i.toString(36)}":0`, '}'),
  'sifir dizisi [0,0,...]': (b) => tekrar(b, '[', () => '0', ']'),
  'uzun metnin ardinda yogun dizi': (b) => `["${'x'.repeat(b - 4_000)}"${',{}'.repeat(1_000)}]`,
};

/** Yukleme uclari (GERCEK yollar) ve DTO'larinin tek uzun metin alani */
const YUKLEME_UCLARI: Array<{ yol: string; alan: string }> = [
  { yol: '/api/sites/s1/audit/crawler/ingest', alan: 'logContent' },
  { yol: '/api/sites/s1/audit/haro/parse', alan: 'emailContent' },
  { yol: '/api/sites/s1/analytics/gsc-ai-csv', alan: 'csv' },
  { yol: '/api/sites/s1/analytics/gsc-ai-csv/preview', alan: 'csv' },
  { yol: '/api/sites/s1/aso/apps/a1/screenshots/hand-photo-with-screenshot', alan: 'screenshotBase64' },
];

/** Panelin oturum cerezi (credentials: 'include') ve API anahtari: fake controller'larda guard yok, varliklari yeter */
const OTURUM_CEREZI = '__Secure-authjs.session-token=sahte-oturum';
const API_ANAHTARI = 'Bearer luvi_sahte_anahtar';
type Kimlik = 'cerez' | 'bearer';

/**
 * fn suresince JSON.parse'a verilen, `esik` karakterden uzun girdilerin
 * uzunluklari. body-parser govdeyi metne cevirip global JSON.parse'a verir
 * (lib/types/json.js `JSON.parse(body, reviver)`); bos liste = buyuk
 * govdeden nesne agaci HIC kurulmadi. supertest'in kucuk cevap ayristirmasi
 * esigin altinda kalir.
 */
async function buyukParseler<T>(fn: () => Promise<T>, esik = 1_000_000): Promise<{ sonuc: T; buyuk: number[] }> {
  const spy = vi.spyOn(JSON, 'parse');
  try {
    const sonuc = await fn();
    const buyuk = spy.mock.calls
      .map(([girdi]) => (typeof girdi === 'string' ? girdi.length : 0))
      .filter((n) => n > esik);
    return { sonuc, buyuk };
  } finally {
    spy.mockRestore();
  }
}

describe('main.ts uc basina govde sinirlari (gercek HTTP)', () => {
  const eskiEnv = { CORS_ORIGINS: process.env.CORS_ORIGINS, API_PORT: process.env.API_PORT };
  const sunucu = () => kayit.app!.getHttpServer();
  const post = (yol: string, govde: string, origin?: string) => {
    let r = request(sunucu()).post(yol).set('Content-Type', 'application/json');
    if (origin) r = r.set('Origin', origin);
    return r.send(govde);
  };
  /**
   * Kimlik bilgisiyle POST: panel cerezi ya da API anahtari (Bearer). Buffer
   * govde (gzip) ham gider: superagent JSON turunde Buffer'i da
   * JSON.stringify ederdi, sunucu gzip yerine {"type":"Buffer",...} alirdi.
   */
  const postKimlikli = (
    yol: string,
    govde: string | Buffer,
    secenek: { kimlik?: Kimlik; origin?: string; contentType?: string; basliklar?: Record<string, string> } = {},
  ) => {
    let r = request(sunucu()).post(yol).set('Content-Type', secenek.contentType ?? 'application/json');
    r = (secenek.kimlik ?? 'cerez') === 'cerez' ? r.set('Cookie', OTURUM_CEREZI) : r.set('Authorization', API_ANAHTARI);
    if (secenek.origin) r = r.set('Origin', secenek.origin);
    for (const [ad, deger] of Object.entries(secenek.basliklar ?? {})) r = r.set(ad, deger);
    return r.serialize((x: any) => x).send(govde);
  };
  /**
   * Ham node:http POST (parcalar tek tek yazilir; Content-Length verilmezse
   * Transfer-Encoding: chunked). Kimliksiz yukleme ara katmani govde gelmeden
   * cevap verir; Node kalan baytlari okuyup atar, baglanti acik kalir. supertest'in
   * istemcisi (superagent) ise cevap gelince kendi suren yazimini keser ve
   * yaris halinde "write EPIPE" ile dusuyordu. Bu istemci cevap geldikten sonraki
   * yazim hatasini yok sayar (tarayici ve node:http gibi).
   */
  const hamPost = (yol: string, parcalar: Buffer[], basliklar: Record<string, string | number> = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown; text: string }>((resolve, reject) => {
      const { port } = sunucu().address() as AddressInfo;
      let cevapGeldi = false;
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: yol, headers: { 'content-type': 'application/json', ...basliklar } }, (res) => {
        cevapGeldi = true;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text ? JSON.parse(text) : null, text });
        });
      });
      req.on('error', (err) => { if (!cevapGeldi) reject(err); });
      for (const p of parcalar) req.write(p);
      req.end();
    });
  /** Kimliksiz, Content-Length'li ham POST (tek govde) */
  const kimliksizPost = (yol: string, govde: string, basliklar: Record<string, string> = {}) => {
    const b = Buffer.from(govde);
    return hamPost(yol, [b], { 'content-length': b.length, ...basliklar });
  };

  beforeAll(async () => {
    process.env.CORS_ORIGINS = PANEL;
    process.env.API_PORT = '0'; // gercek listen, isletim sisteminin sectigi port
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await import('./main.js');
    await vi.waitFor(() => {
      expect(log).toHaveBeenCalledWith(expect.stringContaining('listening'));
    }, { timeout: 15_000 });
    log.mockRestore();
  });

  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear();
  });

  afterAll(async () => {
    await kayit.app?.close();
    for (const [ad, deger] of Object.entries(eskiEnv)) {
      if (deger === undefined) delete process.env[ad];
      else process.env[ad] = deger;
    }
  });

  describe('varsayilan uc: 100 KB (body-parser varsayilani)', () => {
    it('sinir tam 100 KB: sinirdaki govde gecer, bir bayt fazlasi 413 + Turkce mesaj, Sentry yok', async () => {
      expect(DEFAULT_JSON_BODY_LIMIT_BYTES).toBe(102_400);
      const tam = jsonGovde(DEFAULT_JSON_BODY_LIMIT_BYTES);
      expect((await post('/api/govde/json', tam)).status).toBe(200);
      const fazla = await post('/api/govde/json', jsonGovde(DEFAULT_JSON_BODY_LIMIT_BYTES + 1));
      expect(fazla.status).toBe(413);
      expect(fazla.body).toEqual(SINIR_MESAJI('100 KB'));
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('2 MiB yalniz yola bagli: ayni DTO (CrawlerIngestDto) yukleme yolu disinda kimlikle bile 100 KB\'ta kesilir', async () => {
      const r = await postKimlikli('/api/govde/crawler', JSON.stringify({ logContent: 'a'.repeat(500_000) }));
      expect(r.status).toBe(413);
      expect(r.body).toEqual(SINIR_MESAJI('100 KB'));
    });

    it('413 cevabinda CORS basliklari var: ayristirici CORS\'tan sonra calisir, panel durumu okuyabilir', async () => {
      const r = await post('/api/govde/json', jsonGovde(300 * 1024), PANEL);
      expect(r.status).toBe(413);
      // Ayristirici CORS'tan once calissaydi bu basliklar olmazdi; tarayici
      // cevabi okuyamaz, panel "Bağlantı kurulamadı" derdi
      expect(r.headers['access-control-allow-origin']).toBe(PANEL);
      expect(r.headers['access-control-allow-credentials']).toBe('true');
    });

    it('rawBody korunur: tracker HMAC\'i icin ham baytlar (bosluk, sira, UTF-8) req.rawBody\'de', async () => {
      expect(kayit.options).toMatchObject({ rawBody: true });
      // Yeniden serilestirme bu bosluklari ve anahtar sirasini korumazdi; imza ham bayt uzerinden
      const ham = `{ "z": 1,  "veri" : "${'ğüşıöç x'.repeat(5_000)}" }`;
      expect(Buffer.byteLength(ham)).toBeLessThan(DEFAULT_JSON_BODY_LIMIT_BYTES);
      const r = await post('/api/govde/json', ham);
      expect(r.status).toBe(200);
      expect(r.body.veriUzunlugu).toBe('ğüşıöç x'.length * 5_000);
      expect(r.body.rawBodyBayt).toBe(Buffer.byteLength(ham));
      expect(r.body.rawBodySha256).toBe(sha256(Buffer.from(ham, 'utf8')));
    });
  });

  describe('oturumlu yukleme uclari: 2 MiB (kimlik bilgisiyle), gercek yollar + gercek DTO\'lar', () => {
    it('access.log: panelin en buyuk logu (1.000.000 bayt) ve her karakteri kacislanan en kotu hal gecer; rawBody korunur', async () => {
      // Gercekci access.log (musteri senaryosu: 100 KB'ta her log reddediliyordu).
      // Metin icindeki [ ] : , isaretleri yapi taramasina sayilmaz.
      const log = apacheLog(1_000_000);
      expect(log.length).toBeGreaterThan(990_000);
      const govde = JSON.stringify({ logContent: log });
      const gercekci = await postKimlikli('/api/sites/s1/audit/crawler/ingest', govde);
      expect(gercekci.status).toBe(200);
      expect(gercekci.body.uzunluk).toBe(log.length);
      // 2 MiB ayristirici Nest'in verify'i yerine kendi verify'iyla kurulu; ham baytlar yine req.rawBody'de
      expect(gercekci.body.rawBodyBayt).toBe(Buffer.byteLength(govde));
      expect(gercekci.body.rawBodySha256).toBe(sha256(govde));

      // En kotu metin: her karakter JSON'da 2 bayt (\") -> govde ~2.000.000 bayt, yine sigar
      const enKotu = JSON.stringify({ logContent: '"'.repeat(1_000_000) });
      expect(Buffer.byteLength(enKotu)).toBeGreaterThan(2_000_000);
      const r = await postKimlikli('/api/sites/s1/audit/crawler/ingest', enKotu, { kimlik: 'bearer' });
      expect(r.status).toBe(200);
      expect(r.body.uzunluk).toBe(1_000_000);

      // DTO tavaninin bir fazlasi: govde siniri degil, DTO dogrulamasi (Turkce 400) reddeder
      const fazla = await postKimlikli('/api/sites/s1/audit/crawler/ingest', JSON.stringify({ logContent: 'a'.repeat(1_000_001) }));
      expect(fazla.status).toBe(400);
      expect(fazla.body.message).toEqual([expect.stringContaining('1.000.000 karakter')]);
    });

    it('2 MiB siniri tam: sinirdaki govde ayristirilir, bir bayt fazlasi 413 "en fazla 2 MB"', async () => {
      const tam = jsonGovde(JSON_BODY_LIMIT_BYTES, 'logContent');
      expect(Buffer.byteLength(tam)).toBe(JSON_BODY_LIMIT_BYTES);
      // Ayristirildi: DTO tavani (1.000.000) 400 verir, 413 degil
      expect((await postKimlikli('/api/sites/s1/audit/crawler/ingest', tam)).status).toBe(400);
      const fazla = await postKimlikli('/api/sites/s1/audit/crawler/ingest', jsonGovde(JSON_BODY_LIMIT_BYTES + 1, 'logContent'));
      expect(fazla.status).toBe(413);
      expect(fazla.body).toEqual(SINIR_MESAJI('2 MB'));
    });

    it('HARO: 100.000 karakterlik Turkce e-posta (UTF-8\'de ~200 KB) gecer', async () => {
      const email = 'ğ'.repeat(100_000);
      const govde = JSON.stringify({ emailContent: email });
      expect(Buffer.byteLength(govde)).toBeGreaterThan(DEFAULT_JSON_BODY_LIMIT_BYTES);
      const r = await postKimlikli('/api/sites/s1/audit/haro/parse', govde);
      expect(r.status).toBe(200);
      expect(r.body.uzunluk).toBe(100_000);
    });

    it('GSC AI CSV: panel tavani 200 KB\'lik CSV (tirnak + satir sonu kacislariyla) import ve onizlemede gecer', async () => {
      const satir = '"2026-10-01","AI Overviews","https://ornek.com/blog/yazi","12","340"\n';
      const csv = satir.repeat(Math.floor(200_000 / satir.length));
      const govde = JSON.stringify({ csv, fileName: 'gsc.csv' });
      expect(Buffer.byteLength(govde)).toBeGreaterThan(200_000);
      const imp = await postKimlikli('/api/sites/s1/analytics/gsc-ai-csv', govde);
      expect(imp.status).toBe(200);
      expect(imp.body).toEqual({ uzunluk: csv.length, dosya: 'gsc.csv' });
      const pre = await postKimlikli('/api/sites/s1/analytics/gsc-ai-csv/preview', JSON.stringify({ csv }));
      expect(pre.status).toBe(200);
      expect(pre.body.uzunluk).toBe(csv.length);
    });

    it('el fotografi: DTO tavanindaki 2.000.000 karakterlik base64 gecer', async () => {
      const base64 = 'A'.repeat(HAND_PHOTO_MAX_BASE64_CHARS);
      const r = await postKimlikli('/api/sites/s1/aso/apps/a1/screenshots/hand-photo-with-screenshot', JSON.stringify({ screenshotBase64: base64 }), { kimlik: 'bearer' });
      expect(r.status).toBe(200);
      expect(r.body.uzunluk).toBe(HAND_PHOTO_MAX_BASE64_CHARS);
    });

    it('Express ayni handler\'a yolladigi yazimlarda da 2 MiB: buyuk harf, sondaki /, sorgu dizesi', async () => {
      const govde = JSON.stringify({ logContent: 'a'.repeat(500_000) });
      for (const yol of ['/api/SITES/s1/AUDIT/Crawler/Ingest', '/api/sites/s1/audit/crawler/ingest/', '/api/sites/s1/audit/crawler/ingest?x=1']) {
        const r = await postKimlikli(yol, govde);
        expect(r.status, yol).toBe(200);
        expect(r.body.uzunluk, yol).toBe(500_000);
      }
    });

    it('yalniz tam yol ve POST: benzer yol ya da baska yontem kimlikle bile 2 MiB almaz (100 KB\'ta 413)', async () => {
      const govde = JSON.stringify({ logContent: 'a'.repeat(500_000) });
      for (const yol of ['/api/sites/s1/audit/crawler/ingest/fazla', '/api/sites/s1/audit/crawler/ingestx', '/api/sites/s1/x/audit/crawler/ingest', '/sites/s1/audit/crawler/ingest']) {
        expect((await postKimlikli(yol, govde)).status, yol).toBe(413);
      }
      const put = await request(sunucu()).put('/api/sites/s1/audit/crawler/ingest')
        .set('Content-Type', 'application/json').set('Cookie', OTURUM_CEREZI).send(govde);
      expect(put.status).toBe(413);
    });
  });

  describe('inceleme S1: 2 MiB govdeden nesne agaci kimliksiz ya da yogun istekte hic kurulmaz', () => {
    it('kimlik bilgili 2 MiB [{},...] (cerez ve Bearer): hizli 413 + Turkce mesaj, JSON.parse hic calismaz, CORS korunur', async () => {
      const govde = YOGUN_GOVDELER['bos nesneler [{},...]'](JSON_BODY_LIMIT_BYTES);
      expect(Buffer.byteLength(govde)).toBeGreaterThan(2_090_000);
      for (const kimlik of ['cerez', 'bearer'] as const) {
        vi.mocked(Sentry.captureException).mockClear();
        const t0 = performance.now();
        // Uydurma site kimligi: kontrol yok, cunku govde guard'lardan once reddedilir
        const { sonuc: r, buyuk } = await buyukParseler(() =>
          postKimlikli('/api/sites/x9uydurma/audit/crawler/ingest', govde, { kimlik, origin: PANEL }));
        const sure = performance.now() - t0;
        // Eskiden: JSON.parse 2 MiB'i ayristirip ~700 bin nesne kuruyor, butce ancak sonra 413 diyordu
        expect(buyuk, kimlik).toEqual([]);
        expect(r.status, kimlik).toBe(413);
        expect(r.body, kimlik).toEqual({ statusCode: 413, message: LARGE_JSON_BODY_TOO_DENSE_MESSAGE, error: 'Payload Too Large' });
        expect(sure, kimlik).toBeLessThan(1_000);
        expect(Buffer.byteLength(r.text)).toBeLessThan(1024);
        expect(r.headers['access-control-allow-origin'], kimlik).toBe(PANEL);
        expect(r.headers['access-control-allow-credentials'], kimlik).toBe('true');
        expect(Sentry.captureException).not.toHaveBeenCalled();
      }
    });

    it('her yukleme ucunda her yogun bicim (cok anahtar, sifir dizisi, ic ice, metnin ardinda): 413, JSON.parse yok', async () => {
      for (const { yol } of YUKLEME_UCLARI) {
        for (const [bicim, uret] of Object.entries(YOGUN_GOVDELER)) {
          const { sonuc: r, buyuk } = await buyukParseler(() => postKimlikli(yol, uret(JSON_BODY_LIMIT_BYTES), { kimlik: 'bearer' }));
          expect(buyuk, `${yol} ${bicim}`).toEqual([]);
          expect(r.status, `${yol} ${bicim}`).toBe(413);
          expect(r.body.message, `${yol} ${bicim}`).toBe(LARGE_JSON_BODY_TOO_DENSE_MESSAGE);
        }
      }
    });

    it('kimliksiz 2 MiB [{},...]: govde okunmadan AuthGuard\'in 401\'i ("Token yok"), JSON.parse yok, CORS korunur', async () => {
      const govde = YOGUN_GOVDELER['bos nesneler [{},...]'](JSON_BODY_LIMIT_BYTES);
      for (const { yol } of YUKLEME_UCLARI) {
        const { sonuc: r, buyuk } = await buyukParseler(() => kimliksizPost(yol, govde, { Origin: PANEL }));
        expect(buyuk, yol).toEqual([]);
        expect(r.status, yol).toBe(401);
        expect(r.body, yol).toEqual(KIMLIK_YOK);
        expect(r.headers['access-control-allow-origin'], yol).toBe(PANEL);
        expect(r.headers['access-control-allow-credentials'], yol).toBe('true');
      }
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('S1 yan etkisi: kimliksiz yukleme her boyutta ayni 401\'i alir; artik yaniltici "en fazla 100 KB" yok', async () => {
      // Eskiden: 50 KB -> guard'in 401'i, 500 KB / 1,5 MB -> 100 KB ayristiricinin 413'u.
      // Oturumu dusen panel sekmesi 413 metnini aynen gosteriyor, kullanici dosyasini kirpiyordu.
      for (const bayt of [50_000, 500_000, 1_500_000]) {
        const r = await kimliksizPost('/api/sites/s1/audit/crawler/ingest', jsonGovde(bayt, 'logContent'), { Origin: PANEL });
        expect(r.status, String(bayt)).toBe(401);
        expect(r.body, String(bayt)).toEqual(KIMLIK_YOK);
        expect(r.text, String(bayt)).not.toContain('100 KB');
        expect(r.headers['access-control-allow-origin'], String(bayt)).toBe(PANEL);
      }
      // Cerezi ya da Bearer'i bos olan, Basic tasiyan ya da yalniz baska cerezli istek de kimliksiz sayilir
      const govde = jsonGovde(500_000, 'logContent');
      for (const [ad, deger] of [['Authorization', 'Bearer '], ['Authorization', 'Basic dXNlcjpwYXNz'], ['Cookie', 'authjs.csrf-token=x']] as const) {
        const r = await kimliksizPost('/api/sites/s1/audit/crawler/ingest', govde, { [ad]: deger });
        expect(r.status, deger).toBe(401);
        expect(r.body, deger).toEqual(KIMLIK_YOK);
      }
    });

    it('S1 yan etkisi: govde okunmaz — Content-Length\'siz (chunked) kimliksiz govde de ayristiriciya varmadan 401 alir', async () => {
      // 100 KB ayristirici chunked govdeyi sinira kadar okuyup 413 derdi; ara katman hic okumaz
      const parca = Buffer.from('a'.repeat(64 * 1024));
      const r = await hamPost('/api/sites/s1/audit/haro/parse', [Buffer.from('{"emailContent":"'), ...Array(8).fill(parca), Buffer.from('"}')]);
      expect(r.status).toBe(401);
      expect(r.body).toEqual(KIMLIK_YOK);
    });

    it('S1 yan etkisi: ara katman yalniz yukleme uclarinda; kimlikli istek, baska uc, baska yontem ve persona sohbeti eskisi gibi', async () => {
      // Kimlik bilgisi (gecersiz olsa da) varsa 2 MiB yolu: guard karar verir (sahte controller'da guard yok)
      const kimlikli = await postKimlikli('/api/sites/s1/audit/crawler/ingest', JSON.stringify({ logContent: 'a'.repeat(500_000) }), { basliklar: { Cookie: '__Secure-authjs.session-token=suresi.dolmus' } });
      expect(kimlikli.status).toBe(200);
      // Yukleme listesinde olmayan uc: kimliksiz istek ayristirilir (kimlik karari guard'da)
      expect((await post('/api/govde/json', jsonGovde(50_000))).status).toBe(200);
      // Herkese acik persona sohbeti kimliksiz calisir
      expect((await post('/api/sites/s1/audit/persona/chat', JSON.stringify({ history: [{ role: 'user', content: 'Merhaba' }] }))).status).toBe(201);
      // Ayni yolda baska yontem yukleme ucu degil: 100 KB siniri
      const put = await request(sunucu()).put('/api/sites/s1/audit/crawler/ingest')
        .set('Content-Type', 'application/json').send(jsonGovde(500_000, 'logContent'));
      expect(put.status).toBe(413);
    });

    it('kimlik bilgili mesru 1,5 MB tek metinli govde bes ucta da ayristirilir (yapi taramasina takilmaz)', async () => {
      // Turkce karakter UTF-8'de 2 bayt: 750 bin karakter ~1,5 MB govde
      const metin = 'ğ'.repeat(750_000);
      for (const { yol, alan } of YUKLEME_UCLARI) {
        const govde = alan === 'screenshotBase64'
          // El fotografinin dort alanli en kalabalik govdesi (8 yapi isareti); base64 ASCII
          ? JSON.stringify({ screenshotBase64: 'A'.repeat(1_500_000), brandColor: '#FF6A00', width: 1080, height: 1920 })
          : JSON.stringify(alan === 'csv' && yol.endsWith('gsc-ai-csv') ? { csv: metin, fileName: 'gsc.csv' } : { [alan]: metin });
        expect(Buffer.byteLength(govde), yol).toBeGreaterThanOrEqual(1_500_000);
        const { sonuc: r, buyuk } = await buyukParseler(() => postKimlikli(yol, govde), 500_000);
        // Govde bir kez, butunuyle ayristirildi (2 MiB ayristirici secildi ve taramadan gecti)
        expect(buyuk, yol).toEqual([govde.length]);
        if (alan === 'emailContent') {
          // HARO DTO'su 100.000 karakterle sinirli: 413 degil, DTO'nun Turkce 400'u
          expect(r.status, yol).toBe(400);
          expect(JSON.stringify(r.body.message), yol).toContain('100.000 karakter');
        } else {
          expect(r.status, yol).toBe(200);
          expect(r.body.uzunluk, yol).toBe(alan === 'screenshotBase64' ? 1_500_000 : 750_000);
        }
      }
    });

    it('UTF-8 disi charset 2 MiB ayristiriciyi secmez (UTF-16/UTF-7 taramayi kandirabilirdi); utf-8 yazimlari secer', async () => {
      const govde = jsonGovde(300_000, 'logContent');
      for (const contentType of ['application/json; charset=utf-16le', 'application/json; charset=utf-7', 'application/json; charset=utf-8; charset=utf-16']) {
        const r = await postKimlikli('/api/sites/s1/audit/crawler/ingest', govde, { contentType });
        expect(r.status, contentType).toBe(413);
        expect(r.body, contentType).toEqual(SINIR_MESAJI('100 KB'));
      }
      for (const contentType of ['application/json; charset=utf-8', 'application/json;charset="UTF-8"', 'Application/JSON']) {
        const r = await postKimlikli('/api/sites/s1/audit/crawler/ingest', govde, { contentType });
        expect(r.status, contentType).toBe(200);
        expect(r.body.uzunluk, contentType).toBe(300_000 - '{"logContent":""}'.length);
      }
    });

    it('gzip\'li yogun govde acildiktan SONRA taranir: kimlikle 413 yogun, kimliksiz govde acilmadan 401; JSON.parse yok', async () => {
      const sikistirilmis = gzipSync(YOGUN_GOVDELER['bos nesneler [{},...]'](JSON_BODY_LIMIT_BYTES));
      // ~2 MiB yogun JSON birkac KB'a iner; Content-Length siniri tek basina korumaz
      expect(sikistirilmis.length).toBeLessThan(DEFAULT_JSON_BODY_LIMIT_BYTES);
      const kimlikli = await buyukParseler(() => postKimlikli('/api/sites/s1/audit/crawler/ingest', sikistirilmis, { basliklar: { 'Content-Encoding': 'gzip' } }));
      expect(kimlikli.sonuc.status).toBe(413);
      expect(kimlikli.sonuc.body.message).toBe(LARGE_JSON_BODY_TOO_DENSE_MESSAGE);
      expect(kimlikli.buyuk).toEqual([]);
      // Kimliksiz: govde hic okunmaz ve acilmaz, AuthGuard'in 401'i (rejectUploadWithoutCredentials)
      const kimliksiz = await buyukParseler(() => hamPost('/api/sites/s1/audit/crawler/ingest', [sikistirilmis], { 'content-encoding': 'gzip', 'content-length': sikistirilmis.length }));
      expect(kimliksiz.sonuc.status).toBe(401);
      expect(kimliksiz.sonuc.body).toEqual(KIMLIK_YOK);
      expect(kimliksiz.buyuk).toEqual([]);
      // Ayni sikistirilmis yol mesru govdeyi bozmaz
      const mesru = JSON.stringify({ logContent: apacheLog(900_000) });
      const acik = await postKimlikli('/api/sites/s1/audit/crawler/ingest', gzipSync(mesru), { basliklar: { 'Content-Encoding': 'gzip' } });
      expect(acik.status).toBe(200);
      expect(acik.body.rawBodyBayt).toBe(Buffer.byteLength(mesru));
    });
  });

  describe('persona sohbeti (herkese acik): 64 KB + icerik butcesi + kisa 400', () => {
    it('64 KB siniri tam: sinirdaki gecerli sohbet gecer, bir bayt fazlasi 413 "en fazla 64 KB"', async () => {
      expect(PERSONA_CHAT_JSON_BODY_LIMIT_BYTES).toBe(65_536);
      // 4 mesaj, toplam tam 64 KB (her mesaj DTO tavani 20.000 karakterin altinda)
      const roller = ['user', 'assistant', 'user', 'assistant'];
      const zarf = JSON.stringify({ history: roller.map((role) => ({ role, content: '' })) }).length;
      const pay = PERSONA_CHAT_JSON_BODY_LIMIT_BYTES - zarf;
      const parcalar = roller.map((_r, i) => Math.floor(pay / 4) + (i < pay % 4 ? 1 : 0));
      const tam = JSON.stringify({ history: parcalar.map((n, i) => ({ role: roller[i], content: 'a'.repeat(n) })) });
      expect(Buffer.byteLength(tam)).toBe(PERSONA_CHAT_JSON_BODY_LIMIT_BYTES);
      const r = await post('/api/sites/s1/audit/persona/chat', tam);
      expect(r.status).toBe(201);
      expect(r.body).toEqual({ mesaj: 4 });
      const fazla = await post('/api/sites/s1/audit/persona/chat', tam.replace('"content":"a', '"content":"aa'));
      expect(fazla.status).toBe(413);
      expect(fazla.body).toEqual(SINIR_MESAJI('64 KB'));
    });

    it('R1: 2 MiB {"history":[{},...]} govdesi hizli 413 alir; cevap kucuk, musteri sitesi okuyabilir (CORS *)', async () => {
      const govde = bosGecmis(2 * 1024 * 1024);
      expect(Buffer.byteLength(govde)).toBeGreaterThan(2_000_000);
      const t0 = performance.now();
      const r = await post('/api/sites/x9nosuchsite/audit/persona/chat', govde, MUSTERI_SITESI);
      const sure = performance.now() - t0;
      expect(r.status).toBe(413);
      expect(r.body).toEqual(SINIR_MESAJI('64 KB'));
      expect(Buffer.byteLength(r.text)).toBeLessThan(1024);
      // Eskiden ~3.500 ms senkron CPU + 108 MB cevap; sinir govdeyi okumadan keser
      expect(sure).toBeLessThan(1_000);
      expect(r.headers['access-control-allow-origin']).toBe('*');
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('64 KB\'a sigan ~21 bin bos oge: persona icerik butcesi pipe\'tan once 413 verir (eskiden ~90 ms + 3 MB 400)', async () => {
      const govde = bosGecmis(60 * 1024);
      const t0 = performance.now();
      const r = await post('/api/sites/s1/audit/persona/chat', govde, MUSTERI_SITESI);
      const sure = performance.now() - t0;
      expect(r.status).toBe(413);
      expect(r.body).toEqual({
        statusCode: 413,
        message: jsonBodyTooManyNodesMessage(PERSONA_CHAT_JSON_BODY_BUDGET.maxNodes),
        error: 'Payload Too Large',
      });
      expect(r.body.message).toBe('Gönderilen veri çok fazla öğe içeriyor (en fazla 1.000). Veriyi bölerek gönder.');
      expect(Buffer.byteLength(r.text)).toBeLessThan(1024);
      expect(sure).toBeLessThan(1_000);
      expect(r.headers['access-control-allow-origin']).toBe('*');
    });

    it('persona butcesi tam 1.000 oge: siniri DTO\'nun mesru ust siniri (100 mesaj = 302 oge) cok asar; bir fazlasi 413', async () => {
      // kok + history + n oge = n + 2
      const gecmis = (n: number) => JSON.stringify({ history: Array.from({ length: n }, () => ({})) });
      const tam = await post('/api/sites/s1/audit/persona/chat', gecmis(PERSONA_CHAT_JSON_BODY_BUDGET.maxNodes - 2));
      expect(tam.status).toBe(400); // butceden gecti, DTO (ArrayMaxSize 100) reddetti
      const fazla = await post('/api/sites/s1/audit/persona/chat', gecmis(PERSONA_CHAT_JSON_BODY_BUDGET.maxNodes - 1));
      expect(fazla.status).toBe(413);
      // Ayni govde baska bir ucta varsayilan 10.000'lik butcededir
      expect((await post('/api/govde/json', JSON.stringify({ veri: Array(PERSONA_CHAT_JSON_BODY_BUDGET.maxNodes) }))).status).toBe(200);
      // Widget'in gercek en buyuk sohbeti (100 mesajlik eski gecmis) butcenin icinde
      const yuzMesaj = JSON.stringify({ history: Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'Merhaba' })) });
      expect((await post('/api/sites/s1/audit/persona/chat', yuzMesaj)).status).toBe(201);
    });

    it('butce icindeki gecersiz govde: 400 en fazla 20 mesaj + ozet satiri, cevap birkac KB', async () => {
      // 300 bos oge: her biri 3 mesaj uretir (role + content x2) -> Nest varsayilaniyla 900 mesaj, ~45 KB
      const r = await post('/api/sites/s1/audit/persona/chat', JSON.stringify({ history: Array.from({ length: 300 }, () => ({})) }));
      expect(r.status).toBe(400);
      expect(r.body.statusCode).toBe(400);
      expect(r.body.error).toBe('Bad Request');
      expect(r.body.message).toHaveLength(VALIDATION_MESSAGE_LIMIT + 1);
      expect(r.body.message[0]).toBe("history.0.role yalnızca 'user' ya da 'assistant' olabilir");
      expect(r.body.message[VALIDATION_MESSAGE_LIMIT]).toBe(VALIDATION_MORE_ERRORS_MESSAGE);
      expect(Buffer.byteLength(r.text)).toBeLessThan(4 * 1024);
    });

    it('K8: izin verilmeyen alan Turkce (ust duzey ve ic ice), bicim { statusCode, message[], error }', async () => {
      const r = await post('/api/sites/s1/audit/persona/chat', JSON.stringify({
        history: [{ role: 'user', content: 'Merhaba', ekstra: 1 }],
        fazla: true,
      }));
      expect(r.status).toBe(400);
      expect(r.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: ['fazla alanı kabul edilmiyor.', 'history.0.ekstra alanı kabul edilmiyor.'],
      });
      expect(r.text).not.toMatch(/should not exist/);
    });
  });

  describe('icerik butcesi her ucta (varsayilan uc)', () => {
    it(`oge sayisi: tam ${JSON_BODY_MAX_NODES} gecer, bir fazlasi 413`, async () => {
      // kok nesne + "veri" dizisi + n eleman
      const dizi = (n: number) => JSON.stringify({ veri: Array(n).fill(0) });
      expect((await post('/api/govde/json', dizi(JSON_BODY_MAX_NODES - 2))).status).toBe(200);
      const fazla = await post('/api/govde/json', dizi(JSON_BODY_MAX_NODES - 1));
      expect(fazla.status).toBe(413);
      expect(fazla.body.message).toBe(JSON_BODY_TOO_MANY_NODES_MESSAGE);
    });

    it(`derinlik: ${JSON_BODY_MAX_DEPTH} seviye gecer, bir fazlasi 400 (ozyinelemeli dogrulama yigini tasirmasin)`, async () => {
      const ic = (d: number) => `{"veri":${'['.repeat(d - 1)}${']'.repeat(d - 1)}}`;
      expect((await post('/api/govde/json', ic(JSON_BODY_MAX_DEPTH))).status).toBe(200);
      const derin = await post('/api/govde/json', ic(JSON_BODY_MAX_DEPTH + 1));
      expect(derin.status).toBe(400);
      expect(derin.body.message).toBe(JSON_BODY_TOO_DEEP_MESSAGE);
      // 50.000 seviye: eskiden stripProtoKeys/class-transformer ozyinelemesi; simdi ucuz 400
      const cokDerin = await post('/api/govde/crawler', `{"logContent":${'['.repeat(30_000)}${']'.repeat(30_000)}}`);
      expect(cokDerin.status).toBe(400);
      expect(cokDerin.body.message).toBe(JSON_BODY_TOO_DEEP_MESSAGE);
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });
  });

  it('bozuk JSON: V8\'in Ingilizce SyntaxError metni yerine Turkce 400, Sentry yok', async () => {
    const r = await post('/api/govde/json', '{"veri": ');
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ statusCode: 400, message: 'Gönderilen veri okunamadı, lütfen tekrar dene.' });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('urlencoded form govdesi hala ayristirilir (PayTR bildirimi, Meta deauthorize)', async () => {
    const r = await request(sunucu())
      .post('/api/govde/form')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('merchant_oid=RU123&status=success&total_amount=9900');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ merchant_oid: 'RU123', status: 'success', total_amount: '9900' });
  });

  it('Nest disi http-errors 4xx gercek durumuyla doner ve Sentry\'ye gitmez', async () => {
    const r = await request(sunucu()).get('/api/govde/http-errors-404');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ statusCode: 404, message: 'İstek işlenemedi.' });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('degismeyen yollar: SDK hatasinin 401\'i, http-errors 5xx ve beklenmeyen hata 500 + Sentry; HttpException aynen', async () => {
    for (const yol of ['sdk-401', 'http-errors-503', 'beklenmeyen']) {
      vi.mocked(Sentry.captureException).mockClear();
      const r = await request(sunucu()).get(`/api/govde/${yol}`);
      expect(r.status, yol).toBe(500);
      expect(r.body, yol).toEqual({ statusCode: 500, message: 'Internal server error' });
      expect(Sentry.captureException, yol).toHaveBeenCalledTimes(1);
    }
    vi.mocked(Sentry.captureException).mockClear();
    const nest = await request(sunucu()).get('/api/govde/nest-403');
    expect(nest.status).toBe(403);
    expect(nest.body).toEqual({ message: 'Bu işlem için yetkin yok.' });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
