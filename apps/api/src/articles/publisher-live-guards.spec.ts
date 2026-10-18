import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/**
 * YAYINDAKI YAZI — yanlis yaziyi ve musterinin duzenlemesini EZMEME (R2, R3/R6/R8,
 * R19, R10/R17, R11, K10). Uctan uca: GERCEK PublisherService + GERCEK
 * WordPressRestAdapter / WordPressXmlrpcAdapter (@luviai/adapters dist), durum
 * tutan sahte bir WordPress'e karsi. Yalniz Prisma (durum tutan satir) ve yan
 * servisler sahte. Inceleme turunun tekrar uretim testlerinden (rv10
 * wp-identity-verify, wp-ezme-indep, wp-live-edit-verify, trash-verify,
 * verify-yayin-default, pubat-skeptic) uyarlandi.
 *
 * Sahte WordPress kaynaktaki gibi davranir: GET _fields'i uygular, POST yalniz
 * gonderilen alanlari birlestirir ve modified_gmt'yi ilerletir (wp_insert_post
 * her guncellemede post_modified_gmt = current_time); REST /posts/<id> yalniz
 * 'post' turunu verir (baska tur 404 rest_post_invalid_id); XML-RPC wp.getPost /
 * wp.editPost ture bakmaz ve if_not_modified_since'te 409 doner.
 */

vi.mock('@luviai/shared', async (orig) => ({ ...(await orig() as any), decryptCredentials: (c: any) => c ?? {} }));
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('./image-generator.service.js', () => ({ ImageGeneratorService: class {} }));
vi.mock('../audit/ai-indexing-pinger.service.js', () => ({ AiIndexingPingerService: class {} }));
vi.mock('../audit/llms-full-builder.service.js', () => ({ LlmsFullBuilderService: class {} }));
vi.mock('./link-validator.service.js', () => ({ LinkValidatorService: class {} }));
vi.mock('../sites/site-url-inventory.service.js', () => ({ SiteUrlInventoryService: class {} }));
vi.mock('./qa-gate.service.js', () => ({ QaGateService: class {} }));
vi.mock('../llm/llm-provider.service.js', () => ({ LLMProviderService: class {} }));
vi.mock('./hero-alt.js', () => ({ describeHeroImage: vi.fn(async () => null) }));

const { setAdapterFetch } = await import('@luviai/adapters');
const { PublisherService, checkEntryPublicUrl } = await import('./publisher.service.js');
const { ArticlesService } = await import('./articles.service.js');
const { articleContentHash, liveEntries, lastLiveWriteAt } = await import('./republish-policy.js');

// Adresler IP — yayin hedefi adres denetimi DNS'e gitmez
const IP = '93.184.216.34';
const SITE = `https://${IP}`;

// ── Durum tutan sahte WordPress ──────────────────────────────────────────
type WpPost = { id: number; type: string; status: string; slug: string; link: string; title: string; content: string; excerpt: string; featured_media: number; modified_gmt: string };
let posts: Map<number, WpPost>;
let nextId = 500;
/**
 * WordPress sunucusunun saati RanksUp'inkinden 10 dk ILERIDE (paylasimli
 * hostingte gorulen kayma; saat payi 2 dk). RanksUp'in kendi yazimini
 * "duzenlenmis" saymamasi yalniz kayda yazilan WordPress damgasiyla
 * (remoteModifiedAt) mumkun — saat karsilastirmasi burada yanlis "duzenlendi" derdi.
 */
let clock = Date.now() + 10 * 60_000;
const gmt = () => new Date((clock += 60_000)).toISOString().slice(0, 19);
type Req = { method: string; path: string; search: URLSearchParams; body: string };
let reqs: Req[] = [];
/** Yayin sirasinda araya giren bir olay (K10 yarisi) — ilk GET'te bir kez calisir */
let onFirstRead: (() => void) | null = null;
/** XML-RPC wp.editPost islenmeden hemen once (okuma ile yazma arasi) bir kez calisir */
let beforeEdit: (() => void) | null = null;

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const xmlResp = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/xml; charset=UTF-8' } });
const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' } as Record<string, string>)[c]);
const xmlUnesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const ixrFault = (code: number, msg: string) => xmlResp(`<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><int>${code}</int></value></member><member><name>faultString</name><value><string>${msg}</string></value></member></struct></value></fault></methodResponse>`);
const ixrDate = (g: string) => g.replace(/-/g, '').slice(0, 17);

function restView(p: WpPost) {
  return { id: p.id, type: p.type, status: p.status, slug: p.slug, link: p.link, featured_media: p.featured_media, modified_gmt: p.modified_gmt, title: { raw: p.title }, content: { raw: p.content }, excerpt: { raw: p.excerpt } };
}

function wp(r: Req): Response {
  if (r.path === '/xmlrpc.php') return xmlrpc(r);
  const single = r.path.match(/^\/wp-json\/wp\/v2\/posts\/(\d+)$/);
  if (single) {
    const p = posts.get(Number(single[1]));
    // class-wp-rest-posts-controller.php get_post(): baska tur de gecersiz kimlik
    if (!p || p.type !== 'post') return json(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.', data: { status: 404 } });
    if (r.method === 'GET') {
      if (onFirstRead) { const f = onFirstRead; onFirstRead = null; f(); }
      const view: Record<string, unknown> = restView(p);
      const fields = r.search.get('_fields');
      return json(200, fields ? Object.fromEntries(fields.split(',').filter((k) => k in view).map((k) => [k, view[k]])) : view);
    }
    const b = JSON.parse(r.body);
    if (typeof b.title === 'string') p.title = b.title;
    if (typeof b.content === 'string') p.content = b.content;
    if (typeof b.excerpt === 'string') p.excerpt = b.excerpt;
    p.modified_gmt = gmt();
    return json(200, restView(p));
  }
  if (r.method === 'POST' && r.path === '/wp-json/wp/v2/posts') {
    const b = JSON.parse(r.body);
    const id = (nextId += 1);
    const status = b.status ?? 'publish';
    const p: WpPost = { id, type: 'post', status, slug: b.slug, link: status === 'publish' ? `${SITE}/${b.slug}/` : `${SITE}/?p=${id}`, title: b.title, content: b.content, excerpt: b.excerpt ?? '', featured_media: 0, modified_gmt: gmt() };
    posts.set(id, p);
    return json(201, restView(p));
  }
  return json(404, { code: 'rest_no_route', message: 'No route' });
}

function xmlrpc(r: Req): Response {
  const method = r.body.match(/<methodName>([^<]+)<\/methodName>/)?.[1];
  const id = Number(r.body.match(/<param><value><int>(\d+)<\/int><\/value><\/param>\s*<param><value>(?:<array>|<struct>)/)?.[1]);
  const p = posts.get(id);
  if (method === 'wp.getPost') {
    if (onFirstRead) { const f = onFirstRead; onFirstRead = null; f(); }
    if (!p) return ixrFault(404, 'Invalid post ID.');
    return xmlResp(`<?xml version="1.0"?><methodResponse><params><param><value><struct>
<member><name>post_id</name><value><string>${p.id}</string></value></member>
<member><name>post_status</name><value><string>${p.status}</string></value></member>
<member><name>post_type</name><value><string>${p.type}</string></value></member>
<member><name>post_name</name><value><string>${xmlEsc(p.slug)}</string></value></member>
<member><name>link</name><value><string>${xmlEsc(p.link)}</string></value></member>
<member><name>post_modified_gmt</name><value><dateTime.iso8601>${ixrDate(p.modified_gmt)}</dateTime.iso8601></value></member>
</struct></value></param></params></methodResponse>`);
  }
  if (method === 'wp.editPost') {
    if (beforeEdit) { const f = beforeEdit; beforeEdit = null; f(); }
    if (!p) return ixrFault(404, 'Invalid post ID.');
    const since = r.body.match(/<name>if_not_modified_since<\/name><value><dateTime\.iso8601>([^<]+)</)?.[1];
    if (since && ixrDate(p.modified_gmt) > since) return ixrFault(409, 'There is a revision of this post that is more recent.');
    const t = r.body.match(/<name>post_title<\/name><value><string>([\s\S]*?)<\/string>/)?.[1];
    const c = r.body.match(/<name>post_content<\/name><value><string>([\s\S]*?)<\/string>/)?.[1];
    if (t !== undefined) p.title = xmlUnesc(t);
    if (c !== undefined) p.content = xmlUnesc(c);
    p.modified_gmt = gmt();
    return xmlResp('<?xml version="1.0"?><methodResponse><params><param><value><boolean>1</boolean></value></param></params></methodResponse>');
  }
  return ixrFault(-32601, 'yok');
}

setAdapterFetch(async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  const r: Req = { method: (init?.method ?? 'GET').toUpperCase(), path: u.pathname, search: u.searchParams, body: typeof init?.body === 'string' ? init.body : '' };
  reqs.push(r);
  return wp(r);
});
afterAll(() => setAdapterFetch(null));

