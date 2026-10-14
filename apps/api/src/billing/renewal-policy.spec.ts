import { describe, it, expect } from 'vitest';
import { decideRenewal, RENEWAL_MAX_ATTEMPTS, type RenewalInput } from './renewal-policy.js';

const D = 86_400_000;
const now = new Date('2026-11-01T05:00:00Z');
const base: RenewalInput = {
  now, plan: 'PRO', status: 'ACTIVE', isAdmin: false,
  periodEnd: new Date(now.getTime() - 1000),
  recurringEnabled: true, autoRenew: true, hasUtoken: true,
  failCount: 0, lastAttemptAt: null, noticeAt: null,
};

describe('yenileme karari — otomatik yol', () => {
  it('donem bitmeden bir sey yapilmaz', () => {
    expect(decideRenewal({ ...base, periodEnd: new Date(now.getTime() + D) })).toBe('none');
  });
  it('donem bitince kayitli karttan cekilir', () => {
    expect(decideRenewal(base)).toBe('charge');
  });
  it('basarisiz denemeden sonra 20 saat dolmadan tekrar denenmez', () => {
    expect(decideRenewal({ ...base, failCount: 1, lastAttemptAt: new Date(now.getTime() - 10 * 3_600_000) })).toBe('none');
    expect(decideRenewal({ ...base, failCount: 1, lastAttemptAt: new Date(now.getTime() - D) })).toBe('charge');
  });
  it('3 basarisiz denemeden sonra plan duser', () => {
    expect(decideRenewal({ ...base, failCount: RENEWAL_MAX_ATTEMPTS, lastAttemptAt: new Date(now.getTime() - D) })).toBe('downgrade');
  });
  it('odeme gecikmis (PAST_DUE) abonelik de denemeye devam eder', () => {
    expect(decideRenewal({ ...base, status: 'PAST_DUE', failCount: 2, lastAttemptAt: new Date(now.getTime() - D) })).toBe('charge');
  });
});

describe('yenileme karari — elle yenileme yolu', () => {
  const manual = { ...base, autoRenew: false, hasUtoken: false };
  it('donem sonuna 3 gunden fazla varken bir sey yapilmaz', () => {
    expect(decideRenewal({ ...manual, periodEnd: new Date(now.getTime() + 5 * D) })).toBe('none');
  });
  it('donem sonuna 3 gun kala yenileme e-postasi gider', () => {
    expect(decideRenewal({ ...manual, periodEnd: new Date(now.getTime() + 2 * D) })).toBe('notice');
  });
  it('e-posta gittikten sonra 7 gun dolmadan dusurulmez', () => {
    expect(decideRenewal({ ...manual, noticeAt: new Date(now.getTime() - 3 * D) })).toBe('none');
  });
  it('donem sonu + 7 gun icinde odeme yoksa duser', () => {
    expect(decideRenewal({ ...manual, periodEnd: new Date(now.getTime() - 8 * D), noticeAt: new Date(now.getTime() - 10 * D) })).toBe('downgrade');
  });
  it('donemi coktan bitmis eski abone once e-posta alir, 7 gun tanınır', () => {
    const old = { ...manual, periodEnd: new Date('2026-07-20T00:00:00Z') };
    expect(decideRenewal(old)).toBe('notice');
    expect(decideRenewal({ ...old, noticeAt: new Date(now.getTime() - 6 * D) })).toBe('none');
    expect(decideRenewal({ ...old, noticeAt: new Date(now.getTime() - 7 * D) })).toBe('downgrade');
  });
  it('ozellik kapaliysa karti kayitli olan da elle yola duser', () => {
    expect(decideRenewal({ ...base, recurringEnabled: false, periodEnd: new Date(now.getTime() + D) })).toBe('notice');
  });
});

describe('yenileme karari — dokunulmayanlar', () => {
  it('admin, deneme plani, iptal edilmis ve faturasiz planlar', () => {
    expect(decideRenewal({ ...base, isAdmin: true })).toBe('none');
    expect(decideRenewal({ ...base, plan: 'TRIAL' })).toBe('none');
    expect(decideRenewal({ ...base, status: 'CANCELED' })).toBe('none');
    expect(decideRenewal({ ...base, periodEnd: null })).toBe('none');
  });
});
