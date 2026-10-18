import 'reflect-metadata';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { HttpException, PayloadTooLargeException, RequestMethod, UnauthorizedException, UnsupportedMediaTypeException, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import {
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  JSON_BODY_LIMIT_BYTES,
  JSON_BODY_PARSERS,
  LARGE_JSON_BODY_MAX_STRUCTURE,
  LARGE_JSON_BODY_ROUTES,
  LARGE_JSON_BODY_TOO_DENSE_MESSAGE,
  MISSING_CREDENTIALS_MESSAGE,
  PERSONA_CHAT_JSON_BODY_BUDGET,
  PERSONA_CHAT_JSON_BODY_LIMIT_BYTES,
  PERSONA_CHAT_JSON_ROUTE,
  bodyParseErrorMiddleware,
  carriesSessionCredentials,
  clientHttpErrorBody,
  hasUtf8Charset,
  isJsonContentType,
  isLargeJsonBodyRequest,
  isLargeJsonUploadRequest,
  isPersonaChatJsonRequest,
  jsonBodyBudgetFor,
  rejectUploadWithoutCredentials,
  verifyLargeJsonBody,
} from './request-body.js';
import { AuthGuard } from './auth/auth.guard.js';
import { DEFAULT_JSON_BODY_BUDGET, jsonBudgetViolation } from './common/json-body-budget.js';
import { SESSION_COOKIE_NAMES } from './auth/session-cookie.js';
import { PERSONA_HISTORY_MAX } from './audit/persona-chat.service.js';
import { PERSONA_MESSAGE_MAX } from './audit/audit.dto.js';
import { HAND_PHOTO_MAX_BASE64_CHARS } from './aso/aso.dto.js';

/**
 * request-body.ts — uc basina JSON govde sinirlari ve Nest disi istemci
 * hatalarinin cevabi.
 *
 * NEDEN VAR: (1) inceleme R1 — tek global 2 MiB sinir kimliksiz uclara da
 * uygulaniyordu; persona sohbeti tek istekle API'yi kilitliyordu. Sinir artik
 * uca gore seciliyor; secim kurali burada SAF olarak sinanir. (2)
 * body-parser'in 413'u catch-all filtrede 500 "Internal server error"
 * oluyordu. Gercek HTTP zinciri (main.ts) main-body-limit.spec.ts'te.
 */

/** http-errors'in urettigi nesnenin bicimi (body-parser/raw-body bunu firlatir) */
function httpErrors(status: number, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { status, statusCode: status, expose: status < 500, ...extra });
}

/** contentType null: Content-Type basligi hic yok; `basliklar` ek basliklar (kimlik bilgisi) */
const istek = (method: string, url: string, contentType: string | null = 'application/json', basliklar: Record<string, string> = {}) =>
  ({ method, url, originalUrl: url, headers: { ...(contentType === null ? {} : { 'content-type': contentType }), ...basliklar } }) as any;

/** Panelin oturum cerezi / API anahtari (yalniz varlik denetlenir) */
const CEREZ = { cookie: '__Secure-authjs.session-token=eyJhbGciOiJkaXIifQ.x' };
const BEARER = { authorization: 'Bearer luvi_0123456789abcdef' };

