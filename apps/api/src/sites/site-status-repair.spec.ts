import { describe, it, expect, vi } from 'vitest';
import { runSiteStatusRepair, SITE_STATUS_REPAIR_WHERE } from './site-status-repair.js';

/**
 * Tek seferlik durum onarimi (scripts/repair-site-status.ts): varsayilan kuru
 * calisma yazmaz; --apply yalniz bulunan siteleri, ayni kosulla, ACTIVE yapar.
 */
function sahte(rows: Array<{ id: string; status: string }>) {
  return {
    site: {
      findMany: vi.fn(async () => rows),
      updateMany: vi.fn(async (_args: any) => ({ count: rows.length })),
    },
  };
}

describe('runSiteStatusRepair', () => {
  it('kuru calisma: sayar, yazmaz', async () => {
    const p = sahte([{ id: 's1', status: 'AUDIT_COMPLETE' }, { id: 's2', status: 'AUDIT_PENDING' }]);
    const r = await runSiteStatusRepair(p, { apply: false });
    expect(r.found).toBe(2);
    expect(r.updated).toBe(0);
    expect(p.site.updateMany).not.toHaveBeenCalled();
    expect(r.lines.join('\n')).toContain('AUDIT_COMPLETE: 1');
    expect(r.lines.join('\n')).toContain('s2');
  });

  it('--apply: ayni kosul + bulunan kimliklerle ACTIVE yazar', async () => {
    const p = sahte([{ id: 's1', status: 'AUDIT_COMPLETE' }]);
    const r = await runSiteStatusRepair(p, { apply: true });
    expect(r.updated).toBe(1);
    const args = p.site.updateMany.mock.calls[0][0];
    expect(args.data).toEqual({ status: 'ACTIVE' });
    expect(args.where).toMatchObject({ ...SITE_STATUS_REPAIR_WHERE, id: { in: ['s1'] } });
  });

  it('olcut: yalniz dusmus durumlar, silme talepli hesap haric, kurulum kaniti sart', () => {
    expect(SITE_STATUS_REPAIR_WHERE.status.in).toEqual(['AUDIT_COMPLETE', 'AUDIT_PENDING']);
    expect(SITE_STATUS_REPAIR_WHERE.user).toEqual({ deletionRequestedAt: null });
    // Worker zinciri onboardingCompletedAt yazmaz — tamamlanmis zincir isi de kanit sayilmali
    expect(SITE_STATUS_REPAIR_WHERE.OR).toContainEqual({ jobs: { some: { type: 'ONBOARDING_CHAIN', status: 'COMPLETED' } } });
    expect(SITE_STATUS_REPAIR_WHERE.OR).toContainEqual({ onboardingCompletedAt: { not: null } });
  });
});
