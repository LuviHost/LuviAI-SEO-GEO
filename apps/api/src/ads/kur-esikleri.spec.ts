import { describe, expect, it, vi } from 'vitest';
import { AdsSnapshotCollectorService } from './snapshot-collector.service.js';
import { GOOGLE_RULES } from './rules/google-rules.js';
import type { AccountSnapshot } from './rules/types.js';

/**
 * USD esikli kontroller TRY hesapta TCMB kuruyla (18.11.2026, sahip: "ekle"). Kur bilinmiyorsa 'na'.
 */
const G16 = GOOGLE_RULES.find((r) => r.id === 'G16')!;
const terimler = [
  { term: 'alakasiz a', cost: 500, conversions: 0 }, // 500 TL / 40 = 12.5 USD > 10 → bosa harcama
  { term: 'alakasiz b', cost: 200, conversions: 0 }, // 5 USD < 10 → esik alti
  { term: 'iyi terim', cost: 1300, conversions: 4 },
];

describe('kur: TRY hesapta USD esikleri', () => {
  it('toplayici TRY hesapta usdPerUnit ve monthlySpendUsd yazar; USD hesapta 1', async () => {
    const fx = { getUsdToTryRate: vi.fn(async () => 40) };
    const svc: any = new AdsSnapshotCollectorService({} as any, {} as any, fx as any);
    const s: AccountSnapshot = { currency: 'TRY', monthlySpend: 4000 };
    await svc.applyFx(s);
    expect(s.usdPerUnit).toBeCloseTo(0.025, 6);
    expect(s.monthlySpendUsd).toBe(100);
    const u: AccountSnapshot = { currency: 'USD', monthlySpend: 50 };
    await svc.applyFx(u);
    expect(u).toMatchObject({ usdPerUnit: 1, monthlySpendUsd: 50 });
  });

  it('kur okunamazsa ya da baska birim: carpan yok', async () => {
    const svc: any = new AdsSnapshotCollectorService({} as any, {} as any, { getUsdToTryRate: vi.fn(async () => { throw new Error('tcmb'); }) } as any);
    const s: AccountSnapshot = { currency: 'TRY', monthlySpend: 4000 };
    await svc.applyFx(s);
    expect(s.usdPerUnit).toBeUndefined();
    const e: AccountSnapshot = { currency: 'EUR', monthlySpend: 10 };
    await new (AdsSnapshotCollectorService as any)({}, {}).applyFx(e);
    expect(e.usdPerUnit).toBeUndefined();
  });

  it('G16 TRY hesapta kurla esik uygular; tutar hesabin para biriminde yazar', () => {
    const r = G16.check({ currency: 'TRY', usdPerUnit: 1 / 40, searchTerms: terimler } as AccountSnapshot, 'local' as any)!;
    // bosa: yalniz 500 TL (12.5 USD); toplam 2000 → %25 → fail
    expect(r.verdict).toBe('fail');
    expect(r.finding).toContain('25.0%');
    expect(r.finding).toContain('~500 TRY');
  });

  it('G16 kur bilinmiyorsa na', () => {
    const r = G16.check({ currency: 'TRY', searchTerms: terimler } as AccountSnapshot, 'local' as any)!;
    expect(r.verdict).toBe('na');
  });
});
