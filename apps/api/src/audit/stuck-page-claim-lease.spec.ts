import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StuckPageRecoveryService } from './stuck-page-recovery.service.js';
import { StuckPageExternalRecoveryService } from './stuck-page-external-recovery.service.js';
import { StuckPageDetectorService } from './stuck-page-detector.service.js';
import {
  STUCK_CLAIM_LEASE_MS, liveStuckRecoverJobs, releaseAbandonedStuckClaim, runStuckPageSweep, stuckClaimKey,
} from './stuck-page-autopilot.js';
import { articleContentHash } from '../articles/republish-policy.js';

/**
 * Sahiplenme kirasi (S7 / S14): kurtarma sayfayi yapay zekadan once ATOMIK
 * sahipleniyor (RECOVERING). Is sahiplenmeden sonra olurse (dagitimda pm2
 * restart → SIGKILL) BullMQ ayni isi kilit suresi dolunca YENIDEN teslim
 * ediyordu; yeni teslim sayfayi RECOVERING gorup "zaten suruyor" deyip
 * atliyor, sayfa sonsuza kadar "Çalışıyor" kaliyordu (otopilot, toplu onarim
 * ve panel hicbiri RECOVERING satira dokunmuyordu).
 *  - Ayni is yeniden teslim edilince sayfayi devralir (yarim kalan duzenlemeyi
 *    geri alip bastan kosar).
 *  - Kiradan (STUCK_CLAIM_LEASE_MS) eski sahiplenmeyi, sayfanin canli isi
 *    yoksa, baska bir cagiran devralir; haftalik tarama ve takili sayfa listesi
 *    sahipsiz satiri onceki durumuna birakir.
 *  - Canli is varken (kuyrukta bekleyen ikinci asama) ya da durum
 *    dogrulanamazken hicbir sey devralinmaz.
 * Sahne: scratchpad rv13/e2e/claim-and-dup (A), rv13/lease-verify,
 * rv13/butunlesme/stale-recovering, rv13/verify-stale (gozden gecirme 13).
 */

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

