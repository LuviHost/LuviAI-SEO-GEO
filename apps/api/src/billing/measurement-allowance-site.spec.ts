import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeasurementAllowanceService } from './measurement-allowance.service.js';
import {
  MEASUREMENT_WINDOW_MS,
  MONTHLY_MEASUREMENTS_PER_SITE,
  WEEKLY_MEASUREMENT_LIMIT_CODE,
  istanbulMonthKey,
  nextIstanbulMonthStart,
  noteMeasured,
} from './measurement-allowance.js';

/**
 * 18.11.2026: haftalik olcum hakki SITE basina — `ai-olcum:<userId>:<siteId>` (7 gun penceresi) +
 * `ai-olcum-ay:<userId>:<siteId>:<YYYY-MM>` (Istanbul takvim ayi, en fazla 4). Siteye bagli olmayan
 * olcum (kayitta alan adi testi) hesap anahtarindan: `ai-olcum:<userId>`.
 */

/** kv_store'un bellek ici esi — updateMany/deleteMany kosullari tek adimda (atomik) uygulanir */
function fakePrisma() {
  const rows = new Map<string, { key: string; value: string; expiresAt: Date | null }>();
  const kvStore = {
    rows,
    async create({ data }: any) {
      if (rows.has(data.key)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      rows.set(data.key, { ...data });
      return data;
    },
    async findUnique({ where }: any) {
      const row = rows.get(where.key);
      return row ? { ...row } : null;
    },
    async updateMany({ where, data }: any) {
      const row = rows.get(where.key);
      if (!row) return { count: 0 };
      if (typeof where.value === 'string' && row.value !== where.value) return { count: 0 };
      if (where.value?.lt !== undefined && !(row.value < where.value.lt)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    async deleteMany({ where }: any) {
      const row = rows.get(where.key);
      if (!row || (where.value !== undefined && row.value !== where.value)) return { count: 0 };
      rows.delete(where.key);
      return { count: 1 };
    },
  };
  return { kvStore } as any;
}

const user = { id: 'u1', role: 'USER' };
const admin = { id: 'a1', role: 'ADMIN' };
const GUN = 24 * 60 * 60 * 1000;
/** 1 Aralik 2026, Istanbul 12:00 — ayin 1., 8., 15., 22. ve 29. gunu ayni takvim ayinda */
const T0 = new Date('2026-12-01T09:00:00.000Z');
const AY = istanbulMonthKey(T0);
const pencere = (siteId: string) => `ai-olcum:u1:${siteId}`;
const aySayaci = (siteId: string, ay = AY) => `ai-olcum-ay:u1:${siteId}:${ay}`;
/** n. haftanin olcum ani: pencere tam 7 gunde degil, 7 gun DOLUNCA acilir (value < now - 7 gun) */
const hafta = (n: number) => new Date(T0.getTime() + n * (MEASUREMENT_WINDOW_MS + 1000));

describe('MeasurementAllowanceService — site basina hak', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let svc: MeasurementAllowanceService;
  /** Gercek olcum yapan kullanici eylemi (run + noteMeasured) */
  const olc = (siteId?: string | null, u: { id: string; role: string } = user) =>
    svc.run(u, async () => { noteMeasured(); return 'ok'; }, siteId);
  const hata = async (p: Promise<unknown>) => p.then(() => { throw new Error('429 bekleniyordu'); }, (e: any) => e);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    prisma = fakePrisma();
    svc = new MeasurementAllowanceService(prisma);
  });
  afterEach(() => vi.useRealTimers());

  it('ayni hesabin iki farkli sitesi ayni hafta ayri ayri olculur', async () => {
    expect(AY).toBe('2026-12');
    await expect(olc('s1')).resolves.toBe('ok');
    await expect(olc('s2')).resolves.toBe('ok');
    expect(prisma.kvStore.rows.get(pencere('s1'))?.value).toBe(T0.toISOString());
    expect(prisma.kvStore.rows.get(pencere('s2'))?.value).toBe(T0.toISOString());
    expect(prisma.kvStore.rows.get(aySayaci('s1'))?.value).toBe('1');
    expect(prisma.kvStore.rows.get(aySayaci('s2'))?.value).toBe('1');
    // Hesap anahtari hic yazilmadi: siteler birbirinin hakkini yemez
    expect(prisma.kvStore.rows.has('ai-olcum:u1')).toBe(false);
    expect((await svc.status(user, 's1')).allowed).toBe(false);
    expect((await svc.status(user, 's3')).allowed).toBe(true);
  });

  it('ayni site ayni hafta ikinci kez → 429 WEEKLY_MEASUREMENT_LIMIT, sonraki tarih pencereden', async () => {
    await olc('s1');
    vi.setSystemTime(new Date(T0.getTime() + 3 * GUN));
    const err = await hata(olc('s1'));
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({
      code: WEEKLY_MEASUREMENT_LIMIT_CODE,
      nextAvailableAt: new Date(T0.getTime() + MEASUREMENT_WINDOW_MS).toISOString(),
    });
    expect(err.getResponse().message).toContain('Her site 7 günde 1 kez ölçülebilir');
    // Reddedilen deneme aylik sayaci artirmaz
    expect(prisma.kvStore.rows.get(aySayaci('s1'))?.value).toBe('1');
  });

  it(`bir site takvim ayinda en fazla ${MONTHLY_MEASUREMENTS_PER_SITE} kez: 7 gun dolsa da 5. olcum 429, yeni ayda acilir`, async () => {
    expect(MONTHLY_MEASUREMENTS_PER_SITE).toBe(4);
    for (let i = 0; i < MONTHLY_MEASUREMENTS_PER_SITE; i++) {
      vi.setSystemTime(hafta(i));
      await expect(olc('s1'), `olcum ${i + 1}`).resolves.toBe('ok');
    }
    expect(prisma.kvStore.rows.get(aySayaci('s1'))?.value).toBe(String(MONTHLY_MEASUREMENTS_PER_SITE));

    // 29 Aralik: son olcumden 7 gun gecti (pencere acik) ama ayin hakki doldu
    const besinci = hafta(MONTHLY_MEASUREMENTS_PER_SITE);
    vi.setSystemTime(besinci);
    expect(istanbulMonthKey(besinci)).toBe(AY);
    const sonPencere = prisma.kvStore.rows.get(pencere('s1'))!.value;
    expect(besinci.getTime() - Date.parse(sonPencere)).toBeGreaterThanOrEqual(MEASUREMENT_WINDOW_MS);
    const st = await svc.status(user, 's1');
    expect(st).toMatchObject({ allowed: false, monthlyUsed: MONTHLY_MEASUREMENTS_PER_SITE, monthlyLimit: MONTHLY_MEASUREMENTS_PER_SITE });
    const err = await hata(olc('s1'));
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({
      code: WEEKLY_MEASUREMENT_LIMIT_CODE,
      nextAvailableAt: nextIstanbulMonthStart(besinci).toISOString(),
    });
    expect(err.getResponse().message).toContain(`ayda en fazla ${MONTHLY_MEASUREMENTS_PER_SITE} kez`);
    // Reddedilen 5. deneme pencereye de dokunmadi
    expect(prisma.kvStore.rows.get(pencere('s1'))!.value).toBe(sonPencere);
    // Ayni ay baska site etkilenmez
    await expect(olc('s2')).resolves.toBe('ok');

    // Yeni takvim ayi (Istanbul 1 Ocak 00:00): sayac sifirdan
    const ocak = nextIstanbulMonthStart(besinci);
    expect(ocak.toISOString()).toBe('2026-12-31T21:00:00.000Z');
    vi.setSystemTime(ocak);
    await expect(olc('s1')).resolves.toBe('ok');
    expect(prisma.kvStore.rows.get(aySayaci('s1', '2027-01'))?.value).toBe('1');
  });

  it('5. olcum durumu saklanan pencere damgasi elle eskitilse de aylik sayactan reddedilir', async () => {
    for (let i = 0; i < MONTHLY_MEASUREMENTS_PER_SITE; i++) {
      await olc('s1');
      // Pencereyi 8 gun geriye cek: hafta kosulu her seferinde acik kalsin
      prisma.kvStore.rows.get(pencere('s1'))!.value = new Date(T0.getTime() - 8 * GUN).toISOString();
    }
    expect((await svc.status(user, 's1')).allowed).toBe(false);
    const err = await hata(olc('s1'));
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse().code).toBe(WEEKLY_MEASUREMENT_LIMIT_CODE);
  });

  it('basarisiz olcumden sonra release hem pencereyi hem aylik sayaci geri alir', async () => {
    // Ilk olcum hata verir: iki kayit da silinir
    await expect(svc.run(user, async () => { throw new Error('saglayici 503'); }, 's1')).rejects.toThrow('saglayici 503');
    expect(prisma.kvStore.rows.has(pencere('s1'))).toBe(false);
    expect(prisma.kvStore.rows.has(aySayaci('s1'))).toBe(false);

    // Iki basarili olcum (0. ve 7. gun), ucuncusu (14. gun) sonucsuz: pencere 7. gune, sayac 2'ye doner
    await olc('s1');
    const ikinci = hafta(1);
    vi.setSystemTime(ikinci);
    await olc('s1');
    vi.setSystemTime(hafta(2));
    await expect(svc.run(user, async () => 'onbellek', 's1')).resolves.toBe('onbellek');
    expect(prisma.kvStore.rows.get(pencere('s1'))?.value).toBe(ikinci.toISOString());
    expect(prisma.kvStore.rows.get(aySayaci('s1'))?.value).toBe('2');
    // Iade edilen hak hemen yeniden kullanilir
    await expect(olc('s1')).resolves.toBe('ok');
    expect(prisma.kvStore.rows.get(aySayaci('s1'))?.value).toBe('3');

    // Dogrudan reserve/release: sayac ve pencere rezervasyondan onceki haline
    vi.setSystemTime(hafta(3));
    const onceki = prisma.kvStore.rows.get(pencere('s1'))!.value;
    const r = await svc.reserve('u1', 's1');
    expect(r).toMatchObject({ key: pencere('s1'), prev: onceki, monthKey: aySayaci('s1'), monthValue: '4' });
    await svc.release(r);
    expect(prisma.kvStore.rows.get(pencere('s1'))?.value).toBe(onceki);
    expect(prisma.kvStore.rows.get(aySayaci('s1'))?.value).toBe('3');
  });

  it('siteId yoksa hesap anahtari (ai-olcum:<userId>); aylik site sayaci yazilmaz', async () => {
    const r = await svc.reserve('u1');
    expect(r.key).toBe('ai-olcum:u1');
    expect(r.monthKey).toBeUndefined();
    expect([...prisma.kvStore.rows.keys()]).toEqual(['ai-olcum:u1']);
    await svc.release(r);
    expect(prisma.kvStore.rows.size).toBe(0);

    await olc(null);
    expect([...prisma.kvStore.rows.keys()]).toEqual(['ai-olcum:u1']);
    const err = await hata(olc(undefined));
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse().message).toContain('Her hesap 7 günde 1 ölçüm yapabilir');
    // Hesap anahtari site haklarini tuketmez
    await expect(olc('s1')).resolves.toBe('ok');
    const hesap = await svc.status(user);
    expect(hesap.allowed).toBe(false);
    expect(hesap.monthlyLimit).toBeUndefined();
  });

  it('ADMIN sinirlanmaz: ayni site art arda olculur, kayit yazilmaz', async () => {
    for (let i = 0; i < MONTHLY_MEASUREMENTS_PER_SITE + 2; i++) {
      await expect(olc('s1', admin)).resolves.toBe('ok');
    }
    await expect(olc(null, admin)).resolves.toBe('ok');
    expect(prisma.kvStore.rows.size).toBe(0);
    expect(await svc.status(admin, 's1')).toEqual({ limited: false, allowed: true, lastMeasuredAt: null, nextAvailableAt: null });
    expect(await svc.reserveOutsideSession(admin, 's1')).toBeNull();
  });
});
