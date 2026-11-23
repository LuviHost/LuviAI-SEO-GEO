import { describe, expect, it } from 'vitest';
import { adSoyadAyir, blokBasligi, elleKayitHazirla, isGunuSonra, metneEkle, normalizeEposta } from './elle-kayit.js';

const NOW = new Date('2026-11-23T11:00:00Z'); // Pazartesi 14:00 Istanbul

describe('isGunuSonra', () => {
  it('Cuma gonderim → 4 is gunu sonra Perşembe 10:00 Istanbul', () => {
    const cuma = new Date('2026-11-20T12:00:00Z');
    expect(isGunuSonra(cuma).toISOString()).toBe('2026-11-26T07:00:00.000Z');
  });
  it('Cumartesi gonderim hafta sonunu atlar → Perşembe', () => {
    expect(isGunuSonra(new Date('2026-11-21T09:00:00Z')).toISOString()).toBe('2026-11-26T07:00:00.000Z');
  });
  it('Istanbul gece yarisini gecen UTC aksami ertesi gunden sayilir', () => {
    // 22.11 21:30 UTC = 23.11 00:30 Istanbul (Pazartesi) → Cuma 27.11
    expect(isGunuSonra(new Date('2026-11-22T21:30:00Z')).toISOString()).toBe('2026-11-27T07:00:00.000Z');
  });
});

describe('normalizeEposta / adSoyadAyir', () => {
  it('e-postayi kucuk harfe ceker, mailto: atar, gecersizi reddeder', () => {
    expect(normalizeEposta(' mailto:Ayse.Demir@Kalem.com ')).toBe('ayse.demir@kalem.com');
    expect(normalizeEposta('ayse@kalem')).toBeNull();
    expect(normalizeEposta('')).toBeNull();
  });
  it('tek alana yazilmis tam adi son kelimeden ayirir', () => {
    expect(adSoyadAyir('Ayşe Nur Demir', '')).toEqual({ ad: 'Ayşe Nur', soyad: 'Demir' });
    expect(adSoyadAyir('Ayşe', 'Demir')).toEqual({ ad: 'Ayşe', soyad: 'Demir' });
    expect(adSoyadAyir('Ayşe', '')).toEqual({ ad: 'Ayşe', soyad: '' });
  });
});

describe('elleKayitHazirla', () => {
  it('LinkedIn kaydi: profil linki normalize edilir, hatirlatma varsayilan 4 is gunu', () => {
    const r = elleKayitHazirla({
      ad: 'Ayşe', soyad: 'Demir', firma: 'Kalem', profileUrl: 'linkedin.com/in/ayse-demir?trk=x',
      mesaj: 'Merhaba', gonderimAt: '2026-11-20T12:00:00Z',
    }, NOW);
    expect(r.kanal).toBe('LINKEDIN');
    expect(r.anahtar).toBe('https://www.linkedin.com/in/ayse-demir/');
    expect(r.hatirlatmaAt.toISOString()).toBe('2026-11-26T07:00:00.000Z');
    expect(r.blok).toBe('── 20.11.2026 · LinkedIn ──\nMerhaba');
  });
  it('E-posta kaydi: anahtar mailto, konu baslikta', () => {
    const r = elleKayitHazirla({
      kanal: 'eposta', ad: 'Mert Kaya', firma: 'Zirvo', eposta: 'Mert@Zirvo.com', konu: 'Öneri', mesaj: 'Mert Bey merhaba',
      gonderimAt: '2026-11-20T12:00:00Z',
    }, NOW);
    expect(r.kanal).toBe('EPOSTA');
    expect(r.anahtar).toBe('mailto:mert@zirvo.com');
    expect(r.ad).toBe('Mert');
    expect(r.soyad).toBe('Kaya');
    expect(r.blok.startsWith('── 20.11.2026 · E-posta · Konu: Öneri ──')).toBe(true);
  });
  it('eksik alanlarda acik hata', () => {
    expect(() => elleKayitHazirla({ ad: 'Ayşe', firma: 'Kalem', mesaj: 'x' }, NOW)).toThrow(/profil linki/);
    expect(() => elleKayitHazirla({ kanal: 'EPOSTA', ad: 'Ayşe', firma: 'Kalem', mesaj: 'x', eposta: 'yok' }, NOW)).toThrow(/e-posta/);
    expect(() => elleKayitHazirla({ ad: 'Ayşe', firma: 'Kalem', profileUrl: 'linkedin.com/in/a', mesaj: ' ' }, NOW)).toThrow(/mesaj/);
    expect(() => elleKayitHazirla({ ad: 'Ayşe', firma: 'Kalem', profileUrl: 'linkedin.com/in/a', mesaj: 'x', gonderimAt: '2027-01-01' }, NOW)).toThrow(/ileri/);
  });
  it('verilen hatirlatma tarihi korunur', () => {
    const r = elleKayitHazirla({ ad: 'A', firma: 'B', profileUrl: 'linkedin.com/in/a', mesaj: 'x', hatirlatmaAt: '2026-12-01T07:00:00Z' }, NOW);
    expect(r.hatirlatmaAt.toISOString()).toBe('2026-12-01T07:00:00.000Z');
  });
});

describe('metneEkle', () => {
  it('ikinci mesaj tarih basligiyla sona eklenir; ayni blok iki kez eklenmez', () => {
    const b1 = `${blokBasligi('LINKEDIN', new Date('2026-11-20T12:00:00Z'))}\nİlk`;
    const b2 = `${blokBasligi('LINKEDIN', new Date('2026-11-26T08:00:00Z'))}\nHatırlatma`;
    const m = metneEkle(metneEkle(null, b1), b2);
    expect(m).toBe(`${b1}\n\n${b2}`);
    expect(metneEkle(m, b2)).toBe(m);
  });
});
