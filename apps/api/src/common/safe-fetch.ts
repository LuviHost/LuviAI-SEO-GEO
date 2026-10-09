import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
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
 */

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

/** Ozel/ayrilmis adres mi? IPv4-esli IPv6 (::ffff:a.b.c.d) IPv4 kurallarina takilir. */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return BLOCK.check(ip, 'ipv4');
  if (v === 6) return BLOCK.check(ip, 'ipv6');
  return true; // IP degilse guvenme
}

export class SafeFetchError extends Error {
  constructor(public readonly code: 'protocol' | 'port' | 'blocked_address' | 'redirect' | 'too_large' | 'http' | 'content_type' | 'timeout' | 'network', message: string) {
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
    connect: { lookup: makeGuardedLookup(isBlocked) as any, timeout: 10_000 },
    headersTimeout: 10_000,
    bodyTimeout: 10_000,
  });
  return (rawUrl: string, opts: SafeFetchOptions = {}) => fetchGuarded(agent, isBlocked, allowAnyPort, rawUrl, opts);
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
        headers: { 'user-agent': 'RanksUp-ImageAlt/1.0 (+https://ranksup.ai)', accept: 'image/*' },
      });
    } catch (err: any) {
      if (err?.code === 'EBLOCKEDADDR' || err?.cause?.code === 'EBLOCKEDADDR' || /ENGELLI_ADRES/.test(String(err?.message))) {
        throw new SafeFetchError('blocked_address', `Ozel/ayrilmis adrese cozuldu: ${current.hostname}`);
      }
      if (deadline.aborted) throw new SafeFetchError('timeout', 'Zaman asimi');
      throw new SafeFetchError('network', String(err?.message ?? err).slice(0, 200));
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
