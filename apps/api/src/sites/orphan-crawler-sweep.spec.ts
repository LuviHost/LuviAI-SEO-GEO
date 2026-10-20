import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { OrphanCrawlerSweepCron, sweepOrphanCrawlerRows } = await import('./orphan-crawler-sweep.js');
const { siteRemovalSteps } = await import('./sites.service.js');

/**
 * Silinmis sitelerin bot kayitlari (yetim ai_crawler_hits / crawler_hit_events).
 *
 * NEDEN VAR: AiCrawlerHit'in Site'a FK'si yok; silme plani bu tablolari 5d418ac'den
 * once temizlemiyordu ve uretimde silinmis sitelere ait 17 satir kaldi (18.10.2026).
 * Gunluk temizlik onlari ve sonradan dogabilecek yetimleri (beacon'in site onbellegi)
 * siler — var olan sitenin satirina, harf / bosluk farkli yazimla bile, dokunmadan.
 */

/** MySQL utf8mb4_unicode_ci gibi: harf buyuklugu ve sondaki bosluk yok sayilir */
const harmanla = (s: string) => s.toLowerCase().replace(/ +$/, '');
/**
 * ai_crawler_hits migration'da harmanlama belirtmeden olusturuldu (veritabaninin
 * varsayilani). Farkli bir harmanlama yok sayilan karakterleri (or. sifir genislikli
 * bosluk U+200B) sitesinkinden farkli ele alabilir — kanonik olmayan kimlikte iki
 * tablonun "ayni kimlik" karari ayrisir.
 */
const gevsekHarmanla = (s: string) => harmanla(s.replace(/\u200b/g, ''));

function fakeDb(opts: {
  sites: string[];
  hits: Array<{ id: string; siteId: string }>;
  events?: Array<{ id: string; siteId: string }>;
  collationTwin?: string[];
  crawlerCollation?: (s: string) => string;
}) {
  const tables = { aiCrawlerHit: [...opts.hits], crawlerHitEvent: [...(opts.events ?? [])] };
  const deletes: Array<{ table: string; ids: string[] }> = [];
  const ayni = (a: string, b: string) => (opts.crawlerCollation ?? harmanla)(a) === (opts.crawlerCollation ?? harmanla)(b);
  const table = (name: 'aiCrawlerHit' | 'crawlerHitEvent') => ({
    groupBy: vi.fn(async ({ take }: any) => [...new Set(tables[name].map((r) => r.siteId))].sort().slice(0, take).map((siteId) => ({ siteId }))),
    findMany: vi.fn(async ({ where, take }: any) => tables[name].filter((r) => ayni(r.siteId, where.siteId)).slice(0, take).map((r) => ({ id: r.id }))),
    deleteMany: vi.fn(async ({ where }: any) => {
      const before = tables[name].length;
      tables[name] = tables[name].filter((r) => !(where.id.in.includes(r.id) && ayni(r.siteId, where.siteId)));
      deletes.push({ table: name, ids: where.id.in });
      return { count: before - tables[name].length };
    }),
  });
  const db = {
    aiCrawlerHit: table('aiCrawlerHit'),
    crawlerHitEvent: table('crawlerHitEvent'),
    site: {
      // IN sorgusu harmanlamayla eslesir; servis birebir kimligi ayrica denetler
      findMany: vi.fn(async ({ where }: any) => opts.sites.filter((s) => where.id.in.some((id: string) => harmanla(id) === harmanla(s))).map((id) => ({ id }))),
      findFirst: vi.fn(async ({ where }: any) => {
        const hit = [...opts.sites, ...(opts.collationTwin ?? [])].find((s) => harmanla(s) === harmanla(where.id));
        return hit ? { id: hit } : null;
      }),
    },
  };
  return { db, tables, deletes };
}

const VAR = 'cmsitevar0000000000000001';
const SILINMIS = 'cmsitesilinmis00000000001';
const SILINMIS2 = 'cmsitesilinmis00000000002';

