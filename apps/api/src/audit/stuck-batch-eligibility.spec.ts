import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { StuckPageRecoveryService } from './stuck-page-recovery.service.js';
import { STUCK_RECOVER_JOB_PRIORITY, stuckClaimKey, stuckRecoverSkip } from './stuck-page-autopilot.js';
import {
  STUCK_AI_DISABLED, STUCK_AI_UNAVAILABLE, STUCK_ALREADY_QUEUED, STUCK_ARTICLE_EMPTY, STUCK_ARTICLE_LIVE_COPY_BEHIND, STUCK_ARTICLE_NOT_FOUND,
  STUCK_ARTICLE_PENDING_VERSION, STUCK_ARTICLE_UNPUBLISHED_CHANGES, STUCK_EXTERNAL_AUTOPILOT_SKIP, STUCK_PAGE_NOT_FOUND, STUCK_PROCESSED_SINCE_REQUEST,
} from './stuck-page-messages.js';

/**
 * Toplu onarim (POST stuck-pages/recover-batch) — paylasilan sozlesme D4
 * (S9 / S13 / S15 / S19 / S24).
 *
 * NEDEN VAR: kuyruga alma yalniz sayfanin durumuna bakiyordu. Is kosunca
 * bastan bilinen bir nedenle atlanacak sayfa (onay bekleyen surum, cop
 * kutusundaki kopya, bos govde, yapay zeka kapali...) "sıraya alındı" diye
 * donuyor, atlama nedeni yalniz is kaydinda kaliyor; panel 15 dakika bekleyip
 * hicbir ozet gostermeden vazgeciyor, butun secim o sure kilitli kaliyordu.
 * Sayfa basina tek is denetimi yoktu: yeniden gonderilen secim (sayfa yenilendi,
 * eski panel "başarısız" dedi) ayni GEO + Sonnet turunu ikinci kez kosuyordu.
 * Isler oncelik almadan kuyruga giriyor, 50 sayfalik tek secim butun
 * musterilerin yayin / uretim / kurulum islerini 15-25 dk bekletiyordu.
 */

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

const BODY = '# Yazı\n\nEski cümle burada.\n\nİkinci paragraf.';
const PROPOSAL = {
  diagnosis: 'Entity eksik',
  edits: [{ type: 'sentence_replace', before: 'Eski cümle burada.', after: 'KDV beyanı ile güncellenmiş cümle.', reason: 'KDV', entityAdded: 'KDV beyanı' }],
  entitiesAdded: ['KDV beyanı'], paragraphAdded: null, entityScoreEstimate: 74,
};
const url = (slug: string) => `https://site.com/blog/${slug}.html`;
const ftpEntry = (slug: string, over: Record<string, unknown> = {}) => ({
  targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: `ftp://h/public_html/blog/${slug}.html`, updatedAt: new Date(Date.now() - 60 * 864e5).toISOString(), ...over,
});
const liveArticle = (id: string, over: Record<string, unknown> = {}) => ({
  id, siteId: 's1', status: 'PUBLISHED', slug: id, title: id, metaTitle: null, metaDescription: null, bodyMd: BODY, bodyHtml: '<p>x</p>',
  publishedAt: new Date(Date.now() - 90 * 864e5), publishedTo: [ftpEntry(id)], ...over,
});

type Page = { id: string; status: string; articleId: string | null; url?: string; updatedAt?: Date };
type JobRow = { id: string; type: string; status: string; bullJobId: string | null; queuedAt: Date; payload: Record<string, any> };

