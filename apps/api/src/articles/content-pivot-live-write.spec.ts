import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/**
 * S4 — icerik pivotu, canli kopyasina yazilamayan yaziyi HER HAFTA yeniden yazmaz.
 *
 * Uctan uca: GERCEK PublisherService + GERCEK WordPressRestAdapter (@luviai/adapters
 * dist, durum tutan sahte WordPress) + GERCEK ContentPivotService + GERCEK
 * ArticlesService, ayni bellek ici satir uzerinde. Yalniz Prisma ve yan servisler
 * sahte. Inceleme turunun tekrar uretim testlerinden (rv13 wordpress-yayin
 * b-pivot-loop, wy2-pivot-loop weekly-loop) uyarlandi.
 *
 * Eskiden: Tam otomatik pivot yeniden yazimi WordPress'te degismis kopyada
 * live_entry_edited ile atlaniyor, kaydin updatedAt'i (son canli yazim) ilerlemiyor,
 * sonraki Pazartesi yazi yine bekleme suresinin disinda gorunup 5 ajanli LLM
 * yeniden yazimina giriyordu (Yari otomatikte her hafta yeni bir onay e-postasi).
 */

vi.mock('@luviai/shared', async (orig) => ({ ...(await orig() as any), decryptCredentials: (c: any) => c ?? {} }));
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../jobs/job-queue.service.js', () => ({ JobQueueService: class {} }));
vi.mock('./image-generator.service.js', () => ({ ImageGeneratorService: class {} }));
vi.mock('../audit/ai-indexing-pinger.service.js', () => ({ AiIndexingPingerService: class {} }));
vi.mock('../audit/llms-full-builder.service.js', () => ({ LlmsFullBuilderService: class {} }));
vi.mock('./link-validator.service.js', () => ({ LinkValidatorService: class {} }));
vi.mock('../sites/site-url-inventory.service.js', () => ({ SiteUrlInventoryService: class {} }));
vi.mock('./qa-gate.service.js', () => ({ QaGateService: class {} }));
vi.mock('../llm/llm-provider.service.js', () => ({ LLMProviderService: class {} }));
vi.mock('./hero-alt.js', () => ({ describeHeroImage: vi.fn(async () => null) }));

const { Logger } = await import('@nestjs/common');
const { setAdapterFetch } = await import('@luviai/adapters');
const { PublisherService } = await import('./publisher.service.js');
const { ContentPivotService } = await import('./content-pivot.service.js');
const { ArticlesService } = await import('./articles.service.js');
const { articleContentHash } = await import('./republish-policy.js');

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

// Adres IP: yayin hedefi adres denetimi DNS'e gitmez
const IP = '93.184.216.34';
const SITE = `https://${IP}`;
const DAY = 86400000;

// ── Durum tutan sahte WordPress (REST) ──────────────────────────────────
type WpPost = { id: number; slug: string; link: string; title: string; content: string; modified_gmt: string };
let posts: Map<number, WpPost>;
let reqs: Array<{ method: string; path: string }> = [];
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const view = (p: WpPost) => ({ id: p.id, type: 'post', status: 'publish', slug: p.slug, link: p.link, featured_media: 7, modified_gmt: p.modified_gmt, title: { raw: p.title }, content: { raw: p.content } });

setAdapterFetch(async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  const method = (init?.method ?? 'GET').toUpperCase();
  reqs.push({ method, path: u.pathname });
  const single = u.pathname.match(/^\/wp-json\/wp\/v2\/posts\/(\d+)$/);
  const p = single ? posts.get(Number(single[1])) : undefined;
  if (single && !p) return json(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.', data: { status: 404 } });
  if (p && method === 'GET') {
    const fields = u.searchParams.get('_fields');
    const v: Record<string, unknown> = view(p);
    return json(200, fields ? Object.fromEntries(fields.split(',').filter((k) => k in v).map((k) => [k, v[k]])) : v);
  }
  if (p && method === 'POST') {
    const b = JSON.parse(String(init?.body ?? '{}'));
    if (typeof b.content === 'string') p.content = b.content;
    p.modified_gmt = new Date().toISOString().slice(0, 19);
    return json(200, view(p));
  }
  return json(404, { code: 'rest_no_route', message: 'No route' });
});
afterAll(() => setAdapterFetch(null));

