import { describe, expect, it } from 'vitest';
import { adayYap, alanAdi } from './places-istemci.js';

describe('adayYap', () => {
  it('kart alanlarini doldurur; web alan adina indirgenir', () => {
    const a = adayYap({
      id: 'ChIJp90X1O8-yhQR', displayName: { text: 'Kent Koleji' }, formattedAddress: 'Gaziemir/İzmir',
      primaryTypeDisplayName: { text: 'Okul' }, rating: 4.2, userRatingCount: 143, websiteUri: 'https://www.kentkoleji.com.tr/',
      googleMapsUri: 'https://maps.google.com/?cid=123', businessStatus: 'OPERATIONAL',
      photos: [{ name: 'places/ChIJp90X1O8-yhQR/photos/AbCdEfGhIjKl', authorAttributions: [{ displayName: 'Ali', uri: 'https://maps.google.com/maps/contrib/9' }] }],
    });
    expect(a).toMatchObject({
      ad: 'Kent Koleji', kategori: 'Okul', puan: 4.2, yorumSayisi: 143, web: 'kentkoleji.com.tr',
      mapsUri: 'https://maps.google.com/?cid=123', kapali: false, foto: null,
      fotoAdi: 'places/ChIJp90X1O8-yhQR/photos/AbCdEfGhIjKl', fotoYazar: { ad: 'Ali', uri: 'https://maps.google.com/maps/contrib/9' },
    });
  });

  it('google disi / javascript: adresler ve gecersiz foto adi istemciye gitmez', () => {
    const a = adayYap({
      id: 'ChIJp90X1O8-yhQR', googleMapsUri: 'javascript:alert(1)', businessStatus: 'CLOSED_PERMANENTLY',
      photos: [{ name: '../../etc', authorAttributions: [{ displayName: 'X', uri: 'https://kotu.example/' }] }],
    });
    expect(a.mapsUri).toBeNull();
    expect(a.fotoAdi).toBeNull();
    expect(a.fotoYazar).toEqual({ ad: 'X', uri: null });
    expect(a.kapali).toBe(true);
    expect(a.puan).toBeNull();
    expect(a.yorumSayisi).toBe(0);
  });

  it('alanAdi', () => {
    expect(alanAdi('https://WWW.Ornek.com/a')).toBe('ornek.com');
    expect(alanAdi('bozuk')).toBeNull();
    expect(alanAdi(null)).toBeNull();
  });
});
