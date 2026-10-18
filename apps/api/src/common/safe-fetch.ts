import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { pipeline, Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate, constants as zlibConstants } from 'node:zlib';
import { Agent, request } from 'undici';

/**
 * Kullanicinin verdigi (ya da taranan sayfadan gelen) URL'den ikili veri
 * indirme — SSRF korumali.
 *
 * NEDEN: gorsel alt metni onerisi icin musteri sayfasindaki <img src> indirilir.
 * src'yi sayfanin sahibi yazar: http://169.254.169.254/ (bulut metadata),
 * http://localhost:3001/... ya da ic agdaki bir adres olabilir.
 *
 * Koruma katmanlari:
 *  1. Yalnizca http/https, yalnizca 80/443 (port taramasi yok).
 *  2. IP adresi DOGRUDAN yazilmissa (Node bu durumda DNS'e gitmez) baglanmadan
 *     once kontrol edilir.
 *  3. Alan adlari BAGLANTI ANINDA cozulur ve cozulen adres kontrol edilir
 *     (undici connect.lookup) — kontrol edilen adres ile baglanilan adres
 *     ayni oldugu icin DNS rebinding ile atlatilamaz.
 *  4. Yonlendirmeler elle izlenir (en fazla 3), her adim bastan denetlenir.
 *  5. Govde akis halinde okunur; boyut tavani asilinca kesilir. Zaman asimi.
 *  6. Baglantilar main.ts'teki genel dagitici gibi IPv4'e sabittir (bkz.
 *     ipv4OnlyFromEnv) — bu dosyadaki ajanlar o dagiticiyi kullanmaz.
 */

/**
 * Durust bot kimligi. Tarayici TAKLIDI YAPMAYIZ: site sahibi bizi bu adla
 * tanir, robots.txt ya da WAF kuraliyla izin verir veya engeller.
 * Aciklama sayfasi: https://ranksup.ai/bot
 */
export const RANKSUP_BOT_UA = 'Mozilla/5.0 (compatible; RanksUpBot/1.0; +https://ranksup.ai/bot)';

const BLOCK = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCK.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['64:ff9b::', 96], ['2001:db8::', 32], ['100::', 64],
] as const) BLOCK.addSubnet(net, prefix, 'ipv6');

/**
 * IPv4'u icine gomen ya da kullanimdan kalkmis IPv6 bicimleri (RFC 6890 ozel
 * amacli liste). Bir saldirgan AAAA kaydina ::7f00:1 yazarak IPv4 kurallarini
 * dolanmaya calisabilir; duzgun bir web sitesi bu araliklarda yayin yapmaz.
 *
 * Bunlar BlockList'e KONMAZ, elle denetlenir: Node'un BlockList'i IPv4
 * adreslerini IPv6 kurallariyla da eslestiriyor (::/96 eklenince 8.8.8.8 de
 * engellendi) ve ::ffff:0:0/96 alt agini IPv4-cevrilmis adreslerde
 * yakalamiyor (Node 22'de denendi).
 */
const IPV6_EMBEDDED: Array<[number[], number]> = [
  [[0, 0, 0, 0, 0, 0, 0, 0], 96],          // IPv4-uyumlu ::a.b.c.d (RFC 4291)
  [[0, 0, 0, 0, 0xffff, 0, 0, 0], 96],     // IPv4-cevrilmis ::ffff:0:a.b.c.d (SIIT)
  [[0x64, 0xff9b, 1, 0, 0, 0, 0, 0], 48],  // yerel NAT64 (RFC 8215)
  [[0x2002, 0, 0, 0, 0, 0, 0, 0], 16],     // 6to4, gomulu IPv4 (RFC 7526)
  [[0x2001, 0, 0, 0, 0, 0, 0, 0], 23],     // IETF protokol atamalari: Teredo, ORCHID, benchmark
  [[0xfec0, 0, 0, 0, 0, 0, 0, 0], 10],     // site-local (RFC 3879)
  [[0x3fff, 0, 0, 0, 0, 0, 0, 0], 20],     // dokumantasyon (RFC 9637)
];