function world(pages: Page[], articles: Array<Record<string, any>>, opts: { aiDisabled?: boolean; noKey?: boolean } = {}) {
  const store = pages.map((p) => ({ siteId: 's1', title: p.id, position: 7, impressions: 400, ctr: 0.01, topQueries: [], url: p.url ?? url(p.articleId ?? p.id), updatedAt: p.updatedAt ?? new Date(Date.now() - 3 * 864e5), ...p }));
  const arts = new Map(articles.map((a) => [a.id, { ...a }]));
  const jobsTable: JobRow[] = [];
  const bull = new Map<string, string>();
  const kv = new Map<string, string>();
  const recoveries: Array<Record<string, any>> = [];
  const byId = (id: string) => store.find((s) => s.id === id);
  const statusIs = (row: any, want: any) => want === undefined || (typeof want === 'string' ? row.status === want : (want.in ?? []).includes(row.status));
  const prisma: any = {
    site: { findUnique: vi.fn(async ({ select }: any) => (select?.publishApprovalMode ? { autopilot: true, publishApprovalMode: 'auto_publish', user: { plan: 'PRO' } } : { userId: 'owner-1', name: 'Site' })) },
    stuckPage: {
      findMany: vi.fn(async ({ where }: any) => store.filter((s) => s.siteId === where.siteId && (where.id?.in as string[]).includes(s.id)).map((s) => ({ ...s }))),
      findUnique: vi.fn(async ({ where, select }: any) => {
        const s = byId(where.id);
        if (!s) return null;
        return select ? Object.fromEntries(Object.keys(select).map((k) => [k, (s as any)[k]])) : { ...s };
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(byId(where.id)!, { ...data, updatedAt: data.updatedAt ?? new Date() })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const s = byId(where.id);
        if (!s || !statusIs(s, where.status)) return { count: 0 };
        if (where.updatedAt instanceof Date && where.updatedAt.getTime() !== s.updatedAt.getTime()) return { count: 0 };
        Object.assign(s, { ...data, updatedAt: data.updatedAt ?? new Date() });
        return { count: 1 };
      }),
    },
    article: {
      findMany: vi.fn(async ({ where }: any) => [...arts.values()].filter((a) => (where.id.in as string[]).includes(a.id) && a.siteId === where.siteId).map((a) => ({ ...a }))),
      findUnique: vi.fn(async ({ where }: any) => (arts.has(where.id) ? { ...arts.get(where.id) } : null)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const a = arts.get(where.id);
        if (!a || (where.bodyMd !== undefined && a.bodyMd !== where.bodyMd) || (where.status !== undefined && a.status !== where.status)) return { count: 0 };
        Object.assign(a, data);
        return { count: 1 };
      }),
    },
    publishTarget: { findMany: vi.fn(async () => [{ id: 't-ftp', type: 'FTP', isActive: true }]) },
    job: {
      findMany: vi.fn(async ({ where }: any) => jobsTable.filter((j) => j.type === where.type && (where.status?.in ?? []).includes(j.status)
        && (where.OR as any[]).some((c) => j.payload.stuckPageId === c.payload.equals)).map((j) => ({ ...j }))),
    },
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => (kv.has(where.key) ? { value: kv.get(where.key) } : null)),
      upsert: vi.fn(async ({ where, create, update }: any) => { kv.set(where.key, kv.has(where.key) ? update.value : create.value); return {}; }),
    },
    stuckPageRecovery: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `r${recoveries.length + 1}`, appliedAt: new Date(), ...data };
        recoveries.push(row);
        return { ...row };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const rows = recoveries.filter((r) => r.stuckPageId === where.stuckPageId && (!where.appliedAt?.gte || r.appliedAt.getTime() >= where.appliedAt.gte.getTime()));
        return rows.sort((a, b) => b.appliedAt - a.appliedAt)[0] ?? null;
      }),
      delete: vi.fn(async ({ where }: any) => { recoveries.splice(recoveries.findIndex((r) => r.id === where.id), 1); return {}; }),
    },
  };
  const enqueue = vi.fn(async (o: any) => {
    const n = jobsTable.length + 1;
    jobsTable.push({ id: `job-${n}`, type: o.type, status: 'QUEUED', bullJobId: `b${n}`, queuedAt: new Date(), payload: o.payload });
    bull.set(`b${n}`, o.priority ? 'prioritized' : 'waiting');
    return { dbJobId: `job-${n}`, bullJobId: `b${n}` };
  });
  const jobs = { enqueue, getJobState: vi.fn(async (id: string) => bull.get(id) ?? 'unknown') };
  const settings = { getBoolean: vi.fn(async (k: string) => k === 'AI_GLOBAL_DISABLED' && !!opts.aiDisabled) };
  const svc = new StuckPageRecoveryService(prisma, { notify: vi.fn() } as any, jobs as any, { runAudit: vi.fn(async () => ({ score: 50 })) } as any, settings as any);
  const llm = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(PROPOSAL) }] }));
  (svc as any).anthropic = opts.noKey ? null : { messages: { create: llm } };
  /** Kuyruktaki isi worker gibi calistir (BullMQ 'active' → bitti) */
  const runJob = async (dbJobId: string) => {
    const j = jobsTable.find((x) => x.id === dbJobId)!;
    bull.set(j.bullJobId!, 'active');
    j.status = 'PROCESSING';
    const r = await svc.recover(j.payload.stuckPageId, { triggeredBy: j.payload.triggeredBy, jobId: j.bullJobId!, requestedAt: j.payload.requestedAt });
    bull.set(j.bullJobId!, 'completed');
    j.status = 'COMPLETED';
    return r;
  };
  return { svc, prisma, jobs, enqueue, settings, llm, store, arts, jobsTable, bull, kv, recoveries, runJob, byId };
}