describe('JSON govde sinirlari', () => {
  it('2 MiB yalniz yukleme uclarinda: panel tavanlari (log 1.000.000 bayt, CSV 200 KB) bu degere gore secildi', () => {
    // Degisirse crawler-hits-panel.tsx MAX_LOG_BYTES ve google-ai-surface-card.tsx
    // MAX_CSV_BYTES yorumlarini/degerlerini de guncelle
    expect(JSON_BODY_LIMIT_BYTES).toBe(2_097_152);
    // En kotu kacisla (her karakter 2 bayt) 1.000.000 baytlik log + JSON zarfi sigar
    expect(2 * 1_000_000 + '{"logContent":""}'.length).toBeLessThanOrEqual(JSON_BODY_LIMIT_BYTES);
  });

  it('varsayilan 100 KB = body-parser varsayilani (2 MiB oncesi uretim davranisi)', () => {
    expect(DEFAULT_JSON_BODY_LIMIT_BYTES).toBe(102_400);
  });

  it('persona 64 KB: widget\'in en kotu gercekci govdesi (10 mesaj x 2.000 birim x 3 bayt + zarf) sigar', () => {
    expect(PERSONA_CHAT_JSON_BODY_LIMIT_BYTES).toBe(65_536);
    const enKotu = JSON.stringify({
      history: Array.from({ length: PERSONA_HISTORY_MAX }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '漢'.repeat(PERSONA_MESSAGE_MAX) })),
    });
    expect(Buffer.byteLength(enKotu)).toBeGreaterThan(60_000);
    expect(Buffer.byteLength(enKotu)).toBeLessThanOrEqual(PERSONA_CHAT_JSON_BODY_LIMIT_BYTES);
  });

  it('ayristirici sirasi: once 2 MiB (yukleme), sonra 64 KB (persona), en son tursuz 100 KB varsayilan', () => {
    expect(JSON_BODY_PARSERS.map((p) => p.limit)).toEqual([JSON_BODY_LIMIT_BYTES, PERSONA_CHAT_JSON_BODY_LIMIT_BYTES, DEFAULT_JSON_BODY_LIMIT_BYTES]);
    const [buyuk, persona, varsayilan] = JSON_BODY_PARSERS;
    expect(varsayilan.type).toBeUndefined();
    const yukleme = istek('POST', '/api/sites/s1/audit/crawler/ingest', 'application/json', CEREZ);
    const sohbet = istek('POST', '/api/sites/s1/audit/persona/chat');
    const diger = istek('POST', '/api/sites/s1/audit/prompts', 'application/json', CEREZ);
    expect([buyuk.type!(yukleme), persona.type!(yukleme)]).toEqual([true, false]);
    expect([buyuk.type!(sohbet), persona.type!(sohbet)]).toEqual([false, true]);
    expect([buyuk.type!(diger), persona.type!(diger)]).toEqual([false, false]);
    // JSON olmayan govde secilmez (body-parser varsayilan turuyla ayni)
    expect(buyuk.type!(istek('POST', '/api/sites/s1/audit/crawler/ingest', 'text/plain', CEREZ))).toBe(false);
    expect(persona.type!(istek('POST', '/api/sites/s1/audit/persona/chat', 'application/x-www-form-urlencoded'))).toBe(false);
    // inceleme S1: kimliksiz yukleme istegi 2 MiB'i secemez; 100 KB varsayilana kalir
    expect(buyuk.type!(istek('POST', '/api/sites/s1/audit/crawler/ingest'))).toBe(false);
    // Yalniz 2 MiB ayristiricinin verify'i var (main.ts onu adaptorle kurar);
    // persona ve varsayilan Nest'in rawBody verify'iyla kalir
    expect(buyuk.verify).toBe(verifyLargeJsonBody);
    expect([persona.verify, varsayilan.verify]).toEqual([undefined, undefined]);
  });
});