/** IPv6 metnini 8 adet 16 bitlik gruba acar; gecersizse null (sonda IPv4 yazimi dahil). */
export function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  let v4: number[] = [];
  const m = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (m) {
    const o = m[2].split('.').map(Number);
    if (o.some((x) => x > 255)) return null;
    v4 = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    s = m[1].endsWith('::') ? m[1] : m[1].slice(0, -1);
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const need = 8 - v4.length;
  let groups: string[];
  if (parts.length === 1) {
    groups = head;
    if (groups.length !== need) return null;
  } else {
    const tail = parts[1] ? parts[1].split(':') : [];
    const fill = need - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  }
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN));
  if (nums.some(Number.isNaN)) return null;
  return [...nums, ...v4];
}

function inPrefix(h: number[], net: number[], len: number): boolean {
  let bits = len;
  for (let i = 0; i < 8 && bits > 0; i++) {
    const take = Math.min(16, bits);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if ((h[i] & mask) !== (net[i] & mask)) return false;
    bits -= take;
  }
  return true;
}

/** Ozel/ayrilmis adres mi? IPv4-esli IPv6 (::ffff:a.b.c.d) IPv4 kurallarina takilir. */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return BLOCK.check(ip, 'ipv4');
  if (v === 6) {
    if (BLOCK.check(ip, 'ipv6')) return true;
    const h = expandIPv6(ip);
    if (!h) return true; // cozumlenemeyen IPv6'ya guvenme
    return IPV6_EMBEDDED.some(([net, len]) => inPrefix(h, net, len));
  }
  return true; // IP degilse guvenme
}

export type SafeFetchErrorCode =
  | 'protocol' | 'port' | 'blocked_address' | 'redirect' | 'too_large' | 'http'
  | 'content_type' | 'timeout' | 'dns' | 'network'
  /**
   * 2xx yanitin govdesi cozulemedi: desteklenmeyen Content-Encoding (zstd,
   * compress...) ya da bozuk sikistirma. Sayfa OKUNAMADI demektir — gurultu
   * metin diye donup puanlanmaz (bkz. fetchTextGuarded).
   */
  | 'content_encoding';