// ── Tek satir, uc servis ────────────────────────────────────────────────
const WP_T = { id: 't-wp', type: 'WORDPRESS_REST', credentials: { siteUrl: SITE, username: 'editor', appPassword: 'abcd efgh' }, config: {}, isDefault: true, isActive: true };
const LAST_WRITE = new Date(Date.now() - 60 * DAY);
const LIVE_TEXT = { title: 'KDV Beyanı Rehberi', metaTitle: null, metaDescription: 'KDV özeti', bodyMd: '# KDV Beyanı Rehberi\n\nYayındaki metin.' };
const REWRITE = { ...LIVE_TEXT, bodyMd: '# KDV Beyanı Rehberi\n\nPivotun yeniden yazdığı metin.' };
/** GSC kurali 1 (yuksek gosterim, dusuk CTR) tetiklenir */
const METRICS = { impressions: 900, clicks: 2, position: 8 };

function wpEntry(over: Record<string, unknown> = {}) {
  return {
    targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, action: 'created', externalId: '123', externalUrl: `${SITE}/kdv-beyani-rehberi/`,
    publishedAt: LAST_WRITE.toISOString(), updatedAt: LAST_WRITE.toISOString(), remoteModifiedAt: `${LAST_WRITE.toISOString().slice(0, 19)}.000Z`,
    contentHash: articleContentHash(LIVE_TEXT), ...over,
  };
}

/** Musteri RanksUp'in son yaziminden sonra wp-admin'de duzenledi (ya da taslagi yayina aldi) */
function customerEditedPost(): Map<number, WpPost> {
  return new Map([[123, { id: 123, slug: 'kdv-beyani-rehberi', link: `${SITE}/kdv-beyani-rehberi/`, title: 'KDV (müşteri)', content: '<p>Müşterinin düzenlemesi</p>', modified_gmt: new Date(LAST_WRITE.getTime() + 5 * DAY).toISOString().slice(0, 19) }]]);
}

function world(opts: { text: Record<string, unknown>; status: string; publishedTo: unknown[] }) {
  const row: any = {
    id: 'a1', siteId: 's1', slug: 'kdv-beyani-rehberi', topic: 'KDV beyanı', ...opts.text,
    heroImageUrl: 'https://cdn.example/hero.jpg', category: null, schemaMarkup: null, frontmatter: {}, inlineImages: [],
    status: opts.status, qaStatus: 'PASS', qaReport: null, publishedAt: LAST_WRITE, publishedTo: opts.publishedTo,
    performanceMetrics: METRICS, performanceCheckedAt: null, agentOutputs: { writer: { output: 'taslak' } },
    updatedAt: new Date(Date.now() - DAY),
    site: { id: 's1', url: SITE, name: 'Site', userId: 'u1', publishTargets: [WP_T] },
  };
  let tick = 0;
  const apply = (data: any) => {
    const rest = { ...data };
    delete rest.updatedAt;
    Object.assign(row, rest, { updatedAt: new Date(Date.now() + (tick += 1)) });
  };
  // Prisma gibi: select verilirse YALNIZ secilen alanlar doner. Yayinci engel kaydini
  // agentOutputs'u okumadan yazsaydi diger ajan ciktilarini silerdi; bu bunu yakalar.
  const pick = (select: Record<string, unknown>) => Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
  const prisma: any = {
    article: {
      findUniqueOrThrow: vi.fn(async () => row),
      findUnique: vi.fn(async (a: any) => (a?.select ? pick(a.select) : { ...row })),
      findFirst: vi.fn(async (a: any) => (a?.where?.id === row.id && a?.where?.siteId === row.siteId ? { ...row } : null)),
      findMany: vi.fn(async (a: any) => {
        if (a?.where?.id?.in) return a.where.id.in.includes(row.id) ? [{ id: row.id, agentOutputs: row.agentOutputs }] : [];
        return String(row.status) === String(a?.where?.status) && row.publishedAt <= a.where.publishedAt.lte ? [{ ...row }] : [];
      }),
      update: vi.fn(async (a: any) => { apply(a.data); return {}; }),
      updateMany: vi.fn(async (a: any) => {
        if (a.where?.updatedAt instanceof Date && a.where.updatedAt.getTime() !== row.updatedAt.getTime()) return { count: 0 };
        apply(a.data);
        return { count: 1 };
      }),
    },
    publishTarget: { findMany: vi.fn(async () => [{ id: WP_T.id, type: WP_T.type, isActive: true, isDefault: true, config: {} }]), update: vi.fn(async () => ({})) },
    site: { findUnique: vi.fn(async () => ({ llmsFullTxt: '' })) },
    aiCitationSnapshot: { findMany: vi.fn(async () => []) },
  };
  const llmsFullBuilder = { build: vi.fn(async () => ({ articles: 1, bytes: 10 })), buildShortIndex: vi.fn(async () => '#') };
  const publisher = new PublisherService(
    prisma,
    { generate: vi.fn(async () => ({ ok: false })) } as any,
    { pingUrl: vi.fn(async () => ({})) } as any,
    llmsFullBuilder as any,
    { validateArticleMarkdown: vi.fn(async (_s: string, md: string) => ({ bodyMd: md, report: { remapped: 0, unlinked: 0 } })) } as any,
    { invalidate: vi.fn() } as any,
    { check: vi.fn(async () => ({ status: 'PASS' })) } as any,
    {} as any,
  );
  const pivot = new ContentPivotService(prisma, { enqueue: vi.fn() } as any);
  const articles = new ArticlesService(prisma, { enqueue: vi.fn(async () => ({ dbJobId: 'j' })) } as any, {} as any, {} as any);
  return { row, prisma, publisher, pivot, articles };
}

