import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StuckPageRecoveryService } from './stuck-page-recovery.service.js';
import { STUCK_REPUBLISH_PHASE } from './stuck-page-autopilot.js';
import {
  STUCK_AI_UNAVAILABLE, STUCK_ARTICLE_CHANGED_DURING_RECOVERY, STUCK_ARTICLE_EMPTY, STUCK_ARTICLE_LIVE_COPY_BEHIND, STUCK_ARTICLE_PENDING_VERSION,
  STUCK_ARTICLE_UNPUBLISHED_CHANGES, STUCK_EXTERNAL_PAGE_IN_ARTICLE_FLOW, STUCK_REVERT_ALREADY_DONE, STUCK_REVERT_ARTICLE_CHANGED,
  STUCK_REVERT_EXTERNAL,
} from './stuck-page-messages.js';
import { articleContentHash } from '../articles/republish-policy.js';

/**
 * Takili sayfa kurtarmasi.
 *  - Otopilot yaziyi degistirip ONAYSIZ yeniden yayinlar: yalniz plani kapsayan,
 *    akisi acik ve Tam otomatik sitede; kural is KOSARKEN denetlenir ve
 *    engellenen is hicbir sey degistirmez. Kullanicinin "AI Duzelt"i (manual)
 *    onay kuralina tabi degil: yayini o istedi.
 *  - G4: yeniden yayin yalniz yazinin YAYINDA oldugu hedefler yaziyi yerinde
 *    guncelleyebiliyorsa. Ghost gibi yalniz yeni yazi acan hedefte duzenleme
 *    ONERI olarak kalir.
 *  - F-C (R4): guncellenen kopya TAKILI ADRES olmali; yalniz yerinde yazim
 *    (updated / overwritten) "Düzeltildi" sayilir.
 *  - F-C (R5/R7): kayittaki metin canlida degilse (onay bekleyen yeniden
 *    yazim) hicbir sey yapilmaz; iki asama arasinda yazi degisirse yayin yok.
 *  - F-C (R12): geri alma yalniz yazinin metni hala duzeltmenin yayinladigi
 *    metinse; basarisiz geri alma tiklamadan onceki metne doner.
 *  - F-C (R13): sayfa atomik sahiplenilir; gozardi / duzeltilmis sayfaya
 *    kuyruktaki is dokunmaz.
 */

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

const BODY = '# Yazı\n\nEski cümle burada.\n\nİkinci paragraf.';
const PROPOSAL = {
  diagnosis: 'Entity eksik',
  edits: [{ type: 'sentence_replace', before: 'Eski cümle burada.', after: 'KDV beyanı ile güncellenmiş cümle.', reason: 'KDV', entityAdded: 'KDV beyanı' }],
  entitiesAdded: ['KDV beyanı'],
  paragraphAdded: null,
  entityScoreEstimate: 74,
};
const EDITED = BODY.replace('Eski cümle burada.', 'KDV beyanı ile güncellenmiş cümle.');
const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

type Target = { id: string; type: string; isActive: boolean };
const FTP: Target = { id: 't-ftp', type: 'FTP', isActive: true };
const WP: Target = { id: 't-wp', type: 'WORDPRESS_REST', isActive: true };
/** Yalniz yeni kayit acan hedef (I-1'den once ornek WordPress'ti; WordPress artik yerinde guncellenir) */
const GHOST: Target = { id: 't-ghost', type: 'GHOST', isActive: true };

/** Takili adres ve yazinin o adresteki kopyalari */
const STUCK_URL = 'https://site.com/blog/yazi.html';
const ADDRESS: Record<string, string> = {
  't-ftp': 'ftp://h/public_html/blog/yazi.html',
  't-wp': 'https://site.com/blog/yazi/',
  't-ghost': 'https://site.com/ghost/yazi',
};
const entry = (t: Target, over: Record<string, unknown> = {}) => ({
  targetId: t.id, targetType: t.type, ok: true, externalUrl: ADDRESS[t.id], updatedAt: iso(60), ...over,
});
const WP_LIVE = entry(WP, { externalId: '41' });

interface BuildOpts {
  site?: { autopilot: boolean; publishApprovalMode: string; plan: string } | null;
  targets?: Target[];
  publishedTo?: unknown;
  stuckStatus?: string;
  stuckUrl?: string;
  article?: Record<string, unknown>;
}

function pick(row: Record<string, any>, select?: Record<string, unknown>) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

function build(opts: BuildOpts = {}) {
  const site = opts.site === undefined ? { autopilot: true, publishApprovalMode: 'auto_publish', plan: 'PRO' } : opts.site;
  const db = {
    stuckPage: {
      id: 'sp1', siteId: 's1', articleId: 'a1' as string | null, url: opts.stuckUrl ?? STUCK_URL, title: 'Yazı',
      position: 7, impressions: 400, ctr: 0.01, topQueries: ['kdv beyanı'], status: opts.stuckStatus ?? 'DETECTED',
    } as Record<string, any>,
    article: {
      id: 'a1', status: 'PUBLISHED', slug: 'yazi', title: 'Yazı', metaTitle: null, metaDescription: null,
      bodyMd: BODY, bodyHtml: '<p>eski</p>', qaStatus: 'PASS' as string | null, qaReport: { blockers: [] } as unknown,
      publishedAt: new Date(Date.now() - 90 * DAY),
      publishedTo: opts.publishedTo === undefined ? [entry(FTP)] : opts.publishedTo,
      ...opts.article,
    } as Record<string, any>,
    targets: opts.targets ?? [FTP, WP, GHOST],
    recoveries: [] as Array<Record<string, any>>,
  };
  let seq = 0;
  const applyArticle = (data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) db.article[k] = v === Prisma.DbNull ? null : v;
  };
  const statusMatches = (want: unknown) => want === undefined
    || (typeof want === 'string' ? db.stuckPage.status === want : ((want as { in?: string[] }).in ?? []).includes(db.stuckPage.status));
  const prisma = {
    stuckPage: {
      findUnique: vi.fn(async ({ select }: any) => pick(db.stuckPage, select)),
      update: vi.fn(async ({ data }: any) => { Object.assign(db.stuckPage, data); return { ...db.stuckPage }; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== db.stuckPage.id || !statusMatches(where.status)) return { count: 0 };
        Object.assign(db.stuckPage, data);
        return { count: 1 };
      }),
    },
    site: {
      findUnique: vi.fn(async ({ select }: any) => {
        if (!site) return null;
        // Kural sorgusu ve bildirim sorgusu ayni tabloyu farkli alanlarla okur
        return select?.publishApprovalMode
          ? { autopilot: site.autopilot, publishApprovalMode: site.publishApprovalMode, user: { plan: site.plan } }
          : { name: 'Site', userId: 'u1' };
      }),
    },
    article: {
      findUnique: vi.fn(async ({ select }: any) => pick(db.article, select)),
      update: vi.fn(async ({ data }: any) => { applyArticle(data); return { ...db.article }; }),
      // Kosullu yazim: yalniz yazi hala beklenen metin / durumdaysa (tek UPDATE gibi)
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== db.article.id) return { count: 0 };
        if (where.bodyMd !== undefined && db.article.bodyMd !== where.bodyMd) return { count: 0 };
        if (where.status !== undefined && db.article.status !== where.status) return { count: 0 };
        applyArticle(data);
        return { count: 1 };
      }),
    },
    publishTarget: { findMany: vi.fn(async () => db.targets.map((t) => ({ ...t }))) },
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
      update: vi.fn(async ({ where, data }: any) => {
        const r = db.recoveries.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return { ...r };
      }),
      delete: vi.fn(async ({ where }: any) => {
        db.recoveries = db.recoveries.filter((x) => x.id !== where.id);
        return {};
      }),
    },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  const webhook = { notify: vi.fn(async () => undefined) };
  const jobs = { enqueue: vi.fn<(opts: any) => Promise<unknown>>(async () => ({ dbJobId: 'j', bullJobId: 'b' })) };
  const geo = { runAudit: vi.fn(async () => ({ score: 55 })) };
  const svc = new StuckPageRecoveryService(prisma as any, webhook as any, jobs as any, geo as any);
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(PROPOSAL) }] }));
  // LLM istemcisi sahte (ANTHROPIC_API_KEY ortamdan bagimsiz)
  (svc as any).anthropic = { messages: { create } };
  /** Canli kopyadaki metin (yayin fonksiyonu o anki bodyMd'yi yazar) */
  const live: { text: string | null } = { text: BODY };
  /**
   * Worker'in verdigi yayin fonksiyonu (PublisherService.publishArticle bicimi):
   * yerinde yazim — WordPress 'updated', dosya hedefi 'overwritten', adres kopyanin adresi
   */
  const publish = vi.fn(async (_articleId: string, targetIds: string[]) => {
    live.text = db.article.bodyMd;
    return targetIds.map((id) => ({
      targetId: id, targetType: db.targets.find((t) => t.id === id)?.type ?? 'FTP', ok: true,
      action: id === 't-wp' ? 'updated' : 'overwritten', externalUrl: ADDRESS[id],
    }));
  });
  const republishJob = () => {
    const calls = jobs.enqueue.mock.calls.map((c) => c[0]).filter((j) => j.type === 'STUCK_PAGE_RECOVER');
    return calls[calls.length - 1]?.payload;
  };
  return { svc, prisma, jobs, geo, create, webhook, db, publish, live, republishJob };
}

