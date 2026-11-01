import { describe, it, expect } from 'vitest';
import { brandInOrganicQuery, splitQueriesByBrand } from './organic-brand-split.js';

/**
 * Bosluklu / bitisik marka yazimi: kullanici markayi "ornekpratik" de
 * "ornek pratik" de yazar. Ikisi de markali; kelime siniri korunur.
 */
describe('brandInOrganicQuery — bosluklu marka yazimi', () => {
  it('bitisik marka, ayri yazilmis sorguyu bulur (ve tersi)', () => {
    expect(brandInOrganicQuery('ornek pratik giris', 'Ornekpratik', 'ornekpratik.com')).toBe(true);
    expect(brandInOrganicQuery('ornek-pratik', 'Ornekpratik', 'ornekpratik.com')).toBe(true);
    expect(brandInOrganicQuery('ornekpratik hesaplama', 'Ornek Pratik', 'ornekpratik.com')).toBe(true);
    expect(brandInOrganicQuery("ornekpratik'in araclari", 'Ornek Pratik')).toBe(true);
  });

  it('kelime siniri korunur; markasiz sorgu markasiz kalir', () => {
    expect(brandInOrganicQuery('ornekpratikci nedir', 'Ornekpratik')).toBe(false);
    expect(brandInOrganicQuery('ornek pratikler', 'Ornekpratik')).toBe(false);
    expect(brandInOrganicQuery('yas hesaplama', 'Ornekpratik')).toBe(false);
  });

  it('jenerik alan adi modunda (emlak ← emlak.com) bosluk birlestirme uygulanmaz', () => {
    expect(brandInOrganicQuery('em lak ilanlari', 'emlak', 'emlak.com')).toBe(false);
  });

  it('splitQueriesByBrand bosluklu yazimi markali kovaya koyar', () => {
    const s = splitQueriesByBrand(
      [
        { query: 'ornekpratik', clicks: 100, impressions: 1000 },
        { query: 'ornek pratik', clicks: 50, impressions: 500 },
        { query: 'damga vergisi hesaplama', clicks: 850, impressions: 9000 },
      ],
      'Ornekpratik',
      'ornekpratik.com',
    );
    expect(s.branded).toEqual({ clicks: 150, impressions: 1500, queries: 2 });
    expect(s.unbrandedClickSharePct).toBe(85);
  });
});