const queued = (r: any) => r.results.filter((x: any) => x.queued).map((x: any) => x.stuckPageId);

describe('D4 — is kosunca atlanacak sayfa kuyruga alinmaz, nedeni satirda HEMEN doner', () => {
  it('recover()\'un ucuz denetimleri kuyruga almadan once: bekleyen surum, kopyaya yazilmamis son metin, yayinlanmamis degisiklik, cop kutusu, silinmis kopya, bos govde, yazi yok', async () => {
    const pages: Page[] = [
      { id: 'ok', status: 'DETECTED', articleId: 'a-ok' },
      { id: 'pending', status: 'DETECTED', articleId: 'a-pending' },
      { id: 'behind', status: 'DETECTED', articleId: 'a-behind' },
      { id: 'unpublished', status: 'DETECTED', articleId: 'a-unpub' },
      { id: 'trashed', status: 'FAILED', articleId: 'a-trash' },
      { id: 'missing', status: 'DETECTED', articleId: 'a-miss' },
      { id: 'empty', status: 'DETECTED', articleId: 'a-empty' },
      { id: 'gone', status: 'DETECTED', articleId: 'a-yok' },
      { id: 'external', status: 'DETECTED', articleId: null },
    ];
    const w = world(pages, [
      liveArticle('a-ok'),
      liveArticle('a-pending', { status: 'READY_TO_PUBLISH' }),
      liveArticle('a-behind', { publishedTo: [ftpEntry('a-behind', { contentHash: 'eski', manualUpdatePending: true })] }),
      liveArticle('a-unpub', { publishedTo: [ftpEntry('a-unpub', { contentHash: 'eski' })] }),
      liveArticle('a-trash', { publishedTo: [ftpEntry('a-trash', { trashedAt: '2026-10-01T00:00:00.000Z' })] }),
      liveArticle('a-miss', { publishedTo: [ftpEntry('a-miss', { missingAt: '2026-10-01T00:00:00.000Z' })] }),
      liveArticle('a-empty', { bodyMd: '   ' }),
    ]);
    const r = await w.svc.queueBatch('s1', pages.map((p) => p.id), 'user-9', 50);
    const row = (id: string) => r.results.find((x) => x.stuckPageId === id)!;
    expect(queued(r)).toEqual(['ok', 'external']);
    expect(row('pending')).toMatchObject({ queued: false, notProcessed: true, code: 'not_eligible', reason: STUCK_ARTICLE_PENDING_VERSION });
    expect(row('behind')).toMatchObject({ notProcessed: true, reason: STUCK_ARTICLE_LIVE_COPY_BEHIND });
    expect(row('unpublished')).toMatchObject({ notProcessed: true, reason: STUCK_ARTICLE_UNPUBLISHED_CHANGES });
    expect(row('trashed').reason).toMatch(/çöp kutusunda.*Hiçbir şey değiştirilmedi\./);
    expect(row('missing').reason).toMatch(/artık bulunamıyor.*Hiçbir şey değiştirilmedi\./);
    expect(row('empty')).toMatchObject({ notProcessed: true, reason: STUCK_ARTICLE_EMPTY });
    expect(row('gone')).toMatchObject({ notProcessed: true, reason: STUCK_ARTICLE_NOT_FOUND });
    expect(r.summary).toEqual({ queued: 2, notProcessed: 7, failed: 0 });
    // Yapay zeka ve GEO istekte hic calismaz
    expect(w.llm).not.toHaveBeenCalled();
  });

  it('yapay zeka kullanilamazsa (yonetici kapatti / anahtar yok) hicbir sayfa kuyruga girmez; neden Turkce', async () => {
    const pages: Page[] = [{ id: 'a', status: 'DETECTED', articleId: 'a1' }, { id: 'b', status: 'DETECTED', articleId: null }];
    const off = world(pages, [liveArticle('a1')], { aiDisabled: true });
    const r1 = await off.svc.queueBatch('s1', ['a', 'b'], 'user-9', 50);
    expect(r1.results.map((x) => [x.stuckPageId, x.notProcessed, x.code, x.reason])).toEqual([
      ['a', true, 'ai_unavailable', STUCK_AI_DISABLED], ['b', true, 'ai_unavailable', STUCK_AI_DISABLED],
    ]);
    expect(off.enqueue).not.toHaveBeenCalled();
    const noKey = world(pages, [liveArticle('a1')], { noKey: true });
    expect((await noKey.svc.queueBatch('s1', ['a'], 'user-9', 50)).results[0]).toMatchObject({ notProcessed: true, reason: STUCK_AI_UNAVAILABLE });
  });

  it('site sahibinin plani Takili Sayfalar\'i kapsamiyorsa is acilmaz (uc kapisi disinda da); Profesyonel kapsar', async () => {
    const w = world([{ id: 'p1', status: 'DETECTED', articleId: 'a1' }], [liveArticle('a1')]);
    w.prisma.site.findUnique.mockResolvedValue({ userId: 'owner-1', user: { plan: 'STARTER' } });
    const r = await w.svc.queueBatch('s1', ['p1'], 'user-9', 50);
    expect(r.results[0]).toMatchObject({ queued: false, notProcessed: true, code: 'plan' });
    expect(r.results[0].reason).toContain('planına dahildir; düzeltme kuyruğa alınmadı.');
    expect(w.enqueue).not.toHaveBeenCalled();
    w.prisma.site.findUnique.mockResolvedValue({ userId: 'owner-1', user: { plan: 'PRO' } });
    expect((await w.svc.queueBatch('s1', ['p1'], 'user-9', 50)).results[0]).toMatchObject({ queued: true });
  });

  it('S9: karisik secimde uygun sayfa kuyruga girer, bekleyen surumu olan sayfa nedeniyle hemen doner (panel 15 dk "sırada" beklemez)', async () => {
    const w = world([{ id: 'p1', status: 'DETECTED', articleId: 'a1' }, { id: 'p2', status: 'DETECTED', articleId: 'a2' }],
      [liveArticle('a1'), liveArticle('a2', { status: 'READY_TO_PUBLISH' })]);
    const r = await w.svc.queueBatch('s1', ['p1', 'p2'], 'user-9', 50);
    expect(r.results).toEqual([
      { stuckPageId: 'p1', id: 'p1', queued: true, jobId: 'job-1' },
      { stuckPageId: 'p2', id: 'p2', queued: false, notProcessed: true, code: 'not_eligible', reason: STUCK_ARTICLE_PENDING_VERSION },
    ]);
  });
});

