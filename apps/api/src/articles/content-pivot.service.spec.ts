import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { ContentPivotService, PIVOT_SCAN_LIMIT, pivotBlockText, rewriteLeftNoNewVersion, siralananYazi } from './content-pivot.service.js';
import { allowanceRefundDecision, refundJobAllowanceCharge } from './allowance-refund.js';
import { hasAllowanceCharge, readAllowanceCharge } from './article-scheduler.service.js';
import { BASE_PLANS, NO_AUTO_ARTICLE_PLANS, articleOfferPlan } from '../billing/plans.js';

/**
 * Icerik pivotu — yeniden yazilan YAYINDAKI yazi yalniz Tam otomatikte onaysiz
 * yayinlanir. Eskiden otopilot acik her sitede autoPublish:true gidiyordu;
 * Yari otomatik (varsayilan) musterinin yazisi onayi beklenmeden degisiyordu.
 *
 * T-A madde 1: bekleme suresi SON canli yazimdan sayilir (yerinde guncelleme
 * publishedAt'i ilerletmez); canli kopyalari yeni metni alamayan yazi icin
 * yeniden yazim baslamaz (nedeni raporlanir); reddedilen otomatik yeniden
 * yazimdan sonra 60 gun beklenir; ayni yazi tek taramada bir kez is alir.
 *
 * 11.11.2026 (sahip karari): otomatik yeniden yazim aylik makale hakkindan bir yazi
 * duser; hak dolduysa baslamaz, yeni surum cikmazsa hak geri verilir (dosya sonu).
 */

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

const DAY = 86400000;
const OLD = new Date(Date.now() - 75 * DAY);
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
/** WordPress'te yayinda, yerinde guncellenebilir canli kopya */
const WP_LIVE = { targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: 'https://s.example/yazi/', updatedAt: OLD.toISOString() };
const WP_TARGET = { id: 't-wp', type: 'WORDPRESS_REST', isActive: true };
// Kural 1: yuksek gosterim, cok dusuk CTR → bayrak
const LOW_CTR = { impressions: 900, clicks: 2, position: 22 };
const FLAGGED_ARTICLE = { id: 'a1', slug: 'yazi', topic: 'Konu', title: 'Yazı', publishedAt: OLD, publishedTo: [WP_LIVE], performanceMetrics: LOW_CTR, performanceCheckedAt: null };

type Row = Record<string, any>;
type Counter = { articlesUsedThisMonth: number };

/**
 * Kullanici sayaci tablosu: makale hakkinin TEK kosullu UPDATE'i gercek anlamiyla
 * calisir — `articlesUsedThisMonth < tavan` tutmazsa satir degismez (count 0).
 */
function userTable(users: Record<string, Counter>) {
  return {
    updateMany: vi.fn(async ({ where, data }: any) => {
      const u = users[where.id];
      if (!u) return { count: 0 };
      const c = where.articlesUsedThisMonth ?? {};
      if (c.lt !== undefined && !(u.articlesUsedThisMonth < c.lt)) return { count: 0 };
      if (c.gt !== undefined && !(u.articlesUsedThisMonth > c.gt)) return { count: 0 };
      const d = data.articlesUsedThisMonth;
      u.articlesUsedThisMonth += typeof d?.increment === 'number' ? d.increment : -(d?.decrement ?? 0);
      return { count: 1 };
    }),
  };
}

/** QuotaService'in taramanin kullandigi yuzu: plan hakki okumasi + duz iade (ayni sayac) */
function quotaFor(users: Record<string, Counter>, limit = 40) {
  return {
    checkArticleQuota: vi.fn(async (userId: string) => {
      const used = users[userId]?.articlesUsedThisMonth ?? 0;
      return { allowed: used < limit, remaining: Math.max(0, limit - used), limit };
    }),
    refundArticleAllowance: vi.fn(async (userId: string) => {
      if (users[userId] && users[userId].articlesUsedThisMonth > 0) users[userId].articlesUsedThisMonth -= 1;
    }),
    // Aylik AI butcesi: varsayilan acik (null); dolu hesabi anlatan testler mockImplementation ile degistirir
    aiBudgetBlock: vi.fn<(userId: string) => Promise<string | null>>(async () => null),
  };
}

/** article.findMany: aday sorgusu satirlari, ajan ciktisi sorgusu (select.agentOutputs) ayri */
function prismaFor(opts: { articles: Row[]; targets?: Row[]; agentOutputs?: Record<string, unknown>; snapshots?: Row[]; status?: string; plan?: string; users?: Record<string, Counter>; pending?: Record<string, Array<{ agentOutputs: unknown }>> }) {
  return {
    site: { findMany: vi.fn<(args: any) => Promise<any[]>>(async () => []) },
    user: userTable(opts.users ?? {}),
    article: {
      findMany: vi.fn(async (args: any) => {
        // Takvimde bekleyen (hakki dusulmemis) yazi sayimi — article-scheduler countUnchargedPendingArticles:
        // kullanicinin SCHEDULED, hic yayinlanmamis yazilari (kullanici basina `pending`)
        if (args?.where?.status === 'SCHEDULED') return opts.pending?.[args.where.site?.userId] ?? [];
        return args?.select?.agentOutputs
          ? args.where.id.in.map((id: string) => ({ id, agentOutputs: opts.agentOutputs?.[id] ?? null }))
          : opts.articles;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const a = opts.articles.find((x) => x.id === where.id);
        return a ? { siteId: 's1', slug: a.slug, status: opts.status ?? 'PUBLISHED', publishedTo: a.publishedTo, agentOutputs: opts.agentOutputs?.[a.id] ?? null, site: { user: { plan: opts.plan ?? 'PRO' } } } : null;
      }),
    },
    publishTarget: { findMany: vi.fn(async () => opts.targets ?? [WP_TARGET]) },
    aiCitationSnapshot: { findMany: vi.fn(async () => opts.snapshots ?? []) },
  };
}

/**
 * scanAllSites kurulumu. Sayaclar verilmezse her site sahibinin makale hakki bos (0 / `limit`):
 * eski testler hak dolu olmayan hesabi anlatir.
 */
