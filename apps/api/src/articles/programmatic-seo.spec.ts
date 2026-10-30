import { describe, it, expect, vi } from 'vitest';
import { ProgrammaticSeoService } from './programmatic-seo.service.js';
import { QuotaService } from '../billing/quota.service.js';

/**
 * Programatik SEO kalan makale hakkini ay basi sifirlamasindan SONRA okur.
 *
 * NEDEN VAR: kalan hak articlesUsedThisMonth'tan dogrudan hesaplaniyordu;
 * yeni ayin ilk cagrisinda gecen ayin dolu sayaci gorulup 0 sehir donuyordu.
 * Ayrica hak yetmeyen sehirler sessizce dusuyordu — cevap artik sayisini soyler.
 */
const lastMonth = new Date(Date.now() - 40 * 86_400_000);

function kur(user: Record<string, unknown>) {
  const row: any = { id: 'u1', articlesQuotaResetAt: new Date(), aiCostThisMonthUsd: 0, videosUsedThisMonth: 0, ...user };
  const created: any[] = [];
  const prisma: any = {
    site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', userId: 'u1', niche: 'kuafor', language: 'tr' })) },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return { ...row }; }),
    },
    article: { create: vi.fn(async ({ data }: any) => { created.push(data); return data; }) },
  };
  const svc = new ProgrammaticSeoService(prisma, null as never, new QuotaService(prisma));
  return { svc, row, created };
}

describe('generateCityPages — makale hakki', () => {
  it('yeni ayda once sifirlar: gecen ayin dolu sayaci 0 sehir dondurmez', async () => {
    const t = kur({ plan: 'PRO', articlesUsedThisMonth: 40, articlesQuotaResetAt: lastMonth });
    const r = await t.svc.generateCityPages('s1', { template: '{location} için {niche}', maxQuota: 5 });
    expect(t.row.articlesUsedThisMonth).toBe(0);
    expect(r.scheduled).toBe(5);
    expect(r.skippedForQuota).toBe(0);
  });

  it('hak yetmeyen sehir sayisini doner', async () => {
    const t = kur({ plan: 'STARTER', articlesUsedThisMonth: 12 }); // 15 - 12 = 3 kalan
    const r = await t.svc.generateCityPages('s1', { template: '{location} için {niche}', maxQuota: 10 });
    expect(r).toMatchObject({ scheduled: 3, requested: 10, skippedForQuota: 7, remainingQuota: 3 });
    expect(t.created).toHaveLength(3);
  });

  it('deneme hesabi ay donumunde sifirlanmaz (toplam hak)', async () => {
    const t = kur({ plan: 'TRIAL', articlesUsedThisMonth: 2, articlesQuotaResetAt: lastMonth });
    const r = await t.svc.generateCityPages('s1', { template: '{location}', maxQuota: 4 });
    expect(r).toMatchObject({ scheduled: 0, requested: 4, skippedForQuota: 4, remainingQuota: 0 });
  });
});