describe('S15 — toplu onarim isleri dusuk oncelikle kuyruga girer', () => {
  it('her is STUCK_RECOVER_JOB_PRIORITY ile: onceliksiz yayin / uretim ve 5-10 oncelikli kurulum / denetim isleri once islenir', async () => {
    const w = world([{ id: 'p1', status: 'DETECTED', articleId: 'a1' }], [liveArticle('a1')]);
    await w.svc.queueBatch('s1', ['p1'], 'user-9', 50);
    expect(w.enqueue.mock.calls[0][0]).toEqual({
      type: 'STUCK_PAGE_RECOVER', userId: 'owner-1', siteId: 's1',
      payload: { stuckPageId: 'p1', triggeredBy: 'user-9', requestedAt: expect.any(String) },
      priority: STUCK_RECOVER_JOB_PRIORITY,
    });
    // BullMQ'da kucuk sayi once: kurulum (10) ve site denetimi (5) bu islerin onunde
    expect(STUCK_RECOVER_JOB_PRIORITY).toBeGreaterThan(10);
  });
});

describe('S19/S24 — sayfa basina tek bekleyen is; bayat is yapay zeka cagirmaz', () => {
  it('ayni secim yeniden gonderilince (sayfa yenilendi) ikinci is ACILMAZ: satir bekleyen isin jobId\'sini tasir', async () => {
    const w = world([{ id: 'p1', status: 'DETECTED', articleId: 'a1' }, { id: 'p2', status: 'DETECTED', articleId: 'a2' }], [liveArticle('a1'), liveArticle('a2')]);
    const first = await w.svc.queueBatch('s1', ['p1', 'p2'], 'user-9', 50);
    expect(queued(first)).toEqual(['p1', 'p2']);
    const again = await w.svc.queueBatch('s1', ['p1', 'p2'], 'user-9', 50);
    expect(again.results).toEqual([
      { stuckPageId: 'p1', id: 'p1', queued: false, notProcessed: true, code: 'already_queued', reason: STUCK_ALREADY_QUEUED, jobId: 'job-1' },
      { stuckPageId: 'p2', id: 'p2', queued: false, notProcessed: true, code: 'already_queued', reason: STUCK_ALREADY_QUEUED, jobId: 'job-2' },
    ]);
    expect(w.enqueue).toHaveBeenCalledTimes(2);
    // Is kostu; ikinci asamasi (yeniden yayin) kuyrukta beklerken sayfa "duzeltiliyor": yeniden alinmaz
    await w.runJob('job-1');
    const phase2 = w.jobsTable.find((j) => j.payload.phase === 'republish')!;
    expect((await w.svc.queueBatch('s1', ['p1'], 'user-9', 50)).results[0]).toMatchObject({ notProcessed: true, code: 'status' });
    // Ikinci asama da bitti (or. oneriye dondu, sayfa yine "Tespit edildi"): yeniden kuyruga alinabilir
    w.bull.set(phase2.bullJobId!, 'completed');
    phase2.status = 'COMPLETED';
    w.byId('p1')!.status = 'DETECTED';
    expect(queued(await w.svc.queueBatch('s1', ['p1'], 'user-9', 50))).toEqual(['p1']);
  });

  it('bekleyen is varken tekil "AI Düzelt" sayfayi isledi (oneri): is sonra kostugunda yapay zeka CAGRILMAZ, neden is sonucunda', async () => {
    const w = world([{ id: 'p1', status: 'DETECTED', articleId: 'a1' }], [liveArticle('a1', { publishedTo: [{ targetId: 'g1', ok: true, externalId: 'x' }] })]);
    w.prisma.publishTarget.findMany.mockResolvedValue([{ id: 'g1', type: 'GHOST', isActive: true }]);
    const q = await w.svc.queueBatch('s1', ['p1'], 'user-9', 50);
    const jobId = q.results[0].jobId!;
    // Kullanici sayfayi yeniledi, "AI Düzelt"e basti: Ghost yalniz yeni kayit acar → oneri, sayfa DETECTED
    expect(await w.svc.recover('p1', { triggeredBy: 'user-9' })).toMatchObject({ manual: true });
    expect(w.llm).toHaveBeenCalledTimes(1);
    const r = await w.runJob(jobId);
    expect(r).toEqual({ success: false, skipped: true, reason: STUCK_PROCESSED_SINCE_REQUEST });
    expect(w.llm).toHaveBeenCalledTimes(1);
    expect(w.recoveries).toHaveLength(1);
  });

  it('ilk tur FAILED bitti: bekleyen ikinci is yeniden denemez; ayni isin BullMQ yeniden denemesi (son sahiplenme kendisinin) engellenmez', async () => {
    const w = world([{ id: 'p1', status: 'DETECTED', articleId: 'a1' }], [liveArticle('a1')]);
    const requestedAt = new Date(Date.now() - 60_000).toISOString();
    // Baska bir is sayfayi isledi ve FAILED birakti (istekten sonra)
    Object.assign(w.byId('p1')!, { status: 'FAILED', updatedAt: new Date() });
    const stale = await w.svc.recover('p1', { triggeredBy: 'user-9', jobId: 'b-second', requestedAt });
    expect(stale).toEqual({ success: false, skipped: true, reason: STUCK_PROCESSED_SINCE_REQUEST });
    expect(w.llm).not.toHaveBeenCalled();
    // Ayni is (kira bu isin) hata sonrasi yeniden deneniyor: normal kosar
    w.kv.set(stuckClaimKey('p1'), JSON.stringify({ at: new Date(Date.now() - 30_000).toISOString(), prev: 'DETECTED', jobId: 'b-own' }));
    const own = await w.svc.recover('p1', { triggeredBy: 'user-9', jobId: 'b-own', requestedAt });
    expect(own).toMatchObject({ success: true });
    expect(w.llm).toHaveBeenCalledTimes(1);
  });

  it('kirasi dolmus sahipsiz RECOVERING satir toplu istekte once birakilir, sonra kuyruga alinir', async () => {
    const at = new Date(Date.now() - 3 * 60 * 60_000);
    const w = world([{ id: 'p1', status: 'RECOVERING', articleId: 'a1', updatedAt: at }], [liveArticle('a1')]);
    w.kv.set(stuckClaimKey('p1'), JSON.stringify({ at: at.toISOString(), prev: 'DETECTED', jobId: 'b-dead' }));
    const r = await w.svc.queueBatch('s1', ['p1'], 'user-9', 50);
    expect(r.results[0]).toMatchObject({ queued: true });
    expect(w.byId('p1')!.status).toBe('DETECTED');
    // Taze sahiplenme (canli senkron istek olabilir) birakilmaz
    const fresh = world([{ id: 'p1', status: 'RECOVERING', articleId: 'a1', updatedAt: new Date() }], [liveArticle('a1')]);
    expect((await fresh.svc.queueBatch('s1', ['p1'], 'user-9', 50)).results[0]).toMatchObject({ notProcessed: true, code: 'status', reason: 'Bu sayfanın düzeltmesi zaten sürüyor; hiçbir şey değiştirilmedi.' });
  });
});

