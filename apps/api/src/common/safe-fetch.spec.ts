import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net, { isIP, type AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import {
  isBlockedAddress, safeFetchBinary, makeSafeFetch, makeGuardedLookup, SafeFetchError,
  makeSafeTextFetch, safeFetchText, assertPublicUrl, assertResolvesPublic, RANKSUP_BOT_UA, expandIPv6,
  planDecoding, ipv4OnlyFromEnv, guardedConnectOptions, looksLikeText,
} from './safe-fetch.js';
import { detectBlock } from './block-detect.js';

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
  it('IPv6: IPv4 gomen ve kullanimdan kalkmis bicimler (AAAA ile IPv4 kurallarini dolanma)', () => {
    for (const ip of [
      '::7f00:1', '::127.0.0.1', '::a9fe:a9fe',       // IPv4-uyumlu
      '::ffff:0:7f00:1',                               // IPv4-cevrilmis
      '64:ff9b:1::a9fe:a9fe',                          // yerel NAT64
      '2002:7f00:1::', '2002:a9fe:a9fe::',             // 6to4
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',          // Teredo
      '2001:10::1', 'fec0::1', '3fff::1',
    ]) expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ['2606:4700::1', '2a00:1450:4017:80b::200e', '2620:fe::fe', '::ffff:8.8.8.8']) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it('expandIPv6', () => {
    expect(expandIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6('::ffff:0:127.0.0.1')).toEqual([0, 0, 0, 0, 0xffff, 0, 0x7f00, 1]);
    expect(expandIPv6('2001:db8::8a2e:370:7334')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0x8a2e, 0x370, 0x7334]);
    expect(expandIPv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    for (const bad of ['1::2::3', '12345::', '1:2:3:4:5:6:7:8:9', '::300.1.1.1', 'gggg::']) expect(expandIPv6(bad), bad).toBeNull();
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


describe('safeFetchText — yerel sunucuyla (test politikasi)', () => {
  let server: http.Server;
  let base = '';
  let lastUa = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastUa = String(req.headers['user-agent'] ?? '');
      if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<title>Merhaba şğı</title>'); return; }
      if (req.url === '/blocked') {
        res.writeHead(403, { 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': 'abc' });
        res.end('<title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1>');
        return;
      }
      if (req.url === '/cp1254') { res.writeHead(200, { 'content-type': 'text/html; charset=windows-1254' }); res.end(Buffer.from([0x3c, 0x62, 0x3e, 0xfe, 0xf0, 0xfd])); return; }
      if (req.url === '/meta1254') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(Buffer.concat([Buffer.from('<meta charset="iso-8859-9">'), Buffer.from([0xfe, 0xf0, 0xfd])])); return; }
      if (req.url === '/big') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('a'.repeat(10_000)); return; }
      if (req.url === '/pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(Buffer.alloc(2000)); return; }
      if (req.url === '/to-internal') { res.writeHead(301, { location: 'http://10.0.0.1/secret' }); res.end(); return; }
      if (req.url === '/form' && req.method === 'POST') {
        let gelen = '';
        req.on('data', (c) => { gelen += c; });
        req.on('end', () => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`aldim:${gelen}`); });
        return;
      }
      if (req.url === '/form-redirect' && req.method === 'POST') { res.writeHead(302, { location: '/page' }); res.end(); return; }
      if (req.url?.startsWith('/r')) {
        const n = Number(req.url.slice(2));
        res.writeHead(302, { location: n > 0 ? `/r${n - 1}` : '/page' }); res.end(); return;
      }
      res.writeHead(404, { 'content-type': 'text/html' }); res.end('yok');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // Yalnizca test: 127.0.0.1 serbest, 10.0.0.1 engelli.
  const fetchLocal = makeSafeTextFetch({ isBlocked: (ip) => ip === '10.0.0.1', allowAnyPort: true });
  const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as SafeFetchError).code; } };

  it('HTML okur, durust bot kimligiyle gider', async () => {
    const r = await fetchLocal(`${base}/page`);
    expect(r).toMatchObject({ status: 200, ok: true, contentType: 'text/html', redirected: false, truncated: false, binary: false });
    expect(r.text).toBe('<title>Merhaba şğı</title>');
    expect(lastUa).toBe(RANKSUP_BOT_UA);
  });
  it('HTTP hata durumunda HATA ATMAZ; engel sayfasinin govdesini ve basliklarini doner', async () => {
    const r = await fetchLocal(`${base}/blocked`);
    expect(r.status).toBe(403);
    expect(r.ok).toBe(false);
    expect(r.headers.server).toBe('cloudflare');
    expect(r.text).toContain('Sorry, you have been blocked');
    const nf = await fetchLocal(`${base}/nope`);
    expect(nf.status).toBe(404);
  });
  it('errorBodyBytes=0 iken hata govdesi okunmaz', async () => {
    expect((await fetchLocal(`${base}/blocked`, { errorBodyBytes: 0 })).text).toBe('');
  });
  it('Content-Type ve <meta charset> ile Turkce karakter kumesi', async () => {
    expect((await fetchLocal(`${base}/cp1254`)).text).toBe('<b>şğı');
    expect((await fetchLocal(`${base}/meta1254`)).text).toContain('şğı');
  });
  it('tavanda keser, hata vermez', async () => {
    const r = await fetchLocal(`${base}/big`, { maxBytes: 1000 });
    expect(r.text.length).toBe(1000);
    expect(r.truncated).toBe(true);
  });
  it('metin disi icerigi indirmez', async () => {
    const r = await fetchLocal(`${base}/pdf`);
    expect(r).toMatchObject({ status: 200, binary: true, text: '' });
  });
  it('HEAD: durum doner, govde yok', async () => {
    const r = await fetchLocal(`${base}/page`, { method: 'HEAD' });
    expect(r).toMatchObject({ status: 200, text: '', binary: false });
  });
  it('yonlendirme izlenir; sinir asilinca ya da ic adrese yonlendirmede reddedilir', async () => {
    const r = await fetchLocal(`${base}/r2`);
    expect(r.url).toBe(`${base}/page`);
    expect(r.redirected).toBe(true);
    expect(await code(fetchLocal(`${base}/r9`, { maxRedirects: 3 }))).toBe('redirect');
    expect(await code(fetchLocal(`${base}/to-internal`))).toBe('blocked_address');
  });
  it('POST: govde gider; yonlendirme IZLENMEZ (3xx oldugu gibi doner)', async () => {
    const r = await fetchLocal(`${base}/form`, { method: 'POST', body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(r).toMatchObject({ status: 200, ok: true, text: 'aldim:a=1' });
    const yon = await fetchLocal(`${base}/form-redirect`, { method: 'POST', body: 'a=1' });
    expect(yon).toMatchObject({ status: 302, ok: false, redirected: false, url: `${base}/form-redirect` });
  });
  it('varsayilan (uretim) ornek yerel sunucuya BAGLANMAZ', async () => {
    expect(await code(safeFetchText(`${base}/page`))).toBe('port');
    expect(await code(safeFetchText('http://127.0.0.1/'))).toBe('blocked_address');
    expect(await code(safeFetchText('http://169.254.169.254/latest/meta-data/'))).toBe('blocked_address');
  });
  it('cozulemeyen alan adi: dns', async () => {
    expect(await code(safeFetchText('https://olmayan-alan-adi.invalid/'))).toBe('dns');
  });
});

describe('kayit aninda adres denetimi', () => {
  const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as SafeFetchError).code; } };
  it('assertPublicUrl', () => {
    expect(assertPublicUrl('https://ranksup.ai/x').hostname).toBe('ranksup.ai');
    for (const [u, c] of [['http://10.0.0.5/', 'blocked_address'], ['http://[::1]/', 'blocked_address'], ['https://x.com:8443/', 'port'], ['ftp://x.com/', 'protocol'], ['https://a:b@x.com/', 'protocol']]) {
      try { assertPublicUrl(u); throw new Error('reddedilmedi: ' + u); } catch (e) { expect((e as SafeFetchError).code, u).toBe(c); }
    }
  });
  it('assertResolvesPublic: localhost ozel adrese cozulur', async () => {
    expect(await code(assertResolvesPublic('http://localhost/'))).toBe('blocked_address');
    expect(await code(assertResolvesPublic('https://olmayan-alan-adi.invalid/'))).toBe('dns');
  });
});

