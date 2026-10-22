import { describe, it, expect } from 'vitest';
import {
  TRIAL_DAYS, automaticGenerationAllowed, hasGenerationSource, isTrialExpired, requiresGenerationSource, trialAccess, trialEndsAtFrom,
} from './trial-policy.js';

/**
 * Ucretsiz deneme kurallari (sahip karari 21.10.2026) — tek karar noktalari.
 * trialAccess: sunucu kapisi (trial-expiry.guard.ts) ve panel (GET /billing/users/:id/current)
 * ayni sonucu kullanir; satin alma kapaliyken (PayTR test modu) hesap ASLA salt okunur olmaz.
 */
const NOW = new Date('2026-10-22T09:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('trialEndsAtFrom / TRIAL_DAYS', () => {
  it('deneme kayittan itibaren tam 14 gun', () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(trialEndsAtFrom(NOW).toISOString()).toBe('2026-11-05T09:00:00.000Z');
  });
});

describe('isTrialExpired', () => {
  it('plan TRIAL + EXPIRED (gunluk is ya da dusen abonelik) doldu sayilir', () => {
    expect(isTrialExpired({ plan: 'TRIAL', subscriptionStatus: 'EXPIRED', trialEndsAt: null }, NOW)).toBe(true);
  });
  it('durum hala TRIAL ama bitis gecmis: gunluk isi beklemeden doldu sayilir', () => {
    expect(isTrialExpired({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: at(-0.01) }, NOW)).toBe(true);
    expect(isTrialExpired({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: at(0.5) }, NOW)).toBe(false);
  });
  it('bitisi hic yazilmamis deneme (eski hesap, backfill oncesi) dolmus sayilmaz; ucretli plan hic', () => {
    expect(isTrialExpired({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: null }, NOW)).toBe(false);
    expect(isTrialExpired({ plan: 'PRO', subscriptionStatus: 'EXPIRED', trialEndsAt: at(-30) }, NOW)).toBe(false);
  });
});

describe('trialAccess — TEK karar: salt okunur yalniz deneme dolmus VE satin alma acikken', () => {
  it('deneme suruyor: kalan gun yukari yuvarlanir, kilit yok', () => {
    expect(trialAccess({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: at(6.2) }, { checkoutOpen: true, now: NOW }))
      .toEqual({ phase: 'trial', endsAt: at(6.2).toISOString(), daysLeft: 7, checkoutOpen: true, readOnly: false });
    expect(trialAccess({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: at(14) }, { checkoutOpen: false, now: NOW }).daysLeft).toBe(14);
  });
  it('deneme doldu + satin alma ACIK: salt okunur', () => {
    const a = trialAccess({ plan: 'TRIAL', subscriptionStatus: 'EXPIRED', trialEndsAt: at(-1) }, { checkoutOpen: true, now: NOW });
    expect(a).toMatchObject({ phase: 'expired', daysLeft: 0, readOnly: true });
  });
  it('GUVENLIK: deneme doldu + satin alma KAPALI (PayTR test modu): kilit yok (kullanici plan secemez)', () => {
    const a = trialAccess({ plan: 'TRIAL', subscriptionStatus: 'EXPIRED', trialEndsAt: at(-1) }, { checkoutOpen: false, now: NOW });
    expect(a).toMatchObject({ phase: 'expired', readOnly: false, checkoutOpen: false });
  });
  it('ucretli plan ve yonetici: hic kilit, deneme bilgisi yok', () => {
    expect(trialAccess({ plan: 'PRO', subscriptionStatus: 'ACTIVE' }, { checkoutOpen: true, now: NOW })).toMatchObject({ phase: 'paid', readOnly: false, daysLeft: null });
    expect(trialAccess({ plan: 'TRIAL', subscriptionStatus: 'EXPIRED', role: 'ADMIN' }, { checkoutOpen: true, now: NOW })).toMatchObject({ phase: 'paid', readOnly: false });
  });
  it('bitisi bilinmeyen deneme: kalan gun null (panel bant gostermez)', () => {
    expect(trialAccess({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: null }, { checkoutOpen: true, now: NOW })).toMatchObject({ phase: 'trial', daysLeft: null, readOnly: false });
  });
});

describe('hasGenerationSource — denemede "Uret" icin kaynak (tek fonksiyon)', () => {
  it('en az bir AKTIF yayin hedefi', () => {
    expect(hasGenerationSource([])).toBe(false);
    expect(hasGenerationSource(null)).toBe(false);
    expect(hasGenerationSource([{ type: 'WORDPRESS_REST', isActive: false }])).toBe(false);
    expect(hasGenerationSource([{ type: 'WORDPRESS_REST', isActive: true }])).toBe(true);
    expect(hasGenerationSource([{ type: 'FTP', isActive: true }])).toBe(true);
    // Bugun ZIP de sayilir (denemede eklenebilen iki hedeften biri); sahip karari acik konu
    expect(hasGenerationSource([{ type: 'MARKDOWN_ZIP', isActive: true }])).toBe(true);
  });
  it('sart yalniz denemede; otomatik uretim yalniz ucretli planda', () => {
    expect(requiresGenerationSource('TRIAL')).toBe(true);
    expect(requiresGenerationSource('STARTER')).toBe(false);
    expect(automaticGenerationAllowed('TRIAL')).toBe(false);
    for (const p of ['STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']) expect(automaticGenerationAllowed(p), p).toBe(true);
  });
});
