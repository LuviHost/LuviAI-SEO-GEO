/**
 * Ana sayfa makale kutusu — deneme hesabinda "Bu ay uretilen" yazmaz.
 * Calistirma: cd mobile && ../apps/api/node_modules/.bin/vitest run --root . src
 *
 * NEDEN VAR: deneme hakki aylik sifirlanmaz (sunucu QuotaService, plan TRIAL);
 * ekran her hesapta "Bu ay uretilen" diyordu. Sunucu artik articleQuota
 * { limit, remaining, used } donuyor.
 */
import { describe, expect, it } from 'vitest';
import { articleMetric, readArticleQuota } from './article-quota';
import { I18N } from './i18n';

const tr = I18N.tr;
const en = I18N.en;

describe('articleMetric — deneme hesabi', () => {
  it('kalan/limit: "Deneme hakkı: 1/2 kaldı" (TR) ve "1/2 left" (EN)', () => {
    const dash = { plan: 'TRIAL', articlesUsedThisMonth: 1, articleQuota: { limit: 2, remaining: 1, used: 1 } };
    expect(articleMetric(dash, tr, 'tr')).toEqual({ label: 'Deneme hakkı', value: '1/2 kaldı' });
    expect(articleMetric(dash, en, 'en')).toEqual({ label: 'Free trial articles', value: '1/2 left' });
  });

  it('hak bitti: 0/2 kaldı; aylik etiket hicbir dilde yok', () => {
    const dash = { plan: 'TRIAL', articlesUsedThisMonth: 2, articleQuota: { limit: 2, remaining: 0, used: 2 } };
    const m = articleMetric(dash, tr, 'tr');
    expect(m).toEqual({ label: 'Deneme hakkı', value: '0/2 kaldı' });
    expect(m.label).not.toBe(tr.home_m_month);
    expect(articleMetric(dash, en, 'en').label).not.toBe(en.home_m_month);
  });

  it('iptal edilip dusen abonelik (plan TRIAL, durum EXPIRED) da deneme kotasina tabi', () => {
    const dash = { plan: 'TRIAL', subscriptionStatus: 'EXPIRED', articlesUsedThisMonth: 9, articleQuota: { limit: 2, remaining: 0, used: 9 } };
    expect(articleMetric(dash, tr, 'tr')).toEqual({ label: 'Deneme hakkı', value: '0/2 kaldı' });
  });

  it('kota alani yok (eski sunucu / sunucu null): kalan uydurulmaz, kullanilan sayi yazilir', () => {
    expect(articleMetric({ plan: 'TRIAL', articlesUsedThisMonth: 1 }, tr, 'tr')).toEqual({ label: 'Kullanılan deneme hakkı', value: '1' });
    expect(articleMetric({ plan: 'TRIAL', articlesUsedThisMonth: 1, articleQuota: null }, en, 'en')).toEqual({ label: 'Trial articles used', value: '1' });
  });
});

describe('articleMetric — ucretli plan', () => {
  it('aylik etiket kalir; deger sifirlamayi dikkate alan sayac', () => {
    const dash = { plan: 'STARTER', articlesUsedThisMonth: 10, articleQuota: { limit: 15, remaining: 5, used: 10 } };
    expect(articleMetric(dash, tr, 'tr')).toEqual({ label: 'Bu ay üretilen', value: '10' });
    expect(articleMetric(dash, en, 'en')).toEqual({ label: 'Generated this month', value: '10' });
  });

  it('kota alani yoksa eski alan; binlik ayirici dile gore', () => {
    expect(articleMetric({ plan: 'AGENCY', articlesUsedThisMonth: 1234 }, tr, 'tr')).toEqual({ label: 'Bu ay üretilen', value: '1.234' });
    expect(articleMetric({ plan: 'AGENCY', articlesUsedThisMonth: 1234 }, en, 'en')).toEqual({ label: 'Generated this month', value: '1,234' });
  });

  it('plan bilinmiyorsa onceki davranis (aylik etiket)', () => {
    expect(articleMetric({ articlesUsedThisMonth: 3 } as never, tr, 'tr')).toEqual({ label: 'Bu ay üretilen', value: '3' });
  });
});

describe('readArticleQuota', () => {
  it('yalniz sonlu, negatif olmayan uc sayi kabul edilir', () => {
    expect(readArticleQuota({ limit: 2, remaining: 1, used: 1 })).toEqual({ limit: 2, remaining: 1, used: 1 });
    for (const bad of [null, undefined, 'x', [], { limit: '2', remaining: 1, used: 1 }, { limit: 2, remaining: -1, used: 3 }, { limit: Number.NaN, remaining: 1, used: 1 }, { limit: 2, used: 1 }]) {
      expect(readArticleQuota(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('bicim disi kota ile deneme hesabi: kalan uydurulmaz', () => {
    const dash = { plan: 'TRIAL', articlesUsedThisMonth: 1, articleQuota: { limit: 2, remaining: 'bir', used: 1 } };
    expect(articleMetric(dash, tr, 'tr')).toEqual({ label: 'Kullanılan deneme hakkı', value: '1' });
  });
});
