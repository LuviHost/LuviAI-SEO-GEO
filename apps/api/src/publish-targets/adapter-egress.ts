import { isIP } from 'node:net';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { Logger } from '@nestjs/common';
import { Agent, fetch as undiciFetch } from 'undici';
// Ad alani importu BILEREK (bkz. registerAdapterEgressGuard)
import * as adapters from '@luviai/adapters';
import type { AdapterFetch, AdapterHostResolver } from '@luviai/adapters';
import { guardedConnectOptions, ipv4OnlyFromEnv, isBlockedAddress } from '../common/safe-fetch.js';

/**
 * Yayin hedefi adaptorlerinin (packages/adapters) korumali ag erisimi.
 *
 * NEDEN: publishTargetBlockReason / assertPublishTargetSafe yalniz kayitli
 * adresin o an nereye cozuldugune bakar. Adaptorler ise global fetch'i
 * varsayilan redirect:'follow' ile kullaniyordu (20 adima kadar; 307/308'de
 * yontem ve govde korunur): denetimi gecen bir site istegi 127.0.0.1:3001'e
 * ya da ic aga yonlendirebiliyordu, adaptor oradan donen govdeyi hata metnine
 * koyup kullaniciya gosteriyordu. FTP/SFTP de adi baglanti aninda yeniden
 * cozuyordu (DNS rebinding).
 *
 * Katmanlar (API ve worker acilista kaydeder: PublishTargetsModule):
 *  1. Her baglanti korumali ajandan gecer: alan adi BAGLANTI ANINDA cozulur ve
 *     cozulen her adres denetlenir (connect.lookup) — denetlenen adres ile
 *     baglanilan adres aynidir, rebinding araligi yok.
 *  2. Yazili IP (Node DNS'e gitmez, lookup cagrilmaz) her istekten ONCE
 *     denetlenir.
 *  3. Yonlendirmeler elle izlenir (en fazla 5). Her Location bastan
 *     denetlenir: yalniz http/https, kimlik bilgisi yok, IP ise engel
 *     listesi, alan adiysa simdi cozulup denetlenir.
 *  4. Govde (POST/PUT...) yalniz AYNI kokene 307/308 ile yeniden gonderilir.
 *     Baska kokene 307/308 ile ve 301/302 ile govdeli istek IZLENMEZ: 3xx
 *     yaniti adaptore aynen doner, adaptor "yonlendiriyor, adresi guncelleyin"
 *     der. Fetch standardi 301/302'de istegi govdesiz GET'e cevirir; yayin
 *     istegi sessizce bir listeleme istegine donusur ve adaptor 200'u
 *     "yayinlandi" sanardi (yanlis basari). 303 ise "istek islendi, sonuc
 *     orada" demektir (RFC 9110 15.4.4): govdesiz GET ile izlenir.
 *  5. Baska kokene gecen adimda kimlik tasiyan basliklar (Authorization,
 *     Cookie, X-Shopify-Access-Token...) gonderilmez; yalniz zararsiz
 *     basliklar kalir.
 *  6. Baglanti hatasi mesaji cozulen ic adresi tasimaz.
 *  7. FTP/SFTP: ad simdi cozulur, denetlenir, DENETLENEN IP'ye baglanilir
 *     (makeGuardedHostResolver); FTP veri baglantisi da kontrol adresine
 *     gider (ftp.ts).
 *
 * PORT kisitlanmaz (publish-target-url.ts ile ayni gerekce: cPanel 2083,
 * Strapi 1337...). Tehlikeli portlari fetch zaten reddeder (undici "bad port").
 * TLS dogrulamasi acik (varsayilan).
 */

/** Izlenen en fazla yonlendirme */
export const ADAPTER_MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Baska kokene gecen adimda tasinan basliklar — hicbiri kimlik tasimaz */
const CROSS_ORIGIN_SAFE_HEADERS = new Set(['accept', 'accept-language', 'accept-version', 'user-agent', 'cache-control', 'pragma']);

/** Govde dusunce silinir (Fetch standardi: request-body-header name) */
const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location'];

