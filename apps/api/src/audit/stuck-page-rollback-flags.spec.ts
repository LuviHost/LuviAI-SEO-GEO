import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/**
 * Takili sayfa ikinci asamasi GERI ALINDIGINDA yayincinin atilan (yapay zekanin
 * duzenledigi) metne gore koydugu isaretler kalmaz (S2 / S6 / S12 / S16).
 *
 * NEDEN VAR: WordPress'te degismis kopyaya ikinci asama yazamayinca yayinci
 * kopyayi "elle guncelleme bekliyor" (manualUpdatePending) isaretliyordu — o
 * anki kayit metni duzenlenmis metindi. Sonra metin onceki haline donunce
 * kopyanin izi kayittaki metinle yine ayniydi ama isaret kaliyordu: panel
 * "Eski sürüm yayında" diyor, "Güncel metni kopyala" musterinin WordPress
 * duzenlemelerini silecek metni veriyor, "Elle güncelledim" de duzenleme
 * korumasini (remoteModifiedAt) kaldiriyordu; sonraki otomatik duzeltme
 * musterinin metnini sessizce eziyordu. Isaret silinip yerine hicbir sey
 * konmasaydi da otopilot her hafta ayni yapay zeka turunu kosup ayni oneriyi
 * uretirdi: kopya artik ayri bir isaretle (remoteEditSkip) "sitede degismis"
 * diye kaydedilir ve plan ona bir daha otomatik duzeltme denemez.
 *
 * GERCEK StuckPageRecoveryService + GERCEK PublisherService + GERCEK
 * WordPressRestAdapter (@luviai/adapters dist) + GERCEK ArticlesService ("Elle
 * güncelledim"), durum tutan sahte WordPress'e karsi; Prisma bellekte, yapay
 * zeka cevabi sahte. Dogrulama sahnesi: scratchpad rv13/e2e/c2-stale-flag,
 * rv13/c2verify, rv13/wy4-verify, rv13/butunlesme/stale-flag (gozden gecirme 13).
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
const { ArticlesService } = await import('../articles/articles.service.js');
const { articleContentHash } = await import('../articles/republish-policy.js');
const { rowTextIsLive } = await import('../articles/live-rewrite.js');
const { StuckPageRecoveryService } = await import('./stuck-page-recovery.service.js');
const { planStuckRepublish, rollbackStuckEntryFlags, runStuckPageSweep } = await import('./stuck-page-autopilot.js');

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

// Adres IP: yayin hedefi adres denetimi DNS'e gitmez
const SITE = 'https://93.184.216.34';
const STUCK_URL = `${SITE}/yazi/`;
const DAY = 24 * 60 * 60 * 1000;
const BODY = '# Yazı\n\nEski cümle burada.\n\nİkinci paragraf.';
const EDITED = BODY.replace('Eski cümle burada.', 'KDV beyanı ile güncellenmiş cümle.');
const PROPOSAL = {
  diagnosis: 'Kavram eksik',
  edits: [{ type: 'sentence_replace', before: 'Eski cümle burada.', after: 'KDV beyanı ile güncellenmiş cümle.', reason: 'KDV', entityAdded: 'KDV beyanı' }],
  entitiesAdded: ['KDV beyanı'], paragraphAdded: null, entityScoreEstimate: 74,
};
/** RanksUp'in son yazimi: kayittaki hedef damgasi */
const LAST_WRITE_GMT = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 19);
/** Musteri 10 gun once wp-admin'de duzenledi */
const CUSTOMER_EDIT_GMT = new Date(Date.now() - 10 * DAY).toISOString().slice(0, 19);
const CUSTOMER_CTA = '<p>Müşterinin eklediği CTA.</p>';
const WP_TARGET = { id: 't-wp', type: 'WORDPRESS_REST', credentials: { siteUrl: SITE, username: 'editor', appPassword: 'abcd efgh' }, config: {}, isDefault: true, isActive: true };

// -- Durum tutan sahte WordPress (REST) --
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
  if (single) {
    const p = posts.get(Number(single[1]));
    if (!p) return json(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.', data: { status: 404 } });
    if (method === 'POST') {
      const b = JSON.parse(String(init?.body ?? '{}'));
      if (typeof b.content === 'string') p.content = b.content;
      if (typeof b.title === 'string') p.title = b.title;
      p.modified_gmt = new Date().toISOString().slice(0, 19);
    }
    return json(200, view(p));
  }
  return json(404, { code: 'rest_no_route', message: 'No route' });
});
afterAll(() => setAdapterFetch(null));

