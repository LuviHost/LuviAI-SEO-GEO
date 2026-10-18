import { afterEach, describe, it, expect, vi } from 'vitest';
import { StuckPageDetectorService } from './stuck-page-detector.service.js';
import { STUCK_FAILED_COOLDOWN_DAYS, runStuckPageSweep } from './stuck-page-autopilot.js';

/**
 * Takili sayfa dedektoru — kullanicinin kapattigi sayfa yeniden acilmaz.
 *
 * NEDEN VAR: detect() "RECOVERED/REVERTED/IGNORED olanlar atlanir" diyordu ama
 * sorgu yalniz RECOVERED ve IGNORED ariyordu. Musteri bir AI duzenlemesini
 * geri aldiginda (satir REVERTED) sayfa hala takiliysa bir sonraki haftalik
 * taramada ayni adrese YENI bir DETECTED satiri aciliyor, runStuckPageSweep
 * (yalniz DETECTED secer) ayni sayfayi otopilotla yeniden yaziyordu.
 *
 * M-1: "Basarisiz" (FAILED) satir yeniden kullanilir (her taramada yeni satir
 * birikmez; otopilot bekleme suresi korunur) ve yazinin cop kutusundaki
 * kopyasinin adresi satir acmaz.
 *
 * GSC cagrilari ornek uzerinde saplanir; DB bellekte. findFirst durum / tarih
 * suzgeclerini, updateMany kosulunu gercekten uygular; Prisma @updatedAt gibi
 * davranir: yazimda updatedAt verilmezse "simdi" yazilir, verilirse AYNEN
 * (prisma-engines write_args.rs add_datetimes — kaynak dedektordeki yorumda).
 */

const URL_ = 'https://ornek.com/blog/kuafor-fiyatlari.html';
const DAY = 24 * 60 * 60 * 1000;

/** Yazi FTP'de ayni slug'la yayinda: yerinde guncellenebilir (otopilotun kurtarabilecegi tur) */
const PUBLISHED_TO = [{ targetId: 'ftp1', targetType: 'FTP', ok: true, externalUrl: URL_ }];

type Row = {
  id: string; siteId: string; url: string; status: string; articleId: string | null; detectedAt: Date; updatedAt: Date;
  recoveries: Array<{ id: string }>; [k: string]: unknown;
};

type ArticleFixture = { id: string; slug: string; title: string; publishedTo: unknown };

const DEFAULT_ARTICLE: ArticleFixture = { id: 'a1', slug: 'kuafor-fiyatlari', title: 'Kuaför fiyatları', publishedTo: PUBLISHED_TO };

