import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net, { isIP, type AddressInfo } from 'node:net';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { startRenderProxy, type RenderProxy } from './render-proxy.js';
import { chromeArgs } from './page-renderer.service.js';

/**
 * Headless Chrome'un denetimli vekili.
 *
 * NEDEN VAR: ilk adresi denetlemek yetmez — Chrome yonlendirmeyi, alt
 * kaynaklari ve JS ile yapilan gecisleri kendisi izler. Herkese acik bir sayfa
 * 302 ya da location.href ile bulut metadata / kendi API'mize gecebilir ve
 * --dump-dom o icerigi bize geri verirdi. Chrome'un tum trafigi bu vekilden
 * gecer; vekil safe-fetch ile ayni kurali her baglantida uygular.
 * (Yerelde gercek Chrome ile de denendi: ic sunucuya 0 istek ulasti.)
 */

let upstream: http.Server;
let upPort = 0;
let gelen = 0;

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    gelen++;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`merhaba ${req.url}`);
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
  upPort = (upstream.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => upstream.close(() => r())));

/** Vekil uzerinden mutlak bicimli duz HTTP istegi (Chrome'un yaptigi gibi) */
function viaProxy(proxy: RenderProxy, target: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const hostHeader = /^https?:\/\//.test(target) ? new URL(target).host : 'ornek.com';
    const req = http.request({ host: '127.0.0.1', port: proxy.port, path: target, method: 'GET', headers: { host: hostHeader } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** CONNECT tuneli (HTTPS/wss icin) — yalnizca vekilin cevap kodu */
function connect(proxy: RenderProxy, authority: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path: authority });
    req.on('connect', (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 0); });
    req.on('response', (res) => { resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
}

describe('render vekili — uretim politikasi', () => {
  it('loopback, bulut metadata ve ic ag adresleri reddedilir; hedefe istek ulasmaz', async () => {
    const proxy = await startRenderProxy();
    try {
      const once = gelen;
      expect((await viaProxy(proxy, `http://127.0.0.1:${upPort}/gizli`)).status).toBe(403); // port 80/443 degil
      expect((await viaProxy(proxy, 'http://127.0.0.1/gizli')).status).toBe(403);
      expect((await viaProxy(proxy, 'http://169.254.169.254/latest/meta-data/')).status).toBe(403);
      expect((await viaProxy(proxy, 'http://[::1]/')).status).toBe(403);
      expect(await connect(proxy, '10.0.0.1:443')).toBe(403);
      expect(await connect(proxy, `127.0.0.1:${upPort}`)).toBe(403);
      expect(gelen, 'ic sunucuya istek ulasti').toBe(once);
      expect(proxy.rejected).toBeGreaterThanOrEqual(6);
    } finally {
      await proxy.close();
    }
  });

  it('ic adrese cozulen alan adi baglanti aninda reddedilir (localhost)', async () => {
    const proxy = await startRenderProxy();
    try {
      // Alan adi sekil denetimini gecer, guarded lookup 127.0.0.1'e cozulunce keser
      expect((await viaProxy(proxy, 'http://localhost/')).status).toBe(502);
      expect(await connect(proxy, 'localhost:443')).toBe(502);
    } finally {
      await proxy.close();
    }
  });

  it('yalnizca HTTP vekil istekleri: mutlak bicimde olmayan istek 400', async () => {
    const proxy = await startRenderProxy();
    try {
      expect((await viaProxy(proxy, '/goreli')).status).toBe(400);
    } finally {
      await proxy.close();
    }
  });
});

describe('render vekili — test politikasiyla gercek iletim', () => {
  it('izinli hedefe HTTP istegi iletilir, izinsiz porta iletilmez', async () => {
    const proxy = await startRenderProxy({ isBlocked: () => false, allowPort: (p) => p === upPort });
    try {
      const ok = await viaProxy(proxy, `http://127.0.0.1:${upPort}/sayfa?x=1`);
      expect(ok.status).toBe(200);
      expect(ok.body).toBe('merhaba /sayfa?x=1');
      expect((await viaProxy(proxy, `http://127.0.0.1:${upPort + 1}/`)).status).toBe(403);
    } finally {
      await proxy.close();
    }
  });

  it('izinli hedefe CONNECT tuneli kurulur ve veri tasinir', async () => {
    const proxy = await startRenderProxy({ isBlocked: () => false, allowPort: (p) => p === upPort });
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path: `127.0.0.1:${upPort}` });
        req.on('connect', (res, socket: net.Socket) => {
          expect(res.statusCode).toBe(200);
          let data = '';
          socket.on('data', (d) => { data += d; });
          socket.on('end', () => resolve(data));
          socket.write(`GET /tunel HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
        });
        req.on('error', reject);
        req.end();
      });
      expect(body).toContain('merhaba /tunel');
    } finally {
      await proxy.close();
    }
  });
});

// IPv6 karsilastirmalari yalniz localhost'un AAAA kaydi ve IPv6 loopback olan
// makinede anlamli (macOS ve cogu Linux); yoksa atlanir.
const localhostAddrs = await new Promise<LookupAddress[]>((r) => dnsLookup('localhost', { all: true }, (e, a) => r(e ? [] : a)));
const localhostHasV6 = localhostAddrs.some((a) => a.family === 6);
const v6Loopback = await new Promise<boolean>((r) => {
  const s = net.createServer();
  s.once('error', () => r(false));
  s.listen(0, '::1', () => s.close(() => r(true)));
});

/** CONNECT tuneli uzerinden duz HTTP istegi — tunelin karsi ucuna ulasildigini dogrular */
function viaTunnel(proxy: RenderProxy, authority: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path: authority });
    req.on('connect', (res, socket: net.Socket) => {
      if (res.statusCode !== 200) { socket.destroy(); resolve({ status: res.statusCode ?? 0, body: '' }); return; }
      let data = '';
      socket.on('data', (d) => { data += d; });
      socket.on('end', () => resolve({ status: 200, body: data }));
      socket.write(`GET /tunel HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    req.on('response', (res) => resolve({ status: res.statusCode ?? 0, body: '' }));
    req.on('error', reject);
    req.end();
  });
}

describe('render vekili — IPv4 sabitlemesi (main.ts genel dagiticisiyla ayni)', () => {
  // Uretimde IPv6 yolu yok; vekilin karsiya actigi soketler genel undici
  // dagiticisindan gecmez, family=4'u kendileri vermeli.
  it('HTTP ve CONNECT: guarded lookup yalniz A kayitlarini gorur ve denetler', async () => {
    const seen: string[] = [];
    const proxy = await startRenderProxy({ isBlocked: (ip) => { seen.push(ip); return false; }, allowPort: (p) => p === upPort });
    try {
      const r = await viaProxy(proxy, `http://localhost:${upPort}/v4`);
      expect(r).toEqual({ status: 200, body: 'merhaba /v4' });
      const t = await viaTunnel(proxy, `localhost:${upPort}`);
      expect(t.status).toBe(200);
      expect(t.body).toContain('merhaba /tunel');
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((ip) => isIP(ip) === 4), seen.join(',')).toBe(true);
    } finally {
      await proxy.close();
    }
  });

  it.runIf(localhostHasV6)('karsilastirma: sabitleme kapaliyken AAAA kaydi da cozulup denetlenir', async () => {
    const seen: string[] = [];
    const proxy = await startRenderProxy({ isBlocked: (ip) => { seen.push(ip); return false; }, allowPort: (p) => p === upPort, ipv4Only: false });
    try {
      expect((await viaProxy(proxy, `http://localhost:${upPort}/x`)).status).toBe(200);
      expect(seen.some((ip) => isIP(ip) === 6), seen.join(',')).toBe(true);
    } finally {
      await proxy.close();
    }
  });

  it.runIf(localhostHasV6 && v6Loopback)('yalniz IPv6 dinleyen hedefe IPv6 geri dususu YOK (502); kapaliyken iletilir', async () => {
    const s6 = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`v6 ${req.url}`); });
    await new Promise<void>((r) => s6.listen(0, '::1', () => r()));
    const port6 = (s6.address() as AddressInfo).port;
    const pinned = await startRenderProxy({ isBlocked: () => false, allowPort: (p) => p === port6, ipv4Only: true });
    const dual = await startRenderProxy({ isBlocked: () => false, allowPort: (p) => p === port6, ipv4Only: false });
    try {
      expect((await viaProxy(pinned, `http://localhost:${port6}/a`)).status).toBe(502);
      expect((await viaTunnel(pinned, `localhost:${port6}`)).status).toBe(502);
      expect(await viaProxy(dual, `http://localhost:${port6}/a`)).toEqual({ status: 200, body: 'v6 /a' });
    } finally {
      await pinned.close();
      await dual.close();
      await new Promise<void>((r) => s6.close(() => r()));
    }
  });
});