function build(
  sites: Array<{ id: string; userId: string; autopilot: boolean; publishApprovalMode: string }>,
  articles: Row[] = [FLAGGED_ARTICLE],
  hak: { users?: Record<string, Counter>; limit?: number; pending?: Record<string, Array<{ agentOutputs: unknown }>> } = {},
) {
  const users = hak.users ?? Object.fromEntries(sites.map((s) => [s.userId, { articlesUsedThisMonth: 0 }]));
  const prisma = prismaFor({ articles, users, pending: hak.pending });
  prisma.site.findMany.mockImplementation(async () => sites);
  const jobQueue = { enqueue: vi.fn<(opts: any) => Promise<unknown>>(async () => ({ dbJobId: 'j', bullJobId: 'b' })) };
  const quota = quotaFor(users, hak.limit);
  return { svc: new ContentPivotService(prisma as any, jobQueue as any, quota as any), prisma, jobQueue, quota, users };
}

/** Hak servisine dokunmayan yollar (scanSite, automatedRewriteBlock) icin servis */
const pivot = (prisma: unknown, jobQueue: unknown = {}) => new ContentPivotService(prisma as any, jobQueue as any, quotaFor({}) as any);

const scanWith = (opts: Parameters<typeof prismaFor>[0]) => {
  const prisma = prismaFor(opts);
  return { prisma, result: pivot(prisma, { enqueue: vi.fn() }).scanSite('s1') };
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

  it('son canli yazimi 70 gun once olan yazi incelenir ve isaretlenir', async () => {
    const stale = { ...FLAGGED_ARTICLE, publishedTo: [{ ...WP_LIVE, updatedAt: iso(70) }] };
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
  it('son 60 gunde editorden gecmeyen deneme: yeniden denenmez, nedeni raporlanir', async () => {
    const r = await scanWith({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: { rejectedRewrite: { at: iso(5), verdict: 'FAIL' } } } }).result;
    expect(r.flagged).toEqual([]);
    expect(r.blocked).toEqual([expect.objectContaining({ articleId: 'a1', block: 'recent_rejected_rewrite' })]);
    expect(r.blocked[0].blockReason).toContain('editör kontrolünden geçmedi');
  });

  it('reddedilen deneme 60 gunden eskiyse yeniden denenir', async () => {
    const r = await scanWith({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: { rejectedRewrite: { at: iso(61) } } } }).result;
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
    expect(await pivot(prisma).automatedRewriteBlock('a1')).toBeNull();
  });

  it('tarama ile is arasinda hedef pasiflesti: engel ve Turkce neden', async () => {
    const prisma = prismaFor({ articles: [FLAGGED_ARTICLE], targets: [{ ...WP_TARGET, isActive: false }] });
    expect(await pivot(prisma).automatedRewriteBlock('a1'))
      .toEqual({ block: 'target_missing', blockReason: expect.stringContaining('silinmiş ya da pasif') });
  });

  it('yazi artik yayinda degil ya da silinmis: not_published', async () => {
    const prisma = prismaFor({ articles: [FLAGGED_ARTICLE], status: 'READY_TO_PUBLISH' });
    const svc = pivot(prisma);
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
    expect(await pivot(prisma).automatedRewriteBlock('a1'))
      .toEqual({ block: 'live_copy_pending', blockReason: expect.stringContaining('elle güncelleme bekliyor') });
  });

  it('isaret yalniz yeni metni alacak (sitedeki) kopyalarda aranir: isaretli Markdown ZIP kaydi engel degil', async () => {
    const article = { ...FLAGGED_ARTICLE, publishedTo: [WP_LIVE, { targetId: 't-zip', targetType: 'MARKDOWN_ZIP', ok: true, manualUpdatePending: true }] };
    const r = await scanWith({ articles: [article], targets: [WP_TARGET, { id: 't-zip', type: 'MARKDOWN_ZIP', isActive: true }] }).result;
    expect(r.flagged.map((f) => f.articleId)).toEqual(['a1']);
  });

  it('son otomatik yayin hicbir canli kopyaya yazamadi (liveWriteBlocked, 5 gun once) ve o zamandan beri yazilmadi: 60 gun denenmez', async () => {
    const r = await scanWith({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: blockedOutputs(5) } }).result;
    expect(r.flagged).toEqual([]);
    expect(r.blocked).toEqual([expect.objectContaining({ articleId: 'a1', block: 'recent_live_write_blocked' })]);
    expect(r.blocked[0].blockReason).toContain('canlı kopyalarına (WordPress) yazılamadı');
    expect(r.blocked[0].blockReason).toContain(`${new Date(Date.now() - 5 * DAY).toISOString().slice(0, 10)}`);
  });

  it('engel 60 gunden eskiyse yeniden denenir', async () => {
    expect((await scanWith({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: blockedOutputs(61) } }).result).flagged).toHaveLength(1);
  });

  it('engelden SONRA bir canli kopyaya yazildiysa (basarili yayin ya da "Elle güncelledim") kayit anlamini yitirir', async () => {
    // Tarama bu yaziyi zaten bekleme suresinde sayar (son yazim 2 gun once); worker on denetimi kayda bakmaz olur
    const later = { ...FLAGGED_ARTICLE, publishedTo: [{ ...WP_LIVE, updatedAt: iso(2) }] };
    const prisma = prismaFor({ articles: [later], agentOutputs: { a1: blockedOutputs(5) } });
    expect(await pivot(prisma).automatedRewriteBlock('a1')).toBeNull();
  });

  it('worker on denetimi: tarama ile is arasinda ayni yazinin otomatik yayini engellendiyse LLM kosmadan durur', async () => {
    const prisma = prismaFor({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: blockedOutputs(0) } });
    const svc = pivot(prisma);
    expect(await svc.automatedRewriteBlock('a1')).toEqual({ block: 'recent_live_write_blocked', blockReason: expect.stringContaining('60 gün denenmez') });
    // Okunan alanlar: ajan ciktilari dahil (tek yazi)
    expect((prisma.article.findUnique.mock.calls[0] as any)[0].select).toMatchObject({ publishedTo: true, agentOutputs: true });
    const fresh = prismaFor({ articles: [FLAGGED_ARTICLE], agentOutputs: { a1: blockedOutputs(61) } });
    expect(await pivot(fresh).automatedRewriteBlock('a1')).toBeNull();
  });
});