type Ctx = ReturnType<typeof build>;

const changedNothing = (c: Ctx) => {
  expect(c.create).not.toHaveBeenCalled();
  expect(c.geo.runAudit).not.toHaveBeenCalled();
  expect(c.prisma.stuckPage.update).not.toHaveBeenCalled();
  expect(c.prisma.stuckPage.updateMany).not.toHaveBeenCalled();
  expect(c.prisma.article.update).not.toHaveBeenCalled();
  expect(c.prisma.article.updateMany).not.toHaveBeenCalled();
  expect(c.prisma.stuckPageRecovery.create).not.toHaveBeenCalled();
  expect(c.jobs.enqueue).not.toHaveBeenCalled();
};

/** Elle duzeltilip yayina alinmis (RECOVERED) sayfa */
async function recovered(opts: BuildOpts = {}) {
  const c = build(opts);
  await c.svc.recover('sp1', { triggeredBy: 'manual' });
  await c.svc.republish(c.republishJob(), c.publish, { finalAttempt: false });
  expect(c.db.stuckPage.status).toBe('RECOVERED');
  expect(c.live.text).toBe(EDITED);
  c.jobs.enqueue.mockClear();
  c.publish.mockClear();
  return c;
}

describe('StuckPageRecoveryService.recover — otopilot kurali', () => {
  it('Yari otomatik: otopilot isi atlanir, yazi degismez ve yeniden yayinlanmaz', async () => {
    const c = build({ site: { autopilot: true, publishApprovalMode: 'manual_approve', plan: 'PRO' } });
    const r = await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    expect(r).toMatchObject({ success: false, skipped: true });
    expect(r.reason).toContain('Yarı otomatik');
    changedNothing(c);
  });

  it('alt plan (Takili Sayfalar Profesyonel ozelligi) ve durdurulmus akis da atlanir', async () => {
    for (const site of [
      { autopilot: true, publishApprovalMode: 'auto_publish', plan: 'STARTER' },
      { autopilot: false, publishApprovalMode: 'auto_publish', plan: 'PRO' },
      null,
    ]) {
      const c = build({ site });
      const r = await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
      expect(r, JSON.stringify(site)).toMatchObject({ success: false, skipped: true });
      changedNothing(c);
    }
  });

  it('kullanicinin "AI Duzelt"i Yari otomatikte de uygulanir (yayini kendisi istedi)', async () => {
    const c = build({ site: { autopilot: true, publishApprovalMode: 'manual_approve', plan: 'PRO' } });
    const r = await c.svc.recover('sp1', { triggeredBy: 'manual' });
    expect(r).toMatchObject({ success: true });
    expect(c.republishJob()).toMatchObject({ phase: STUCK_REPUBLISH_PHASE, mode: 'recover' });
    // Kural sorgusu yalniz otopilot isinde
    expect(c.prisma.site.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ publishApprovalMode: true }) }));
  });

  it('olcum penceresi: yazi son 30 gunde yayinlandiysa otopilot atlar (bayat GSC verisi); kullanici duzeltebilir', async () => {
    const recent = [entry(FTP, { updatedAt: iso(5) })];
    const auto = build({ publishedTo: recent });
    const r = await auto.svc.recover('sp1', { triggeredBy: 'autopilot' });
    expect(r).toMatchObject({ success: false, skipped: true });
    expect(r.reason).toMatch(/tarihinde yayınlandı ya da güncellendi; Search Console'un son 30 günlük verisi/);
    changedNothing(auto);

    const manual = build({ publishedTo: recent });
    expect(await manual.svc.recover('sp1', { triggeredBy: 'user-7' })).toMatchObject({ success: true });
  });
});

