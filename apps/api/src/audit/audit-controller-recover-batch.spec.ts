import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { queueStuckRecoveries, stuckBatchQueueSummary } from './stuck-batch-result.js';
import { StuckPageRecoveryService } from './stuck-page-recovery.service.js';
import { STUCK_BATCH_MAX } from './audit.dto.js';
import { STUCK_RECOVER_JOB_PRIORITY } from './stuck-page-autopilot.js';

/**
 * POST stuck-pages/recover-batch — ASENKRON toplu onarim (paylasilan sozlesme C4).
 *
 * NEDEN VAR: uc her sayfanin kurtarmasini (GEO taramasi + Sonnet, sayfa basina
 * ~30-60 sn) tek HTTP isteginde sirayla bekliyordu; Cloudflare vekilinin
 * zaman sinirinda (varsayilan 125 sn) panel 524 alip "tekrar dene" diyor,
 * sunucu ise yazilari duzenlemeye devam ediyordu. Artik uygun her sayfa icin bir STUCK_PAGE_RECOVER
 * isi kuyruga girer ve cevap hemen doner:
 *   results[]: { stuckPageId, queued, jobId?, notProcessed?, reason?, error? }
 *   summary:   { queued, notProcessed, failed }
 *
 * Kurucu onlarca bagimlilik aliyor ve vitest dekorator metadata'si uretmiyor:
 * nesne prototipten kurulur (audit-controller-security.spec.ts ile ayni yontem).
 */
const { AuditController } = await import('./audit.controller.js');

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

const req = (id?: string) => ({ user: id ? { id } : undefined }) as any;

type Row = { id: string; siteId: string; status: string; articleId: string | null };

/** Sayfa tablosu + kuyruk sahtesi; stuckPage.findMany siteId ile suzer (baska sitenin kaydi donmez) */
function world(rows: Row[], opts: { siteOwner?: string | null } = {}) {
  const prisma = {
    site: { findUnique: vi.fn(async () => (opts.siteOwner === null ? null : { userId: opts.siteOwner ?? 'owner-1' })) },
    stuckPage: {
      findMany: vi.fn(async ({ where }: any) => rows
        .filter((r) => r.siteId === where.siteId && (where.id?.in as string[]).includes(r.id))
        .map((r) => ({ id: r.id, status: r.status }))),
    },
  };
  let n = 0;
  const jobs = { enqueue: vi.fn<(o: any) => Promise<unknown>>(async () => ({ dbJobId: `job-${++n}`, bullJobId: `b${n}` })) };
  return { prisma, jobs };
}