/**
 * Deneme hesabi (sahip karari 20.10.2026): yapay zeka toplam 2 makale uretir ve bunlari
 * kullanici baslatir (denemede otomasyon makale uretmez). Otomatik yeniden yazim 5 ajanli
 * LLM hattidir: deneme hesabinin sitesi taranmaz, kuyruga onceden girmis is de LLM
 * harcamadan doner. (11.11.2026'dan beri ucretli planda yeniden yazim makale hakkindan
 * duser — asagidaki "makale hakki" bloklari.)
 */
describe('ContentPivotService — deneme hesabinda otomatik yeniden yazim yok', () => {
  it('tarama deneme hesaplarinin sitelerini sorguda eler', async () => {
    const { svc, prisma } = build([]);
    await svc.scanAllSites();
    // 11.11.2026 (uc paket): deneme + aylik makale hakki olmayan planlar (Baslangic) — plans.ts
    const elenen = (prisma.site.findMany.mock.calls[0][0] as any).where.user.plan.notIn as string[];
    expect(elenen).toEqual(NO_AUTO_ARTICLE_PLANS);
    expect(elenen).toContain('TRIAL');
    expect(elenen).toContain('STARTER');
    // Makale uretimi olan hicbir ucretli plan elenmez
    for (const p of BASE_PLANS.filter((x) => x.id !== 'trial' && x.articlesPerMonth > 0)) {
      expect(elenen, p.id).not.toContain(p.id.toUpperCase());
    }
  });

  it('kuyruktaki is calisirken plan makale uretimi olmayan plana (Baslangic) dusmusse: no_article_plan, uretim baslamaz', async () => {
    const prisma = prismaFor({ articles: [FLAGGED_ARTICLE], plan: 'STARTER' });
    const r = await pivot(prisma).automatedRewriteBlock('a1');
    expect(r).toEqual({ block: 'no_article_plan', blockReason: pivotBlockText('no_article_plan') });
    expect(r!.blockReason).toContain(`${articleOfferPlan().name_tr} ve üzeri planlarda`);
    expect(r!.blockReason).not.toMatch(/deneme/i);
    // Makale uretimi olan planda bu engel yok
    const pro = prismaFor({ articles: [FLAGGED_ARTICLE], plan: 'PRO' });
    expect(await pivot(pro).automatedRewriteBlock('a1')).toBeNull();
  });

  it('kuyruktaki is calisirken plan deneme hesabiysa (iptal / odeme alinamadi): trial_plan, uretim baslamaz', async () => {
    const prisma = prismaFor({ articles: [FLAGGED_ARTICLE], plan: 'TRIAL' });
    expect(await pivot(prisma).automatedRewriteBlock('a1'))
      .toEqual({ block: 'trial_plan', blockReason: expect.stringContaining('toplam 2 makale') });
  });
});

describe('ContentPivotService — Google ilk 15 korumasi (08.11.2026 kanit denetimi)', () => {
  it('siralananYazi: ilk 15 ve gosterimli yazi korunur; 16+ ya da gosterimsiz korunmaz', () => {
    expect(siralananYazi({ position: 8, impressions: 900 })).toBe(true);
    expect(siralananYazi({ position: 15, impressions: 1 })).toBe(true);
    expect(siralananYazi({ position: 15.4, impressions: 900 })).toBe(false);
    expect(siralananYazi({ position: 22, impressions: 900 })).toBe(false);
    expect(siralananYazi({ position: 5, impressions: 0 })).toBe(false);
    expect(siralananYazi(null)).toBe(false);
  });

  it('ilk 15teki dusuk CTRli yazi bastan yazilmak icin isaretlenmez; 4-15 kurali artik yok', async () => {
    const ilk15 = { ...FLAGGED_ARTICLE, performanceMetrics: { impressions: 900, clicks: 2, position: 8 } };
    const r1 = await scanWith({ articles: [ilk15] }).result;
    expect(r1.flagged).toEqual([]);
    const esik = { ...FLAGGED_ARTICLE, performanceMetrics: { impressions: 300, clicks: 30, position: 9 } };
    expect((await scanWith({ articles: [esik] }).result).flagged).toEqual([]);
  });
});

/**
 * MAKALE HAKKI (sahip karari 11.11.2026): otomatik yeniden yazim, uretilen her makale gibi
 * aylik makale hakkindan BIR yazi duser.
 *
 * NEDEN VAR: yeniden yazim butun 5 ajanli hatti kosturuyor ama haktan dusmuyordu ve aylik
 * tavani yoktu (yalniz yazi basina 60 gun bekleme): cok eski yazisi olan hesap ayda
 * onlarca ucretli yeniden yazimi bedavaya tetikleyebiliyordu. Iki yon de sabitlenir:
 * hak varken yeniden yazim eskisi gibi baslar (bir hak duserek), hak dolunca baslamaz;
 * yeni surum cikmayan yeniden yazimin hakki tam bir kez geri verilir.
 */