describe('G4 — yerinde guncelleyen hedef (FTP): duzenleme + yerinde yeniden yayin', () => {
  it('govde KOSULLU yazilir, QA durumu sifirlanir, sayfa RECOVERING kalir; PUBLISH_ARTICLE degil ikinci asama kuyruga girer', async () => {
    const c = build();
    const r = await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    expect(r).toMatchObject({ success: true, recoveryId: 'r1', editsCount: 1, needsRepublish: true, articleId: 'a1' });
    // QA durumu ayni yazimda sifirlanir; yazi hala okunan metinse yazilir
    expect(c.prisma.article.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', bodyMd: BODY, status: 'PUBLISHED' },
      data: { bodyMd: EDITED, qaStatus: null, qaReport: Prisma.DbNull },
    });
    expect(c.db.article).toMatchObject({ bodyMd: EDITED, qaStatus: null, qaReport: null });
    // Yayin henuz olmadi: RECOVERED YAZILMAZ
    expect(c.db.stuckPage.status).toBe('RECOVERING');
    expect(c.jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(c.jobs.enqueue.mock.calls[0][0]).toEqual({
      type: 'STUCK_PAGE_RECOVER', userId: 'u1', siteId: 's1',
      payload: {
        phase: STUCK_REPUBLISH_PHASE, stuckPageId: 'sp1', recoveryId: 'r1', articleId: 'a1', mode: 'recover',
        expectedContentHash: articleContentHash({ title: 'Yazı', metaTitle: null, metaDescription: null, bodyMd: EDITED }),
      },
    });
    expect(c.jobs.enqueue.mock.calls.some((x) => x[0].type === 'PUBLISH_ARTICLE')).toBe(false);
    // Webhook ve 30 gunluk olcum yayin basarilinca (republish)
    expect(c.webhook.notify).not.toHaveBeenCalled();
  });

  it('republish basarili: yalniz yazinin yayinda oldugu hedefe yayin, sonra RECOVERED + webhook + 30 gunluk olcum', async () => {
    const c = build();
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    const res = await c.svc.republish(c.republishJob(), c.publish, { finalAttempt: false });
    expect(res).toEqual({ ok: true, status: 'RECOVERED' });
    // Yayinciya silinmis yaziyi yeniden ACMA secenegi de gider (M-1 madde 3)
    expect(c.publish).toHaveBeenCalledWith('a1', ['t-ftp'], { recreateMissing: false, initiator: 'automation' });
    expect(c.db.stuckPage.status).toBe('RECOVERED');
    expect(c.webhook.notify).toHaveBeenCalledWith(expect.objectContaining({ event: 'stuck_page_recovered', url: STUCK_URL }));
    expect(c.jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      type: 'STUCK_PAGE_PERFORMANCE_CHECK', payload: { recoveryId: 'r1' }, jobId: 'stuck-perf-r1', delay: 30 * 24 * 60 * 60 * 1000,
    }));
    expect(c.db.article.bodyMd).toBe(EDITED);
  });

  it('QA engeli (kalici): yeniden denenmez; metin geri alinir, kayit silinir, sayfa FAILED (updatedAt acikca yazilir)', async () => {
    const c = build();
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    const publish = vi.fn(async () => { throw new Error('QA_BLOCKED: Yayin engellendi — kaynaksiz istatistik'); });
    const res = await c.svc.republish(c.republishJob(), publish, { finalAttempt: false });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(res.reason).toContain('kalite kontrolünden geçmedi');
    expect(c.db.stuckPage.status).toBe('FAILED');
    // Haftalik tarama basarisiz denemeden sonraki bekleme suresini updatedAt'ten sayar
    expect(c.db.stuckPage.updatedAt).toBeInstanceOf(Date);
    expect(c.prisma.stuckPage.updateMany).toHaveBeenCalledWith({ where: { id: 'sp1', status: 'RECOVERING' }, data: { status: 'FAILED', updatedAt: expect.any(Date) } });
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.db.recoveries).toEqual([]);
    expect(c.webhook.notify).not.toHaveBeenCalled();
  });

  it('gecici hata: son deneme degilse firlatir (BullMQ yeniden dener, durum degismez); son denemede FAILED + metin geri', async () => {
    const c = build();
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    const publish = vi.fn(async () => { throw new Error('ETIMEDOUT'); });
    await expect(c.svc.republish(c.republishJob(), publish, { finalAttempt: false })).rejects.toThrow('ETIMEDOUT');
    expect(c.db.stuckPage.status).toBe('RECOVERING');
    expect(c.db.article.bodyMd).toBe(EDITED);
    const res = await c.svc.republish(c.republishJob(), publish, { finalAttempt: true });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(c.db.article.bodyMd).toBe(BODY);
  });

  it('hedef yazamadi (ok:false): son deneme degilse yeniden denenir; son denemede FAILED', async () => {
    const c = build();
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    const publish = vi.fn(async () => [{ targetId: 't-ftp', targetType: 'FTP', ok: false, error: '530 Login incorrect' }]);
    await expect(c.svc.republish(c.republishJob(), publish, { finalAttempt: false })).rejects.toThrow(/530 Login incorrect/);
    const res = await c.svc.republish(c.republishJob(), publish, { finalAttempt: true });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(res.reason).toContain('530 Login incorrect');
    // Neden metni hedefin okunur adiyla baslar (FTP'nin etiketi de 'FTP')
    expect(res.reason).toContain('Yeniden yayın tamamlanamadı: FTP: 530 Login incorrect');
    expect(c.db.stuckPage.status).toBe('FAILED');
    expect(c.db.article.bodyMd).toBe(BODY);
  });

  it('neden metni hedefin okunur adini ve eylemin Turkcesini tasir (ham kod yok)', async () => {
    const c = build();
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    const wpFail = vi.fn(async () => [{ targetId: 't-ftp', targetType: 'WORDPRESS_REST', ok: false, error: 'WP REST 403' }]);
    const res = await c.svc.republish(c.republishJob(), wpFail, { finalAttempt: true });
    expect(res.reason).toContain('WordPress: WP REST 403');
    expect(res.reason).not.toContain('WORDPRESS_REST');
  });

  it('yayindan once hedef degistiyse (artik Ghost\'ta yayinda) yayin yapilmaz: FAILED + metin geri', async () => {
    const c = build();
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    c.db.article.publishedTo = [entry(GHOST)];
    const res = await c.svc.republish(c.republishJob(), c.publish, { finalAttempt: false });
    expect(c.publish).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(res.reason).toContain('ikinci bir kopyasını');
    expect(c.db.article.bodyMd).toBe(BODY);
  });

  it('sayfa bu arada gozardi edildiyse yayinlanmaz, metin geri alinir', async () => {
    const c = build();
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    c.db.stuckPage.status = 'IGNORED';
    const res = await c.svc.republish(c.republishJob(), c.publish, { finalAttempt: false });
    expect(res).toMatchObject({ skipped: true, reason: 'STATE_CHANGED' });
    expect(c.publish).not.toHaveBeenCalled();
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.db.stuckPage.status).toBe('IGNORED');
  });

  it('is daha once tamamlandiysa (durup yeniden kosan is) hicbir sey geri alinmaz', async () => {
    const c = build();
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    const job = c.republishJob();
    await c.svc.republish(job, c.publish, { finalAttempt: false });
    const again = await c.svc.republish(job, c.publish, { finalAttempt: false });
    expect(again).toMatchObject({ ok: true, skipped: true, reason: 'ALREADY_DONE' });
    expect(c.publish).toHaveBeenCalledTimes(1);
    expect(c.db.article.bodyMd).toBe(EDITED);
    expect(c.db.stuckPage.status).toBe('RECOVERED');
  });

  it('ikinci asama kuyruga girmezse: metin geri alinir, kayit silinir, sayfa FAILED', async () => {
    const c = build();
    c.jobs.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    const r = await c.svc.recover('sp1', { triggeredBy: 'manual' });
    expect(r).toMatchObject({ success: false });
    expect(r.reason).toContain('kuyruğa alınamadı');
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.db.recoveries).toEqual([]);
    expect(c.db.stuckPage.status).toBe('FAILED');
  });

  it('gecersiz ikinci asama verisi: hicbir sey yapilmaz', async () => {
    const c = build();
    expect(await c.svc.republish({ phase: 'republish', stuckPageId: 'sp1' }, c.publish, { finalAttempt: true })).toMatchObject({ skipped: true, reason: 'INVALID_PAYLOAD' });
    expect(c.publish).not.toHaveBeenCalled();
  });

  it('yapay zeka bos sonuc ya da birebir bulunamayan cumleler: FAILED, nedenler Turkce', async () => {
    const empty = build();
    empty.create.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ ...PROPOSAL, edits: [] }) }] } as any);
    expect(await empty.svc.recover('sp1', { triggeredBy: 'manual' })).toEqual({ success: false, reason: 'AI bu sayfa için değişiklik önerisi üretemedi.' });
    expect(empty.db.stuckPage.status).toBe('FAILED');
    const miss = build();
    miss.create.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ ...PROPOSAL, edits: [{ type: 'sentence_replace', before: 'Yazıda olmayan cümle.', after: 'x', reason: 'y' }] }) }] } as any);
    expect(await miss.svc.recover('sp1', { triggeredBy: 'manual' })).toEqual({ success: false, reason: 'Önerilen cümlelerin hiçbiri yazıda birebir bulunamadı; değişiklik yapılmadı.' });
    expect(miss.db.article.bodyMd).toBe(BODY);
  });
});