describe('uc secimi', () => {
  it('her yukleme ucu: tam yol, POST; Express gibi harf duyarsiz, sondaki / ve sorgu serbest', () => {
    const ornekler = [
      '/api/sites/cmsq25bko005farswo54hf856/audit/crawler/ingest',
      '/api/sites/s1/audit/haro/parse',
      '/api/sites/s1/analytics/gsc-ai-csv',
      '/api/sites/s1/analytics/gsc-ai-csv/preview',
      '/api/sites/s1/aso/apps/a1/screenshots/hand-photo-with-screenshot',
    ];
    expect(ornekler).toHaveLength(LARGE_JSON_BODY_ROUTES.length);
    for (const yol of ornekler) {
      for (const v of [yol, `${yol}/`, `${yol}?x=1`, yol.toUpperCase().replace('/API/', '/api/')]) {
        expect(isLargeJsonBodyRequest(istek('POST', v)), v).toBe(true);
      }
      expect(isLargeJsonBodyRequest(istek('PUT', yol)), `PUT ${yol}`).toBe(false);
      expect(isLargeJsonBodyRequest(istek('GET', yol)), `GET ${yol}`).toBe(false);
      expect(isLargeJsonBodyRequest(istek('POST', `${yol}/fazla`)), `${yol}/fazla`).toBe(false);
      expect(isLargeJsonBodyRequest(istek('POST', `${yol}x`)), `${yol}x`).toBe(false);
      expect(isPersonaChatJsonRequest(istek('POST', yol)), yol).toBe(false);
    }
  });

  it('benzer ama farkli yollar 2 MiB almaz: parametre bos/cok parcali, onek yok, baska kaynak', () => {
    for (const yol of [
      '/api/sites//audit/crawler/ingest', '/api/sites/a/b/audit/crawler/ingest', '/sites/s1/audit/crawler/ingest',
      '/api/sites/s1/audit/persona/chat', '/api/sites/s1/audit/prompts', '/api/baska?u=/api/sites/s1/audit/haro/parse',
      '/api/sites/s1/aso/apps/screenshots/hand-photo-with-screenshot', '',
    ]) {
      expect(isLargeJsonBodyRequest(istek('POST', yol)), yol).toBe(false);
    }
  });

  it('persona ucu: tam yol POST (harf duyarsiz: Express ayni handler\'a yollar, kucuk sinir alir)', () => {
    for (const yol of ['/api/sites/s1/audit/persona/chat', '/api/sites/s1/audit/persona/chat/', '/api/sites/s1/audit/persona/chat?x=1', '/api/sites/s1/audit/PERSONA/chat']) {
      expect(isPersonaChatJsonRequest(istek('POST', yol)), yol).toBe(true);
    }
    for (const yol of ['/api/sites/s1/audit/persona', '/api/sites/s1/audit/persona/chat/x', '/api/sites//audit/persona/chat']) {
      expect(isPersonaChatJsonRequest(istek('POST', yol)), yol).toBe(false);
    }
    expect(isPersonaChatJsonRequest(istek('GET', '/api/sites/s1/audit/persona/chat'))).toBe(false);
  });

  it('icerik butcesi: persona dar (1.000 oge / 8 seviye), diger her uc varsayilan; widget\'in en buyuk mesru govdesi sigar', () => {
    expect(jsonBodyBudgetFor(istek('POST', '/api/sites/s1/audit/persona/chat'))).toBe(PERSONA_CHAT_JSON_BODY_BUDGET);
    expect(PERSONA_CHAT_JSON_BODY_BUDGET).toEqual({ maxNodes: 1_000, maxDepth: 8 });
    for (const yol of ['/api/sites/s1/audit/crawler/ingest', '/api/sites/s1/audit/prompts', '/api/mcp']) {
      expect(jsonBodyBudgetFor(istek('POST', yol)), yol).toBe(DEFAULT_JSON_BODY_BUDGET);
    }
    // DTO'nun izin verdigi en buyuk gecmis: 100 mesaj ({ role, content }) = 302 oge, 3 seviye
    const enBuyuk = { history: Array.from({ length: 100 }, () => ({ role: 'user', content: 'x' })) };
    expect(jsonBudgetViolation(enBuyuk, PERSONA_CHAT_JSON_BODY_BUDGET)).toBeNull();
  });

  it('JSON turu: body-parser varsayilani gibi application/json (parametreler ve harf serbest)', () => {
    for (const t of ['application/json', 'application/json; charset=utf-8', 'Application/JSON', ' application/json ', 'application/json;charset=UTF-8']) {
      expect(isJsonContentType(istek('POST', '/x', t)), t).toBe(true);
    }
    for (const t of ['application/jsonx', 'text/plain', 'application/vnd.api+json', 'multipart/form-data; boundary=x', '', null]) {
      expect(isJsonContentType(istek('POST', '/x', t)), String(t)).toBe(false);
    }
  });

  it('listedeki her yol GERCEK bir controller rotasi (uc tasinirsa ya da adi degisirse kirilir)', async () => {
    const { AuditController } = await import('./audit/audit.controller.js');
    const { AnalyticsController } = await import('./analytics/analytics.controller.js');
    const { AsoController } = await import('./aso/aso.controller.js');
    const rotalar = new Set<string>();
    for (const ctl of [AuditController, AnalyticsController, AsoController] as Type[]) {
      const kok = String(Reflect.getMetadata(PATH_METADATA, ctl));
      for (const ad of Object.getOwnPropertyNames(ctl.prototype)) {
        const handler = (ctl.prototype as Record<string, unknown>)[ad];
        if (typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.POST) continue;
        rotalar.add(`/api/${kok}/${String(Reflect.getMetadata(PATH_METADATA, handler))}`.replace(/\/+/g, '/').replace(/\/$/, ''));
      }
    }
    for (const r of [...LARGE_JSON_BODY_ROUTES, PERSONA_CHAT_JSON_ROUTE]) {
      expect(r.method).toBe('POST');
      expect(rotalar.has(r.path), r.path).toBe(true);
    }
  });
});