const BODY = '# Yazı\n\nEski cümle burada.\n\nİkinci paragraf.';
const EDITED = BODY.replace('Eski cümle burada.', 'KDV beyanı ile güncellenmiş cümle.');
const PROPOSAL = {
  diagnosis: 'Entity eksik',
  edits: [{ type: 'sentence_replace', before: 'Eski cümle burada.', after: 'KDV beyanı ile güncellenmiş cümle.', reason: 'KDV', entityAdded: 'KDV beyanı' }],
  entitiesAdded: ['KDV beyanı'], paragraphAdded: null, entityScoreEstimate: 74,
};
const STUCK_URL = 'https://site.com/blog/yazi.html';
const FTP_ENTRY = { targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/public_html/blog/yazi.html', updatedAt: new Date(Date.now() - 60 * 864e5).toISOString() };
const HOUR = 60 * 60_000;
const never = () => new Promise<never>(() => undefined);

type JobRow = { id: string; type: string; status: string; bullJobId: string | null; queuedAt: Date; payload: Record<string, unknown> };

/**
 * Bellekte DB: stuckPage updateMany durum + updatedAt kosulunu uygular ve Prisma
 * @updatedAt gibi davranir (verilmezse simdi); kv_store; is tablosu JSON yolu
 * suzgeciyle; BullMQ durumlari ayri haritada.
 */
function world(opts: { status?: string; updatedAt?: Date; articleId?: string | null; lease?: Record<string, unknown> } = {}) {
  const db = {
    stuckPage: {
      id: 'sp1', siteId: 's1', articleId: opts.articleId === undefined ? 'a1' : opts.articleId, url: STUCK_URL, title: 'Yazı', position: 7,
      impressions: 400, ctr: 0.01, topQueries: ['kdv beyanı'], status: opts.status ?? 'DETECTED', updatedAt: opts.updatedAt ?? new Date(Date.now() - 3 * 864e5),
    } as Record<string, any>,
    article: {
      id: 'a1', siteId: 's1', status: 'PUBLISHED', slug: 'yazi', title: 'Yazı', metaTitle: null, metaDescription: null, bodyMd: BODY, bodyHtml: '<p>eski</p>',
      qaStatus: 'PASS' as string | null, qaReport: null as unknown, publishedAt: new Date(Date.now() - 90 * 864e5), publishedTo: [FTP_ENTRY] as unknown,
      updatedAt: new Date(Date.now() - 864e5),
    } as Record<string, any>,
    kv: new Map<string, { value: string; expiresAt: Date | null }>(),
    jobs: [] as JobRow[],
    bull: new Map<string, string>(),
    recoveries: [] as Array<Record<string, any>>,
  };
  if (opts.lease) db.kv.set(stuckClaimKey('sp1'), { value: JSON.stringify(opts.lease), expiresAt: null });
  let seq = 0;
  const pick = (row: Record<string, any>, select?: Record<string, unknown>) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : { ...row });
  const statusIs = (want: any) => want === undefined || (typeof want === 'string' ? db.stuckPage.status === want : (want.in ?? []).includes(db.stuckPage.status));
  const prisma: any = {
    stuckPage: {
      findUnique: vi.fn(async ({ select }: any = {}) => pick(db.stuckPage, select)),
      findMany: vi.fn(async ({ where }: any) => {
        const sp = db.stuckPage;
        const ok = sp.siteId === where.siteId && statusIs(where.status)
          && (where.updatedAt?.lt === undefined || sp.updatedAt.getTime() < where.updatedAt.lt.getTime())
          && (where.articleId?.not !== null || sp.articleId !== null);
        return ok ? [{ ...sp, article: db.article ? { ...db.article } : null }] : [];
      }),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ data }: any) => { Object.assign(db.stuckPage, { ...data, updatedAt: data.updatedAt ?? new Date() }); return { ...db.stuckPage }; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== db.stuckPage.id || !statusIs(where.status)) return { count: 0 };
        if (where.updatedAt instanceof Date && where.updatedAt.getTime() !== db.stuckPage.updatedAt.getTime()) return { count: 0 };
        Object.assign(db.stuckPage, { ...data, updatedAt: data.updatedAt ?? new Date() });
        return { count: 1 };
      }),
    },
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => (db.kv.has(where.key) ? { value: db.kv.get(where.key)!.value } : null)),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        db.kv.set(where.key, db.kv.has(where.key) ? { value: update.value, expiresAt: update.expiresAt } : { value: create.value, expiresAt: create.expiresAt });
        return {};
      }),
    },
    job: {
      findMany: vi.fn(async ({ where }: any) => db.jobs.filter((j) => j.type === where.type
        && (where.status?.in ?? []).includes(j.status)
        && j.queuedAt.getTime() >= where.queuedAt.gte.getTime()
        && (where.OR as any[]).some((c) => c.payload.path === '$.stuckPageId' && j.payload.stuckPageId === c.payload.equals))
        .map((j) => ({ ...j }))),
    },
    article: {
      findUnique: vi.fn(async ({ select }: any) => pick(db.article, select)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== db.article.id) return { count: 0 };
        if (where.bodyMd !== undefined && db.article.bodyMd !== where.bodyMd) return { count: 0 };
        if (where.status !== undefined && db.article.status !== where.status) return { count: 0 };
        for (const [k, v] of Object.entries(data)) db.article[k] = v === Prisma.DbNull ? null : v;
        return { count: 1 };
      }),
    },
    publishTarget: { findMany: vi.fn(async () => [{ id: 't-ftp', type: 'FTP', isActive: true }]) },
    site: {
      findUnique: vi.fn(async ({ select }: any) => (select?.publishApprovalMode
        ? { autopilot: true, publishApprovalMode: 'auto_publish', user: { plan: 'PRO' } }
        : { name: 'Site', userId: 'u1', url: 'https://site.com', platform: null })),
      findMany: vi.fn(async () => [{ id: 's1', userId: 'u1', autopilot: false, publishApprovalMode: 'manual_approve', user: { plan: 'PRO' } }]),
    },
    stuckPageRecovery: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `r${++seq}`, appliedAt: new Date(), revertedAt: null, revertedBy: null, ...data };
        db.recoveries.push(row);
        return { ...row };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const rows = db.recoveries
          .filter((x) => x.stuckPageId === where.stuckPageId && (!where.appliedAt?.gte || x.appliedAt.getTime() >= where.appliedAt.gte.getTime()))
          .sort((a, b) => b.appliedAt - a.appliedAt);
        return rows[0] ? { ...rows[0] } : null;
      }),
      delete: vi.fn(async ({ where }: any) => { db.recoveries = db.recoveries.filter((x) => x.id !== where.id); return {}; }),
    },
  };
  /** Kuyruk: DB is kaydi + BullMQ durumu (yeni is 'waiting') */
  const enqueue = vi.fn(async (o: any) => {
    const n = db.jobs.length + 1;
    db.jobs.push({ id: `job-${n}`, type: o.type, status: 'QUEUED', bullJobId: `b${n}`, queuedAt: new Date(), payload: o.payload });
    db.bull.set(`b${n}`, 'waiting');
    return { dbJobId: `job-${n}`, bullJobId: `b${n}` };
  });
  const jobs = { enqueue, getJobState: vi.fn(async (id: string) => db.bull.get(id) ?? 'unknown') };
  const geo = { runAudit: vi.fn(async () => ({ score: 55 })) };
  const svc = new StuckPageRecoveryService(prisma, { notify: vi.fn() } as any, jobs as any, geo as any);
  const llm = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(PROPOSAL) }] }));
  (svc as any).anthropic = { messages: { create: llm } };
  /** Worker'in teslim ettigi BullMQ isi (DB kaydi PROCESSING, BullMQ 'active') */
  const deliver = (bullJobId: string, payload: Record<string, unknown> = { stuckPageId: 'sp1', triggeredBy: 'autopilot' }) => {
    if (!db.jobs.some((j) => j.bullJobId === bullJobId)) {
      db.jobs.push({ id: `db-${bullJobId}`, type: 'STUCK_PAGE_RECOVER', status: 'PROCESSING', bullJobId, queuedAt: new Date(), payload });
    }
    db.bull.set(bullJobId, 'active');
  };
  /** Kuyruga GERCEKTEN giren ikinci asama isleri (asili kalan cagri sayilmaz) */
  const phase2Jobs = () => db.jobs.filter((j) => j.payload?.phase === 'republish');
  return { db, prisma, jobs, svc, llm, geo, deliver, phase2Jobs };
}

