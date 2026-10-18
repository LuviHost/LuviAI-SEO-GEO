import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import {
  CustomPhpAdapter, WordPressRestAdapter, sanitizeErrorText, setAdapterFetch, setAdapterHostResolver,
} from '@luviai/adapters';
import { isBlockedAddress } from '../common/safe-fetch.js';
import {
  AdapterEgressError, makeGuardedAdapterFetch, makeGuardedHostResolver, registerAdapterEgressGuard,
} from './adapter-egress.js';
import { PublishTargetsModule } from './publish-targets.module.js';

/**
 * Yayin hedefi adaptorlerinin korumali ag erisimi (F16).
 *
 * NEDEN VAR: kayitli adresin denetimi (publish-target-url.ts) yalniz adresin o
 * an nereye cozuldugune bakar. Adaptorler global fetch'i redirect:'follow' ile
 * kullaniyordu: denetimi gecen site istegi ic adrese yonlendirebiliyor,
 * adaptor oradan donen govdeyi hata metnine koyuyordu.
 *
 * Testte "musteri sitesi" 127.0.0.1'de calisir; politika yalniz 127.0.0.1'i
 * serbest birakir, geri kalan ozel adresler (::1, 10/8, 169.254/16...)
 * uretimdeki gibi engellidir.
 */

type Hit = { method: string; url: string; body: string; headers: http.IncomingHttpHeaders };

function startServer(host: string, handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hits.push({ method: req.method ?? '', url: req.url ?? '', body, headers: req.headers });
      handler(req, body, res);
    });
  });
  return new Promise<{ server: http.Server; port: number; hits: Hit[] }>((resolve) => {
    server.listen(0, host, () => resolve({ server, port: (server.address() as AddressInfo).port, hits }));
  });
}

function echo(req: http.IncomingMessage, body: string, res: http.ServerResponse) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    method: req.method, url: req.url, body,
    auth: req.headers.authorization ?? null,
    shop: req.headers['x-shopify-access-token'] ?? null,
    accept: req.headers.accept ?? null,
    ua: req.headers['user-agent'] ?? null,
  }));
}

function redirect(res: http.ServerResponse, status: number, location: string) {
  res.writeHead(status, { location, 'content-type': 'text/html' });
  res.end(`<html><body>Moved to ${location}</body></html>`);
}

const v6Loopback = await new Promise<boolean>((r) => {
  const s = net.createServer();
  s.once('error', () => r(false));
  s.listen(0, '::1', () => s.close(() => r(true)));
});

/** 127.0.0.1 serbest (test sunuculari); diger her ozel adres uretimdeki gibi engelli */
const testPolicy = {
  isBlocked: (ip: string) => ip !== '127.0.0.1' && isBlockedAddress(ip),
  ipv4Only: true,
  resolveHost: async (h: string) => {
    if (h === 'ic-servis.test') return ['10.0.0.9'];
    if (h === 'localhost') return ['127.0.0.1'];
    throw new Error('ENOTFOUND');
  },
};

const failMessage = async (p: Promise<unknown>) => {
  try { await p; return 'gecti'; } catch (e) { return e instanceof AdapterEgressError ? `${e.code}: ${e.message}` : `diger: ${(e as Error).message}`; }
};

let site: Awaited<ReturnType<typeof startServer>>;
let other: Awaited<ReturnType<typeof startServer>>;
let internal: Awaited<ReturnType<typeof startServer>> | null = null;
let wpHandler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void = echo;

