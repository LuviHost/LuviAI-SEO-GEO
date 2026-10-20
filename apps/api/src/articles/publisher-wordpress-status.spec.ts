import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/**
 * Yayinci WordPress'in BILDIRDIGI yazi durumunu yayin kaydina yazar (remoteStatus).
 *
 * NEDEN VAR (inceleme turu rv18 F2): canlilik denetimi ve site haritasi "kayitli ?p= adresi
 * herkese acik mi" kararini hedefin BUGUNKU "Yayın durumu" ayarindan veriyordu. Formun
 * varsayilani Taslak; musteri sonradan Yayında'ya alinca WordPress'te taslak kalan eski
 * yazilar iki gun sonra emekliye ayriliyor, "yazinin sayfasindan yeniden yayinla" bildirimi
 * gidiyordu. O yeniden yayin (yerinde guncelleme) durumu degistirmedigi icin yazi taslak
 * kaliyor, dongu her yeniden yayinda tekrarlaniyordu. Karar artik yazim anindaki gercekten:
 * adaptorun publish() / update() sonucundaki status kayda gecer.
 *
 * Uctan uca: GERCEK PublisherService + GERCEK WordPressRestAdapter / WordPressXmlrpcAdapter
 * (@luviai/adapters dist), durum tutan sahte bir WordPress'e karsi (publisher-live-guards.spec.ts
 * ile ayni yaklasim). Sahte WordPress kaynaktaki gibi davranir: REST olusturma istenen durumu
 * kaydeder ve yanitta doner (create_item → prepare_item_for_response "$data['status'] =
 * $post->post_status;"), herkese acik olmayan yaziya ?p= baglantisi verir; yerinde guncelleme
 * yalniz gonderilen alanlari degistirir (durum degismez); XML-RPC metaWeblog.newPost yalniz
 * kimlik doner ve durumu mw_newPost kuralina gore kaydeder; wp.getPost post_status'u verir.
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
vi.mock('../notifications/notifications.service.js', () => ({ NotificationsService: class {} }));

const { setAdapterFetch } = await import('@luviai/adapters');
const { PublisherService } = await import('./publisher.service.js');
const { livenessCheckTarget } = await import('./published-liveness.service.js');
const { unseenWordPressDraftCopy } = await import('./republish-policy.js');

// Adresler IP — yayin hedefi adres denetimi DNS'e gitmez
const IP = '93.184.216.34';
const SITE = `https://${IP}`;

type WpPost = { id: number; type: string; status: string; slug: string; title: string; content: string; excerpt: string; modified_gmt: string };
let posts: Map<number, WpPost>;
let nextId = 700;
let clock = Date.parse('2026-10-18T08:00:00.000Z');
const gmt = () => new Date((clock += 60_000)).toISOString().slice(0, 19);
let reqs: Array<{ method: string; path: string; body: string }> = [];

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const xmlResp = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/xml; charset=UTF-8' } });
const ixrFault = (code: number, msg: string) => xmlResp(`<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><int>${code}</int></value></member><member><name>faultString</name><value><string>${msg}</string></value></member></struct></value></fault></methodResponse>`);
const ixrDate = (g: string) => g.replace(/-/g, '').slice(0, 17);

/** WordPress 5.7+ wp_force_plain_post_permalink: herkese acik olmayan yazi ?p=, yayindaki guzel baglanti */
const linkOf = (p: WpPost) => (p.status === 'publish' ? `${SITE}/${p.slug}/` : `${SITE}/?p=${p.id}`);
const restView = (p: WpPost) => ({ id: p.id, type: p.type, status: p.status, slug: p.slug, link: linkOf(p), featured_media: 0, modified_gmt: p.modified_gmt });