describe('Senkron "AI Düzelt" ve worker atlama sonuclari', () => {
  it('yonetici yapay zekayi kapattiysa tekil "AI Düzelt" de hicbir sey degistirmez (eskiden yalniz worker bakiyordu)', async () => {
    const w = world([{ id: 'p1', status: 'DETECTED', articleId: 'a1' }], [liveArticle('a1')], { aiDisabled: true });
    expect(await w.svc.recover('p1', { triggeredBy: 'user-9' })).toEqual({ success: false, skipped: true, reason: STUCK_AI_DISABLED });
    expect(w.llm).not.toHaveBeenCalled();
    expect(w.byId('p1')!.status).toBe('DETECTED');
    expect(w.prisma.stuckPage.updateMany).not.toHaveBeenCalled();
  });

  it('worker\'in servise varmadan atladigi durumlar is sonucunda Turkce neden + makine kodu tasir (Job.result)', () => {
    expect(stuckRecoverSkip('AI_GLOBAL_DISABLED')).toEqual({ skipped: true, code: 'AI_GLOBAL_DISABLED', reason: STUCK_AI_DISABLED });
    expect(stuckRecoverSkip('STUCK_PAGE_NOT_FOUND')).toEqual({ skipped: true, code: 'STUCK_PAGE_NOT_FOUND', reason: STUCK_PAGE_NOT_FOUND });
    expect(stuckRecoverSkip('EXTERNAL_PAGE_MANUAL_ONLY')).toEqual({ skipped: true, code: 'EXTERNAL_PAGE_MANUAL_ONLY', reason: STUCK_EXTERNAL_AUTOPILOT_SKIP });
    for (const code of ['AI_GLOBAL_DISABLED', 'STUCK_PAGE_NOT_FOUND', 'EXTERNAL_PAGE_MANUAL_ONLY'] as const) {
      expect(stuckRecoverSkip(code).reason).toMatch(/[ğüşıöçĞÜŞİÖÇ]/);
    }
  });
});