describe('G4 — yalniz yeni yazi acan hedef (Ghost): kopya acilmaz, oneri kaydedilir', () => {
  it('otopilot: LLM cagrilmadan atlanir, hicbir sey degismez', async () => {
    const c = build({ publishedTo: [entry(GHOST)] });
    const r = await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    expect(r).toMatchObject({ success: false, skipped: true });
    expect(r.reason).toContain('Ghost');
    expect(r.reason).toContain('ikinci bir kopyasını');
    changedNothing(c);
  });

  it('"AI Duzelt": oneri kaydedilir; yazi DEGISMEZ, yayin kuyruga girmez, sayfa "Tespit edildi"de kalir', async () => {
    const c = build({ publishedTo: [entry(GHOST)] });
    const r = await c.svc.recover('sp1', { triggeredBy: 'user-7' });
    expect(r).toMatchObject({ success: false, manual: true, recoveryId: 'r1', editsCount: 1 });
    expect(r.reason).toContain('Öneriler kaydedildi');
    expect(c.prisma.article.update).not.toHaveBeenCalled();
    expect(c.prisma.article.updateMany).not.toHaveBeenCalled();
    expect(c.db.article).toMatchObject({ bodyMd: BODY, qaStatus: 'PASS' });
    expect(c.jobs.enqueue).not.toHaveBeenCalled();
    expect(c.webhook.notify).not.toHaveBeenCalled();
    expect(c.db.stuckPage.status).toBe('DETECTED');
    // Oneri denetim kaydinda: oncesi / onerilen metin ve cumle degisiklikleri
    expect(c.db.recoveries[0]).toMatchObject({ bodyMdBefore: BODY, bodyMdAfter: EDITED, appliedBy: 'user-7' });
  });

  it('yazi hem FTP hem Ghost\'ta yayindaysa da oneri (Ghost kopyasi guncellenemez)', async () => {
    const c = build({ publishedTo: [entry(FTP), entry(GHOST)] });
    const r = await c.svc.recover('sp1', { triggeredBy: 'manual' });
    expect(r).toMatchObject({ manual: true });
    expect(c.db.article.bodyMd).toBe(BODY);
  });

  it('yayin kaydi yok ya da hedefi bilinmiyor / silinmis / pasif: oneri', async () => {
    for (const [publishedTo, targets, text] of [
      [[], [FTP], 'kayıtlı değil'],
      [[{ url: STUCK_URL, externalId: '5' }], [FTP], 'kayıtlı değil'],
      [[entry(FTP)], [], 'silinmiş ya da pasif'],
      [[entry(FTP)], [{ ...FTP, isActive: false }], 'silinmiş ya da pasif'],
    ] as Array<[unknown, Target[], string]>) {
      const c = build({ publishedTo, targets });
      const r = await c.svc.recover('sp1', { triggeredBy: 'manual' });
      expect(r, JSON.stringify(publishedTo)).toMatchObject({ manual: true });
      expect(r.reason).toContain(text);
      expect(c.db.article.bodyMd).toBe(BODY);
      expect(c.jobs.enqueue).not.toHaveBeenCalled();
    }
  });
});

describe('R4 — guncellenecek kopya takili adresin kendisi olmali', () => {
  /** Eski yayinci: her yeniden yayin yeni yazi (/yazi-2/, id 99) acti ve kaydi yalniz o kopyayla ezdi */
  const LEGACY_COPY = entry(WP, { externalId: '99', externalUrl: 'https://site.com/yazi-2/' });
  const ORIGINAL_URL = 'https://site.com/yazi/';

  it('otopilot: kayit eski /yazi-2/ kopyasini gosteriyor, takili sayfa /yazi/: yapay zeka cagrilmadan atlanir', async () => {
    const c = build({ publishedTo: [LEGACY_COPY], stuckUrl: ORIGINAL_URL });
    const r = await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    expect(r).toMatchObject({ success: false, skipped: true });
    expect(r.reason).toContain('kayıtlı: https://site.com/yazi-2/');
    changedNothing(c);
  });

  it('"AI Duzelt": oneri kaydedilir, yazi ve /yazi-2/ kopyasi degismez, sayfa "Düzeltildi" olmaz', async () => {
    const c = build({ publishedTo: [LEGACY_COPY], stuckUrl: ORIGINAL_URL });
    const r = await c.svc.recover('sp1', { triggeredBy: 'user-7' });
    expect(r).toMatchObject({ success: false, manual: true, recoveryId: 'r1' });
    expect(r.reason).toMatch(/eşleşmiyor.*Öneriler kaydedildi/);
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.jobs.enqueue).not.toHaveBeenCalled();
    expect(c.db.stuckPage.status).toBe('DETECTED');
  });

  it('ikinci asama: yayinci kaydi silinmis bulup YENI kayit acti (recreated): RECOVERED degil FAILED; webhook ve 30 gunluk olcum yok', async () => {
    const c = build({ publishedTo: [WP_LIVE], stuckUrl: ADDRESS['t-wp'] });
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    const recreated = vi.fn(async (_a: string, ids: string[]) => ids.map((id) => ({
      targetId: id, targetType: 'WORDPRESS_REST', ok: true, action: 'recreated', externalUrl: 'https://site.com/blog/yazi-2/', externalId: '150',
    })));
    const res = await c.svc.republish(c.republishJob(), recreated, { finalAttempt: false });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(res.reason).toContain('yeni bir kayıt olarak yeniden oluşturdu (https://site.com/blog/yazi-2/)');
    expect(recreated).toHaveBeenCalledTimes(1);
    expect(c.db.stuckPage.status).toBe('FAILED');
    expect(c.webhook.notify).not.toHaveBeenCalled();
    expect(c.jobs.enqueue.mock.calls.some((x) => x[0].type === 'STUCK_PAGE_PERFORMANCE_CHECK')).toBe(false);
    // Yeni kayit sitede: duzenlenen metin bir kopyada canli — kayit ve metin kalir
    expect(c.db.recoveries).toHaveLength(1);
    expect(c.db.article.bodyMd).toBe(EDITED);
  });

  it('M-1: yayinci silinmis yaziyi yeniden ACMADI (live_entry_missing): kalici — son deneme olmasa da FAILED; neden sonuca gider, metin geri, kayit silinir', async () => {
    const c = build({ publishedTo: [WP_LIVE], stuckUrl: ADDRESS['t-wp'] });
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    // PublisherService'in recreateMissing:false ile dondugu sonuc (republish-policy publishSkipText)
    const missing = vi.fn(async (_a: string, ids: string[]) => ids.map((id) => ({
      targetId: id, targetType: 'WORDPRESS_REST', ok: false, skipped: 'live_entry_missing',
      error: 'Bu yazı WordPress üzerinde artık bulunamadı (silinmiş ya da site taşınmış olabilir). Silinen yazı bu yayında yeniden oluşturulmadı; hiçbir şey yazılmadı ve kopya açılmadı.',
    })));
    const res = await c.svc.republish(c.republishJob(), missing, { finalAttempt: false });
    expect(missing).toHaveBeenCalledTimes(1);
    expect(missing).toHaveBeenCalledWith('a1', ['t-wp'], { recreateMissing: false, initiator: 'automation' });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(res.reason).toContain('artık bulunamadı');
    expect(res.reason).toContain('yeniden oluşturulmadı');
    expect(c.db.stuckPage.status).toBe('FAILED');
    // Sitede hicbir sey degismedi: duzenleme geri alinir, "Son onarim" diye kayit kalmaz
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.db.recoveries).toHaveLength(0);
    expect(c.webhook.notify).not.toHaveBeenCalled();
    expect(c.jobs.enqueue.mock.calls.some((x) => x[0].type === 'STUCK_PAGE_PERFORMANCE_CHECK')).toBe(false);
  });

  it('ikinci asama: yerinde yazildi ama donen adres takili adres degil (kayitli kimlik baska yaziya gitti): FAILED', async () => {
    const c = build({ publishedTo: [WP_LIVE], stuckUrl: ADDRESS['t-wp'] });
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    const elsewhere = vi.fn(async (_a: string, ids: string[]) => ids.map((id) => ({ targetId: id, targetType: 'WORDPRESS_REST', ok: true, action: 'updated', externalUrl: 'https://site.com/baska-yazi/' })));
    const res = await c.svc.republish(c.republishJob(), elsewhere, { finalAttempt: false });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(res.reason).toContain('takılı adrese değil başka bir adrese yazıldı (https://site.com/baska-yazi/)');
    expect(c.webhook.notify).not.toHaveBeenCalled();
  });

  it('ikinci asama: eylemi bilinmeyen sonuc da yerinde duzeltme sayilmaz', async () => {
    const c = build();
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    const noAction = vi.fn(async (_a: string, ids: string[]) => ids.map((id) => ({ targetId: id, targetType: 'FTP', ok: true })));
    const res = await c.svc.republish(c.republishJob(), noAction, { finalAttempt: false });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(res.reason).toContain('yerinde güncellemedi');
    expect(res.reason).toContain('FTP: sonuç bilinmiyor');
    expect(c.db.stuckPage.status).toBe('FAILED');
  });
});

