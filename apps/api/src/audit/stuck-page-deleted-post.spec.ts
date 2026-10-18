import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/**
 * Takili sayfa yeniden yayini SILINMIS WordPress yazisini yeniden ACMAZ (uctan uca).
 *
 * GERCEK StuckPageRecoveryService (recover + ikinci asama republish) + GERCEK
 * PublisherService + GERCEK WordPressRestAdapter (@luviai/adapters dist), durum
 * tutan sahte bir WordPress'e karsi. Yalniz Prisma (bellekte satirlar), yapay
 * zeka cevabi ve yan servisler sahte.
 *
 * Yayin fonksiyonu worker'in vermesi gereken bicimdedir: ucuncu arguman
 * (yayinci secenekleri, STUCK_REPUBLISH_PUBLISH_OPTIONS) publishArticle'a AYNEN
 * gecer. Eskiden yayinci 404'te yaziyi yeniden aciyordu ('recreated'); takili
 * sayfa akisi bunu FAILED sayiyordu ama musterinin sildigi yazi sitede yeniden
 * olusuyordu.
 */

vi.mock('@luviai/shared', async (orig) => ({ ...(await orig() as any), decryptCredentials: (c: any) => c ?? {} }));
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../articles/image-generator.service.js', () => ({ ImageGeneratorService: class {} }));
vi.mock('./ai-indexing-pinger.service.js', () => ({ AiIndexingPingerService: class {} }));
vi.mock('./llms-full-builder.service.js', () => ({ LlmsFullBuilderService: class {} }));
vi.mock('../articles/link-validator.service.js', () => ({ LinkValidatorService: class {} }));
vi.mock('../sites/site-url-inventory.service.js', () => ({ SiteUrlInventoryService: class {} }));
vi.mock('../articles/qa-gate.service.js', () => ({ QaGateService: class {} }));
vi.mock('../llm/llm-provider.service.js', () => ({ LLMProviderService: class {} }));
vi.mock('../articles/hero-alt.js', () => ({ describeHeroImage: vi.fn(async () => null) }));

const { Logger } = await import('@nestjs/common');
const { Prisma } = await import('@prisma/client');
const { setAdapterFetch } = await import('@luviai/adapters');
const { PublisherService } = await import('../articles/publisher.service.js');
const { articleContentHash } = await import('../articles/republish-policy.js');
const { StuckPageRecoveryService } = await import('./stuck-page-recovery.service.js');
const { planStuckRepublish } = await import('./stuck-page-autopilot.js');

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

// Adres IP: yayin hedefi adres denetimi DNS'e gitmez
const SITE = 'https://93.184.216.34';
const STUCK_URL = `${SITE}/yazi/`;
const DAY = 24 * 60 * 60 * 1000;
const BODY = '# Yazı\n\nEski cümle burada.\n\nİkinci paragraf.';
const PROPOSAL = {
  diagnosis: 'Kavram eksik',
  edits: [{ type: 'sentence_replace', before: 'Eski cümle burada.', after: 'KDV beyanı ile güncellenmiş cümle.', reason: 'KDV', entityAdded: 'KDV beyanı' }],
  entitiesAdded: ['KDV beyanı'], paragraphAdded: null, entityScoreEstimate: 74,
};
/** RanksUp'in son yazimi: kayittaki hedef damgasi ile WordPress'teki modified_gmt ayni (o zamandan beri dokunulmadi) */
const LAST_WRITE_GMT = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 19);
const WP_TARGET = { id: 't-wp', type: 'WORDPRESS_REST', credentials: { siteUrl: SITE, username: 'editor', appPassword: 'abcd efgh' }, config: {}, isDefault: true, isActive: true };

// -- Durum tutan sahte WordPress (REST) --
type WpPost = { id: number; slug: string; link: string; title: string; content: string; modified_gmt: string };
let posts: Map<number, WpPost>;
let nextId = 500;
let reqs: Array<{ method: string; path: string }> = [];
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const view = (p: WpPost) => ({ id: p.id, type: 'post', status: 'publish', slug: p.slug, link: p.link, featured_media: 7, modified_gmt: p.modified_gmt, title: { raw: p.title }, content: { raw: p.content } });

setAdapterFetch(async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  const method = (init?.method ?? 'GET').toUpperCase();
  reqs.push({ method, path: u.pathname });
  const single = u.pathname.match(/^\/wp-json\/wp\/v2\/posts\/(\d+)$/);
  if (single) {
    const p = posts.get(Number(single[1]));
    if (!p) return json(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.', data: { status: 404 } });
    if (method === 'POST') {
      const b = JSON.parse(String(init?.body ?? '{}'));
      if (typeof b.content === 'string') p.content = b.content;
      p.modified_gmt = new Date().toISOString().slice(0, 19);
    }
    return json(200, view(p));
  }
  if (method === 'POST' && u.pathname === '/wp-json/wp/v2/posts') {
    const b = JSON.parse(String(init?.body ?? '{}'));
    const id = (nextId += 1);
    const p: WpPost = { id, slug: b.slug, link: `${SITE}/${b.slug}/`, title: b.title, content: b.content, modified_gmt: new Date().toISOString().slice(0, 19) };
    posts.set(id, p);
    return json(201, view(p));
  }
  return json(404, { code: 'rest_no_route', message: 'No route' });
});
afterAll(() => setAdapterFetch(null));