beforeAll(async () => {
  other = await startServer('127.0.0.1', echo);
  if (v6Loopback) internal = await startServer('::1', (_q, _b, res) => { res.writeHead(200); res.end('GIZLI-IC-SERVIS-YANITI'); });
  site = await startServer('127.0.0.1', (req, body, res) => {
    const u = req.url ?? '';
    if (u === '/to-internal-literal') return redirect(res, 307, internal ? `http://[::1]:${internal.port}/secret` : 'http://169.254.169.254/latest/meta-data/');
    if (u === '/to-metadata') return redirect(res, 302, 'http://169.254.169.254/latest/meta-data/');
    if (u === '/to-internal-name') return redirect(res, 302, `http://ic-servis.test:${site.port}/echo`);
    if (u === '/to-ftp') return redirect(res, 302, 'ftp://example.com/x');
    if (u === '/same-307') return redirect(res, 307, '/echo');
    if (u === '/same-308') return redirect(res, 308, `http://127.0.0.1:${site.port}/echo`);
    if (u === '/cross-307') return redirect(res, 307, `http://127.0.0.1:${other.port}/echo`);
    if (u === '/cross-get') return redirect(res, 302, `http://localhost:${other.port}/echo`);
    if (u === '/same-get') return redirect(res, 302, '/echo');
    if (u === '/moved-301') return redirect(res, 301, '/echo');
    if (u === '/see-other') return redirect(res, 303, '/echo');
    if (u === '/loop') return redirect(res, 302, '/loop');
    if (u.startsWith('/wp-json/')) return wpHandler(req, body, res);
    return echo(req, body, res);
  });
});

afterAll(async () => {
  for (const s of [site, other, internal]) if (s) await new Promise<void>((r) => s.server.close(() => r()));
});

afterEach(() => {
  setAdapterFetch(null);
  setAdapterHostResolver(null);
  wpHandler = echo;
  vi.unstubAllGlobals();
});