function setup(
  rows: Array<Partial<Row> & { status: string }>,
  opts: { articles?: ArticleFixture[]; otherArticles?: Array<{ publishedTo: unknown }>; gscUrl?: string } = {},
) {
  let seq = 0;
  const store: Row[] = rows.map((r) => ({
    id: `old${++seq}`, siteId: 's1', url: opts.gscUrl ?? URL_, articleId: 'a1',
    detectedAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z'), recoveries: [], ...r,
  }));
  const statusIn = (want: any): string[] => (typeof want === 'string' ? [want] : want?.in ?? []);
  const matches = (r: Row, where: any) => r.siteId === where.siteId
    && (where.id === undefined || r.id === where.id)
    && (where.url === undefined || r.url === where.url)
    && (where.status === undefined || statusIn(where.status).includes(r.status))
    && (where.updatedAt === undefined || (where.updatedAt instanceof Date
      ? r.updatedAt.getTime() === where.updatedAt.getTime()
      : r.updatedAt.getTime() >= where.updatedAt.gte.getTime()));
  /** Prisma @updatedAt: verilmezse simdi, verilirse aynen */
  const stamp = (data: any) => ({ ...data, updatedAt: data.updatedAt ?? new Date() });
  const view = (r: Row, select?: any) => {
    if (!select) return { ...r };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(select)) {
      out[k] = k === 'recoveries' ? r.recoveries.slice(0, select.recoveries?.take ?? r.recoveries.length) : r[k];
    }
    return out;
  };
  const published = opts.articles ?? [DEFAULT_ARTICLE];
  const prisma = {
    article: {
      // PUBLISHED yazilar (eslestirme) ve yayinda olmayan yazilarin kayitlari (cop kutusu kaniti)
      findMany: vi.fn(async ({ where }: any) => (where?.status === 'PUBLISHED' ? published : opts.otherArticles ?? [])),
    },
    stuckPage: {
      findFirst: vi.fn(async ({ where, orderBy, select }: any) => {
        const key = orderBy?.updatedAt ? 'updatedAt' : 'detectedAt';
        const hit = store.filter((r) => matches(r, where)).sort((a, b) => (b[key] as Date).getTime() - (a[key] as Date).getTime())[0];
        return hit ? view(hit, select) : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `new${++seq}`, detectedAt: new Date(), recoveries: [], ...stamp(data) } as Row;
        store.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(store.find((r) => r.id === where.id)!, stamp(data))),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const hits = store.filter((r) => matches(r, { siteId: r.siteId, ...where }));
        for (const r of hits) Object.assign(r, stamp(data));
        return { count: hits.length };
      }),
      // runStuckPageSweep aday sorgusu: DETECTED + makaleli satirlar; takili adres
      // (yayin kaydiyla eslesmeli) ve yazinin durumu (kayit metni canlida olmali)
      findMany: vi.fn(async ({ where }: any) => store
        .filter((r) => r.siteId === where.siteId && r.status === where.status && r.articleId !== null)
        .map((r) => ({ id: r.id, url: r.url, article: { status: 'PUBLISHED', slug: 'kuafor-fiyatlari', publishedTo: PUBLISHED_TO } }))),
    },
    site: {
      findMany: vi.fn(async () => [{ id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'auto_publish', user: { plan: 'PRO' } }]),
    },
    // FTP yazi yerinde guncellenir: otopilotun kurtarabilecegi tek tur sayfa
    publishTarget: { findMany: vi.fn(async () => [{ id: 'ftp1', type: 'FTP', isActive: true }]) },
  };
  const detector = new StuckPageDetectorService(prisma as never, {} as never);
  // Konum 8, 500 gosterim, CTR %0,4 → stuckScore 70 (takili)
  (detector as any).fetchPagePerformance = vi.fn(async () => [{ url: opts.gscUrl ?? URL_, impressions: 500, clicks: 2, ctr: 0.004, position: 8 }]);
  (detector as any).fetchTopQueriesByUrl = vi.fn(async () => new Map<string, string[]>());
  const jobs = { enqueue: vi.fn(async () => ({ dbJobId: 'j' })) };
  return { prisma, detector, store, jobs };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('StuckPageDetectorService.detect — kapali kayit atlanir', () => {
  it('geri alinan (REVERTED) sayfa yeniden tespit edilmez: yeni satir yok, guncelleme yok', async () => {
    const { detector, store, prisma } = setup([{ status: 'REVERTED' }]);
    const r = await detector.detect('s1');
    expect(r).toEqual({ found: 1, created: 0, updated: 0, skipped: 1 });
    expect(prisma.stuckPage.create).not.toHaveBeenCalled();
    expect(store.map((s) => s.status)).toEqual(['REVERTED']);
  });

  it('RECOVERED ve IGNORED de atlanir (onceki davranis)', async () => {
    for (const status of ['RECOVERED', 'IGNORED']) {
      const { detector, prisma } = setup([{ status }]);
      expect(await detector.detect('s1'), status).toMatchObject({ created: 0, skipped: 1 });
      expect(prisma.stuckPage.create, status).not.toHaveBeenCalled();
    }
  });

  it('acik DETECTED satiri guncellenir; adresin hic satiri yoksa yeni DETECTED satiri acilir', async () => {
    const open = setup([{ status: 'DETECTED' }]);
    expect(await open.detector.detect('s1')).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(open.store).toHaveLength(1);
    expect(open.store[0]).toMatchObject({ status: 'DETECTED', impressions: 500, position: 8 });

    const fresh = setup([]);
    expect(await fresh.detector.detect('s1')).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    expect(fresh.store).toMatchObject([{ status: 'DETECTED', articleId: 'a1' }]);
  });

  it('guncellemede yeni sorgu yoksa topQueries HIC yazilmaz (sorgusuz satirda eski deger NULL; bos Json alanina duz null gitmez); yeni sorgu varsa yazilir', async () => {
    const open = setup([{ status: 'DETECTED', topQueries: null }]);
    await open.detector.detect('s1');
    // Acik satir tazelemesi kosullu (updateMany: okunan durum; RECOVERING'de updatedAt aynen)
    expect(open.prisma.stuckPage.updateMany.mock.calls[0][0].data).not.toHaveProperty('topQueries');

    const failed = setup([{ status: 'FAILED', topQueries: null, updatedAt: new Date(Date.now() - 3 * DAY) }]);
    await failed.detector.detect('s1');
    expect(failed.prisma.stuckPage.updateMany.mock.calls[0][0].data).not.toHaveProperty('topQueries');

    const withQueries = setup([{ status: 'DETECTED', topQueries: null }]);
    (withQueries.detector as any).fetchTopQueriesByUrl = vi.fn(async () => new Map([['/blog/kuafor-fiyatlari.html', ['kuaför fiyatları']]]));
    await withQueries.detector.detect('s1');
    expect(withQueries.store[0].topQueries).toEqual(['kuaför fiyatları']);
  });

  it('ayni sorgu uc kapali durumu da arar (yorumla kod ayni sey soyler)', async () => {
    const { detector, prisma } = setup([]);
    await detector.detect('s1');
    const closedCall = prisma.stuckPage.findFirst.mock.calls.find((c: any[]) => (c[0].where.status.in as string[]).includes('IGNORED'));
    expect((closedCall![0] as any).where.status.in.slice().sort()).toEqual(['IGNORED', 'RECOVERED', 'REVERTED']);
  });
});