const posts41 = () => posts.get(41)!;
/** Musteri wp-admin'de yaziyi duzenler (WordPress modified_gmt'yi ilerletir) */
function customerEdits(): void {
  const p = posts41();
  p.content = `${p.content}${CUSTOMER_CTA}`;
  p.title = 'Müşterinin başlığı';
  p.modified_gmt = CUSTOMER_EDIT_GMT;
}

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
      agentOutputs: {}, publishedAt: new Date(Date.now() - 90 * DAY), publishedTo: [liveEntry] as unknown, updatedAt: new Date(Date.now() - DAY),
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
      findFirst: vi.fn(async () => ({ ...db.article, site: { userId: 'u1' } })),
      findUniqueOrThrow: vi.fn(async () => ({ ...db.article, site })),
      update: vi.fn(async ({ data }: any) => { applyArticle(data); return { ...db.article }; }),
      // Kosullu yazim: govde / durum / updatedAt (iyimser kilit) kosullari uygulanir
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
        if (where.id) {
          const r = db.recoveries.find((x) => x.id === where.id && db.stuckPage.siteId === where.stuckPage?.siteId);
          return r ? { ...r, stuckPage: { ...db.stuckPage } } : null;
        }
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
  const llm = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(PROPOSAL) }] }));
  (recovery as any).anthropic = { messages: { create: llm } };
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
  // "Elle güncelledim" (POST .../published/:targetId/mark-updated) gercek servisle
  const articles = new ArticlesService(prisma, { enqueue: vi.fn(async () => ({})) } as any, {} as any, {} as any);
  const phase2 = () => {
    const calls = jobs.enqueue.mock.calls.map((c) => c[0]).filter((j) => j.type === 'STUCK_PAGE_RECOVER');
    return calls[calls.length - 1]?.payload;
  };
  // Worker'in verdigi yayin fonksiyonu: secenekler publishArticle'a AYNEN gecer
  const publish = (articleId: string, targetIds: string[], opts?: { recreateMissing?: boolean; initiator?: 'user' | 'automation' }) => publisher.publishArticle(articleId, targetIds, opts);
  const entry = () => (db.article.publishedTo as Array<Record<string, any>>)[0];
  return { db, recovery, publisher, articles, webhook, jobs, llm, phase2, publish, entry, liveEntry, prisma };
}

type Ctx = ReturnType<typeof build>;

/** Panelin okudugu "eski surum yayinda" isareti ve alanlari bu yayindan once nasilsa oyle */
function expectNoStaleFlag(c: Ctx, remoteModifiedAt: string): void {
  const e = c.entry();
  expect(e).not.toHaveProperty('manualUpdatePending');
  expect(e).not.toHaveProperty('manualUpdatePendingSince');
  expect(e.remoteModifiedAt).toBe(remoteModifiedAt);
  // RanksUp'in kayittaki metni kopyaya en son yazdigi metin: yapistirilacak yeni bir sey yok
  expect(e.contentHash).toBe(articleContentHash(c.db.article));
  expect(rowTextIsLive(c.db.article as any)).toBe(true);
}

beforeEach(() => {
  reqs = [];
  posts = new Map([[41, { id: 41, slug: 'yazi', link: STUCK_URL, title: 'Yazı', content: '<p>Eski cümle burada.</p>', modified_gmt: LAST_WRITE_GMT }]]);
});