describe('R5/R7 — yalniz canlidaki metin duzeltilir (onay bekleyen yeniden yazim onaysiz yayinlanmaz)', () => {
  const REWRITE = '# Yeni açı\n\nEski cümle burada.\n\nTamamen yeniden yazılmış, onay bekleyen içerik.';

  it('READY_TO_PUBLISH / REVIZE_NEEDED / izi canli kopyayla tutmayan PUBLISHED: hem "AI Düzelt" hem otopilot hicbir sey yapmaz; neden NEDENE gore (S8)', async () => {
    for (const [article, reason] of [
      // Pivot PASS: kayit yeniden yazimla ezildi, canli metin yalniz liveSnapshot'ta — GERCEKTEN bekleyen surum
      [{ status: 'READY_TO_PUBLISH', title: 'Yeni Başlık: Tamamen Farklı Açı', bodyMd: REWRITE, agentOutputs: { liveSnapshot: { bodyMd: BODY, slug: 'yazi' } } }, STUCK_ARTICLE_PENDING_VERSION],
      // Kapali dongu: editor REVIZE dedi, taslak kayitta
      [{ status: 'REVIZE_NEEDED', bodyMd: REWRITE }, STUCK_ARTICLE_PENDING_VERSION],
      // Kayit metninin izi canli kopyanin izinden farkli, kopya isaretsiz: yayinlanmamis degisiklik (capraz baglanti / snippet)
      [{ publishedTo: [entry(FTP, { contentHash: 'canlidaki-metnin-izi' })] }, STUCK_ARTICLE_UNPUBLISHED_CHANGES],
      // Son metin kopyaya yazilamadi (yayinci "elle guncelleme bekliyor" isaretledi): onay bekleyen bir sey YOK
      [{ publishedTo: [entry(FTP, { contentHash: 'canlidaki-metnin-izi', manualUpdatePending: true })] }, STUCK_ARTICLE_LIVE_COPY_BEHIND],
    ] as Array<[Record<string, unknown>, string]>) {
      for (const triggeredBy of ['user-7', 'autopilot']) {
        const c = build({ article });
        const r = await c.svc.recover('sp1', { triggeredBy });
        expect(r, `${article.status ?? 'PUBLISHED'} ${triggeredBy}`).toEqual({ success: false, skipped: true, reason });
        changedNothing(c);
        expect(c.db.stuckPage.status).toBe('DETECTED');
      }
    }
    // "onaylayin ya da reddedin" yok: reddetme eylemi bulunmuyor, onaylanacak surum de yoksa yanlis
    for (const text of [STUCK_ARTICLE_PENDING_VERSION, STUCK_ARTICLE_UNPUBLISHED_CHANGES, STUCK_ARTICLE_LIVE_COPY_BEHIND]) {
      expect(text).not.toMatch(/reddedin|onaylayın/);
    }
  });

  it('ikinci asama: iki asama arasinda onay bekleyen yeniden yazim kaydi ezdiyse yayin yok, sayfa "Tespit edildi"ye doner', async () => {
    const c = build();
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    // Pivot pazartesi sabahi yeniden yazdi ve onaya birakti
    Object.assign(c.db.article, { status: 'READY_TO_PUBLISH', bodyMd: REWRITE, title: 'Yeni Başlık' });
    const res = await c.svc.republish(c.republishJob(), c.publish, { finalAttempt: false });
    expect(res).toEqual({ ok: false, skipped: true, reason: 'ARTICLE_CHANGED' });
    expect(c.publish).not.toHaveBeenCalled();
    expect(c.live.text).toBe(BODY);
    // Yeniden yazima dokunulmaz; uygulanmamis duzeltme kaydi kalmaz
    expect(c.db.article.bodyMd).toBe(REWRITE);
    expect(c.db.recoveries).toEqual([]);
    expect(c.db.stuckPage.status).toBe('DETECTED');
  });

  it('ikinci asama: govde ayni ama baslik / meta degistiyse (icerik izi) yayin yok, duzenleme geri alinir', async () => {
    const c = build();
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    c.db.article.metaTitle = 'Onay bekleyen yeni meta başlık';
    const res = await c.svc.republish(c.republishJob(), c.publish, { finalAttempt: false });
    expect(res).toMatchObject({ skipped: true, reason: 'ARTICLE_CHANGED' });
    expect(c.publish).not.toHaveBeenCalled();
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.db.stuckPage.status).toBe('DETECTED');
  });

  it('duzenleme hazirlanirken (yapay zeka cagrisi surerken) yazi degistiyse ezilmez: kayit yok, yayin yok, sayfa onceki durumunda', async () => {
    const c = build({ stuckStatus: 'FAILED' });
    c.create.mockImplementationOnce(async () => {
      c.db.article.bodyMd = `${BODY}\n\nKullanıcının o sırada eklediği paragraf.`;
      return { content: [{ type: 'text', text: JSON.stringify(PROPOSAL) }] };
    });
    const r = await c.svc.recover('sp1', { triggeredBy: 'user-7' });
    expect(r).toEqual({ success: false, skipped: true, reason: STUCK_ARTICLE_CHANGED_DURING_RECOVERY });
    expect(c.db.article.bodyMd).toContain('Kullanıcının o sırada eklediği paragraf.');
    expect(c.db.recoveries).toEqual([]);
    expect(c.jobs.enqueue).not.toHaveBeenCalled();
    expect(c.db.stuckPage.status).toBe('FAILED');
  });
});