describe('M-1 — "Basarisiz" satir yeniden kullanilir; otopilot bekleme suresi korunur', () => {
  const T0 = new Date('2026-10-19T06:00:00Z');

  it('bekleme suresi icinde: yeni satir ACILMAZ; satir FAILED kalir, metrikler tazelenir, basarisizlik ani (updatedAt) aynen kalir; otopilot kuyruga almaz', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const failedAt = new Date(T0.getTime() - 7 * DAY);
    const { detector, prisma, jobs, store } = setup([{ status: 'FAILED', updatedAt: failedAt, impressions: 120, position: 12 }]);
    const summary = await runStuckPageSweep({ prisma, detector, jobs } as never);
    expect(prisma.stuckPage.create).not.toHaveBeenCalled();
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ id: 'old1', status: 'FAILED', impressions: 500, position: 8, articleId: 'a1' });
    expect(store[0].updatedAt.getTime()).toBe(failedAt.getTime());
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ totalDetected: 1, autoRecoveryQueued: 0 });
  });

  it('haftalik tazeleme bekleme suresini UZATMAZ: son basarisizliktan sure dolunca ayni satir yeniden "Tespit edildi" olur ve otopilot onu bir kez dener', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const failedAt = new Date('2026-09-14T06:00:00Z');
    const { detector, prisma, jobs, store } = setup([{ status: 'FAILED', updatedAt: failedAt }]);
    // Bekleme suresi icindeki haftalik taramalar: satir FAILED, kuyruk bos, satir sayisi 1
    for (let week = 1; week * 7 < STUCK_FAILED_COOLDOWN_DAYS; week++) {
      vi.setSystemTime(new Date(failedAt.getTime() + week * 7 * DAY));
      await runStuckPageSweep({ prisma, detector, jobs } as never);
      expect(store.map((r) => r.status), `hafta ${week}`).toEqual(['FAILED']);
      expect(store[0].updatedAt.getTime(), `hafta ${week}`).toBe(failedAt.getTime());
    }
    expect(jobs.enqueue).not.toHaveBeenCalled();
    // Sure doldu (basarisizliktan 35 gun sonra): AYNI satir DETECTED, otopilot kuyruga aldi
    vi.setSystemTime(new Date(failedAt.getTime() + 35 * DAY));
    const summary = await runStuckPageSweep({ prisma, detector, jobs } as never);
    expect(prisma.stuckPage.create).not.toHaveBeenCalled();
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ id: 'old1', status: 'DETECTED' });
    expect(summary).toMatchObject({ autoRecoveryQueued: 1, recentFailurePages: 0 });
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'STUCK_PAGE_RECOVER', payload: { stuckPageId: 'old1', triggeredBy: 'autopilot', requestedAt: expect.any(String) } }));
  });

  it('tam sinirda (basarisizliktan tam bekleme suresi sonra) satir FAILED kalir: taramanin kuraliyla ayni sinir (updatedAt >= simdi - sure)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const failedAt = new Date(T0.getTime() - STUCK_FAILED_COOLDOWN_DAYS * DAY);
    const { detector, prisma, jobs, store } = setup([{ status: 'FAILED', updatedAt: failedAt }]);
    await runStuckPageSweep({ prisma, detector, jobs } as never);
    expect(store[0].status).toBe('FAILED');
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('kurtarma kaydi olan FAILED satir (duzeltme kismen yayina gitmis olabilir) sure dolsa da FAILED kalir: panel onu "Öneri — uygulanmadı" diye gostermesin; yeni satir da acilmaz', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const failedAt = new Date(T0.getTime() - 60 * DAY);
    const { detector, prisma, jobs, store } = setup([{ status: 'FAILED', updatedAt: failedAt, recoveries: [{ id: 'r1' }] }]);
    await runStuckPageSweep({ prisma, detector, jobs } as never);
    expect(prisma.stuckPage.create).not.toHaveBeenCalled();
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ status: 'FAILED', impressions: 500 });
    expect(store[0].updatedAt.getTime()).toBe(failedAt.getTime());
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('okuma ile yazma arasinda kullanici "AI Düzelt" dedi (satir RECOVERING): dedektor satiri ezmez, atlandi sayar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const { detector, prisma, store } = setup([{ status: 'FAILED', updatedAt: new Date(T0.getTime() - 7 * DAY), impressions: 120 }]);
    const realFindFirst = prisma.stuckPage.findFirst.getMockImplementation()!;
    prisma.stuckPage.findFirst.mockImplementation(async (args: any) => {
      const hit = await realFindFirst(args);
      // FAILED satir okundu; hemen ardindan kurtarma isi satiri sahiplendi
      if (hit && statusOf(args) === 'FAILED') Object.assign(store[0], { status: 'RECOVERING', updatedAt: new Date() });
      return hit;
    });
    const r = await detector.detect('s1');
    expect(r).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(store[0]).toMatchObject({ status: 'RECOVERING', impressions: 120 });
  });
});

