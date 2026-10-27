import { describe, expect, it } from 'vitest';
import { placeAdresi, profilDenetle, type PlaceDetay } from './gbp-denetim.js';

const TAM: PlaceDetay = {
  id: 'ChIJx',
  displayName: { text: 'Kahve Durağı' },
  primaryType: 'cafe',
  primaryTypeDisplayName: { text: 'Kafe' },
  businessStatus: 'OPERATIONAL',
  googleMapsUri: 'https://maps.google.com/?cid=1',
  formattedAddress: 'Caferağa, Moda Cd. No:1, 34710 Kadıköy/İstanbul, Türkiye',
  addressComponents: [
    { longText: 'Kadıköy', types: ['administrative_area_level_2', 'political'] },
    { longText: 'İstanbul', types: ['administrative_area_level_1', 'political'] },
  ],
  rating: 4.7,
  userRatingCount: 120,
  regularOpeningHours: { weekdayDescriptions: Array.from({ length: 7 }, (_, i) => `gün ${i}`) },
  websiteUri: 'https://www.kahveduragi.com/',
  internationalPhoneNumber: '+90 216 555 11 22',
  photos: Array.from({ length: 10 }, () => ({})),
};

describe('profilDenetle', () => {
  it('eksiksiz ve tutarli profil yuksek puan alir', () => {
    const r = profilDenetle(TAM, {
      siteHost: 'kahveduragi.com',
      siteNap: { phones: ['+902165551122'], addresses: [{ street: null, district: 'Kadıköy', city: 'İstanbul', postalCode: null }], sources: ['json-ld'], businessTypes: ['CafeOrCoffeeShop'] },
    });
    expect(r.puan).toBeGreaterThanOrEqual(95);
    expect(r.maddeler.find((m) => m.kod === 'telefon')?.durum).toBe('iyi');
    expect(r.maddeler.find((m) => m.kod === 'adres')?.durum).toBe('iyi');
    expect(r.ozet).toMatchObject({ ad: 'Kahve Durağı', yorumSayisi: 120, puanOrt: 4.7 });
  });

  it('eksik profil dusuk puan ve eyleme donuk oneri verir', () => {
    const r = profilDenetle({ id: 'x', displayName: { text: 'Firma' }, primaryType: 'establishment' });
    expect(r.puan).toBeLessThan(40);
    for (const kod of ['saatler', 'web', 'telefon', 'yorum-sayisi', 'puan', 'fotograf']) {
      const m = r.maddeler.find((x) => x.kod === kod)!;
      expect(m.durum, kod).toBe('eksik');
      expect(m.oneri.length, kod).toBeGreaterThan(10);
    }
    expect(r.maddeler.find((m) => m.kod === 'kategori')?.durum).toBe('uyari');
  });

  it('siteyle celisen telefon ve baska alan adi uyari verir', () => {
    const r = profilDenetle(TAM, {
      siteHost: 'baskasite.com',
      siteNap: { phones: ['+902129998877'], addresses: [], sources: ['tel-link'], businessTypes: [] },
    });
    expect(r.maddeler.find((m) => m.kod === 'web')?.durum).toBe('uyari');
    expect(r.maddeler.find((m) => m.kod === 'telefon')?.durum).toBe('uyari');
  });

  it('ad kuralina aykiri olabilecek ekleri uyarir; yorum onerisi gating yasagini soyler', () => {
    const r = profilDenetle({ ...TAM, displayName: { text: 'Kahve Durağı | En İyi Kahve Kadıköy' }, userRatingCount: 3 });
    expect(r.maddeler.find((m) => m.kod === 'ad')?.durum).toBe('uyari');
    expect(r.maddeler.find((m) => m.kod === 'yorum-sayisi')?.oneri).toMatch(/HER müşteriye/);
  });

  it('Turkce harfli il/ilce adlari ad kuralinda yakalanir', () => {
    for (const ad of ['Kahve Durağı İstanbul Şube', 'Usta Berber Şişli Merkez', 'Lezzet Sofrası Diyarbakır Mutfağı']) {
      expect(profilDenetle({ ...TAM, displayName: { text: ad } }).maddeler.find((m) => m.kod === 'ad')?.durum, ad).toBe('uyari');
    }
  });

  it('kapali isletme eksik sayilir', () => {
    expect(profilDenetle({ ...TAM, businessStatus: 'CLOSED_PERMANENTLY' }).maddeler.find((m) => m.kod === 'durum')?.durum).toBe('eksik');
  });

  it('placeAdresi il/ilceyi adres bilesenlerinden alir', () => {
    expect(placeAdresi(TAM)).toMatchObject({ district: 'Kadıköy', city: 'İstanbul' });
  });
});

import { yerelSoruOnerisi } from './gbp-yerel.js';
import { parseLocalPromptSpec } from '../audit/local-prompts.js';

describe('yerelSoruOnerisi', () => {
  it('profilden il/ilce/hizmet onerir ve yerel soru dogrulamasindan gecer', () => {
    const o = yerelSoruOnerisi(TAM);
    expect(o).toEqual({ il: 'İstanbul', ilceler: ['Kadıköy'], hizmetler: ['kafe'] });
    expect(parseLocalPromptSpec(o).ok).toBe(true);
  });

  it('kategori ya da il yoksa bos alan doner (kullanici doldurur)', () => {
    expect(yerelSoruOnerisi({ id: 'x' })).toEqual({ il: null, ilceler: [], hizmetler: [] });
  });
});
