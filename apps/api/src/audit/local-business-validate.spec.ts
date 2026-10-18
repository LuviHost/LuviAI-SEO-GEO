import { describe, it, expect } from 'vitest';
import { validateLocalBusiness } from './local-business-validate.js';

const FULL = {
  '@type': 'HairSalon',
  name: 'Ornek Kuafor',
  address: { '@type': 'PostalAddress', streetAddress: 'Bagdat Cd. 1', addressLocality: 'Kadikoy', addressRegion: 'Istanbul', postalCode: '34710', addressCountry: 'TR' },
  telephone: '+90 216 555 00 00',
  openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday'], opens: '09:00', closes: '19:00' }],
  geo: { '@type': 'GeoCoordinates', latitude: 40.98765, longitude: 29.03456 },
  priceRange: '₺₺',
  url: 'https://ornekkuafor.com',
  image: 'https://ornekkuafor.com/salon.jpg',
};

const messages = (f: ReturnType<typeof validateLocalBusiness>) => f.map((x) => `${x.level}|${x.message}`);

describe('validateLocalBusiness', () => {
  it('tam dolu HairSalon bulgu uretmez', () => {
    expect(validateLocalBusiness(FULL)).toEqual([]);
  });

  it('LocalBusiness olmayan dugum icin bos', () => {
    expect(validateLocalBusiness({ '@type': 'Organization', name: 'X' })).toEqual([]);
    expect(validateLocalBusiness({ '@type': 'WebSite' })).toEqual([]);
  });

  it('zorunlu alanlar eksikse hata', () => {
    const f = validateLocalBusiness({ '@type': 'Dentist' });
    expect(f.filter((x) => x.level === 'error').map((x) => x.message)).toEqual([
      'Dentist: name eksik — Google için zorunlu alan.',
      'Dentist: address eksik — Google için zorunlu alan (PostalAddress).',
    ]);
  });

  it('duz metin adres, ulke kodsuz telefon, uzun priceRange, goreli url', () => {
    const f = messages(validateLocalBusiness({
      ...FULL, address: 'Bagdat Cd. 1 Kadikoy', telephone: '0216 555 00 00', priceRange: 'x'.repeat(120), url: '/iletisim',
    }));
    expect(f.some((m) => m.startsWith('warning|HairSalon: address düz metin'))).toBe(true);
    expect(f.some((m) => m.startsWith('warning|HairSalon: telephone ülke koduyla yazılmamış'))).toBe(true);
    expect(f.some((m) => m.startsWith('warning|HairSalon: priceRange 120 karakter'))).toBe(true);
    expect(f.some((m) => m.startsWith('warning|HairSalon: url mutlak'))).toBe(true);
  });

  it('geo hassasiyeti: 5 ondalik altinda uyari; ham metinde sondaki sifir korunur', () => {
    expect(messages(validateLocalBusiness({ ...FULL, geo: { latitude: 40.98, longitude: 29.03 } })))
      .toContain('warning|HairSalon: geo: enlem/boylam en az 5 ondalık basamak olmalı (Google); şu an 2.');
    // 40.98760 → JSON.parse 40.9876 yapar; ham blok verilince 5 basamak sayilir
    const raw = '{"@type":"HairSalon","geo":{"latitude":40.98760,"longitude":29.03450}}';
    const parsed = JSON.parse(raw);
    expect(messages(validateLocalBusiness({ ...FULL, geo: parsed.geo }, raw)).some((m) => m.includes('geo:'))).toBe(false);
    expect(messages(validateLocalBusiness({ ...FULL, geo: { latitude: '40.98760', longitude: '29.03450' } })).some((m) => m.includes('geo:'))).toBe(false);
  });

  it('acilis saati bicimi ve eksik onerilen alanlar', () => {
    const f = messages(validateLocalBusiness({
      '@type': 'Restaurant', name: 'R', address: { '@type': 'PostalAddress', streetAddress: 'a', addressLocality: 'b', addressCountry: 'TR' },
      openingHoursSpecification: { dayOfWeek: 'Monday', opens: '9', closes: '18:00' },
    }));
    expect(f).toContain('warning|Restaurant: openingHoursSpecification: opens/closes saatleri hh:mm ya da hh:mm:ss biçiminde olmalı.');
    expect(f).toContain('recommendation|Restaurant: image yok — Google restoran karuseli için görsel zorunlu.');
    expect(f.some((m) => m.startsWith('recommendation|Restaurant: address içinde eksik alanlar: addressRegion, postalCode'))).toBe(true);
    expect(f.some((m) => m.startsWith('recommendation|Restaurant: telephone yok'))).toBe(true);
    expect(f.some((m) => m.startsWith('recommendation|Restaurant: geo'))).toBe(true);
  });

  it('restoran disinda image "istege bagli" diye raporlanir (zorunlu gibi sunulmaz)', () => {
    const noImage: Record<string, unknown> = { ...FULL };
    delete noImage.image;
    expect(messages(validateLocalBusiness(noImage))).toEqual(['recommendation|HairSalon: image yok (isteğe bağlı) — Google bunu yalnız restoran karuselinde zorunlu tutuyor.']);
  });
});