describe('S7/S14 — ayni is yeniden teslim edilince sayfayi devralir', () => {
  it('ilk teslim sahiplenip yapay zekada oldu; BullMQ ayni isi yeniden verdi: sayfa devralinir, duzeltme tamamlanir (eskiden "zaten suruyor")', async () => {
    const w = world();
    w.deliver('b-stuck');
    w.llm.mockImplementationOnce(never);
    // Ilk teslim: sahiplendi ve yapay zekada asili kaldi (surec oldu)
    void w.svc.recover('sp1', { triggeredBy: 'autopilot', jobId: 'b-stuck' });
    await vi.waitFor(() => expect(w.llm).toHaveBeenCalledTimes(1));
    expect(w.db.stuckPage.status).toBe('RECOVERING');
    const lease = JSON.parse(w.db.kv.get(stuckClaimKey('sp1'))!.value);
    expect(lease).toMatchObject({ jobId: 'b-stuck', prev: 'DETECTED' });
    expect(Date.parse(lease.at)).toBe(w.db.stuckPage.updatedAt.getTime());

    // Yeniden teslim (ayni is kimligi): devralir, yapay zekayi yeniden cagirir, ikinci asamayi kuyruga alir
    const r = await w.svc.recover('sp1', { triggeredBy: 'autopilot', jobId: 'b-stuck' });
    expect(r).toMatchObject({ success: true, needsRepublish: true });
    expect(w.llm).toHaveBeenCalledTimes(2);
    expect(w.db.article.bodyMd).toBe(EDITED);
    expect(w.db.stuckPage.status).toBe('RECOVERING');
    expect(w.phase2Jobs()).toHaveLength(1);
  });

  it('is govdeyi yazdiktan sonra (ikinci asama kuyruga girmeden) oldu: devralan duzenlemeyi kayittan geri alip bastan kosar; yarim kayit kalmaz', async () => {
    const w = world();
    w.deliver('b-late');
    // Ilk teslim: govde ve kayit yazildi, ikinci asama kuyruga alinirken surec oldu
    w.jobs.enqueue.mockImplementationOnce(never);
    void w.svc.recover('sp1', { triggeredBy: 'autopilot', jobId: 'b-late' });
    await vi.waitFor(() => expect(w.jobs.enqueue).toHaveBeenCalledTimes(1));
    expect(w.db.article.bodyMd).toBe(EDITED);
    expect(w.db.recoveries).toHaveLength(1);

    const r = await w.svc.recover('sp1', { triggeredBy: 'autopilot', jobId: 'b-late' });
    expect(r).toMatchObject({ success: true });
    // Eski yarim kayit silindi; yeni tur tek kayit ve tek ikinci asama birakti
    expect(w.db.recoveries).toHaveLength(1);
    expect(w.db.recoveries[0].bodyMdBefore).toBe(BODY);
    expect(w.db.article.bodyMd).toBe(EDITED);
    expect(w.phase2Jobs()).toHaveLength(1);
  });

  it('kira baska bir CANLI isin: yeniden teslim de olsa devralinmaz, yapay zeka cagrilmaz', async () => {
    const w = world();
    w.deliver('b-owner');
    w.llm.mockImplementationOnce(never);
    void w.svc.recover('sp1', { triggeredBy: 'user-7', jobId: 'b-owner' });
    await vi.waitFor(() => expect(w.llm).toHaveBeenCalledTimes(1));
    // Ayni sayfaya ikinci (farkli) is: sahibi canli, kira taze
    w.deliver('b-other', { stuckPageId: 'sp1', triggeredBy: 'user-7' });
    const r = await w.svc.recover('sp1', { triggeredBy: 'user-7', jobId: 'b-other' });
    expect(r).toEqual({ success: false, skipped: true, reason: 'Bu sayfanın düzeltmesi zaten sürüyor; hiçbir şey değiştirilmedi.' });
    expect(w.llm).toHaveBeenCalledTimes(1);
    expect(w.db.stuckPage.status).toBe('RECOVERING');
  });
});

