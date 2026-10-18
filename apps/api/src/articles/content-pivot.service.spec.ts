import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ContentPivotService, PIVOT_SCAN_LIMIT } from './content-pivot.service.js';

/**
 * Icerik pivotu — yeniden yazilan YAYINDAKI yazi yalniz Tam otomatikte onaysiz
 * yayinlanir. Eskiden otopilot acik her sitede autoPublish:true gidiyordu;
 * Yari otomatik (varsayilan) musterinin yazisi onayi beklenmeden degisiyordu.
 *
 * T-A madde 1: bekleme suresi SON canli yazimdan sayilir (yerinde guncelleme
 * publishedAt'i ilerletmez); canli kopyalari yeni metni alamayan yazi icin
 * yeniden yazim baslamaz (nedeni raporlanir); reddedilen otomatik yeniden
 * yazimdan sonra 30 gun beklenir; ayni yazi tek taramada bir kez is alir.
 */

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

const DAY = 86400000;
const OLD = new Date(Date.now() - 45 * DAY);
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
/** WordPress'te yayinda, yerinde guncellenebilir canli kopya */
const WP_LIVE = { targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: 'https://s.example/yazi/', updatedAt: OLD.toISOString() };
const WP_TARGET = { id: 't-wp', type: 'WORDPRESS_REST', isActive: true };
// Kural 1: yuksek gosterim, cok dusuk CTR → bayrak
const LOW_CTR = { impressions: 900, clicks: 2, position: 8 };
const FLAGGED_ARTICLE = { id: 'a1', slug: 'yazi', topic: 'Konu', title: 'Yazı', publishedAt: OLD, publishedTo: [WP_LIVE], performanceMetrics: LOW_CTR, performanceCheckedAt: null };

type Row = Record<string, any>;

/** article.findMany: aday sorgusu satirlari, ajan ciktisi sorgusu (select.agentOutputs) ayri */
function prismaFor(opts: { articles: Row[]; targets?: Row[]; agentOutputs?: Record<string, unknown>; snapshots?: Row[]; status?: string }) {
  return {
    site: { findMany: vi.fn<(args: any) => Promise<any[]>>(async () => []) },
    article: {
      findMany: vi.fn(async (args: any) => (args?.select?.agentOutputs
        ? args.where.id.in.map((id: string) => ({ id, agentOutputs: opts.agentOutputs?.[id] ?? null }))
        : opts.articles)),
      findUnique: vi.fn(async ({ where }: any) => {
        const a = opts.articles.find((x) => x.id === where.id);
        return a ? { siteId: 's1', slug: a.slug, status: opts.status ?? 'PUBLISHED', publishedTo: a.publishedTo, agentOutputs: opts.agentOutputs?.[a.id] ?? null } : null;
      }),
    },
    publishTarget: { findMany: vi.fn(async () => opts.targets ?? [WP_TARGET]) },
    aiCitationSnapshot: { findMany: vi.fn(async () => opts.snapshots ?? []) },
  };
}

function build(sites: Array<{ id: string; userId: string; autopilot: boolean; publishApprovalMode: string }>, articles: Row[] = [FLAGGED_ARTICLE]) {
  const prisma = prismaFor({ articles });
  prisma.site.findMany.mockImplementation(async () => sites);
  const jobQueue = { enqueue: vi.fn<(opts: any) => Promise<unknown>>(async () => ({ dbJobId: 'j', bullJobId: 'b' })) };
  return { svc: new ContentPivotService(prisma as any, jobQueue as any), prisma, jobQueue };
}

const scanWith = (opts: Parameters<typeof prismaFor>[0]) => {
  const prisma = prismaFor(opts);
  return { prisma, result: new ContentPivotService(prisma as any, { enqueue: vi.fn() } as any).scanSite('s1') };
};