describe('sweepOrphanCrawlerRows', () => {
  it('var olmayan sitelerin satirlari iki tablodan da silinir; var olan sitenin satirlari kalir', async () => {
    const { db, tables } = fakeDb({
      sites: [VAR],
      hits: [
        ...Array.from({ length: 17 }, (_, i) => ({ id: `h${i}`, siteId: i < 10 ? SILINMIS : SILINMIS2 })),
        { id: 'k1', siteId: VAR },
      ],
      events: [{ id: 'e1', siteId: SILINMIS }, { id: 'e2', siteId: VAR }],
    });
    const r = await sweepOrphanCrawlerRows(db);
    expect(r).toEqual({ orphanSiteIds: [SILINMIS, SILINMIS2], deleted: { aiCrawlerHit: 17, crawlerHitEvent: 1 }, batches: 3, more: false });
    expect(tables.aiCrawlerHit).toEqual([{ id: 'k1', siteId: VAR }]);
    expect(tables.crawlerHitEvent).toEqual([{ id: 'e2', siteId: VAR }]);
  });

  it('kanonik olmayan kimlik (harf / bosluk farkli yazim) aday olmaz: siteId = varyant silmesi var olan sitenin satirlarini da silerdi', async () => {
    const { db, tables } = fakeDb({
      sites: [VAR],
      hits: [{ id: 'k1', siteId: VAR }, { id: 'k2', siteId: VAR.toUpperCase() }, { id: 'k3', siteId: `${VAR} ` }],
    });
    const r = await sweepOrphanCrawlerRows(db);
    expect(r.deleted.aiCrawlerHit).toBe(0);
    expect(tables.aiCrawlerHit).toHaveLength(3);
    expect(db.aiCrawlerHit.deleteMany).not.toHaveBeenCalled();
  });

  it('kanonik olmayan kimlik, bot tablosunun harmanlamasi siteninkinden farkli olsa da var olan sitenin satirini sildiremez', async () => {
    // Site tablosu U+200B'yi yok saymaz (ikinci kapi siteyi bulamaz); bot tablosu yok sayar:
    // `siteId = 'VAR\u200b'` silmesi VAR'in satirlarini da silerdi
    const { db, tables } = fakeDb({
      sites: [VAR],
      crawlerCollation: gevsekHarmanla,
      hits: [{ id: 'k1', siteId: VAR }, { id: 'k2', siteId: `${VAR}\u200b` }],
    });
    const r = await sweepOrphanCrawlerRows(db);
    expect(r.deleted.aiCrawlerHit).toBe(0);
    expect(tables.aiCrawlerHit.map((x) => x.id)).toEqual(['k1', 'k2']);
  });

  it('ikinci kapi: veritabani harmanlamasiyla esdeger bir site bulunursa hicbir satira dokunulmaz', async () => {
    const { db, tables } = fakeDb({ sites: [], collationTwin: [SILINMIS], hits: [{ id: 'h1', siteId: SILINMIS }] });
    const r = await sweepOrphanCrawlerRows(db);
    expect(db.site.findFirst).toHaveBeenCalledWith({ where: { id: SILINMIS }, select: { id: true } });
    expect(r).toEqual({ orphanSiteIds: [], deleted: { aiCrawlerHit: 0, crawlerHitEvent: 0 }, batches: 0, more: false });
    expect(tables.aiCrawlerHit).toHaveLength(1);
  });

  it('partiler halinde siler, her silme kimlik + site kosuluyla; parti tavaninda durur (kalan ertesi gun)', async () => {
    const hits = Array.from({ length: 7 }, (_, i) => ({ id: `h${i}`, siteId: SILINMIS }));
    const a = fakeDb({ sites: [], hits });
    expect(await sweepOrphanCrawlerRows(a.db, { batch: 3 })).toMatchObject({ deleted: { aiCrawlerHit: 7 }, batches: 3, more: false });
    expect(a.deletes.map((d) => d.ids.length)).toEqual([3, 3, 1]);
    expect(a.db.aiCrawlerHit.deleteMany.mock.calls[0][0].where.siteId).toBe(SILINMIS);

    const b = fakeDb({ sites: [], hits });
    expect(await sweepOrphanCrawlerRows(b.db, { batch: 3, maxBatches: 2 })).toMatchObject({ orphanSiteIds: [SILINMIS], deleted: { aiCrawlerHit: 6 }, batches: 2, more: true });
    expect(b.tables.aiCrawlerHit).toHaveLength(1);
  });

  it('yetim yoksa silme yok; bos tablolar tek sorgu', async () => {
    const { db } = fakeDb({ sites: [VAR], hits: [{ id: 'k1', siteId: VAR }] });
    expect(await sweepOrphanCrawlerRows(db)).toMatchObject({ orphanSiteIds: [], batches: 0 });
    expect(db.site.findFirst).not.toHaveBeenCalled();
    const bos = fakeDb({ sites: [], hits: [] });
    expect(await sweepOrphanCrawlerRows(bos.db)).toMatchObject({ batches: 0 });
    expect(bos.db.site.findMany).not.toHaveBeenCalled();
  });
});