describe('ContentPivotService.scanAllSites — otomatik yeniden yazim makale hakkindan duser', () => {
  const SITE = (id: string, userId: string, autopilot = true) => ({ id, userId, autopilot, publishApprovalMode: 'manual_approve' });
  const yazilar = (...ids: string[]) => ids.map((id) => ({ ...FLAGGED_ARTICLE, id }));

  it('hak varken: is kuyruga girer, sayac TAM 1 artar, is verisi dusus izini tasir (auto_rewrite)', async () => {
    const users = { u1: { articlesUsedThisMonth: 5 } };
    const { svc, jobQueue } = build([SITE('s1', 'u1')], [FLAGGED_ARTICLE], { users, limit: 40 });
    expect(await svc.scanAllSites()).toMatchObject({ flagged: 1, queued: 1, blocked: 0 });
    expect(users.u1.articlesUsedThisMonth).toBe(6);
    const payload = (jobQueue.enqueue.mock.calls[0][0] as any).payload;
    expect(payload.automatedRewrite).toBe(true);
    expect(readAllowanceCharge(payload)).toEqual({ at: expect.any(String), source: 'auto_rewrite' });
    // Iz iade edilebilir bir dusustur (ayni ay, sayac sifirlanmadan once degil)
    expect(allowanceRefundDecision({ carrier: payload, plan: 'PRO', quotaResetAt: new Date(Date.now() - DAY), now: new Date() }))
      .toEqual({ refund: true, chargeAt: payload.allowanceCharge.at });
  });

  it('hak dolu: yeniden yazim BASLAMAZ, sayac degismez, sonucta quota_exhausted ve Turkce nedeniyle raporlanir', async () => {
    const users = { u1: { articlesUsedThisMonth: 40 } };
    const { svc, jobQueue } = build([SITE('s1', 'u1')], [FLAGGED_ARTICLE], { users, limit: 40 });
    const r = await svc.scanAllSites();
    expect(r).toMatchObject({ flagged: 0, queued: 0, blocked: 1 });
    expect(r.blockedDetails).toEqual([{ siteId: 's1', articleId: 'a1', reason: expect.stringContaining('CTR'), block: 'quota_exhausted', blockReason: pivotBlockText('quota_exhausted') }]);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(users.u1.articlesUsedThisMonth).toBe(40);
  });

  it('engel metni olani ve ne zaman surecegini soyler: bu ayki hak doldu, yeni ayda / plan yukseltince yenilenir, sonraki tarama alir', () => {
    const metin = pivotBlockText('quota_exhausted');
    expect(metin).toContain('Bu ayki makale hakkın doldu');
    expect(metin).toContain('otomatik yeniden yazım da makale hakkından bir makale düştüğü için başlatılmadı');
    expect(metin).toContain('Hak yeni ayda ya da planını yükselttiğinde yenilenir');
    expect(metin).toContain('sonraki haftalık taramada yeniden değerlendirilir');
  });

  it('hak dolu oldugu icin baslamayan yeniden yazim "denendi" SAYILMAZ: hak yenilenince ayni yazi sonraki taramada alinir', async () => {
    const users = { u1: { articlesUsedThisMonth: 40 } };
    const { svc, jobQueue, prisma } = build([SITE('s1', 'u1')], [FLAGGED_ARTICLE], { users, limit: 40 });
    expect((await svc.scanAllSites()).queued).toBe(0);
    // Tarama yaziya hicbir sey yazmadi: bekleme kayitlari (rejectedRewrite / liveWriteBlocked /
    // son canli yazim) yalniz yazi satirinda durur; sahte tabloda yazma yuzu bile yok
    expect(Object.keys(prisma.article)).toEqual(['findMany', 'findUnique']);
    users.u1.articlesUsedThisMonth = 0; // yeni ay (QuotaService sayaci sifirladi)
    expect(await svc.scanAllSites()).toMatchObject({ flagged: 1, queued: 1, blocked: 0 });
    expect((jobQueue.enqueue.mock.calls[0][0] as any).payload.articleId).toBe('a1');
    expect(users.u1.articlesUsedThisMonth).toBe(1);
  });

  it('kalan hakki taramanin SIRASI dagitir: 1 hak, 3 isaretli yazi → ilki kuyruga girer, digerleri hak dolu', async () => {
    const users = { u1: { articlesUsedThisMonth: 39 } };
    const { svc, jobQueue, quota } = build([SITE('s1', 'u1')], yazilar('a1', 'a2', 'a3'), { users, limit: 40 });
    const r = await svc.scanAllSites();
    expect(r).toMatchObject({ flagged: 1, queued: 1, blocked: 2 });
    expect(jobQueue.enqueue.mock.calls.map((c) => (c[0] as any).payload.articleId)).toEqual(['a1']);
    expect(r.blockedDetails.map((b) => [b.articleId, b.block])).toEqual([['a2', 'quota_exhausted'], ['a3', 'quota_exhausted']]);
    expect(users.u1.articlesUsedThisMonth).toBe(40); // tavan asilmadi
    // Hak kullanici basina bir kez okunur (ay basi sifirlamasi dahil)
    expect(quota.checkArticleQuota).toHaveBeenCalledTimes(1);
  });

  it('hak HESAP basina: ayni kullanicinin ikinci sitesi de ayni tavana karsi duser; baska kullanici etkilenmez', async () => {
    const users = { u1: { articlesUsedThisMonth: 39 }, u2: { articlesUsedThisMonth: 0 } };
    const { svc, jobQueue } = build([SITE('s1', 'u1'), SITE('s2', 'u1'), SITE('s3', 'u2')], [FLAGGED_ARTICLE], { users, limit: 40 });
    const r = await svc.scanAllSites();
    expect(jobQueue.enqueue.mock.calls.map((c) => (c[0] as any).siteId)).toEqual(['s1', 's3']);
    expect(r.blockedDetails).toEqual([expect.objectContaining({ siteId: 's2', block: 'quota_exhausted' })]);
    expect(users).toEqual({ u1: { articlesUsedThisMonth: 40 }, u2: { articlesUsedThisMonth: 1 } });
  });

  // 11.11.2026 (bagimsiz inceleme): takvime eklenen konu kalan haktan AYRILIR (scheduleTopic bunu
  // sayar). Yeniden yazim yalniz `kullanilan < hak` kosuluna bakiyordu: 36/40 kullanmis, takvimine
  // 4 konu eklemis musterinin son 4 hakkini Pazartesi taramasi aliyor, konulari ay sonuna kadar
  // "hak doldu" diye bekliyordu.
  it('takvime ayrilan hak kullanilmaz: 36/40 + takvimde 4 bekleyen → yeniden yazim BASLAMAZ, allowance_reserved', async () => {
    const users = { u1: { articlesUsedThisMonth: 36 } };
    const pending = { u1: Array.from({ length: 4 }, () => ({ agentOutputs: null })) };
    const { svc, jobQueue } = build([SITE('s1', 'u1')], yazilar('a1', 'a2'), { users, limit: 40, pending });
    const r = await svc.scanAllSites();
    expect(r).toMatchObject({ flagged: 0, queued: 0, blocked: 2 });
    expect(r.blockedDetails.map((b) => [b.articleId, b.block])).toEqual([['a1', 'allowance_reserved'], ['a2', 'allowance_reserved']]);
    expect(r.blockedDetails[0].blockReason).toBe(pivotBlockText('allowance_reserved'));
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(users.u1.articlesUsedThisMonth).toBe(36); // takvimin 4 hakki yerinde
  });

  it('ayrilmamis hak kullanilir, ayrilana dokunulmaz: 30/40 + takvimde 4 → 6 yeniden yazim, kalani allowance_reserved', async () => {
    const users = { u1: { articlesUsedThisMonth: 30 } };
    const pending = { u1: Array.from({ length: 4 }, () => ({ agentOutputs: null })) };
    const { svc, jobQueue, prisma } = build([SITE('s1', 'u1')], yazilar('a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'), { users, limit: 40, pending });
    const r = await svc.scanAllSites();
    expect(r).toMatchObject({ flagged: 6, queued: 6, blocked: 2 });
    expect(jobQueue.enqueue).toHaveBeenCalledTimes(6);
    expect(r.blockedDetails.map((b) => [b.articleId, b.block])).toEqual([['a7', 'allowance_reserved'], ['a8', 'allowance_reserved']]);
    expect(users.u1.articlesUsedThisMonth).toBe(36); // 40 - 4 ayrilan
    // Bekleyenler kullanici basina bir kez sayilir (tum siteleri; demo sitesi haric)
    const sayim = prisma.article.findMany.mock.calls.map((c) => (c[0] as any).where).filter((w) => w?.status === 'SCHEDULED');
    expect(sayim).toHaveLength(1);
    expect(sayim[0]).toMatchObject({ status: 'SCHEDULED', publishedAt: null, site: { userId: 'u1' } });
  });

  it('hakki onceden dusulmus (isaretli) takvim yazisi ayrilan sayilmaz; hak tumden doluysa neden yine quota_exhausted', async () => {
    const isaretli = { agentOutputs: { allowanceCharge: { at: '2026-11-01T09:00:00.000Z', source: 'calendar' } } };
    const a = build([SITE('s1', 'u1')], [FLAGGED_ARTICLE], { users: { u1: { articlesUsedThisMonth: 39 } }, limit: 40, pending: { u1: [isaretli, isaretli] } });
    expect(await a.svc.scanAllSites()).toMatchObject({ flagged: 1, queued: 1, blocked: 0 });

    const b = build([SITE('s1', 'u1')], [FLAGGED_ARTICLE], { users: { u1: { articlesUsedThisMonth: 40 } }, limit: 40, pending: { u1: [{ agentOutputs: null }] } });
    const r = await b.svc.scanAllSites();
    expect(r.blockedDetails.map((x) => x.block)).toEqual(['quota_exhausted']);
    // Hak doluyken bekleyenler sayilmaz bile (gereksiz sorgu yok)
    expect(b.prisma.article.findMany.mock.calls.some((c) => (c[0] as any).where?.status === 'SCHEDULED')).toBe(false);
  });

  it('ayrilan hak engeli metni: kalan hak takvimdeki yazilara ayrili, yeniden yazim onu kullanmaz, sonraki tarama alir', () => {
    const metin = pivotBlockText('allowance_reserved');
    expect(metin).toContain('Kalan makale hakkın takvimde üretilmeyi bekleyen yazılarına ayrılı');
    expect(metin).toContain('otomatik yeniden yazım o hakkı kullanmaz');
    expect(metin).toContain('sonraki haftalık taramada yeniden değerlendirilir');
  });

  // 11.11.2026: aylik AI butcesi artik uretim hattini da durduruyor. Tarama bunu bilmezse her
  // hafta hak dusup is acar, hat reddeder, worker hakki geri verir. Butce doluyken is acilmaz.
  it('aylik AI butcesi dolu: yeniden yazim BASLAMAZ, hak dusmez (okunmaz bile), budget_exhausted ile raporlanir; baska sahip etkilenmez', async () => {
    const users = { u1: { articlesUsedThisMonth: 3 }, u2: { articlesUsedThisMonth: 0 } };
    const { svc, jobQueue, quota } = build([SITE('s1', 'u1'), SITE('s2', 'u1'), SITE('s3', 'u2')], yazilar('a1', 'a2'), { users, limit: 40 });
    quota.aiBudgetBlock.mockImplementation(async (userId: string) => (userId === 'u1' ? 'Aylık AI kullanım bütçen doldu ($120.00 / $120).' : null));
    const r = await svc.scanAllSites();
    expect(r).toMatchObject({ flagged: 2, queued: 2, blocked: 4 });
    expect(jobQueue.enqueue.mock.calls.map((c) => [(c[0] as any).siteId, (c[0] as any).payload.articleId])).toEqual([['s3', 'a1'], ['s3', 'a2']]);
    expect(r.blockedDetails.map((b) => [b.siteId, b.articleId, b.block])).toEqual([
      ['s1', 'a1', 'budget_exhausted'], ['s1', 'a2', 'budget_exhausted'], ['s2', 'a1', 'budget_exhausted'], ['s2', 'a2', 'budget_exhausted'],
    ]);
    expect(r.blockedDetails[0].blockReason).toBe(pivotBlockText('budget_exhausted'));
    // Hak dusmedi, iade de gerekmedi; butcesi dolu sahibin hakki hic okunmadi
    expect(users).toEqual({ u1: { articlesUsedThisMonth: 3 }, u2: { articlesUsedThisMonth: 2 } });
    expect(quota.checkArticleQuota.mock.calls.map((c) => c[0])).toEqual(['u2']);
    expect(quota.refundArticleAllowance).not.toHaveBeenCalled();
    // Butce sahip basina bir kez okunur (u1'in iki sitesi, dort yazisi)
    expect(quota.aiBudgetBlock.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2']);
  });

  it('aylik AI butcesi acik: yeniden yazim her zamanki gibi baslar ve hak duser', async () => {
    const users = { u1: { articlesUsedThisMonth: 0 } };
    const { svc, jobQueue, quota } = build([SITE('s1', 'u1')], [FLAGGED_ARTICLE], { users, limit: 40 });
    expect(await svc.scanAllSites()).toMatchObject({ flagged: 1, queued: 1, blocked: 0 });
    expect(quota.aiBudgetBlock).toHaveBeenCalledWith('u1');
    expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(users.u1.articlesUsedThisMonth).toBe(1);
  });

  it('butce dolu oldugu icin baslamayan yeniden yazim "denendi" SAYILMAZ: butce yenilenince ayni yazi sonraki taramada alinir', async () => {
    const users = { u1: { articlesUsedThisMonth: 0 } };
    const { svc, jobQueue, quota, prisma } = build([SITE('s1', 'u1')], [FLAGGED_ARTICLE], { users, limit: 40 });
    quota.aiBudgetBlock.mockImplementationOnce(async () => 'Aylık AI kullanım bütçen doldu ($120.00 / $120).');
    expect(await svc.scanAllSites()).toMatchObject({ flagged: 0, queued: 0, blocked: 1 });
    // Yaziya hicbir bekleme kaydi yazilmadi (sahte tabloda yazma yuzu bile yok)
    expect(Object.keys(prisma.article)).toEqual(['findMany', 'findUnique']);
    expect(await svc.scanAllSites()).toMatchObject({ flagged: 1, queued: 1, blocked: 0 }); // yeni ay: butce acik
    expect((jobQueue.enqueue.mock.calls[0][0] as any).payload.articleId).toBe('a1');
  });

  it('butce engeli metni olani ve ne zaman surecegini soyler: butce doldu, hak dusmedi, yeni ayda sifirlanir, sonraki tarama alir', () => {
    const metin = pivotBlockText('budget_exhausted');
    expect(metin).toContain('Aylık AI kullanım bütçen doldu');
    expect(metin).toContain('otomatik yeniden yazım başlatılmadı ve makale hakkından düşülmedi');
    expect(metin).toContain('Bütçe yeni ayın başında sıfırlanır');
    expect(metin).toContain('sonraki haftalık taramada yeniden değerlendirilir');
  });

  it('akis kapali site: is acilmaz, hak da DUSMEZ (hak okunmaz bile)', async () => {
    const users = { u1: { articlesUsedThisMonth: 5 } };
    const { svc, jobQueue, quota } = build([SITE('s1', 'u1', false)], [FLAGGED_ARTICLE], { users, limit: 40 });
    expect(await svc.scanAllSites()).toMatchObject({ flagged: 1, queued: 0, blocked: 0 });
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(quota.checkArticleQuota).not.toHaveBeenCalled();
    expect(quota.aiBudgetBlock).not.toHaveBeenCalled();
    expect(users.u1.articlesUsedThisMonth).toBe(5);
  });

  it('is kuyruga girmedi: dusulen hak geri verilir (kuyruga girmeyen yeniden yazim haktan dusmus kalmaz); diger site surer', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const users = { u1: { articlesUsedThisMonth: 5 }, u2: { articlesUsedThisMonth: 0 } };
    const { svc, jobQueue, quota } = build([SITE('s1', 'u1'), SITE('s2', 'u2')], [FLAGGED_ARTICLE], { users, limit: 40 });
    jobQueue.enqueue.mockImplementationOnce(async () => { throw new Error('redis yok'); });
    const r = await svc.scanAllSites();
    expect(r.queued).toBe(1);
    expect(quota.refundArticleAllowance).toHaveBeenCalledTimes(1);
    expect(quota.refundArticleAllowance).toHaveBeenCalledWith('u1');
    expect(users).toEqual({ u1: { articlesUsedThisMonth: 5 }, u2: { articlesUsedThisMonth: 1 } });
    warn.mockRestore();
  });

  it('hak okunamadi (veritabani hatasi): o sitede hicbir is acilmaz ve hak dusmez (kapali taraf); diger kullanici surer', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const users = { u1: { articlesUsedThisMonth: 5 }, u2: { articlesUsedThisMonth: 0 } };
    const { svc, jobQueue, quota } = build([SITE('s1', 'u1'), SITE('s2', 'u2')], [FLAGGED_ARTICLE], { users, limit: 40 });
    quota.checkArticleQuota.mockImplementationOnce(async () => { throw new Error('db yok'); });
    const r = await svc.scanAllSites();
    expect(jobQueue.enqueue.mock.calls.map((c) => (c[0] as any).siteId)).toEqual(['s2']);
    expect(r.queued).toBe(1);
    expect(users.u1.articlesUsedThisMonth).toBe(5);
    warn.mockRestore();
  });
});