// ── PublisherService (Prisma durum tutan satir; geri kalan GERCEK) ─────────
const WP_T = { id: 't-wp', type: 'WORDPRESS_REST', credentials: { siteUrl: SITE, username: 'editor', appPassword: 'abcd efgh' }, config: {}, isDefault: false, isActive: true };
const WPX_T = { id: 't-wpx', type: 'WORDPRESS_XMLRPC', credentials: { siteUrl: SITE, username: 'editor', password: 'gizli' }, config: {}, isDefault: false, isActive: true };
const FTP_T = { id: 't-ftp', type: 'FTP', credentials: { host: IP, user: 'u', password: 'p' }, config: {}, isDefault: true, isActive: true };
const ZIP_T = { id: 't-zip', type: 'MARKDOWN_ZIP', credentials: {}, config: {}, isDefault: false, isActive: true };

const FIRST_AT = new Date('2026-08-01T10:00:00.000Z');
const ARTICLE_TEXT = { title: 'KDV Beyanı Rehberi', metaTitle: null, metaDescription: 'KDV özeti', bodyMd: '# KDV Beyanı Rehberi\n\nGüncel metin.' };
const HASH = articleContentHash(ARTICLE_TEXT);

function build(opts: { targets: any[]; publishedTo: unknown; status?: string; publishedAt?: Date | null; slug?: string }) {
  const writes: any[] = [];
  const row: any = {
    id: 'a1', siteId: 's1', slug: opts.slug ?? 'kdv-beyani-rehberi', ...ARTICLE_TEXT,
    heroImageUrl: 'https://cdn.example/hero.jpg', category: null, schemaMarkup: null, frontmatter: {}, inlineImages: [],
    status: opts.status ?? 'READY_TO_PUBLISH', qaStatus: 'PASS', qaReport: null,
    publishedAt: opts.publishedAt === undefined ? FIRST_AT : opts.publishedAt,
    publishedTo: opts.publishedTo, updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    site: { id: 's1', url: SITE, name: 'Site', userId: 'u1', publishTargets: opts.targets },
  };
  let tick = 0;
  const bump = () => new Date(Date.parse('2026-10-01T00:00:00.000Z') + (tick += 1) * 1000);
  const apply = (data: any) => {
    const rest = { ...data };
    delete rest.updatedAt;
    writes.push(rest);
    Object.assign(row, rest, { updatedAt: bump() });
  };
  const prisma = {
    article: {
      findUniqueOrThrow: vi.fn(async () => row),
      findUnique: vi.fn(async () => ({ ...row })),
      // Yayin kaydi uclari (articles.service mark-updated): id + siteId ile okur
      findFirst: vi.fn(async (a: any) => (a?.where?.id === row.id && a?.where?.siteId === row.siteId ? { ...row } : null)),
      update: vi.fn(async (a: any) => { apply(a.data); return {}; }),
      updateMany: vi.fn(async (a: any) => {
        if (a.where?.updatedAt instanceof Date && a.where.updatedAt.getTime() !== row.updatedAt.getTime()) return { count: 0 };
        apply(a.data);
        return { count: 1 };
      }),
    },
    publishTarget: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
    site: { findUnique: vi.fn(async () => ({ llmsFullTxt: '' })) },
  };
  const llmsFullBuilder = { build: vi.fn(async () => ({ articles: 1, bytes: 10 })), buildShortIndex: vi.fn(async () => '# kisa') };
  const svc = new PublisherService(
    prisma as any,
    { generate: vi.fn(async () => ({ ok: false })) } as any,
    { pingUrl: vi.fn(async () => ({})) } as any,
    llmsFullBuilder as any,
    { validateArticleMarkdown: vi.fn(async (_s: string, md: string) => ({ bodyMd: md, report: { remapped: 0, unlinked: 0 } })) } as any,
    { invalidate: vi.fn() } as any,
    { check: vi.fn(async () => ({ status: 'PASS' })) } as any,
    {} as any,
  );
  /** Disaridan es zamanli yazim (mark-updated / forget gibi): satiri degistirir, updatedAt ilerler */
  const concurrent = (mutate: (r: any) => void) => { mutate(row); row.updatedAt = bump(); };
  return { svc, row, writes, prisma, llmsFullBuilder, concurrent };
}

const wpPost = (over: Partial<WpPost> = {}): WpPost => ({
  id: 123, type: 'post', status: 'publish', slug: 'kdv-beyani-rehberi', link: `${SITE}/kdv-beyani-rehberi/`,
  title: 'KDV Beyanı Rehberi', content: '<p>Eski metin.</p>', excerpt: 'KDV özeti', featured_media: 7, modified_gmt: '2026-09-01T10:00:00', ...over,
});
const wpEntry = (over: Record<string, unknown> = {}) => ({
  targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, action: 'created',
  externalId: '123', externalUrl: `${SITE}/kdv-beyani-rehberi/`,
  publishedAt: '2026-09-01T10:00:05.000Z', updatedAt: '2026-09-01T10:00:05.000Z', remoteModifiedAt: '2026-09-01T10:00:00.000Z',
  contentHash: 'eski-metnin-izi', ...over,
});
const posts1 = (...list: WpPost[]) => new Map(list.map((p) => [p.id, p]));

beforeEach(() => {
  reqs = [];
  onFirstRead = null;
  beforeEdit = null;
  posts = posts1(wpPost());
});

describe('R2 — kayitli kimlik baska bir yaziya aitse HICBIR SEY yazilmaz', () => {
  it('hedef baska WordPress\'e baglandi: #123 musterinin "sirket-haberleri" yazisi — ezilmez, adres kaydi bozulmaz, kopya acilmaz', async () => {
    posts = posts1(wpPost({ slug: 'sirket-haberleri', link: `${SITE}/2019/05/sirket-haberleri/`, title: 'Şirket Haberleri', content: '<p>Müşterinin yazısı</p>' }));
    const entry = wpEntry({ externalUrl: 'https://staging.example/kdv-beyani-rehberi/' });
    const c = build({ targets: [WP_T], publishedTo: [entry] });
    const [r] = await c.svc.publishArticle('a1', [], { overrideQa: true });

    expect(r).toMatchObject({ targetId: 't-wp', ok: false, skipped: 'live_entry_mismatch' });
    expect(r.error).toContain('#123');
    expect(r.error).toContain('sirket-haberleri');
    expect(r.error).toContain('Başka bir yazının üzerine yazmamak için güncellenmedi ve kopya açılmadı');
    // Musterinin yazisi aynen duruyor; ne POST ne yeni yazi
    expect(posts.get(123)).toMatchObject({ title: 'Şirket Haberleri', content: '<p>Müşterinin yazısı</p>' });
    expect(reqs.filter((x) => x.method === 'POST')).toEqual([]);
    expect(posts.size).toBe(1);
    // Kayit ilgisiz adresi almadi; yeni metni alamayan kopya elle guncelleme bekliyor
    const stored = c.row.publishedTo[0];
    expect(stored.externalUrl).toBe('https://staging.example/kdv-beyani-rehberi/');
    expect(stored.manualUpdatePending).toBe(true);
    expect(c.row.status).toBe('PUBLISHED');
  });

  it('XML-RPC: eski kayittaki kimlik (403 hata kodu kimlik sanilmis) "hakkimizda" SAYFASINA denk geliyor — wp.editPost yok', async () => {
    posts = posts1({ ...wpPost({ id: 403, type: 'page', slug: 'hakkimizda', link: `${SITE}/hakkimizda/`, title: 'Hakkımızda' }) });
    const c = build({ targets: [WPX_T], publishedTo: [{ targetId: 't-wpx', targetType: 'WORDPRESS_XMLRPC', ok: true, externalId: '403', externalUrl: `${SITE}/?p=403` }] });
    const [r] = await c.svc.publishArticle('a1', ['t-wpx'], { overrideQa: true, overwriteRemoteEdits: true });
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_mismatch' });
    expect(reqs.map((x) => x.body.match(/<methodName>([^<]+)</)?.[1])).toEqual(['wp.getPost']);
    expect(posts.get(403)?.title).toBe('Hakkımızda');
  });
});