/**
 * Adaptor User-Agent vermediyse gonderilen deger. Global fetch (Node'un
 * gomulu undici'si) 'node' gonderir; burada paket undici'si kullanildigi icin
 * varsayilan 'undici' olurdu. Musteri sunucularindaki WAF kurallari bugune
 * kadar 'node' gordu — istek degismesin.
 */
const DEFAULT_USER_AGENT = 'node';

export type AdapterEgressCode = 'blocked_address' | 'protocol' | 'redirect' | 'dns';

/** Mesaj yayin sonucunda kullaniciya aynen gosterilir — Turkce, ic adres yok. */
export class AdapterEgressError extends Error {
  constructor(public readonly code: AdapterEgressCode, message: string) {
    super(message);
    this.name = 'AdapterEgressError';
  }
}

/** Uretim: varsayilanlar. Test: yerel sunucuya baglanmak icin gevsetilebilir. */
export interface AdapterEgressPolicy {
  isBlocked?: (ip: string) => boolean;
  /** Alan adini cozer (yonlendirme adresi, FTP/SFTP sunucusu). Test enjekte eder. */
  resolveHost?: (host: string) => Promise<string[]>;
  maxRedirects?: number;
  /** Varsayilan: SAFE_FETCH_IPV4_ONLY (safe-fetch.ts ipv4OnlyFromEnv) */
  ipv4Only?: boolean;
}

function lookupAll(host: string, ipv4Only: boolean): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { all: true, ...(ipv4Only ? { family: 4 } : {}) }, (err, addresses) => {
      if (err) return reject(err);
      resolve((addresses as unknown as LookupAddress[]).map((a) => a.address));
    });
  });
}

function bareHost(u: URL): string {
  return u.hostname.replace(/^\[|\]$/g, '');
}

function blockedRedirect(): AdapterEgressError {
  return new AdapterEgressError('blocked_address', 'Yayın hedefi isteği özel veya iç ağ adresine yönlendirdi; istek gönderilmedi.');
}

/**
 * URL'yi istek atmadan denetler. Ilk istekte alan adi cozulmez (baglanti
 * anindaki korumali lookup yeterli ve kesin); yonlendirmede simdi cozulur ki
 * hata erken ve anlasilir olsun.
 */
async function assertTarget(
  u: URL,
  kind: 'initial' | 'redirect',
  isBlocked: (ip: string) => boolean,
  resolveHost: (host: string) => Promise<string[]>,
): Promise<void> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new AdapterEgressError('protocol', kind === 'redirect'
      ? 'Yayın hedefi isteği http/https dışı bir adrese yönlendirdi; izlenmedi.'
      : 'Yayın hedefi adresi http:// veya https:// ile başlamalı.');
  }
  if (u.username || u.password) {
    throw new AdapterEgressError('protocol', kind === 'redirect'
      ? 'Yayın hedefi isteği kimlik bilgisi içeren bir adrese yönlendirdi; izlenmedi.'
      : 'Yayın hedefi adresi kullanıcı adı veya parola içeremez.');
  }
  const host = bareHost(u);
  if (isIP(host)) {
    if (isBlocked(host)) {
      throw kind === 'redirect'
        ? blockedRedirect()
        : new AdapterEgressError('blocked_address', 'Yayın hedefi adresi özel veya iç ağ adresi; bağlantı kurulmadı.');
    }
    return;
  }
  if (kind === 'initial') return;
  let addrs: string[];
  try {
    addrs = await resolveHost(host);
  } catch {
    throw new AdapterEgressError('dns', `Yayın hedefinin yönlendirdiği adres çözülemedi: ${host}`);
  }
  if (addrs.length === 0 || addrs.some((a) => isBlocked(a))) throw blockedRedirect();
}

function headerRecord(h: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
  } else if (typeof (h as Headers).forEach === 'function') {
    (h as Headers).forEach((v, k) => { out[k.toLowerCase()] = v; });
  } else {
    for (const [k, v] of Object.entries(h as Record<string, string>)) out[k.toLowerCase()] = String(v);
  }
  return out;
}