describe('ContentPivotService.scanAllSites — yayin onayi', () => {
  it('site sorgusu modu da okur', async () => {
    const { svc, prisma } = build([]);
    await svc.scanAllSites();
    expect((prisma.site.findMany.mock.calls[0][0] as any).select).toMatchObject({ autopilot: true, publishApprovalMode: true });
  });

  it('Yari otomatik: yeniden yazim kuyruga girer ama autoPublish false (onay bekler)', async () => {
    const { svc, jobQueue } = build([{ id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'manual_approve' }]);
    expect(await svc.scanAllSites()).toMatchObject({ flagged: 1, queued: 1, blocked: 0 });
    const job = jobQueue.enqueue.mock.calls[0][0] as any;
    expect(job).toMatchObject({ type: 'GENERATE_ARTICLE', siteId: 's1', userId: 'u1' });
    expect(job.payload).toMatchObject({ articleId: 'a1', autoPublish: false });
  });

  it('Tam otomatik: autoPublish true (worker yayin aninda modu yeniden okur)', async () => {
    const { svc, jobQueue } = build([{ id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'auto_publish' }]);
    await svc.scanAllSites();
    expect((jobQueue.enqueue.mock.calls[0][0] as any).payload.autoPublish).toBe(true);
  });

  it('akis kapali: hic kuyruga girmez (eski davranis)', async () => {
    const { svc, jobQueue } = build([{ id: 's1', userId: 'u1', autopilot: false, publishApprovalMode: 'auto_publish' }]);
    expect(await svc.scanAllSites()).toMatchObject({ flagged: 1, queued: 0 });
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('is verisinde OTOMATIK yeniden yazim bayragi var (pipeline reddedilen taslakla canli kaydi ezmez)', async () => {
    const { svc, jobQueue } = build([{ id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'manual_approve' }]);
    await svc.scanAllSites();
    expect((jobQueue.enqueue.mock.calls[0][0] as any).payload.automatedRewrite).toBe(true);
  });

  it('yeni metni alamayan yazi kuyruga girmez; sonucta nedeniyle raporlanir', async () => {
    const ghost = { ...FLAGGED_ARTICLE, id: 'a-ghost', publishedTo: [{ targetId: 't-ghost', targetType: 'GHOST', ok: true, externalId: 'g1', updatedAt: OLD.toISOString() }] };
    const { svc, prisma, jobQueue } = build([{ id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'auto_publish' }], [ghost]);
    prisma.publishTarget.findMany.mockImplementation(async () => [{ id: 't-ghost', type: 'GHOST', isActive: true }]);
    const r = await svc.scanAllSites();
    expect(r).toMatchObject({ flagged: 0, queued: 0, blocked: 1 });
    expect(r.blockedDetails).toEqual([expect.objectContaining({ siteId: 's1', articleId: 'a-ghost', block: 'create_only' })]);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });
});

describe('ContentPivotService.scanSite — bekleme suresi SON canli yazimdan', () => {
  it('ilk yayini 45 gun once, 3 gun once yerinde guncellenmis yazi incelenmez (eskiden her hafta yeniden yaziliyordu)', async () => {
    const fresh = { ...FLAGGED_ARTICLE, publishedTo: [{ ...WP_LIVE, updatedAt: iso(3) }] };
    const { prisma, result } = scanWith({ articles: [fresh] });
    const r = await result;
    expect(r).toEqual({ scanned: 0, flagged: [], blocked: [] });
    // publishedTo okunur (son yazim JSON'da)
    expect((prisma.article.findMany.mock.calls[0] as any)[0].select.publishedTo).toBe(true);
  });

  it('son canli yazimi 40 gun once olan yazi incelenir ve isaretlenir', async () => {
    const stale = { ...FLAGGED_ARTICLE, publishedTo: [{ ...WP_LIVE, updatedAt: iso(40) }] };
    const r = await scanWith({ articles: [stale] }).result;
    expect(r.flagged.map((f) => f.articleId)).toEqual(['a1']);
  });

  it('son yazim kaydi olmayan eski yayin: publishedAt\'e bakilir (eski davranis)', async () => {
    const legacy = { ...FLAGGED_ARTICLE, publishedTo: [{ targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '41' }] };
    expect((await scanWith({ articles: [legacy] }).result).flagged).toHaveLength(1);
  });

  it('bekleyen yazilar pencereyi doldursa da incelenecek yazilar okunur (en fazla PIVOT_SCAN_LIMIT)', async () => {
    const cooling = Array.from({ length: 60 }, (_, i) => ({ ...FLAGGED_ARTICLE, id: `c${i}`, publishedTo: [{ ...WP_LIVE, updatedAt: iso(2) }] }));
    const due = Array.from({ length: 70 }, (_, i) => ({ ...FLAGGED_ARTICLE, id: `d${i}` }));
    const { prisma, result } = scanWith({ articles: [...cooling, ...due] });
    const r = await result;
    expect(r.scanned).toBe(PIVOT_SCAN_LIMIT);
    expect(r.flagged.every((f) => f.articleId.startsWith('d'))).toBe(true);
    expect((prisma.article.findMany.mock.calls[0] as any)[0].take).toBeGreaterThan(PIVOT_SCAN_LIMIT);
  });
});

describe('ContentPivotService.scanSite — canli kopyalar yeni metni alamiyorsa yeniden yazim BASLAMAZ', () => {
  const live = (publishedTo: unknown, over: Row = {}) => ({ ...FLAGGED_ARTICLE, publishedTo, ...over });

  it.each([
    ['yalniz yeni kayit acan hedef (Ghost)', live([{ targetId: 't-g', targetType: 'GHOST', ok: true, externalId: 'g1' }]), [{ id: 't-g', type: 'GHOST', isActive: true }], 'create_only', 'Ghost'],
    ['kaydi adreslenemeyen WordPress yazisi', live([{ targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true }]), [WP_TARGET], 'unaddressable', 'WordPress'],
    ['slug\'i degismis dosya (FTP)', live([{ targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/public_html/eski-yazi.html' }]), [{ id: 't-ftp', type: 'FTP', isActive: true }], 'slug_changed', 'FTP'],
    ['pasif hedef', live([WP_LIVE]), [{ ...WP_TARGET, isActive: false }], 'target_missing', 'WordPress'],
    ['silinmis hedef', live([WP_LIVE]), [], 'target_missing', 'WordPress'],
    ['hedefi kayitli olmayan yayin', live(null), [WP_TARGET], 'unknown_location', ''],
    ['karisik: WordPress + Ghost (Ghost eski metinle kalirdi)', live([WP_LIVE, { targetId: 't-g', targetType: 'GHOST', ok: true }]), [WP_TARGET, { id: 't-g', type: 'GHOST', isActive: true }], 'create_only', 'Ghost'],
  ])('%s → blocked', async (_name, article, targets, block, label) => {
    const r = await scanWith({ articles: [article], targets }).result;
    expect(r.flagged).toEqual([]);
    expect(r.blocked).toEqual([expect.objectContaining({ articleId: 'a1', block, reason: expect.stringContaining('CTR') })]);
    expect(r.blocked[0].blockReason).toContain('otomatik yeniden yazım başlatılmadı');
    if (label) expect(r.blocked[0].blockReason).toContain(label);
  });

  it('WordPress + Markdown ZIP disa aktarimi: ZIP engel degil (canli siteye dokunmaz) → isaretlenir', async () => {
    const withZip = live([WP_LIVE, { targetId: 't-zip', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/yazi.zip' }]);
    const r = await scanWith({ articles: [withZip], targets: [WP_TARGET, { id: 't-zip', type: 'MARKDOWN_ZIP', isActive: true }] }).result;
    expect(r.flagged.map((f) => f.articleId)).toEqual(['a1']);
  });

  it('yalniz Markdown ZIP kaydi: yeni metin hicbir canli sayfaya ulasamaz → blocked', async () => {
    const zipOnly = live([{ targetId: 't-zip', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/yazi.zip' }]);
    const r = await scanWith({ articles: [zipOnly], targets: [{ id: 't-zip', type: 'MARKDOWN_ZIP', isActive: true }] }).result;
    expect(r.flagged).toEqual([]);
    expect(r.blocked).toEqual([expect.objectContaining({ block: 'create_only', blockReason: expect.stringContaining('Markdown ZIP') })]);
  });

  it('dosya hedefinde ayni slug: yerinde uzerine yazilir → isaretlenir', async () => {
    const ftp = live([{ targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/public_html/yazi.html' }]);
    const r = await scanWith({ articles: [ftp], targets: [{ id: 't-ftp', type: 'FTP', isActive: true }] }).result;
    expect(r.flagged.map((f) => f.articleId)).toEqual(['a1']);
  });

  it('kurali tetiklemeyen yazi engelli olsa da raporlanmaz', async () => {
    const quietGhost = live([{ targetId: 't-g', targetType: 'GHOST', ok: true }], { performanceMetrics: null });
    const r = await scanWith({ articles: [quietGhost], targets: [{ id: 't-g', type: 'GHOST', isActive: true }] }).result;
    expect(r).toEqual({ scanned: 1, flagged: [], blocked: [] });
  });
});

describe('ContentPivotService.scanSite — reddedilen otomatik yeniden yazimdan sonra bekleme', () => {
  it('son 30 gunde editorden gecmeyen deneme: yeniden denenmez, nedeni raporlanir', async () => {
    const r = await scanWith({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: { rejectedRewrite: { at: iso(5), verdict: 'FAIL' } } } }).result;
    expect(r.flagged).toEqual([]);
    expect(r.blocked).toEqual([expect.objectContaining({ articleId: 'a1', block: 'recent_rejected_rewrite' })]);
    expect(r.blocked[0].blockReason).toContain('editör kontrolünden geçmedi');
  });

  it('reddedilen deneme 30 gunden eskiyse yeniden denenir', async () => {
    const r = await scanWith({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: { rejectedRewrite: { at: iso(31) } } } }).result;
    expect(r.flagged.map((f) => f.articleId)).toEqual(['a1']);
  });
});

describe('ContentPivotService.scanSite — AI atif kurali OLCULEN GUN sayar', () => {
  // GSC verisi olmayan yayindaki yazi: yalniz AI atif kurali karar verebilir
  const QUIET = { id: 'p1', slug: 'pillar', topic: 'Pillar konu', title: 'Pillar', publishedAt: OLD, publishedTo: [WP_LIVE], performanceMetrics: null, performanceCheckedAt: null };
  const PROVIDERS = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek'];
  const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n));
  /** Bir olcum gunu = saglayici basina bir satir (AiCitationSnapshot siteId+date+provider) */
  const measuredDays = (days: number, score: number | null = 0) =>
    Array.from({ length: days }, (_, d) => PROVIDERS.map(() => ({ date: day(d), score, citedCount: 0 }))).flat();

  const scan = (snapshots: Row[], articles: Row[] = [QUIET], targets?: Row[]) => scanWith({ articles, snapshots, targets }).result;

  it('haftalik iki olcum (12 satir, 2 gun) "14 gundur sifir" sayilmaz — eskiden yeniden yazma bayragi yiyordu', async () => {
    const rows = measuredDays(2);
    expect(rows.length).toBeGreaterThanOrEqual(7); // eski satir esigini gecerdi
    expect((await scan(rows)).flagged).toEqual([]);
  });

  it('en az 7 farkli gun olculmus, atif yok ve ortalama < 20: pillar yaziya bayrak (tasarlandigi gibi)', async () => {
    const r = await scan(measuredDays(7));
    expect(r.flagged).toHaveLength(1);
    expect(r.flagged[0]).toMatchObject({ articleId: 'p1', severity: 'high' });
  });

  it('skoru olculemeyen (null) gunler sayilmaz', async () => {
    const rows = [...measuredDays(6), ...measuredDays(7, null).filter((s) => s.date.getTime() === day(6).getTime())];
    expect((await scan(rows)).flagged).toEqual([]);
  });

  it('GSC kuraliyla zaten isaretli yazi AI kuraliyla ikinci is ALMAZ; pillar baska bir yazi olur', async () => {
    const r = await scan(measuredDays(7), [FLAGGED_ARTICLE, QUIET]);
    expect(r.flagged.map((f) => f.articleId)).toEqual(['a1', 'p1']);
    const only = await scan(measuredDays(7), [FLAGGED_ARTICLE]);
    expect(only.flagged.map((f) => f.articleId)).toEqual(['a1']);
  });

  it('pillar secimi yeni metni alabilen yaziyi tercih eder; hicbiri alamiyorsa engel raporlanir', async () => {
    const ghostPillar = { ...QUIET, id: 'p-ghost', publishedTo: [{ targetId: 't-g', targetType: 'GHOST', ok: true }] };
    const targets = [WP_TARGET, { id: 't-g', type: 'GHOST', isActive: true }];
    const prefers = await scan(measuredDays(7), [ghostPillar, QUIET], targets);
    expect(prefers.flagged.map((f) => f.articleId)).toEqual(['p1']);
    const none = await scan(measuredDays(7), [ghostPillar], targets);
    expect(none.flagged).toEqual([]);
    expect(none.blocked).toEqual([expect.objectContaining({ articleId: 'p-ghost', block: 'create_only' })]);
  });
});

describe('ContentPivotService.automatedRewriteBlock — worker is kosarken yeniden denetler', () => {
  it('yazi hala yayinda ve canli kopyalari yeni metni alabiliyor: null (uretim baslar)', async () => {
    const prisma = prismaFor({ articles: [FLAGGED_ARTICLE] });
    expect(await new ContentPivotService(prisma as any, {} as any).automatedRewriteBlock('a1')).toBeNull();
  });

  it('tarama ile is arasinda hedef pasiflesti: engel ve Turkce neden', async () => {
    const prisma = prismaFor({ articles: [FLAGGED_ARTICLE], targets: [{ ...WP_TARGET, isActive: false }] });
    expect(await new ContentPivotService(prisma as any, {} as any).automatedRewriteBlock('a1'))
      .toEqual({ block: 'target_missing', blockReason: expect.stringContaining('silinmiş ya da pasif') });
  });

  it('yazi artik yayinda degil ya da silinmis: not_published', async () => {
    const prisma = prismaFor({ articles: [FLAGGED_ARTICLE], status: 'READY_TO_PUBLISH' });
    const svc = new ContentPivotService(prisma as any, {} as any);
    expect((await svc.automatedRewriteBlock('a1'))?.block).toBe('not_published');
    expect((await svc.automatedRewriteBlock('yok'))?.block).toBe('not_published');
  });
});

describe('S4 — atlanan yayin her hafta yeniden yazima yol acmaz', () => {
  /** WordPress'te degismis kopya: yayinci live_entry_edited ile atladi, metin farkli → isaretli */
  const pendingWp = { ...WP_LIVE, contentHash: 'eski-metnin-izi', manualUpdatePending: true, manualUpdatePendingSince: iso(40) };
  const blockedOutputs = (daysAgo: number) => ({
    liveWriteBlocked: { at: iso(daysAgo), reasons: [{ targetId: 't-wp', targetType: 'WORDPRESS_REST', skipped: 'live_entry_edited' }] },
  });

  it('yeni metni alacak kopya "elle guncelleme bekliyor": tarama yeniden yazim BASLATMAZ (live_copy_pending), worker on denetimi de durdurur', async () => {
    const article = { ...FLAGGED_ARTICLE, publishedTo: [pendingWp] };
    const r = await scanWith({ articles: [article] }).result;
    expect(r.flagged).toEqual([]);
    expect(r.blocked).toEqual([expect.objectContaining({ articleId: 'a1', block: 'live_copy_pending' })]);
    expect(r.blocked[0].blockReason).toContain('(WordPress) elle güncelleme bekliyor');
    expect(r.blocked[0].blockReason).toContain('otomatik yeniden yazım başlatılmadı');
    const prisma = prismaFor({ articles: [article] });
    expect(await new ContentPivotService(prisma as any, {} as any).automatedRewriteBlock('a1'))
      .toEqual({ block: 'live_copy_pending', blockReason: expect.stringContaining('elle güncelleme bekliyor') });
  });

  it('isaret yalniz yeni metni alacak (sitedeki) kopyalarda aranir: isaretli Markdown ZIP kaydi engel degil', async () => {
    const article = { ...FLAGGED_ARTICLE, publishedTo: [WP_LIVE, { targetId: 't-zip', targetType: 'MARKDOWN_ZIP', ok: true, manualUpdatePending: true }] };
    const r = await scanWith({ articles: [article], targets: [WP_TARGET, { id: 't-zip', type: 'MARKDOWN_ZIP', isActive: true }] }).result;
    expect(r.flagged.map((f) => f.articleId)).toEqual(['a1']);
  });

  it('son otomatik yayin hicbir canli kopyaya yazamadi (liveWriteBlocked, 5 gun once) ve o zamandan beri yazilmadi: 30 gun denenmez', async () => {
    const r = await scanWith({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: blockedOutputs(5) } }).result;
    expect(r.flagged).toEqual([]);
    expect(r.blocked).toEqual([expect.objectContaining({ articleId: 'a1', block: 'recent_live_write_blocked' })]);
    expect(r.blocked[0].blockReason).toContain('canlı kopyalarına (WordPress) yazılamadı');
    expect(r.blocked[0].blockReason).toContain(`${new Date(Date.now() - 5 * DAY).toISOString().slice(0, 10)}`);
  });

  it('engel 30 gunden eskiyse yeniden denenir', async () => {
    expect((await scanWith({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: blockedOutputs(31) } }).result).flagged).toHaveLength(1);
  });

  it('engelden SONRA bir canli kopyaya yazildiysa (basarili yayin ya da "Elle güncelledim") kayit anlamini yitirir', async () => {
    // Tarama bu yaziyi zaten bekleme suresinde sayar (son yazim 2 gun once); worker on denetimi kayda bakmaz olur
    const later = { ...FLAGGED_ARTICLE, publishedTo: [{ ...WP_LIVE, updatedAt: iso(2) }] };
    const prisma = prismaFor({ articles: [later], agentOutputs: { a1: blockedOutputs(5) } });
    expect(await new ContentPivotService(prisma as any, {} as any).automatedRewriteBlock('a1')).toBeNull();
  });

  it('worker on denetimi: tarama ile is arasinda ayni yazinin otomatik yayini engellendiyse LLM kosmadan durur', async () => {
    const prisma = prismaFor({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: blockedOutputs(0) } });
    const svc = new ContentPivotService(prisma as any, {} as any);
    expect(await svc.automatedRewriteBlock('a1')).toEqual({ block: 'recent_live_write_blocked', blockReason: expect.stringContaining('30 gün denenmez') });
    // Okunan alanlar: ajan ciktilari dahil (tek yazi)
    expect((prisma.article.findUnique.mock.calls[0] as any)[0].select).toMatchObject({ publishedTo: true, agentOutputs: true });
    const fresh = prismaFor({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: blockedOutputs(31) } });
    expect(await new ContentPivotService(fresh as any, {} as any).automatedRewriteBlock('a1')).toBeNull();
  });
});
