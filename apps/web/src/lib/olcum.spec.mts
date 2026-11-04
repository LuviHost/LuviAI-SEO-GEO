/**
 * Olcum altyapisi paneli: karsilastirma tablosu, olculemeyen hedef, deger metni.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { degerMetni, donusumOlaylari, karsilastirma, rakiptekiKanallar, type OlcumHedef, type OlcumOlay } from './olcum';

const p = (kod: string, ad: string, tur: 'analitik' | 'reklam' | 'etiket') => ({ kod, ad, tur, kimlikler: [], kaynaklar: ['gtm' as const] });
const rapor = (platformlar: ReturnType<typeof p>[], olaylar: OlcumOlay[] = []) =>
  ({ platformlar, olaylar, gtm: [], sunucuTarafli: false });

const SIZ: OlcumHedef = { ad: 'Siz', url: 'https://siz.com/', rakip: false, durum: 'tamam', rapor: rapor([p('gtm', 'GTM', 'etiket'), p('ga4', 'GA4', 'analitik')]) };
const A: OlcumHedef = {
  ad: 'Rakip A', url: 'https://a.com/', rakip: true, durum: 'tamam',
  rapor: rapor([p('ga4', 'GA4', 'analitik'), p('meta', 'Meta', 'reklam'), p('openai_ads', 'ChatGPT', 'reklam')], [
    { ad: 'PageView', platform: 'meta', kaynak: 'gtm' },
    { ad: 'Purchase', platform: 'meta', kaynak: 'gtm', deger: { tur: 'dinamik' } },
  ]),
};
const B: OlcumHedef = { ad: 'Rakip B', url: 'https://b.com/', rakip: true, durum: 'olculemedi', neden: 'Erişim engellendi' };

describe('karsilastirma', () => {
  it('tur sirasiyla satirlar; olculemeyen hedef null (yok denmez)', () => {
    const t = karsilastirma([SIZ, A, B]);
    expect(t.map((s) => s.kod)).toEqual(['ga4', 'meta', 'openai_ads', 'gtm']);
    expect(t.find((s) => s.kod === 'meta')?.hucreler).toEqual([false, true, null]);
    expect(t.find((s) => s.kod === 'ga4')?.hucreler).toEqual([true, true, null]);
  });
});

describe('rakiptekiKanallar', () => {
  it('rakipte olup sizde olmayan reklam kanallari; siz olculemediyseniz bos', () => {
    expect(rakiptekiKanallar([SIZ, A, B])).toEqual([{ ad: 'Meta', rakipler: ['Rakip A'] }, { ad: 'ChatGPT', rakipler: ['Rakip A'] }]);
    expect(rakiptekiKanallar([{ ...SIZ, durum: 'olculemedi', rapor: undefined }, A])).toEqual([]);
  });
});

describe('yardimcilar', () => {
  it('donusumOlaylari sayfa gorunumunu ayiklar', () => {
    expect(donusumOlaylari(A.rapor).map((o) => o.ad)).toEqual(['Purchase']);
    expect(donusumOlaylari(undefined)).toEqual([]);
  });

  it('degerMetni rakami "dosyada yazan" diye verir', () => {
    expect(degerMetni({ tur: 'sabit', sayi: 1500, para: 'TRY' })).toBe('dosyada yazan değer: 1.500 TRY');
    expect(degerMetni({ tur: 'dinamik' })).toBe('değer ödeme anında gönderiliyor');
    expect(degerMetni(undefined)).toBeNull();
  });
});