describe('otomatik yeniden yazimin hakki — worker tarafi (on denetim + iade)', () => {
  it('on denetim: is verisinde dusus izi yoksa is KOSMAZ (allowance_not_charged), veritabanina bile gidilmez', async () => {
    const prisma = prismaFor({ articles: [FLAGGED_ARTICLE] });
    const eskiIs = { siteId: 's1', topic: 'Konu', articleId: 'a1', automatedRewrite: true };
    expect(await pivot(prisma).automatedRewriteBlock('a1', eskiIs))
      .toEqual({ block: 'allowance_not_charged', blockReason: pivotBlockText('allowance_not_charged') });
    expect(prisma.article.findUnique).not.toHaveBeenCalled();
    // Hakki iade edilmis is (iz iade izine cevrilmis) de izsizdir
    const iadeli = { ...eskiIs, allowanceRefund: { at: iso(0), chargeAt: iso(0), source: 'auto_rewrite' } };
    expect((await pivot(prisma).automatedRewriteBlock('a1', iadeli))?.block).toBe('allowance_not_charged');
  });

  it('on denetim: izi tasiyan is engellenmez; canli kopya denetimleri eskisi gibi surer', async () => {
    const izli = { articleId: 'a1', automatedRewrite: true, allowanceCharge: { at: iso(0), source: 'auto_rewrite' } };
    expect(await pivot(prismaFor({ articles: [FLAGGED_ARTICLE] })).automatedRewriteBlock('a1', izli)).toBeNull();
    const pasif = prismaFor({ articles: [FLAGGED_ARTICLE], targets: [{ ...WP_TARGET, isActive: false }] });
    expect((await pivot(pasif).automatedRewriteBlock('a1', izli))?.block).toBe('target_missing');
  });

  it('rewriteLeftNoNewVersion: yalniz OTOMATIK yeniden yazim, ve yalniz yeni surum cikmadiysa', () => {
    const otomatik = { automatedRewrite: true };
    // Atlandi (uretim kapali, yazi silinmis, on denetim engelledi) ya da editorden gecmedi
    expect(rewriteLeftNoNewVersion(otomatik, { skipped: true, reason: 'LIVE_REWRITE_BLOCKED' })).toBe(true);
    expect(rewriteLeftNoNewVersion(otomatik, { skipped: true, reason: 'ARTICLE_GENERATION_DISABLED' })).toBe(true);
    expect(rewriteLeftNoNewVersion(otomatik, { articleId: 'a1', editorVerdict: 'REVIZE', liveKept: true })).toBe(true);
    // Yeni surum cikti (yayinlanmasa da): hak kullanildi
    expect(rewriteLeftNoNewVersion(otomatik, { articleId: 'a1', editorVerdict: 'PASS' })).toBe(false);
    expect(rewriteLeftNoNewVersion(otomatik, { articleId: 'a1', editorVerdict: 'PASS', publishSkipped: 'manual_approve' })).toBe(false);
    expect(rewriteLeftNoNewVersion(otomatik, { articleId: 'a1', publishError: 'QA_BLOCKED' })).toBe(false);
    // Kullanicinin baslattigi isler (kapali dongu, Üret, takvim): bu yoldan iade YOK (davranis degismedi)
    expect(rewriteLeftNoNewVersion({ allowanceCharge: { at: iso(0), source: 'user_start' } }, { skipped: true })).toBe(false);
    expect(rewriteLeftNoNewVersion({ automatedRewrite: 'true' }, { skipped: true })).toBe(false);
    expect(rewriteLeftNoNewVersion(undefined, { liveKept: true })).toBe(false);
    expect(rewriteLeftNoNewVersion(otomatik, null)).toBe(false);
    expect(rewriteLeftNoNewVersion(otomatik, { skipped: 'true' })).toBe(false);
  });

  /**
   * Taramanin kuyruga attigi is + worker'in iadesi, gercek iade koduyla (allowance-refund).
   * Is satiri JobQueueService.enqueue'nun yazdigi gibi: is verisi + BullMQ kimligi.
   */
  async function kuyruktakiIs(used: number) {
    const users = { u1: { articlesUsedThisMonth: used } };
    const { svc, jobQueue, prisma } = build([{ id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'manual_approve' }], [FLAGGED_ARTICLE], { users, limit: 40 });
    await svc.scanAllSites();
    const row = { id: 'j1', bullJobId: '77', userId: 'u1', payload: structuredClone((jobQueue.enqueue.mock.calls[0][0] as any).payload) };
    const db: any = {
      user: prisma.user,
      job: {
        findUnique: vi.fn(async ({ where }: any) => (where.bullJobId === row.bullJobId
          ? { id: row.id, userId: row.userId, payload: structuredClone(row.payload), user: { plan: 'PRO', articlesQuotaResetAt: new Date(Date.now() - DAY) } }
          : null)),
        updateMany: vi.fn(async ({ where, data }: any) => {
          if (where.id !== row.id || row.payload?.allowanceCharge?.at !== where.payload?.equals) return { count: 0 };
          row.payload = data.payload;
          return { count: 1 };
        }),
      },
      $transaction: vi.fn(async (fn: any) => fn(db)),
    };
    /** Worker sarmalayicisinin aynasi (apps/worker/src/index.ts; asagidaki kablolama testi metni sabitler) */
    const workerSonucu = async (result: unknown) => {
      if (rewriteLeftNoNewVersion(row.payload, result)) await refundJobAllowanceCharge(db, { bullJobId: row.bullJobId });
    };
    return { users, row, db, workerSonucu };
  }

  it('worker on denetimi engelledi (LIVE_REWRITE_BLOCKED): hak geri verilir, TAM bir kez', async () => {
    const t = await kuyruktakiIs(5);
    expect(t.users.u1.articlesUsedThisMonth).toBe(6);
    const atlandi = { skipped: true, reason: 'LIVE_REWRITE_BLOCKED', block: 'target_missing' };
    await t.workerSonucu(atlandi);
    expect(t.users.u1.articlesUsedThisMonth).toBe(5);
    // Iz iade izine cevrildi: ayni is yeniden gelse de (tekrarlanan olay) ikinci iade olmaz
    expect(hasAllowanceCharge(t.row.payload)).toBe(false);
    expect(t.row.payload.allowanceRefund).toMatchObject({ source: 'auto_rewrite' });
    await t.workerSonucu(atlandi);
    expect(t.users.u1.articlesUsedThisMonth).toBe(5);
  });

  it('editorden gecmedi, canli yazi korundu (liveKept): hak geri verilir', async () => {
    const t = await kuyruktakiIs(5);
    await t.workerSonucu({ articleId: 'a1', editorVerdict: 'REVIZE', liveKept: true });
    expect(t.users.u1.articlesUsedThisMonth).toBe(5);
  });

  it('yeni surum cikti: hak KULLANILDI, iade yok', async () => {
    const t = await kuyruktakiIs(5);
    await t.workerSonucu({ articleId: 'a1', editorVerdict: 'PASS', publishSkipped: 'manual_approve' });
    expect(t.users.u1.articlesUsedThisMonth).toBe(6);
    expect(hasAllowanceCharge(t.row.payload)).toBe(true);
  });

  it('hat son denemede hata verdi: worker catch\'i is verisindeki izden iade eder (kapali dongu ile ayni yol); sonra gelen atlama ikinci kez iade etmez', async () => {
    const t = await kuyruktakiIs(5);
    // Worker'in kosulu: `(job.data as { allowanceCharge?: unknown }).allowanceCharge` dolu
    expect((t.row.payload as { allowanceCharge?: unknown }).allowanceCharge).toBeTruthy();
    await expect(refundJobAllowanceCharge(t.db, { bullJobId: t.row.bullJobId })).resolves.toEqual({ refunded: true });
    expect(t.users.u1.articlesUsedThisMonth).toBe(5);
    await t.workerSonucu({ skipped: true, reason: 'LIVE_REWRITE_BLOCKED' });
    expect(t.users.u1.articlesUsedThisMonth).toBe(5);
  });
});

