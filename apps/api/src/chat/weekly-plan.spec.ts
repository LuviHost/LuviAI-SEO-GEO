import { describe, it, expect } from 'vitest';
import {
  selectWeeklyPlanSites,
  isPaidOwner,
  resolveMaxSites,
  isWeeklyPlanCronEnabled,
  parsePlanItems,
  isoWeekTag,
  type WeeklyPlanCandidate,
} from './weekly-plan.cron.js';

/**
 * Haftalik plan cron'unun PARA HARCAYAN kararlari.
 *
 * Bu cron site basina bir agent dongusu (6 tool turuna kadar Sonnet)
 * calistirir; yanlis secim dogrudan fatura demek. Bu yuzden trial
 * filtresi, tavan ve varsayilan-kapali anahtar burada sabitlenmistir.
 * LLM cagrisinin kendisi test edilmez.
 */

const site = (over: Partial<WeeklyPlanCandidate> & { siteId: string; userId: string }): WeeklyPlanCandidate => ({
  siteName: `site-${over.siteId}`,
  userEmail: `${over.userId}@example.com`,
  userName: null,
  userRole: 'USER',
  plan: 'PRO',
  subscriptionStatus: 'ACTIVE',
  ...over,
});

describe('isPaidOwner', () => {
  it('trial sahibini disarida birakir', () => {
    expect(isPaidOwner({ plan: 'TRIAL', subscriptionStatus: 'TRIAL' })).toBe(false);
    // Trial kullanicisi "ACTIVE" gorunse bile ucretli degil
    expect(isPaidOwner({ plan: 'TRIAL', subscriptionStatus: 'ACTIVE' })).toBe(false);
  });

  it('odemesi aksamis ucretli hesaba is yapmaz', () => {
    expect(isPaidOwner({ plan: 'PRO', subscriptionStatus: 'PAST_DUE' })).toBe(false);
    expect(isPaidOwner({ plan: 'PRO', subscriptionStatus: 'CANCELED' })).toBe(false);
  });

  it('aktif ucretli kademeleri kabul eder', () => {
    for (const plan of ['STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']) {
      expect(isPaidOwner({ plan, subscriptionStatus: 'ACTIVE' })).toBe(true);
    }
  });
});

describe('selectWeeklyPlanSites', () => {
  it('trial sitelerini eleyip yalnizca ucretlileri secer', () => {
    const rows = [
      site({ siteId: 's1', userId: 'u1' }),
      site({ siteId: 's2', userId: 'u2', plan: 'TRIAL', subscriptionStatus: 'TRIAL' }),
      site({ siteId: 's3', userId: 'u3', plan: 'STARTER' }),
    ];
    const res = selectWeeklyPlanSites(rows, 50);
    expect(res.selected.map((s) => s.siteId)).toEqual(['s1', 's3']);
    expect(res.eligible).toBe(2);
    expect(res.skipped).toBe(0);
  });

  it('tavani asan siteleri kirpar ve kac tane atlandigini bildirir', () => {
    const rows = Array.from({ length: 8 }, (_, i) => site({ siteId: `s${i}`, userId: `u${i}` }));
    const res = selectWeeklyPlanSites(rows, 3);
    expect(res.selected).toHaveLength(3);
    expect(res.eligible).toBe(8);
    expect(res.skipped).toBe(5);
  });

  it('kirpma tek siteli hesaplari ac birakmasin diye sahip bazinda sirayla dagitir', () => {
    // Ajansin 4 sitesi listenin basinda; naif slice tavani doldurur ve
    // u2/u3 hic plan alamaz.
    const rows = [
      site({ siteId: 'a1', userId: 'ajans' }),
      site({ siteId: 'a2', userId: 'ajans' }),
      site({ siteId: 'a3', userId: 'ajans' }),
      site({ siteId: 'a4', userId: 'ajans' }),
      site({ siteId: 'b1', userId: 'u2' }),
      site({ siteId: 'c1', userId: 'u3' }),
    ];
    const res = selectWeeklyPlanSites(rows, 3);
    expect(res.selected.map((s) => s.siteId)).toEqual(['a1', 'b1', 'c1']);
    expect(res.skipped).toBe(3);
  });

  it('tavan 0 ise hicbir site islenmez', () => {
    const rows = [site({ siteId: 's1', userId: 'u1' })];
    const res = selectWeeklyPlanSites(rows, 0);
    expect(res.selected).toHaveLength(0);
    expect(res.skipped).toBe(1);
  });

  it('uygun site yoksa bos doner', () => {
    const rows = [site({ siteId: 's1', userId: 'u1', plan: 'TRIAL', subscriptionStatus: 'TRIAL' })];
    const res = selectWeeklyPlanSites(rows, 50);
    expect(res.selected).toHaveLength(0);
    expect(res.eligible).toBe(0);
    expect(res.skipped).toBe(0);
  });
});

