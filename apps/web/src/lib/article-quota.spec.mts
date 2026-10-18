/**
 * Panel ana sayfasi makale kutulari: deneme ayrimi PLANA gore (subscriptionStatus'a
 * gore degil) ve sayilar API'nin articleQuota alanindan.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { billingArticleUsage, dashboardQuotaCards, isTrialPlan, readArticleQuota, yuzdeBelirtmeEki } from './article-quota';

describe('dashboardQuotaCards — plan TRIAL', () => {
  it('suresi dolan deneme (plan TRIAL, durum EXPIRED): "Bu ay" yazmaz, kalan hak API sayisi', () => {
    const c = dashboardQuotaCards({
      plan: 'TRIAL', subscriptionStatus: 'EXPIRED', articlesUsedThisMonth: 1,
      articleQuota: { limit: 2, remaining: 1, used: 1 },
    } as never);
    expect(c.used).toEqual({ label: 'Kullanılan hak', value: 1 });
    expect(c.plan).toEqual({ label: 'Ücretsiz hak', value: '1/2 kaldı' });
  });

  it('iptal edilip dusen abonelik (plan TRIAL, durum EXPIRED): ucretli ayin sayaci "bu ay" sayilmaz, kalan 0/2', () => {
    const c = dashboardQuotaCards({
      plan: 'TRIAL', subscriptionStatus: 'EXPIRED', articlesUsedThisMonth: 9,
      articleQuota: { limit: 2, remaining: 0, used: 9 },
    } as never);
    expect(c.used.label).not.toBe('Bu ay üretilen');
    expect(c.plan).toEqual({ label: 'Ücretsiz hak', value: '0/2 kaldı' });
  });

  it('aktif deneme ayni kurala girer', () => {
    const c = dashboardQuotaCards({ plan: 'TRIAL', subscriptionStatus: 'TRIAL', articlesUsedThisMonth: 0, articleQuota: { limit: 2, remaining: 2, used: 0 } } as never);
    expect(c.plan.value).toBe('2/2 kaldı');
  });

  it('kota alani yok ya da bicim disi: kalan hak uydurulmaz, kullanilan sayi eski alandan', () => {
    for (const articleQuota of [undefined, null, { limit: 2, remaining: 'bir', used: 1 }]) {
      const c = dashboardQuotaCards({ plan: 'TRIAL', articlesUsedThisMonth: 1, articleQuota });
      expect(c.plan).toEqual({ label: 'Ücretsiz hak', value: '—' });
      expect(c.used).toEqual({ label: 'Kullanılan hak', value: 1 });
    }
  });
});

describe('dashboardQuotaCards — ucretli plan', () => {
  it('aylik etiket ve plan adi; sayi ay basi sifirlamasini dikkate alan kota sayaci', () => {
    const c = dashboardQuotaCards({ plan: 'PRO', articlesUsedThisMonth: 12, articleQuota: { limit: 40, remaining: 37, used: 3 } });
    expect(c.used).toEqual({ label: 'Bu ay üretilen', value: 3 });
    expect(c.plan).toEqual({ label: 'Plan', value: 'PRO' });
  });

  it('plan ucretli ama durum TRIAL olsa da (QuotaService plana bakar) aylik kural', () => {
    const c = dashboardQuotaCards({ plan: 'STARTER', subscriptionStatus: 'TRIAL', articlesUsedThisMonth: 4 } as never);
    expect(c.used.label).toBe('Bu ay üretilen');
    expect(c.plan.label).toBe('Plan');
  });

  it('plan bilinmiyorsa onceki davranis; sayi uydurulmaz', () => {
    const c = dashboardQuotaCards({ articlesUsedThisMonth: Number.NaN } as never);
    expect(c.used).toEqual({ label: 'Bu ay üretilen', value: 0 });
    expect(c.plan.value).toBe('—');
  });
});

describe('billingArticleUsage — abonelik sayfasi (K2): ayrim PLANA gore, sayilar /current articleQuota', () => {
  // GET /billing/users/:userId/current plan TANIMINI doner (api billing.service getCurrentPlan)
  const trialPlan = { id: 'trial', name: 'Ücretsiz Deneme', monthly: 0 };
  const proPlan = { id: 'pro', name: 'Pro', monthly: 349 };
  const aylikMetin = /Bu ay|Aylık|aylık kota/;

  it('aktif deneme: omur boyu hak, "bu ay / aylik kota" yazmaz', () => {
    const u = billingArticleUsage({ plan: trialPlan, articleQuota: { limit: 2, remaining: 1, used: 1 } });
    expect(u).toMatchObject({ label: 'Ücretsiz içerik hakkı', value: '1 / 2 kaldı', pct: 50, ariaLabel: 'Ücretsiz içerik hakkı kullanımı' });
    expect(u.label).not.toMatch(aylikMetin);
    expect(u.ariaLabel).not.toMatch(aylikMetin);
    expect(u.note).toEqual({ tone: 'muted', text: 'Deneme hakkı aylık yenilenmez; plan seçtiğinde aylık kotan başlar.' });
  });

  it('dusen abonelik (plan trial, durum EXPIRED, sayac limiti asmis): kalan 0, uyari; "2 / 2" gibi uydurma kullanim yok', () => {
    const u = billingArticleUsage({ plan: trialPlan, status: 'EXPIRED', articleQuota: { limit: 2, remaining: 0, used: 9 } } as never);
    expect(u).toMatchObject({ value: '0 / 2 kaldı', pct: 100 });
    expect(u.note?.tone).toBe('warning');
    expect(u.note?.text).toContain('aylık yenilenmez');
    expect(u.note?.text).not.toMatch(/Aylık kotanın/);
  });

  it('ucretli plan: aylik etiket; %80 ustu uyari dogru Turkce ekle', () => {
    const u = billingArticleUsage({ plan: proPlan, articleQuota: { limit: 40, remaining: 4, used: 36 } });
    expect(u).toMatchObject({ label: 'Bu ay üretilen içerik', value: '36 / 40', pct: 90, ariaLabel: 'Aylık içerik kotası kullanımı' });
    expect(u.note).toEqual({ tone: 'warning', text: 'Aylık kotanın %90\'ını kullandın. Daha fazlası için planını yükseltebilirsin.' });
    expect(billingArticleUsage({ plan: proPlan, articleQuota: { limit: 40, remaining: 30, used: 10 } }).note).toBeNull();
  });

  it('kota okunamadiysa sayi uydurulmaz: deger "—", cubuk yok', () => {
    for (const plan of [trialPlan, proPlan]) {
      const u = billingArticleUsage({ plan, articleQuota: null });
      expect(u.value).toBe('—');
      expect(u.pct).toBeNull();
      expect(u.note?.tone).toBe('muted');
    }
    expect(billingArticleUsage(null).value).toBe('—');
  });

  it('isTrialPlan: /me/dashboard enum ve /current plan tanimi', () => {
    expect(isTrialPlan('TRIAL')).toBe(true);
    expect(isTrialPlan(trialPlan)).toBe(true);
    expect(isTrialPlan({ id: 'TRIAL' })).toBe(true);
    expect(isTrialPlan('PRO')).toBe(false);
    expect(isTrialPlan(proPlan)).toBe(false);
    expect(isTrialPlan(null)).toBe(false);
  });

  it('yuzde eki sayinin okunusunun son kelimesine gore (eski metin her sayida ayni eki yaziyordu)', () => {
    const beklenen: Record<number, string> = {
      81: "'ini", 82: "'sini", 83: "'ünü", 84: "'ünü", 85: "'ini", 86: "'sını", 87: "'sini", 88: "'ini", 89: "'unu",
      90: "'ını", 100: "'ünü", 10: "'unu", 20: "'sini", 30: "'unu", 40: "'ını", 50: "'sini", 60: "'ını", 70: "'ini", 80: "'ini", 0: "'ını",
    };
    for (const [n, ek] of Object.entries(beklenen)) expect(yuzdeBelirtmeEki(Number(n)), n).toBe(ek);
  });
});

describe('readArticleQuota', () => {
  it('yalniz sonlu, negatif olmayan uc sayi kabul edilir', () => {
    expect(readArticleQuota({ limit: 2, remaining: 1, used: 1 })).toEqual({ limit: 2, remaining: 1, used: 1 });
    for (const bad of [null, undefined, 'x', [], { limit: '2', remaining: 1, used: 1 }, { limit: 2, remaining: -1, used: 3 }, { limit: Number.NaN, remaining: 1, used: 1 }, { limit: 2, used: 1 }]) {
      expect(readArticleQuota(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
