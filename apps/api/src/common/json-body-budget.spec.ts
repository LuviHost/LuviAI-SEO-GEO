import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  JSON_BODY_MAX_DEPTH,
  JSON_BODY_MAX_NODES,
  JSON_BODY_TOO_DEEP_MESSAGE,
  JSON_BODY_TOO_MANY_NODES_MESSAGE,
  createJsonBodyBudgetMiddleware,
  jsonBodyBudgetMiddleware,
  jsonBudgetViolation,
  jsonStructureCount,
} from './json-body-budget.js';

/**
 * json-body-budget.ts — govdenin oge sayisi ve derinligi.
 *
 * NEDEN VAR (inceleme R1): bayt siniri dogrulama maliyetini sinirlamaz;
 * ValidationPipe her ogeyi donusturup dogrular ve ic ice yapiyi ozyinelemeli
 * gezer. Butce asiri govdeyi guard ve pipe'tan once ucuzca reddeder. Gercek
 * HTTP zinciri main-body-limit.spec.ts ve main-persona-body.spec.ts'te.
 */

const ic = (derinlik: number): unknown => {
  let v: unknown = 0;
  for (let i = 0; i < derinlik; i++) v = [v];
  return v;
};

describe('jsonBudgetViolation', () => {
  it('oge sayisi kok dahil: tam butce gecer, bir fazlasi "nodes"', () => {
    const butce = { maxNodes: 5, maxDepth: 10 };
    expect(jsonBudgetViolation({ a: 1, b: [2, 3] }, butce)).toBeNull(); // kok, a, b, 2, 3 = 5
    expect(jsonBudgetViolation({ a: 1, b: [2, 3, 4] }, butce)).toBe('nodes');
    expect(jsonBudgetViolation('duz metin', butce)).toBeNull();
    expect(jsonBudgetViolation(null, butce)).toBeNull();
    expect(jsonBudgetViolation({}, { maxNodes: 0, maxDepth: 10 })).toBe('nodes');
  });

  it('derinlik kap sayisidir: maxDepth seviye gecer, bir fazlasi "depth"; yaprak sayilmaz', () => {
    const butce = { maxNodes: 1_000, maxDepth: 3 };
    expect(jsonBudgetViolation(ic(3), butce)).toBeNull();
    expect(jsonBudgetViolation(ic(4), butce)).toBe('depth');
    expect(jsonBudgetViolation({ a: { b: { c: 'yaprak' } } }, butce)).toBeNull();
    expect(jsonBudgetViolation({ a: { b: { c: { d: 1 } } } }, butce)).toBe('depth');
  });

  it('varsayilan butce: 10.000 oge / 32 seviye; mesru en yogun govde (ASA 1.000 kelime) rahat gecer', () => {
    expect(JSON_BODY_MAX_NODES).toBe(10_000);
    expect(JSON_BODY_MAX_DEPTH).toBe(32);
    const asa = {
      accountId: 'acc', name: 'Kampanya', dailyBudgetUsd: 10, appleAppId: 1,
      countries: Array(100).fill('TR'),
      keywords: Array.from({ length: 1_000 }, (_, i) => ({ text: `kelime ${i}`, bidUsd: 1, matchType: 'EXACT' })),
    };
    expect(jsonBudgetViolation(asa)).toBeNull();
    expect(jsonBudgetViolation({ v: Array(JSON_BODY_MAX_NODES - 2).fill(0) })).toBeNull();
    expect(jsonBudgetViolation({ v: Array(JSON_BODY_MAX_NODES - 1).fill(0) })).toBe('nodes');
    expect(jsonBudgetViolation(ic(JSON_BODY_MAX_DEPTH))).toBeNull();
    expect(jsonBudgetViolation(ic(JSON_BODY_MAX_DEPTH + 1))).toBe('depth');
  });

  it('erken biter ve kendi yiginini tasirmaz: 1 milyonluk dizi ve 100 bin seviye derinlik hizli', () => {
    const buyuk = { history: Array.from({ length: 1_000_000 }, () => ({})) };
    const t0 = performance.now();
    expect(jsonBudgetViolation(buyuk)).toBe('nodes');
    expect(jsonBudgetViolation(ic(100_000))).toBe('depth');
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('yalniz kendi anahtarlari sayilir (Object.prototype kirlense bile); __proto__ adli JSON anahtari da sayilir', () => {
    const govde = JSON.parse('{"__proto__": {"x": 1}, "a": 1}');
    expect(jsonBudgetViolation(govde, { maxNodes: 4, maxDepth: 5 })).toBeNull(); // kok, __proto__, x, a
    expect(jsonBudgetViolation(govde, { maxNodes: 3, maxDepth: 5 })).toBe('nodes');
    (Object.prototype as any).kirli = 1;
    try {
      expect(jsonBudgetViolation({ a: 1 }, { maxNodes: 2, maxDepth: 5 })).toBeNull();
    } finally {
      delete (Object.prototype as any).kirli;
    }
  });
});

describe('jsonStructureCount (inceleme S1: JSON.parse oncesi ham govde taramasi)', () => {
  const say = (s: string, stopAbove?: number) => jsonStructureCount(Buffer.from(s, 'utf8'), stopAbove);

  /** Deterministik sozde rastgele (mulberry32): test her kosuda ayni degerleri uretir */
  function rastgele(tohum: number) {
    let t = tohum >>> 0;
    return () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Taramayi sasirtmaya calisan metinler: tirnak, ters bolu, yapi isaretleri, cok baytli ve kontrol karakterleri
  const ZOR_METINLER = ['', 'a', '"', '\\', '\\"', '"\\', '{', '[', ',', ':', '}{][', 'ğüşıöç', '😀', ' ', '\n\t\u0000', 'a"b\\c{d[e,f:g', '\\\\\\"'];
  function deger(r: () => number, derinlik: number): unknown {
    const x = r();
    if (derinlik > 4 || x < 0.35) {
      const y = r();
      if (y < 0.5) return ZOR_METINLER[Math.floor(r() * ZOR_METINLER.length)] + String(Math.floor(r() * 100));
      if (y < 0.7) return Math.floor(r() * 1e6) / 100;
      if (y < 0.85) return r() < 0.5;
      return null;
    }
    const n = Math.floor(r() * 5);
    if (x < 0.65) return Array.from({ length: n }, () => deger(r, derinlik + 1));
    const o: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) o[ZOR_METINLER[Math.floor(r() * ZOR_METINLER.length)] + i] = deger(r, derinlik + 1);
    return o;
  }
  /** Beklenen isaret sayisi: kap basina 1 + dizi/nesne icindeki ',' + nesnedeki ':' */
  function beklenen(v: unknown): number {
    if (Array.isArray(v)) return 1 + Math.max(0, v.length - 1) + v.reduce((t: number, c) => t + beklenen(c), 0);
    if (v !== null && typeof v === 'object') {
      const anahtarlar = Object.keys(v);
      return 1 + anahtarlar.length + Math.max(0, anahtarlar.length - 1)
        + anahtarlar.reduce((t, k) => t + beklenen((v as Record<string, unknown>)[k]), 0);
    }
    return 0;
  }
  /** JSON.parse'in kurdugu deger + anahtar sayisi */
  function kurulan(v: unknown): number {
    if (Array.isArray(v)) return 1 + v.reduce((t: number, c) => t + kurulan(c), 0);
    if (v !== null && typeof v === 'object') {
      return 1 + Object.keys(v).reduce((t, k) => t + 1 + kurulan((v as Record<string, unknown>)[k]), 0);
    }
    return 1;
  }

  it('metin disindaki { [ , : isaretlerini sayar; } ] ve bosluk sayilmaz', () => {
    expect(say('{"a":1}')).toBe(2);
    expect(say('{"a":1,"b":[1,2,{"c":null}]}')).toBe(9);
    expect(say(' [ ] ')).toBe(1);
    expect(say('{}')).toBe(1);
    expect(say('"tek metin"')).toBe(0);
    expect(say('')).toBe(0);
  });

  it('metin icindekiler ve kacislar sayilmaz: \\" metni bitirmez, \\\\ biter, \\uXXXX', () => {
    expect(say('{"a":"{[,:]}"}')).toBe(2);
    expect(say('{"a":"x\\"{[,:\\"y"}')).toBe(2);
    expect(say('{"a":"x\\\\","b":"{"}')).toBe(4);
    expect(say('{"a":"\\u007b\\u005b\\u002c"}')).toBe(2);
    // Gercek access.log satiri: koseli parantez, iki nokta ve virgul metin icinde
    expect(say(JSON.stringify({ logContent: '1.2.3.4 - - [10/Oct/2026:13:55:36 +0300] "GET /a,b HTTP/1.1" 200\n'.repeat(1_000) }))).toBe(2);
  });

  it('cok baytli UTF-8 karakterlerin hicbir bayti ASCII isarete benzemez', () => {
    expect(say(JSON.stringify({ a: 'ğüşıöçĞÜŞİÖÇ😀漢字 '.repeat(1_000) }))).toBe(2);
    // U+227B (≻) ve U+5B7B: UTF-16LE'de baytlari '{' ve '"' olurdu; UTF-8'de olamaz
    expect(say(JSON.stringify({ a: '≻孻∀' }))).toBe(2);
  });

  it('rastgele 2.000 deger: sayi tam beklenen kadar (girintili yazimda da) ve kurulan deger <= 2 x sayi + 1', () => {
    const r = rastgele(20261018);
    for (let i = 0; i < 2_000; i++) {
      const v = deger(r, 0);
      const metin = JSON.stringify(v);
      const n = say(metin);
      expect(n, metin).toBe(beklenen(v));
      expect(say(JSON.stringify(v, null, 2)), metin).toBe(n);
      expect(kurulan(JSON.parse(metin)), metin).toBeLessThanOrEqual(2 * n + 1);
    }
  });

  it('sinir asilinca erken durur: 2 MiB [{},...] ilk birkac yuz baytta biter', () => {
    const yogun = Buffer.from(`[${Array(699_000).fill('{}').join(',')}]`);
    expect(jsonStructureCount(yogun)).toBe(1 + 699_000 + 698_999);
    const t0 = performance.now();
    for (let i = 0; i < 1_000; i++) expect(jsonStructureCount(yogun, 64)).toBe(65);
    // 1.000 tarama: tamami gezilseydi her biri milisaniyeler surerdi
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('gecersiz govdede cokmez; kayan "metin icinde" durumu yalniz JSON.parse\'in zaten durdugu yerden sonra olur', () => {
    expect(say('{"a":"kapanmamis')).toBe(2);
    expect(say('[1,2,\\')).toBe(3);
    // '[{}' sonrasi beklenmeyen '"': JSON.parse ilk 2 kapla durur, sonrasini hic kurmaz
    const kayan = `[{}"${',{}'.repeat(1_000)}"]`;
    expect(() => JSON.parse(kayan)).toThrow(SyntaxError);
    expect(say(kayan)).toBe(2);
  });
});

describe('jsonBodyBudgetMiddleware', () => {
  it('butce asimi: oge sayisi 413, derinlik 400 (Turkce mesaj); icindeki govde next() ile gecer', () => {
    const next = vi.fn();
    jsonBodyBudgetMiddleware({ body: { v: Array(JSON_BODY_MAX_NODES).fill(0) } }, {}, next);
    const tooMany = next.mock.calls[0][0];
    expect(tooMany).toBeInstanceOf(PayloadTooLargeException);
    expect(tooMany.getStatus()).toBe(413);
    expect(tooMany.getResponse()).toMatchObject({ message: JSON_BODY_TOO_MANY_NODES_MESSAGE });
    expect(JSON_BODY_TOO_MANY_NODES_MESSAGE).toBe('Gönderilen veri çok fazla öğe içeriyor (en fazla 10.000). Veriyi bölerek gönder.');

    next.mockClear();
    jsonBodyBudgetMiddleware({ body: ic(JSON_BODY_MAX_DEPTH + 1) }, {}, next);
    const tooDeep = next.mock.calls[0][0];
    expect(tooDeep).toBeInstanceOf(BadRequestException);
    expect(tooDeep.getResponse()).toMatchObject({ message: JSON_BODY_TOO_DEEP_MESSAGE });

    for (const body of [undefined, {}, { a: 'b' }, 'metin']) {
      next.mockClear();
      jsonBodyBudgetMiddleware({ body }, {}, next);
      expect(next).toHaveBeenCalledWith();
    }
  });

  it('istege gore butce: secilen butce uygulanir ve mesaj o butcenin sinirini soyler', () => {
    const dar = { maxNodes: 1_000, maxDepth: 8 };
    const mw = createJsonBodyBudgetMiddleware((req: { body?: unknown; dar?: boolean }) => (req.dar ? dar : { maxNodes: JSON_BODY_MAX_NODES, maxDepth: JSON_BODY_MAX_DEPTH }));
    const govde = { v: Array(1_500).fill(0) };
    const next = vi.fn();
    mw({ body: govde, dar: true }, {}, next);
    expect(next.mock.calls[0][0].getResponse()).toMatchObject({ message: 'Gönderilen veri çok fazla öğe içeriyor (en fazla 1.000). Veriyi bölerek gönder.' });
    next.mockClear();
    mw({ body: ic(9), dar: true }, {}, next);
    expect(next.mock.calls[0][0].getResponse()).toMatchObject({ message: 'Gönderilen verideki iç içe yapı çok derin (en fazla 8 seviye).' });
    next.mockClear();
    mw({ body: govde, dar: false }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});