function pick(headers: Record<string, string>, keep: (name: string) => boolean): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => keep(k)));
}

/** Ayni govde tekrar gonderilebilir mi (akis tek kullanimlik) */
function replayable(body: unknown): boolean {
  if (typeof body === 'string' || body instanceof URLSearchParams) return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  return false;
}

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

/** undici 'fetch failed' altinda: korumali lookup reddetti mi */
function isBlockedConnect(err: any): boolean {
  const cause = err?.cause;
  return cause?.code === 'EBLOCKEDADDR' || err?.code === 'EBLOCKEDADDR'
    || /ENGELLI_ADRES/.test(String(cause?.message ?? '')) || /ENGELLI_ADRES/.test(String(err?.message ?? ''));
}

/**
 * Korumali fetch. Testte yerel sunucuya baglanabilmek icin adres denetimi
 * enjekte edilebilir; URETIMDE yalnizca varsayilan (isBlockedAddress) ile
 * kullanilir (registerAdapterEgressGuard).
 */
export function makeGuardedAdapterFetch(policy: AdapterEgressPolicy = {}): AdapterFetch {
  const isBlocked = policy.isBlocked ?? isBlockedAddress;
  const ipv4Only = policy.ipv4Only ?? ipv4OnlyFromEnv();
  const resolveHost = policy.resolveHost ?? ((h: string) => lookupAll(h, ipv4Only));
  const maxRedirects = policy.maxRedirects ?? ADAPTER_MAX_REDIRECTS;
  // Okuma zaman asimlari undici varsayilaninda (300 sn): yavas paylasimli
  // hostinglerde WP medya yuklemesi uzun surebilir, eski global ajanla ayni.
  const dispatcher = new Agent({ connect: guardedConnectOptions(isBlocked, { timeoutMs: 10_000, ipv4Only }) });

  return async function guardedAdapterFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const mode = init.redirect ?? 'follow';
    let url: URL;
    try {
      url = new URL(String(input));
    } catch {
      throw new AdapterEgressError('protocol', 'Yayın hedefi adresi geçersiz.');
    }
    await assertTarget(url, 'initial', isBlocked, resolveHost);

    let method = (init.method ?? 'GET').toUpperCase();
    let body = init.body ?? null;
    let headers = headerRecord(init.headers);
    if (!headers['user-agent']) headers['user-agent'] = DEFAULT_USER_AGENT;

    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        // dispatcher EN SONDA: adaptor kendi ajanini verse de korumali ajan kullanilir
        res = (await undiciFetch(url, { ...init, method, headers, body, redirect: 'manual', dispatcher } as any)) as unknown as Response;
      } catch (err) {
        if (isBlockedConnect(err)) {
          throw new AdapterEgressError('blocked_address', `Yayın hedefinin adresi (${url.hostname}) özel veya iç ağ adresine çıkıyor; bağlantı kurulmadı.`);
        }
        throw err;
      }

      if (mode === 'manual' || !REDIRECT_STATUSES.has(res.status)) return res;
      const location = res.headers.get('location');
      if (!location) return res;
      if (mode === 'error') {
        await discard(res);
        throw new AdapterEgressError('redirect', 'Yayın hedefi isteği yönlendirdi; bu istekte yönlendirme izlenmez.');
      }

      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return res; // gecersiz Location: izlenmez, adaptor 3xx'i gorur
      }
      const sameOrigin = next.origin === url.origin;
      const status = res.status;

      if (status === 303) {
        // Sunucu istegi ISLEDI, sonucu baska adreste gosteriyor (RFC 9110
        // 15.4.4): GET ile izlenir, govde tasinmaz.
        if (method !== 'HEAD') {
          method = 'GET';
          body = null;
          headers = pick(headers, (k) => !BODY_HEADERS.includes(k));
        }
      } else if (status === 301 || status === 302) {
        // "Tasindi": govdeli istek ISLENMEDI. GET'e cevirip izlemek yayini
        // listeleme istegine dondurur (yanlis basari) — 3xx aynen doner.
        if (body !== null) return res;
        if (method === 'POST') {
          method = 'GET';
          headers = pick(headers, (k) => !BODY_HEADERS.includes(k));
        }
      } else if (body !== null && !(sameOrigin && replayable(body))) {
        // 307/308: govde yalniz AYNI kokene yeniden gonderilir
        return res;
      }

      if (hop >= maxRedirects) {
        await discard(res);
        throw new AdapterEgressError('redirect', `Yayın hedefi çok fazla yönlendirme yaptı (en fazla ${maxRedirects} izlenir).`);
      }
      await assertTarget(next, 'redirect', isBlocked, resolveHost);
      await discard(res);
      if (!sameOrigin) headers = pick(headers, (k) => CROSS_ORIGIN_SAFE_HEADERS.has(k));
      url = next;
    }
  };
}