beforeEach(() => {
  reqs = [];
  posts = customerEditedPost();
});

describe('S4 — Tam otomatik: pivot yeniden yazimi canli kopyaya yazilamadi', () => {
  it('yayin live_entry_edited: musterinin yazisi korunur; yazi PUBLISHED + "elle guncelleme bekliyor" + liveWriteBlocked; sonraki tarama ve worker on denetimi LLM\'i baslatmaz', async () => {
    // Pivot yeniden yazimi editorden gecti (pipeline READY_TO_PUBLISH birakir); worker initiator vermeden yayinlar
    const w = world({ text: REWRITE, status: 'READY_TO_PUBLISH', publishedTo: [wpEntry()] });
    const [r] = await w.publisher.publishArticle('a1', []);
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_edited' });
    expect(posts.get(123)?.content).toBe('<p>Müşterinin düzenlemesi</p>');
    expect(w.row.status).toBe('PUBLISHED');
    // Son canli yazim ani ilerlemedi (dongunun kaynagi) — engel ayrica kaydedildi
    expect(w.row.publishedTo[0]).toMatchObject({ updatedAt: LAST_WRITE.toISOString(), manualUpdatePending: true });
    expect(w.row.agentOutputs).toMatchObject({
      writer: { output: 'taslak' },
      liveWriteBlocked: { at: expect.any(String), reasons: [{ targetId: 't-wp', targetType: 'WORDPRESS_REST', skipped: 'live_entry_edited' }] },
    });

    // Sonraki Pazartesi: kural yine tetikleniyor, ama yeniden yazim baslamaz
    const scan = await w.pivot.scanSite('s1');
    expect(scan.flagged).toEqual([]);
    expect(scan.blocked).toEqual([expect.objectContaining({ articleId: 'a1', block: 'live_copy_pending' })]);
    expect(await w.pivot.automatedRewriteBlock('a1')).toMatchObject({ block: 'live_copy_pending' });
  });

  it('kopya WordPress\'te degismis ama metin ayni (isaret YOK): otomatik yayin yine de engellendi — liveWriteBlocked 30 gun yeniden yazimi durdurur', async () => {
    const w = world({ text: LIVE_TEXT, status: 'PUBLISHED', publishedTo: [wpEntry()] });
    const [r] = await w.publisher.publishArticle('a1', []);
    expect(r).toMatchObject({ skipped: 'live_entry_edited' });
    expect(w.row.publishedTo[0]).not.toHaveProperty('manualUpdatePending');
    const scan = await w.pivot.scanSite('s1');
    expect(scan.flagged).toEqual([]);
    expect(scan.blocked).toEqual([expect.objectContaining({ articleId: 'a1', block: 'recent_live_write_blocked' })]);
    expect(await w.pivot.automatedRewriteBlock('a1')).toMatchObject({ block: 'recent_live_write_blocked' });
  });

  it('"Elle güncelledim": isaret ve engel kalkar, son yazim ani ilerler (pivot bekleme suresini ondan sayar)', async () => {
    const w = world({ text: REWRITE, status: 'READY_TO_PUBLISH', publishedTo: [wpEntry()] });
    await w.publisher.publishArticle('a1', []);
    expect(w.row.agentOutputs).toHaveProperty('liveWriteBlocked');
    await w.articles.markPublishedEntryUpdated('s1', 'a1', 't-wp');
    expect(w.row.publishedTo[0]).not.toHaveProperty('manualUpdatePending');
    expect(w.row.agentOutputs).toEqual({ writer: { output: 'taslak' } });
    // Kopya guncel: tarama onu bekleme suresinde sayar, worker on denetimi engel gormez
    expect(await w.pivot.scanSite('s1')).toEqual({ scanned: 0, flagged: [], blocked: [] });
    expect(await w.pivot.automatedRewriteBlock('a1')).toBeNull();
  });

  it('"Bu kaydi unut": engel kaydi da kalkar', async () => {
    const w = world({ text: LIVE_TEXT, status: 'PUBLISHED', publishedTo: [wpEntry()] });
    await w.publisher.publishArticle('a1', []);
    expect(w.row.agentOutputs).toHaveProperty('liveWriteBlocked');
    await w.articles.forgetPublishedEntry('s1', 'a1', 't-wp');
    expect(w.row.agentOutputs).toEqual({ writer: { output: 'taslak' } });
    expect(w.row.status).toBe('READY_TO_PUBLISH');
  });
});