describe('korumali adaptor fetch — yonlendirme', () => {
  const guarded = makeGuardedAdapterFetch(testPolicy);

  it('ic adrese (yazili IP) yonlendirme reddedilir; ic sunucuya hic gidilmez', async () => {
    const before = internal?.hits.length ?? 0;
    const msg = await failMessage(guarded(`http://127.0.0.1:${site.port}/to-internal-literal`));
    expect(msg).toMatch(/^blocked_address: /);
    expect(msg).not.toMatch(/::1|169\.254/);
    expect(internal?.hits.length ?? 0).toBe(before);
  });

  it('GET de olsa bulut metadata adresine (302) gidilmez', async () => {
    expect(await failMessage(guarded(`http://127.0.0.1:${site.port}/to-metadata`))).toMatch(/^blocked_address: /);
  });

  it('ic adrese cozulen alan adina yonlendirme simdi cozulup reddedilir', async () => {
    const msg = await failMessage(guarded(`http://127.0.0.1:${site.port}/to-internal-name`));
    expect(msg).toMatch(/^blocked_address: /);
    expect(msg).not.toContain('10.0.0.9');
  });

  it('http/https disi yonlendirme izlenmez', async () => {
    expect(await failMessage(guarded(`http://127.0.0.1:${site.port}/to-ftp`))).toMatch(/^protocol: /);
  });

  it('ayni kokene 307 ve 308 yontemi ve govdeyi korur', async () => {
    for (const path of ['/same-307', '/same-308']) {
      const res = await guarded(`http://127.0.0.1:${site.port}${path}`, {
        method: 'POST', body: '{"title":"merhaba"}', headers: { 'Content-Type': 'application/json', Authorization: 'Basic abc' },
      });
      expect(res.status, path).toBe(200);
      expect(await res.json(), path).toMatchObject({ method: 'POST', url: '/echo', body: '{"title":"merhaba"}', auth: 'Basic abc' });
    }
  });

  it('Buffer govde de ayni kokene yeniden gonderilir (WP medya yuklemesi)', async () => {
    const res = await guarded(`http://127.0.0.1:${site.port}/same-307`, { method: 'POST', body: Buffer.from('ikili-veri') });
    expect(await res.json()).toMatchObject({ method: 'POST', body: 'ikili-veri' });
  });

  it('baska kokene 307 govdeyi TASIMAZ: 3xx adaptore aynen doner, diger sunucuya hic gidilmez', async () => {
    const before = other.hits.length;
    const res = await guarded(`http://127.0.0.1:${site.port}/cross-307`, { method: 'POST', body: 'gizli-govde', headers: { Authorization: 'Basic abc' } });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`http://127.0.0.1:${other.port}/echo`);
    expect(other.hits.length).toBe(before);
  });

  it('govdeli istekte 301 izlenmez (GET\'e cevirmek yanlis "yayinlandi" uretirdi)', async () => {
    const echoBefore = site.hits.filter((h) => h.url === '/echo').length;
    const res = await guarded(`http://127.0.0.1:${site.port}/moved-301`, { method: 'POST', body: 'x' });
    expect(res.status).toBe(301);
    expect(site.hits.filter((h) => h.url === '/echo').length).toBe(echoBefore);
  });

  it('303 (istek islendi, sonuc orada) govdesiz GET ile izlenir', async () => {
    const res = await guarded(`http://127.0.0.1:${site.port}/see-other`, { method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } });
    expect(await res.json()).toMatchObject({ method: 'GET', url: '/echo', body: '' });
  });

  it('govdesiz GET baska kokene izlenir ama kimlik basliklari tasinmaz; ayni kokende kalir', async () => {
    const headers = { Authorization: 'Basic abc', 'X-Shopify-Access-Token': 'tok', Accept: 'application/json' };
    const cross = await (await guarded(`http://127.0.0.1:${site.port}/cross-get`, { headers })).json();
    expect(cross).toMatchObject({ url: '/echo', auth: null, shop: null, accept: 'application/json' });
    const same = await (await guarded(`http://127.0.0.1:${site.port}/same-get`, { headers })).json();
    expect(same).toMatchObject({ auth: 'Basic abc', shop: 'tok' });
  });

  it('en fazla 5 yonlendirme izlenir', async () => {
    const before = site.hits.filter((h) => h.url === '/loop').length;
    expect(await failMessage(guarded(`http://127.0.0.1:${site.port}/loop`))).toMatch(/^redirect: .*en fazla 5/);
    expect(site.hits.filter((h) => h.url === '/loop').length - before).toBe(6);
  });

  it("redirect:'manual' veren cagri 3xx'i aynen alir", async () => {
    const res = await guarded(`http://127.0.0.1:${site.port}/same-get`, { redirect: 'manual' });
    expect(res.status).toBe(302);
  });

  it("User-Agent verilmezse global fetch'in gonderdigi 'node' gider (WAF kurallari degismesin)", async () => {
    expect(await (await guarded(`http://127.0.0.1:${site.port}/echo`)).json()).toMatchObject({ ua: 'node' });
    const own = await (await guarded(`http://127.0.0.1:${site.port}/echo`, { headers: { 'User-Agent': 'RanksUp-Publisher/1.0' } })).json();
    expect(own).toMatchObject({ ua: 'RanksUp-Publisher/1.0' });
  });

  it('yazili ic IP ilk istekte de reddedilir', async () => {
    expect(await failMessage(guarded('http://10.0.0.5:3001/'))).toMatch(/^blocked_address: /);
    expect(await failMessage(guarded('http://[::ffff:169.254.169.254]/'))).toMatch(/^blocked_address: /);
  });

  it('alan adi baglanti aninda ic adrese cozulurse baglanilmaz; mesaj ic adresi tasimaz', async () => {
    // 127.0.0.1 de engelli: localhost baglanti anindaki korumali lookup'ta duser (rebinding araligi yok)
    const strict = makeGuardedAdapterFetch({ ...testPolicy, isBlocked: isBlockedAddress });
    const before = site.hits.length;
    const msg = await failMessage(strict(`http://localhost:${site.port}/echo`));
    expect(msg).toMatch(/^blocked_address: .*localhost/);
    expect(msg).not.toContain('127.0.0.1');
    expect(site.hits.length).toBe(before);
  });
});

