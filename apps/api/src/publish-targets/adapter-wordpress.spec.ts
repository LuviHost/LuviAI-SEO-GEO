import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WordPressRestAdapter, WordPressXmlrpcAdapter, setAdapterFetch, wordPressCategoryIds } from '@luviai/adapters';
import { isBlockedAddress } from '../common/safe-fetch.js';
import { makeGuardedAdapterFetch } from './adapter-egress.js';

/**
 * WordPress adaptorleri — baglanti testi ve yayin sonucu (yerel sahte WordPress).
 *
 * NEDEN VAR:
 *  - XML-RPC test() xmlrpc.php'ye GET atiyordu; WordPress POST disina 405 doner
 *    (class-IXR-server.php serve()) — calisan sitede de "basarisiz" diyordu.
 *  - XML-RPC publish() basariyi <int> ile ariyordu: WordPress yazi kimligini
 *    <string> doner (mw_newPost: return (string) $post_id) → olusan yazi
 *    "basarisiz" sayiliyordu; hata yanitindaki faultCode ise <int>403</int> →
 *    yanlis sifre "403 numarali yazi yayinlandi" oluyordu.
 *  - REST test() kimliksiz GET /wp-json/wp/v2 atiyordu: yanlis sifre de geciyordu.
 *  - Katalogdaki "Kategori ID" adaptore hic ulasmiyordu.
 *
 * Istekler uretimdeki korumali fetch'ten (adapter-egress.ts) gecer; politika
 * yalniz test sunucusunun 127.0.0.1'ini serbest birakir. Sunucu yanitlari
 * WordPress kaynagindaki bicimle yazildi (IXR_Server::serve, IXR_Error::getXml,
 * WP_REST_Users_Controller::get_current_item).
 */

type Hit = { method: string; url: string; body: string; headers: http.IncomingHttpHeaders };

const USER = 'editor';
// XML ozel karakterleri: kacis yanlissa sunucu farkli sifre gorur
const PASS = 'abcd efgh <ijkl> & "mn\'op"';
const APP_PASS = 'abcd efgh ijkl mnop qrst uvwx';

const unescapeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const xmlStrings = (body: string) => [...body.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unescapeXml(m[1]));

/** IXR_Server::serve basari sablonu */
const ixrSuccess = (valueXml: string) => `<?xml version="1.0" encoding="UTF-8"?>
<methodResponse>
  <params>
    <param>
      <value>
      ${valueXml}
      </value>
    </param>
  </params>
</methodResponse>`;

/** IXR_Error::getXml — HTTP 200 ile doner */
const ixrFault = (code: number, message: string) => `<?xml version="1.0" encoding="UTF-8"?>
<methodResponse>
  <fault>
    <value>
      <struct>
        <member>
          <name>faultCode</name>
          <value><int>${code}</int></value>
        </member>
        <member>
          <name>faultString</name>
          <value><string>${message}</string></value>
        </member>
      </struct>
    </value>
  </fault>
</methodResponse>`;

const USERS_BLOGS = ixrSuccess(`<array><data>
  <value><struct>
  <member><name>isAdmin</name><value><boolean>1</boolean></value></member>
  <member><name>url</name><value><string>http://ornek.test/</string></value></member>
  <member><name>blogid</name><value><string>1</string></value></member>
  <member><name>blogName</name><value><string>Örnek Blog</string></value></member>
  <member><name>xmlrpc</name><value><string>http://ornek.test/xmlrpc.php</string></value></member>
</struct></value>
</data></array>`);

let wp: { server: http.Server; port: number; hits: Hit[] };
let lastPostBody: any = null;

function xmlrpcHandler(req: http.IncomingMessage, body: string, res: http.ServerResponse) {
  if (req.method !== 'POST') {
    // class-IXR-server.php serve(): POST disi
    res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain' });
    res.end('XML-RPC server accepts POST requests only.');
    return;
  }
  const method = body.match(/<methodName>([^<]+)<\/methodName>/)?.[1];
  const strings = xmlStrings(body);
  const xml = (s: string) => { res.writeHead(200, { 'content-type': 'text/xml; charset=UTF-8' }); res.end(s); };
  if (method === 'wp.getUsersBlogs') {
    return xml(strings[0] === USER && strings[1] === PASS ? USERS_BLOGS : ixrFault(403, 'Incorrect username or password.'));
  }
  if (method === 'metaWeblog.newPost') {
    // parametreler: blogid (int), kullanici, sifre, icerik...
    return xml(strings[0] === USER && strings[1] === PASS ? ixrSuccess('<string>123</string>') : ixrFault(403, 'Incorrect username or password.'));
  }
  return xml(ixrFault(-32601, 'server error. requested method does not exist.'));
}