describe('R3/R6/R8 — musterinin WordPress\'teki duzenlemesi kendiliginden ezilmez', () => {
  const customerEdited = () => posts1(wpPost({ title: 'KDV Beyanı (2026 güncel)', content: '<p>1.600 TL (VUK 352). Randevu: 0212 555 00 00</p>', modified_gmt: '2026-09-05T08:30:00' }));

  it('otomasyon (hedef verilmedi: pivot / Tam otomatik / takili sayfa): yazilmaz, live_entry_edited + isaret; yazi eski metniyle PUBLISHED', async () => {
    posts = customerEdited();
    const c = build({ targets: [WP_T], publishedTo: [wpEntry()] });
    const [r] = await c.svc.publishArticle('a1', [], { overrideQa: true });
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_edited' });
    expect(r.error).toContain('RanksUp\'ın son yazımından sonra değiştirilmiş (son değişiklik: 05.09.2026 11:30)');
    expect(r.error).toContain('üzerine yazılmasını açıkça onaylayarak');
    expect(posts.get(123)).toMatchObject({ title: 'KDV Beyanı (2026 güncel)', content: '<p>1.600 TL (VUK 352). Randevu: 0212 555 00 00</p>' });
    expect(reqs.filter((x) => x.method === 'POST')).toEqual([]);
    expect(c.row.status).toBe('PUBLISHED');
    expect(c.row.publishedTo[0]).toMatchObject({ manualUpdatePending: true, remoteModifiedAt: '2026-09-01T10:00:00.000Z' });
  });

  it('takili sayfa yeniden yayin asamasinin cagrisi (acik hedef, onay yok) de ezmez', async () => {
    posts = customerEdited();
    const c = build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' });
    const [r] = await c.svc.publishArticle('a1', ['t-wp']);
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_edited' });
    expect(posts.get(123)?.title).toBe('KDV Beyanı (2026 güncel)');
  });

  it('kullanicinin acik onayi (overwriteRemoteEdits): ustune yazilir; yeni WordPress damgasi kayda gecer, isaret kalkar', async () => {
    posts = customerEdited();
    const c = build({ targets: [WP_T], publishedTo: [wpEntry({ manualUpdatePending: true, manualUpdatePendingSince: '2026-10-01T00:00:00.000Z' })] });
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, overwriteRemoteEdits: true });
    expect(r).toMatchObject({ ok: true, action: 'updated' });
    expect(posts.get(123)?.title).toBe('KDV Beyanı Rehberi');
    const stored = c.row.publishedTo[0];
    expect(stored.remoteModifiedAt).toBe(`${posts.get(123)!.modified_gmt}.000Z`);
    expect(stored).not.toHaveProperty('manualUpdatePending');
    expect(stored.contentHash).toBe(HASH);
  });

  it('RanksUp\'in ardisik yazimlari birbirini "duzenlenmis" saymaz: olusturma ve guncelleme damgasi kayda gecer', async () => {
    posts = new Map();
    const c = build({ targets: [WP_T], publishedTo: null, publishedAt: null });
    const [created] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true });
    expect(created).toMatchObject({ ok: true, action: 'created' });
    const id = Number(created.externalId);
    expect(c.row.publishedTo[0].remoteModifiedAt).toBe(`${posts.get(id)!.modified_gmt}.000Z`);

    // Metin degisti (yeniden yazim), RanksUp yeniden yayinliyor: WordPress'te kimse dokunmadi
    c.row.bodyMd = '# KDV Beyanı Rehberi\n\nİkinci metin.';
    const [second] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true });
    expect(second).toMatchObject({ ok: true, action: 'updated' });
    const [third] = await c.svc.publishArticle('a1', [], { overrideQa: true });
    expect(third).toMatchObject({ ok: true, action: 'updated' });
  });

  it('varsayilan taslak akisi: RanksUp taslak acti, musteri wp-admin\'de yayina aldi → (temkinli) duzenlenmis sayilir', async () => {
    posts = new Map();
    const c = build({ targets: [{ ...WP_T, config: { postStatus: 'draft' } }], publishedTo: null, publishedAt: null });
    const [created] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true });
    const p = posts.get(Number(created.externalId))!;
    expect(p.status).toBe('draft');
    expect(c.row.publishedTo[0].externalUrl).toBe(`${SITE}/?p=${p.id}`);
    // Musteri yayina aldi (WordPress damgayi ilerletir, adres kalici baglantiya doner)
    Object.assign(p, { status: 'publish', link: `${SITE}/${p.slug}/`, modified_gmt: gmt() });
    c.row.bodyMd = '# KDV Beyanı Rehberi\n\nPivot metni.';
    const [r] = await c.svc.publishArticle('a1', [], { overrideQa: true });
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_edited' });
    expect(r.error).toContain('taslaktan yayına alınmış');
  });

  it('eski kayit (damgasiz, bu dalgadan once yazilmis): makalenin publishedAt\'i son yazim sayilir', async () => {
    const legacy = { targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '123', externalUrl: `${SITE}/kdv-beyani-rehberi/` };
    // WordPress'teki son degisiklik RanksUp'in yayinindan once (yayinin kendisi): yazilir
    posts = posts1(wpPost({ modified_gmt: '2026-08-01T09:59:58' }));
    const ok = build({ targets: [WP_T], publishedTo: [legacy], publishedAt: FIRST_AT });
    expect((await ok.svc.publishArticle('a1', [], { overrideQa: true }))[0]).toMatchObject({ ok: true, action: 'updated' });
    // Yayindan haftalar sonra duzenlenmis: yazilmaz
    posts = posts1(wpPost({ modified_gmt: '2026-08-20T12:00:00' }));
    const edited = build({ targets: [WP_T], publishedTo: [legacy], publishedAt: FIRST_AT });
    expect((await edited.svc.publishArticle('a1', [], { overrideQa: true }))[0]).toMatchObject({ ok: false, skipped: 'live_entry_edited' });
    // Hicbir dayanak yok: emin olunmadan yazilmaz
    posts = posts1(wpPost());
    const unknown = build({ targets: [WP_T], publishedTo: [legacy], publishedAt: null });
    expect((await unknown.svc.publishArticle('a1', [], { overrideQa: true }))[0]).toMatchObject({ ok: false, skipped: 'live_entry_edited' });
  });

  it('XML-RPC: duzenlenmis yazi yazilmaz; okuma ile yazma arasinda degisirse WordPress 409 ile reddeder', async () => {
    const entry = { targetId: 't-wpx', targetType: 'WORDPRESS_XMLRPC', ok: true, externalId: '123', externalUrl: `${SITE}/?p=123`, updatedAt: '2026-09-01T10:00:05.000Z', remoteModifiedAt: '2026-09-01T10:00:00.000Z' };
    posts = customerEdited();
    const c = build({ targets: [WPX_T], publishedTo: [entry] });
    expect((await c.svc.publishArticle('a1', [], { overrideQa: true }))[0]).toMatchObject({ ok: false, skipped: 'live_entry_edited' });

    // Musteri, RanksUp okuduktan SONRA ve yazmadan ONCE kaydetti: WordPress 409 doner
    posts = posts1(wpPost());
    beforeEdit = () => { Object.assign(posts.get(123)!, { modified_gmt: '2026-10-18T10:30:00', content: '<p>Müşterinin son hali</p>' }); };
    const raced = build({ targets: [WPX_T], publishedTo: [entry] });
    expect((await raced.svc.publishArticle('a1', [], { overrideQa: true }))[0]).toMatchObject({ ok: false, skipped: 'live_entry_edited' });
    expect(reqs.map((x) => x.body.match(/<methodName>([^<]+)</)?.[1]).filter((m) => m === 'wp.editPost')).toHaveLength(1);
    expect(posts.get(123)?.content).toBe('<p>Müşterinin son hali</p>');
  });
});

describe('R19 — cop kutusundaki kopya canli sayilmaz', () => {
  it('PUBLISHED yazinin bilinen tek kopyasi cop kutusunda: kayda trashedAt, durum READY_TO_PUBLISH, llms-full yeniden uretilir', async () => {
    posts = posts1(wpPost({ status: 'trash', slug: 'kdv-beyani-rehberi__trashed' }));
    const c = build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' });
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true });
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_trashed' });
    expect(c.row.status).toBe('READY_TO_PUBLISH');
    expect(c.row.publishedTo[0]).toMatchObject({ externalId: '123', trashedAt: expect.any(String) });
    expect(liveEntries(c.row.publishedTo)).toEqual([]);
    expect(lastLiveWriteAt(c.row.publishedTo)).toBeNull();
    expect(c.llmsFullBuilder.build).toHaveBeenCalledWith('s1');
    expect(posts.size).toBe(1);
  });

  it('baska canli kopya varsa yazi PUBLISHED kalir; cop kutusundaki kopya isaretlenmez', async () => {
    posts = posts1(wpPost({ status: 'trash', slug: 'kdv-beyani-rehberi__trashed' }));
    const ghostLive = { targetId: 't-ghost', targetType: 'GHOST', ok: true, externalId: 'g1', contentHash: 'eski' };
    const c = build({ targets: [WP_T, { id: 't-ghost', type: 'GHOST', credentials: {}, config: {}, isActive: true }], publishedTo: [wpEntry({ manualUpdatePending: true, manualUpdatePendingSince: '2026-10-01T00:00:00.000Z' }), ghostLive], status: 'PUBLISHED' });
    await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true });
    expect(c.row.status).toBe('PUBLISHED');
    expect(c.row.publishedTo[0]).toMatchObject({ trashedAt: expect.any(String) });
    expect(c.row.publishedTo[0]).not.toHaveProperty('manualUpdatePending');
    expect(c.llmsFullBuilder.build).not.toHaveBeenCalled();
  });

  it('musteri yaziyi geri yukledi: sonraki yayin ayni yaziyi bulur (kopya acmaz); geri yukleme degisiklik sayilir, onayla yazilir ve trashedAt kalkar', async () => {
    posts = posts1(wpPost({ status: 'publish', modified_gmt: '2026-10-10T10:00:00' }));
    const c = build({ targets: [WP_T], publishedTo: [wpEntry({ trashedAt: '2026-10-05T00:00:00.000Z' })], status: 'READY_TO_PUBLISH' });
    const [first] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true });
    expect(first).toMatchObject({ ok: false, skipped: 'live_entry_edited' });
    expect(c.row.publishedTo[0]).not.toHaveProperty('trashedAt');
    expect(c.row.status).toBe('PUBLISHED');
    const [second] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, overwriteRemoteEdits: true });
    expect(second).toMatchObject({ ok: true, action: 'updated', externalId: '123' });
    expect(posts.size).toBe(1);
  });
});

