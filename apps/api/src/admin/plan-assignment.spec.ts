import { describe, expect, it } from 'vitest';
import { ASSIGNABLE_PLANS, isAssignablePlan, planAssignmentData } from './plan-assignment.js';
import { decideRenewal } from '../billing/renewal-policy.js';

describe('yonetici plan atamasi', () => {
  it('yalniz bilinen plan enum degerleri atanabilir', () => {
    expect(isAssignablePlan('PARTNER')).toBe(true);
    expect(isAssignablePlan('PRO')).toBe(true);
    expect(isAssignablePlan('partner')).toBe(false);
    expect(isAssignablePlan('ADMIN')).toBe(false);
    expect(isAssignablePlan(undefined)).toBe(false);
  });

  it('TRIAL plani kapatir: deneme yeniden baslamaz', () => {
    expect(planAssignmentData('TRIAL')).toMatchObject({ plan: 'TRIAL', subscriptionStatus: 'EXPIRED' });
  });

  it('ucretli plan ACTIVE olur; is ortaginda otomatik yenileme kapanir', () => {
    expect(planAssignmentData('PRO')).toMatchObject({ plan: 'PRO', subscriptionStatus: 'ACTIVE' });
    expect(planAssignmentData('PRO').autoRenew).toBeUndefined();
    expect(planAssignmentData('PARTNER')).toMatchObject({ plan: 'PARTNER', subscriptionStatus: 'ACTIVE', autoRenew: false });
  });

  it('yenileme kurali is ortagini eski bir faturanin donemine bakip dusurmez', () => {
    const base = {
      now: new Date('2026-12-30T00:00:00Z'),
      status: 'ACTIVE',
      isAdmin: false,
      periodEnd: new Date('2026-11-01T00:00:00Z'),
      recurringEnabled: false,
      autoRenew: false,
      hasUtoken: false,
      failCount: 0,
      lastAttemptAt: null,
      noticeAt: new Date('2026-10-29T00:00:00Z'),
    };
    expect(decideRenewal({ ...base, plan: 'PARTNER' })).toBe('none');
    expect(decideRenewal({ ...base, plan: 'PRO' })).toBe('downgrade');
  });

  it('atanabilir listede her ucretli Prisma plani var', () => {
    expect([...ASSIGNABLE_PLANS].sort()).toEqual(['AGENCY', 'ENTERPRISE', 'PARTNER', 'PRO', 'STARTER', 'TRIAL']);
  });
});