describe('C2 — musteri yaziyi sitede duzenlediyse (live_entry_edited / live_entry_mismatch) duzenleme oneri olur', () => {
  it('recover: yayinci yazmadi → metin geri, kayit ONERI olarak kalir, sayfa "Tespit edildi"; yeniden denenmez, webhook yok', async () => {
    const c = build({ publishedTo: [WP_LIVE], stuckUrl: ADDRESS['t-wp'] });
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    const edited = vi.fn(async () => [{
      targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: false, skipped: 'live_entry_edited',
      error: 'Yazı WordPress\'te düzenlenmiş; değişikliklerinizin üzerine yazılmadı.',
    }]);
    const res = await c.svc.republish(c.republishJob(), edited, { finalAttempt: false });
    expect(res).toMatchObject({ ok: false, manual: true, status: 'DETECTED' });
    expect(res.reason).toMatch(/^Yazı WordPress'te düzenlenmiş; değişikliklerinizin üzerine yazılmadı\. Düzenleme öneri olarak kaydedildi, yazı değiştirilmedi/);
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.db.recoveries).toHaveLength(1);
    expect(c.db.recoveries[0]).toMatchObject({ bodyMdBefore: BODY, bodyMdAfter: EDITED });
    expect(c.db.stuckPage.status).toBe('DETECTED');
    expect(c.webhook.notify).not.toHaveBeenCalled();
  });

  it('kimlik baska yaziyi gosteriyor (live_entry_mismatch), yayinci metni yoksa: Turkce yedek neden', async () => {
    const c = build({ publishedTo: [WP_LIVE], stuckUrl: ADDRESS['t-wp'] });
    await c.svc.recover('sp1', { triggeredBy: 'user-7' });
    const mismatch = vi.fn(async () => [{ targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: false, skipped: 'live_entry_mismatch' }]);
    const res = await c.svc.republish(c.republishJob(), mismatch, { finalAttempt: false });
    expect(res).toMatchObject({ ok: false, manual: true, status: 'DETECTED' });
    expect(res.reason).toContain('Kayıtlı yazı kimliği artık sitende başka bir yazıyı gösteriyor');
    expect(c.db.article.bodyMd).toBe(BODY);
  });

  it('kopya onceki takili sayfa yayininda sitede degismis bulunduysa (remoteEditSkip) otopilot yapay zeka cagirmaz; neden dogru', async () => {
    // RanksUp'in son yazdigi metin kayittaki metin (iz ayni); kopya sonra WordPress'te degisti
    const hash = articleContentHash({ title: 'Yazı', metaTitle: null, metaDescription: null, bodyMd: BODY });
    const edited = build({ publishedTo: [{ ...WP_LIVE, contentHash: hash, remoteEditSkip: 'live_entry_edited', remoteEditSeenAt: iso(3) }], stuckUrl: ADDRESS['t-wp'] });
    const r = await edited.svc.recover('sp1', { triggeredBy: 'autopilot' });
    expect(r).toMatchObject({ success: false, skipped: true });
    expect(r.reason).toContain('sitende değiştirilmiş; RanksUp sitedeki değişikliklerin üzerine kendiliğinden yazmaz');
    changedNothing(edited);

    const mismatch = build({ publishedTo: [{ ...WP_LIVE, contentHash: hash, remoteEditSkip: 'live_entry_mismatch', remoteEditSeenAt: iso(3) }], stuckUrl: ADDRESS['t-wp'] });
    const m = await mismatch.svc.recover('sp1', { triggeredBy: 'autopilot' });
    expect(m.reason).toContain('kayıtlı kimliği sitende (WordPress) artık başka bir yazıyı gösteriyor');
    changedNothing(mismatch);
  });

  it('kopya "elle guncelleme bekliyor" isaretliyse (son metin yazilmadi) otopilot yapay zeka cagirmaz; "elle degistirilmis" denmez', async () => {
    // FTP kopyasi son metni tasiyor (kayit metni canlida); WordPress kopyasi son yayinda yazilmadi
    const hash = articleContentHash({ title: 'Yazı', metaTitle: null, metaDescription: null, bodyMd: BODY });
    const c = build({ publishedTo: [entry(FTP, { contentHash: hash }), { ...WP_LIVE, contentHash: 'eski-metnin-izi', manualUpdatePending: true }] });
    const r = await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    expect(r).toMatchObject({ success: false, skipped: true });
    expect(r.reason).toContain('Yazının sitendeki kopyasına (WordPress) son metin yazılmadı');
    expect(r.reason).not.toContain('değiştirilmiş');
    changedNothing(c);
  });

  it('geri alma: yayinci musterinin duzenlemesi yuzunden yazmadi → geri alma geri alinir, duzeltme yerinde kalir', async () => {
    const c = await recovered({ publishedTo: [WP_LIVE], stuckUrl: ADDRESS['t-wp'] });
    await c.svc.revert('s1', 'r1', 'u9');
    const edited = vi.fn(async () => [{ targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: false, skipped: 'live_entry_edited' }]);
    const res = await c.svc.republish(c.republishJob(), edited, { finalAttempt: false });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(res.reason).toContain('Geri alma uygulanmadı');
    expect(c.db.stuckPage.status).toBe('RECOVERED');
    expect(c.db.recoveries[0]).toMatchObject({ revertedAt: null });
    expect(c.db.article.bodyMd).toBe(EDITED);
  });
});