describe('worker kablolamasi (apps/worker/src/index.ts) — otomatik yeniden yazimin makale hakki', () => {
  // Worker'in test kosucusu yok; kurallar bu servisten gelmeli
  const src = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf('GENERATE_ARTICLE: async'), src.indexOf('PUBLISH_ARTICLE: async'));

  it('on denetim is verisini de alir (izsiz is kosmaz) ve uretimden ONCE calisir', () => {
    const precheck = handler.indexOf('services.contentPivot.automatedRewriteBlock(articleId, job?.data)');
    expect(precheck).toBeGreaterThan(-1);
    expect(precheck).toBeLessThan(handler.indexOf('services.pipeline.runPipeline('));
    // Izi denetlemeyen eski cagri geri gelmesin
    expect(handler).not.toContain('automatedRewriteBlock(articleId)');
  });

  it('yeni surum cikarmadan donen otomatik yeniden yazimin hakki TEK yerden geri verilir (isleyicinin her donus yolu kapsanir)', () => {
    expect(src).toMatch(/import \{ ContentPivotService, rewriteLeftNoNewVersion \} from '\.\.\/\.\.\/api\/dist\/articles\/content-pivot\.service\.js'/);
    expect(src).toMatch(
      /const generateArticle = handlers\.GENERATE_ARTICLE;\s*handlers\.GENERATE_ARTICLE = async \(data, job\) => \{\s*const result = await generateArticle\(data, job\);\s*if \(job\?\.id && rewriteLeftNoNewVersion\(data, result\)\) \{\s*await refundJobAllowanceCharge\(services\.prisma, \{ bullJobId: String\(job\.id\) \}\)\.catch\(\(\) => null\);\s*\}\s*return result;\s*\};/,
    );
    // Sarmalayici isleyici tablosundan sonra, kuyruk dinlenmeden once kurulur
    const sarmal = src.indexOf('handlers.GENERATE_ARTICLE = async (data, job) =>');
    expect(sarmal).toBeGreaterThan(src.indexOf('STUCK_PAGE_PERFORMANCE_CHECK: async'));
    expect(sarmal).toBeLessThan(src.indexOf("new Worker(\n    'luviai-jobs'"));
  });

  // 11.11.2026 (bagimsiz inceleme): iptal edilen is (sitesi silinen yazi) isleyiciye hic girmez;
  // sarmalayici calismadigi icin otomatik yeniden yazimin hakki iade edilmiyordu.
  it('isleyiciye girmeden atlanan (iptal / hesap silme) otomatik yeniden yazimin hakki da geri verilir', () => {
    const dongu = src.slice(src.indexOf("new Worker(\n    'luviai-jobs'"));
    const atla = dongu.slice(dongu.indexOf('const skip = await accountSkip(services.prisma, job.id);'), dongu.indexOf('const t0 = Date.now();'));
    expect(atla).toMatch(
      /if \(job\.name === 'GENERATE_ARTICLE' && job\.id && rewriteLeftNoNewVersion\(job\.data, skip\)\) \{\s*await refundJobAllowanceCharge\(services\.prisma, \{ bullJobId: String\(job\.id\) \}\)\.catch\(\(\) => null\);\s*\}\s*return skip;/,
    );
    // Kural ayni saf fonksiyon: yalniz otomatik yeniden yazim isi + atlanmis sonuc
    expect(rewriteLeftNoNewVersion({ automatedRewrite: true }, { skipped: true, reason: 'job_canceled' })).toBe(true);
    expect(rewriteLeftNoNewVersion({ automatedRewrite: true }, { skipped: true, reason: 'account_deletion' })).toBe(true);
    expect(rewriteLeftNoNewVersion({ lostQuery: 'x', allowanceCharge: { at: 'x' } }, { skipped: true, reason: 'job_canceled' })).toBe(false);
  });

  it('hata ile biten son denemenin iadesi isleyicinin catch\'inde kalir (is verisindeki izden)', () => {
    expect(handler).toMatch(/if \(!failedNow && job\?\.id && [\s\S]*?allowanceCharge\) \{\s*await refundJobAllowanceCharge\(services\.prisma, \{ bullJobId: String\(job\.id\) \}\)/);
  });

  it('tarama isin kuyruga girmedigi durumda hakki geri verir; iz is verisine yazilir (kaynak)', () => {
    const svc = readFileSync(new URL('./content-pivot.service.ts', import.meta.url), 'utf8');
    const tarama = svc.slice(svc.indexOf('async scanAllSites('), svc.indexOf('private async chargeRewrite('));
    expect(tarama).toContain("...withAllowanceCharge(null, 'auto_rewrite', new Date()),");
    expect(tarama).toMatch(/\} catch \(err\) \{[\s\S]*?await this\.quota\.refundArticleAllowance\(site\.userId\);\s*throw err;/);
    // Hak tek kosullu UPDATE ile duser (takvimin chargeArticle'i ile ayni kalip)
    const dus = svc.slice(svc.indexOf('private async chargeRewrite('), svc.indexOf('async scanSite('));
    expect(dus).toContain('where: { id: userId, articlesUsedThisMonth: { lt: limit } }');
    expect(dus).toContain('data: { articlesUsedThisMonth: { increment: 1 } }');
  });
});
