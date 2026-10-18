import http from 'node:http';
import net, { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import { guardedConnectOptions, isBlockedAddress } from '../common/safe-fetch.js';

/**
 * Headless Chrome icin denetimli vekil sunucu (forward proxy).
 *
 * NEDEN VAR: Chrome sayfayi render ederken kendi isteklerini atar: yonlendirmeleri
 * izler, alt kaynaklari (script, fetch, iframe, gorsel) indirir, sayfanin JS'i
 * location.href ile baska adrese gecebilir. Yalnizca ilk adresi denetlemek
 * (assertResolvesPublic) bunlarin hicbirini kapsamaz: herkese acik bir sayfa
 * 302 ya da JS ile http://169.254.169.254/ (bulut metadata) veya
 * http://127.0.0.1:3001/ (kendi API'miz) adresine gecebilir ve --dump-dom o
 * sayfanin icerigini bize geri verirdi.
 *
 * Cozum: Chrome'un TUM trafigi bu vekilden gecer ve vekil her baglantida hedefi
 * safe-fetch ile ayni kuralla denetler:
 *   - yalnizca 80 ve 443 portlari
 *   - yazili IP ise ozel/ayrilmis adres reddi
 *   - alan adi BAGLANTI ANINDA cozulur, ozel adrese cikiyorsa baglanti kurulmaz
 *     (makeGuardedLookup — denetlenen ile baglanilan adres ayni, DNS rebinding yok)
 *
 * Chrome HTTP vekili kullanirken ad cozumlemeyi vekile birakir; ancak localhost
 * ve link-local adresler varsayilan olarak vekili ATLAR. Bu yuzden Chrome
 * --proxy-bypass-list=<-loopback> ile baslatilir (bkz. page-renderer.ts).
 * Kaynak: https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md
 *         ve net/proxy_resolution/proxy_bypass_rules.cc
 *
 * Karsiya giden soketler de safe-fetch ile ayni IPv4 sabitlemesini kullanir
 * (SAFE_FETCH_IPV4_ONLY, bkz. ipv4OnlyFromEnv): uretimde IPv6 yolu yok; family
 * verilmezse Node happy-eyeballs ile AAAA kaydina gecip takiliyordu.
 */

export interface RenderProxyPolicy {
  /** Yalnizca test: yerel sunucuya izin vermek icin */
  isBlocked?: (ip: string) => boolean;
  /** Varsayilan: 80 ve 443 */
  allowPort?: (port: number) => boolean;
  /** Bosta kalan baglanti suresi (ms) */
  idleTimeoutMs?: number;
  /** Varsayilan: SAFE_FETCH_IPV4_ONLY (safe-fetch ipv4OnlyFromEnv). Yalnizca test acikca verir. */
  ipv4Only?: boolean;
}

export interface RenderProxy {
  readonly port: number;
  /** Reddedilen istek/tunel sayisi (log icin) */
  readonly rejected: number;
  close(): Promise<void>;
}

/** RFC 7230 6.1 — vekilin karsiya iletmemesi gereken baglanti basliklari */
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

function stripHopByHop(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = { ...headers };
  for (const h of HOP_BY_HOP) delete out[h];
  return out;
}

/** CONNECT hedefi "host:port" ya da "[v6]:port" */
function parseAuthority(raw: string): { host: string; port: number } | null {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(raw) ?? /^([^:]+):(\d+)$/.exec(raw);
  if (!m) return null;
  return { host: m[1].toLowerCase(), port: Number(m[2]) };
}

export async function startRenderProxy(policy: RenderProxyPolicy = {}): Promise<RenderProxy> {
  const isBlocked = policy.isBlocked ?? isBlockedAddress;
  const allowPort = policy.allowPort ?? ((p: number) => p === 80 || p === 443);
  const idleMs = policy.idleTimeoutMs ?? 20_000;
  // Korumali lookup + IPv4 sabitlemesi; http.request ve net.connect ayni secenekleri alir
  const { lookup, family } = guardedConnectOptions(isBlocked, { ipv4Only: policy.ipv4Only });
  const sockets = new Set<Duplex>();
  let rejected = 0;

  const track = (s: Duplex) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  };

  /** Alan adi burada gecer; asil denetim baglanti anindaki guarded lookup'ta */
  const targetAllowed = (host: string, port: number): boolean => {
    if (!Number.isInteger(port) || !allowPort(port)) return false;
    if (!host) return false;
    if (isIP(host)) return !isBlocked(host);
    return true;
  };

  const server = http.createServer((req, res) => {
    // Chrome duz HTTP istegini mutlak bicimde yollar: "GET http://host/yol"
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      rejected++;
      res.writeHead(400).end();
      return;
    }
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const port = target.port ? Number(target.port) : 80;
    if (target.protocol !== 'http:' || !targetAllowed(host, port)) {
      rejected++;
      res.writeHead(403).end();
      return;
    }
    const upstream = http.request(
      {
        host,
        port,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: stripHopByHop(req.headers),
        lookup,
        family,
        timeout: idleMs,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, stripHopByHop(up.headers));
        up.pipe(res);
      },
    );
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', (err: NodeJS.ErrnoException) => {
      if (err?.code === 'EBLOCKEDADDR') rejected++;
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  // HTTPS (ve wss) tunelleri: "CONNECT host:443"
  server.on('connect', (req: http.IncomingMessage, client: Duplex, head: Buffer) => {
    track(client);
    client.on('error', () => {});
    const auth = parseAuthority(req.url ?? '');
    if (!auth || !targetAllowed(auth.host, auth.port)) {
      rejected++;
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect({ host: auth.host, port: auth.port, lookup, family });
    track(upstream);
    upstream.setTimeout(idleMs, () => upstream.destroy());
    (client as net.Socket).setTimeout?.(idleMs, () => client.destroy());
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', (err: NodeJS.ErrnoException) => {
      if (err?.code === 'EBLOCKEDADDR') rejected++;
      if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
  });

  server.on('connection', (s: net.Socket) => track(s));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Yalnizca yerel arayuz: vekil disaridan kullanilamaz
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    get rejected() {
      return rejected;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