describe('chromeArgs — tarayici bayraklari', () => {
  const args = chromeArgs({ url: 'https://ornek.com/', proxyPort: 4567, virtualTimeMs: 8000, sandbox: false, userDataDir: '/tmp/x' });

  it('tum trafik vekilden: loopback istisnasi kaldirildi, QUIC ve vekilsiz UDP kapali', () => {
    expect(args).toContain('--proxy-server=http://127.0.0.1:4567');
    expect(args).toContain('--proxy-bypass-list=<-loopback>');
    expect(args).toContain('--disable-quic');
    expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  });

  it('guvenligi gevseten bayrak yok: web security acik, uzaktan hata ayiklama yok', () => {
    expect(args.some((a) => a.startsWith('--disable-web-security'))).toBe(false);
    expect(args.some((a) => a.startsWith('--remote-debugging'))).toBe(false);
    expect(args.some((a) => a.startsWith('--allow-running-insecure-content'))).toBe(false);
  });

  it('durust bot kimligi, gecici profil, adres en sonda', () => {
    expect(args.find((a) => a.startsWith('--user-agent='))).toContain('RanksUpBot');
    expect(args).toContain('--user-data-dir=/tmp/x');
    expect(args[args.length - 1]).toBe('https://ornek.com/');
  });

  it('sandbox yalnizca CHROMIUM_SANDBOX ile acilir', () => {
    expect(args).toContain('--no-sandbox');
    const sandboxed = chromeArgs({ url: 'https://ornek.com/', proxyPort: 1, virtualTimeMs: 1, sandbox: true });
    expect(sandboxed).not.toContain('--no-sandbox');
  });
});