describe('safeFetchText — icerik kodlamasi (Content-Encoding)', () => {
  // NEDEN: undici.request govdeyi acmaz. Her zaman sikistiran sunucuda (S3 /
  // CloudFront on-sikistirilmis nesne, nginx gzip_static always) gzip/br baytlari
  // metin diye ok=true donuyor, tarayici gurultuyu "sayfa" sanip puan kiriyordu.
  const HTML = '<html><head><title>Merhaba şğı</title><meta name="description" content="Açıklama"></head><body><h1>Başlık</h1></body></html>';
  const ZSTD_LIKE = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x58, 0x00, 0x00, 0x10, 0x02, 0x3c, 0x68, 0x00, 0x91, 0x07]);
  let server: http.Server;
  let base = '';
  let lastAcceptEncoding: string | undefined;
  let endlessSent = 0;
  let endlessClosed = false;

  const send = (res: http.ServerResponse, status: number, headers: Record<string, string>, body: Buffer) => {
    res.writeHead(status, headers);
    res.end(body);
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastAcceptEncoding = req.headers['accept-encoding'] as string | undefined;
      const html = { 'content-type': 'text/html; charset=utf-8' };
      switch (req.url) {
        // Istekteki Accept-Encoding'e BAKMADAN her zaman sikistiran sunucular
        case '/gz': return send(res, 200, { ...html, 'content-encoding': 'gzip' }, zlib.gzipSync(HTML));
        case '/x-gzip': return send(res, 200, { ...html, 'content-encoding': 'x-gzip' }, zlib.gzipSync(HTML));
        case '/br': return send(res, 200, { ...html, 'content-encoding': 'br' }, zlib.brotliCompressSync(Buffer.from(HTML)));
        case '/deflate': return send(res, 200, { ...html, 'content-encoding': 'deflate' }, zlib.deflateSync(HTML));
        case '/deflate-raw': return send(res, 200, { ...html, 'content-encoding': 'deflate' }, zlib.deflateRawSync(HTML));
        // "deflate, gzip": once deflate, sonra gzip uygulandi → once gzip acilir
        case '/multi': return send(res, 200, { ...html, 'content-encoding': 'deflate, gzip' }, zlib.gzipSync(zlib.deflateSync(HTML)));
        case '/identity-list': return send(res, 200, { ...html, 'content-encoding': 'identity' }, Buffer.from(HTML));
        case '/gz-1254': return send(res, 200, { 'content-type': 'text/html; charset=windows-1254', 'content-encoding': 'gzip' }, zlib.gzipSync(Buffer.from([0x3c, 0x62, 0x3e, 0xfe, 0xf0, 0xfd])));
        case '/gz-big': return send(res, 200, { ...html, 'content-encoding': 'gzip' }, zlib.gzipSync('a'.repeat(100_000)));
        // zstd cercevesi (sihirli sayi + ikili veri) — ilan etmedigimiz kodlama
        case '/zstd': return send(res, 200, { ...html, 'content-encoding': 'zstd' }, ZSTD_LIKE);
        case '/zstd-403': return send(res, 403, { ...html, 'content-encoding': 'zstd', server: 'cloudflare', 'cf-ray': 'abc' }, ZSTD_LIKE);
        case '/too-many': return send(res, 200, { ...html, 'content-encoding': 'gzip, gzip, gzip, gzip' }, zlib.gzipSync(zlib.gzipSync(zlib.gzipSync(zlib.gzipSync(HTML)))));
        // PHP'nin "Content-Encoding: none" hilesi: govde duz — tarayici gosterir, biz de okumaliyiz
        case '/none': return send(res, 200, { ...html, 'content-encoding': 'none' }, Buffer.from(HTML));
        case '/none-403': return send(res, 403, { ...html, 'content-encoding': 'none', server: 'cloudflare', 'cf-ray': 'abc' }, Buffer.from('<title>Attention Required! | Cloudflare</title>Sorry, you have been blocked'));
        // gzip diyor ama govde duz metin (yanlis yapilandirma) — tarayici da acamaz
        case '/bad-gz': return send(res, 200, { ...html, 'content-encoding': 'gzip' }, Buffer.from('<html>bu gzip degil</html>'));
        case '/bad-gz-500': return send(res, 500, { ...html, 'content-encoding': 'gzip' }, Buffer.from('bozuk'));
        // Sikistirilmis Cloudflare engel sayfasi: engel tespiti acilmis metni gormeli
        case '/gz-waf': return send(res, 403, { ...html, 'content-encoding': 'gzip', server: 'cloudflare', 'cf-ray': 'abc' },
          zlib.gzipSync('<title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1>'));
        // Cikti uretmeyen girdi: binlerce bos gzip uyesi (her biri 20 bayt, 0 bayt acilir)
        case '/empty-members': return send(res, 200, { ...html, 'content-encoding': 'gzip' }, Buffer.concat(Array.from({ length: 20_000 }, () => zlib.gzipSync(Buffer.alloc(0)))));
        case '/not-modified': res.writeHead(304, { 'content-encoding': 'gzip', etag: '"x"' }); res.end(); return;
        case '/endless-gz': {
          // Sonsuz sifir akisi gzip'le — istemci tavanda kesmezse test asla bitmez
          res.writeHead(200, { ...html, 'content-encoding': 'gzip' });
          const gz = zlib.createGzip();
          gz.on('data', (c: Buffer) => { endlessSent += c.length; });
          gz.pipe(res);
          const zero = Buffer.alloc(64 * 1024);
          let open = true;
          res.on('close', () => { open = false; endlessClosed = true; gz.destroy(); });
          const pump = () => { while (open && gz.write(zero)) { /* tampon dolana kadar */ } if (open) gz.once('drain', pump); };
          pump();
          return;
        }
        default: res.writeHead(404); res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));

  const fetchLocal = makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true });
  const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as SafeFetchError).code; } };

  it('Accept-Encoding: gzip, deflate, br ilan edilir; cagiran ezebilir', async () => {
    await fetchLocal(`${base}/identity-list`);
    expect(lastAcceptEncoding).toBe('gzip, deflate, br');
    await fetchLocal(`${base}/identity-list`, { headers: { 'Accept-Encoding': 'identity' } });
    expect(lastAcceptEncoding).toBe('identity');
  });

  it('her zaman gzip / x-gzip / br / deflate (zlib ve ham) gonderen sunucu: baslik okunur, ikili gurultu donmez', async () => {
    for (const path of ['/gz', '/x-gzip', '/br', '/deflate', '/deflate-raw', '/multi', '/identity-list']) {
      const r = await fetchLocal(`${base}${path}`);
      expect(r, path).toMatchObject({ status: 200, ok: true, truncated: false, binary: false });
      expect(r.text, path).toBe(HTML);
      expect(/<title>([^<]*)<\/title>/.exec(r.text)?.[1], path).toBe('Merhaba şğı');
    }
  });

  it('karakter kumesi ACILMIS govdeye uygulanir (windows-1254)', async () => {
    expect((await fetchLocal(`${base}/gz-1254`)).text).toBe('<b>şğı');
  });

  it('maxBytes acilmis bayta uygulanir: kesilir, truncated=true', async () => {
    const r = await fetchLocal(`${base}/gz-big`, { maxBytes: 1000 });
    expect(r.text).toBe('a'.repeat(1000));
    expect(r.truncated).toBe(true);
  });

  it('sikistirma bombasi: sonsuz gzip akisi tavanda kesilir, bellek sisemez, baglanti kapanir', async () => {
    const r = await fetchLocal(`${base}/endless-gz`, { maxBytes: 1024 * 1024, timeoutMs: 10_000 });
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(1024 * 1024);
    expect(/^\0+$/.test(r.text)).toBe(true);
    // 1 MB acilmis cikti icin sunucunun gonderdigi sikistirilmis bayt cok kucuk kalir
    await new Promise((res) => setTimeout(res, 50));
    expect(endlessClosed).toBe(true);
    expect(endlessSent).toBeLessThan(2 * 1024 * 1024);
  });

  it('cikti uretmeyen sikistirilmis girdi sonsuza kadar okunmaz (sikistirilmis bayt tavani)', async () => {
    expect(await code(fetchLocal(`${base}/empty-members`, { maxBytes: 1000 }))).toBe('content_encoding');
  });

  it('desteklenmeyen kodlama (zstd) ve asiri uzun zincir: 2xx okunamadi sayilir (content_encoding)', async () => {
    expect(await code(fetchLocal(`${base}/zstd`))).toBe('content_encoding');
    expect(await code(fetchLocal(`${base}/too-many`))).toBe('content_encoding');
  });

  it('taninmayan ama zararsiz kodlama ("none") + duz govde: tarayici gibi okunur', async () => {
    const r = await fetchLocal(`${base}/none`);
    expect(r).toMatchObject({ status: 200, ok: true, text: HTML });
    const b = await fetchLocal(`${base}/none-403`);
    expect(b.text).toContain('Sorry, you have been blocked');
    expect(detectBlock(b)).toMatchObject({ kind: 'waf' });
  });

  it('gzip diyen ama gzip olmayan 2xx govde: content_encoding (gurultu ok=true donmez)', async () => {
    expect(await code(fetchLocal(`${base}/bad-gz`))).toBe('content_encoding');
  });

  it('2xx disi yanit da acilir: sikistirilmis WAF sayfasi engel olarak taninir', async () => {
    const r = await fetchLocal(`${base}/gz-waf`);
    expect(r).toMatchObject({ status: 403, ok: false });
    expect(r.text).toContain('Sorry, you have been blocked');
    expect(detectBlock(r)).toMatchObject({ kind: 'waf', vendor: 'cloudflare' });
    expect((await fetchLocal(`${base}/gz-waf`, { errorBodyBytes: 10 })).text).toBe('<title>Att');
  });

  it('2xx disi yanit cozulemezse hata atmaz: durum ve basliklar korunur, govde bos', async () => {
    const z = await fetchLocal(`${base}/zstd-403`);
    expect(z).toMatchObject({ status: 403, ok: false, text: '' });
    expect(detectBlock(z)).toMatchObject({ vendor: 'cloudflare' });
    expect(await fetchLocal(`${base}/bad-gz-500`)).toMatchObject({ status: 500, ok: false, text: '' });
  });

  it('HEAD ve 304: govde yok, acma denenmez', async () => {
    expect(await fetchLocal(`${base}/gz`, { method: 'HEAD' })).toMatchObject({ status: 200, text: '' });
    expect(await fetchLocal(`${base}/not-modified`)).toMatchObject({ status: 304, ok: false, text: '' });
  });
});