describe('inceleme S1: 2 MiB ayristirici kimlik + UTF-8 ister, yogun govdeyi JSON.parse\'tan once keser', () => {
  const buf = (s: string) => Buffer.from(s, 'utf8');
  const bosIstek = () => istek('POST', '/api/sites/s1/audit/crawler/ingest', 'application/json', CEREZ);

  it('kimlik bilgisi: AuthGuard\'in okudugu her oturum cerezi ve Bearer (JWT ya da luvi_ anahtari)', () => {
    for (const ad of SESSION_COOKIE_NAMES) {
      expect(carriesSessionCredentials(istek('POST', '/x', 'application/json', { cookie: `a=1; ${ad}=tok` })), ad).toBe(true);
    }
    expect(carriesSessionCredentials(istek('POST', '/x', 'application/json', BEARER))).toBe(true);
    expect(carriesSessionCredentials(istek('POST', '/x', 'application/json', { authorization: 'Bearer eyJhbGciOiJkaXIifQ.x' }))).toBe(true);
  });

  it('kimlik bilgisi yok sayilanlar: baslik yok, bos Bearer, Basic, baska cerez, parcali cerez, bozuk kodlama', () => {
    const ornekler: Array<Record<string, string>> = [
      {},
      { authorization: 'Bearer ' },
      { authorization: 'Basic dXNlcjpwYXNz' },
      { cookie: 'authjs.csrf-token=x; authjs.callback-url=y' },
      // NextAuth'un parcali cerezi: AuthGuard da okumaz, yani istek zaten 401 alirdi
      { cookie: 'authjs.session-token.0=x' },
      { cookie: 'authjs.session-token=%E0%A4%A' },
    ];
    for (const basliklar of ornekler) {
      expect(carriesSessionCredentials(istek('POST', '/x', 'application/json', basliklar)), JSON.stringify(basliklar)).toBe(false);
    }
  });

  it('charset: yalniz utf-8 (ya da hic charset yok) 2 MiB\'i secebilir; UTF-16/UTF-7 taramayi kandirabilirdi', () => {
    for (const t of [
      'application/json', 'application/json; charset=utf-8', 'application/json;charset=UTF-8', 'application/json; charset="utf-8"',
      'application/json; charset = utf-8', 'application/json; foo=bar; charset=utf-8',
    ]) {
      expect(hasUtf8Charset(istek('POST', '/x', t)), t).toBe(true);
    }
    for (const t of [
      'application/json; charset=utf-16', 'application/json; charset=utf-16le', 'application/json; charset=UTF-16BE',
      'application/json; charset=utf-7', 'application/json; charset=utf-32', 'application/json; charset=latin1',
      'application/json; charset=utf8',
      // Tekrar eden parametre: body-parser sonuncuyu alir (content-type 1.0), hepsi utf-8 olmali
      'application/json; charset=utf-8; charset=utf-7',
      'application/json; charset="utf\\-7"', 'application/json; charset=', 'application/json; charset="utf-8',
      // Bilerek genis: baska parametrenin adinda gecen charset de denetlenir (en fazla 100 KB'a duser)
      'application/json; xcharset=utf-16',
    ]) {
      expect(hasUtf8Charset(istek('POST', '/x', t)), t).toBe(false);
    }
    expect(hasUtf8Charset(istek('POST', '/x', null))).toBe(false);
  });

  it('2 MiB secimi dort kosulun hepsini ister: JSON + yukleme ucu + utf-8 + kimlik bilgisi', () => {
    const yol = '/api/sites/s1/audit/crawler/ingest';
    expect(isLargeJsonUploadRequest(istek('POST', yol, 'application/json', CEREZ))).toBe(true);
    expect(isLargeJsonUploadRequest(istek('POST', yol, 'application/json; charset=utf-8', BEARER))).toBe(true);
    expect(isLargeJsonUploadRequest(istek('POST', yol))).toBe(false);
    expect(isLargeJsonUploadRequest(istek('POST', yol, 'text/plain', CEREZ))).toBe(false);
    expect(isLargeJsonUploadRequest(istek('POST', yol, 'application/json; charset=utf-16le', CEREZ))).toBe(false);
    expect(isLargeJsonUploadRequest(istek('POST', '/api/sites/s1/audit/prompts', 'application/json', CEREZ))).toBe(false);
    expect(isLargeJsonUploadRequest(istek('PUT', yol, 'application/json', CEREZ))).toBe(false);
  });

  it('yukleme DTO\'larinin en kalabalik mesru govdesi tarama sinirinin cok altinda; dizi/ic nesne alani yok', async () => {
    const { getMetadataStorage } = await import('class-validator');
    const { CrawlerIngestDto, HaroParseDto } = await import('./audit/audit.dto.js');
    const { GscAiCsvImportDto, GscAiCsvPreviewDto } = await import('./analytics/analytics-body.dto.js');
    const { HandPhotoDto } = await import('./aso/aso.dto.js');
    const dtoByRoute: Record<string, Type> = {
      '/api/sites/:siteId/audit/crawler/ingest': CrawlerIngestDto,
      '/api/sites/:siteId/audit/haro/parse': HaroParseDto,
      '/api/sites/:siteId/analytics/gsc-ai-csv': GscAiCsvImportDto,
      '/api/sites/:siteId/analytics/gsc-ai-csv/preview': GscAiCsvPreviewDto,
      '/api/sites/:siteId/aso/apps/:appId/screenshots/hand-photo-with-screenshot': HandPhotoDto,
    };
    // Yeni bir yukleme ucu eklenirse DTO'su burada denetlenmeli
    expect(Object.keys(dtoByRoute).sort()).toEqual(LARGE_JSON_BODY_ROUTES.map((r) => r.path).sort());
    for (const [yol, dto] of Object.entries(dtoByRoute)) {
      const meta = getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false);
      const alanlar = new Set(meta.map((m) => m.propertyName));
      // Duz nesne: '{' + her alana ':' + aralara ',' = 2 x alan
      expect(2 * alanlar.size, yol).toBeLessThanOrEqual(8);
      expect(meta.filter((m) => m.type === 'nestedValidation' || m.name === 'isArray' || m.name === 'isObject'), yol).toEqual([]);
    }
    expect(LARGE_JSON_BODY_MAX_STRUCTURE).toBe(64);
  });

  it('mesru govdeler gecer ve req.rawBody yazilir (Nest\'in rawBody verify\'i yerine)', () => {
    // Metin icindeki [ ] : , { isaretleri sayilmaz (gercek access.log satiri)
    const log = '66.249.66.1 - - [10/Oct/2026:13:55:36 +0300] "GET /a?b={c} HTTP/1.1" 200 5120 "-" "GPTBot/1.2, \\"x\\""\n'.repeat(5_000);
    for (const govde of [
      JSON.stringify({ logContent: log }),
      JSON.stringify({ emailContent: 'ğüşıöç '.repeat(10_000) }),
      JSON.stringify({ csv: '"2026-10-01","AI Overviews","https://ornek.com/a,b","12"\n'.repeat(2_000), fileName: 'gsc.csv' }),
      JSON.stringify({ csv: 'a,b\n1,2\n' }),
      JSON.stringify({ screenshotBase64: 'A'.repeat(HAND_PHOTO_MAX_BASE64_CHARS), brandColor: '#FF6A00', width: 4096, height: 4096 }),
      JSON.stringify({ screenshotBase64: 'QUJD', brandColor: '#FF6A00', width: 1080, height: 1920 }, null, 2),
      '',
    ]) {
      const req = bosIstek();
      const b = buf(govde);
      expect(() => verifyLargeJsonBody(req, {}, b, 'utf-8'), govde.slice(0, 40)).not.toThrow();
      expect(req.rawBody).toBe(b);
    }
  });

  it(`sinir tam ${LARGE_JSON_BODY_MAX_STRUCTURE} yapi isareti: sinirdaki govde gecer, bir fazlasi 413 + Turkce mesaj`, () => {
    // [0,0,...,0]: n oge = '[' + (n - 1) ',' = n isaret
    const dizi = (n: number) => buf(`[${Array(n).fill('0').join(',')}]`);
    expect(() => verifyLargeJsonBody(bosIstek(), {}, dizi(LARGE_JSON_BODY_MAX_STRUCTURE), 'utf-8')).not.toThrow();
    const req = bosIstek();
    let hata: unknown;
    try {
      verifyLargeJsonBody(req, {}, dizi(LARGE_JSON_BODY_MAX_STRUCTURE + 1), 'utf-8');
    } catch (e) {
      hata = e;
    }
    expect(hata).toBeInstanceOf(PayloadTooLargeException);
    const ex = hata as PayloadTooLargeException;
    expect(ex.getStatus()).toBe(413);
    expect(ex.getResponse()).toEqual({ statusCode: 413, message: LARGE_JSON_BODY_TOO_DENSE_MESSAGE, error: 'Payload Too Large' });
    expect(LARGE_JSON_BODY_TOO_DENSE_MESSAGE).toBe('Gönderilen veri bu yükleme için çok fazla öğe içeriyor. İçeriği tek bir metin alanı olarak gönder.');
    // body-parser hatayi createError(403, err) ile sarar; http-errors err.status'u korur (413)
    expect((hata as { status?: number }).status).toBe(413);
    // Reddedilen govde rawBody'ye de yazilmaz
    expect(req.rawBody).toBeUndefined();
  });

  it('2 MiB yogun govdeler (bos nesne, cok anahtar, sifir dizisi, metin ardinda) ilk isaretlerde reddedilir', () => {
    const LIMIT = JSON_BODY_LIMIT_BYTES - 1;
    const govdeler = [
      `[${Array(Math.floor((LIMIT - 2) / 3)).fill('{}').join(',')}]`,
      `{${Array.from({ length: 200_000 }, (_, i) => `"${i.toString(36)}":0`).join(',')}}`,
      `[${Array(Math.floor((LIMIT - 2) / 2)).fill('0').join(',')}]`,
      `["${'x'.repeat(LIMIT - 4_000)}"${',{}'.repeat(1_000)}]`,
    ];
    for (const govde of govdeler) {
      const t0 = performance.now();
      expect(() => verifyLargeJsonBody(bosIstek(), {}, buf(govde), 'utf-8'), govde.slice(0, 20)).toThrow(PayloadTooLargeException);
      expect(performance.now() - t0, govde.slice(0, 20)).toBeLessThan(100);
    }
  });

  it('UTF-8 disi kodlama taranmadan gecmez: 415 (secim kurali bozulsa bile)', () => {
    const govde = buf(JSON.stringify({ logContent: 'a' }));
    for (const kodlama of ['utf-16le', 'utf-7', 'latin1']) {
      expect(() => verifyLargeJsonBody(bosIstek(), {}, govde, kodlama), kodlama).toThrow(UnsupportedMediaTypeException);
    }
    for (const kodlama of ['utf-8', 'UTF-8', undefined, null]) {
      expect(() => verifyLargeJsonBody(bosIstek(), {}, govde, kodlama), String(kodlama)).not.toThrow();
    }
  });
});