describe('S7/S14 — kiradan eski, isi olmayan sahiplenme devralinir; canli is varken devralinmaz', () => {
  const stale = (over: Record<string, unknown> = {}) => {
    const at = new Date(Date.now() - 2 * HOUR);
    return { status: 'RECOVERING', updatedAt: at, lease: { at: at.toISOString(), prev: 'FAILED', prevUpdatedAt: new Date(Date.now() - 40 * 864e5).toISOString(), jobId: 'b-dead' }, ...over };
  };

  it('senkron "AI Düzelt" (is kimligi yok): olu isin sahiplenmesini devralir ve duzeltir', async () => {
    const w = world(stale());
    w.deliver('b-dead');
    w.db.bull.set('b-dead', 'failed'); // maxStalledCount asildi: BullMQ isi basarisiz saydi
    const r = await w.svc.recover('sp1', { triggeredBy: 'user-7' });
    expect(r).toMatchObject({ success: true, needsRepublish: true });
    expect(w.llm).toHaveBeenCalledTimes(1);
    // Yeni kira bu sahiplenmenin; onceki durum (birakilan FAILED) kayitli
    const lease = JSON.parse(w.db.kv.get(stuckClaimKey('sp1'))!.value);
    expect(lease).toMatchObject({ prev: 'FAILED' });
    expect(lease).not.toHaveProperty('jobId');
  });

  it('kira dolmus ama sayfanin ikinci asamasi kuyrukta bekliyor: devralinmaz (yayini bozmaz)', async () => {
    const w = world(stale());
    w.db.jobs.push({ id: 'job-p2', type: 'STUCK_PAGE_RECOVER', status: 'QUEUED', bullJobId: 'b-p2', queuedAt: new Date(Date.now() - HOUR), payload: { phase: 'republish', stuckPageId: 'sp1' } });
    w.db.bull.set('b-p2', 'waiting');
    const r = await w.svc.recover('sp1', { triggeredBy: 'user-7' });
    expect(r).toMatchObject({ success: false, skipped: true, reason: 'Bu sayfanın düzeltmesi zaten sürüyor; hiçbir şey değiştirilmedi.' });
    expect(w.llm).not.toHaveBeenCalled();
    expect(w.db.stuckPage.status).toBe('RECOVERING');
  });

  it('BullMQ durumu dogrulanamazsa (Redis hatasi) devralinmaz', async () => {
    const w = world(stale());
    w.deliver('b-dead');
    w.jobs.getJobState.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await w.svc.recover('sp1', { triggeredBy: 'user-7' });
    expect(r).toMatchObject({ success: false, skipped: true });
    expect(w.llm).not.toHaveBeenCalled();
    expect(w.db.stuckPage.status).toBe('RECOVERING');
  });

  it('kira suresi dolmadan baska cagiran devralamaz (canli senkron istek olabilir)', async () => {
    const at = new Date(Date.now() - (STUCK_CLAIM_LEASE_MS - 5 * 60_000));
    const w = world({ status: 'RECOVERING', updatedAt: at, lease: { at: at.toISOString(), prev: 'DETECTED' } });
    const r = await w.svc.recover('sp1', { triggeredBy: 'user-7' });
    expect(r).toMatchObject({ success: false, skipped: true });
    expect(w.llm).not.toHaveBeenCalled();
  });

  it('kira kaydi baska (onceki) sahiplenmeden kaldiysa yok sayilir: devralma satirin updatedAt\'ine gore', async () => {
    const at = new Date(Date.now() - 10 * 60_000);
    // Kirada eski bir an ve ayni is kimligi var; satirin sahiplenme ani farkli (kira yazilamamis yeni sahiplenme)
    const w = world({ status: 'RECOVERING', updatedAt: at, lease: { at: new Date(Date.now() - 5 * HOUR).toISOString(), prev: 'DETECTED', jobId: 'b-same' } });
    w.deliver('b-same');
    const r = await w.svc.recover('sp1', { triggeredBy: 'autopilot', jobId: 'b-same' });
    expect(r).toMatchObject({ success: false, skipped: true });
    expect(w.llm).not.toHaveBeenCalled();
  });
});