describe('R13 — sayfa durumu is kosarken denetlenir, sahiplenme atomik', () => {
  it('kuyruktaki otopilot isi: gozardi edilmis, duzeltilmis, islemdeki, geri alinmis ya da basarisiz sayfaya dokunmaz', async () => {
    for (const status of ['IGNORED', 'RECOVERED', 'RECOVERING', 'REVERTED', 'FAILED']) {
      const c = build({ stuckStatus: status });
      const r = await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
      expect(r, status).toMatchObject({ success: false, skipped: true });
      expect(r.reason, status).toMatch(/[ğüşıöçĞÜŞİÖÇ]/);
      changedNothing(c);
      expect(c.db.stuckPage.status).toBe(status);
    }
  });

  it('"AI Düzelt": "Başarısız" sayfa yeniden denenir; duzeltilmis ya da gozardi edilmis sayfaya ikinci tur uygulanmaz', async () => {
    expect(await build({ stuckStatus: 'FAILED' }).svc.recover('sp1', { triggeredBy: 'user-7' })).toMatchObject({ success: true });
    for (const status of ['RECOVERED', 'IGNORED', 'RECOVERING']) {
      const c = build({ stuckStatus: status });
      const r = await c.svc.recover('sp1', { triggeredBy: 'user-7' });
      expect(r, status).toMatchObject({ success: false, skipped: true });
      changedNothing(c);
    }
  });

  it('duzeltilmis sayfaya kuyrukta bekleyen otopilot isi ikinci bir AI turu yigmaz (ilk tur geri alinabilir kalir)', async () => {
    const c = await recovered();
    const r = await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    expect(r).toMatchObject({ success: false, skipped: true, reason: 'Sayfa zaten düzeltildi; ikinci bir düzeltme uygulanmadı.' });
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(c.db.recoveries).toHaveLength(1);
    await c.svc.revert('s1', 'r1', 'u9');
    expect(c.db.article.bodyMd).toBe(BODY);
  });

  it('ayni anda iki is (toplu istek tekrari + kuyruktaki is): yalniz biri sahiplenir, yapay zeka bir kez cagrilir', async () => {
    const c = build();
    const [a, b] = await Promise.all([
      c.svc.recover('sp1', { triggeredBy: 'user-7' }),
      c.svc.recover('sp1', { triggeredBy: 'user-7' }),
    ]);
    expect([a.success, b.success].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.success)).toMatchObject({ skipped: true, reason: 'Bu sayfanın düzeltmesi zaten sürüyor; hiçbir şey değiştirilmedi.' });
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(c.db.recoveries).toHaveLength(1);
    expect(c.db.article.bodyMd).toBe(EDITED);
  });

  it('kuyruktaki is calisirken sayfa gozardi edilirse sonuc ezilmez (FAILED / DETECTED yazilmaz)', async () => {
    const c = build();
    c.create.mockImplementationOnce(async () => {
      c.db.stuckPage.status = 'IGNORED';
      return { content: [{ type: 'text', text: JSON.stringify({ ...PROPOSAL, edits: [] }) }] };
    });
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    expect(c.db.stuckPage.status).toBe('IGNORED');
  });
});