/**
 * FTP/SFTP icin: adi simdi cozer, TUM adresleri denetler, baglanilacak IP'yi
 * doner (IPv4 sabitlemesi aciksa ilk A kaydi). Yazili IP aynen denetlenir.
 */
export function makeGuardedHostResolver(policy: AdapterEgressPolicy = {}): AdapterHostResolver {
  const isBlocked = policy.isBlocked ?? isBlockedAddress;
  const ipv4Only = policy.ipv4Only ?? ipv4OnlyFromEnv();
  const resolveHost = policy.resolveHost ?? ((h: string) => lookupAll(h, ipv4Only));

  return async function guardedHostResolver(raw: string): Promise<string> {
    const host = String(raw ?? '').trim().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    if (!host) throw new AdapterEgressError('dns', 'Yayın hedefinin sunucu adı boş.');
    if (isIP(host)) {
      if (isBlocked(host)) throw new AdapterEgressError('blocked_address', 'Yayın hedefinin sunucu adresi özel veya iç ağ adresi; bağlantı kurulmadı.');
      return host;
    }
    let addrs: string[];
    try {
      addrs = await resolveHost(host);
    } catch {
      throw new AdapterEgressError('dns', `Yayın hedefinin sunucu adı çözülemedi: ${host}`);
    }
    if (addrs.length === 0) throw new AdapterEgressError('dns', `Yayın hedefinin sunucu adı çözülemedi: ${host}`);
    if (addrs.some((a) => isBlocked(a))) {
      throw new AdapterEgressError('blocked_address', `Yayın hedefinin sunucu adı (${host}) özel veya iç ağ adresine çıkıyor; bağlantı kurulmadı.`);
    }
    return addrs[0];
  };
}

const log = new Logger('AdapterEgress');
let productionFetch: AdapterFetch | null = null;
let productionResolver: AdapterHostResolver | null = null;

/**
 * Uretim kaydi — API ve worker ayni AppModule'u kurar, PublishTargetsModule
 * acilista cagirir. Tekrar cagrilabilir (ayni ajan; test sifirladiysa yeniden
 * kaydeder). Kaydedildiyse true.
 *
 * NEDEN ad alani importu: @luviai/adapters dist'ten yuklenir ve deploy'da ayri
 * derlenir. Paket derlemesi eski kalirsa adlandirilmis import ESM baglantisinda
 * SyntaxError atar ve API'yi de worker'i da (api/dist'i yukler) acilista
 * dusururdu. Boyle eski pakette tip denetimi derlemede yine hata verir;
 * calisma aninda ise servis ayakta kalir ve eksik koruma yuksek sesle loglanir.
 */
export function registerAdapterEgressGuard(): boolean {
  if (typeof adapters.setAdapterFetch !== 'function' || typeof adapters.setAdapterHostResolver !== 'function') {
    log.error('packages/adapters derlemesi eski: yayin hedefi ag korumasi KAYDEDILEMEDI (yonlendirme/ic adres denetimi yok). '
      + 'Deploy: cd packages/adapters && pnpm build; ardindan api + worker derlenip yeniden baslatilmali.');
    return false;
  }
  productionFetch ??= makeGuardedAdapterFetch();
  productionResolver ??= makeGuardedHostResolver();
  adapters.setAdapterFetch(productionFetch);
  adapters.setAdapterHostResolver(productionResolver);
  return true;
}