describe('S7/S14 — sahipsiz satir haftalik taramada ve listede birakilir', () => {
  it('runStuckPageSweep: kira dolmus, isi olmayan RECOVERING satir onceki durumuna (FAILED + onceki zamani) doner; yarim duzenleme geri alinir', async () => {
    const at = new Date(Date.now() - 3 * HOUR);
    const failedAt = new Date(Date.now() - 40 * 864e5);
    const w = world({ status: 'RECOVERING', updatedAt: at, lease: { at: at.toISOString(), prev: 'FAILED', prevUpdatedAt: failedAt.toISOString(), jobId: 'b-dead' } });
    // Is govdeyi yazdi, kaydi acti ve oldu
    w.db.article.bodyMd = EDITED;
    w.db.recoveries.push({ id: 'r-half', stuckPageId: 'sp1', bodyMdBefore: BODY, bodyMdAfter: EDITED, appliedAt: new Date(at.getTime() + 60_000) });
    const summary = await runStuckPageSweep({ prisma: w.prisma, detector: { detect: async () => ({ found: 0 }) }, jobs: w.jobs, log: { log: vi.fn(), warn: vi.fn() } });
    expect(summary.staleClaimsReleased).toBe(1);
    expect(w.db.stuckPage.status).toBe('FAILED');
    expect(w.db.stuckPage.updatedAt.getTime()).toBe(failedAt.getTime());
    expect(w.db.article.bodyMd).toBe(BODY);
    expect(w.db.recoveries).toEqual([]);
  });

  it('duzenleme bir kopyaya ulastiysa (kopya izi duzenlenmis metnin izi) metin ve kayit kalir, sayfa FAILED', async () => {
    const at = new Date(Date.now() - 3 * HOUR);
    const w = world({ status: 'RECOVERING', updatedAt: at, lease: { at: at.toISOString(), prev: 'DETECTED' } });
    w.db.article.bodyMd = EDITED;
    w.db.article.publishedTo = [{ ...FTP_ENTRY, contentHash: articleContentHash({ ...w.db.article, bodyMd: EDITED }) }];
    w.db.recoveries.push({ id: 'r-live', stuckPageId: 'sp1', bodyMdBefore: BODY, bodyMdAfter: EDITED, appliedAt: new Date(at.getTime() + 60_000) });
    expect(await releaseAbandonedStuckClaim({ prisma: w.prisma, jobs: w.jobs }, w.db.stuckPage as any)).toBe('FAILED');
    expect(w.db.article.bodyMd).toBe(EDITED);
    expect(w.db.recoveries).toHaveLength(1);
  });

  it('taze (kirasi gecerli) RECOVERING satira tarama dokunmaz', async () => {
    const at = new Date(Date.now() - 5 * 60_000);
    const w = world({ status: 'RECOVERING', updatedAt: at, lease: { at: at.toISOString(), prev: 'DETECTED' } });
    const summary = await runStuckPageSweep({ prisma: w.prisma, detector: { detect: async () => ({ found: 0 }) }, jobs: w.jobs });
    expect(summary.staleClaimsReleased).toBe(0);
    expect(w.db.stuckPage.status).toBe('RECOVERING');
  });

  it('takili sayfa listesi: bayat "Çalışıyor" satiri listelenirken birakilir, liste yeniden okunur', async () => {
    const { AuditController } = await import('./audit.controller.js');
    const at = new Date(Date.now() - 2 * HOUR);
    const w = world({ status: 'RECOVERING', updatedAt: at, lease: { at: at.toISOString(), prev: 'DETECTED' } });
    const ctl = Object.create(AuditController.prototype) as any;
    ctl.stuckRecovery = w.svc;
    ctl.stuckDetector = { list: vi.fn(async () => [{ ...w.db.stuckPage }]) };
    const rows = await ctl.listStuckPages('s1');
    expect(w.db.stuckPage.status).toBe('DETECTED');
    expect(ctl.stuckDetector.list).toHaveBeenCalledTimes(2);
    expect(rows[0].status).toBe('DETECTED');
    // Bayat satir yoksa ek sorgu yok
    const fresh = world();
    ctl.stuckRecovery = fresh.svc;
    ctl.stuckDetector = { list: vi.fn(async () => [{ ...fresh.db.stuckPage }]) };
    await ctl.listStuckPages('s1');
    expect(ctl.stuckDetector.list).toHaveBeenCalledTimes(1);
    expect(fresh.prisma.kvStore.findUnique).not.toHaveBeenCalled();
  });

  it('dedektor acik RECOVERING satiri tazelerken updatedAt\'i (sahiplenme ani) DEGISTIRMEZ: kira yaslanir', async () => {
    const at = new Date(Date.now() - 2 * HOUR);
    const row: Record<string, any> = { id: 'sp1', siteId: 's1', url: STUCK_URL, status: 'RECOVERING', articleId: 'a1', title: 'Yazı', updatedAt: at, impressions: 10 };
    const prisma: any = {
      article: { findMany: vi.fn(async ({ where }: any) => (where?.status === 'PUBLISHED' ? [{ id: 'a1', slug: 'yazi', title: 'Yazı', publishedTo: [FTP_ENTRY] }] : [])) },
      stuckPage: {
        findFirst: vi.fn(async ({ where }: any) => {
          const want: string[] = typeof where.status === 'string' ? [where.status] : where.status?.in ?? [];
          return want.includes(row.status) ? { ...row } : null;
        }),
        update: vi.fn(async ({ data }: any) => Object.assign(row, { ...data, updatedAt: data.updatedAt ?? new Date() })),
        updateMany: vi.fn(async ({ where, data }: any) => {
          if (where.id !== row.id || where.status !== row.status) return { count: 0 };
          if (where.updatedAt instanceof Date && where.updatedAt.getTime() !== row.updatedAt.getTime()) return { count: 0 };
          Object.assign(row, { ...data, updatedAt: data.updatedAt ?? new Date() });
          return { count: 1 };
        }),
        create: vi.fn(),
      },
    };
    const detector = new StuckPageDetectorService(prisma, {} as any);
    (detector as any).fetchPagePerformance = vi.fn(async () => [{ url: STUCK_URL, impressions: 500, clicks: 2, ctr: 0.004, position: 8 }]);
    (detector as any).fetchTopQueriesByUrl = vi.fn(async () => new Map());
    expect(await detector.detect('s1')).toMatchObject({ updated: 1 });
    expect(row).toMatchObject({ status: 'RECOVERING', impressions: 500 });
    expect(row.updatedAt.getTime()).toBe(at.getTime());
  });
});