function rest(method: string, path: string, body: string, search: URLSearchParams): Response {
  if (method === 'POST' && path === '/wp-json/wp/v2/posts') {
    const b = JSON.parse(body);
    const id = (nextId += 1);
    // handle_status_param: bilinmeyen durum 'draft' olur
    const status = ['publish', 'draft', 'pending', 'private', 'future'].includes(b.status) ? b.status : 'draft';
    const p: WpPost = { id, type: 'post', status, slug: b.slug, title: b.title, content: b.content, excerpt: b.excerpt ?? '', modified_gmt: gmt() };
    posts.set(id, p);
    return json(201, restView(p));
  }
  const single = path.match(/^\/wp-json\/wp\/v2\/posts\/(\d+)$/);
  const p = single ? posts.get(Number(single[1])) : undefined;
  if (single && !p) return json(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.', data: { status: 404 } });
  if (p && method === 'GET') {
    const view: Record<string, unknown> = restView(p);
    const fields = search.get('_fields');
    return json(200, fields ? Object.fromEntries(fields.split(',').filter((k) => k in view).map((k) => [k, view[k]])) : view);
  }
  if (p && method === 'POST') {
    // Yerinde guncelleme: yalniz gonderilen alanlar (durum gonderilmez, degismez)
    const b = JSON.parse(body);
    if (typeof b.title === 'string') p.title = b.title;
    if (typeof b.content === 'string') p.content = b.content;
    if (typeof b.status === 'string') p.status = b.status;
    p.modified_gmt = gmt();
    return json(200, restView(p));
  }
  return json(404, { code: 'rest_no_route', message: 'No route' });
}

function xmlrpc(body: string): Response {
  const method = body.match(/<methodName>([^<]+)<\/methodName>/)?.[1];
  if (method === 'metaWeblog.newPost') {
    // mw_newPost: "$post_status = $publish ? 'publish' : 'draft';" sonra post_status yalniz
    // draft / pending / private / publish ise kullanilir
    const publish = /<param><value><boolean>1<\/boolean><\/value><\/param>\s*<\/params>/.test(body);
    const asked = body.match(/<name>post_status<\/name><value><string>([^<]*)<\/string>/)?.[1] ?? '';
    const status = ['draft', 'pending', 'private', 'publish'].includes(asked) ? asked : publish ? 'publish' : 'draft';
    const slug = body.match(/<name>wp_slug<\/name><value><string>([^<]*)<\/string>/)?.[1] ?? 'yazi';
    const id = (nextId += 1);
    posts.set(id, { id, type: 'post', status, slug, title: 't', content: 'c', excerpt: '', modified_gmt: gmt() });
    return xmlResp(`<?xml version="1.0"?><methodResponse><params><param><value><string>${id}</string></value></param></params></methodResponse>`);
  }
  const id = Number(body.match(/<param><value><int>(\d+)<\/int><\/value><\/param>\s*<param><value>(?:<array>|<struct>)/)?.[1]);
  const p = posts.get(id);
  if (method === 'wp.getPost') {
    if (!p) return ixrFault(404, 'Invalid post ID.');
    return xmlResp(`<?xml version="1.0"?><methodResponse><params><param><value><struct>
<member><name>post_id</name><value><string>${p.id}</string></value></member>
<member><name>post_status</name><value><string>${p.status}</string></value></member>
<member><name>post_type</name><value><string>${p.type}</string></value></member>
<member><name>post_name</name><value><string>${p.slug}</string></value></member>
<member><name>link</name><value><string>${linkOf(p)}</string></value></member>
<member><name>post_modified_gmt</name><value><dateTime.iso8601>${ixrDate(p.modified_gmt)}</dateTime.iso8601></value></member>
</struct></value></param></params></methodResponse>`);
  }
  if (method === 'wp.editPost') {
    if (!p) return ixrFault(404, 'Invalid post ID.');
    p.modified_gmt = gmt();
    return xmlResp('<?xml version="1.0"?><methodResponse><params><param><value><boolean>1</boolean></value></param></params></methodResponse>');
  }
  return ixrFault(-32601, 'yok');
}

/** Adaptorlerin istekleri sahte WordPress'e gider (uretimde korumali fetch) */
const sahteWordPress = async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? init.body : '';
  reqs.push({ method, path: u.pathname, body });
  return u.pathname === '/xmlrpc.php' ? xmlrpc(body) : rest(method, u.pathname, body, u.searchParams);
};
setAdapterFetch(sahteWordPress);
afterAll(() => setAdapterFetch(null));

const ARTICLE_TEXT = { title: 'KDV Beyanı Rehberi', metaTitle: null, metaDescription: 'KDV özeti', bodyMd: '# KDV Beyanı Rehberi\n\nGüncel metin.' };