describe('OrphanCrawlerSweepCron', () => {
  it('gunluk kilidi alamayan proses (API ile worker ikisi de tetiklenir) hicbir sey silmez', async () => {
    const { db } = fakeDb({ sites: [], hits: [{ id: 'h1', siteId: SILINMIS }] });
    const prisma: any = { ...db, kvStore: { create: vi.fn(async () => { throw Object.assign(new Error('Unique constraint'), { code: 'P2002' }); }) } };
    await new OrphanCrawlerSweepCron(prisma).run();
    expect(prisma.kvStore.create.mock.calls[0][0].data.key).toMatch(/^cron-lock:orphan-crawler-sweep:\d{4}-\d{2}-\d{2}$/);
    expect(db.aiCrawlerHit.groupBy).not.toHaveBeenCalled();
  });

  it('kilidi alan proses yetimleri siler; hata cron\'u dusurmez', async () => {
    const { db, tables } = fakeDb({ sites: [], hits: [{ id: 'h1', siteId: SILINMIS }] });
    await new OrphanCrawlerSweepCron({ ...db, kvStore: { create: vi.fn(async () => ({})) } } as any).run();
    expect(tables.aiCrawlerHit).toEqual([]);
    const broken: any = { ...db, kvStore: { create: vi.fn(async () => ({})) }, aiCrawlerHit: { ...db.aiCrawlerHit, groupBy: vi.fn(async () => { throw new Error('db yok'); }) } };
    await expect(new OrphanCrawlerSweepCron(broken).run()).resolves.toBeUndefined();
  });
});

describe('site silme plani — bot tablolari zaten temizleniyor (yeni yetim dogmasin)', () => {
  it('AiCrawlerHit ve CrawlerHitEvent silinen sitenin kimligiyle silinir', async () => {
    const calls: Array<{ model: string; accessor: string; where: unknown }> = [];
    const steps = siteRemovalSteps({
      siteId: SILINMIS, trackedAppIds: [], trackedAppKeywordIds: [], asaAccountIds: [], asaCampaignIds: [], asaAdGroupIds: [], ascAccountIds: [],
      ascAppIds: [], sdkConfigIds: [], socialChannelIds: [], stuckPageIds: [], geoPromptIds: [], chatConversationIds: [], queuedBullJobIds: [],
    });
    for (const step of steps.filter((s) => s.model === 'AiCrawlerHit' || s.model === 'CrawlerHitEvent')) {
      const db: any = new Proxy({}, { get: (_t, accessor: string) => ({ deleteMany: async (args: any) => { calls.push({ model: step.model, accessor, where: args.where }); return { count: 0 }; } }) });
      await step.run(db);
    }
    expect(calls).toEqual([
      { model: 'CrawlerHitEvent', accessor: 'crawlerHitEvent', where: { siteId: SILINMIS } },
      { model: 'AiCrawlerHit', accessor: 'aiCrawlerHit', where: { siteId: SILINMIS } },
    ]);
  });
});