describe('S4 — Yari otomatik: musteri onayladi, yayin atlandi', () => {
  it('kullanicinin yayini engel kaydi YAZMAZ; kopyanin isareti pivotu durdurur (her hafta yeni onay e-postasi yok)', async () => {
    const w = world({ text: REWRITE, status: 'READY_TO_PUBLISH', publishedTo: [wpEntry()] });
    // Panel tablosu yayindaki yazida bos liste gonderir; PUBLISH_ARTICLE initiator 'user'
    const [r] = await w.publisher.publishArticle('a1', [], { initiator: 'user' });
    expect(r).toMatchObject({ skipped: 'live_entry_edited' });
    expect(w.row.status).toBe('PUBLISHED');
    expect(w.row.agentOutputs).not.toHaveProperty('liveWriteBlocked');
    const scan = await w.pivot.scanSite('s1');
    expect(scan.flagged).toEqual([]);
    expect(scan.blocked).toEqual([expect.objectContaining({ block: 'live_copy_pending' })]);
  });
});

describe('S4 + D3 — silinmis kopya', () => {
  it('Tam otomatik yayin silinmis yaziyi yeniden ACMAZ; son canli kopya oldugu icin yazi READY_TO_PUBLISH olur, pivot onu taramaz', async () => {
    posts = new Map();
    const w = world({ text: REWRITE, status: 'READY_TO_PUBLISH', publishedTo: [wpEntry()] });
    const [r] = await w.publisher.publishArticle('a1', []);
    expect(r).toMatchObject({ skipped: 'live_entry_missing' });
    expect(reqs.filter((x) => x.method === 'POST')).toEqual([]);
    expect(w.row.publishedTo[0]).toMatchObject({ externalId: '123', missingAt: expect.any(String) });
    expect(w.row.status).toBe('READY_TO_PUBLISH');
    expect(await w.pivot.scanSite('s1')).toEqual({ scanned: 0, flagged: [], blocked: [] });
    expect(await w.pivot.automatedRewriteBlock('a1')).toMatchObject({ block: 'not_published' });
  });
});