describe('adaptorler korumali fetch ile', () => {
  it('WP yayini ic adrese 307 alirsa yayin basarisiz, ic adrese gidilmez, neden durust', async () => {
    setAdapterFetch(makeGuardedAdapterFetch(testPolicy));
    const before = internal?.hits.length ?? 0;
    wpHandler = (_q, _b, res) => redirect(res, 307, internal ? `http://[::1]:${internal.port}/` : 'http://169.254.169.254/');
    const adapter = new WordPressRestAdapter({ siteUrl: `http://127.0.0.1:${site.port}`, username: 'u', appPassword: 'p' }, {});
    const r = await adapter.publish({ slug: 's', title: 'T', bodyHtml: '<p>x</p>', bodyMd: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^WP REST 307: hedef adres isteği başka bir adrese yönlendiriyor/);
    expect(r.error).not.toMatch(/::1|169\.254/);
    expect(internal?.hits.length ?? 0).toBe(before);
  });

  it('WP baglanti testi yonlendirmeyi HIC izlemez: ic adrese 302 → oraya gidilmez, ne yapilacagi soylenir (adres maskeli)', async () => {
    setAdapterFetch(makeGuardedAdapterFetch(testPolicy));
    const before = internal?.hits.length ?? 0;
    wpHandler = (_q, _b, res) => redirect(res, 302, internal ? `http://[::1]:${internal.port}/` : 'http://169.254.169.254/latest/meta-data/');
    const adapter = new WordPressRestAdapter({ siteUrl: `http://127.0.0.1:${site.port}`, username: 'u', appPassword: 'p' }, {});
    const msg = await failMessage(adapter.test());
    expect(msg).toMatch(/^diger: hedef adres isteği başka bir adrese yönlendiriyor/);
    expect(msg).not.toMatch(/::1|169\.254/);
    expect(internal?.hits.length ?? 0).toBe(before);
  });

  it('on-page meta yaziminda engellenen yonlendirme firlatilmaz: snippet uygulayici durust sonuc alir', async () => {
    setAdapterFetch(makeGuardedAdapterFetch(testPolicy));
    wpHandler = (_q, _b, res) => redirect(res, 302, 'http://169.254.169.254/latest/meta-data/');
    const adapter = new WordPressRestAdapter({ siteUrl: `http://127.0.0.1:${site.port}`, username: 'u', appPassword: 'p' }, {});
    const r = await adapter.applyOnPageMeta({ pageUrl: 'https://ornek.com/yazi/', metaTitle: 'Başlık' });
    expect(r).toMatchObject({ ok: false, applied: [] });
    expect(r.skipped[0].field).toBe('all');
    expect(r.skipped[0].reason).toMatch(/özel veya iç ağ adresine yönlendirdi/);
  });

  it('hata govdesi temizlenir: HTML/betik yok, ic adres maskeli, kisa', async () => {
    setAdapterFetch(makeGuardedAdapterFetch(testPolicy));
    wpHandler = (_q, _b, res) => {
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end(`<html><head><style>body{color:red}</style><script>alert("x")</script></head><body><h1>Hata</h1>
        upstream 10.0.0.5:3001 bağlantı reddedildi; redis [::1]:6379, api localhost:3001 ${'ayrıntı '.repeat(800)}</body></html>`);
    };
    const adapter = new WordPressRestAdapter({ siteUrl: `http://127.0.0.1:${site.port}`, username: 'u', appPassword: 'p' }, {});
    const r = await adapter.publish({ slug: 's', title: 'T', bodyHtml: '<p>x</p>', bodyMd: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^WP REST 500: Hata upstream \[adres\] bağlantı reddedildi; redis \[adres\], api \[adres\]/);
    expect(r.error!.length).toBeLessThanOrEqual('WP REST 500: '.length + 200);
    expect(r.error).not.toMatch(/<|alert|color:red|10\.0\.0\.5|::1|localhost/);
  });

  it('kayit yokken adaptorler global fetch kullanir (eski davranis)', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({ ok: true, url: 'https://ornek.com/yazi' }), { status: 200 }));
    vi.stubGlobal('fetch', mock);
    const r = await new CustomPhpAdapter({ endpointUrl: 'https://ornek.com/api' }, {}).publish({ slug: 's', title: 'T', bodyHtml: '', bodyMd: '' });
    expect(r).toMatchObject({ ok: true, externalUrl: 'https://ornek.com/yazi' });
    expect(mock).toHaveBeenCalledTimes(1);
    expect((mock.mock.calls[0] as unknown[])[0]).toBe('https://ornek.com/api');
  });

  it('kayitli fetch varsa adaptor global fetch\'e dokunmaz', async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);
    const injected = vi.fn(async () => new Response('{}', { status: 200 }));
    setAdapterFetch(injected);
    await new CustomPhpAdapter({ endpointUrl: 'https://ornek.com/api' }, {}).publish({ slug: 's', title: 'T', bodyHtml: '', bodyMd: '' });
    expect(injected).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('PublishTargetsModule acilista uretim korumasini kaydeder (API + worker ayni modulu kurar)', async () => {
    new PublishTargetsModule().onModuleInit();
    const before = site.hits.length;
    // Uretim politikasi: 127.0.0.1 de ic adres → yayin hedefine hic baglanilmaz
    // (test() kimliksiz istek atmaz — kimlik verilir ki istek denensin)
    const adapter = new WordPressRestAdapter({ siteUrl: `http://127.0.0.1:${site.port}`, username: 'u', appPassword: 'p' }, {});
    expect(await failMessage(adapter.test())).toMatch(/^blocked_address: /);
    expect(site.hits.length).toBe(before);
    // Tekrar cagrilabilir; sifirlanmissa yeniden kaydeder
    setAdapterFetch(null);
    registerAdapterEgressGuard();
    expect(await failMessage(adapter.test())).toMatch(/^blocked_address: /);
  });
});