describe('queueStuckRecoveries — kuyruga alma (C4)', () => {
  it('uygun her sayfa icin STUCK_PAGE_RECOVER isi (site sahibine bagli, oturumdaki kullanici triggeredBy); cevap satirlari ve ozet', async () => {
    const w = world([
      { id: 'yeni', siteId: 's1', status: 'DETECTED', articleId: 'a1' },
      { id: 'tekrar', siteId: 's1', status: 'FAILED', articleId: null },
      { id: 'suruyor', siteId: 's1', status: 'RECOVERING', articleId: 'a2' },
      { id: 'duzeldi', siteId: 's1', status: 'RECOVERED', articleId: 'a3' },
      { id: 'baskasi', siteId: 's2', status: 'DETECTED', articleId: 'a4' },
    ]);
    const r = await queueStuckRecoveries(w, { siteId: 's1', stuckPageIds: ['yeni', 'tekrar', 'suruyor', 'duzeldi', 'baskasi', 'yok'], triggeredBy: 'user-9', max: 50 });
    expect(r.results).toEqual([
      { stuckPageId: 'yeni', id: 'yeni', queued: true, jobId: 'job-1' },
      { stuckPageId: 'tekrar', id: 'tekrar', queued: true, jobId: 'job-2' },
      // Durumu uygun olmayan sayfa denenmez (basarisizlik degil): nedeni satirda
      { stuckPageId: 'suruyor', id: 'suruyor', queued: false, notProcessed: true, reason: 'Bu sayfanın düzeltmesi zaten sürüyor; hiçbir şey değiştirilmedi.', code: 'status' },
      { stuckPageId: 'duzeldi', id: 'duzeldi', queued: false, notProcessed: true, reason: 'Sayfa zaten düzeltildi; ikinci bir düzeltme uygulanmadı.', code: 'status' },
      // Baska sitenin kaydi bu sitede yok sayilir (kiraci izolasyonu)
      { stuckPageId: 'baskasi', id: 'baskasi', queued: false, error: 'Takılı sayfa bulunamadı.' },
      { stuckPageId: 'yok', id: 'yok', queued: false, error: 'Takılı sayfa bulunamadı.' },
    ]);
    expect(r.summary).toEqual({ queued: 2, notProcessed: 2, failed: 2 });
    // Dusuk oncelik (paylasilan sozlesme D4): tek musterinin secimi digerlerinin isini bekletmez;
    // istek zamani: is kosmadan once sayfa islenirse ikinci yapay zeka turu yok
    expect(w.jobs.enqueue.mock.calls.map((c) => c[0])).toEqual([
      { type: 'STUCK_PAGE_RECOVER', userId: 'owner-1', siteId: 's1', payload: { stuckPageId: 'yeni', triggeredBy: 'user-9', requestedAt: expect.any(String) }, priority: STUCK_RECOVER_JOB_PRIORITY },
      { type: 'STUCK_PAGE_RECOVER', userId: 'owner-1', siteId: 's1', payload: { stuckPageId: 'tekrar', triggeredBy: 'user-9', requestedAt: expect.any(String) }, priority: STUCK_RECOVER_JOB_PRIORITY },
    ]);
    expect(w.prisma.stuckPage.findMany).toHaveBeenCalledWith({
      where: { siteId: 's1', id: { in: ['yeni', 'tekrar', 'suruyor', 'duzeldi', 'baskasi', 'yok'] } },
      select: { id: true, status: true, updatedAt: true, articleId: true, url: true },
    });
  });

  it('sinirin ustu denenmez: notProcessed ile isaretlenir ve ozette ayri sayilir; ayni kimlik tek satir', async () => {
    const ids = Array.from({ length: 52 }, (_, i) => `x${i}`);
    const w = world(ids.map((id) => ({ id, siteId: 's1', status: 'DETECTED', articleId: 'a' })));
    const r = await queueStuckRecoveries(w, { siteId: 's1', stuckPageIds: [...ids, 'x0', 'x1'], triggeredBy: 'u1', max: 50 });
    expect(r.results).toHaveLength(52);
    expect(r.results.slice(50).every((x) => x.notProcessed === true && x.queued === false && x.code === 'over_limit' && /en fazla 50 sayfa/.test(x.error ?? ''))).toBe(true);
    expect(r.summary).toEqual({ queued: 50, notProcessed: 2, failed: 0 });
    expect(w.jobs.enqueue).toHaveBeenCalledTimes(50);
  });

  it('kuyruk hatasi satiri basarisiz yapar, digerleri surer; site sahibi yoksa hicbir is acilmaz', async () => {
    const w = world([
      { id: 'a', siteId: 's1', status: 'DETECTED', articleId: 'x' },
      { id: 'b', siteId: 's1', status: 'DETECTED', articleId: 'y' },
    ]);
    w.jobs.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    const r = await queueStuckRecoveries(w, { siteId: 's1', stuckPageIds: ['a', 'b'], triggeredBy: 'u1', max: 50 });
    expect(r.results[0]).toEqual({ stuckPageId: 'a', id: 'a', queued: false, error: 'Düzeltme kuyruğa alınamadı; biraz sonra tekrar dene.' });
    expect(r.results[1]).toMatchObject({ stuckPageId: 'b', queued: true });

    const orphan = world([{ id: 'a', siteId: 's1', status: 'DETECTED', articleId: 'x' }], { siteOwner: null });
    const o = await queueStuckRecoveries(orphan, { siteId: 's1', stuckPageIds: ['a'], triggeredBy: 'u1', max: 50 });
    expect(o.results[0]).toMatchObject({ queued: false, error: 'Site bulunamadı; düzeltme kuyruğa alınamadı.' });
    expect(orphan.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('bos liste: DB okunmaz, is acilmaz', async () => {
    const w = world([]);
    expect(await queueStuckRecoveries(w, { siteId: 's1', stuckPageIds: [], triggeredBy: 'u1', max: 50 })).toEqual({ results: [], summary: { queued: 0, notProcessed: 0, failed: 0 } });
    expect(w.prisma.stuckPage.findMany).not.toHaveBeenCalled();
  });

  it('ozet: her satir tek kovaya girer', () => {
    expect(stuckBatchQueueSummary([
      { stuckPageId: 'a', id: 'a', queued: true },
      { stuckPageId: 'b', id: 'b', queued: false, notProcessed: true, reason: 'x' },
      { stuckPageId: 'c', id: 'c', queued: false, error: 'y' },
      { stuckPageId: 'd', id: 'd', queued: false, notProcessed: true, error: 'z' },
    ])).toEqual({ queued: 1, notProcessed: 2, failed: 1 });
  });
});

describe('recoverBatch — istek kurtarmayi BEKLEMEZ (R14)', () => {
  it('denetleyici kuyruga alma servisine devreder; oturum kimligi triggeredBy, sinir STUCK_BATCH_MAX; cevap { siteId, results, summary }', async () => {
    const ctl = Object.create(AuditController.prototype) as any;
    const out = { results: [{ stuckPageId: 'a', id: 'a', queued: true, jobId: 'j1' }], summary: { queued: 1, notProcessed: 0, failed: 0 } };
    ctl.stuckRecovery = { queueBatch: vi.fn(async () => out), recover: vi.fn() };
    ctl.stuckExternalRecovery = { recover: vi.fn() };
    const r = await ctl.recoverBatch('s9', { stuckPageIds: ['a'] }, req('user-3'));
    expect(r).toEqual({ siteId: 's9', ...out });
    expect(ctl.stuckRecovery.queueBatch).toHaveBeenCalledWith('s9', ['a'], 'user-3', STUCK_BATCH_MAX);
    // Kullanici yoksa denetim kaydinda 'manual'
    await ctl.recoverBatch('s9', { stuckPageIds: ['a'] }, req());
    expect(ctl.stuckRecovery.queueBatch).toHaveBeenLastCalledWith('s9', ['a'], 'manual', STUCK_BATCH_MAX);
    expect(ctl.stuckRecovery.recover).not.toHaveBeenCalled();
    expect(ctl.stuckExternalRecovery.recover).not.toHaveBeenCalled();
  });

  it('gercek servisle: 5 sayfalik secimde yapay zeka ve GEO taramasi istek icinde HIC calismaz, 5 is kuyruga girer', async () => {
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `sp${i + 1}`, siteId: 's1', status: 'DETECTED', articleId: `a${i + 1}` }));
    const w = world(rows);
    const geo = { runAudit: vi.fn() };
    const svc = new StuckPageRecoveryService(w.prisma as any, { notify: vi.fn() } as any, w.jobs as any, geo as any);
    const llm = vi.fn();
    (svc as any).anthropic = { messages: { create: llm } };
    const ctl = Object.create(AuditController.prototype) as any;
    ctl.stuckRecovery = svc;
    const r = await ctl.recoverBatch('s1', { stuckPageIds: rows.map((x) => x.id) }, req('user-9'));
    expect(r.summary).toEqual({ queued: 5, notProcessed: 0, failed: 0 });
    expect(r.results.map((x: any) => x.jobId)).toEqual(['job-1', 'job-2', 'job-3', 'job-4', 'job-5']);
    expect(llm).not.toHaveBeenCalled();
    expect(geo.runAudit).not.toHaveBeenCalled();
    expect(w.jobs.enqueue.mock.calls.every((c) => c[0].type === 'STUCK_PAGE_RECOVER' && c[0].payload.triggeredBy === 'user-9')).toBe(true);
  });
});