describe('S2/S6/S12/S16 — geri alinan ikinci asama yayincinin isaretlerini birakmaz', () => {
  it('recover + live_entry_edited: musterinin duzenlemesi korunur, metin geri, "eski surum yayinda" isareti YOK; kopya "sitede degismis" diye kaydedilir', async () => {
    const c = build();
    customerEdits();
    expect(await c.recovery.recover('sp1', { triggeredBy: 'autopilot' })).toMatchObject({ success: true, needsRepublish: true });
    const res = await c.recovery.republish(c.phase2(), c.publish, { finalAttempt: false });

    // WordPress'e yazilmadi; musterinin CTA'si duruyor
    expect(reqs.filter((r) => r.method === 'POST')).toEqual([]);
    expect(posts41().content).toContain(CUSTOMER_CTA);
    expect(res).toMatchObject({ ok: false, manual: true, status: 'DETECTED' });
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.db.stuckPage.status).toBe('DETECTED');
    expectNoStaleFlag(c, c.liveEntry.remoteModifiedAt);
    expect(c.entry()).toMatchObject({ remoteEditSkip: 'live_entry_edited' });
    expect(typeof c.entry().remoteEditSeenAt).toBe('string');
    // Plan bu kopyaya bir daha otomatik duzeltme denemez (haftalik yapay zeka dongusu yok)
    expect(planStuckRepublish({ publishedTo: c.db.article.publishedTo, targets: [WP_TARGET], slug: 'yazi', url: STUCK_URL }))
      .toEqual({ kind: 'proposal', block: 'live_copy_edited', labels: ['WordPress'] });
  });

  it('sonrasi: otopilot yapay zeka cagirmaz; "Elle güncelledim" koruma kaldirmaz; "AI Düzelt" ve kullanicinin yayini musterinin metnini ezmez', async () => {
    const c = build();
    customerEdits();
    await c.recovery.recover('sp1', { triggeredBy: 'autopilot' });
    await c.recovery.republish(c.phase2(), c.publish, { finalAttempt: false });
    expect(c.llm).toHaveBeenCalledTimes(1);

    // Haftalik tarama sayfayi kuyruga almaz; otopilot isi gelse de yapay zeka cagrilmaz
    const sweepJobs: any[] = [];
    const later = new Date(Date.now() + 40 * DAY);
    const summary = await runStuckPageSweep({
      prisma: {
        site: { findMany: async () => [{ id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'auto_publish', user: { plan: 'PRO' } }] },
        stuckPage: { findMany: async () => [{ id: 'sp1', url: STUCK_URL, article: { ...c.db.article } }], findFirst: async () => null },
        publishTarget: { findMany: async () => [{ id: 't-wp', type: 'WORDPRESS_REST', isActive: true }] },
      },
      detector: { detect: async () => ({ found: 1 }) },
      jobs: { enqueue: async (o: any) => { sweepJobs.push(o); return {}; } },
      now: () => later,
    });
    expect(summary).toMatchObject({ autoRecoveryQueued: 0, notUpdatablePages: 1 });
    expect(sweepJobs).toEqual([]);
    const again = await c.recovery.recover('sp1', { triggeredBy: 'autopilot' });
    expect(again).toMatchObject({ success: false, skipped: true });
    expect(again.reason).toContain('sitende değiştirilmiş; RanksUp sitedeki değişikliklerin üzerine kendiliğinden yazmaz');
    expect(c.llm).toHaveBeenCalledTimes(1);

    // "Elle güncelledim": isaret yok — hicbir sey degismez, duzenleme korumasi (remoteModifiedAt) kalir
    const before = JSON.stringify(c.db.article.publishedTo);
    await c.articles.markPublishedEntryUpdated('s1', 'a1', 't-wp');
    expect(JSON.stringify(c.db.article.publishedTo)).toBe(before);
    expect(c.entry().remoteModifiedAt).toBe(c.liveEntry.remoteModifiedAt);

    // "AI Düzelt": oneri kaydedilir, yayin yok
    const manual = await c.recovery.recover('sp1', { triggeredBy: 'user-7' });
    expect(manual).toMatchObject({ success: false, manual: true });
    expect(reqs.filter((r) => r.method === 'POST')).toEqual([]);

    // Kullanicinin yayini (onaysiz) da musterinin duzenlemesini ezmez; kopya yine "sitede degismis"
    const results = await c.publisher.publishArticle('a1', ['t-wp'], { initiator: 'user' });
    expect(results).toMatchObject([{ targetId: 't-wp', ok: false, skipped: 'live_entry_edited' }]);
    expect(posts41().content).toContain(CUSTOMER_CTA);
    expect(posts41().title).toBe('Müşterinin başlığı');
    expect(c.entry()).toMatchObject({ remoteEditSkip: 'live_entry_edited' });
    expect(c.entry()).not.toHaveProperty('manualUpdatePending');
  });

  it('izsiz eski kayit (contentHash yok — bugunku canli surumun yazdigi kayitlar): yayinci isaret koymasa da kopya "sitede degismis" kaydedilir; otopilot haftalik dongu kurmaz', async () => {
    const c = build();
    const legacy = { ...c.liveEntry } as Record<string, unknown>;
    delete legacy.contentHash;
    delete legacy.remoteModifiedAt;
    c.db.article.publishedTo = [legacy];
    customerEdits();
    await c.recovery.recover('sp1', { triggeredBy: 'autopilot' });
    expect(await c.recovery.republish(c.phase2(), c.publish, { finalAttempt: false })).toMatchObject({ manual: true, status: 'DETECTED' });
    expect(posts41().content).toContain(CUSTOMER_CTA);
    expect(c.entry()).not.toHaveProperty('manualUpdatePending');
    expect(c.entry()).toMatchObject({ remoteEditSkip: 'live_entry_edited' });
    // Sonraki otopilot isi yapay zeka cagirmaz
    expect(await c.recovery.recover('sp1', { triggeredBy: 'autopilot' })).toMatchObject({ success: false, skipped: true });
    expect(c.llm).toHaveBeenCalledTimes(1);
  });

  it('acik onayla uzerine yazma (kullanici "Üzerine yaz") kopyayi gunceller; "sitede degismis" kaydi kendiliginden kalkar', async () => {
    const c = build();
    customerEdits();
    await c.recovery.recover('sp1', { triggeredBy: 'user-7' });
    await c.recovery.republish(c.phase2(), c.publish, { finalAttempt: false });
    expect(c.entry()).toMatchObject({ remoteEditSkip: 'live_entry_edited' });
    const results = await c.publisher.publishArticle('a1', ['t-wp'], { initiator: 'user', overwriteRemoteEdits: true });
    expect(results).toMatchObject([{ targetId: 't-wp', ok: true, action: 'updated' }]);
    // Basarili yazim kaydi taze kayitla degistirir: isaret yok, plan yeniden "yerinde guncelle"
    expect(c.entry()).not.toHaveProperty('remoteEditSkip');
    expect(c.entry()).not.toHaveProperty('remoteEditSeenAt');
    expect(planStuckRepublish({ publishedTo: c.db.article.publishedTo, targets: [WP_TARGET], slug: 'yazi', url: STUCK_URL }).kind).toBe('republish');
  });

  it('geri alma + live_entry_edited: geri alma yayinlanmaz, duzeltme yerinde kalir; isaret yok, kopya "sitede degismis"', async () => {
    const c = build();
    // Duzeltme canliya gitti (yazi o sirada degismemisti)
    await c.recovery.recover('sp1', { triggeredBy: 'user-7' });
    expect(await c.recovery.republish(c.phase2(), c.publish, { finalAttempt: false })).toEqual({ ok: true, status: 'RECOVERED' });
    expect(posts41().content).toContain('KDV beyanı ile güncellenmiş cümle.');
    const fixedStamp = c.entry().remoteModifiedAt as string;
    expect(c.entry().contentHash).toBe(articleContentHash({ ...c.db.article, bodyMd: EDITED }));
    // Musteri sonra WordPress'te duzenledi ve "Geri Al"a basti
    posts41().content = `${posts41().content}${CUSTOMER_CTA}`;
    posts41().modified_gmt = new Date(Date.now() + 60_000).toISOString().slice(0, 19);
    await c.recovery.revert('s1', c.db.recoveries[0].id, 'u9');
    reqs = [];
    const res = await c.recovery.republish(c.phase2(), c.publish, { finalAttempt: false });

    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(res.reason).toContain('Geri alma uygulanmadı');
    expect(reqs.filter((r) => r.method === 'POST')).toEqual([]);
    expect(posts41().content).toContain(CUSTOMER_CTA);
    expect(c.db.stuckPage.status).toBe('RECOVERED');
    expect(c.db.article.bodyMd).toBe(EDITED);
    expectNoStaleFlag(c, fixedStamp);
    expect(c.entry()).toMatchObject({ remoteEditSkip: 'live_entry_edited' });
  });

  it('live_entry_mismatch (kayitli kimlik baska yaziyi gosteriyor): oneri; isaret yok, kopya "kimlik tutmuyor" diye kaydedilir', async () => {
    const c = build();
    // Site tasindi: 41 numara artik baska bir yazi
    Object.assign(posts41(), { slug: 'baska-yazi', link: `${SITE}/baska-yazi/`, content: '<p>Başka yazı.</p>' });
    await c.recovery.recover('sp1', { triggeredBy: 'user-7' });
    const res = await c.recovery.republish(c.phase2(), c.publish, { finalAttempt: false });

    expect(res).toMatchObject({ ok: false, manual: true, status: 'DETECTED' });
    expect(reqs.filter((r) => r.method === 'POST')).toEqual([]);
    expect(posts41().content).toBe('<p>Başka yazı.</p>');
    expect(c.db.article.bodyMd).toBe(BODY);
    expectNoStaleFlag(c, c.liveEntry.remoteModifiedAt);
    expect(c.entry()).toMatchObject({ remoteEditSkip: 'live_entry_mismatch' });
    const plan = planStuckRepublish({ publishedTo: c.db.article.publishedTo, targets: [WP_TARGET], slug: 'yazi', url: STUCK_URL });
    expect(plan).toEqual({ kind: 'proposal', block: 'live_copy_mismatch', labels: ['WordPress'] });
  });

  it('live_entry_missing (yazi silinmis, D3): FAILED; kopya artik canli degil (missingAt), isaret yok; plan ona bir daha yazmayi denemez', async () => {
    const c = build();
    posts.delete(41);
    await c.recovery.recover('sp1', { triggeredBy: 'autopilot' });
    const res = await c.recovery.republish(c.phase2(), c.publish, { finalAttempt: false });

    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(reqs.filter((r) => r.method === 'POST')).toEqual([]);
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.entry()).not.toHaveProperty('manualUpdatePending');
    expect(typeof c.entry().missingAt).toBe('string');
    expect(planStuckRepublish({ publishedTo: c.db.article.publishedTo, targets: [WP_TARGET], slug: 'yazi', url: STUCK_URL }))
      .toEqual({ kind: 'proposal', block: 'live_copy_missing', labels: ['WordPress'] });
  });

  it('herhangi bir basarisizlik (kalici atlama, son denemede hata): yayincinin bu yayinda koydugu isaretler yayindan onceki haline doner', async () => {
    const c = build();
    await c.recovery.recover('sp1', { triggeredBy: 'user-7' });
    // Yayinci kopyayi atilacak metne gore isaretleyip (ve damgayi degistirip) kalici atlama dondu
    const flagging = vi.fn(async (_a: string, ids: string[]) => {
      c.db.article.publishedTo = (c.db.article.publishedTo as any[]).map((e) => ({
        ...e, manualUpdatePending: true, manualUpdatePendingSince: new Date().toISOString(), remoteModifiedAt: '2099-01-01T00:00:00.000Z',
      }));
      c.db.article.updatedAt = new Date();
      return ids.map((id) => ({ targetId: id, targetType: 'WORDPRESS_REST', ok: false, skipped: 'already_live_create_only', error: 'Yeni kayıt açılmadı.' }));
    });
    const res = await c.recovery.republish(c.phase2(), flagging, { finalAttempt: false });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.entry()).toEqual(c.liveEntry);

    // Son denemede gecici hata (yayinci firlatti) — ayni geri donus
    const d = build();
    await d.recovery.recover('sp1', { triggeredBy: 'user-7' });
    const throwing = vi.fn(async () => {
      d.db.article.publishedTo = (d.db.article.publishedTo as any[]).map((e) => ({ ...e, manualUpdatePending: true, manualUpdatePendingSince: new Date().toISOString() }));
      d.db.article.updatedAt = new Date();
      throw new Error('ETIMEDOUT');
    });
    expect(await d.recovery.republish(d.phase2(), throwing, { finalAttempt: true })).toMatchObject({ ok: false, status: 'FAILED' });
    expect(d.entry()).toEqual(d.liveEntry);
  });

  it('kontrol: yazi duruyor ve degismemisse yerinde guncellenir, RECOVERED; kayit tazelenir (geri alma yok)', async () => {
    const c = build();
    await c.recovery.recover('sp1', { triggeredBy: 'autopilot' });
    expect(await c.recovery.republish(c.phase2(), c.publish, { finalAttempt: false })).toEqual({ ok: true, status: 'RECOVERED' });
    expect(posts41().content).toContain('KDV beyanı ile güncellenmiş cümle.');
    expect(c.entry().contentHash).toBe(articleContentHash(c.db.article));
    expect(c.entry()).not.toHaveProperty('remoteEditSkip');
  });
});