function restHandler(req: http.IncomingMessage, body: string, res: http.ServerResponse) {
  const json = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  const expected = `Basic ${Buffer.from(`${USER}:${APP_PASS}`).toString('base64')}`;
  const authed = req.headers.authorization === expected;
  const path = (req.url ?? '').split('?')[0];
  // Kimliksiz okunabilen indeks — eski test buraya gidip yanlis sifrede de 200 aliyordu
  if (path.endsWith('/wp-json/wp/v2') && req.method === 'GET') return json(200, { namespace: 'wp/v2', routes: {} });
  if (path.endsWith('/wp-json/wp/v2/users/me') && req.method === 'GET') {
    // WP_REST_Users_Controller::get_current_item
    return authed ? json(200, { id: 1, name: 'Editör' }) : json(401, { code: 'rest_not_logged_in', message: 'You are not currently logged in.', data: { status: 401 } });
  }
  if (path.endsWith('/wp-json/wp/v2/posts') && req.method === 'POST') {
    if (!authed) return json(401, { code: 'rest_cannot_create', message: 'Sorry, you are not allowed to create posts as this user.' });
    lastPostBody = JSON.parse(body);
    return json(201, { id: 55, link: 'http://ornek.test/yazi/' });
  }
  // Yerinde guncelleme (I-1): 55 numarali yazi var; digerleri silinmis
  const single = path.match(/\/wp-json\/wp\/v2\/posts\/(\d+)$/);
  if (single) {
    if (!authed) return json(401, { code: 'rest_forbidden_context', message: 'Sorry, you are not allowed to edit this post.' });
    if (single[1] !== '55') return json(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.', data: { status: 404 } });
    // slug / type / modified_gmt: yerinde guncellemenin kimlik ve cakisma denetimi okur
    // (modified_gmt WordPress bicimi: saat dilimsiz GMT; POST'ta ilerler)
    if (req.method === 'GET') return json(200, { id: 55, status: 'publish', link: 'http://ornek.test/yazi/', slug: 'yazi', type: 'post', featured_media: 0, modified_gmt: '2026-09-01T10:00:00' });
    if (req.method === 'POST') {
      lastPostBody = JSON.parse(body);
      return json(200, { id: 55, status: 'publish', link: 'http://ornek.test/yazi/', slug: 'yazi', modified_gmt: '2026-10-18T09:00:00' });
    }
  }
  return json(404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.' });
}

beforeAll(async () => {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hits.push({ method: req.method ?? '', url: req.url ?? '', body, headers: req.headers });
      const u = req.url ?? '';
      // xmlrpc.php'yi engelleyip 200 HTML donen guvenlik eklentisi
      if (u.startsWith('/engelli/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>Erişim engellendi</body></html>'); return; }
      // http→https / www yonlendirmesi
      if (u.startsWith('/tasindi/')) { res.writeHead(301, { location: `https://www.ornek.com${u.replace('/tasindi', '')}` }); res.end(); return; }
      // Yanit bicimi bozuk XML-RPC (ne basari ne hata)
      if (u.startsWith('/bozuk/')) { res.writeHead(200, { 'content-type': 'text/xml' }); res.end('<?xml version="1.0"?><methodResponse></methodResponse>'); return; }
      if (u.endsWith('/xmlrpc.php')) return xmlrpcHandler(req, body, res);
      return restHandler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  wp = { server, port: (server.address() as AddressInfo).port, hits };
  // Uretim korumasi; yalniz test sunucusu (127.0.0.1) serbest
  setAdapterFetch(makeGuardedAdapterFetch({
    isBlocked: (ip) => ip !== '127.0.0.1' && isBlockedAddress(ip),
    ipv4Only: true,
    resolveHost: async () => { throw new Error('ENOTFOUND'); },
  }));
});

afterAll(async () => {
  setAdapterFetch(null);
  await new Promise<void>((r) => wp.server.close(() => r()));
});

afterEach(() => { lastPostBody = null; });

const base = () => `http://127.0.0.1:${wp.port}`;
const hitsSince = (n: number) => wp.hits.slice(n);
const failMessage = async (p: Promise<unknown>) => {
  try { return `gecti: ${String(await p)}`; } catch (e) { return (e as Error).message; }
};
const payload = { slug: 'yazi', title: 'Yazı & <Başlık>', bodyHtml: '<p>x</p>', bodyMd: 'x' };

describe('WordPress XML-RPC — test()', () => {
  it('POST wp.getUsersBlogs ile kimligi dogrular; kullanici/sifre XML kacisiyla dogru ulasir', async () => {
    const n = wp.hits.length;
    expect(await new WordPressXmlrpcAdapter({ siteUrl: base(), username: USER, password: PASS }, {}).test()).toBe(true);
    const [hit] = hitsSince(n);
    expect(hit.method).toBe('POST');
    expect(hit.url).toBe('/xmlrpc.php');
    expect(hit.headers['content-type']).toMatch(/^text\/xml/);
    expect(hit.body).toContain('<methodName>wp.getUsersBlogs</methodName>');
    expect(hit.body).not.toContain(PASS); // ham hali gitmez, kacisli gider
  });

  it('yanlis sifre: WordPress HTTP 200 + <fault> 403 doner → false', async () => {
    expect(await new WordPressXmlrpcAdapter({ siteUrl: base(), username: USER, password: 'yanlis' }, {}).test()).toBe(false);
  });

  it('xmlrpc.php engellenip 200 HTML donerse basarili sayilmaz', async () => {
    expect(await new WordPressXmlrpcAdapter({ siteUrl: `${base()}/engelli`, username: USER, password: PASS }, {}).test()).toBe(false);
  });

  it('yonlendirmede (http→https, www) ne yapilacagi soylenir; yonlendirme izlenmez', async () => {
    const n = wp.hits.length;
    const msg = await failMessage(new WordPressXmlrpcAdapter({ siteUrl: `${base()}/tasindi`, username: USER, password: PASS }, {}).test());
    expect(msg).toMatch(/^hedef adres isteği başka bir adrese yönlendiriyor \(https:\/\/www\.ornek\.com\/xmlrpc\.php\)/);
    expect(hitsSince(n)).toHaveLength(1);
  });

  it('eksik kimlikte istek atmaz; sondaki "/" cift egik cizgi uretmez', async () => {
    const n = wp.hits.length;
    expect(await new WordPressXmlrpcAdapter({ siteUrl: base(), username: USER }, {}).test()).toBe(false);
    expect(hitsSince(n)).toHaveLength(0);
    expect(await new WordPressXmlrpcAdapter({ siteUrl: `${base()}/`, username: USER, password: PASS }, {}).test()).toBe(true);
    expect(hitsSince(n)[0].url).toBe('/xmlrpc.php');
  });
});

describe('WordPress XML-RPC — publish() sonucu', () => {
  it('<string>123</string> basaridir (eskiden "Unknown XML-RPC error" diyordu, yazi yine de olusuyordu)', async () => {
    const n = wp.hits.length;
    const r = await new WordPressXmlrpcAdapter({ siteUrl: `${base()}/`, username: USER, password: PASS }, {}).publish(payload);
    // Bu sahte sunucu wp.getPost bilmez: olusturma damgasi okunamaz, yayin yine basarili (damgasiz)
    expect(r).toEqual({ ok: true, externalId: '123', externalUrl: `${base()}/?p=123` });
    const sent = hitsSince(n).find((h) => h.body.includes('<methodName>metaWeblog.newPost</methodName>'))?.body ?? '';
    expect(sent).toContain('<methodName>metaWeblog.newPost</methodName>');
    expect(xmlStrings(sent)).toContain('Yazı & <Başlık>');
    // Damga okumasi yeni yazidan sonra (yalniz okuma)
    expect(hitsSince(n).map((h) => h.body.match(/<methodName>([^<]+)<\/methodName>/)?.[1])).toEqual(['metaWeblog.newPost', 'wp.getPost']);
  });

  it('<fault> 403 basarisizliktir ve WordPress metni gosterilir (eskiden faultCode "yazi 403" sayiliyordu)', async () => {
    const r = await new WordPressXmlrpcAdapter({ siteUrl: base(), username: USER, password: 'yanlis' }, {}).publish(payload);
    expect(r).toEqual({ ok: false, error: 'XML-RPC: Incorrect username or password.' });
  });

  it('ne basari ne hata olan yanit basari sayilmaz', async () => {
    const r = await new WordPressXmlrpcAdapter({ siteUrl: `${base()}/bozuk`, username: USER, password: PASS }, {}).publish(payload);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^XML-RPC yanıtı anlaşılamadı/);
  });

  it('eksik kimlikte istek atmadan net hata', async () => {
    const n = wp.hits.length;
    const r = await new WordPressXmlrpcAdapter({ username: USER, password: PASS }, {}).publish(payload);
    expect(r).toEqual({ ok: false, error: 'WordPress XML-RPC bilgileri eksik — yayın hedefini düzenleyip Site URL, kullanıcı ve şifreyi girin.' });
    expect(hitsSince(n)).toHaveLength(0);
  });
});

describe('WordPress REST — test()', () => {
  it('GET /wp-json/wp/v2/users/me, Basic auth (uygulama sifresi) → 200 ise true', async () => {
    const n = wp.hits.length;
    expect(await new WordPressRestAdapter({ siteUrl: `${base()}/`, username: USER, appPassword: APP_PASS }, {}).test()).toBe(true);
    const [hit] = hitsSince(n);
    expect(hit.method).toBe('GET');
    expect(hit.url).toBe('/wp-json/wp/v2/users/me');
    expect(hit.headers.authorization).toBe(`Basic ${Buffer.from(`${USER}:${APP_PASS}`).toString('base64')}`);
  });

  it('yanlis uygulama sifresi → 401 → false (eski kimliksiz test burada da "basarili" derdi)', async () => {
    expect(await new WordPressRestAdapter({ siteUrl: base(), username: USER, appPassword: 'yanlis' }, {}).test()).toBe(false);
  });

  it('eksik kimlikte istek atmaz', async () => {
    const n = wp.hits.length;
    expect(await new WordPressRestAdapter({ siteUrl: base(), username: USER }, {}).test()).toBe(false);
    expect(hitsSince(n)).toHaveLength(0);
  });

  it('bilinmeyen adresi 200 HTML ile karsilayan site "dogrulandi" sayilmaz (gercek kullanici kaydi gerekir)', async () => {
    expect(await new WordPressRestAdapter({ siteUrl: `${base()}/engelli`, username: USER, appPassword: APP_PASS }, {}).test()).toBe(false);
  });

  it('yonlendirme izlenmez (kimlik dusup yaniltici 401 olurdu); ne yapilacagi soylenir', async () => {
    const n = wp.hits.length;
    const msg = await failMessage(new WordPressRestAdapter({ siteUrl: `${base()}/tasindi`, username: USER, appPassword: APP_PASS }, {}).test());
    expect(msg).toMatch(/^hedef adres isteği başka bir adrese yönlendiriyor \(https:\/\/www\.ornek\.com\/wp-json\/wp\/v2\/users\/me\)/);
    expect(hitsSince(n)).toHaveLength(1);
  });
});

describe('WordPress REST — publish() kategori', () => {
  const publish = (config: Record<string, unknown>) =>
    new WordPressRestAdapter({ siteUrl: `${base()}/`, username: USER, appPassword: APP_PASS }, config).publish(payload);

  it('Kategori ID gonderilir: "12" → [12], "12, 15" → [12, 15] (WP REST tamsayi dizisi bekler)', async () => {
    expect(await publish({ categoryId: '12' })).toEqual({ ok: true, externalId: '55', externalUrl: 'http://ornek.test/yazi/' });
    expect(lastPostBody.categories).toEqual([12]);
    await publish({ categoryId: '12, 15' });
    expect(lastPostBody.categories).toEqual([12, 15]);
    expect(wp.hits[wp.hits.length - 1].url).toBe('/wp-json/wp/v2/posts');
  });

  it('bos kategori gonderilmez (WordPress varsayilan kategoriyi kullanir)', async () => {
    await publish({ categoryId: '' });
    expect(lastPostBody).not.toHaveProperty('categories');
    await publish({});
    expect(lastPostBody).not.toHaveProperty('categories');
  });

  it('eski kayitta kalmis kategori ADI yayini durdurmaz (kayitta artik reddediliyor), kategori gonderilmez', async () => {
    const r = await publish({ categoryId: 'Haberler' });
    expect(r.ok).toBe(true);
    expect(lastPostBody).not.toHaveProperty('categories');
  });

  it('eksik kimlikte istek atmadan net hata', async () => {
    const n = wp.hits.length;
    const r = await new WordPressRestAdapter({ siteUrl: base(), username: USER }, {}).publish(payload);
    expect(r).toEqual({ ok: false, error: 'WordPress bilgileri eksik — yayın hedefini düzenleyip Site URL, kullanıcı adı ve App Password girin.' });
    expect(hitsSince(n)).toHaveLength(0);
  });
});

describe('WordPress REST — update() korumali fetch uzerinden (I-1)', () => {
  const adapter = (config: Record<string, unknown> = {}) =>
    new WordPressRestAdapter({ siteUrl: `${base()}/`, username: USER, appPassword: APP_PASS }, config);

  it('mevcut yaziyi gunceller: GET ?context=edit + POST /posts/55; yeni yazi (POST /posts) ACILMAZ, slug/status/kategori gonderilmez', async () => {
    const n = wp.hits.length;
    const r = await adapter({ categoryId: '12', postStatus: 'draft' })
      .update({ externalId: '55', externalUrl: 'http://ornek.test/yazi/', remoteModifiedAt: '2026-09-01T10:00:00.000Z' }, payload);
    expect(r).toEqual({ ok: true, externalId: '55', externalUrl: 'http://ornek.test/yazi/', status: 'publish', remoteModifiedAt: '2026-10-18T09:00:00.000Z' });
    expect(hitsSince(n).map((h) => `${h.method} ${h.url.split('?')[0]}`)).toEqual(['GET /wp-json/wp/v2/posts/55', 'POST /wp-json/wp/v2/posts/55']);
    expect(hitsSince(n)[0].url).toContain('context=edit');
    expect(Object.keys(lastPostBody).sort()).toEqual(['content', 'title']);
  });

  it('silinmis yazi (404 rest_post_invalid_id) notFound; yanlis uygulama sifresi notFound DEGIL', async () => {
    expect(await adapter().update({ externalId: '56' }, payload)).toMatchObject({ ok: false, notFound: true });
    const denied = await new WordPressRestAdapter({ siteUrl: base(), username: USER, appPassword: 'yanlis' }, {}).update({ externalId: '55' }, payload);
    expect(denied.ok).toBe(false);
    expect(denied.notFound).toBeUndefined();
  });
});

describe('wordPressCategoryIds — kayit ve yayinda ortak kural', () => {
  it('sayi, virgul/bosluk ayrimli liste ve dizi kabul; tekrarlar tekillesir', () => {
    expect(wordPressCategoryIds(undefined)).toEqual({ ok: true, ids: [] });
    expect(wordPressCategoryIds('  ')).toEqual({ ok: true, ids: [] });
    expect(wordPressCategoryIds(7)).toEqual({ ok: true, ids: [7] });
    expect(wordPressCategoryIds('12 15,12;3')).toEqual({ ok: true, ids: [12, 15, 3] });
    expect(wordPressCategoryIds([4, '9'])).toEqual({ ok: true, ids: [4, 9] });
  });

  it('kategori adi, sifir, ondalik ve negatif reddedilir', () => {
    for (const bad of ['Haberler', '0', '12.5', '-3', '12,abc', 0, 1.5, true, {}]) {
      expect(wordPressCategoryIds(bad).ok, String(bad)).toBe(false);
    }
  });
});
