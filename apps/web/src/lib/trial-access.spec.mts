/**
 * Ucretsiz deneme bandi / hatirlatma / sure doldu modali — karar sunucunun trialAccess
 * alanindan (api billing/trial-policy.ts); panel kalan gunu ya da kilidi uydurmaz.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TRIAL_COPY, TRIAL_DAYS, expiredModal, parseDismissed, readTrialAccess, trialBanner, trialEndsAtFrom, trialPopup,
} from './trial-access';
import { PURCHASE_CLOSED_FALLBACK } from './checkout-availability';

const trial = (daysLeft: number | null) => readTrialAccess({ phase: 'trial', endsAt: '2026-11-05T00:00:00.000Z', daysLeft, checkoutOpen: false, readOnly: false });
const none = new Set<string>();

describe('readTrialAccess — sunucu alani yoksa hicbir sey gosterilmez', () => {
  it('bicim disi / eski API: null', () => {
    expect(readTrialAccess(undefined)).toBeNull();
    expect(readTrialAccess({ phase: 'bilinmez' })).toBeNull();
    expect(trialBanner(readTrialAccess(null))).toBeNull();
  });
  it('web kaydi ayni 14 gunu yazar (api TRIAL_DAYS)', () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(trialEndsAtFrom(new Date('2026-10-22T00:00:00.000Z')).toISOString()).toBe('2026-11-05T00:00:00.000Z');
    const api = readFileSync(new URL('../../../api/src/billing/trial-policy.ts', import.meta.url), 'utf8');
    expect(api).toContain('export const TRIAL_DAYS = 14;');
  });
});

describe('trialBanner — engellemeyen geri sayim', () => {
  it('deneme suruyor: "Deneme sürenin bitmesine N gün kaldı · Planını yükselt"', () => {
    expect(trialBanner(trial(9))).toEqual({ text: 'Deneme sürenin bitmesine 9 gün kaldı · Planını yükselt', tone: 'info' });
    expect(trialBanner(trial(3))?.tone).toBe('warning');
    expect(trialBanner(trial(0))?.text).toBe('Deneme süren bugün bitiyor · Planını yükselt');
  });
  it('ucretli plan, sure dolmus (modal soyler) ya da bitis bilinmiyor: bant yok', () => {
    expect(trialBanner(readTrialAccess({ phase: 'paid', daysLeft: null }))).toBeNull();
    expect(trialBanner(readTrialAccess({ phase: 'expired', daysLeft: 0 }))).toBeNull();
    expect(trialBanner(trial(null))).toBeNull();
  });
});

describe('trialPopup — 7., 11., 13. gun ve hak bitince; kapatilan bir daha acilmaz', () => {
  it('gun esikleri: yalniz ulasilan en son esik', () => {
    expect(trialPopup(trial(10), { dismissed: none })).toBeNull();
    expect(trialPopup(trial(7), { dismissed: none })?.key).toBe('day7');
    expect(trialPopup(trial(3), { dismissed: none })?.key).toBe('day11');
    expect(trialPopup(trial(1), { dismissed: none })?.key).toBe('day13');
    expect(trialPopup(trial(0), { dismissed: none })?.key).toBe('day13');
    // 13. gunde 7. gun penceresi geriye donup acilmaz
    expect(trialPopup(trial(1), { dismissed: new Set(['day13']) })).toBeNull();
  });
  it('2 makale hakki bitince once o (tutarli sayilarla)', () => {
    const quota = { limit: 2, remaining: 0, used: 2 };
    expect(trialPopup(trial(10), { quota, dismissed: none })?.key).toBe('limit');
    expect(trialPopup(trial(3), { quota, dismissed: new Set(['limit']) })?.key).toBe('day11');
    expect(trialPopup(trial(10), { quota: { limit: 2, remaining: 1, used: 1 }, dismissed: none })).toBeNull();
  });
  it('deneme disinda hic acilmaz', () => {
    expect(trialPopup(readTrialAccess({ phase: 'paid' }), { quota: { limit: 15, remaining: 0, used: 15 }, dismissed: none })).toBeNull();
    expect(trialPopup(readTrialAccess({ phase: 'expired', daysLeft: 0 }), { dismissed: none })).toBeNull();
  });
  it('saklanan liste bozuksa bos kume', () => {
    expect([...parseDismissed('["day7",3]')]).toEqual(['day7']);
    expect(parseDismissed('{bozuk').size).toBe(0);
    expect(parseDismissed(null).size).toBe(0);
  });
});

describe('expiredModal — sure doldu', () => {
  it('satin alma ACIK (sunucu readOnly): engelleyen modal, "Deneme süren doldu — devam etmek için bir plan seç"', () => {
    const m = expiredModal(readTrialAccess({ phase: 'expired', daysLeft: 0, checkoutOpen: true, readOnly: true }), { pathname: '/dashboard' });
    expect(m).toEqual({ title: 'Deneme süren doldu — devam etmek için bir plan seç', body: TRIAL_COPY.expiredReadOnly, dismissible: false, checkoutMessage: null });
  });
  it('GUVENLIK: satin alma KAPALI (test modu): kapatilabilir, test modu metni; kilit yok', () => {
    const m = expiredModal(readTrialAccess({ phase: 'expired', daysLeft: 0, checkoutOpen: false, readOnly: false }), { pathname: '/dashboard', checkoutMessage: null });
    expect(m?.dismissible).toBe(true);
    expect(m?.checkoutMessage).toBe(PURCHASE_CLOSED_FALLBACK);
    expect(m?.body).toContain('hesabın kilitlenmedi');
  });
  it('abonelik sayfasinda acilmaz (plan orada secilir); deneme suruyorsa yok', () => {
    expect(expiredModal(readTrialAccess({ phase: 'expired', readOnly: true }), { pathname: '/billing' })).toBeNull();
    expect(expiredModal(trial(3), { pathname: '/dashboard' })).toBeNull();
  });
});
