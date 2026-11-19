import { describe, expect, it, vi } from 'vitest';
import { AdsAuditService, ADS_AUDIT_MAX_USD_DEFAULT, adsAuditMaxUsd, COST_CAP_FINDING } from './ads-audit.service.js';
import type { AuditRule } from './rules/types.js';

/** Denetimin model asamasi USD tavani (18.11.2026, sahip: "limit 5 dolar") */
const kural = (i: number): AuditRule => ({
  id: `X${i}`, name: `kural ${i}`, category: 'structure' as any, severity: 'medium',
  check: () => null, llm: true, llmPrompt: () => 'degerlendir',
});

describe('Kampanya Skoru maliyet tavani', () => {
  it('varsayilan 5 USD; env ile degisir, gecersiz deger varsayilan', () => {
    expect(ADS_AUDIT_MAX_USD_DEFAULT).toBe(5);
    expect(adsAuditMaxUsd({})).toBe(5);
    expect(adsAuditMaxUsd({ ADS_AUDIT_MAX_USD: '2' })).toBe(2);
    expect(adsAuditMaxUsd({ ADS_AUDIT_MAX_USD: 'abc' })).toBe(5);
  });

  it('tavana yaklasinca kalan kurallar modele gitmez, na + not alir; harcama tavani asmaz', async () => {
    // her cagri 0.4 USD: 5'li partiler 2 + 2 = 4 USD; ucuncu parti (2 USD) tavani asardi → durur
    const chat = vi.fn(async () => ({ output: '{"verdict":"pass","finding":"ok","recommendation":""}', costUsd: 0.4 }));
    const svc: any = new AdsAuditService({} as any, {} as any, { chat } as any);
    const kurallar = Array.from({ length: 20 }, (_, i) => kural(i));
    const snap = { currency: 'TRY', campaigns: [{ id: 'c1', name: 'Arama', budget: 100 }], searchTerms: [{ term: 'pos', cost: 10, conversions: 1 }, { term: 'kredi', cost: 5, conversions: 0 }, { term: 'kart', cost: 3, conversions: 0 }] };
    const out = await svc.runLlmRules(kurallar, snap, 's1');
    expect(chat).toHaveBeenCalledTimes(10);
    expect(out).toHaveLength(20);
    const kesilen = out.filter((r: any) => r.finding === COST_CAP_FINDING);
    expect(kesilen).toHaveLength(10);
    expect(kesilen.every((r: any) => r.verdict === 'na')).toBe(true);
    expect(out.some((r: any) => 'costUsd' in r)).toBe(false);
  });
});
