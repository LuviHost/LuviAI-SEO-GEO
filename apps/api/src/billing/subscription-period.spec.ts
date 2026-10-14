import { describe, it, expect } from 'vitest';
import { cycleFromDescription, periodEndFrom, periodEndFromInvoice, shouldDowngrade } from './subscription-period.js';

describe('abonelik donemi', () => {
  it('dongu fatura aciklamasindan okunur', () => {
    expect(cycleFromDescription('RanksUp Profesyonel — annual ($3490 @ 41.2)')).toBe('annual');
    expect(cycleFromDescription('RanksUp Profesyonel — monthly ($349 @ 41.2)')).toBe('monthly');
  });

  it('taninmayan ya da bos aciklama aylik sayilir (fazladan erisim verilmez)', () => {
    expect(cycleFromDescription('Eski fatura')).toBe('monthly');
    expect(cycleFromDescription(null)).toBe('monthly');
  });

  it('donem sonu: aylik 30, yillik 365 gun', () => {
    const paid = new Date('2026-10-01T10:00:00Z');
    expect(periodEndFrom(paid, 'monthly').toISOString()).toBe('2026-10-31T10:00:00.000Z');
    expect(periodEndFrom(paid, 'annual').toISOString()).toBe('2027-10-01T10:00:00.000Z');
  });

  it('paidAt yoksa createdAt kullanilir; fatura yoksa null', () => {
    const created = new Date('2026-09-01T00:00:00Z');
    expect(periodEndFromInvoice({ paidAt: null, createdAt: created, description: '— monthly' })?.toISOString())
      .toBe('2026-10-01T00:00:00.000Z');
    expect(periodEndFromInvoice(null)).toBeNull();
  });

  it('donem bitmeden dusurulmez, bitince ya da odeme yoksa dusurulur', () => {
    const now = new Date('2026-10-14T00:00:00Z');
    expect(shouldDowngrade(new Date('2026-10-20T00:00:00Z'), now)).toBe(false);
    expect(shouldDowngrade(new Date('2026-10-13T00:00:00Z'), now)).toBe(true);
    expect(shouldDowngrade(null, now)).toBe(true);
  });
});