describe('rollbackStuckEntryFlags — yalniz yazilmayan kopyalarin bu yayinda degisen isaretleri doner (saf)', () => {
  const now = '2026-10-18T12:00:00.000Z';
  const snap = [
    { targetId: 'a', ok: true, contentHash: 'h0', remoteModifiedAt: '2026-08-01T00:00:00.000Z' },
    { targetId: 'b', ok: true, contentHash: 'h-eski', manualUpdatePending: true, manualUpdatePendingSince: '2026-09-01T00:00:00.000Z' },
    { targetId: 'c', ok: true, contentHash: 'h0' },
    { targetId: 'd', ok: true, contentHash: 'h0' },
  ];
  // Yayinin sonu: a atilan metinle isaretlendi (sitede degismis), b'nin onceki isareti var,
  // c yazildi (taze kayit), d hedefte silinmis bulundu (missingAt, isaret yayincida kalkti)
  const current = [
    { targetId: 'a', ok: true, contentHash: 'h0', remoteModifiedAt: '2026-08-01T00:00:00.000Z', manualUpdatePending: true, manualUpdatePendingSince: now },
    { targetId: 'b', ok: true, contentHash: 'h-eski', manualUpdatePending: true, manualUpdatePendingSince: '2026-09-01T00:00:00.000Z' },
    { targetId: 'c', ok: true, action: 'updated', contentHash: 'h1', remoteModifiedAt: '2026-10-18T11:00:00.000Z' },
    { targetId: 'd', ok: true, contentHash: 'h0', missingAt: now },
  ];

  it('atilan metne gore konan isaret kalkar; onceden olan isaret kalir; yazilan ve silinmis bulunan kopyaya dokunulmaz', () => {
    const out = rollbackStuckEntryFlags({ current, snapshot: snap, writtenTargetIds: new Set(['c']), remoteEdits: new Map([['a', 'live_entry_edited']]), now });
    expect(out.changed).toBe(true);
    expect(out.publishedTo).toEqual([
      { targetId: 'a', ok: true, contentHash: 'h0', remoteModifiedAt: '2026-08-01T00:00:00.000Z', remoteEditSkip: 'live_entry_edited', remoteEditSeenAt: now },
      current[1],
      current[2],
      current[3],
    ]);
    // Girdi degismez
    expect(current[0]).toHaveProperty('manualUpdatePending', true);
  });

  it('degisen bir sey yoksa changed:false (yazim yapilmaz); onceki "sitede degismis" ani korunur', () => {
    const marked = [{ targetId: 'a', ok: true, contentHash: 'h0', remoteEditSkip: 'live_entry_edited', remoteEditSeenAt: '2026-10-01T00:00:00.000Z' }];
    const out = rollbackStuckEntryFlags({ current: marked, snapshot: marked, writtenTargetIds: new Set(), remoteEdits: new Map([['a', 'live_entry_edited']]), now });
    expect(out).toEqual({ publishedTo: marked, changed: false });
    expect(rollbackStuckEntryFlags({ current: snap, snapshot: snap, writtenTargetIds: new Set(), remoteEdits: new Map(), now }).changed).toBe(false);
  });

  it('yayinci damgayi degistirdiyse (yazilmayan kopyada) onceki damga geri gelir; onceden olmayan alan silinir', () => {
    const cur = [{ targetId: 'a', ok: true, contentHash: 'h0', remoteModifiedAt: '2099-01-01T00:00:00.000Z' }];
    const prev = [{ targetId: 'a', ok: true, contentHash: 'h0' }];
    expect(rollbackStuckEntryFlags({ current: cur, snapshot: prev, writtenTargetIds: new Set(), remoteEdits: new Map(), now }).publishedTo)
      .toEqual([{ targetId: 'a', ok: true, contentHash: 'h0' }]);
  });
});