describe('FTP/SFTP sunucu adi cozucusu', () => {
  const resolver = makeGuardedHostResolver(testPolicy);

  it('yazili ozel IP reddedilir, genel IP aynen doner', async () => {
    expect(await failMessage(resolver('10.0.0.4'))).toMatch(/^blocked_address: /);
    expect(await failMessage(resolver('169.254.169.254'))).toMatch(/^blocked_address: /);
    expect(await resolver('185.10.20.30')).toBe('185.10.20.30');
  });

  it('ad simdi cozulur: ic adrese cikiyorsa reddedilir (IP mesajda yok), degilse DENETLENEN IP doner', async () => {
    const msg = await failMessage(resolver('ic-servis.test'));
    expect(msg).toMatch(/^blocked_address: .*ic-servis\.test/);
    expect(msg).not.toContain('10.0.0.9');
    expect(await resolver('localhost')).toBe('127.0.0.1');
    expect(await failMessage(resolver('yok.test'))).toMatch(/^dns: /);
    expect(await failMessage(resolver('  '))).toMatch(/^dns: /);
  });
});

describe('sanitizeErrorText', () => {
  it('IP ve localhost maskelenir; surum numarasi ve saat dokunulmaz', () => {
    expect(sanitizeErrorText('nginx/1.18.0 saat 12:30:45 — 192.168.1.10:8080, fe80::1, [2001:db8::5]:443, localhost'))
      .toBe('nginx/1.18.0 saat 12:30:45 — [adres], [adres], [adres], [adres]');
  });

  it('uzun metin kesilir', () => {
    const s = sanitizeErrorText('a'.repeat(500), 50);
    expect(s.length).toBe(50);
    expect(s.endsWith('…')).toBe(true);
  });
});
