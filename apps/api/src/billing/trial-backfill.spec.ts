import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { consistentTrialStatus, runTrialBackfill, TRIAL_BACKFILL_WHERE, TRIAL_STATUS_FIX_WHERE } from './trial-backfill.js';

/** Bitisi olmayan deneme hesaplarina "dagitimdan itibaren 14 gun" (scripts/backfill-trial-end.ts) */
const NOW = new Date('2026-10-22T10:00:00.000Z');
const USERS = [
  { id: 'u1', email: 'a@ornek.com', createdAt: new Date('2026-09-01') },
  { id: 'u2', email: 'b@ornek.com', createdAt: new Date('2026-10-15') },
];

// Tutarsiz satirlar: denemede iptal (CANCELED) — bitisi gecmis, suren, tarihsiz; plani dusmus eski musteri
const BAD = [
  { id: 'b1', email: 'c1@ornek.com', subscriptionStatus: 'CANCELED', trialEndsAt: new Date('2026-10-01'), invoices: [] },
  { id: 'b2', email: 'c2@ornek.com', subscriptionStatus: 'CANCELED', trialEndsAt: new Date('2026-10-30'), invoices: [] },
  { id: 'b3', email: 'c3@ornek.com', subscriptionStatus: 'CANCELED', trialEndsAt: null, invoices: [] },
  { id: 'b4', email: 'c4@ornek.com', subscriptionStatus: 'PAST_DUE', trialEndsAt: null, invoices: [{ id: 'i1' }] },
];

function db(bad: Array<Record<string, unknown>> = []) {
  return {
    user: {
      findMany: vi.fn(async (args: any): Promise<any[]> => (args?.where === TRIAL_STATUS_FIX_WHERE ? bad : USERS)),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
}

describe('runTrialBackfill', () => {
  it('kuru calisma (varsayilan): rapor verir, HICBIR SEY yazmaz', async () => {
    const prisma = db();
    const r = await runTrialBackfill(prisma, { apply: false, now: NOW });
    expect(r).toMatchObject({ found: 2, updated: 0 });
    expect(r.trialEndsAt.toISOString()).toBe('2026-11-05T10:00:00.000Z');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(r.lines.at(-1)).toContain('kuru çalışma');
  });

  it('kapsam: yalniz deneme + bitisi bos + silme talebi yok + yonetici degil (ucretli, EXPIRED, admin disarida)', async () => {
    const prisma = db();
    await runTrialBackfill(prisma, { apply: false, now: NOW });
    expect(prisma.user.findMany.mock.calls[1]).toEqual([expect.objectContaining({ where: TRIAL_BACKFILL_WHERE })]);
    expect(TRIAL_BACKFILL_WHERE).toEqual({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: null, deletionRequestedAt: null, role: { not: 'ADMIN' } });
  });

  it('--apply: kayit tarihinden degil dagitimdan itibaren 14 gun; kosullu yazim (arada tarih yazildiysa ezilmez)', async () => {
    const prisma = db();
    const r = await runTrialBackfill(prisma, { apply: true, now: NOW });
    expect(r.updated).toBe(2);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', ...TRIAL_BACKFILL_WHERE }, data: { trialEndsAt: new Date('2026-11-05T10:00:00.000Z') } });
  });

  it('inceleme: plan TRIAL + ACTIVE/PAST_DUE/CANCELED tutarsiz satirlar — kuru calisma sayar, yazmaz', async () => {
    const prisma = db(BAD);
    const r = await runTrialBackfill(prisma, { apply: false, now: NOW });
    expect(r).toMatchObject({ statusFixFound: 4, statusFixed: 0 });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(r.lines.join('\n')).toContain('4 tutarsız deneme durumu bulundu; kuru çalışma');
    expect(TRIAL_STATUS_FIX_WHERE).toEqual({ plan: 'TRIAL', subscriptionStatus: { in: ['ACTIVE', 'PAST_DUE', 'CANCELED'] }, deletionRequestedAt: null, role: { not: 'ADMIN' } });
  });

  it('--apply: bitisi gecmis ya da odemis → EXPIRED, digerleri → TRIAL; kosullu ve bitis yaziminden ONCE', async () => {
    expect(BAD.map((b) => consistentTrialStatus(b, NOW))).toEqual(['EXPIRED', 'TRIAL', 'TRIAL', 'EXPIRED']);
    const prisma = db(BAD);
    const r = await runTrialBackfill(prisma, { apply: true, now: NOW });
    expect(r.statusFixed).toBe(4);
    const calls = prisma.user.updateMany.mock.calls.map((c: any[]) => c[0]);
    expect(calls[0]).toEqual({ where: { id: 'b1', ...TRIAL_STATUS_FIX_WHERE, subscriptionStatus: 'CANCELED' }, data: { subscriptionStatus: 'EXPIRED' } });
    expect(calls[3]).toEqual({ where: { id: 'b4', ...TRIAL_STATUS_FIX_WHERE, subscriptionStatus: 'PAST_DUE' }, data: { subscriptionStatus: 'EXPIRED' } });
    // Durum yazimlari (4) bitis yazimlarindan (2) once
    expect(calls.slice(0, 4).every((c: any) => 'subscriptionStatus' in c.data)).toBe(true);
    expect(calls.slice(4).every((c: any) => 'trialEndsAt' in c.data)).toBe(true);
    const order = prisma.user.findMany.mock.calls.map((c: any[]) => c[0].where);
    expect(order).toEqual([TRIAL_STATUS_FIX_WHERE, TRIAL_BACKFILL_WHERE]);
  });

  it('betik basinda salt okunur SQL denetimi var (yazma yok)', () => {
    const src = readFileSync(new URL('../../scripts/backfill-trial-end.ts', import.meta.url), 'utf8');
    expect(src).toContain("AND u.subscriptionStatus IN ('ACTIVE', 'PAST_DUE', 'CANCELED')");
    expect(src).not.toMatch(/^\s*\*\s*(UPDATE|DELETE|INSERT)\b/m);
  });

  it('betik varsayilan olarak kuru calisir; yazmak icin --apply', () => {
    const src = readFileSync(new URL('../../scripts/backfill-trial-end.ts', import.meta.url), 'utf8');
    expect(src).toContain("const APPLY = process.argv.includes('--apply');");
    expect(src).toContain('runTrialBackfill(prisma as any, { apply: APPLY })');
  });
});