describe('RanksUp disi sayfa (dis sayfa servisi) ayni kural', () => {
  it('ayni is yeniden teslim edilince devralir; sahiplenme kirasi yazilir', async () => {
    const w = world({ articleId: null });
    w.deliver('b-ext', { stuckPageId: 'sp1', triggeredBy: 'user-7' });
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
    const ext = new StuckPageExternalRecoveryService(w.prisma, { notify: vi.fn() } as any, w.geo as any, w.jobs as any);
    let hang = true;
    vi.spyOn(ext as any, 'fetchHtml').mockImplementation(async () => {
      if (hang) return never();
      return { kind: 'error', reason: 'timeout' };
    });
    void ext.recover('sp1', { triggeredBy: 'user-7', jobId: 'b-ext' });
    await vi.waitFor(() => expect(w.db.stuckPage.status).toBe('RECOVERING'));
    expect(JSON.parse(w.db.kv.get(stuckClaimKey('sp1'))!.value)).toMatchObject({ jobId: 'b-ext', prev: 'DETECTED' });
    hang = false;
    const r = await ext.recover('sp1', { triggeredBy: 'user-7', jobId: 'b-ext' });
    // Devraldi ve kosu tamamlandi (sayfa indirilemedi → FAILED); "zaten suruyor" degil
    expect(r).toMatchObject({ success: false });
    expect(r).not.toHaveProperty('skipped');
    expect(w.db.stuckPage.status).toBe('FAILED');
  });
});

