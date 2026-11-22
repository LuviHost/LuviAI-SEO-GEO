import { describe, it, expect } from 'vitest';
import {
  brandMatcher, cleanBrandAliases, containsBrand, resolveSiteBrandFamily, MAX_BRAND_ALIASES,
} from './brand-in-query.js';
import { foldForMatch } from '../common/text-normalize.js';
import { markaAdiKirilimi } from '../client-report/client-report.service.js';
import { markaAdlariCumlesi } from '../client-report/client-report-build.js';

/** buildProbe ile ayni cagri: katlanmis metin + ayni uzunluktaysa katlanmamis metin */
const hitIn = (m: ReturnType<typeof brandMatcher>, text: string) => {
  const folded = foldForMatch(text);
  return m.matchInFolded(folded, folded.length === text.length ? text : null);
};

describe('marka ailesi — temizleme', () => {
  it('tekrar, ana adla ayni, cok kisa ve dize olmayan adlar atilir', () => {
    expect(cleanBrandAliases(['Token', 'token', ' Beko ', 'tokeninc', 'T1', 42, '', 'Token Sign'], 'tokeninc'))
      .toEqual(['Token', 'Beko', 'Token Sign']);
  });
  it('dizi degilse bos; en fazla MAX_BRAND_ALIASES ad', () => {
    expect(cleanBrandAliases(null)).toEqual([]);
    expect(cleanBrandAliases('Token')).toEqual([]);
    const cok = Array.from({ length: 30 }, (_, i) => `Marka${i}`);
    expect(cleanBrandAliases(cok)).toHaveLength(MAX_BRAND_ALIASES);
  });
  it('site satirindan aile: ana ad eski kuralla, digerleri temizlenmis', () => {
    expect(resolveSiteBrandFamily({ name: 'tokeninc', url: 'https://www.tokeninc.com', brandAliases: ['Token', 'Beko'] }))
      .toEqual({ name: 'tokeninc', aliases: ['Token', 'Beko'] });
    expect(resolveSiteBrandFamily({ name: 'ai', url: 'https://ranksup.ai', brandAliases: null }))
      .toEqual({ name: 'ranksup', aliases: [] });
  });
});

describe('marka ailesi — cevapta eslesme', () => {
  const aile = brandMatcher({ name: 'tokeninc', aliases: ['Token', 'Beko'] }, 'tokeninc.com');

  it('diger adla anilma yakalanir ve hangi ad oldugu doner', () => {
    expect(hitIn(aile, 'Yazar kasa POS icin Beko X30 TR iyi bir secenek.')?.name).toBe('Beko');
    expect(hitIn(aile, 'Token Finansal Teknolojiler bu alanda lider.')?.name).toBe('Token');
  });
  it('ana ad eski kuralla (buyuk harf aranmaz) yakalanir', () => {
    expect(hitIn(aile, 'Detaylar icin tokeninc sayfasina bakin.')?.name).toBe('tokeninc');
  });
  it('metinde ilk gecen ad doner', () => {
    const t = 'Beko 300 TR cihazlari Token tarafindan uretiliyor.';
    const hit = hitIn(aile, t)!;
    expect(hit.name).toBe('Beko');
    expect(hit.start).toBe(0);
  });
  it('buyuk harf kurali: kucuk harfli siradan "token" kelimesi sayilmaz', () => {
    expect(hitIn(aile, 'Kart bilgisi token haline getirilir, guvenlidir.')).toBeNull();
    // ayni metinde ozel ad da varsa o sayilir
    expect(hitIn(aile, 'Kart bilgisi token olur. Token cihazlari bunu destekler.')?.name).toBe('Token');
  });
  it('kelime siniri: "Tokenizasyon" Token sayilmaz', () => {
    expect(hitIn(aile, 'Tokenizasyon odeme guvenligini artirir.')).toBeNull();
  });
  it('Turkce ekli kullanim sayilir ("Beko\'nun")', () => {
    expect(hitIn(aile, "Beko'nun yazar kasalari yaygin.")?.name).toBe('Beko');
  });
  it('kucuk harfle yazilan diger adda buyuk harf aranmaz', () => {
    const m = brandMatcher({ name: 'ornekmarka', aliases: ['ornekurun'] });
    expect(hitIn(m, 'Ornekurun ve ornekurun ayni.')?.name).toBe('ornekurun');
  });
  it('diger ad yoksa sonuc eski tek adli eslesmeyle ayni', () => {
    const eski = brandMatcher('Kobipratik', 'kobipratik.com');
    const t = 'Bu konuda kobipratik iyi bir kaynak.';
    expect(hitIn(eski, t)?.index).toBe(eski.indexInFolded(foldForMatch(t)));
    expect(hitIn(eski, 'Hicbir marka yok.')).toBeNull();
  });
});

describe('marka ailesi — soruda marka (brandInQuery)', () => {
  const aile = { name: 'tokeninc', aliases: ['Token', 'Beko'] };
  it('soruda diger ad gecerse soru markali sayilir — buyuk harf aranmaz (tutucu yon)', () => {
    expect(containsBrand('beko yazar kasa nasil kullanilir?', aile, 'tokeninc.com')).toBe(true);
    expect(containsBrand('Hangi yazar kasa POS alinir?', aile, 'tokeninc.com')).toBe(false);
  });
  it('host verilmeden de aile adlari aranir', () => {
    expect(containsBrand('Beko 300 TR fiyati', aile)).toBe(true);
  });
});

describe('marka ailesi — rapor ad kirilimi', () => {
  it('yalniz markasiz ve adi bilinen anilmalar sayilir; cok gecenden aza', () => {
    const takip = [
      { brandMentioned: true, brandInQuery: false, brandMatch: 'Beko' },
      { brandMentioned: true, brandInQuery: false, brandMatch: 'Beko' },
      { brandMentioned: true, brandInQuery: true, brandMatch: 'Beko' },
      { brandMentioned: true, brandInQuery: false, brandMatch: null },
      { brandMentioned: false, brandInQuery: false, brandMatch: null },
    ];
    const kosum = [{ probes: [{ brandMentioned: true, brandInQuery: false, brandMatch: 'Token' }, { brandMentioned: false }] }, { probes: null }];
    expect(markaAdiKirilimi(takip, kosum)).toEqual([{ ad: 'Beko', cevap: 2 }, { ad: 'Token', cevap: 1 }]);
    expect(markaAdiKirilimi([], undefined)).toEqual([]);
  });
  it('ozet cumlesi: sifirlar atilir, ad yoksa cumle yok', () => {
    expect(markaAdlariCumlesi([{ ad: 'Beko', cevap: 9 }, { ad: 'Token', cevap: 4 }, { ad: 'X', cevap: 0 }]))
      .toBe('Marka adı geçmeyen sorulara verilen cevaplarda markanız şu adlarla anıldı: Beko (9 cevap) ve Token (4 cevap).');
    expect(markaAdlariCumlesi([])).toBeNull();
    expect(markaAdlariCumlesi(undefined)).toBeNull();
  });
});
