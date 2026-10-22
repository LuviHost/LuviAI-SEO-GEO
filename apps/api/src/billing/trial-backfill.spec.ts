import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runTrialBackfill, TRIAL_BACKFILL_WHERE } from './trial-backfill.js';

/** Bitisi olmayan deneme hesaplarina "dagitimdan itibaren 14 gun" (scripts/backfill-trial-end.ts) */
const NOW = new Date('2026-10-22T10:00:00.000Z');
const USERS = [
  { id: 'u1', email: 'a@ornek.com', createdAt: new Date('2026-09-01') },
  { id: 'u2', email: 'b@ornek.com', createdAt: new Date('2026-10-15') },
];

function db() {
  return {
    user: {
      findMany: vi.fn(async () => USERS),
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
    expect(prisma.user.findMany.mock.calls[0]).toEqual([expect.objectContaining({ where: TRIAL_BACKFILL_WHERE })]);
    expect(TRIAL_BACKFILL_WHERE).toEqual({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: null, deletionRequestedAt: null, role: { not: 'ADMIN' } });
  });

  it('--apply: kayit tarihinden degil dagitimdan itibaren 14 gun; kosullu yazim (arada tarih yazildiysa ezilmez)', async () => {
    const prisma = db();
    const r = await runTrialBackfill(prisma, { apply: true, now: NOW });
    expect(r.updated).toBe(2);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', ...TRIAL_BACKFILL_WHERE }, data: { trialEndsAt: new Date('2026-11-05T10:00:00.000Z') } });
  });

  it('betik varsayilan olarak kuru calisir; yazmak icin --apply', () => {
    const src = readFileSync(new URL('../../scripts/backfill-trial-end.ts', import.meta.url), 'utf8');
    expect(src).toContain("const APPLY = process.argv.includes('--apply');");
    expect(src).toContain('runTrialBackfill(prisma as any, { apply: APPLY })');
  });
});
