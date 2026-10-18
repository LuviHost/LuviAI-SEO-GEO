import { describe, it, expect, vi, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import { GhostAdapter, StrapiAdapter, WhmcsKbAdapter } from '@luviai/adapters';
import { PublishTargetsService } from './publish-targets.service.js';

/**
 * Panel katalogu ↔ adaptor alan adlari (Ghost, Strapi, WHMCS).
 *
 * NEDEN VAR: panel formu alanlari katalogdan alir ve kimlik bilgisini o adlarla
 * kaydeder. Adaptorler baska adlar okuyordu (Ghost apiUrl/siteUrl, Strapi
 * baseUrl-token/strapiUrl-apiToken, WHMCS baseUrl-apiIdentifier-apiSecret/
 * whmcsUrl-identifier-secret): panelden eklenen bu hedefler adres bulamayip hic
 * calismiyordu. Katalog adi once, eski ad sonra okunur.
 *
 * NOT: '@luviai/adapters' packages/adapters/dist'e cozulur. Adaptor kaynagi
 * degisince once `cd packages/adapters && pnpm build` (deploy sirasi da bu).
 * Gercek ag yok: global fetch sahte (kayitli korumali fetch yokken adaptorler
 * global fetch'i cagri aninda okur — transport.ts).
 */

type Call = { url: string; init?: RequestInit };

function stubFetch(body: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}

const header = (c: Call, name: string) => new Headers(c.init?.headers).get(name);
const form = (c: Call) => new URLSearchParams(String(c.init?.body ?? ''));

const catalog = PublishTargetsService.getTypeCatalog({ isAdmin: true });
const fieldKeys = (type: string) => catalog.find((c) => c.type === type)!.fields.map((f) => f.key);
const configKeys = (type: string) => catalog.find((c) => c.type === type)!.configFields.map((f) => f.key);

const GHOST_ID = '6489e2e0c9a1f2a3b4c5d6e7';
const GHOST_SECRET = 'a1'.repeat(32);
const GHOST_KEY = `${GHOST_ID}:${GHOST_SECRET}`;

afterEach(() => vi.unstubAllGlobals());

describe('Ghost — katalog alanlari (apiUrl, adminApiKey)', () => {
  it('katalog bu adlari tasiyor', () => {
    expect(fieldKeys('GHOST')).toEqual(['apiUrl', 'adminApiKey']);
  });

  it('test() kimlik isteyen uca gider (/site/ herkese acikti, yanlis anahtar da gecerdi) ve JWT dogru imzali', async () => {
    const calls = stubFetch({ posts: [] });
    expect(await new GhostAdapter({ apiUrl: 'https://blog.ornek.com/', adminApiKey: GHOST_KEY }, {}).test()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://blog.ornek.com/ghost/api/admin/posts/?limit=1');

    const token = String(header(calls[0], 'authorization')).replace(/^Ghost /, '');
    const [h, p, sig] = token.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toMatchObject({ alg: 'HS256', kid: GHOST_ID });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toMatchObject({ aud: '/admin/' });
    const expected = crypto.createHmac('sha256', Buffer.from(GHOST_SECRET, 'hex')).update(`${h}.${p}`).digest('base64url');
    expect(sig).toBe(expected);
  });

  it('401 → false', async () => {
    stubFetch({ errors: [{ message: 'Invalid token' }] }, 401);
    expect(await new GhostAdapter({ apiUrl: 'https://blog.ornek.com', adminApiKey: GHOST_KEY }, {}).test()).toBe(false);
  });

  it('publish katalog adresine yazar; eski siteUrl kaydi da calisir, ikisi varsa katalog adi kazanir', async () => {
    let calls = stubFetch({ posts: [{ id: 'p1', url: 'https://blog.ornek.com/yazi/' }] });
    const res = await new GhostAdapter({ apiUrl: 'https://blog.ornek.com', adminApiKey: GHOST_KEY }, {})
      .publish({ slug: 'yazi', title: 'Yazı', bodyHtml: '<p>x</p>', bodyMd: 'x' });
    expect(res).toEqual({ ok: true, externalId: 'p1', externalUrl: 'https://blog.ornek.com/yazi/' });
    expect(calls[0].url).toBe('https://blog.ornek.com/ghost/api/admin/posts/?source=html');
    expect(calls[0].init?.method).toBe('POST');

    calls = stubFetch({ posts: [] });
    await new GhostAdapter({ siteUrl: 'https://eski.ornek.com', adminApiKey: GHOST_KEY }, {}).test();
    expect(calls[0].url).toBe('https://eski.ornek.com/ghost/api/admin/posts/?limit=1');

    calls = stubFetch({ posts: [] });
    await new GhostAdapter({ apiUrl: 'https://yeni.ornek.com', siteUrl: 'https://eski.ornek.com', adminApiKey: GHOST_KEY }, {}).test();
    expect(calls[0].url).toBe('https://yeni.ornek.com/ghost/api/admin/posts/?limit=1');
  });

  it("bicimsiz anahtar istek atmadan net hata verir ('id:secret', secret onaltilik)", async () => {
    const calls = stubFetch({});
    expect(await new GhostAdapter({ apiUrl: 'https://blog.ornek.com', adminApiKey: 'anahtar' }, {}).test()).toBe(false);
    const res = await new GhostAdapter({ apiUrl: 'https://blog.ornek.com', adminApiKey: `${GHOST_ID}:zz` }, {})
      .publish({ slug: 'y', title: 'Y', bodyHtml: '', bodyMd: '' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("'id:secret'");
    expect(calls).toHaveLength(0);
  });
});

describe('Strapi — katalog alanlari (baseUrl, token; config.collection)', () => {
  it('katalog bu adlari tasiyor', () => {
    expect(fieldKeys('STRAPI')).toEqual(['baseUrl', 'token']);
    expect(configKeys('STRAPI')).toEqual(['collection']);
  });

  it('test() token + koleksiyonu dogrular (GET /api diye bir uc yok, eski test hep basarisizdi)', async () => {
    const calls = stubFetch({ data: [] });
    expect(await new StrapiAdapter({ baseUrl: 'https://cms.ornek.com/', token: 'tkn' }, { collection: 'blog-posts' }).test()).toBe(true);
    expect(calls[0].url).toBe('https://cms.ornek.com/api/blog-posts?pagination[pageSize]=1');
    expect(header(calls[0], 'authorization')).toBe('Bearer tkn');
  });

  it('publish katalog adlariyla yazar; eski strapiUrl/apiToken/contentType kaydi da calisir', async () => {
    let calls = stubFetch({ data: { id: 7 } });
    const res = await new StrapiAdapter({ baseUrl: 'https://cms.ornek.com', token: 'tkn' }, { collection: 'blog-posts' })
      .publish({ slug: 'yazi', title: 'Yazı', bodyHtml: '<p>x</p>', bodyMd: 'x' });
    expect(res.ok).toBe(true);
    expect(res.externalId).toBe('7');
    expect(calls[0].url).toBe('https://cms.ornek.com/api/blog-posts');
    expect(header(calls[0], 'authorization')).toBe('Bearer tkn');

    calls = stubFetch({ data: [] });
    await new StrapiAdapter({ strapiUrl: 'https://eski.ornek.com', apiToken: 'eski' }, { contentType: 'posts' }).test();
    expect(calls[0].url).toBe('https://eski.ornek.com/api/posts?pagination[pageSize]=1');
    expect(header(calls[0], 'authorization')).toBe('Bearer eski');
  });

  it('yola girecek koleksiyon adi denetlenir; eksik token istek atmadan hata', async () => {
    const calls = stubFetch({});
    expect(await new StrapiAdapter({ baseUrl: 'https://cms.ornek.com', token: 'tkn' }, { collection: '../admin' }).test()).toBe(false);
    const res = await new StrapiAdapter({ baseUrl: 'https://cms.ornek.com' }, { collection: 'articles' })
      .publish({ slug: 'y', title: 'Y', bodyHtml: '', bodyMd: '' });
    expect(res).toEqual({ ok: false, error: 'Strapi API token eksik — yayın hedefini düzenleyip token girin.' });
    expect(calls).toHaveLength(0);
  });
});

describe('WHMCS — katalog alanlari (baseUrl, apiIdentifier, apiSecret, accessKey)', () => {
  it('katalog bu adlari tasiyor (erisim anahtari istege bagli)', () => {
    expect(fieldKeys('WHMCS_KB')).toEqual(['baseUrl', 'apiIdentifier', 'apiSecret', 'accessKey']);
    const ak = catalog.find((c) => c.type === 'WHMCS_KB')!.fields.find((f) => f.key === 'accessKey')!;
    expect(ak.required).toBe(false);
  });

  it('test() kimlik + erisim anahtarini gonderir (IP kisitini anahtarla asan kurulum)', async () => {
    const calls = stubFetch({ result: 'success' });
    const ok = await new WhmcsKbAdapter(
      { baseUrl: 'https://destek.ornek.com/', apiIdentifier: 'KIM', apiSecret: 'SIR', accessKey: 'ANAHTAR' }, {},
    ).test();
    expect(ok).toBe(true);
    expect(calls[0].url).toBe('https://destek.ornek.com/includes/api.php');
    const body = form(calls[0]);
    expect(body.get('action')).toBe('GetActivityLog');
    expect(body.get('identifier')).toBe('KIM');
    expect(body.get('secret')).toBe('SIR');
    expect(body.get('accesskey')).toBe('ANAHTAR');
  });

  it('publish katalog adlariyla yazar; eski whmcsUrl/identifier/secret kaydi da calisir', async () => {
    let calls = stubFetch({ result: 'success', articleid: 42 });
    const res = await new WhmcsKbAdapter({ baseUrl: 'https://destek.ornek.com', apiIdentifier: 'KIM', apiSecret: 'SIR' }, { categoryId: 3 })
      .publish({ slug: 'yazi', title: 'Yazı', bodyHtml: '<p>x</p>', bodyMd: 'x' });
    expect(res).toEqual({ ok: true, externalId: '42', externalUrl: 'https://destek.ornek.com/index.php?rp=/knowledgebase/42' });
    const body = form(calls[0]);
    expect(body.get('action')).toBe('AddKBArticle');
    expect(body.get('identifier')).toBe('KIM');
    expect(body.get('secret')).toBe('SIR');
    expect(body.get('categoryid')).toBe('3');
    expect(body.has('accesskey')).toBe(false);

    calls = stubFetch({ result: 'success' });
    await new WhmcsKbAdapter({ whmcsUrl: 'https://eski.ornek.com', identifier: 'E', secret: 'S' }, {}).test();
    expect(calls[0].url).toBe('https://eski.ornek.com/includes/api.php');
    expect(form(calls[0]).get('identifier')).toBe('E');
  });

  it('eksik kimlik istek atmadan net hata; "undefined" dizesi WHMCS e gitmez', async () => {
    const calls = stubFetch({});
    const res = await new WhmcsKbAdapter({ baseUrl: 'https://destek.ornek.com', apiIdentifier: 'KIM' }, {})
      .publish({ slug: 'y', title: 'Y', bodyHtml: '', bodyMd: '' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('API Secret');
    expect(await new WhmcsKbAdapter({ baseUrl: 'https://destek.ornek.com' }, {}).test()).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