describe('looksLikeText', () => {
  it('HTML (utf-8 ve windows-1254) metin; gzip / br / zstd baytlari degil', () => {
    expect(looksLikeText(Buffer.from('<html>\n\t<title>Merhaba şğı</title>\r\n</html>'))).toBe(true);
    expect(looksLikeText(Buffer.from([0x3c, 0x62, 0x3e, 0xfe, 0xf0, 0xfd]))).toBe(true);
    expect(looksLikeText(Buffer.alloc(0))).toBe(true);
    const page = '<title>Merhaba</title>'.repeat(200);
    expect(looksLikeText(zlib.gzipSync(page))).toBe(false);
    expect(looksLikeText(zlib.brotliCompressSync(Buffer.from(page)))).toBe(false);
    expect(looksLikeText(zlib.deflateRawSync(page))).toBe(false);
  });
});

describe('planDecoding', () => {
  it('ters sira, identity atlanir, buyuk/kucuk harf ve bosluk onemsiz', () => {
    expect(planDecoding(undefined)).toEqual({ ok: true, order: [] });
    expect(planDecoding('identity')).toEqual({ ok: true, order: [] });
    expect(planDecoding('GZIP')).toEqual({ ok: true, order: ['gzip'] });
    expect(planDecoding('deflate , br')).toEqual({ ok: true, order: ['br', 'deflate'] });
  });
  it('taninmayan kodlama ve 3ten uzun zincir reddedilir', () => {
    expect(planDecoding('gzip, zstd')).toEqual({ ok: false, coding: 'zstd' });
    expect(planDecoding('compress')).toEqual({ ok: false, coding: 'compress' });
    expect(planDecoding('br, br, br, br').ok).toBe(false);
  });
});