export class SafeFetchError extends Error {
  constructor(public readonly code: SafeFetchErrorCode, message: string) {
    super(message);
  }
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
type IsBlocked = (ip: string) => boolean;

/** Uretim: varsayilanlar. Test: yerel sunucuya baglanmak icin gevsetilebilir. */
export interface SafeFetchPolicy {
  isBlocked?: IsBlocked;
  /** Yalnizca test — uretimde 80/443 disi port YASAK */
  allowAnyPort?: boolean;
  /** Varsayilan: SAFE_FETCH_IPV4_ONLY (bkz. ipv4OnlyFromEnv). Yalnizca test bunu acikca verir. */
  ipv4Only?: boolean;
}

/** Baglanti anindaki DNS cozumu — engelli adrese cozulurse baglanti hic kurulmaz */
export function makeGuardedLookup(isBlocked: IsBlocked) {
  return function guardedLookup(hostname: string, options: any, cb: LookupCb): void {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err, []);
      // all:true ile her zaman dizi doner
      const list = addresses as unknown as LookupAddress[];
      const bad = list.find((a) => isBlocked(a.address));
      if (bad || list.length === 0) {
        const e: NodeJS.ErrnoException = new Error(`ENGELLI_ADRES ${hostname} -> ${bad?.address ?? 'yok'}`);
        e.code = 'EBLOCKEDADDR';
        return cb(e, []);
      }
      if (options?.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
  };
}

/**
 * Giden baglantilar IPv4'e sabit mi? Varsayilan EVET; yalniz
 * SAFE_FETCH_IPV4_ONLY=0 (ya da false/off/no) kapatir — calisan IPv6 yolu
 * olan bir sunucuya tasinirsa.
 *
 * NEDEN: uretim sunucusunda calisan bir IPv6 yolu yok. main.ts bu yuzden genel
 * undici dagiticisini connect.family=4 ile kuruyor (f048633: IPv6 denemeleri
 * ETIMEDOUT veriyordu). Bu dosyadaki korumali ajanlar, webhook ajani ve render
 * vekili o genel dagiticiyi KULLANMAZ. family verilmezse Node 22'nin
 * happy-eyeballs'i (autoSelectFamily) A ve AAAA kayitlarini sirayla dener;
 * IPv4 el sikismasi 250 ms'de bitmezse IPv6'ya gecer, IPv6 sunucuda takilir ve
 * ayakta olan site "ulasilamadi" gorunur.
 *
 * Deger surec basinda okunur (ajanlar modul yuklenirken kurulur); degistirmek
 * yeniden baslatma ister.
 */
export function ipv4OnlyFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.SAFE_FETCH_IPV4_ONLY ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

/**
 * Korumali baglanti secenekleri — undici `connect`, net.connect ve
 * http.request ayni bicimi kabul eder.
 *
 * family=4 iken Node guarded lookup'i family:4 ile cagirir: yalniz A kayitlari
 * cozulur, HEPSI denetlenir ve baglanilan adres denetlenenlerden biridir — SSRF
 * garantisi aynen kalir. (family yokken Node lookup'i all:true ile cagirir ve
 * A + AAAA listesinin tamamini dener.)
 */
export function guardedConnectOptions(
  isBlocked: IsBlocked,
  opts: { timeoutMs?: number; ipv4Only?: boolean } = {},
): { lookup: any; timeout?: number; family?: 4 } {
  return {
    lookup: makeGuardedLookup(isBlocked),
    ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
    ...((opts.ipv4Only ?? ipv4OnlyFromEnv()) ? { family: 4 as const } : {}),
  };
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Ornek: /^image\// — uymazsa govde indirilmeden reddedilir */
  accept?: RegExp;
}

export interface SafeFetchResult {
  url: string;
  contentType: string;
  body: Buffer;
}

function assertUrl(raw: string, isBlocked: IsBlocked, allowAnyPort: boolean): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SafeFetchError('protocol', `Gecersiz URL: ${raw.slice(0, 200)}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SafeFetchError('protocol', `Yalnizca http/https: ${u.protocol}`);
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (!allowAnyPort && port !== 80 && port !== 443) throw new SafeFetchError('port', `Izin verilmeyen port: ${port}`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlocked(host)) throw new SafeFetchError('blocked_address', `Ozel/ayrilmis adres: ${host}`);
  if (u.username || u.password) throw new SafeFetchError('protocol', 'URL kimlik bilgisi tasiyamaz');
  return u;
}

/**
 * Testte yerel sunucuya baglanabilmek icin adres denetimi enjekte edilebilir;
 * URETIMDE yalnizca varsayilan (isBlockedAddress) ile kullanilir.
 */
export function makeSafeFetch(policy: SafeFetchPolicy = {}) {
  const isBlocked = policy.isBlocked ?? isBlockedAddress;
  const allowAnyPort = policy.allowAnyPort === true;
  const agent = new Agent({
    connect: guardedConnectOptions(isBlocked, { timeoutMs: 10_000, ipv4Only: policy.ipv4Only }),
    headersTimeout: 10_000,
    bodyTimeout: 10_000,
  });
  return (rawUrl: string, opts: SafeFetchOptions = {}) => fetchGuarded(agent, isBlocked, allowAnyPort, rawUrl, opts);
}

/** Baglanti katmani hatasini tek bicime cevir — ic adres/IP bilgisi mesaja sizmaz. */
function toSafeFetchError(err: any, current: URL, deadline: AbortSignal): SafeFetchError {
  const code = err?.code ?? err?.cause?.code;
  if (code === 'EBLOCKEDADDR' || /ENGELLI_ADRES/.test(String(err?.message))) {
    return new SafeFetchError('blocked_address', `Ozel/ayrilmis adrese cozuldu: ${current.hostname}`);
  }
  if (deadline.aborted) return new SafeFetchError('timeout', 'Zaman asimi');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
    return new SafeFetchError('dns', `Alan adi cozulemedi: ${current.hostname}`);
  }
  return new SafeFetchError('network', String(err?.message ?? err).slice(0, 200));
}

async function fetchGuarded(agent: Agent, isBlocked: IsBlocked, allowAnyPort: boolean, rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  let current = assertUrl(rawUrl, isBlocked, allowAnyPort);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res;
    try {
      res = await request(current, {
        method: 'GET',
        dispatcher: agent,
        maxRedirections: 0,
        signal: deadline,
        headers: { 'user-agent': RANKSUP_BOT_UA, accept: 'image/*' },
      });
    } catch (err: any) {
      throw toSafeFetchError(err, current, deadline);
    }

    if (res.statusCode >= 300 && res.statusCode < 400) {
      const loc = res.headers.location;
      await res.body.dump().catch(() => {});
      if (!loc || hop === maxRedirects) throw new SafeFetchError('redirect', 'Cok fazla ya da hedefsiz yonlendirme');
      current = assertUrl(new URL(String(loc), current).toString(), isBlocked, allowAnyPort);
      continue;
    }
    if (res.statusCode !== 200) {
      await res.body.dump().catch(() => {});
      throw new SafeFetchError('http', `HTTP ${res.statusCode}`);
    }

    const contentType = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (opts.accept && !opts.accept.test(contentType)) {
      await res.body.dump().catch(() => {});
      throw new SafeFetchError('content_type', `Beklenmeyen icerik turu: ${contentType || 'yok'}`);
    }
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body.dump().catch(() => {});
      throw new SafeFetchError('too_large', `Dosya ${declared} bayt — sinir ${maxBytes}`);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > maxBytes) {
          res.body.destroy();
          throw new SafeFetchError('too_large', `Dosya ${maxBytes} bayt sinirini asti`);
        }
        chunks.push(chunk as Buffer);
      }
    } catch (err) {
      if (err instanceof SafeFetchError) throw err;
      if (deadline.aborted) throw new SafeFetchError('timeout', 'Zaman asimi');
      throw new SafeFetchError('network', String((err as any)?.message ?? err).slice(0, 200));
    }
    return { url: current.toString(), contentType, body: Buffer.concat(chunks) };
  }
  throw new SafeFetchError('redirect', 'Cok fazla yonlendirme');
}

/** Uretim ornegi — ozel/ayrilmis adreslere asla baglanmaz */
export const safeFetchBinary = makeSafeFetch();

// ─────────────────────────────────────────────────────────────────────────────
//  Metin (HTML / XML / JSON / robots.txt) cekme — tarama, denetim, tespit
// ─────────────────────────────────────────────────────────────────────────────


const DEFAULT_TEXT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
/** Bunlar disindaki icerik turlerinde (PDF, zip, video...) govde indirilmez */
const TEXT_TYPE = /(text\/|xml|json|javascript|xhtml)/i;

export interface SafeTextOptions {
  /**
   * POST yalnizca govdeli form/JSON istekleri icin. POST'ta yonlendirme
   * IZLENMEZ: 3xx yaniti oldugu gibi doner (ok=false) — izlenseydi govde
   * denetlenmemis bir adrese tasinabilirdi.
   */
  method?: 'GET' | 'HEAD' | 'POST';
  /** Yalnizca POST ile */
  body?: string | Buffer;
  /** Varsayilan RANKSUP_BOT_UA */
  userAgent?: string;
  accept?: string;
  /**
   * Kucuk harfe cevrilip varsayilanlarin USTUNE yazilir. Ornek: varsayilan
   * 'accept-encoding: gzip, deflate, br' yerine { 'accept-encoding': 'identity' }.
   */
  headers?: Record<string, string>;
  /**
   * Basarili (2xx) yanitta okunacak en fazla bayt — ACILMIS (Content-Encoding
   * cozulmus) govdenin bayti; kucuk bir gzip govdesi sinirsiz buyuyemez.
   * Asilinca KESILIR (hata degil), truncated=true. Varsayilan 2 MB.
   */
  maxBytes?: number;
  /**
   * 2xx disi yanitta okunacak en fazla (acilmis) bayt — WAF/engel sayfasini
   * tanimak icin gerekir (bkz. block-detect.ts). 0 → govde okunmaz. Varsayilan 64 KB.
   */
  errorBodyBytes?: number;
  /** Tum yonlendirmeler dahil toplam sure. Varsayilan 15 sn. */
  timeoutMs?: number;
  /** Varsayilan 5 */
  maxRedirects?: number;
  /** Metin disi icerikte govdeyi indirme (binary=true doner). Varsayilan true. */
  skipBinary?: boolean;
}

export interface SafeTextResult {
  status: number;
  /** 200-299 */
  ok: boolean;
  /** Yonlendirmeler izlendikten sonraki son adres */
  url: string;
  redirected: boolean;
  /** Parametresiz, kucuk harf: 'text/html' */
  contentType: string;
  /** Kucuk harf anahtarlar; tekrar eden basliklar ', ' ile birlesik */
  headers: Record<string, string>;
  text: string;
  /** Govde tavanda kesildi */
  truncated: boolean;
  /** Metin disi icerik — govde indirilmedi */
  binary: boolean;
}

function makeAgent(isBlocked: IsBlocked, timeoutMs: number, ipv4Only?: boolean): Agent {
  return new Agent({
    connect: guardedConnectOptions(isBlocked, { timeoutMs: 10_000, ipv4Only }),
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
}

// ─── Icerik kodlamasi (Content-Encoding) ─────────────────────────────────────

/**
 * Istekte ilan edilen ve cozulebilen kodlamalar.
 *
 * NEDEN: undici.request() — global fetch'in aksine — govdeyi ACMAZ. Eskiden
 * Accept-Encoding de gondermiyorduk; RFC 9110 12.5.3: "If no Accept-Encoding
 * header field is in the request, any content coding is considered acceptable
 * by the user agent." (https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.3)
 * Her zaman sikistiran sunucular (on-sikistirilmis S3 /
 * CloudFront nesneleri, nginx gzip_static always) gzip/br baytlari donduruyor,
 * bunlar metin diye cozulup ok=true ile donuyordu: tarayici baslik/meta/JSON-LD
 * bulamayip puan kiriyor, AXO dogrulayicilari robots.txt / llms.txt'yi gecersiz
 * sayiyordu. Artik ilan edip aciyoruz; tanimadigimiz kodlamada govde metin
 * gorunmuyorsa sayfa OKUNAMADI sayilir ('content_encoding').
 */
const TEXT_ACCEPT_ENCODING = 'gzip, deflate, br';
const DECODABLE = new Set(['gzip', 'x-gzip', 'deflate', 'br']);
/** Ic ice kodlama siniri — gercek sunucular tek kodlama kullanir; kotu niyetli bir zincir cozucu yigini actirmasin */
const MAX_CODINGS = 3;
/**
 * Gevsek cozum: kesik ya da sonu eksik akista hata yerine elde olani ver —
 * tarayicilar da boyle gosterir. main'deki eski yol olan undici fetch ayni
 * bayraklari kullanir (lib/web/fetch/index.js: "Always using Z_SYNC_FLUSH is
 * what cURL does."). Bozuk veri (yanlis baslik, gecersiz blok) yine hatadir.
 */
const ZLIB_LENIENT = { flush: zlibConstants.Z_SYNC_FLUSH, finishFlush: zlibConstants.Z_SYNC_FLUSH };
const BROTLI_LENIENT = { flush: zlibConstants.BROTLI_OPERATION_FLUSH, finishFlush: zlibConstants.BROTLI_OPERATION_FLUSH };
/** Sabit zlib basligi: CM=8 (deflate), 32 KB pencere, sozluk yok; (0x78 * 256 + 0x9c) % 31 === 0 */
const ZLIB_HEADER = Buffer.from([0x78, 0x9c]);

export type DecodePlan = { ok: true; order: string[] } | { ok: false; coding: string };

/**
 * Content-Encoding basligi → cozme sirasi. Kodlamalar uygulandiklari sirayla
 * yazilir, TERS sirayla cozulur (RFC 9110 8.4: "gzip, br" once br acilir).
 * 'identity' bir sey yapmaz, atlanir. Taninmayan kodlama ya da asiri uzun
 * zincir → ok:false (govde ham okunur; metin degilse 'content_encoding').
 */
export function planDecoding(header: string | undefined): DecodePlan {
  const codings = (header ?? '').toLowerCase().split(',').map((c) => c.trim()).filter((c) => c && c !== 'identity');
  if (codings.length > MAX_CODINGS) return { ok: false, coding: codings.join(', ') };
  const unknown = codings.find((c) => !DECODABLE.has(c));
  if (unknown) return { ok: false, coding: unknown };
  return { ok: true, order: codings.reverse() };
}

/**
 * HTTP "deflate" zlib sarmalidir (RFC 9110 8.4.1.2 → RFC 1950), ama RFC'nin de
 * not ettigi gibi "Some non-conformant implementations send the "deflate"
 * compressed data without the zlib wrapper." Ilk baytin dusuk 4 biti 8 ise zlib
 * basligidir (undici fetch de buna bakar); degilse akisin basina sabit bir zlib
 * basligi eklenir. Ham akista adler32 sonu yoktur — gevsek cozucu sonu aramaz.
 */
function rawDeflateShim(): Transform {
  let first = true;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (first && chunk.length > 0) {
        first = false;
        if ((chunk[0] & 0x0f) !== 0x08) this.push(ZLIB_HEADER);
      }
      cb(null, chunk);
    },
  });
}

function decodersFor(coding: string): Transform[] {
  if (coding === 'gzip' || coding === 'x-gzip') return [createGunzip(ZLIB_LENIENT)];
  if (coding === 'deflate') return [rawDeflateShim(), createInflate(ZLIB_LENIENT)];
  return [createBrotliDecompress(BROTLI_LENIENT)]; // 'br' — planDecoding baska kodlama birakmaz
}

/** Sikistirilmis bayt tavani asildi */
class WireCapError extends Error {}

/**
 * Ag'dan gelen (sikistirilmis) bayti sayar. Acilmis tavan tek basina yetmez:
 * bos blok / bos gzip uyesi yigini HIC cikti uretmeden sonsuza kadar
 * okunabilirdi. Gercek sikistirmada acilmis tavan cok once dolar.
 */
function wireCounter(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > limit) cb(new WireCapError(`Sikistirilmis govde ${limit} bayti asti`));
      else cb(null, chunk);
    },
  });
}

/**
 * Govdenin basi duz metin mi? Sikistirilmis / ikili veri yuksek entropilidir:
 * NUL ve diger kontrol baytlari bol cikar. HTML (utf-8, windows-1254,
 * iso-8859-9) bunlari tasimaz; sekme / satir sonu / sayfa sonu haric.
 */
export function looksLikeText(buf: Buffer): boolean {
  const n = Math.min(buf.length, 1024);
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0c && b !== 0x0d) ctrl++;
  }
  return ctrl * 100 <= n;
}

function flattenHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

/**
 * Govdeyi dogru karakter kumesiyle coz. Turkce siteler hala windows-1254 /
 * iso-8859-9 kullanabiliyor; hepsini utf-8 saymak basliktaki ş/ğ/ı'yi bozar
 * ve marka/baslik cikarimini yanlis yapar. Sira: Content-Type → <meta charset> → utf-8.
 */
function decodeText(buf: Buffer, rawContentType: string): string {
  let charset = /charset\s*=\s*"?([\w.:-]+)/i.exec(rawContentType)?.[1];
  if (!charset) {
    const head = buf.subarray(0, 4096).toString('latin1');
    charset = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  }
  if (charset && !/^utf-?8$/i.test(charset)) {
    try { return new TextDecoder(charset.toLowerCase()).decode(buf); } catch { /* bilinmeyen etiket → utf-8 */ }
  }
  return new TextDecoder('utf-8').decode(buf);
}

/**
 * Testte yerel sunucuya baglanabilmek icin adres denetimi enjekte edilebilir;
 * URETIMDE yalnizca varsayilan (isBlockedAddress) ile kullanilir.
 */
export function makeSafeTextFetch(policy: SafeFetchPolicy = {}) {
  const isBlocked = policy.isBlocked ?? isBlockedAddress;
  const allowAnyPort = policy.allowAnyPort === true;
  const agent = makeAgent(isBlocked, 30_000, policy.ipv4Only);
  return (rawUrl: string, opts: SafeTextOptions = {}) => fetchTextGuarded(agent, isBlocked, allowAnyPort, rawUrl, opts);
}

async function fetchTextGuarded(agent: Agent, isBlocked: IsBlocked, allowAnyPort: boolean, rawUrl: string, opts: SafeTextOptions): Promise<SafeTextResult> {
  const method = opts.method ?? 'GET';
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const errorBodyBytes = opts.errorBodyBytes ?? 64 * 1024;
  const maxRedirects = opts.maxRedirects ?? 5;
  const skipBinary = opts.skipBinary !== false;
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  const headers: Record<string, string> = {
    'user-agent': opts.userAgent ?? RANKSUP_BOT_UA,
    accept: opts.accept ?? DEFAULT_TEXT_ACCEPT,
    'accept-encoding': TEXT_ACCEPT_ENCODING,
  };
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;

  let current = assertUrl(rawUrl, isBlocked, allowAnyPort);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res;
    try {
      res = await request(current, {
        method, dispatcher: agent, maxRedirections: 0, signal: deadline, headers,
        body: method === 'POST' ? opts.body : undefined,
      });
    } catch (err: any) {
      throw toSafeFetchError(err, current, deadline);
    }

    const status = res.statusCode;
    const resHeaders = flattenHeaders(res.headers as Record<string, string | string[] | undefined>);

    if (method !== 'POST' && status >= 300 && status < 400 && status !== 304 && resHeaders.location) {
      await res.body.dump().catch(() => {});
      if (hop === maxRedirects) throw new SafeFetchError('redirect', 'Cok fazla yonlendirme');
      // Her adim bastan denetlenir: genel bir adres ic adrese yonlendiremez.
      current = assertUrl(new URL(resHeaders.location, current).toString(), isBlocked, allowAnyPort);
      continue;
    }

    const rawContentType = resHeaders['content-type'] ?? '';
    const contentType = rawContentType.split(';')[0].trim().toLowerCase();
    const ok = status >= 200 && status < 300;
    const base = { status, ok, url: current.toString(), redirected: hop > 0, contentType, headers: resHeaders };

    const cap = ok ? maxBytes : errorBodyBytes;
    const binary = skipBinary && !!contentType && !TEXT_TYPE.test(contentType);
    if (method === 'HEAD' || cap <= 0 || binary) {
      await res.body.dump().catch(() => {});
      return { ...base, text: '', truncated: false, binary: binary && method !== 'HEAD' };
    }

    // 204/304'te govde yoktur; 304 onbellekteki temsilin Content-Encoding'ini
    // tasiyabilir — cozulecek bir sey yok.
    const plan: DecodePlan = status === 204 || status === 304
      ? { ok: true, order: [] }
      : planDecoding(resHeaders['content-encoding']);
    // Taninmayan kodlama: Chromium govdeyi oldugu gibi gecirir ("Unknown
    // encoding type. Returns an empty vector to pass through raw response
    // body." — net/filter/filter_source_stream.cc GetContentEncodingTypes,
    // https://chromium.googlesource.com/chromium/src/+/HEAD/net/filter/filter_source_stream.cc,
    // 2026-10-18'de dogrulandi). PHP'deki yaygin "Content-Encoding: none"
    // hilesi gibi zararsiz degerlerde govde duz metindir ve sayfa tarayicida
    // calisir; onu reddetmek ayakta olan siteyi "okunamadi" gosterirdi. Bu
    // yuzden ham okunur ve ancak metin GORUNMUYORSA (zstd, compress... ikili
    // veri) reddedilir — gurultu yine sayfa diye donmez.
    const unknownCoding = plan.ok ? null : plan.coding.slice(0, 60);

    // Kodlanmis govde acilarak okunur. Acma TEMBELDIR: asagidaki dongu yalniz
    // istedigi kadar ceker, tavanda akis kesilir ve gerisi hic acilmaz —
    // sikistirma bombasi bellegi sisiremez. Hata, dongude kaynagina gore ayrilir.
    const decoders = plan.ok ? plan.order.flatMap(decodersFor) : [];
    let source: AsyncIterable<unknown> = res.body;
    let decodeFailed = false;
    if (decoders.length > 0) {
      // Hatayi ilk yayan akis kaynaktir; pipeline digerlerini AYNI hatayla
      // yok eder. Dinleyiciler pipeline'dan once eklendigi icin once calisir.
      let sourceFailed = false;
      res.body.once('error', () => { if (!decodeFailed) sourceFailed = true; });
      for (const d of decoders) d.once('error', () => { if (!sourceFailed) decodeFailed = true; });
      pipeline([res.body, wireCounter(cap * 2 + 64 * 1024), ...decoders], () => { /* hata for-await'e duser */ });
      source = decoders[decoders.length - 1];
    }

    // Akis okunurken tavanda kes: once tamamini indirip sonra kirpmak bellegi
    // zaten harcamis olur (bkz. fetch-capped.ts'teki uretim olcumleri).
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    try {
      for await (const chunk of source) {
        const buf = chunk as Buffer;
        const room = cap - size;
        if (buf.length >= room) {
          chunks.push(buf.subarray(0, room));
          size += room;
          truncated = buf.length > room;
          break;
        }
        chunks.push(buf);
        size += buf.length;
      }
    } catch (err: any) {
      if (err instanceof WireCapError || decodeFailed) {
        // Bozuk sikistirma ya da cikti uretmeyen girdi. Acilmis metin varsa
        // kesik say; hic yoksa 2xx'te okunamadi, 2xx disinda govdesiz don.
        if (chunks.length === 0) {
          if (ok) throw new SafeFetchError('content_encoding', `Sikistirilmis govde cozulemedi (${resHeaders['content-encoding'] ?? ''})`.slice(0, 120));
          return { ...base, text: '', truncated: false, binary: false };
        }
        truncated = true;
      } else {
        if (deadline.aborted && chunks.length === 0) throw new SafeFetchError('timeout', 'Zaman asimi');
        if (chunks.length === 0) throw toSafeFetchError(err, current, deadline);
        truncated = true; // yarida kesilen govde — elde olani don
      }
    } finally {
      if (!res.body.destroyed) res.body.destroy();
      for (const d of decoders) if (!d.destroyed) d.destroy();
    }
    if (!truncated && size >= cap) truncated = true;
    const body = Buffer.concat(chunks);
    if (unknownCoding !== null && !looksLikeText(body)) {
      // 2xx'te cozulemeyen bayt "sayfa" diye donmez: okunamadi. 2xx disinda
      // durum ve basliklar engel tespitine yeter (block-detect.ts), govde bos.
      if (ok) throw new SafeFetchError('content_encoding', `Desteklenmeyen icerik kodlamasi: ${unknownCoding}`);
      return { ...base, text: '', truncated: false, binary: false };
    }
    return { ...base, text: decodeText(body, rawContentType), truncated, binary: false };
  }
  throw new SafeFetchError('redirect', 'Cok fazla yonlendirme');
}

/**
 * Uretim ornegi — ozel/ayrilmis adreslere asla baglanmaz. HTTP durum kodunda
 * HATA ATMAZ (status/ok doner); protokol/port/ic adres/zaman asimi/ag
 * hatasinda ve 2xx govdesi cozulemediginde ('content_encoding') SafeFetchError
 * atar. gzip / deflate / br govdeler acilmis olarak doner.
 */
export const safeFetchText = makeSafeTextFetch();

// ─────────────────────────────────────────────────────────────────────────────
//  Kayit aninda adres denetimi (site / yayin hedefi eklerken)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kullanicinin kaydettigi adresi baglanmadan denetler: http/https, 80/443,
 * kimlik bilgisi yok, ozel IP yazilmamis. Hata: SafeFetchError.
 */
export function assertPublicUrl(raw: string): URL {
  return assertUrl(raw, isBlockedAddress, false);
}

/**
 * Alan adini simdi cozer; ozel/ayrilmis bir adrese cozuluyorsa reddeder.
 * Kayit aninda kullaniciya erken ve anlasilir hata vermek icindir — asil
 * koruma her istekte baglanti anindaki denetimdir (DNS sonradan degisebilir).
 */
export async function assertResolvesPublic(raw: string): Promise<URL> {
  const u = assertPublicUrl(raw);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return u;
  const lookup = makeGuardedLookup(isBlockedAddress);
  await new Promise<void>((resolve, reject) => {
    lookup(host, { all: true }, (err) => {
      if (!err) return resolve();
      if (err.code === 'EBLOCKEDADDR') return reject(new SafeFetchError('blocked_address', `Ozel/ayrilmis adrese cozuluyor: ${host}`));
      return reject(new SafeFetchError('dns', `Alan adi cozulemedi: ${host}`));
    });
  });
  return u;
}