describe('G4 + R12 — geri alma', () => {
  it('yerinde guncelleyen hedef: eski metin + QA sifirlama, REVERTED, ikinci asama (revert) kuyrukta — PUBLISH_ARTICLE yok', async () => {
    const c = await recovered();
    const r = await c.svc.revert('s1', 'r1', 'u9');
    expect(r).toEqual({ needsRepublish: true, articleId: 'a1' });
    expect(c.db.article).toMatchObject({ bodyMd: BODY, qaStatus: null });
    // Yazim kosullu: yazi hala duzeltmenin metniyse
    expect(c.prisma.article.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', bodyMd: EDITED, status: 'PUBLISHED' },
      data: { bodyMd: BODY, qaStatus: null, qaReport: Prisma.DbNull },
    });
    expect(c.db.stuckPage.status).toBe('REVERTED');
    expect(c.db.recoveries[0]).toMatchObject({ revertedBy: 'u9' });
    expect(c.jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(c.jobs.enqueue.mock.calls[0][0]).toMatchObject({
      type: 'STUCK_PAGE_RECOVER', payload: { phase: STUCK_REPUBLISH_PHASE, recoveryId: 'r1', mode: 'revert', articleId: 'a1', stuckPageId: 'sp1' },
    });
    const res = await c.svc.republish(c.jobs.enqueue.mock.calls[0][0].payload, c.publish, { finalAttempt: false });
    expect(res).toEqual({ ok: true, status: 'REVERTED' });
    // Geri alma yayini da silinmis yaziyi yeniden acmaz (ayni cagri)
    expect(c.publish).toHaveBeenCalledWith('a1', ['t-ftp'], { recreateMissing: false, initiator: 'automation' });
    expect(c.live.text).toBe(BODY);
  });

  it('R12: duzeltmeden sonra yazi degistiyse (capraz link, onaylanan yeniden yazim) geri alma reddedilir; kayit, canli kopya ve durum degismez', async () => {
    const c = await recovered();
    const LATER = `${EDITED}\n\n## Ayrıca bakınız\n\n- [Yeni yazı](https://site.com/yeni)\n`;
    c.db.article.bodyMd = LATER;
    c.live.text = LATER;
    const err = await c.svc.revert('s1', 'r1', 'u9').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(STUCK_REVERT_ARTICLE_CHANGED);
    expect(c.db.article.bodyMd).toBe(LATER);
    expect(c.live.text).toBe(LATER);
    expect(c.db.stuckPage.status).toBe('RECOVERED');
    expect(c.db.recoveries[0]).toMatchObject({ revertedAt: null });
    expect(c.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('R12: kayitta onay bekleyen surum varsa geri alma reddedilir (yeniden yayin onu da yayinlardi)', async () => {
    const c = await recovered();
    c.db.article.status = 'READY_TO_PUBLISH';
    await expect(c.svc.revert('s1', 'r1', 'u9')).rejects.toThrow(STUCK_ARTICLE_PENDING_VERSION);
    expect(c.db.article.bodyMd).toBe(EDITED);
    expect(c.db.stuckPage.status).toBe('RECOVERED');
  });

  it('R12: geri alma yayini basarisiz (QA engeli ilk denemede): yazi TIKLAMADAN ONCEKI metne doner, sayfa RECOVERED', async () => {
    const c = await recovered();
    await c.svc.revert('s1', 'r1', 'u9');
    const blocked = vi.fn(async () => { throw new Error('QA_BLOCKED: Yayin engellendi — {{fiyat}}'); });
    const res = await c.svc.republish(c.jobs.enqueue.mock.calls[0][0].payload, blocked, { finalAttempt: false });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(c.db.stuckPage.status).toBe('RECOVERED');
    expect(c.db.recoveries[0]).toMatchObject({ revertedAt: null, revertedBy: null });
    expect(c.db.article.bodyMd).toBe(EDITED);
    expect(c.live.text).toBe(EDITED);
  });

  it('R12: geri alma tiklandiktan sonra, yayindan once yazi degistiyse eski metin yayinlanmaz; geri alma geri alinir, yeni metin ezilmez', async () => {
    const c = await recovered();
    await c.svc.revert('s1', 'r1', 'u9');
    const NEWER = `${BODY}\n\nGeri almadan sonra eklenen bağlantı.`;
    c.db.article.bodyMd = NEWER;
    const res = await c.svc.republish(c.jobs.enqueue.mock.calls[0][0].payload, c.publish, { finalAttempt: false });
    expect(res).toEqual({ ok: false, skipped: true, reason: 'ARTICLE_CHANGED' });
    expect(c.publish).not.toHaveBeenCalled();
    expect(c.db.article.bodyMd).toBe(NEWER);
    expect(c.db.stuckPage.status).toBe('RECOVERED');
    expect(c.live.text).toBe(EDITED);
  });

  it('geri alma yayini son denemede de olmazsa geri alma geri alinir: sayfa RECOVERED, metin duzeltilmis hal', async () => {
    const c = await recovered();
    await c.svc.revert('s1', 'r1', 'u9');
    const payload = c.jobs.enqueue.mock.calls[0][0].payload;
    const publish = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const res = await c.svc.republish(payload, publish, { finalAttempt: true });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(c.db.stuckPage.status).toBe('RECOVERED');
    expect(c.db.recoveries[0]).toMatchObject({ revertedAt: null, revertedBy: null });
    expect(c.db.article.bodyMd).toBe(EDITED);
  });

  it('yazi artik yalniz Ghost\'ta yayindaysa geri alma reddedilir, hicbir sey degismez', async () => {
    const c = await recovered();
    c.db.article.publishedTo = [entry(GHOST)];
    await expect(c.svc.revert('s1', 'r1', 'u9')).rejects.toThrow(/ikinci bir kopyasını/);
    expect(c.db.article.bodyMd).toBe(EDITED);
    expect(c.db.stuckPage.status).toBe('RECOVERED');
    expect(c.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('oneri kaydi (yayina alinmamis) ve eski kayit geri alinamaz', async () => {
    const proposal = build({ publishedTo: [entry(GHOST)] });
    await proposal.svc.recover('sp1', { triggeredBy: 'manual' });
    await expect(proposal.svc.revert('s1', 'r1', 'u9')).rejects.toThrow(/öneri/);
    expect(proposal.db.article.bodyMd).toBe(BODY);

    const c = await recovered();
    // Ayni sayfaya sonradan bir kayit daha acildi: eski kayit geri alinamaz
    c.db.recoveries.push({ id: 'r9', stuckPageId: 'sp1', appliedAt: new Date(Date.now() + 10_000), revertedAt: null, bodyMdBefore: 'x', bodyMdAfter: 'y' });
    await expect(c.svc.revert('s1', 'r1', 'u9')).rejects.toThrow(/son düzeltmesi/);
  });

  it('geri alma yayini kuyruga girmezse hicbir sey degismez', async () => {
    const c = await recovered();
    c.jobs.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    await expect(c.svc.revert('s1', 'r1', 'u9')).rejects.toThrow(/kuyruğa alınamadı/);
    expect(c.db.article.bodyMd).toBe(EDITED);
    expect(c.db.stuckPage.status).toBe('RECOVERED');
    expect(c.db.recoveries[0]).toMatchObject({ revertedAt: null });
  });

  it('K7: zaten geri alinmis kayit ve RanksUp disi sayfanin kaydi icin Turkce neden', async () => {
    const c = await recovered();
    c.db.recoveries[0].revertedAt = new Date();
    await expect(c.svc.revert('s1', 'r1', 'u9')).rejects.toThrow(STUCK_REVERT_ALREADY_DONE);
    c.db.recoveries[0].revertedAt = null;
    c.db.stuckPage.articleId = null;
    await expect(c.svc.revert('s1', 'r1', 'u9')).rejects.toThrow(STUCK_REVERT_EXTERNAL);
  });
});

describe('I-1 — WordPress yazisi yerinde guncellenir (adaptor update)', () => {
  /** Yayinci sonucu: WordPress yazisi yerinde guncellendi, canli baglanti takili adres */
  const updated = vi.fn(async (_a: string, ids: string[]) => ids.map((id) => ({ targetId: id, targetType: 'WORDPRESS_REST', ok: true, action: 'updated', externalUrl: ADDRESS[id] })));

  it('otopilot WordPress\'te takili adresteki yaziyi duzeltir; yeniden yayin yalniz o yaziya, basarida RECOVERED', async () => {
    const c = build({ publishedTo: [WP_LIVE], stuckUrl: ADDRESS['t-wp'] });
    const r = await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    expect(r).toMatchObject({ success: true, needsRepublish: true });
    expect(c.db.stuckPage.status).toBe('RECOVERING');
    const res = await c.svc.republish(c.republishJob(), updated, { finalAttempt: false });
    expect(updated).toHaveBeenCalledWith('a1', ['t-wp'], { recreateMissing: false, initiator: 'automation' });
    expect(res).toEqual({ ok: true, status: 'RECOVERED' });
    expect(c.db.stuckPage.status).toBe('RECOVERED');
    expect(c.webhook.notify).toHaveBeenCalledTimes(1);
  });

  it('yayinci hedefi bilerek atladiysa (cop kutusu) yeniden denenmez: son deneme olmasa da FAILED, metin geri, RECOVERED yazilmaz', async () => {
    const c = build({ publishedTo: [WP_LIVE], stuckUrl: ADDRESS['t-wp'] });
    await c.svc.recover('sp1', { triggeredBy: 'autopilot' });
    const trashed = vi.fn(async () => [{
      targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: false, skipped: 'live_entry_trashed',
      error: 'Bu yazı WordPress üzerinde çöp kutusunda olduğu için yeniden yayınlanmadı',
    }]);
    const res = await c.svc.republish(c.republishJob(), trashed, { finalAttempt: false });
    expect(res).toMatchObject({ ok: false, status: 'FAILED' });
    expect(res.reason).toContain('çöp kutusunda');
    expect(c.db.stuckPage.status).toBe('FAILED');
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.webhook.notify).not.toHaveBeenCalled();
  });

  it('C3: kopya cop kutusunda kayitliysa (trashedAt) "AI Düzelt" yapay zeka cagirmadan atlar', async () => {
    const c = build({ publishedTo: [{ ...WP_LIVE, trashedAt: '2026-10-01T00:00:00.000Z' }], stuckUrl: ADDRESS['t-wp'] });
    const r = await c.svc.recover('sp1', { triggeredBy: 'user-7' });
    expect(r).toMatchObject({ success: false, skipped: true });
    expect(r.reason).toMatch(/çöp kutusunda.*Hiçbir şey değiştirilmedi\./);
    changedNothing(c);
  });

  it('kaydi adreslenemeyen WordPress yazisi (kimlik/adres yok): oneri, yazi degismez', async () => {
    const c = build({ publishedTo: [entry(WP, { externalUrl: undefined })] });
    const r = await c.svc.recover('sp1', { triggeredBy: 'manual' });
    expect(r).toMatchObject({ success: false, manual: true });
    expect(r.reason).toContain('kimliği ya da adresi kayıtlı değil');
    expect(c.db.article.bodyMd).toBe(BODY);
    expect(c.jobs.enqueue).not.toHaveBeenCalled();
  });
});

describe('K7 — kullaniciya giden nedenler Turkce; hicbir sey degismeden', () => {
  it('RanksUp disi sayfa makale akisinda, AI anahtari yok, bos govde', async () => {
    const ext = build();
    ext.db.stuckPage.articleId = null;
    await expect(ext.svc.recover('sp1', { triggeredBy: 'user-7' })).rejects.toThrow(STUCK_EXTERNAL_PAGE_IN_ARTICLE_FLOW);

    const noKey = build();
    (noKey.svc as any).anthropic = null;
    await expect(noKey.svc.recover('sp1', { triggeredBy: 'user-7' })).rejects.toThrow(STUCK_AI_UNAVAILABLE);
    changedNothing(noKey);
    expect(noKey.db.stuckPage.status).toBe('DETECTED');

    const empty = build({ article: { bodyMd: '   ' } });
    expect(await empty.svc.recover('sp1', { triggeredBy: 'user-7' })).toEqual({ success: false, skipped: true, reason: STUCK_ARTICLE_EMPTY });
    changedNothing(empty);
  });
});
