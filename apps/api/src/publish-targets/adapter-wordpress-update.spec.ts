import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { WordPressRestAdapter, WordPressXmlrpcAdapter, setAdapterFetch, wordPressPostId, wordPressUrlSlug } from '@luviai/adapters';

/**
 * WordPress yerinde guncelleme (I-1) — adaptor update().
 *
 * NEDEN VAR: yayindaki yazinin yeniden yayini publish() ile YENI yazi
 * aciyordu (/yazi-2/), eski adres eski metinle kaliyordu. update() mevcut
 * yaziyi gunceller: REST POST /wp/v2/posts/<id> (once GET ?context=edit),
 * XML-RPC wp.getPost + wp.editPost. Adres (slug), durum, yazar, tarih ve
 * kategoriler GONDERILMEZ. Silinmis yazi notFound, cop kutusundaki yazi
 * trashed doner; diger hatalar ikisi de degildir (cagiran yeni yazi acmaz).
 *
 * Yazmadan once iki denetim (R2 / R3-R6-R8):
 *  - kimlik: kayitli kimlikteki yazinin slug'i (ve turu) BU yaziya ait olmali;
 *    degilse mismatch — hicbir sey yazilmaz, notFound da degil (kopya acilmaz);
 *  - cakisma: yazinin modified_gmt'si RanksUp'in son yaziminden sonra
 *    degistiyse edited — musterinin duzenlemesi ezilmez; yalniz force ile yazilir.
 *
 * Sahte fetch adaptorlerin tek ag kapisindan (transport adapterFetch) kaydedilir;
 * yanit bicimleri WordPress kaynagindaki gibi (rest_post_invalid_id 404,
 * modified_gmt saat dilimsiz GMT "Y-m-d\TH:i:s", IXR_Error faultCode/faultString,
 * IXR_Date <dateTime.iso8601>Ymd\TH:i:s</dateTime.iso8601>, wp_editPost `return true;`).
 */

type Req = { method: string; url: string; path: string; search: URLSearchParams; headers: Record<string, string>; body: string };
let reqs: Req[] = [];
let handler: (r: Req) => Response | Promise<Response> = () => new Response('yok', { status: 500 });

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const xml = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/xml; charset=UTF-8' } });

setAdapterFetch(async (url, init) => {
  const u = new URL(url);
  const headers: Record<string, string> = {};
  new Headers(init?.headers as HeadersInit | undefined).forEach((v, k) => { headers[k] = v; });
  const body = typeof init?.body === 'string' ? init.body : init?.body ? '[ikili]' : '';
  const r: Req = { method: (init?.method ?? 'GET').toUpperCase(), url, path: u.pathname, search: u.searchParams, headers, body };
  reqs.push(r);
  return handler(r);
});
afterAll(() => setAdapterFetch(null));
beforeEach(() => { reqs = []; });

const SITE = 'https://ornek.example';
const CREDS = { siteUrl: `${SITE}/`, username: 'editor', appPassword: 'abcd efgh ijkl' };
const AUTH = `Basic ${Buffer.from('editor:abcd efgh ijkl').toString('base64')}`;
const payload = {
  slug: 'yazi', title: 'Güncel Başlık', bodyMd: 'x',
  bodyHtml: '<img src="https://cdn.example/hero.jpg" alt="kapak" class="hero">\n<p>Güncel metin</p>',
  metaDescription: 'Güncel özet', heroImageUrl: 'https://cdn.example/hero.jpg',
};
/** RanksUp'in son yaziminin yanitindaki modified_gmt (WordPress bicimi: saat dilimsiz GMT) */
const WRITTEN_GMT = '2026-09-01T10:00:00';
/** Yayincinin kayittan verdigi damga (publishedTo remoteModifiedAt, ISO) */
const STAMP = { remoteModifiedAt: '2026-09-01T10:00:00.000Z' };
/** WordPress'in POST sonrasi ilerlettigi damga */
const AFTER_POST_GMT = '2026-10-18T09:00:00';
const POST_41 = { id: 41, status: 'publish', link: `${SITE}/yazi/`, slug: 'yazi', type: 'post', featured_media: 0, modified_gmt: WRITTEN_GMT };

/**
 * Sahte WordPress: 41 numarali yazi (varsayilan yayinda). GET _fields'i uygular
 * (rest_filter_response_fields); POST, WordPress gibi yalniz gonderilen
 * alanlari degistirir, modified_gmt'yi ilerletir ve kaydin tamamini doner.
 */
