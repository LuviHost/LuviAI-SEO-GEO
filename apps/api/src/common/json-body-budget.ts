import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

/**
 * Istek govdesinin ICERIK butcesi: oge sayisi ve ic ice derinlik.
 *
 * NEDEN: bayt siniri (request-body.ts) tek basina dogrulama maliyetini
 * sinirlamaz. Global ValidationPipe (class-transformer + class-validator)
 * govdenin HER ogesini donusturur ve dogrular; @ArrayMaxSize gibi kurallar
 * diger ogelerin dogrulanmasini durdurmaz. 100 KB'lik {"history":[{},{},...]}
 * govdesi ~34 bin oge eder; olcum (persona sohbeti DTO'su, main.ts pipe
 * ayarlari): 10 bin ogede ~38 ms, 34 bin ogede ~140 ms ve 5 MB'lik bir 400
 * cevabi. Ayrica ValidationPipe.stripProtoKeys (@nestjs/common 10.4
 * pipes/validation.pipe.js) ve class-transformer ic ice yapiyi OZYINELEMELI
 * gezer: 10.000 seviye derin bir dizi (~20 KB govde) olcumde "Maximum call
 * stack size exceeded" ile 500 ve Sentry kaydi uretiyordu. Bu ara katman
 * ayristirmadan hemen sonra, guard'lardan ve pipe'tan ONCE calisir; asiri
 * govde ucuz bir 413/400 alir.
 *
 * NEDEN BU DEGERLER: mesru en yogun govdeler (inceleme):
 *  - CreateAsaCampaignDto: 1.000 anahtar kelime x 4 + 100 ulke ~ 4.100 oge
 *    (DTO'lardaki en buyuk @ArrayMaxSize 1.000, digerleri <= 100);
 *  - admin LinkedIn CSV ice aktarimi (satir basina en fazla 8 oge): 100 KB
 *    varsayilan sinirda en fazla ~6.900 oge;
 *  - yukleme uclarinin govdesi tek bir uzun metin (birkac oge).
 * 10.000 bu degerlerin hepsinin ustunde kalir ve en kotu dogrulamayi ~40 ms
 * ile sinirlar. En derin mesru govde (MCP JSON-RPC: params.arguments)
 * birkac seviyedir; 32, body-parser'in urlencoded derinlik varsayilaniyla
 * ayni ve ozyinelemeli gezinme icin guvenli.
 */
export const JSON_BODY_MAX_NODES = 10_000;
export const JSON_BODY_MAX_DEPTH = 32;

export interface JsonBodyBudget {
  maxNodes: number;
  maxDepth: number;
}

/** Her ucun varsayilan butcesi */
export const DEFAULT_JSON_BODY_BUDGET: JsonBodyBudget = { maxNodes: JSON_BODY_MAX_NODES, maxDepth: JSON_BODY_MAX_DEPTH };

export type JsonBudgetViolation = 'nodes' | 'depth';

/** 10000 -> "10.000" (Turkce binlik ayirici; ICU'ya bagli degil) */
function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function jsonBodyTooManyNodesMessage(maxNodes: number): string {
  return `Gönderilen veri çok fazla öğe içeriyor (en fazla ${formatCount(maxNodes)}). Veriyi bölerek gönder.`;
}

export function jsonBodyTooDeepMessage(maxDepth: number): string {
  return `Gönderilen verideki iç içe yapı çok derin (en fazla ${maxDepth} seviye).`;
}

export const JSON_BODY_TOO_MANY_NODES_MESSAGE = jsonBodyTooManyNodesMessage(JSON_BODY_MAX_NODES);
export const JSON_BODY_TOO_DEEP_MESSAGE = jsonBodyTooDeepMessage(JSON_BODY_MAX_DEPTH);

/**
 * Degerin oge sayisi ya da derinligi butceyi asiyor mu? Asmiyorsa null.
 *
 * Oge: kok dahil her deger (nesne, dizi, metin, sayi, boolean, null). Derinlik:
 * ic ice kap (nesne/dizi) sayisi; kok kap 1. Gezinme YINELEMELI (kendi yigini
 * tasmaz) ve ERKEN biter: bir kabin cocuklari yigina konmadan ONCE sayilir,
 * yani 1 milyonluk dizide maliyet butce kadardir, dizi boyu kadar degil.
 */
export function jsonBudgetViolation(
  value: unknown,
  budget: JsonBodyBudget = DEFAULT_JSON_BODY_BUDGET,
): JsonBudgetViolation | null {
  let nodes = 1;
  if (nodes > budget.maxNodes) return 'nodes';
  if (value === null || typeof value !== 'object') return null;
  const stack: Array<{ v: object; depth: number }> = [{ v: value, depth: 1 }];
  while (stack.length > 0) {
    const { v, depth } = stack.pop()!;
    if (depth > budget.maxDepth) return 'depth';
    if (Array.isArray(v)) {
      if (nodes + v.length > budget.maxNodes) return 'nodes';
      nodes += v.length;
      for (const child of v) {
        if (child !== null && typeof child === 'object') stack.push({ v: child, depth: depth + 1 });
      }
      continue;
    }
    // for..in + hasOwn: Object.keys gibi butun anahtar dizisini once kurmaz
    for (const key in v) {
      if (!Object.prototype.hasOwnProperty.call(v, key)) continue;
      if (++nodes > budget.maxNodes) return 'nodes';
      const child = (v as Record<string, unknown>)[key];
      if (child !== null && typeof child === 'object') stack.push({ v: child, depth: depth + 1 });
    }
  }
  return null;
}