// -- Bellekte satirlar + gercek servisler --
function build() {
  const liveEntry = {
    targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, action: 'created', externalId: '41', externalUrl: STUCK_URL,
    publishedAt: new Date(Date.now() - 90 * DAY).toISOString(), updatedAt: new Date(Date.now() - 60 * DAY).toISOString(),
    remoteModifiedAt: `${LAST_WRITE_GMT}.000Z`,
    contentHash: articleContentHash({ title: 'Yazı', metaTitle: null, metaDescription: 'Özet', bodyMd: BODY }),
  };
  const db = {
    stuckPage: { id: 'sp1', siteId: 's1', articleId: 'a1', url: STUCK_URL, title: 'Yazı', position: 7, impressions: 400, ctr: 0.01, topQueries: ['kdv beyanı'], status: 'DETECTED' } as Record<string, any>,
    article: {
      id: 'a1', siteId: 's1', status: 'PUBLISHED', slug: 'yazi', title: 'Yazı', metaTitle: null, metaDescription: 'Özet', bodyMd: BODY, bodyHtml: '<p>eski</p>',
      qaStatus: 'PASS', qaReport: null, heroImageUrl: 'https://cdn.example/hero.jpg', category: null, schemaMarkup: null, frontmatter: {}, inlineImages: [],
      publishedAt: new Date(Date.now() - 90 * DAY), publishedTo: [liveEntry] as unknown, updatedAt: new Date(Date.now() - DAY),
    } as Record<string, any>,
    recoveries: [] as Array<Record<string, any>>,
  };
  const site = { id: 's1', url: SITE, name: 'Site', userId: 'u1', publishTargets: [WP_TARGET] };
  let seq = 0;
  const pick = (row: Record<string, any>, select?: Record<string, unknown>) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : { ...row });
  const applyArticle = (data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) db.article[k] = v === Prisma.DbNull ? null : v;
  };
  const statusOk = (want: any) => want === undefined || (typeof want === 'string' ? db.stuckPage.status === want : (want.in ?? []).includes(db.stuckPage.status));
  const prisma: any = {
    stuckPage: {
      findUnique: vi.fn(async ({ select }: any = {}) => pick(db.stuckPage, select)),
      update: vi.fn(async ({ data }: any) => { Object.assign(db.stuckPage, data); return { ...db.stuckPage }; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== db.stuckPage.id || !statusOk(where.status)) return { count: 0 };
        Object.assign(db.stuckPage, data);
        return { count: 1 };
      }),
    },
    site: {
      findUnique: vi.fn(async ({ select }: any) => (select?.publishApprovalMode
        ? { autopilot: true, publishApprovalMode: 'auto_publish', user: { plan: 'PRO' } }
        : select?.llmsFullTxt ? { llmsFullTxt: '' } : { name: 'Site', userId: 'u1' })),
    },
    article: {
      findUnique: vi.fn(async ({ select }: any) => pick(db.article, select)),
      findUniqueOrThrow: vi.fn(async () => ({ ...db.article, site })),
      update: vi.fn(async ({ data }: any) => { applyArticle(data); return { ...db.article }; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== db.article.id) return { count: 0 };
        if (where.bodyMd !== undefined && db.article.bodyMd !== where.bodyMd) return { count: 0 };
        if (where.status !== undefined && db.article.status !== where.status) return { count: 0 };
        if (where.updatedAt instanceof Date && where.updatedAt.getTime() !== db.article.updatedAt.getTime()) return { count: 0 };
        applyArticle({ ...data, updatedAt: data.updatedAt ?? new Date() });
        return { count: 1 };
      }),
    },
    publishTarget: { findMany: vi.fn(async () => [{ ...WP_TARGET }]), update: vi.fn(async () => ({})) },
    stuckPageRecovery: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `r${++seq}`, appliedAt: new Date(Date.now() + seq), revertedAt: null, revertedBy: null, ...data };
        db.recoveries.push(row);
        return { ...row };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const r = db.recoveries.find((x) => x.id === where.id);
        return r ? { ...r, stuckPage: { ...db.stuckPage } } : null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const rows = db.recoveries.filter((x) => x.stuckPageId === where.stuckPageId).sort((a, b) => b.appliedAt - a.appliedAt);
        return rows[0] ? { id: rows[0].id } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(db.recoveries.find((x) => x.id === where.id)!, data)),
      delete: vi.fn(async ({ where }: any) => { db.recoveries = db.recoveries.filter((x) => x.id !== where.id); return {}; }),
    },
  };
  const webhook = { notify: vi.fn(async () => undefined) };
  const jobs = { enqueue: vi.fn<(o: any) => Promise<unknown>>(async () => ({ dbJobId: 'j' })) };
  const recovery = new StuckPageRecoveryService(prisma, webhook as any, jobs as any, { runAudit: vi.fn(async () => ({ score: 55 })) } as any);
  (recovery as any).anthropic = { messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(PROPOSAL) }] })) } };
  const publisher = new PublisherService(
    prisma,
    { generate: vi.fn(async () => ({ ok: false })) } as any,
    { pingUrl: vi.fn(async () => ({})) } as any,
    { build: vi.fn(async () => ({ articles: 1, bytes: 10 })), buildShortIndex: vi.fn(async () => '#') } as any,
    { validateArticleMarkdown: vi.fn(async (_s: string, md: string) => ({ bodyMd: md, report: { remapped: 0, unlinked: 0 } })) } as any,
    { invalidate: vi.fn() } as any,
    { check: vi.fn(async () => ({ status: 'PASS' })) } as any,
    {} as any,
  );
  const phase2 = () => {
    const calls = jobs.enqueue.mock.calls.map((c) => c[0]).filter((j) => j.type === 'STUCK_PAGE_RECOVER');
    return calls[calls.length - 1]?.payload;
  };
  return { db, recovery, publisher, webhook, jobs, phase2, liveEntry };
}

