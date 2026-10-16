import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeasurementAllowanceService } from './measurement-allowance.service.js';
import { MEASUREMENT_WINDOW_MS, computeAllowance, noteMeasured, currentMeasurementSession } from './measurement-allowance.js';

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
      return row ? { ...row } : null; // Prisma gibi kopya doner
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
const T0 = new Date('2026-10-16T10:00:00.000Z');

describe('computeAllowance', () => {
  it('hic olcum yoksa izin verir', () => {
    expect(computeAllowance(null, T0)).toEqual({ limited: true, allowed: true, lastMeasuredAt: null, nextAvailableAt: null });
  });

  it('7 gun dolmadan kapali, dolunca acik', () => {
    const last = T0.toISOString();
    const almost = new Date(T0.getTime() + MEASUREMENT_WINDOW_MS - 1);
    const done = new Date(T0.getTime() + MEASUREMENT_WINDOW_MS);
    expect(computeAllowance(last, almost).allowed).toBe(false);
    expect(computeAllowance(last, almost).nextAvailableAt).toBe('2026-10-23T10:00:00.000Z');
    expect(computeAllowance(last, done).allowed).toBe(true);
  });
});

describe('MeasurementAllowanceService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let svc: MeasurementAllowanceService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    prisma = fakePrisma();
    svc = new MeasurementAllowanceService(prisma);
  });
  afterEach(() => vi.useRealTimers());

  it('ilk olcum hakki ayirir, ikincisi 429 WEEKLY_MEASUREMENT_LIMIT alir', async () => {
    await svc.reserve('u1');
    vi.setSystemTime(new Date(T0.getTime() + 3 * 24 * 3600 * 1000));
    const err: any = await svc.reserve('u1').catch((e) => e);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ code: 'WEEKLY_MEASUREMENT_LIMIT', nextAvailableAt: '2026-10-23T10:00:00.000Z' });
    expect(err.getResponse().message).toContain('23 Ekim');
  });

  it('7 gun sonra yeniden ayirir', async () => {
    await svc.reserve('u1');
    vi.setSystemTime(new Date(T0.getTime() + MEASUREMENT_WINDOW_MS + 1000));
    await expect(svc.reserve('u1')).resolves.toMatchObject({ prev: T0.toISOString() });
  });

  it('es zamanli iki istekten yalnizca biri gecer', async () => {
    const results = await Promise.allSettled([svc.reserve('u1'), svc.reserve('u1')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('hesaplar birbirini etkilemez', async () => {
    await svc.reserve('u1');
    await expect(svc.reserve('u2')).resolves.toBeTruthy();
  });

  it('release onceki degeri geri yazar; ilk olcumse kaydi siler', async () => {
    const first = await svc.reserve('u1');
    await svc.release(first);
    expect(prisma.kvStore.rows.has('ai-olcum:u1')).toBe(false);

    await svc.reserve('u1');
    vi.setSystemTime(new Date(T0.getTime() + MEASUREMENT_WINDOW_MS + 1000));
    const second = await svc.reserve('u1');
    await svc.release(second);
    expect(prisma.kvStore.rows.get('ai-olcum:u1')?.value).toBe(T0.toISOString());
  });

  it('run: gercek olcum olursa hak harcanir', async () => {
    await svc.run(user, async () => { noteMeasured(); });
    expect((await svc.status(user)).allowed).toBe(false);
  });

  it('run: olcum olmazsa (onbellek, tum saglayicilar hata) hak iade edilir', async () => {
    await svc.run(user, async () => 'bos');
    expect((await svc.status(user)).allowed).toBe(true);
  });

  it('run: hata olursa hak iade edilir ve hata yukari firlar', async () => {
    await expect(svc.run(user, async () => { throw new Error('kota dolu'); })).rejects.toThrow('kota dolu');
    expect((await svc.status(user)).allowed).toBe(true);
  });

  it('run: ic ice oturum ikinci kez hak ayirmaz', async () => {
    await svc.run(user, async () => {
      await svc.run(user, async () => { noteMeasured(); });
      expect(currentMeasurementSession()?.measured).toBe(true);
    });
    expect((await svc.status(user)).allowed).toBe(false);
  });

  it('ADMIN sinirsiz', async () => {
    const admin = { id: 'a1', role: 'ADMIN' };
    await svc.run(admin, async () => { noteMeasured(); });
    await svc.run(admin, async () => { noteMeasured(); });
    expect(await svc.status(admin)).toMatchObject({ limited: false, allowed: true });
    await expect(svc.reserveOutsideSession(admin)).resolves.toBeNull();
  });

  it('reserveOutsideSession: oturum icinde null, disinda hak ayirir', async () => {
    await svc.run({ id: 'u3', role: 'USER' }, async () => {
      await expect(svc.reserveOutsideSession(user)).resolves.toBeNull();
    });
    await expect(svc.reserveOutsideSession(user)).resolves.toBeTruthy();
    await expect(svc.reserveOutsideSession(user)).rejects.toMatchObject({ status: 429 });
  });
});