function restWp(over: { stored?: Record<string, unknown>; get?: (r: Req) => Response; post?: (r: Req) => Response; list?: (r: Req) => Response } = {}) {
  const stored: Record<string, unknown> = { ...POST_41, ...over.stored };
  return (r: Req): Response => {
    if (r.method === 'GET' && r.path === '/wp-json/wp/v2/posts/41') {
      if (over.get) return over.get(r);
      const fields = r.search.get('_fields');
      return json(200, fields ? Object.fromEntries(fields.split(',').filter((k) => k in stored).map((k) => [k, stored[k]])) : stored);
    }
    if (r.method === 'POST' && r.path === '/wp-json/wp/v2/posts/41') {
      if (over.post) return over.post(r);
      Object.assign(stored, JSON.parse(r.body), { modified_gmt: AFTER_POST_GMT });
      return json(200, { ...stored, title: { raw: 'x' }, content: { raw: 'x' } });
    }
    if (r.method === 'GET' && (r.path === '/wp-json/wp/v2/posts' || r.path === '/wp-json/wp/v2/pages')) return over.list ? over.list(r) : json(200, []);
    if (r.method === 'POST' && r.path === '/wp-json/wp/v2/media') return json(201, { id: 900 });
    return json(404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.', data: { status: 404 } });
  };
}

const rest = (config: Record<string, unknown> = {}) => new WordPressRestAdapter(CREDS, config);
const REF = { externalId: '41', externalUrl: `${SITE}/yazi/`, ...STAMP };

describe('WordPress REST — update()', () => {
  it('GET ?context=edit (slug, tur, modified_gmt dahil), sonra POST /wp/v2/posts/41; govdede YALNIZ title/content/excerpt; yeni damga doner', async () => {
    handler = restWp();
    const r = await rest({ postStatus: 'draft', categoryId: '12, 15' }).update(REF, payload);
    expect(r).toEqual({ ok: true, externalId: '41', externalUrl: `${SITE}/yazi/`, status: 'publish', remoteModifiedAt: '2026-10-18T09:00:00.000Z' });
    expect(reqs.map((x) => `${x.method} ${x.path}`)).toEqual(['GET /wp-json/wp/v2/posts/41', 'POST /wp-json/wp/v2/posts/41']);
    expect(reqs[0].search.get('context')).toBe('edit');
    expect(reqs[0].search.get('_fields')?.split(',').sort()).toEqual(['featured_media', 'id', 'link', 'modified_gmt', 'slug', 'status', 'type']);
    expect(reqs.every((x) => x.headers.authorization === AUTH)).toBe(true);
    const sent = JSON.parse(reqs[1].body);
    expect(Object.keys(sent).sort()).toEqual(['content', 'excerpt', 'title']);
    expect(sent).toMatchObject({ title: 'Güncel Başlık', excerpt: 'Güncel özet' });
    expect(sent.content).toContain('<p>Güncel metin</p>');
    // Yeni yazi ACILMADI
    expect(reqs.some((x) => x.method === 'POST' && x.path === '/wp-json/wp/v2/posts')).toBe(false);
  });

  it('taslak yazi taslak kalir: status gonderilmez, sonuc hedefteki durumu bildirir (adres ?p=, kimlik yazinin slug\'iyla dogrulanir)', async () => {
    handler = restWp({ stored: { status: 'draft', link: `${SITE}/?p=41` } });
    const r = await rest().update({ externalId: '41', ...STAMP }, payload);
    expect(r).toMatchObject({ ok: true, status: 'draft', externalUrl: `${SITE}/?p=41` });
    expect(JSON.parse(reqs[1].body)).not.toHaveProperty('status');
  });

  it('404 rest_post_invalid_id ve 410: notFound (silinmis) — POST yapilmaz', async () => {
    handler = restWp({ get: () => json(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.', data: { status: 404 } }) });
    const r = await rest().update(REF, payload);
    expect(r).toMatchObject({ ok: false, notFound: true, externalId: '41' });
    expect(r.error).toMatch(/^WP REST 404/);
    expect(reqs).toHaveLength(1);

    reqs = [];
    handler = restWp({ get: () => new Response('Gone', { status: 410 }) });
    expect(await rest().update(REF, payload)).toMatchObject({ ok: false, notFound: true });
    expect(reqs).toHaveLength(1);
  });

  it('REST kapali / yanlis adres 404\'u (rest_no_route, HTML) silinmis SAYILMAZ: yeni yazi acilmasin', async () => {
    handler = restWp({ get: () => json(404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.' }) });
    const r = await rest().update(REF, payload);
    expect(r.ok).toBe(false);
    expect(r.notFound).toBeUndefined();
    handler = restWp({ get: () => new Response('<html>Sayfa bulunamadı</html>', { status: 404, headers: { 'content-type': 'text/html' } }) });
    expect((await rest().update(REF, payload)).notFound).toBeUndefined();
  });

  it('cop kutusundaki yazi (status trash, slug "__trashed" ekli): trashed — icerik yazilmaz', async () => {
    handler = restWp({ stored: { status: 'trash', slug: 'yazi__trashed' } });
    const r = await rest().update(REF, payload);
    expect(r).toMatchObject({ ok: false, trashed: true, status: 'trash', externalId: '41' });
    expect(reqs.map((x) => x.method)).toEqual(['GET']);
  });

  it('yetki yok (403 rest_forbidden_context): hata, notFound degil, POST yok', async () => {
    handler = restWp({ get: () => json(403, { code: 'rest_forbidden_context', message: 'Sorry, you are not allowed to edit this post.' }) });
    const r = await rest().update(REF, payload);
    expect(r).toMatchObject({ ok: false });
    expect(r.notFound).toBeUndefined();
    expect(r.error).toContain('WP REST 403');
    expect(reqs).toHaveLength(1);
  });

  it('POST sirasinda silinmisse notFound; 200 ama yazi kaydi degilse basari SAYILMAZ', async () => {
    handler = restWp({ post: () => json(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' }) });
    expect(await rest().update(REF, payload)).toMatchObject({ ok: false, notFound: true });
    handler = restWp({ post: () => new Response('<html>önbellek</html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
    const r = await rest().update(REF, payload);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('güncelleme doğrulanamadı');
  });

  it('externalId yoksa adresteki ?p= kimligi kullanilir', async () => {
    handler = restWp();
    const r = await rest().update({ externalUrl: `${SITE}/?p=41`, ...STAMP }, payload);
    expect(r.ok).toBe(true);
    expect(reqs[0].path).toBe('/wp-json/wp/v2/posts/41');
  });

  it('kimlik yoksa adresteki slug ile YALNIZ yazilarda (posts, status=any) aranir; bulunan kimlik guncellenir', async () => {
    handler = restWp({ list: (r) => (r.path.endsWith('/posts') && r.search.get('slug') === 'yazi' ? json(200, [{ id: 41, link: `${SITE}/yazi/` }]) : json(200, [])) });
    const r = await rest().update({ externalUrl: `${SITE}/2026/10/yazi/`, ...STAMP }, payload);
    expect(r).toMatchObject({ ok: true, externalId: '41' });
    expect(reqs[0].path).toBe('/wp-json/wp/v2/posts');
    expect(reqs[0].search.get('status')).toBe('any');
    expect(reqs.some((x) => x.path === '/wp-json/wp/v2/pages')).toBe(false);
  });

  it('slug ile bulunamazsa yeni yazi ACILMAZ (notFound degil — slug degismis olabilir); kok adreste on sayfaya dusulmez', async () => {
    handler = restWp();
    const r = await rest().update({ externalUrl: `${SITE}/yazi/` }, payload);
    expect(r.ok).toBe(false);
    expect(r.notFound).toBeUndefined();
    expect(r.error).toContain('kopya açmamak için güncellenmedi');

    reqs = [];
    const root = await rest().update({ externalUrl: `${SITE}/` }, payload);
    expect(root.ok).toBe(false);
    expect(root.error).toContain('kimliği ya da adresi kayıtlı değil');
    expect(reqs).toEqual([]);
  });

  it('yazinin one cikan gorseli varsa govdedeki hero <img> kaldirilir (cift gorsel olmasin); featured_media degismez', async () => {
    handler = restWp({ stored: { featured_media: 77 } });
    await rest().update(REF, payload);
    const sent = JSON.parse(reqs[1].body);
    expect(sent.content).not.toContain('hero.jpg');
    expect(sent).not.toHaveProperty('featured_media');

    // Yeni hero uretilmis olsa da mevcut one cikan gorsel (musterinin secimi olabilir) ezilmez, medya yuklenmez
    reqs = [];
    handler = restWp({ stored: { featured_media: 77 } });
    await rest().update(REF, { ...payload, heroImageBase64: Buffer.from('jpg').toString('base64'), heroImageFilename: 'h.jpg', heroImageMime: 'image/jpeg' });
    expect(reqs.map((x) => `${x.method} ${x.path}`)).toEqual(['GET /wp-json/wp/v2/posts/41', 'POST /wp-json/wp/v2/posts/41']);
    expect(JSON.parse(reqs[1].body)).not.toHaveProperty('featured_media');
  });

  it('one cikan gorsel yoksa hero govdede kalir; yeni hero verildiyse medyaya yuklenip featured_media yapilir', async () => {
    handler = restWp();
    await rest().update(REF, payload);
    expect(JSON.parse(reqs[1].body).content).toContain('hero.jpg');

    reqs = [];
    handler = restWp();
    await rest().update(REF, { ...payload, heroImageBase64: Buffer.from('jpg').toString('base64'), heroImageFilename: 'h.jpg', heroImageMime: 'image/jpeg' });
    expect(reqs.map((x) => `${x.method} ${x.path}`)).toEqual(['GET /wp-json/wp/v2/posts/41', 'POST /wp-json/wp/v2/media', 'POST /wp-json/wp/v2/posts/41']);
    const sent = JSON.parse(reqs[2].body);
    expect(sent.featured_media).toBe(900);
    expect(sent.content).not.toContain('hero.jpg');
  });

  it('ozet bossa gonderilmez (elle yazilmis ozet silinmesin); eksik kimlikte istek yok', async () => {
    handler = restWp();
    await rest().update(REF, { ...payload, metaDescription: undefined });
    expect(JSON.parse(reqs[1].body)).not.toHaveProperty('excerpt');

    reqs = [];
    const r = await new WordPressRestAdapter({ siteUrl: SITE, username: 'editor' }, {}).update(REF, payload);
    expect(r).toEqual({ ok: false, error: 'WordPress bilgileri eksik — yayın hedefini düzenleyip Site URL, kullanıcı adı ve App Password girin.' });
    expect(reqs).toEqual([]);
  });
});

describe('WordPress REST — update() kimlik denetimi (R2): kayitli kimlik baska bir yaziya aitse HICBIR SEY yazilmaz', () => {
  it('site tasindi / hedef baska WordPress\'e baglandi: #41 musterinin ilgisiz yazisi → mismatch, POST yok, notFound degil', async () => {
    // Kayit: kdv-beyani-rehberi; yeni sitede #41 "sirket-haberleri"
    handler = restWp({ stored: { slug: 'sirket-haberleri', link: `${SITE}/sirket-haberleri/` } });
    const r = await rest().update(
      { externalId: '41', externalUrl: 'https://staging.example/kdv-beyani-rehberi/', ...STAMP },
      { ...payload, slug: 'kdv-beyani-rehberi', title: 'KDV Beyanı Rehberi' },
    );
    expect(r).toMatchObject({ ok: false, mismatch: true, externalId: '41', remoteSlug: 'sirket-haberleri' });
    expect(r.notFound).toBeUndefined();
    expect(r.error).toContain('#41 numaralı yazı bu yazıyla eşleşmiyor');
    expect(r.error).toContain('sirket-haberleri');
    expect(r.error).toContain('kdv-beyani-rehberi');
    expect(reqs.map((x) => x.method)).toEqual(['GET']);
  });

  it('kimlik force (kullanicinin ustune yazma onayi) ile de asilmaz', async () => {
    handler = restWp({ stored: { slug: 'hakkimizda' } });
    const r = await rest().update(REF, payload, { force: true });
    expect(r).toMatchObject({ ok: false, mismatch: true });
    expect(reqs.map((x) => x.method)).toEqual(['GET']);
  });

  it('cop kutusundaki ILGISIZ yazi "bu yazi cop kutusunda" sanilmaz: once kimlik (mismatch, trashed degil)', async () => {
    handler = restWp({ stored: { status: 'trash', slug: 'baska-yazi__trashed' } });
    const r = await rest().update(REF, payload);
    expect(r).toMatchObject({ ok: false, mismatch: true });
    expect(r.trashed).toBeUndefined();
  });

  it('ayni yazi sayilanlar: adresteki slug ya da yazinin slug\'i, Turkce harf farki (remove_accents), "-2" eki; slug\'i bos yazi dogrulanamaz', async () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      // adres kalici baglanti; yazinin slug'i yeniden yazimda degismis (update slug gondermez)
      ['yazi', { externalUrl: `${SITE}/yazi/` }, { slug: 'yeni-slug' }],
      // taslaktan acilan kayit: adres ?p=, yazinin slug'i
      ['kdv-beyani-rehberi', { externalUrl: `${SITE}/?p=41` }, { slug: 'kdv-beyanı-rehberi' }],
      // musteri taslagi yayina aldi, ayni slug baska yazidaydi: WordPress "-2" ekledi
      ['kdv-beyani-rehberi-2', {}, { slug: 'kdv-beyani-rehberi' }],
      // kodlanmis Turkce slug
      ['%c3%a7ay-rehberi', {}, { slug: 'çay-rehberi' }],
    ];
    for (const [remote, ref, p] of cases) {
      reqs = [];
      handler = restWp({ stored: { slug: remote } });
      const r = await rest().update({ externalId: '41', ...STAMP, ...ref }, { ...payload, ...p });
      expect(r.ok, remote).toBe(true);
    }
    for (const [remote, slug] of [['kdv-beyani-rehberi-2026', 'kdv-beyani-rehberi'], ['', 'yazi'], ['yazi-rehberi', 'yazi']] as const) {
      reqs = [];
      handler = restWp({ stored: { slug: remote } });
      const r = await rest().update({ externalId: '41', ...STAMP }, { ...payload, slug });
      expect(r, `${remote} / ${slug}`).toMatchObject({ ok: false, mismatch: true });
      expect(reqs.map((x) => x.method)).toEqual(['GET']);
    }
  });

  it('kayitli adres sayisal kalici baglanti (/arsiv/41) slug sayilmaz: yazinin slug\'i aranir', async () => {
    handler = restWp({ stored: { slug: 'baska' } });
    const r = await rest().update({ externalId: '41', externalUrl: `${SITE}/arsiv/41`, ...STAMP }, payload);
    expect(r).toMatchObject({ ok: false, mismatch: true });
    expect(r.error).toContain('beklenen: yazi');
    expect(r.error).not.toContain('beklenen: 41');
  });
});

describe('WordPress REST — update() cakisma denetimi (R3/R6/R8): musterinin WordPress duzenlemesi ezilmez', () => {
  const editedPost = { modified_gmt: '2026-09-05T08:30:00', title: 'Müşterinin başlığı' };

  it('kayittaki damgadan sonra WordPress\'te degismis: edited, POST yok; Turkce neden ve WordPress damgasi doner', async () => {
    handler = restWp({ stored: editedPost });
    const r = await rest().update(REF, payload);
    expect(r).toMatchObject({ ok: false, edited: true, externalId: '41', status: 'publish', remoteModifiedAt: '2026-09-05T08:30:00.000Z' });
    expect(r.notFound).toBeUndefined();
    expect(r.error).toBe('WordPress yazısı RanksUp\'ın son yazımından sonra değiştirilmiş (son değişiklik: 05.09.2026 11:30); değişikliklerin üzerine yazılmadı.');
    expect(reqs.map((x) => x.method)).toEqual(['GET']);
  });

  it('force (kullanicinin acik onayi): ustune yazilir, yeni damga doner', async () => {
    handler = restWp({ stored: editedPost });
    const r = await rest().update(REF, payload, { force: true });
    expect(r).toMatchObject({ ok: true, remoteModifiedAt: '2026-10-18T09:00:00.000Z' });
    expect(reqs.map((x) => x.method)).toEqual(['GET', 'POST']);
  });

  it('damga ayni saniye: degismemis sayilir (milisaniye farki onemsiz); daha ESKI damga (yedekten donus) degisiklik sayilir', async () => {
    handler = restWp();
    expect((await rest().update({ ...REF, remoteModifiedAt: '2026-09-01T10:00:00.400Z' }, payload)).ok).toBe(true);
    handler = restWp({ stored: { modified_gmt: '2026-08-20T10:00:00' } });
    expect(await rest().update(REF, payload)).toMatchObject({ ok: false, edited: true });
  });

  it('eski kayit (damga yok): RanksUp\'in son yazim anina 2 dk saat payiyla bakilir', async () => {
    const ref = { externalId: '41', externalUrl: `${SITE}/yazi/` };
    // WordPress yazimi RanksUp'in kaydettigi andan once (normal: kayit yanittan sonra yazilir)
    handler = restWp({ stored: { modified_gmt: '2026-09-01T10:00:00' } });
    expect((await rest().update({ ...ref, lastWriteAt: '2026-09-01T10:00:03.000Z' }, payload)).ok).toBe(true);
    // WordPress saati 1 dk ileride: payin icinde, RanksUp'in kendi yazimi
    handler = restWp({ stored: { modified_gmt: '2026-09-01T10:01:00' } });
    expect((await rest().update({ ...ref, lastWriteAt: '2026-09-01T10:00:03.000Z' }, payload)).ok).toBe(true);
    // Gunler sonra duzenlenmis
    handler = restWp({ stored: { modified_gmt: '2026-09-03T12:00:00' } });
    expect(await rest().update({ ...ref, lastWriteAt: '2026-09-01T10:00:03.000Z' }, payload)).toMatchObject({ ok: false, edited: true });
  });

  it('dayanak yok ya da WordPress damgasi okunamadi: emin olunmadan yazilmaz (edited)', async () => {
    handler = restWp();
    expect(await rest().update({ externalId: '41', externalUrl: `${SITE}/yazi/` }, payload)).toMatchObject({ ok: false, edited: true });
    handler = restWp({ stored: { modified_gmt: undefined } });
    expect(await rest().update(REF, payload)).toMatchObject({ ok: false, edited: true });
    expect(reqs.filter((x) => x.method === 'POST')).toEqual([]);
  });

  it('cop kutusu cakismadan once: cop kutusundaki yazi force ile de yazilmaz (trashed)', async () => {
    handler = restWp({ stored: { status: 'trash', slug: 'yazi__trashed', modified_gmt: '2026-09-09T09:09:09' } });
    expect(await rest().update(REF, payload, { force: true })).toMatchObject({ ok: false, trashed: true });
    expect(reqs.map((x) => x.method)).toEqual(['GET']);
  });
});

describe('WordPress REST — publish() olusturma damgasi', () => {
  it('olusturma yanitindaki modified_gmt remoteModifiedAt olarak doner (sonraki cakisma denetiminin dayanagi)', async () => {
    handler = (r) => (r.method === 'POST' && r.path === '/wp-json/wp/v2/posts'
      ? json(201, { id: 42, link: `${SITE}/?p=42`, status: 'draft', modified_gmt: '2026-10-18T08:00:00' })
      : json(404, { code: 'rest_no_route' }));
    expect(await rest().publish(payload)).toEqual({ ok: true, externalId: '42', externalUrl: `${SITE}/?p=42`, remoteModifiedAt: '2026-10-18T08:00:00.000Z' });
  });
});

// ── XML-RPC ────────────────────────────────────────────────────────────────

const ixrOk = (valueXml: string) => `<?xml version="1.0" encoding="UTF-8"?>
<methodResponse>
  <params>
    <param>
      <value>
      ${valueXml}
      </value>
    </param>
  </params>
</methodResponse>`;
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
/** wp.getPost yaniti (class-wp-xmlrpc-server.php _prepare_post bicimi) */
const getPostOk = (status: string, over: { link?: string; name?: string; type?: string; modified?: string } = {}) => ixrOk(`<struct>
  <member><name>post_id</name><value><string>41</string></value></member>
  <member><name>post_status</name><value><string>${status}</string></value></member>
  <member><name>link</name><value><string>${over.link ?? `${SITE}/yazi/`}</string></value></member>
  <member><name>post_name</name><value><string>${over.name ?? 'yazi'}</string></value></member>
  <member><name>post_type</name><value><string>${over.type ?? 'post'}</string></value></member>
  <member><name>post_modified_gmt</name><value><dateTime.iso8601>${over.modified ?? '20260901T10:00:00'}</dateTime.iso8601></value></member>
</struct>`);

function xmlWp(over: { get?: string; edit?: string; after?: string } = {}) {
  let gets = 0;
  return (r: Req): Response => {
    const method = r.body.match(/<methodName>([^<]+)<\/methodName>/)?.[1];
    if (method === 'wp.getPost') {
      gets += 1;
      // Ikinci okuma (yazimdan sonra): WordPress damgayi ilerletmistir
      if (gets > 1) return xml(over.after ?? getPostOk('publish', { modified: '20261018T09:00:00' }));
      return xml(over.get ?? getPostOk('publish'));
    }
    if (method === 'wp.editPost') return xml(over.edit ?? ixrOk('<boolean>1</boolean>'));
    return xml(ixrFault(-32601, 'server error. requested method does not exist.'));
  };
}
const xmlrpc = () => new WordPressXmlrpcAdapter({ siteUrl: SITE, username: 'editor', password: 'gizli <&>' }, { postStatus: 'publish', categories: ['Haber'] });
const methodOf = (r: Req) => r.body.match(/<methodName>([^<]+)<\/methodName>/)?.[1];

describe('WordPress XML-RPC — update()', () => {
  it('wp.getPost + wp.editPost (+ yazim sonrasi wp.getPost); govdede YALNIZ post_title / post_content / post_excerpt ve if_not_modified_since', async () => {
    handler = xmlWp();
    const r = await xmlrpc().update({ externalId: '41', externalUrl: `${SITE}/?p=41`, ...STAMP }, payload);
    expect(r).toEqual({ ok: true, externalId: '41', externalUrl: `${SITE}/yazi/`, status: 'publish', remoteModifiedAt: '2026-10-18T09:00:00.000Z' });
    expect(reqs.map(methodOf)).toEqual(['wp.getPost', 'wp.editPost', 'wp.getPost']);
    expect(reqs.every((x) => x.method === 'POST' && x.path === '/xmlrpc.php')).toBe(true);
    const edit = reqs[1].body;
    expect(edit).toContain('<param><value><int>41</int></value></param>');
    const names = [...edit.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
    expect(names).toEqual(['post_title', 'post_content', 'post_excerpt', 'if_not_modified_since']);
    expect(edit).not.toMatch(/post_status|wp_slug|post_name|post_author|post_date|terms|metaWeblog/);
    // Okunan damga AYNEN geri verilir: o arada degisirse WordPress 409 doner
    expect(edit).toContain('<member><name>if_not_modified_since</name><value><dateTime.iso8601>20260901T10:00:00</dateTime.iso8601></value></member>');
    // Kacis: sifre ve icerik XML guvenli
    expect(edit).toContain('gizli &lt;&amp;&gt;');
    expect(edit).toContain('&lt;p&gt;Güncel metin&lt;/p&gt;');
    // wp.getPost kimlik ve cakisma icin gereken alanlari ister
    for (const f of ['post_status', 'link', 'post_name', 'post_type', 'post_modified_gmt']) expect(reqs[0].body).toContain(`<string>${f}</string>`);
  });

  it('wp.getPost 404 "Invalid post ID." → notFound; wp.editPost cagrilmaz', async () => {
    handler = xmlWp({ get: ixrFault(404, 'Invalid post ID.') });
    const r = await xmlrpc().update({ externalId: '41', ...STAMP }, payload);
    expect(r).toEqual({ ok: false, notFound: true, externalId: '41', error: 'XML-RPC: Invalid post ID.' });
    expect(reqs.map(methodOf)).toEqual(['wp.getPost']);
  });

  it('cop kutusundaki yazi: trashed, wp.editPost cagrilmaz', async () => {
    handler = xmlWp({ get: getPostOk('trash', { name: 'yazi__trashed' }) });
    expect(await xmlrpc().update({ externalId: '41', ...STAMP }, payload)).toMatchObject({ ok: false, trashed: true, status: 'trash' });
    expect(reqs.map(methodOf)).toEqual(['wp.getPost']);
  });

  it('yetki hatasi (401) notFound degil; wp.editPost 404 → notFound; boolean olmayan yanit basari sayilmaz', async () => {
    handler = xmlWp({ get: ixrFault(401, 'Sorry, you are not allowed to edit this post.') });
    const denied = await xmlrpc().update({ externalId: '41', ...STAMP }, payload);
    expect(denied).toEqual({ ok: false, error: 'XML-RPC: Sorry, you are not allowed to edit this post.' });

    handler = xmlWp({ edit: ixrFault(404, 'Invalid post ID.') });
    expect(await xmlrpc().update({ externalId: '41', ...STAMP }, payload)).toMatchObject({ ok: false, notFound: true });

    handler = xmlWp({ edit: '<html>engellendi</html>' });
    const odd = await xmlrpc().update({ externalId: '41', ...STAMP }, payload);
    expect(odd.ok).toBe(false);
    expect(odd.error).toMatch(/^XML-RPC yanıtı anlaşılamadı/);
  });

  it('kimlik adresteki ?p= ile de bulunur; kimlik yoksa istek atilmaz (XML-RPC\'de slug ile tahmin yok)', async () => {
    handler = xmlWp();
    expect((await xmlrpc().update({ externalUrl: `${SITE}/?p=41`, ...STAMP }, payload)).ok).toBe(true);
    expect(reqs[0].body).toContain('<int>41</int>');

    reqs = [];
    const r = await xmlrpc().update({ externalUrl: `${SITE}/yazi/` }, payload);
    expect(r.ok).toBe(false);
    expect(r.notFound).toBeUndefined();
    expect(r.error).toContain('kimliği kayıtlı değil');
    expect(reqs).toEqual([]);
  });

  it('ozet bossa post_excerpt gonderilmez', async () => {
    handler = xmlWp();
    await xmlrpc().update({ externalId: '41', ...STAMP }, { ...payload, metaDescription: '' });
    expect(reqs[1].body).not.toContain('post_excerpt');
  });

  it('R2: kayitli kimlik bir SAYFAYA (or. hakkimizda) ya da baska bir yaziya kaymis → mismatch, wp.editPost cagrilmaz (force ile de)', async () => {
    handler = xmlWp({ get: getPostOk('publish', { name: 'hakkimizda', type: 'page', link: `${SITE}/hakkimizda/` }) });
    const page = await xmlrpc().update({ externalId: '41', externalUrl: 'https://eski-site.example/?p=41', ...STAMP }, payload, { force: true });
    expect(page).toMatchObject({ ok: false, mismatch: true, remoteSlug: 'hakkimizda' });
    expect(page.error).toContain('bir yazı değil (tür: page');
    expect(reqs.map(methodOf)).toEqual(['wp.getPost']);

    reqs = [];
    handler = xmlWp({ get: getPostOk('publish', { name: 'kampanya-duyurusu' }) });
    expect(await xmlrpc().update({ externalId: '403', ...STAMP }, payload)).toMatchObject({ ok: false, mismatch: true, remoteSlug: 'kampanya-duyurusu' });
    expect(reqs.map(methodOf)).toEqual(['wp.getPost']);

    // Slug'i ayni olan SAYFA da ezilmez: tur 'post' olmali (yayin yolu yalniz yazi acar)
    reqs = [];
    handler = xmlWp({ get: getPostOk('publish', { name: 'yazi', type: 'page' }) });
    expect(await xmlrpc().update({ externalId: '41', ...STAMP }, payload)).toMatchObject({ ok: false, mismatch: true });
    expect(reqs.map(methodOf)).toEqual(['wp.getPost']);
  });

  it('R3: RanksUp\'in son yaziminden sonra degismis yazi (post_modified_gmt ileri) → edited, wp.editPost yok; force ile yazilir', async () => {
    handler = xmlWp({ get: getPostOk('publish', { modified: '20260905T08:30:00' }) });
    const r = await xmlrpc().update({ externalId: '41', ...STAMP }, payload);
    expect(r).toMatchObject({ ok: false, edited: true, remoteModifiedAt: '2026-09-05T08:30:00.000Z' });
    expect(reqs.map(methodOf)).toEqual(['wp.getPost']);

    reqs = [];
    handler = xmlWp({ get: getPostOk('publish', { modified: '20260905T08:30:00' }) });
    const forced = await xmlrpc().update({ externalId: '41', ...STAMP }, payload, { force: true });
    expect(forced.ok).toBe(true);
    expect(reqs[1].body).toContain('<dateTime.iso8601>20260905T08:30:00</dateTime.iso8601>');
  });

  it('okuma ile yazma arasinda degisti: WordPress 409 (if_not_modified_since) → edited, basari sayilmaz', async () => {
    handler = xmlWp({ edit: ixrFault(409, 'There is a revision of this post that is more recent.') });
    const r = await xmlrpc().update({ externalId: '41', ...STAMP }, payload);
    expect(r).toMatchObject({ ok: false, edited: true });
    expect(r.notFound).toBeUndefined();
  });

  it('yazim sonrasi damga okunamazsa yazim yine basarilidir (damgasiz doner)', async () => {
    handler = xmlWp({ after: ixrFault(500, 'gecici') });
    const r = await xmlrpc().update({ externalId: '41', ...STAMP }, payload);
    expect(r).toEqual({ ok: true, externalId: '41', externalUrl: `${SITE}/yazi/`, status: 'publish' });
  });
});

describe('WordPress XML-RPC — publish() olusturma damgasi', () => {
  it('metaWeblog.newPost kimlik doner; olusturma damgasi wp.getPost ile okunur (en iyi caba)', async () => {
    handler = (r) => {
      const method = methodOf(r);
      if (method === 'metaWeblog.newPost') return xml(ixrOk('<string>41</string>'));
      if (method === 'wp.getPost') return xml(getPostOk('draft', { modified: '20261018T08:00:00', link: `${SITE}/?p=41` }));
      return xml(ixrFault(-32601, 'yok'));
    };
    expect(await xmlrpc().publish(payload)).toEqual({ ok: true, externalId: '41', externalUrl: `${SITE}/?p=41`, remoteModifiedAt: '2026-10-18T08:00:00.000Z' });
    expect(reqs.map(methodOf)).toEqual(['metaWeblog.newPost', 'wp.getPost']);
  });
});

describe('wordPressPostId / wordPressUrlSlug', () => {
  it('kimlik: externalId (sayi) ya da adresteki ?p=; slug: adresin son parcasi, kok ve ?p= bicimi slug degildir', () => {
    expect(wordPressPostId({ externalId: '41' })).toBe(41);
    expect(wordPressPostId({ externalId: 41 })).toBe(41);
    expect(wordPressPostId({ externalId: 'abc', externalUrl: 'https://s.com/?p=7&preview=true' })).toBe(7);
    expect(wordPressPostId({ externalId: '0' })).toBeNull();
    expect(wordPressPostId({ externalUrl: 'https://s.com/yazi/' })).toBeNull();
    expect(wordPressPostId(null)).toBeNull();
    expect(wordPressUrlSlug('https://s.com/2026/10/yazi/')).toBe('yazi');
    expect(wordPressUrlSlug('https://s.com/%C3%A7ay/')).toBe('çay');
    expect(wordPressUrlSlug('https://s.com/')).toBeNull();
    expect(wordPressUrlSlug('https://s.com/?p=7')).toBeNull();
    expect(wordPressUrlSlug('https://s.com/index.php?p=7')).toBeNull();
    expect(wordPressUrlSlug('yazi')).toBeNull();
  });
});