describe('inceleme S1 yan etkisi: kimliksiz yukleme istegi govde okunmadan AuthGuard\'in 401\'ini alir', () => {
  const YUKLEME_YOLLARI = [
    '/api/sites/s1/audit/crawler/ingest',
    '/api/sites/s1/audit/haro/parse',
    '/api/sites/s1/analytics/gsc-ai-csv',
    '/api/sites/s1/analytics/gsc-ai-csv/preview',
    '/api/sites/s1/aso/apps/a1/screenshots/hand-photo-with-screenshot',
  ];
  /** Ara katmani calistirir; next'e gecen hatayi (yoksa undefined) doner */
  const calistir = (req: unknown) => {
    const next = vi.fn();
    rejectUploadWithoutCredentials(req as any, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    return next.mock.calls[0][0] as unknown;
  };

  it('bes yukleme ucunda kimliksiz POST: 401 "Token yok" (icerik turu ne olursa olsun; guard da ayni cevabi verirdi)', () => {
    expect(YUKLEME_YOLLARI).toHaveLength(LARGE_JSON_BODY_ROUTES.length);
    for (const yol of YUKLEME_YOLLARI) {
      for (const tur of ['application/json', 'application/json; charset=utf-16le', 'text/plain', null]) {
        const hata = calistir(istek('POST', yol, tur));
        expect(hata, `${yol} ${tur}`).toBeInstanceOf(UnauthorizedException);
        expect((hata as UnauthorizedException).getResponse(), yol).toEqual({ statusCode: 401, message: 'Token yok', error: 'Unauthorized' });
      }
      // Bos Bearer, Basic ve yalniz baska cerez de kimlik sayilmaz (carriesSessionCredentials)
      const kimliksizBasliklar: Array<Record<string, string>> = [{ authorization: 'Bearer ' }, { authorization: 'Basic dXNlcjpwYXNz' }, { cookie: 'authjs.csrf-token=x' }];
      for (const basliklar of kimliksizBasliklar) {
        expect(calistir(istek('POST', yol, 'application/json', basliklar)), JSON.stringify(basliklar)).toBeInstanceOf(UnauthorizedException);
      }
    }
    expect(MISSING_CREDENTIALS_MESSAGE).toBe('Token yok');
  });

  it('kimlik bilgisi tasiyan, baska uca ya da baska yontemle gelen istek aynen gecer (karar guard\'da)', () => {
    for (const req of [
      istek('POST', '/api/sites/s1/audit/crawler/ingest', 'application/json', CEREZ),
      istek('POST', '/api/sites/s1/audit/crawler/ingest', 'application/json', BEARER),
      // Gecersiz/suresi dolmus kimlik de "kimlik var" sayilir: guard 401'ini kendi nedeniyle verir
      istek('POST', '/api/sites/s1/audit/haro/parse', 'application/json', { cookie: '__Secure-authjs.session-token=suresi.dolmus' }),
      istek('POST', '/api/sites/s1/audit/prompts'),
      istek('POST', '/api/sites/s1/audit/persona/chat'),
      istek('PUT', '/api/sites/s1/audit/crawler/ingest'),
      istek('GET', '/api/sites/s1/analytics/gsc-ai-csv'),
    ]) {
      expect(calistir(req), `${req.method} ${req.url}`).toBeUndefined();
    }
  });

  it('govdeye dokunmaz: akis okunmaz, dinleyici eklenmez (cevaptan sonra Node kalan baytlari saklamadan bosaltir)', () => {
    const akis = Object.assign(new PassThrough(), { method: 'POST', url: '/api/sites/s1/audit/crawler/ingest', originalUrl: '/api/sites/s1/audit/crawler/ingest', headers: { 'content-type': 'application/json' } });
    akis.write(Buffer.from('[{},{},{}'));
    const bekleyen = akis.readableLength;
    expect(calistir(akis)).toBeInstanceOf(UnauthorizedException);
    expect(akis.readableFlowing).toBeNull();
    expect(akis.listenerCount('data')).toBe(0);
    expect(akis.readableLength).toBe(bekleyen);
  });

  it('cevap GERCEK AuthGuard\'in kimliksiz istege verdigiyle birebir ayni (durum + govde)', async () => {
    class Ctl { handler() {} }
    for (const yol of YUKLEME_YOLLARI) {
      const req: any = { method: 'POST', url: yol, originalUrl: yol, path: yol, headers: { 'content-type': 'application/json' } };
      const ctx = { getHandler: () => Ctl.prototype.handler, getClass: () => Ctl, switchToHttp: () => ({ getRequest: () => req }) } as any;
      const prisma = { user: { findUnique: vi.fn() } };
      const guardHatasi = await new AuthGuard(prisma as any, new Reflector(), {} as any).canActivate(ctx).catch((e: unknown) => e);
      expect(guardHatasi, yol).toBeInstanceOf(UnauthorizedException);
      const araKatman = calistir(req) as UnauthorizedException;
      expect(araKatman.getStatus(), yol).toBe((guardHatasi as UnauthorizedException).getStatus());
      expect(araKatman.getResponse(), yol).toEqual((guardHatasi as UnauthorizedException).getResponse());
      // Guard bu istekte DB'ye hic gitmez (token yok): ara katman da gitmez
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    }
  });
});

describe('bodyParseErrorMiddleware', () => {
  it('bozuk JSON (SyntaxError, entity.parse.failed): SyntaxError olmayan http-errors nesnesi -> filtrede Turkce 400', () => {
    const next = vi.fn();
    const parseHatasi = Object.assign(new SyntaxError('Unexpected token } in JSON at position 9'), {
      status: 400, statusCode: 400, expose: true, type: 'entity.parse.failed', body: '{"a":}',
    });
    bodyParseErrorMiddleware(parseHatasi, {}, {}, next);
    const cevrilen = next.mock.calls[0][0];
    // Nest mapExternalException her SyntaxError'u Ingilizce BadRequestException yapardi
    expect(cevrilen).not.toBeInstanceOf(SyntaxError);
    expect(clientHttpErrorBody(cevrilen)).toEqual({ statusCode: 400, message: 'Gönderilen veri okunamadı, lütfen tekrar dene.' });
  });

  it('diger hatalar aynen gecer (413, baska SyntaxError, Nest istisnasi)', () => {
    for (const err of [
      httpErrors(413, 'request entity too large', { limit: 102_400, type: 'entity.too.large' }),
      new SyntaxError('baska bir SyntaxError'),
      new HttpException('Yasak', 403),
    ]) {
      const next = vi.fn();
      bodyParseErrorMiddleware(err, {}, {}, next);
      expect(next).toHaveBeenCalledWith(err);
    }
  });
});

describe('clientHttpErrorBody', () => {
  it('413: siniri hatadaki limit alanindan okur (yukleme 2 MB, varsayilan/urlencoded 100 KB, persona 64 KB)', () => {
    expect(clientHttpErrorBody(httpErrors(413, 'request entity too large', { limit: JSON_BODY_LIMIT_BYTES, type: 'entity.too.large' })))
      .toEqual({ statusCode: 413, message: 'Gönderilen veri çok büyük (en fazla 2 MB).' });
    expect(clientHttpErrorBody(httpErrors(413, 'request entity too large', { limit: 102_400 })))
      .toEqual({ statusCode: 413, message: 'Gönderilen veri çok büyük (en fazla 100 KB).' });
    expect(clientHttpErrorBody(httpErrors(413, 'request entity too large', { limit: PERSONA_CHAT_JSON_BODY_LIMIT_BYTES }))?.message)
      .toBe('Gönderilen veri çok büyük (en fazla 64 KB).');
    expect(clientHttpErrorBody(httpErrors(413, 'x', { limit: 1.5 * 1024 * 1024 }))?.message)
      .toBe('Gönderilen veri çok büyük (en fazla 1,5 MB).');
  });

  it('413: limit yoksa ya da gecersizse sayi uydurulmaz', () => {
    for (const limit of [undefined, 0, -1, Number.NaN, '2mb']) {
      expect(clientHttpErrorBody(httpErrors(413, 'too many parameters', { limit }))?.message, String(limit))
        .toBe('Gönderilen veri çok büyük.');
    }
  });

  it('415, 400 ve diger 4xx: durum korunur, mesaj Turkce', () => {
    expect(clientHttpErrorBody(httpErrors(415, 'unsupported charset "LATIN1"')))
      .toEqual({ statusCode: 415, message: 'Gönderilen verinin kodlaması desteklenmiyor.' });
    expect(clientHttpErrorBody(httpErrors(400, 'request aborted')))
      .toEqual({ statusCode: 400, message: 'Gönderilen veri okunamadı, lütfen tekrar dene.' });
    expect(clientHttpErrorBody(httpErrors(404, 'Not Found'))).toEqual({ statusCode: 404, message: 'İstek işlenemedi.' });
    // Ingilizce kutuphane metni hicbir durumda istemciye gecmez
    expect(JSON.stringify(clientHttpErrorBody(httpErrors(413, 'request entity too large')))).not.toMatch(/request entity/);
  });

  it('yalniz status tasiyan SDK hatasi (dis servisin 401/404/429u) donusturulmez: 500 kalir', () => {
    // Anthropic/OpenAI APIError, gaxios hatasi: status var, expose/statusCode yok
    expect(clientHttpErrorBody(Object.assign(new Error('upstream'), { status: 401 }))).toBeNull();
    expect(clientHttpErrorBody(Object.assign(new Error('upstream'), { status: 429, headers: {} }))).toBeNull();
    // statusCode var ama expose yok (or. elle kurulmus hata nesnesi)
    expect(clientHttpErrorBody(Object.assign(new Error('x'), { statusCode: 404 }))).toBeNull();
  });

  it('http-errors bicimine uymayanlar null: 5xx, status uyusmazligi, Error olmayan nesne, Nest HttpException', () => {
    expect(clientHttpErrorBody(httpErrors(500, 'stream is not readable'))).toBeNull();
    expect(clientHttpErrorBody(httpErrors(503, 'Service Unavailable'))).toBeNull();
    expect(clientHttpErrorBody(Object.assign(new Error('x'), { status: 400, statusCode: 413, expose: true }))).toBeNull();
    expect(clientHttpErrorBody(Object.assign(new Error('x'), { status: 413.5, statusCode: 413.5, expose: true }))).toBeNull();
    expect(clientHttpErrorBody({ status: 413, statusCode: 413, expose: true, message: 'x' })).toBeNull();
    expect(clientHttpErrorBody(new HttpException('Yasak', 403))).toBeNull();
    for (const deger of [null, undefined, 'hata', 413, new Error('duz')]) {
      expect(clientHttpErrorBody(deger), String(deger)).toBeNull();
    }
  });
});