/** findFirst cagrisinin tek durumlu FAILED sorgusu mu (dedektorun yeniden kullanim okumasi) */
function statusOf(args: any): string | undefined {
  const s = args?.where?.status;
  const list: string[] = typeof s === 'string' ? [s] : s?.in ?? [];
  return list.length === 1 ? list[0] : undefined;
}

describe('M-1 — yazinin cop kutusundaki kopyasinin adresi takili sayfa satiri acmaz', () => {
  const WP_URL = 'https://ornek.com/kuafor-fiyatlari/';
  const trashedWp = { targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: WP_URL, trashedAt: '2026-10-05T00:00:00.000Z' };

  it('yazi FTP\'de yayinda, WordPress kopyasi cop kutusunda; GSC hala WordPress adresini listeliyor: satir acilmaz, guncellenmez', async () => {
    const article = { ...DEFAULT_ARTICLE, publishedTo: [...PUBLISHED_TO, trashedWp] };
    const { detector, prisma } = setup([], { articles: [article], gscUrl: WP_URL });
    const r = await detector.detect('s1');
    expect(r).toEqual({ found: 1, created: 0, updated: 0, skipped: 1 });
    expect(prisma.stuckPage.create).not.toHaveBeenCalled();
    expect(prisma.stuckPage.update).not.toHaveBeenCalled();
    expect(prisma.stuckPage.updateMany).not.toHaveBeenCalled();
  });

  it('bilinen tek kopyasi cop kutusunda olan yazi (artik PUBLISHED degil): "RanksUp disi" satir da acilmaz', async () => {
    const { detector, prisma } = setup([], { articles: [], otherArticles: [{ publishedTo: [trashedWp] }], gscUrl: WP_URL });
    expect(await detector.detect('s1')).toMatchObject({ created: 0, skipped: 1 });
    expect(prisma.stuckPage.create).not.toHaveBeenCalled();
  });

  it('D3: WordPress kopyasi hedefte silinmis bulunduysa (missingAt) da GSC adresi satir acmaz, guncellenmez', async () => {
    const missingWp = { ...trashedWp, trashedAt: undefined, missingAt: '2026-10-05T00:00:00.000Z' };
    const article = { ...DEFAULT_ARTICLE, publishedTo: [...PUBLISHED_TO, missingWp] };
    const { detector, prisma } = setup([], { articles: [article], gscUrl: WP_URL });
    expect(await detector.detect('s1')).toEqual({ found: 1, created: 0, updated: 0, skipped: 1 });
    expect(prisma.stuckPage.create).not.toHaveBeenCalled();
    expect(prisma.stuckPage.updateMany).not.toHaveBeenCalled();
  });

  it('kontrol: WordPress kopyasi cop kutusunda degilse satir yaziyla eslesip acilir', async () => {
    const live = { ...trashedWp, trashedAt: undefined };
    const article = { ...DEFAULT_ARTICLE, publishedTo: [...PUBLISHED_TO, live] };
    const { detector, store } = setup([], { articles: [article], gscUrl: WP_URL });
    expect(await detector.detect('s1')).toMatchObject({ created: 1, skipped: 0 });
    expect(store).toMatchObject([{ url: WP_URL, articleId: 'a1', status: 'DETECTED' }]);
  });
});

describe('haftalik tarama — geri alinan sayfa otopilotla yeniden yazilmaz', () => {
  it('Tam otomatik sitede REVERTED sayfa icin STUCK_PAGE_RECOVER kuyruga girmez', async () => {
    const { detector, prisma, jobs, store } = setup([{ status: 'REVERTED' }]);
    const summary = await runStuckPageSweep({ prisma, detector, jobs } as never);
    expect(summary).toMatchObject({ totalDetected: 1, autoRecoveryQueued: 0 });
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(store.filter((s) => s.status === 'DETECTED')).toHaveLength(0);
  });

  it('kontrol: kapali kaydi olmayan takili sayfa ayni kurulumda otomatik kurtarmaya girer', async () => {
    const { detector, prisma, jobs } = setup([]);
    const summary = await runStuckPageSweep({ prisma, detector, jobs } as never);
    expect(summary).toMatchObject({ totalDetected: 1, autoRecoveryQueued: 1 });
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'STUCK_PAGE_RECOVER', payload: expect.objectContaining({ triggeredBy: 'autopilot' }) }));
  });
});