const QUOTE = 0x22; // "
const BACKSLASH = 0x5c; // \
const OPEN_BRACE = 0x7b; // {
const OPEN_BRACKET = 0x5b; // [
const COMMA = 0x2c; // ,
const COLON = 0x3a; // :

/**
 * Ham JSON govdesinin YAPI sayisi: metinlerin ("...") DISINDA kalan '{', '[',
 * ',' ve ':' isaretleri. `stopAbove` asilinca sayim durur ve o ana kadarki
 * deger doner; yogun govdede tum tamponu gezmeye gerek kalmaz.
 *
 * NEDEN (inceleme S1): yukaridaki oge butcesi govde AYRISTIRILDIKTAN sonra
 * calisir; o anda JSON.parse nesne agacini coktan kurmustur. 2 MiB'lik
 * [{},{},...] tek seferde ~700 bin nesne eder (olcum: ~43 MB heap, ~100 MB
 * RSS); saniyede tek istek bile API surecinin RSS'ini PM2'nin 800 MB yeniden
 * baslatma sinirinin ustune tasiyordu. Bu sayim ham baytlar uzerinde,
 * JSON.parse'tan ONCE calisir (request-body.ts verifyLargeJsonBody).
 *
 * NEDEN DORT ISARET: JSON.parse'in kurdugu her deger ya kok, ya bir kap
 * ('{' / '['), ya da '[', ',' veya ':' ardindan gelen bir oge, anahtar ya da
 * deger. Yani kurulan deger sayisi en fazla 2 x (bu sayi) + 1. Yalniz '{' ve
 * '[' saymak yetmezdi: tek nesnede ~230 bin anahtar ya da [0,0,...] dizisi de
 * ayni 2 MiB'te 10-20 MB heap / 30-40 MB RSS tutuyor (olcum).
 *
 * DOGRULUK: tampon UTF-8 olmali (cagiran garanti eder). UTF-8'de cok baytli
 * bir karakterin hicbir bayti 0x80'in altina inmez; ham bayttaki '"', '\',
 * '{' ... her zaman gercek ASCII karakterdir. Metin icinde '\' sonraki
 * karakteri kacislar (\" metni bitirmez, \\ tek ters bolu); \uXXXX'in
 * onaltilik hanelerinde '"' olamaz. Gecerli bir JSON onekinde "metin icinde
 * mi" durumu JSON.parse'inkiyle birebir aynidir. Gecersiz govdede JSON.parse
 * ilk hatada durur, bu sayim ise devam eder ve en fazla FAZLA sayar; yani
 * JSON.parse'in kurabilecegi degerleri hicbir zaman eksik saymaz.
 */
export function jsonStructureCount(buf: Uint8Array, stopAbove: number = Number.POSITIVE_INFINITY): number {
  let count = 0;
  let inString = false;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (inString) {
      if (c === BACKSLASH) i++;
      else if (c === QUOTE) inString = false;
      continue;
    }
    if (c === QUOTE) {
      inString = true;
    } else if (c === OPEN_BRACE || c === OPEN_BRACKET || c === COMMA || c === COLON) {
      if (++count > stopAbove) return count;
    }
  }
  return count;
}

/**
 * Express ara katmani: ayristirilmis govde (req.body) butceyi asarsa istek
 * guard'lara ve pipe'a hic ulasmaz. Oge sayisi -> 413 (icerik islenebilecek
 * olandan buyuk, RFC 9110 15.5.14), derinlik -> 400. Hata Nest istisnasi
 * olarak next()'e verilir; global filtre onu oldugu gibi yazar ve ara katman
 * CORS'tan SONRA kuruldugu icin cevap CORS basliklarini tasir.
 *
 * `budgetFor` istege gore butce secer (main.ts: herkese acik persona sohbeti
 * daha dar butce alir, request-body.ts PERSONA_CHAT_JSON_BODY_BUDGET).
 *
 * Multipart govdeler (multer) burada henuz ayristirilmamistir; onlarin
 * siniri FileInterceptor ayarlarindadir.
 */
export function createJsonBodyBudgetMiddleware<R extends object>(
  budgetFor: (req: R) => JsonBodyBudget = () => DEFAULT_JSON_BODY_BUDGET,
) {
  return function jsonBodyBudget(req: R, _res: unknown, next: (err?: unknown) => void): void {
    const budget = budgetFor(req);
    const violation = jsonBudgetViolation((req as { body?: unknown }).body, budget);
    if (violation === 'nodes') {
      next(new PayloadTooLargeException(jsonBodyTooManyNodesMessage(budget.maxNodes)));
      return;
    }
    if (violation === 'depth') {
      next(new BadRequestException(jsonBodyTooDeepMessage(budget.maxDepth)));
      return;
    }
    next();
  };
}

/** Her istege varsayilan butceyi uygulayan ara katman */
export const jsonBodyBudgetMiddleware = createJsonBodyBudgetMiddleware();