describe('D1 (S5/S11) — acik hedef listesi AYNEN uygulanir; secilmeyen canli kopya yazilmaz, raporlanir ve isaretlenir', () => {
  it('panel yalniz FTP\'yi gonderdi, yazi WordPress\'te yayinda: WordPress\'e HIC istek gitmez; live_target_not_selected + elle guncelleme isareti; FTP\'ye ilk yayin', async () => {
    const c = build({ targets: [FTP_T, WP_T], publishedTo: [wpEntry()] });
    const ftpPublish = vi.fn(async () => ({ ok: true, externalUrl: `ftp://${IP}/public_html/kdv-beyani-rehberi.html` }));
    const adapters = await import('@luviai/adapters');
    const spy = vi.spyOn(adapters.FtpAdapter.prototype, 'publish').mockImplementation(ftpPublish as any);
    try {
      const results = await c.svc.publishArticle('a1', ['t-ftp'], { overrideQa: true, initiator: 'user' });
      expect(results.map((r) => [r.targetId, r.ok, r.action ?? r.skipped])).toEqual([
        ['t-ftp', true, 'created'],
        ['t-wp', false, 'live_target_not_selected'],
      ]);
      expect(results[1].error).toContain('WordPress seçilmediği için oraya yazılmadı');
      expect(results[1].error).toContain('eski metni gösteriyor ve elle güncelleme bekliyor');
      // Musterinin secmedigi canli yazi: ne okuma ne yazma
      expect(reqs).toEqual([]);
      expect(posts.get(123)?.content).toBe('<p>Eski metin.</p>');
      const wp = c.row.publishedTo.find((e: any) => e.targetId === 't-wp');
      expect(wp).toMatchObject({ externalId: '123', updatedAt: '2026-09-01T10:00:05.000Z', manualUpdatePending: true });
      // Rapor alani kayda girmez; yazi zaten yayindaydi → ilk yayin tarihi degismez
      expect(c.row.publishedTo.every((e: any) => !('skipped' in e))).toBe(true);
      expect(c.row.publishedAt).toEqual(FIRST_AT);
    } finally {
      spy.mockRestore();
    }
  });

  it('S5: onay bekleyen yeniden yazim (READY_TO_PUBLISH), musteri canli WordPress\'i kapatip yalniz Markdown ZIP secti: WordPress\'e onaysiz metin GITMEZ', async () => {
    const c = build({ targets: [ZIP_T, WP_T], publishedTo: [wpEntry()], status: 'READY_TO_PUBLISH' });
    const adapters = await import('@luviai/adapters');
    const spy = vi.spyOn(adapters.MarkdownZipAdapter.prototype, 'publish').mockImplementation((async () => ({ ok: true, externalUrl: '/tmp/x.zip' })) as any);
    try {
      const results = await c.svc.publishArticle('a1', ['t-zip'], { overrideQa: true, initiator: 'user' });
      expect(results.map((r) => [r.targetId, r.ok, r.action ?? r.skipped])).toEqual([['t-zip', true, 'created'], ['t-wp', false, 'live_target_not_selected']]);
      expect(reqs.filter((x) => x.path.startsWith('/wp-json/'))).toEqual([]);
      expect(posts.get(123)?.content).toBe('<p>Eski metin.</p>');
      expect(c.row.publishedTo.find((e: any) => e.targetId === 't-wp')).toMatchObject({ manualUpdatePending: true });
    } finally {
      spy.mockRestore();
    }
  });

  it('S5: QA engelli yazi "Yine de yayinla" (overrideQa) + yalniz ZIP: engelli metin canli WordPress\'e ulasmaz', async () => {
    const c = build({ targets: [ZIP_T, WP_T], publishedTo: [wpEntry()], status: 'READY_TO_PUBLISH' });
    c.row.qaStatus = 'BLOCKED';
    c.row.bodyMd = '# KDV Beyanı Rehberi\n\n[KAYNAK EKLE] engelli metin.';
    const adapters = await import('@luviai/adapters');
    const spy = vi.spyOn(adapters.MarkdownZipAdapter.prototype, 'publish').mockImplementation((async () => ({ ok: true, externalUrl: '/tmp/x.zip' })) as any);
    try {
      await c.svc.publishArticle('a1', ['t-zip'], { overrideQa: true, initiator: 'user' });
      expect(posts.get(123)?.content).not.toContain('[KAYNAK EKLE]');
      expect(reqs.filter((x) => x.method === 'POST')).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('S11: canli FTP kopyasi secilmedi, yeni bir WordPress hedefi secildi: FTP dosyasinin uzerine YAZILMAZ (elle duzenlemesi korunur)', async () => {
    posts = new Map();
    const ftpLive = { targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: `ftp://${IP}/public_html/kdv-beyani-rehberi.html`, updatedAt: '2026-09-01T10:00:05.000Z', contentHash: 'eski-metnin-izi' };
    const c = build({ targets: [FTP_T, WP_T], publishedTo: [ftpLive] });
    const adapters = await import('@luviai/adapters');
    const ftpSpy = vi.spyOn(adapters.FtpAdapter.prototype, 'publish').mockImplementation((async () => ({ ok: true, externalUrl: 'ftp://x' })) as any);
    try {
      const results = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
      expect(ftpSpy).not.toHaveBeenCalled();
      expect(results.map((r) => [r.targetId, r.ok, r.action ?? r.skipped])).toEqual([['t-wp', true, 'created'], ['t-ftp', false, 'live_target_not_selected']]);
      expect(results[1].error).toContain('yazının sayfasında FTP hedefini de seçerek yeniden yayınlayabilirsiniz');
      expect(c.row.publishedTo.find((e: any) => e.targetId === 't-ftp')).toMatchObject({ manualUpdatePending: true });
    } finally {
      ftpSpy.mockRestore();
    }
  });

  it('izsiz eski kayitta secilmeyen kopya icin "metin ayni" denmez, bilinmedigi soylenir', async () => {
    // Bu degisiklikten once yazilmis kayit: contentHash izi yok, isaret yok, yazi PUBLISHED
    const c = build({ targets: [ZIP_T, WP_T], publishedTo: [wpEntry({ contentHash: undefined })], status: 'PUBLISHED' });
    const adapters = await import('@luviai/adapters');
    const spy = vi.spyOn(adapters.MarkdownZipAdapter.prototype, 'publish').mockImplementation((async () => ({ ok: true, externalUrl: '/tmp/x.zip' })) as any);
    try {
      const results = await c.svc.publishArticle('a1', ['t-zip'], { overrideQa: true, initiator: 'user' });
      const wpResult = results.find((r) => r.targetId === 't-wp')!;
      expect(wpResult).toMatchObject({ ok: false, skipped: 'live_target_not_selected' });
      expect(wpResult.error).toContain('bilinmiyor');
      expect(wpResult.error).not.toContain('yapılacak bir şey yok');
    } finally {
      spy.mockRestore();
    }
  });

  it('secilmeyen kopya zaten guncel metni tasiyorsa isaretlenmez ve "eski metin" denmez', async () => {
    const c = build({ targets: [ZIP_T, WP_T], publishedTo: [wpEntry({ contentHash: HASH })], status: 'PUBLISHED' });
    const adapters = await import('@luviai/adapters');
    const spy = vi.spyOn(adapters.MarkdownZipAdapter.prototype, 'publish').mockImplementation((async () => ({ ok: true, externalUrl: '/tmp/x.zip' })) as any);
    try {
      const results = await c.svc.publishArticle('a1', ['t-zip'], { overrideQa: true, initiator: 'user' });
      const wpResult = results.find((r) => r.targetId === 't-wp')!;
      expect(wpResult).toMatchObject({ ok: false, skipped: 'live_target_not_selected' });
      expect(wpResult.error).toContain('yapılacak bir şey yok');
      expect(c.row.publishedTo.find((e: any) => e.targetId === 't-wp')).not.toHaveProperty('manualUpdatePending');
    } finally {
      spy.mockRestore();
    }
  });

  it('"Bu hedefe yeniden yayinla" (tek hedef) yalniz o hedefe yazar; diger canli kopya raporlanir', async () => {
    posts = posts1(wpPost(), wpPost({ id: 124, slug: 'kdv-beyani-rehberi-2', link: `${SITE}/kdv-beyani-rehberi-2/` }));
    const second = { targetId: 't-wpx', targetType: 'WORDPRESS_XMLRPC', ok: true, externalId: '124', externalUrl: `${SITE}/kdv-beyani-rehberi-2/`, updatedAt: '2026-09-01T10:00:05.000Z', remoteModifiedAt: '2026-09-01T10:00:00.000Z', contentHash: 'eski-metnin-izi' };
    const c = build({ targets: [WP_T, WPX_T], publishedTo: [wpEntry(), second], status: 'PUBLISHED' });
    const results = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
    expect(results.map((r) => [r.targetId, r.action ?? r.skipped])).toEqual([['t-wp', 'updated'], ['t-wpx', 'live_target_not_selected']]);
    expect(reqs.some((x) => x.path === '/xmlrpc.php')).toBe(false);
    expect(posts.get(124)?.content).toBe('<p>Eski metin.</p>');
  });

  it('secilmeyen canli kopya yalniz yeni kayit acan hedefte (Ghost): "secip yeniden yayinlayin" denmez, elle uygulama soylenir', async () => {
    const ghostT = { id: 't-ghost', type: 'GHOST', credentials: {}, config: {}, isActive: true };
    const ghostLive = { targetId: 't-ghost', targetType: 'GHOST', ok: true, externalId: 'g1', contentHash: 'eski-metnin-izi' };
    const c = build({ targets: [WP_T, ghostT], publishedTo: [wpEntry(), ghostLive], status: 'READY_TO_PUBLISH' });
    const results = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
    const ghost = results.find((r) => r.targetId === 't-ghost')!;
    expect(ghost).toMatchObject({ ok: false, skipped: 'live_target_not_selected' });
    expect(ghost.error).toContain('RanksUp bu kopyayı yerinde güncelleyemiyor; güncel metni Ghost panelinden elle uygulayın.');
    expect(ghost.error).not.toContain('seçerek yeniden yayınlayabilirsiniz');
  });

  it('hicbir hedefe yazilmayan yayinda da (secilen hedef kopya acardi) secilmeyen canli kopya raporlanir ve isaretlenir', async () => {
    const ghostT = { id: 't-ghost', type: 'GHOST', credentials: {}, config: {}, isActive: true };
    const ghostLive = { targetId: 't-ghost', targetType: 'GHOST', ok: true, externalId: 'g1' };
    const c = build({ targets: [WP_T, ghostT], publishedTo: [wpEntry(), ghostLive], status: 'READY_TO_PUBLISH' });
    const results = await c.svc.publishArticle('a1', ['t-ghost'], { overrideQa: true, initiator: 'user' });
    expect(results.map((r) => [r.targetId, r.skipped])).toEqual([['t-ghost', 'already_live_create_only'], ['t-wp', 'live_target_not_selected']]);
    expect(reqs).toEqual([]);
    expect(c.row.publishedTo.find((e: any) => e.targetId === 't-wp')).toMatchObject({ manualUpdatePending: true });
    expect(c.row.status).toBe('PUBLISHED');
  });

  it('bos liste (panel tablosu, otomasyon) yayindaki yazida canli hedeflere yazar (degismedi)', async () => {
    const c = build({ targets: [FTP_T, WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' });
    const results = await c.svc.publishArticle('a1', [], { overrideQa: true, initiator: 'user' });
    expect(results.map((r) => [r.targetId, r.action ?? r.skipped])).toEqual([['t-wp', 'updated']]);
    expect(posts.get(123)?.content).toContain('Güncel metin.');
  });

  it('S25: yazinin yalniz Markdown ZIP kaydi var, bos liste: varsayilan site hedefine (FTP) ilk yayin; ZIP yeniden uretilmez, ilk yayin tarihi yazilir', async () => {
    const zipOnly = [{ targetId: 't-zip', targetType: 'MARKDOWN_ZIP', ok: true, action: 'exported', externalUrl: '/tmp/eski.zip' }];
    const c = build({ targets: [FTP_T, ZIP_T], publishedTo: zipOnly, status: 'READY_TO_PUBLISH' });
    const adapters = await import('@luviai/adapters');
    const ftpSpy = vi.spyOn(adapters.FtpAdapter.prototype, 'publish').mockImplementation((async () => ({ ok: true, externalUrl: `ftp://${IP}/public_html/kdv-beyani-rehberi.html` })) as any);
    const zipSpy = vi.spyOn(adapters.MarkdownZipAdapter.prototype, 'publish').mockImplementation((async () => ({ ok: true, externalUrl: '/tmp/yeni.zip' })) as any);
    try {
      const results = await c.svc.publishArticle('a1', [], { overrideQa: true, initiator: 'user' });
      expect(results.map((r) => [r.targetId, r.action ?? r.skipped])).toEqual([['t-ftp', 'created']]);
      expect(zipSpy).not.toHaveBeenCalled();
      expect(c.row.status).toBe('PUBLISHED');
      expect(c.row.publishedAt).not.toEqual(FIRST_AT);
    } finally {
      ftpSpy.mockRestore();
      zipSpy.mockRestore();
    }
  });
});

describe('R11 — ilk yayin tarihi yalniz ilk gercek yayinda yazilir', () => {
  it('yayindaki yazinin Markdown ZIP disa aktarimi publishedAt\'i degistirmez; hic canli kopyasi kalmamis yazinin yeniden yayini degistirir', async () => {
    const adapters = await import('@luviai/adapters');
    const spy = vi.spyOn(adapters.MarkdownZipAdapter.prototype, 'publish').mockImplementation((async () => ({ ok: true, externalUrl: '/tmp/x.zip' })) as any);
    try {
      const live = build({ targets: [ZIP_T, WP_T], publishedTo: [wpEntry()] });
      await live.svc.publishArticle('a1', ['t-zip'], { overrideQa: true });
      expect(live.row.publishedAt).toEqual(FIRST_AT);
      expect(live.writes.every((w) => !('publishedAt' in w))).toBe(true);

      // Yalniz ZIP kaydi (sitede yayinda degil) → WordPress'e ilk gercek yayin tarihi yazar
      posts = new Map();
      const zipOnly = build({ targets: [WP_T], publishedTo: [{ targetId: 't-zip', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/eski.zip' }] });
      await zipOnly.svc.publishArticle('a1', ['t-wp'], { overrideQa: true });
      expect(zipOnly.row.publishedAt).not.toEqual(FIRST_AT);
      expect(zipOnly.row.publishedAt).toBeInstanceOf(Date);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('K10 — yayinin sonu, yayin sirasinda yapilan kayit degisikliklerini ezmez', () => {
  it('yayin surerken musteri baska bir kopyayi "unuttu" ve digerine "guncelledim" dedi: yayinin sonucu GUNCEL listeye birlestirilir', async () => {
    const ghostA = { targetId: 't-ghost-a', targetType: 'GHOST', ok: true, externalId: 'ga', manualUpdatePending: true, manualUpdatePendingSince: '2026-10-01T00:00:00.000Z', contentHash: 'eski' };
    const ghostB = { targetId: 't-ghost-b', targetType: 'GHOST', ok: true, externalId: 'gb', contentHash: 'eski' };
    const c = build({ targets: [WP_T, { id: 't-ghost-a', type: 'GHOST', credentials: {}, config: {}, isActive: true }, { id: 't-ghost-b', type: 'GHOST', credentials: {}, config: {}, isActive: true }], publishedTo: [wpEntry(), ghostA, ghostB], status: 'PUBLISHED' });
    // WordPress okunurken (yayin sirasinda) mark-updated (A) ve forget (B) uclari yazar
    onFirstRead = () => c.concurrent((row) => {
      row.publishedTo = row.publishedTo
        .filter((e: any) => e.targetId !== 't-ghost-b')
        .map((e: any) => (e.targetId === 't-ghost-a' ? { ...e, manualUpdatePending: undefined, manualUpdatePendingSince: undefined, contentHash: HASH, manualUpdatedAt: '2026-10-18T09:30:00.000Z' } : e));
    });
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true });
    expect(r).toMatchObject({ ok: true, action: 'updated' });
    expect(c.prisma.article.updateMany).toHaveBeenCalledTimes(1);
    const ids = c.row.publishedTo.map((e: any) => e.targetId);
    // Unutulan kayit geri gelmedi; "guncelledim" bilgisi korundu; WordPress kaydi taze
    expect(ids).toEqual(['t-wp', 't-ghost-a']);
    expect(c.row.publishedTo[1]).toMatchObject({ contentHash: HASH, manualUpdatedAt: '2026-10-18T09:30:00.000Z' });
    expect(c.row.publishedTo[1].manualUpdatePending).toBeUndefined();
    expect(c.row.publishedTo[0]).toMatchObject({ externalId: '123', contentHash: HASH });
  });

  it('yazim aninda yaris (okunan updatedAt eskidi): yeniden okunup birlestirilir, araya giren degisiklik kaybolmaz', async () => {
    const ghostB = { targetId: 't-ghost-b', targetType: 'GHOST', ok: true, externalId: 'gb', contentHash: 'eski' };
    const c = build({ targets: [WP_T, { id: 't-ghost-b', type: 'GHOST', credentials: {}, config: {}, isActive: true }], publishedTo: [wpEntry(), ghostB], status: 'PUBLISHED' });
    const realFind = c.prisma.article.findUnique.getMockImplementation()!;
    let reads = 0;
    c.prisma.article.findUnique.mockImplementation(async (...args: any[]) => {
      const snapshot = await realFind(...(args as []));
      reads += 1;
      // Ilk birlestirme okumasindan hemen sonra forget yazar → kosullu yazim tutmaz
      if (reads === 1) c.concurrent((row) => { row.publishedTo = row.publishedTo.filter((e: any) => e.targetId !== 't-ghost-b'); });
      return snapshot;
    });
    await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true });
    expect(c.prisma.article.updateMany).toHaveBeenCalledTimes(2);
    expect(c.row.publishedTo.map((e: any) => e.targetId)).toEqual(['t-wp']);
  });

  it('metin yayin sirasinda degisti (yeniden yazim bitti): kayit listesi yazilir ama durum PUBLISHED ve onizleme yeni metnin uzerine yazilmaz', async () => {
    const c = build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'READY_TO_PUBLISH' });
    onFirstRead = () => c.concurrent((row) => { row.bodyMd = '# KDV\n\nYayın sırasında biten yeniden yazım.'; row.status = 'REVIZE_NEEDED'; row.bodyHtml = null; });
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true });
    expect(r).toMatchObject({ ok: true, action: 'updated' });
    expect(c.row.status).toBe('REVIZE_NEEDED');
    expect(c.row.bodyHtml).toBeNull();
    expect(c.row.publishedTo[0].contentHash).toBe(HASH);
  });
});

describe('C1 kapsami — uzerine yazma onayi yalniz ADI VERILEN hedefe uygulanir', () => {
  /** Iki WordPress kopyasi, ikisi de RanksUp'in son yazimindan sonra wp-admin'de duzenlenmis */
  const editedBoth = () => posts1(
    wpPost({ title: 'KDV (müşteri 1)', content: '<p>Müşterinin REST kopyasındaki eki</p>', modified_gmt: '2026-09-05T08:30:00' }),
    wpPost({ id: 124, slug: 'kdv-beyani-rehberi-2', link: `${SITE}/kdv-beyani-rehberi-2/`, title: 'KDV (müşteri 2)', content: '<p>Müşterinin ikinci kopyadaki fiyat tablosu</p>', modified_gmt: '2026-09-06T08:30:00' }),
  );
  const secondCopy = {
    targetId: 't-wpx', targetType: 'WORDPRESS_XMLRPC', ok: true, externalId: '124', externalUrl: `${SITE}/kdv-beyani-rehberi-2/`,
    updatedAt: '2026-09-01T10:00:05.000Z', remoteModifiedAt: '2026-09-01T10:00:00.000Z', contentHash: 'eski-metnin-izi',
  };
  const rpcMethods = () => reqs.map((x) => x.body.match(/<methodName>([^<]+)</)?.[1]).filter(Boolean);

  it('musteri yalniz REST kopyasi icin onay verdi: o yazilir; secilmeyen ikinci WordPress kopyasina hic dokunulmaz (D1), isaretlenir', async () => {
    posts = editedBoth();
    const c = build({ targets: [WP_T, WPX_T], publishedTo: [wpEntry(), secondCopy], status: 'PUBLISHED' });
    const results = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, overwriteRemoteEdits: true, initiator: 'user' });
    expect(results.map((r) => [r.targetId, r.ok, r.action ?? r.skipped])).toEqual([
      ['t-wp', true, 'updated'],
      ['t-wpx', false, 'live_target_not_selected'],
    ]);
    expect(posts.get(123)?.title).toBe('KDV Beyanı Rehberi');
    // Onay verilmeyen kopyadaki musteri duzenlemesi aynen duruyor; wp.editPost hic gitmedi
    expect(posts.get(124)).toMatchObject({ title: 'KDV (müşteri 2)', content: '<p>Müşterinin ikinci kopyadaki fiyat tablosu</p>' });
    expect(rpcMethods()).not.toContain('wp.editPost');
    expect(c.row.publishedTo.find((e: any) => e.targetId === 't-wpx')).toMatchObject({ manualUpdatePending: true });
  });

  it('onay hedef adi vermeden gelirse (bos liste: yazinin canli hedefleri secilir) hicbir kopya zorlanmaz', async () => {
    posts = editedBoth();
    const c = build({ targets: [WP_T, WPX_T], publishedTo: [wpEntry(), secondCopy], status: 'PUBLISHED' });
    const results = await c.svc.publishArticle('a1', [], { overrideQa: true, overwriteRemoteEdits: true });
    expect(results.map((r) => [r.targetId, r.skipped])).toEqual([['t-wp', 'live_entry_edited'], ['t-wpx', 'live_entry_edited']]);
    expect(reqs.filter((x) => x.method === 'POST' && x.path.startsWith('/wp-json/'))).toEqual([]);
    expect(rpcMethods()).not.toContain('wp.editPost');
    expect(posts.get(123)?.title).toBe('KDV (müşteri 1)');
    expect(posts.get(124)?.title).toBe('KDV (müşteri 2)');
  });

  it('kontrol: iki kopyanin da adi verilirse ikisinin de ustune yazilir', async () => {
    posts = editedBoth();
    const c = build({ targets: [WP_T, WPX_T], publishedTo: [wpEntry(), secondCopy], status: 'PUBLISHED' });
    const results = await c.svc.publishArticle('a1', ['t-wp', 't-wpx'], { overrideQa: true, overwriteRemoteEdits: true });
    expect(results.map((r) => [r.targetId, r.action])).toEqual([['t-wp', 'updated'], ['t-wpx', 'updated']]);
    expect(posts.get(124)?.title).toBe('KDV Beyanı Rehberi');
  });
});

describe('D2/D3 (S3, S18) — silinmis WordPress yazisi yalniz kullanicinin acik seciminde yeniden ACILIR; aksi halde kayit missingAt alir', () => {
  it('takili sayfa cagrisi (recreateMissing:false): yalniz okuma, POST yok; live_entry_missing; kayda missingAt, son canli kopya → READY_TO_PUBLISH + llms-full', async () => {
    posts = new Map();
    const c = build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' });
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { recreateMissing: false });
    expect(r).toMatchObject({ targetId: 't-wp', ok: false, skipped: 'live_entry_missing' });
    expect(r.error).toContain('WordPress üzerinde artık bulunamadı');
    expect(r.error).toContain('yeniden oluşturulmadı');
    expect(r.error).toContain('yazının sayfasında WordPress hedefini seçerek yeniden yayınlayın');
    // Yalniz okuma: yeni yazi (POST /posts) yok
    expect(reqs.map((x) => `${x.method} ${x.path}`)).toEqual(['GET /wp-json/wp/v2/posts/123']);
    expect(posts.size).toBe(0);
    // Kimlik ve adres korunur, kopya artik canli sayilmaz (site haritasi / llms-full / pivot onu ilan etmez)
    expect(c.row.publishedTo).toEqual([{ ...wpEntry(), missingAt: expect.any(String) }]);
    expect(liveEntries(c.row.publishedTo)).toEqual([]);
    expect(lastLiveWriteAt(c.row.publishedTo)).toBeNull();
    expect(c.row.status).toBe('READY_TO_PUBLISH');
    expect(c.llmsFullBuilder.build).toHaveBeenCalledWith('s1');
  });

  it('XML-RPC: wp.getPost "Invalid post ID." (404) → metaWeblog.newPost yok', async () => {
    posts = new Map();
    const entry = { targetId: 't-wpx', targetType: 'WORDPRESS_XMLRPC', ok: true, externalId: '123', externalUrl: `${SITE}/?p=123`, updatedAt: '2026-09-01T10:00:05.000Z', remoteModifiedAt: '2026-09-01T10:00:00.000Z' };
    const c = build({ targets: [WPX_T], publishedTo: [entry], status: 'PUBLISHED' });
    const [r] = await c.svc.publishArticle('a1', ['t-wpx'], { recreateMissing: false });
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_missing' });
    expect(reqs.map((x) => x.body.match(/<methodName>([^<]+)</)?.[1])).toEqual(['wp.getPost']);
    expect(posts.size).toBe(0);
    expect(c.row.publishedTo[0]).toMatchObject({ missingAt: expect.any(String) });
  });

  it('silinmis kopya "eski metniyle yayinda" sayilmaz: onaydaki yazi PUBLISHED\'a cekilmez', async () => {
    posts = new Map();
    const c = build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'READY_TO_PUBLISH' });
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { recreateMissing: false });
    expect(r.skipped).toBe('live_entry_missing');
    expect(c.row.status).toBe('READY_TO_PUBLISH');
  });

  it('S3: Tam otomatik / pivot yayini (initiator verilmez = otomasyon, bos liste): silinen yazi yeniden ACILMAZ', async () => {
    posts = new Map();
    const c = build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'READY_TO_PUBLISH' });
    const [r] = await c.svc.publishArticle('a1', []);
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_missing' });
    expect(reqs.filter((x) => x.method === 'POST')).toEqual([]);
    expect(posts.size).toBe(0);
    expect(c.row.publishedTo[0]).toMatchObject({ externalId: '123', missingAt: expect.any(String) });
  });

  it('otomasyon acik hedef listesiyle de (takili sayfa plani gibi) yeniden acmaz', async () => {
    posts = new Map();
    const c = build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' });
    expect((await c.svc.publishArticle('a1', ['t-wp'], { initiator: 'automation' }))[0]).toMatchObject({ skipped: 'live_entry_missing' });
    expect(posts.size).toBe(0);
  });

  it('kullanici bos listeyle yayinladi (panel tablosu): hedef ADI verilmedi — yeniden acilmaz', async () => {
    posts = new Map();
    const c = build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'READY_TO_PUBLISH' });
    expect((await c.svc.publishArticle('a1', [], { overrideQa: true, initiator: 'user' }))[0]).toMatchObject({ skipped: 'live_entry_missing' });
    expect(posts.size).toBe(0);
  });

  it('S3: kullanici yeni bir FTP hedefine yayinladi, WordPress secilmedi: silinmis WordPress yazisina hic gidilmez, yeniden ACILMAZ', async () => {
    posts = new Map();
    const c = build({ targets: [FTP_T, WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' });
    const adapters = await import('@luviai/adapters');
    const ftpSpy = vi.spyOn(adapters.FtpAdapter.prototype, 'publish').mockImplementation((async () => ({ ok: true, externalUrl: `ftp://${IP}/public_html/kdv-beyani-rehberi.html` })) as any);
    try {
      const results = await c.svc.publishArticle('a1', ['t-ftp'], { overrideQa: true, initiator: 'user' });
      expect(results.map((r) => [r.targetId, r.action ?? r.skipped])).toEqual([['t-ftp', 'created'], ['t-wp', 'live_target_not_selected']]);
      expect(reqs).toEqual([]);
      expect(posts.size).toBe(0);
    } finally {
      ftpSpy.mockRestore();
    }
  });

  it('kullanici WordPress hedefini ACIKCA secip yayinladi: silinen yazi yeniden olusturulur (recreated); missingAt kalkar, ilk yayin tarihi DEGISMEZ', async () => {
    posts = new Map();
    // Once otomasyon silindigini gordu: kayit missingAt, yazi READY_TO_PUBLISH
    const c = build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' });
    await c.svc.publishArticle('a1', []);
    expect(c.row.status).toBe('READY_TO_PUBLISH');
    expect(c.row.publishedTo[0]).toHaveProperty('missingAt');
    // Sonra musteri yazinin sayfasindan WordPress'i secip yayinladi
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
    expect(r).toMatchObject({ ok: true, action: 'recreated' });
    expect(reqs.filter((x) => x.method === 'POST').map((x) => x.path)).toEqual(['/wp-json/wp/v2/posts']);
    expect(posts.size).toBe(1);
    expect(c.row.publishedTo).toHaveLength(1);
    expect(c.row.publishedTo[0]).not.toHaveProperty('missingAt');
    expect(c.row.publishedTo[0]).toMatchObject({ action: 'recreated', externalId: String([...posts.keys()][0]) });
    expect(c.row.status).toBe('PUBLISHED');
    // Icerik yeni degil: raporlar onu bu donemin yayini saymaz (R11)
    expect(c.row.publishedAt).toEqual(FIRST_AT);
  });

  it('ayni yayinda baska hedefe yazildiysa da (basarili yayin yolu) silinmis kopya missingAt alir', async () => {
    posts = new Map();
    const ftpLive = { targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: `ftp://${IP}/public_html/kdv-beyani-rehberi.html`, updatedAt: '2026-09-01T10:00:05.000Z' };
    const c = build({ targets: [WP_T, FTP_T], publishedTo: [wpEntry(), ftpLive], status: 'READY_TO_PUBLISH' });
    const adapters = await import('@luviai/adapters');
    const ftpSpy = vi.spyOn(adapters.FtpAdapter.prototype, 'publish').mockImplementation((async () => ({ ok: true, externalUrl: ftpLive.externalUrl })) as any);
    try {
      const results = await c.svc.publishArticle('a1', []);
      expect(results.map((r) => [r.targetId, r.action ?? r.skipped])).toEqual([['t-wp', 'live_entry_missing'], ['t-ftp', 'overwritten']]);
      expect(c.row.publishedTo.find((e: any) => e.targetId === 't-wp')).toMatchObject({ externalId: '123', missingAt: expect.any(String) });
      expect(liveEntries(c.row.publishedTo).map((e) => e.targetId)).toEqual(['t-ftp']);
      expect(c.row.status).toBe('PUBLISHED');
    } finally {
      ftpSpy.mockRestore();
    }
  });

  it('silinmis kopya "hala yayinda" sayilmaz: baska canli kopya sonuca girmese de (pasif hedef) onaydaki yazi PUBLISHED\'a cekilmez', async () => {
    posts = new Map();
    const ftpLive = { targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: `ftp://${IP}/public_html/kdv-beyani-rehberi.html` };
    const c = build({ targets: [WP_T, { ...FTP_T, isActive: false }], publishedTo: [wpEntry(), ftpLive], status: 'READY_TO_PUBLISH' });
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { recreateMissing: false });
    expect(r.skipped).toBe('live_entry_missing');
    expect(c.row.status).toBe('READY_TO_PUBLISH');
  });

  it('baska canli kopya varsa yazi PUBLISHED kalir; yalniz silinmis kopya missingAt alir', async () => {
    posts = new Map();
    const ghostLive = { targetId: 't-ghost', targetType: 'GHOST', ok: true, externalId: 'g1', contentHash: HASH };
    const c = build({ targets: [WP_T, { id: 't-ghost', type: 'GHOST', credentials: {}, config: {}, isActive: true }], publishedTo: [wpEntry(), ghostLive], status: 'PUBLISHED' });
    await c.svc.publishArticle('a1', ['t-wp'], { recreateMissing: false });
    expect(c.row.status).toBe('PUBLISHED');
    expect(c.row.publishedTo[0]).toMatchObject({ missingAt: expect.any(String) });
    expect(liveEntries(c.row.publishedTo).map((e) => e.targetId)).toEqual(['t-ghost']);
    expect(c.llmsFullBuilder.build).not.toHaveBeenCalled();
  });
});