describe('liveStuckRecoverJobs — sayfanin bekleyen / islenen isi (DB kaydi + BullMQ durumu)', () => {
  it('bekleyen, islenen ve yeniden deneme bekleyen is canli; biten, kuyrukta olmayan ve haric tutulan is canli degil; kimligi yazilmamis yeni is canli', async () => {
    const w = world();
    const now = Date.now();
    w.db.jobs.push(
      { id: 'j-wait', type: 'STUCK_PAGE_RECOVER', status: 'QUEUED', bullJobId: 'b1', queuedAt: new Date(now), payload: { stuckPageId: 'p-wait' } },
      { id: 'j-retry', type: 'STUCK_PAGE_RECOVER', status: 'FAILED', bullJobId: 'b2', queuedAt: new Date(now), payload: { stuckPageId: 'p-retry' } },
      { id: 'j-done', type: 'STUCK_PAGE_RECOVER', status: 'PROCESSING', bullJobId: 'b3', queuedAt: new Date(now), payload: { stuckPageId: 'p-done' } },
      { id: 'j-gone', type: 'STUCK_PAGE_RECOVER', status: 'QUEUED', bullJobId: 'b4', queuedAt: new Date(now), payload: { stuckPageId: 'p-gone' } },
      { id: 'j-self', type: 'STUCK_PAGE_RECOVER', status: 'PROCESSING', bullJobId: 'b5', queuedAt: new Date(now), payload: { stuckPageId: 'p-self' } },
      { id: 'j-new', type: 'STUCK_PAGE_RECOVER', status: 'QUEUED', bullJobId: null, queuedAt: new Date(now), payload: { stuckPageId: 'p-new' } },
      { id: 'j-old', type: 'STUCK_PAGE_RECOVER', status: 'QUEUED', bullJobId: null, queuedAt: new Date(now - HOUR), payload: { stuckPageId: 'p-old' } },
      // Kuyruga eklenemeyen is (enqueue queue.add hatasinda satiri FAILED yapar): canli degil
      { id: 'j-enqfail', type: 'STUCK_PAGE_RECOVER', status: 'FAILED', bullJobId: null, queuedAt: new Date(now), payload: { stuckPageId: 'p-enqfail' } },
      // Kimligi 1 dk'dir yazilmamis is: kuyruga hic girmemis sayilir (eskiden 5 dk canli)
      { id: 'j-mid', type: 'STUCK_PAGE_RECOVER', status: 'QUEUED', bullJobId: null, queuedAt: new Date(now - 60_000), payload: { stuckPageId: 'p-mid' } },
    );
    w.db.bull.set('b1', 'prioritized');
    w.db.bull.set('b2', 'delayed');
    w.db.bull.set('b3', 'completed');
    w.db.bull.set('b5', 'active');
    const live = await liveStuckRecoverJobs({ prisma: w.prisma, jobs: w.jobs }, ['p-wait', 'p-retry', 'p-done', 'p-gone', 'p-self', 'p-new', 'p-old', 'p-enqfail', 'p-mid', 'p-none'], { excludeBullJobId: 'b5' });
    expect(live).toEqual(new Map([['p-wait', 'j-wait'], ['p-retry', 'j-retry'], ['p-new', 'j-new']]));
    // JSON yolu suzgeci (MySQL '$.stuckPageId') ve is turu sorguda
    expect(w.prisma.job.findMany.mock.calls[0][0].where).toMatchObject({ type: 'STUCK_PAGE_RECOVER', status: { in: ['QUEUED', 'PROCESSING', 'FAILED'] } });
    expect(w.prisma.job.findMany.mock.calls[0][0].where.OR[0]).toEqual({ payload: { path: '$.stuckPageId', equals: 'p-wait' } });
    // Redis yoksa / hata verirse dogrulanamadi (null)
    expect(await liveStuckRecoverJobs({ prisma: w.prisma, jobs: {} }, ['p-wait'])).toBeNull();
    expect(await liveStuckRecoverJobs({ prisma: {}, jobs: w.jobs }, ['p-wait'])).toBeNull();
  });
});
