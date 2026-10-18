import { describe, it, expect, vi } from 'vitest';
import { KvSweepCron, sweepExpiredKv, type KvSweepDb } from './kv-sweep.cron.js';

/**
 * kv_store'da suresi dolan kayitlarin silinmesi. Vitest dekorator metadata'si
 * uretmedigi icin cron sinifi elle kurulur.
 */

const NOW = new Date('2026-10-18T01:50:00Z');
const past = (ms: number) => new Date(NOW.getTime() - ms);
const future = (ms: number) => new Date(NOW.getTime() + ms);

function fakeKv(rows: Array<{ key: string; expiresAt: Date | null }>, hooks: { beforeDelete?: (map: Map<string, Date | null>) => void } = {}) {
  const map = new Map(rows.map((r) => [r.key, r.expiresAt]));
  const deletes: string[][] = [];
  const db: KvSweepDb & { kvStore: { create?: any } } = {
    kvStore: {
      findMany: vi.fn(async ({ where, take }) =>
        [...map.entries()].filter(([, e]) => e !== null && e < where.expiresAt.lt).slice(0, take).map(([key]) => ({ key }))),
      deleteMany: vi.fn(async ({ where }) => {
        hooks.beforeDelete?.(map);
        deletes.push(where.key.in);
        let count = 0;
        for (const k of where.key.in) {
          const e = map.get(k);
          // Gercek SQL gibi: NULL < tarih yanlis; kosul satir silinirken yeniden degerlendirilir
          if (e != null && e < where.expiresAt.lt) { map.delete(k); count++; }
        }
        return { count };
      }),
    },
  };
  return { db, map, deletes };
}

describe('sweepExpiredKv', () => {
  it('yalniz suresi gecmis satirlari siler; expiresAt NULL ve gelecek tarihli satirlara dokunmaz', async () => {
    const { db, map } = fakeKv([
      { key: 'autofix-preview:s1:a', expiresAt: past(86_400_000) },
      { key: 'prompt-local:p1', expiresAt: past(1) },
      { key: 'cron-lock:kv-sweep:2026-10-18', expiresAt: future(14 * 86_400_000) },
      { key: 'fx:usdtry', expiresAt: null },
      { key: 'ai-olcum:u1', expiresAt: future(1000) },
    ]);
    const r = await sweepExpiredKv(db, NOW);
    expect(r).toEqual({ deleted: 2, batches: 1, more: false });
    expect([...map.keys()].sort()).toEqual(['ai-olcum:u1', 'cron-lock:kv-sweep:2026-10-18', 'fx:usdtry']);
  });

  it('partiler halinde siler ve tur sinirinda durur (kalan ertesi gun)', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, expiresAt: past(1000) }));
    const a = fakeKv(rows);
    expect(await sweepExpiredKv(a.db, NOW, { batch: 3 })).toEqual({ deleted: 7, batches: 3, more: false });
    expect(a.deletes.map((d) => d.length)).toEqual([3, 3, 1]);

    const b = fakeKv(rows);
    expect(await sweepExpiredKv(b.db, NOW, { batch: 3, maxBatches: 2 })).toEqual({ deleted: 6, batches: 2, more: true });
    expect(b.map.size).toBe(1);
  });

  it('okuma ile silme arasinda yenilenen satir silinmez (silme kosulunda expiresAt yeniden denetlenir)', async () => {
    const { db, map } = fakeKv(
      [{ key: 'ai-olcum:u1', expiresAt: past(1000) }, { key: 'crawl-access:s1', expiresAt: past(1000) }],
      { beforeDelete: (m) => m.set('ai-olcum:u1', future(7 * 86_400_000)) },
    );
    const r = await sweepExpiredKv(db, NOW);
    expect(r.deleted).toBe(1);
    expect(map.has('ai-olcum:u1')).toBe(true);
    expect(map.has('crawl-access:s1')).toBe(false);
  });

  it('silinecek satir yoksa tek okuma, silme yok', async () => {
    const { db } = fakeKv([{ key: 'fx:usdtry', expiresAt: null }]);
    expect(await sweepExpiredKv(db, NOW)).toEqual({ deleted: 0, batches: 0, more: false });
    expect(db.kvStore.deleteMany).not.toHaveBeenCalled();
  });
});

describe('KvSweepCron', () => {
  it('gunluk kilidi alamayan proses (API ile worker ikisi de tetiklenir) hicbir sey silmez', async () => {
    const prisma: any = {
      kvStore: {
        create: vi.fn(async () => { throw Object.assign(new Error('Unique constraint'), { code: 'P2002' }); }),
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    await new KvSweepCron(prisma).run();
    expect(prisma.kvStore.create.mock.calls[0][0].data.key).toMatch(/^cron-lock:kv-sweep:\d{4}-\d{2}-\d{2}$/);
    expect(prisma.kvStore.findMany).not.toHaveBeenCalled();
    expect(prisma.kvStore.deleteMany).not.toHaveBeenCalled();
  });

  it('kilidi alan proses suresi dolanlari siler; hata cron\'u dusurmez', async () => {
    const { db, map } = fakeKv([{ key: 'prompt-local:p1', expiresAt: new Date(Date.now() - 1000) }]);
    const prisma: any = { kvStore: { ...db.kvStore, create: vi.fn(async () => ({})) } };
    await new KvSweepCron(prisma).run();
    expect(map.size).toBe(0);

    const broken: any = { kvStore: { create: vi.fn(async () => ({})), findMany: vi.fn(async () => { throw new Error('db yok'); }), deleteMany: vi.fn() } };
    await expect(new KvSweepCron(broken).run()).resolves.toBeUndefined();
  });
});