describe('S18 yan etkisi — kimligin 404\'u tek basina yaziyi emekliye ayirmaz: once yazinin herkese acik adresi yoklanir', () => {
  /**
   * Sahte on yuz: yayindaki yazinin (ya da sayfanin) kalici adresi 200, yoksa 404.
   * GERCEK checkEntryPublicUrl siniflandirmasi bu sahte tasimayla calisir
   * (yonlendirme izleme ve SSRF korumasi publisher-entry-url-check.spec.ts'te).
   */
  let frontReqs: Array<{ url: string; opts: any }> = [];
  let frontOverride: ((url: string) => number | Error) | null = null;
  const frontFetch = async (url: string, opts: any) => {
    frontReqs.push({ url, opts });
    const forced = frontOverride?.(url);
    if (forced instanceof Error) throw forced;
    const status = forced ?? ([...posts.values()].some((p) => p.link === url && p.status === 'publish') ? 200 : 404);
    return { status, ok: status >= 200 && status < 300, url, redirected: false, contentType: 'text/html', headers: {}, text: '', truncated: false, binary: false };
  };
  /** Nest'in onModuleInit'te kurdugu yoklayicinin yerine ayni islev, sahte on yuzle */
  const withUrlCheck = <T extends { svc: any }>(c: T): T => {
    c.svc.entryUrlCheck = (url: string | undefined) => checkEntryPublicUrl(url, frontFetch as any);
    return c;
  };
  const restCalls = () => reqs.map((x) => `${x.method} ${x.path}`);

  beforeEach(() => {
    frontReqs = [];
    frontOverride = null;
  });

  it('yazi SAYFAYA donusturuldu (REST 404 rest_post_invalid_id), kalici adres hala aciliyor: otomasyon emekliye AYIRMAZ, yazi PUBLISHED kalir', async () => {
    // rv15 s3-s18-probes: eskiden live_entry_missing, durum READY_TO_PUBLISH, adres ilandan dusuyordu
    posts = posts1(wpPost({ type: 'page' }));
    const c = withUrlCheck(build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' }));
    const [r] = await c.svc.publishArticle('a1', []);
    expect(r).toMatchObject({ targetId: 't-wp', ok: false, skipped: 'live_entry_unresolvable' });
    expect(r.error).toBe('Bu yazı WordPress üzerinde kayıtlı kimliğiyle (#123) bulunamadı, ancak yazının adresi hâlâ açılıyor: yazı sayfaya dönüştürülmüş, site yeniden içe aktarılırken kimlikler değişmiş ya da adres önbellekten sunuluyor olabilir. Yazının ikinci bir kopyasını açmamak için yeniden oluşturulmadı ve hiçbir şey yazılmadı; RanksUp bu kopyayı yayında saymaya devam ediyor. Güncel metni WordPress panelinden bu adresteki yazıya elle uygulayabilirsiniz.');
    // Yeniden olusturma onerilmez (izlenirse ayni adreste ikinci kopya acardi)
    expect(r.error).not.toMatch(/yeniden yayınla|yeniden oluşturur/);
    // Yalniz kimlik okumasi + adresin tek GET'i; POST yok
    expect(restCalls()).toEqual(['GET /wp-json/wp/v2/posts/123']);
    expect(frontReqs.map((x) => x.url)).toEqual([`${SITE}/kdv-beyani-rehberi/`]);
    // Kopya canli kalir: missingAt yok, site haritasi / pivot / dedektor onu gormeye devam eder
    expect(c.row.status).toBe('PUBLISHED');
    expect(c.row.publishedTo[0]).not.toHaveProperty('missingAt');
    expect(liveEntries(c.row.publishedTo).map((e) => e.targetId)).toEqual(['t-wp']);
    expect(c.row.publishedTo[0]).toMatchObject({ externalId: '123', externalUrl: `${SITE}/kdv-beyani-rehberi/` });
    // Yeni metin kopyaya gitmedi: elle guncelleme isareti ("Elle güncelledim" acilir)
    expect(c.row.publishedTo[0]).toMatchObject({ manualUpdatePending: true });
    expect(c.llmsFullBuilder.build).not.toHaveBeenCalled();

    // Kullanici WordPress'i ACIKCA secip yayinladi: yine yazilmaz, ikinci kopya ACILMAZ
    reqs = [];
    const [u] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
    expect(u).toMatchObject({ ok: false, skipped: 'live_entry_unresolvable' });
    expect(reqs.filter((x) => x.method === 'POST')).toEqual([]);
    expect([...posts.values()].filter((p) => p.slug === 'kdv-beyani-rehberi').map((p) => `${p.id}:${p.type}`)).toEqual(['123:page']);
  });

  it('kayit kimlik 404\'uyle emekliye ayrilmisti (missingAt) ama adres aciliyor: kopya yeniden canli, isaretli; "Elle güncelledim" artik 404 vermez', async () => {
    posts = posts1(wpPost({ type: 'page' }));
    const c = withUrlCheck(build({ targets: [WP_T], publishedTo: [wpEntry({ missingAt: '2026-10-10T00:00:00.000Z' })], status: 'READY_TO_PUBLISH' }));
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
    expect(r.skipped).toBe('live_entry_unresolvable');
    expect(reqs.filter((x) => x.method === 'POST')).toEqual([]);
    expect(c.row.publishedTo[0]).not.toHaveProperty('missingAt');
    expect(c.row.publishedTo[0]).toMatchObject({ manualUpdatePending: true });
    // Yazi gercekten yayinda (eski metniyle): durum PUBLISHED'a doner
    expect(c.row.status).toBe('PUBLISHED');
    // Musteri metni sayfaya yapistirip "Elle güncelledim" dedi: kayit canli oldugu icin bulunur
    const articles = new ArticlesService(c.prisma as any, {} as any, {} as any, {} as any);
    const marked = await articles.markPublishedEntryUpdated('s1', 'a1', 't-wp');
    expect(marked.publishedTo[0]).not.toHaveProperty('manualUpdatePending');
  });

  it('yazi gercekten silinmis: kimlik 404 + adres 404 ya da 410 → eskisi gibi live_entry_missing, missingAt, READY_TO_PUBLISH', async () => {
    for (const status of [404, 410]) {
      posts = new Map();
      reqs = [];
      frontReqs = [];
      frontOverride = () => status;
      const c = withUrlCheck(build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' }));
      const [r] = await c.svc.publishArticle('a1', []);
      expect(r, String(status)).toMatchObject({ ok: false, skipped: 'live_entry_missing' });
      expect(frontReqs.map((x) => x.url), String(status)).toEqual([`${SITE}/kdv-beyani-rehberi/`]);
      expect(c.row.publishedTo[0], String(status)).toMatchObject({ missingAt: expect.any(String) });
      expect(c.row.status, String(status)).toBe('READY_TO_PUBLISH');
      expect(c.llmsFullBuilder.build, String(status)).toHaveBeenCalledWith('s1');
    }
  });

  it('adres dogrulanamadi (ag hatasi, 403, 503): otomasyon emekliye ayirmaz (live_entry_unverified), isaret koymaz, yazi PUBLISHED kalir', async () => {
    for (const forced of [new Error('ECONNRESET'), 403, 503]) {
      posts = new Map();
      reqs = [];
      frontOverride = () => forced;
      const c = withUrlCheck(build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' }));
      const [r] = await c.svc.publishArticle('a1', []);
      const label = String(forced);
      expect(r, label).toMatchObject({ ok: false, skipped: 'live_entry_unverified' });
      expect(r.error, label).toBe('Bu yazı WordPress üzerinde kayıtlı kimliğiyle (#123) bulunamadı. Yazının kaldırıldığı, adresi kontrol edilerek de doğrulanamadı (adres kayıtlı değil ya da site yanıt vermedi, hata döndürdü veya erişimi engelledi). RanksUp bu kopyayı yayında saymaya devam ediyor; hiçbir şey yazılmadı ve kopya açılmadı. Yazıyı WordPress üzerinden sildiyseniz yazının sayfasında WordPress hedefini seçerek yeniden yayınlayabilirsiniz; RanksUp yazıyı WordPress üzerinde yeniden oluşturur.');
      expect(reqs.filter((x) => x.method === 'POST'), label).toEqual([]);
      expect(c.row.status, label).toBe('PUBLISHED');
      expect(c.row.publishedTo[0], label).not.toHaveProperty('missingAt');
      // Kopyanin durumu bilinmiyor: "eski surum yayinda" iddiasi da yok
      expect(c.row.publishedTo[0], label).not.toHaveProperty('manualUpdatePending');
      expect(liveEntries(c.row.publishedTo).map((e) => e.targetId), label).toEqual(['t-wp']);
      expect(c.llmsFullBuilder.build, label).not.toHaveBeenCalled();
    }
  });

  it('adres dogrulanamazsa kullanicinin WordPress\'i acikca secen yayini eskisi gibi yeniden olusturur (D2; WAF arkasindaki site kilitlenmez)', async () => {
    posts = new Map();
    frontOverride = () => new Error('zaman asimi');
    const c = withUrlCheck(build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' }));
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
    expect(r).toMatchObject({ ok: true, action: 'recreated' });
    expect(reqs.filter((x) => x.method === 'POST').map((x) => x.path)).toEqual(['/wp-json/wp/v2/posts']);
    expect(posts.size).toBe(1);
  });

  it('XML-RPC: wp.getPost "Invalid post ID." ama adres aciliyor → live_entry_unresolvable, metaWeblog.newPost yok', async () => {
    // Kimlik renumara edildi: 123 yok, yazi ayni kalici adreste baska kimlikle duruyor
    posts = posts1(wpPost({ id: 777 }));
    const entry = { targetId: 't-wpx', targetType: 'WORDPRESS_XMLRPC', ok: true, externalId: '123', externalUrl: `${SITE}/kdv-beyani-rehberi/`, updatedAt: '2026-09-01T10:00:05.000Z', remoteModifiedAt: '2026-09-01T10:00:00.000Z' };
    const c = withUrlCheck(build({ targets: [WPX_T], publishedTo: [entry], status: 'PUBLISHED' }));
    const [r] = await c.svc.publishArticle('a1', ['t-wpx'], { overrideQa: true, initiator: 'user' });
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_unresolvable' });
    expect(reqs.map((x) => x.body.match(/<methodName>([^<]+)</)?.[1])).toEqual(['wp.getPost']);
    expect(posts.size).toBe(1);
    expect(c.row.status).toBe('PUBLISHED');
  });

  it('kayit bulunursa adres hic yoklanmaz (normal yerinde guncelleme yolu degismedi)', async () => {
    const c = withUrlCheck(build({ targets: [WP_T], publishedTo: [wpEntry({ remoteModifiedAt: '2026-09-01T10:00:00.000Z' })], status: 'READY_TO_PUBLISH' }));
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, overwriteRemoteEdits: true, initiator: 'user' });
    expect(r).toMatchObject({ ok: true, action: 'updated' });
    expect(frontReqs).toEqual([]);
  });
});

describe('M-1 — "Elle güncelledim" sonrasi musterinin yapistirmasi sonraki guncellemeyi kilitlemez (mark-updated remoteModifiedAt)', () => {
  /** Adim 1-2: musteri wp-admin'de duzenledi (RanksUp yazmadi, kopya isaretlendi), sonra guncel metni yapistirip isaretledi */
  async function pastedAndMarked() {
    posts = posts1(wpPost({ title: 'KDV (müşteri)', content: '<p>Müşterinin eki</p>', modified_gmt: '2026-09-05T08:30:00' }));
    const c = build({ targets: [WP_T], publishedTo: [wpEntry()], status: 'PUBLISHED' });
    expect((await c.svc.publishArticle('a1', [], { overrideQa: true }))[0]).toMatchObject({ skipped: 'live_entry_edited' });
    expect(c.row.publishedTo[0]).toMatchObject({ manualUpdatePending: true, remoteModifiedAt: '2026-09-01T10:00:00.000Z' });
    // Yapistirma WordPress damgasini ilerletir (bu senaryoda iki sunucunun saati ayni)
    Object.assign(posts.get(123)!, { content: '<p>Güncel metin.</p>', modified_gmt: new Date(Date.now() - 30_000).toISOString().slice(0, 19) });
    // Panelde "Elle güncelledim": GERCEK ArticlesService, ayni satir
    const articles = new ArticlesService(c.prisma as any, {} as any, {} as any, {} as any);
    await articles.markPublishedEntryUpdated('s1', 'a1', 't-wp');
    expect(c.row.publishedTo[0]).not.toHaveProperty('manualUpdatePending');
    expect(c.row.publishedTo[0]).not.toHaveProperty('remoteModifiedAt');
    // Yazi yeniden yazildi; RanksUp yeni metni yayinlayacak
    c.row.bodyMd = '# KDV Beyanı Rehberi\n\nYeniden yazılmış metin.';
    reqs = [];
    return c;
  }

  it('isaretlemeden once yapilan yapistirma bilinen degisikliktir: sonraki RanksUp guncellemesi yazilir (live_entry_edited degil)', async () => {
    const c = await pastedAndMarked();
    const [r] = await c.svc.publishArticle('a1', [], { overrideQa: true });
    expect(r).toMatchObject({ ok: true, action: 'updated' });
    expect(posts.get(123)?.content).toContain('Yeniden yazılmış metin.');
    // Yeni yazimin WordPress damgasi kayda gecti: sonraki kiyas yine ayni saatle
    expect(c.row.publishedTo[0].remoteModifiedAt).toBe(`${posts.get(123)!.modified_gmt}.000Z`);
  });

  it('isaretlemeden SONRA WordPress\'te yapilan duzenleme yine korunur (saat payi 2 dk)', async () => {
    const c = await pastedAndMarked();
    Object.assign(posts.get(123)!, { content: '<p>Müşterinin yeni eki</p>', modified_gmt: new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 19) });
    const [r] = await c.svc.publishArticle('a1', [], { overrideQa: true });
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_edited' });
    expect(posts.get(123)?.content).toBe('<p>Müşterinin yeni eki</p>');
  });
});
