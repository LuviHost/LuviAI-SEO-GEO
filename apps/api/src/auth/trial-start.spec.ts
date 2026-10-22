import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';

/**
 * 14 gunluk deneme KAYIT ANINDA baslar (sahip karari 21.10.2026). Eskiden
 * ensureTrialStarted hicbir yerden cagrilmiyordu: trialEndsAt bos kaliyor, deneme bitmiyordu.
 */
const CREATED = new Date('2026-10-22T08:00:00.000Z');

function usersDb(row: Record<string, any>) {
  return {
    row,
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      findUnique: vi.fn(async () => ({ ...row })),
      create: vi.fn(async ({ data }: any) => Object.assign(row, { id: 'u-new', createdAt: CREATED, plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: null, ...data })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const ok = Object.entries(where).every(([k, v]) => k === 'id' || row[k] === v);
        if (!ok) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };
}

describe('AuthService.ensureTrialStarted', () => {
  it('yeni deneme hesabi: bitis = kayit + 14 gun (cagri gecikse de kayittan sayilir)', async () => {
    const db: any = usersDb({ id: 'u1', plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: null, createdAt: CREATED, articlesUsedThisMonth: 1 });
    const r = await new AuthService(db).ensureTrialStarted('u1');
    expect(r.trialEndsAt?.toISOString()).toBe('2026-11-05T08:00:00.000Z');
    // Plan ve sayaclara dokunulmaz (eski startTrial sayaci sifirliyordu)
    expect(db.row.articlesUsedThisMonth).toBe(1);
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: null },
      data: { trialEndsAt: new Date('2026-11-05T08:00:00.000Z') },
    });
  });

  it('idempotent: bitisi olan hesapta, ucretli planda ve EXPIRED hesapta hicbir sey yazmaz', async () => {
    for (const row of [
      { plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: new Date('2026-11-01') },
      { plan: 'PRO', subscriptionStatus: 'ACTIVE', trialEndsAt: null },
      { plan: 'TRIAL', subscriptionStatus: 'EXPIRED', trialEndsAt: null },
    ]) {
      const db: any = usersDb({ id: 'u1', createdAt: CREATED, ...row });
      await new AuthService(db).ensureTrialStarted('u1');
      expect(db.user.updateMany, JSON.stringify(row)).not.toHaveBeenCalled();
    }
  });
});

describe('kayit yollari ensureTrialStarted cagirir', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  function controller(db: any) {
    const auth = new AuthService(db);
    const spy = vi.spyOn(auth, 'ensureTrialStarted');
    db.account = { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) };
    db.emailLog = { findFirst: vi.fn(async () => ({ id: 'e1' })) };
    const ctl = new AuthController(auth, {} as any, {} as any, { send: vi.fn() } as any, db, {} as any);
    return { ctl, spy };
  }

  it('mobil Google/Apple ile yeni hesap: olusturulur olusturulmaz deneme baslar', async () => {
    const db: any = usersDb({});
    db.user.findUnique = vi.fn(async () => null);
    const { ctl, spy } = controller(db);
    const user = await (ctl as any).resolveOAuthUser({ provider: 'google', sub: 'g-1', email: 'yeni@ornek.com' });
    expect(spy).toHaveBeenCalledWith('u-new');
    expect(user.trialEndsAt.toISOString()).toBe('2026-11-05T08:00:00.000Z');
  });

  it('mobil giris, var olan hesap: deneme yeniden baslatilmaz', async () => {
    const db: any = usersDb({ id: 'u1', email: 'eski@ornek.com', plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: null, createdAt: CREATED });
    const { ctl, spy } = controller(db);
    await (ctl as any).resolveOAuthUser({ provider: 'google', sub: 'g-2', email: 'eski@ornek.com' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('web kaydi: welcome-hook emniyet agi olarak cagirir; web NextAuth kaydi bitisi kendisi yazar', async () => {
    process.env.INTERNAL_API_KEY = 'k';
    const db: any = usersDb({ id: 'u1', email: 'web@ornek.com', plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: null, createdAt: CREATED });
    const { ctl, spy } = controller(db);
    await ctl.welcomeHook('k', { email: 'web@ornek.com' });
    expect(spy).toHaveBeenCalledWith('u1');
    expect(db.row.trialEndsAt.toISOString()).toBe('2026-11-05T08:00:00.000Z');
    const web = readFileSync(new URL('../../../web/src/auth.ts', import.meta.url), 'utf8');
    expect(web).toMatch(/plan: 'TRIAL',\s*subscriptionStatus: 'TRIAL',[\s\S]*?trialEndsAt: trialEndsAtFrom\(new Date\(\)\),/);
  });
});