// IPv6 karsilastirma testleri yalniz localhost'un AAAA kaydi ve IPv6 loopback
// olan makinede anlamli (macOS ve cogu Linux'ta var); yoksa atlanir.
const localhostAddrs = await new Promise<LookupAddress[]>((r) => dnsLookup('localhost', { all: true }, (e, a) => r(e ? [] : a)));
const localhostHasV6 = localhostAddrs.some((a) => a.family === 6);
const v6Loopback = await new Promise<boolean>((r) => {
  const s = net.createServer();
  s.once('error', () => r(false));
  s.listen(0, '::1', () => s.close(() => r(true)));
});

describe('IPv4 sabitlemesi (main.ts genel dagiticisiyla ayni)', () => {
  // Uretimde calisan IPv6 yolu yok; korumali ajanlar genel dagiticiyi
  // kullanmadigi icin family=4 kendileri vermeli (happy-eyeballs IPv6'ya gecip
  // ETIMEDOUT uretmesin).
  it('ipv4OnlyFromEnv: varsayilan acik; yalniz 0/false/off/no kapatir', () => {
    expect(ipv4OnlyFromEnv({})).toBe(true);
    expect(ipv4OnlyFromEnv({ SAFE_FETCH_IPV4_ONLY: '1' })).toBe(true);
    expect(ipv4OnlyFromEnv({ SAFE_FETCH_IPV4_ONLY: 'true' })).toBe(true);
    for (const v of ['0', 'false', 'OFF', ' no ']) expect(ipv4OnlyFromEnv({ SAFE_FETCH_IPV4_ONLY: v }), v).toBe(false);
  });

  it('guardedConnectOptions: family=4 + korumali lookup; kapaliyken family yok', () => {
    const on = guardedConnectOptions(isBlockedAddress, { timeoutMs: 5000, ipv4Only: true });
    expect(on).toMatchObject({ family: 4, timeout: 5000 });
    expect(typeof on.lookup).toBe('function');
    const off = guardedConnectOptions(isBlockedAddress, { ipv4Only: false });
    expect('family' in off).toBe(false);
    expect('timeout' in off).toBe(false);
  });

  describe('yerel sunucuyla', () => {
    let server4: http.Server;
    let port4 = 0;
    beforeAll(async () => {
      server4 = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('v4'); });
      await new Promise<void>((r) => server4.listen(0, '127.0.0.1', () => r()));
      port4 = (server4.address() as AddressInfo).port;
    });
    afterAll(() => new Promise<void>((r) => server4.close(() => r())));

    it('metin ajani: lookup yalniz A kayitlarini gorur ve denetler (AAAA hic denenmez)', async () => {
      const seen: string[] = [];
      const f = makeSafeTextFetch({ isBlocked: (ip) => { seen.push(ip); return false; }, allowAnyPort: true });
      expect((await f(`http://localhost:${port4}/`)).text).toBe('v4');
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((ip) => isIP(ip) === 4), seen.join(',')).toBe(true);
    });

    it('ikili ajan (gorsel indirme) de ayni sabitlemeyi kullanir', async () => {
      const seen: string[] = [];
      const f = makeSafeFetch({ isBlocked: (ip) => { seen.push(ip); return false; }, allowAnyPort: true });
      expect((await f(`http://localhost:${port4}/`)).body.toString()).toBe('v4');
      expect(seen.every((ip) => isIP(ip) === 4), seen.join(',')).toBe(true);
    });

    it.runIf(localhostHasV6)('karsilastirma: sabitleme kapaliyken AAAA kaydi da cozulup denetlenir', async () => {
      const seen: string[] = [];
      const f = makeSafeTextFetch({ isBlocked: (ip) => { seen.push(ip); return false; }, allowAnyPort: true, ipv4Only: false });
      await f(`http://localhost:${port4}/`);
      expect(seen.some((ip) => isIP(ip) === 6), seen.join(',')).toBe(true);
    });
  });

  it.runIf(localhostHasV6 && v6Loopback)('yalniz IPv6 dinleyen hedefe IPv6 geri dususu YOK; kapaliyken baglanir', async () => {
    const s6 = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('v6'); });
    await new Promise<void>((r) => s6.listen(0, '::1', () => r()));
    const port6 = (s6.address() as AddressInfo).port;
    try {
      const pinned = makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true, ipv4Only: true });
      const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as SafeFetchError).code; } };
      expect(await code(pinned(`http://localhost:${port6}/`))).toBe('network');
      const dual = makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true, ipv4Only: false });
      expect((await dual(`http://localhost:${port6}/`)).text).toBe('v6');
    } finally {
      await new Promise<void>((r) => s6.close(() => r()));
    }
  });
});
