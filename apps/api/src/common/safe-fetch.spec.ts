import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isBlockedAddress, safeFetchBinary, makeSafeFetch, makeGuardedLookup, SafeFetchError } from './safe-fetch.js';

describe('isBlockedAddress', () => {
  it('ozel / ayrilmis IPv4 araliklari', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });
  it('genel IPv4 serbest', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34']) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it('IPv6: loopback, ULA, link-local, IPv4-esli adresler', () => {
    for (const ip of ['::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });
  it('IP olmayan deger guvenilmez', () => {
    expect(isBlockedAddress('localhost')).toBe(true);
  });
});

describe('safeFetchBinary — baglanmadan once red', () => {
  const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as SafeFetchError).code; } };
  it('protokol, port, kimlik bilgili URL', async () => {
    expect(await code(safeFetchBinary('file:///etc/passwd'))).toBe('protocol');
    expect(await code(safeFetchBinary('ftp://x.com/a.png'))).toBe('protocol');
    expect(await code(safeFetchBinary('http://x.com:8080/a.png'))).toBe('port');
    expect(await code(safeFetchBinary('https://u:p@x.com/a.png'))).toBe('protocol');
  });
  it('dogrudan yazilmis ozel IP (DNS e gitmeden) — bulut metadata dahil', async () => {
    expect(await code(safeFetchBinary('http://169.254.169.254/latest/meta-data/'))).toBe('blocked_address');
    expect(await code(safeFetchBinary('http://127.0.0.1/a.png'))).toBe('blocked_address');
    expect(await code(safeFetchBinary('http://[::1]/a.png'))).toBe('blocked_address');
  });
});

describe('makeGuardedLookup — baglanti anindaki DNS denetimi', () => {
  it('localhost ozel adrese cozuldugu icin baglanti kurulmaz', async () => {
    const lookup = makeGuardedLookup(isBlockedAddress);
    const err = await new Promise<any>((resolve) => lookup('localhost', {}, (e) => resolve(e)));
    expect(err?.code).toBe('EBLOCKEDADDR');
  });
});

describe('safeFetchBinary — yerel sunucuyla (test politikasi)', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/img') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from([1, 2, 3])); return; }
      if (req.url === '/big') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.alloc(5000)); return; }
      if (req.url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>'); return; }
      if (req.url?.startsWith('/r')) {
        const n = Number(req.url.slice(2));
        res.writeHead(302, { location: n > 0 ? `/r${n - 1}` : '/img' }); res.end(); return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // Yalnizca test: yerel sunucu 127.0.0.1'de ve rastgele portta.
  const fetchLocal = makeSafeFetch({ isBlocked: () => false, allowAnyPort: true });
  const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as SafeFetchError).code; } };

  it('gorseli indirir', async () => {
    const r = await fetchLocal(`${base}/img`, { accept: /^image\// });
    expect([...r.body]).toEqual([1, 2, 3]);
    expect(r.contentType).toBe('image/png');
  });
  it('boyut siniri', async () => {
    expect(await code(fetchLocal(`${base}/big`, { maxBytes: 1000 }))).toBe('too_large');
  });
  it('icerik turu', async () => {
    expect(await code(fetchLocal(`${base}/html`, { accept: /^image\// }))).toBe('content_type');
  });
  it('yonlendirme: sinir icinde izlenir, asilinca reddedilir', async () => {
    expect((await fetchLocal(`${base}/r2`, { maxRedirects: 3 })).url).toBe(`${base}/img`);
    expect(await code(fetchLocal(`${base}/r5`, { maxRedirects: 3 }))).toBe('redirect');
  });
  it('varsayilan (uretim) politika ayni yerel sunucuya BAGLANMAZ', async () => {
    expect(await code(safeFetchBinary(`${base}/img`))).toBe('port');
  });
});
