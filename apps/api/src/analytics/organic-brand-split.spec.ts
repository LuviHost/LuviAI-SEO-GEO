import { describe, it, expect } from 'vitest';
import { splitQueriesByBrand, aggregateQueries, dailyUnbrandedShare, brandHostFromUrl } from './organic-brand-split.js';

const q = (query: string, clicks: number, impressions = clicks * 10) => ({ query, clicks, impressions });

describe('splitQueriesByBrand — organik markali/markasiz', () => {
  it('marka adi gecen sorgular markali kovaya, digerleri markasiz; pay tiklama uzerinden', () => {
    const s = splitQueriesByBrand([
      q('kobipratik giris', 80), q('kobipratik', 100), // markali 180
      q('damga vergisi hesaplama', 15), q('yas hesaplama', 5), // markasiz 20
    ], 'Kobipratik');
    expect(s.branded).toEqual({ clicks: 180, impressions: 1800, queries: 2 });
    expect(s.unbranded).toEqual({ clicks: 20, impressions: 200, queries: 2 });
    expect(s.unbrandedClickSharePct).toBe(10);
    expect(s.sampledQueries).toBe(4);
  });

  it('AI tarafiyla AYNI kural: kelime siniri ve TR katlama (Kobipratikci markali sayilmaz, KOBİPRATİK sayilir)', () => {
    const s = splitQueriesByBrand([q('kobipratikci nedir', 3), q('KOBİPRATİK fiyat', 4)], 'Kobipratik');
    expect(s.branded.queries).toBe(1);
    expect(s.unbranded.queries).toBe(1);
  });

  it('tiklama yoksa pay null ("0" degil)', () => {
    expect(splitQueriesByBrand([q('a b c', 0, 50)], 'Kobipratik').unbrandedClickSharePct).toBeNull();
  });

  it('ayni sorgu birden fazla satirda (gun/sayfa) toplanir', () => {
    const agg = aggregateQueries([q('yas hesaplama', 5), q('yas hesaplama', 7), q(' ', 9)]);
    expect(agg).toEqual([{ query: 'yas hesaplama', clicks: 12, impressions: 120 }]);
  });

  it('jenerik turetilmis marka (emlak ← emlak.com): sektor aramasi markasiz, alan adi markali', () => {
    const rows = [
      q('emlak ilanları', 300), q('satılık daire emlak', 100), // sektor aramasi
      q('emlak.com', 50), q('emlak.com giriş', 25), // markanin kendisi
    ];
    // Host'suz eski hesap: her "emlak" gecen sorgu markali → markasiz pay %0 (yanlis)
    expect(splitQueriesByBrand(rows, 'emlak').unbrandedClickSharePct).toBe(0);
    const s = splitQueriesByBrand(rows, 'emlak', 'emlak.com');
    expect(s.branded).toEqual({ clicks: 75, impressions: 750, queries: 2 });
    expect(s.unbranded).toEqual({ clicks: 400, impressions: 4000, queries: 2 });
    expect(s.unbrandedClickSharePct).toBe(84.2);
  });

  it('host jenerik olmayan markayi degistirmez', () => {
    const rows = [q('kobipratik giris', 80), q('damga vergisi hesaplama', 20)];
    expect(splitQueriesByBrand(rows, 'Kobipratik', 'kobipratik.com')).toEqual(splitQueriesByBrand(rows, 'Kobipratik'));
  });
});

describe('brandHostFromUrl — AI olcumunun host normalizasyonu', () => {
  it('www\'suz, kucuk harf; bos/gecersiz girdi', () => {
    expect(brandHostFromUrl('https://www.Emlak.com/ilanlar?x=1')).toBe('emlak.com');
    expect(brandHostFromUrl('https://ornek.com.tr')).toBe('ornek.com.tr');
    expect(brandHostFromUrl(null)).toBeNull();
    expect(brandHostFromUrl('')).toBeNull();
    expect(brandHostFromUrl('Emlak.com')).toBe('emlak.com');
  });
});

describe('dailyUnbrandedShare', () => {
  it('bos queryDetails gunleri atlanir, tarih sirali', () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const out = dailyUnbrandedShare([
      { date: d('2026-08-22'), queryDetails: [q('kobipratik', 10), q('yas hesaplama', 10)] },
      { date: d('2026-08-21'), queryDetails: [] },
      { date: d('2026-08-20'), queryDetails: [q('yas hesaplama', 10)] },
    ], 'Kobipratik');
    expect(out.map((o) => o.date)).toEqual(['2026-08-20', '2026-08-22']);
    expect(out[0].unbrandedSharePct).toBe(100);
    expect(out[1].unbrandedSharePct).toBe(50);
  });

  it('gunluk seri de host ile ayni karari verir (toplamla celismez)', () => {
    const d = new Date('2026-08-22T00:00:00Z');
    const snaps = [{ date: d, queryDetails: [q('emlak ilanları', 30), q('emlak.com', 10)] }];
    expect(dailyUnbrandedShare(snaps, 'emlak')[0].unbrandedSharePct).toBe(0);
    expect(dailyUnbrandedShare(snaps, 'emlak', 'emlak.com')[0].unbrandedSharePct).toBe(75);
  });
});