beforeEach(() => {
  reqs = [];
  nextId = 500;
  posts = new Map([[41, { id: 41, slug: 'yazi', link: STUCK_URL, title: 'Yazı', content: '<p>Eski cümle burada.</p>', modified_gmt: LAST_WRITE_GMT }]]);
});

describe('takili sayfa yeniden yayini — musterinin sildigi yazi yeniden acilmaz', () => {
  it('yazi WordPress\'te kalici silinmis: kopya ACILMAZ; sayfa FAILED, neden sonuca gider, metin geri alinir, kayit silinir', async () => {
    const c = build();
    // Takili adresteki yaziyi musteri sonradan WordPress'ten tamamen sildi (REST 404)
    posts.delete(41);
    expect(await c.recovery.recover('sp1', { triggeredBy: 'autopilot' })).toMatchObject({ success: true, needsRepublish: true });
    expect(c.db.article.bodyMd).toContain('KDV beyanı ile güncellenmiş cümle.');

    // Worker'in vermesi gereken yayin fonksiyonu: secenekler publishArticle'a aynen
    const publish = vi.fn((articleId: string, targetIds: string[], opts?: { recreateMissing?: boolean; initiator?: 'user' | 'automation' }) => c.publisher.publishArticle(articleId, targetIds, opts));
    const res = await c.recovery.republish(c.phase2(), publish, { finalAttempt: false });

    expect(publish).toHaveBeenCalledWith('a1', ['t-wp'], { recreateMissing: false, initiator: 'automation' });
    // WordPress'te yalniz okuma: yeni yazi (POST /posts) yok, sitede yazi yok
    expect(reqs.filter((r) => r.method === 'POST')).toEqual([]);
    expect(posts.size).toBe(0);
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(res.reason).toContain('artık bulunamadı');
    expect(res.reason).toContain('yeniden oluşturulmadı');
    expect(c.db.stuckPage.status).toBe('FAILED');
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.db.recoveries).toHaveLength(0);
    expect(c.webhook.notify).not.toHaveBeenCalled();
    // Yayin kaydi: yeni kimlik / adres yazilmadi; yayinci kopyanin hedefte olmadigini
    // kaydeder (missingAt, paylasilan sozlesme D3) — kopya artik canli sayilmaz
    const entries = c.db.article.publishedTo as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    const { missingAt, ...rest } = entries[0];
    expect(rest).toEqual(c.liveEntry);
    expect(typeof missingAt).toBe('string');
    // Takili sayfa plani silinmis kopyaya bir daha yazmayi denemez
    expect(planStuckRepublish({ publishedTo: entries, targets: [WP_TARGET], slug: 'yazi', url: STUCK_URL }))
      .toEqual({ kind: 'proposal', block: 'live_copy_missing', labels: ['WordPress'] });
  });

  it('kontrol: yazi duruyorsa ayni akis yaziyi yerinde gunceller ve sayfa "Düzeltildi" olur', async () => {
    const c = build();
    await c.recovery.recover('sp1', { triggeredBy: 'autopilot' });
    const publish = (articleId: string, targetIds: string[], opts?: { recreateMissing?: boolean; initiator?: 'user' | 'automation' }) => c.publisher.publishArticle(articleId, targetIds, opts);
    const res = await c.recovery.republish(c.phase2(), publish, { finalAttempt: false });
    expect(res).toEqual({ ok: true, status: 'RECOVERED' });
    expect(posts.get(41)?.content).toContain('KDV beyanı ile güncellenmiş cümle.');
    expect(posts.size).toBe(1);
  });
});