function build(opts: { targets: any[]; publishedTo?: unknown; status?: string }) {
  const row: any = {
    id: 'a1', siteId: 's1', slug: 'kdv-beyani-rehberi', ...ARTICLE_TEXT,
    heroImageUrl: null, category: null, schemaMarkup: null, frontmatter: {}, inlineImages: [],
    status: opts.status ?? 'READY_TO_PUBLISH', qaStatus: 'PASS', qaReport: null,
    publishedAt: null, publishedTo: opts.publishedTo ?? [], updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    site: { id: 's1', url: SITE, name: 'Site', userId: 'u1', publishTargets: opts.targets },
  };
  let tick = 0;
  const apply = (data: any) => {
    const rest = { ...data };
    delete rest.updatedAt;
    Object.assign(row, rest, { updatedAt: new Date(Date.parse('2026-10-01T00:00:00.000Z') + (tick += 1) * 1000) });
  };
  const prisma = {
    article: {
      findUniqueOrThrow: vi.fn(async () => row),
      findUnique: vi.fn(async () => ({ ...row })),
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
  const svc = new PublisherService(
    prisma as any,
    { generate: vi.fn(async () => ({ ok: false })) } as any,
    { pingUrl: vi.fn(async () => ({})) } as any,
    { build: vi.fn(async () => ({ articles: 1, bytes: 10 })), buildShortIndex: vi.fn(async () => '# kisa') } as any,
    { validateArticleMarkdown: vi.fn(async (_s: string, md: string) => ({ bodyMd: md, report: { remapped: 0, unlinked: 0 } })) } as any,
    { invalidate: vi.fn() } as any,
    { check: vi.fn(async () => ({ status: 'PASS' })) } as any,
    {} as any,
  );
  return { svc, row };
}

const site = new URL(SITE);

beforeEach(() => {
  posts = new Map();
  reqs = [];
});

describe('yayinci WordPress yazisinin durumunu yazim aninda kayda yazar (remoteStatus)', () => {
  it('REST hedefi Taslak: kayit remoteStatus "draft" ve ?p= alir; hedef sonradan Yayında\'ya alinip yeniden yayinlansa da kayit "draft" kalir (yerinde guncelleme durumu degistirmez)', async () => {
    const target = { id: 't-wp', type: 'WORDPRESS_REST', credentials: { siteUrl: SITE, username: 'editor', appPassword: 'abcd efgh' }, config: { postStatus: 'draft' } as Record<string, unknown>, isDefault: true, isActive: true };
    const c = build({ targets: [target] });
    const [first] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
    expect(first).toMatchObject({ ok: true, action: 'created', remoteStatus: 'draft' });
    const created = c.row.publishedTo[0];
    expect(created).toMatchObject({ targetId: 't-wp', remoteStatus: 'draft', externalUrl: `${SITE}/?p=${created.externalId}` });
    // Canlilik denetimi ve site haritasi: bu ?p= adresi once bir kez canli gorulmeli
    expect(livenessCheckTarget(site, 'kdv-beyani-rehberi', created, target)?.needsSighting).toBe(true);
    expect(unseenWordPressDraftCopy(created, target.type)).toBe(true);

    // Musteri hedefin "Yayın durumu"nu Yayında'ya aldi ve yaziyi yeniden yayinladi
    target.config = { postStatus: 'publish' };
    const [again] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
    expect(again).toMatchObject({ ok: true, action: 'updated', remoteStatus: 'draft' });
    // Durum gonderilmedi; yazi WordPress'te hala taslak
    const post = posts.get(Number(created.externalId))!;
    expect(post.status).toBe('draft');
    expect(reqs.filter((r) => r.method === 'POST' && r.path === `/wp-json/wp/v2/posts/${post.id}`).map((r) => Object.keys(JSON.parse(r.body)).sort()))
      .toEqual([['content', 'excerpt', 'title']]);
    const updated = c.row.publishedTo[0];
    expect(updated).toMatchObject({ remoteStatus: 'draft', externalUrl: `${SITE}/?p=${post.id}` });
    // Hedefin bugunku ayari "Yayında" olsa da karar kayittaki durumdan: emekliye ayrilmaz, ilan edilmez
    expect(livenessCheckTarget(site, 'kdv-beyani-rehberi', updated, target)?.needsSighting).toBe(true);
    expect(unseenWordPressDraftCopy(updated, target.type)).toBe(true);
  });

  it('musteri yaziyi WordPress\'te yayina alinca sonraki yazim "publish" kaydeder; adres dogrudan kanit olur', async () => {
    const target = { id: 't-wp', type: 'WORDPRESS_REST', credentials: { siteUrl: SITE, username: 'editor', appPassword: 'abcd efgh' }, config: { postStatus: 'draft' }, isDefault: true, isActive: true };
    const c = build({ targets: [target] });
    await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
    const id = Number(c.row.publishedTo[0].externalId);
    // WordPress'te yayina alindi (durum degisti, damga ilerledi): kayitli damga eski — RanksUp ustune yazmaz
    // (live_entry_edited); kullanicinin acik onayiyla yazilinca guncel durum kaydedilir
    const p = posts.get(id)!;
    p.status = 'publish';
    p.modified_gmt = gmt();
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, overwriteRemoteEdits: true, initiator: 'user' });
    expect(r).toMatchObject({ ok: true, action: 'updated', remoteStatus: 'publish', externalUrl: `${SITE}/kdv-beyani-rehberi/` });
    const entry = c.row.publishedTo[0];
    expect(entry.remoteStatus).toBe('publish');
    expect(livenessCheckTarget(site, 'kdv-beyani-rehberi', entry, target)?.needsSighting).toBe(false);
    expect(unseenWordPressDraftCopy(entry, target.type)).toBe(false);
  });

  it('REST hedefi Yayında: kayit "publish" ve kalici baglanti alir', async () => {
    const target = { id: 't-wp', type: 'WORDPRESS_REST', credentials: { siteUrl: SITE, username: 'editor', appPassword: 'abcd efgh' }, config: { postStatus: 'publish' }, isDefault: true, isActive: true };
    const c = build({ targets: [target] });
    const [r] = await c.svc.publishArticle('a1', [], { overrideQa: true });
    expect(r).toMatchObject({ ok: true, action: 'created', remoteStatus: 'publish', externalUrl: `${SITE}/kdv-beyani-rehberi/` });
    expect(c.row.publishedTo[0].remoteStatus).toBe('publish');
  });

  it('XML-RPC: metaWeblog.newPost yalniz kimlik doner; durum wp.getPost ile okunup kayda yazilir (istenen degil, WordPress\'in kaydettigi)', async () => {
    // Hedef ayari WordPress'in tanimadigi bir durum: mw_newPost publish bayragina (0) duser → 'draft'
    const target = { id: 't-wpx', type: 'WORDPRESS_XMLRPC', credentials: { siteUrl: SITE, username: 'editor', password: 'gizli' }, config: { postStatus: 'future' }, isDefault: true, isActive: true };
    const c = build({ targets: [target] });
    const [r] = await c.svc.publishArticle('a1', [], { overrideQa: true });
    expect(r).toMatchObject({ ok: true, action: 'created', remoteStatus: 'draft' });
    const entry = c.row.publishedTo[0];
    expect(entry).toMatchObject({ targetType: 'WORDPRESS_XMLRPC', remoteStatus: 'draft', externalUrl: `${SITE}/?p=${entry.externalId}` });
    expect(reqs.map((x) => x.body.match(/<methodName>([^<]+)</)?.[1])).toEqual(['metaWeblog.newPost', 'wp.getPost']);

    // Yayin modunda olusan yazi: 'publish' okunur, ?p= adresi dogrudan kanit
    const yayin = { ...target, id: 't-wpx2', config: { postStatus: 'publish' } };
    const c2 = build({ targets: [yayin] });
    await c2.svc.publishArticle('a1', [], { overrideQa: true });
    expect(c2.row.publishedTo[0].remoteStatus).toBe('publish');
    expect(livenessCheckTarget(site, 'kdv-beyani-rehberi', c2.row.publishedTo[0], yayin)?.needsSighting).toBe(false);
  });

  it('WordPress durumu bildirmezse alan hic yazilmaz (tahmin edilmez): durumu bilinmeyen ?p= kopyasi once canli gorulmeli', async () => {
    const target = { id: 't-wpx', type: 'WORDPRESS_XMLRPC', credentials: { siteUrl: SITE, username: 'editor', password: 'gizli' }, config: { postStatus: 'publish' }, isDefault: true, isActive: true };
    const c = build({ targets: [target] });
    // wp.getPost engelli (guvenlik eklentisi): durum okunamaz
    setAdapterFetch(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      return /<methodName>wp\.getPost</.test(body) ? ixrFault(405, 'XML-RPC services are disabled on this site.') : sahteWordPress(url, init);
    });
    try {
      const [r] = await c.svc.publishArticle('a1', [], { overrideQa: true });
      expect(r.ok).toBe(true);
      expect(r).not.toHaveProperty('remoteStatus');
      const entry = c.row.publishedTo[0];
      expect(entry).not.toHaveProperty('remoteStatus');
      expect(livenessCheckTarget(site, 'kdv-beyani-rehberi', entry, target)?.needsSighting).toBe(true);
    } finally {
      setAdapterFetch(sahteWordPress);
    }
  });
});