describe('resolveMaxSites', () => {
  it('env yoksa 50 kullanir', () => {
    expect(resolveMaxSites({} as NodeJS.ProcessEnv)).toBe(50);
  });

  it('gecerli sayiyi kullanir', () => {
    expect(resolveMaxSites({ WEEKLY_PLAN_MAX_SITES: '10' } as any)).toBe(10);
  });

  it('bozuk/negatif degeri guvenli varsayilana dusurur', () => {
    expect(resolveMaxSites({ WEEKLY_PLAN_MAX_SITES: 'cok' } as any)).toBe(50);
    expect(resolveMaxSites({ WEEKLY_PLAN_MAX_SITES: '-5' } as any)).toBe(50);
    expect(resolveMaxSites({ WEEKLY_PLAN_MAX_SITES: '0' } as any)).toBe(50);
  });
});

describe('isWeeklyPlanCronEnabled', () => {
  it('varsayilan KAPALI — env yoksa calismaz', () => {
    expect(isWeeklyPlanCronEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isWeeklyPlanCronEnabled({ WEEKLY_PLAN_CRON: 'false' } as any)).toBe(false);
    expect(isWeeklyPlanCronEnabled({ WEEKLY_PLAN_CRON: '1' } as any)).toBe(false);
  });

  it('yalnizca acikca true ile acilir', () => {
    expect(isWeeklyPlanCronEnabled({ WEEKLY_PLAN_CRON: 'true' } as any)).toBe(true);
  });
});

describe('parsePlanItems', () => {
  const plan = [
    '## Bu haftanın planı',
    '',
    '1. **FAQ şeması ekle** — /fiyatlar sayfası',
    '   Kanıt: get_prompt_coverage trust dalında %0 kapsama.',
    '2. Rakip karşılaştırma yazısı yayınla',
    '   Kanıt: 3 promptta rakip öneriliyor.',
    '3. llms.txt yayınla',
    '',
    'Not: 2026. yılda robots.txt değişimi bekleniyor.',
  ].join('\n');

  it('numarali maddeleri baslik + gerekce olarak ayirir', () => {
    const items = parsePlanItems(plan);
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe('FAQ şeması ekle — /fiyatlar sayfası');
    expect(items[0].description).toContain('trust dalında');
  });

  it('metin icindeki yil gibi sayilari madde sanmaz', () => {
    const items = parsePlanItems(plan);
    expect(items.map((i) => i.title)).not.toContain('yılda robots.txt değişimi bekleniyor.');
    // Son maddenin aciklamasina duser
    expect(items[2].description).toContain('2026. yılda');
  });

  it('madde sayisini tavanla kirpar', () => {
    const long = Array.from({ length: 12 }, (_, i) => `${i + 1}. Madde ${i + 1}`).join('\n');
    expect(parsePlanItems(long, 7)).toHaveLength(7);
  });

  it('numarasiz serbest metinde madde uretmez', () => {
    expect(parsePlanItems('Bu hafta yapacak bir sey yok, veri az.')).toHaveLength(0);
    expect(parsePlanItems('')).toHaveLength(0);
  });

  it('cok uzun basligi 300 karaktere sigdirir', () => {
    const items = parsePlanItems(`1. ${'x'.repeat(500)}`);
    expect(items[0].title.length).toBe(300);
  });
});

describe('isoWeekTag', () => {
  it('ayni haftanin gunlerinde ayni etiketi verir', () => {
    const monday = isoWeekTag(new Date('2026-08-10T06:00:00Z'));
    const friday = isoWeekTag(new Date('2026-08-14T23:00:00Z'));
    expect(monday).toBe(friday);
  });

  it('hafta degisince etiket degisir — sourceRef tekilligi buna dayaniyor', () => {
    expect(isoWeekTag(new Date('2026-08-10T06:00:00Z')))
      .not.toBe(isoWeekTag(new Date('2026-08-17T06:00:00Z')));
  });
});
