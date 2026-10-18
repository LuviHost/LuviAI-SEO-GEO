import { describe, it, expect } from 'vitest';
import { extractTrPhones, formatTrPhone, normalizeTrPhone } from './tr-phone.js';

describe('normalizeTrPhone — E.164 (+90 + 10 haneli NSN)', () => {
  it('ayni numaranin farkli yazimlari tek bicime iner', () => {
    for (const raw of [
      '0216 123 45 67', '(0216) 123 45 67', '0 216 123 45 67', '0216-123-4567', '02161234567',
      '+90 216 123 45 67', '+90 (216) 123-4567', '+902161234567', '0090 216 123 45 67',
      '90 216 123 45 67', '216 123 45 67', '+90 (0216) 123 45 67',
      'tel:+902161234567', 'tel:%2B90%20216%20123%2045%2067', 'TEL:02161234567;ext=12',
    ]) {
      expect(normalizeTrPhone(raw), raw).toBe('+902161234567');
    }
  });

  it('mobil, 0850 ve 444 numaralari', () => {
    expect(normalizeTrPhone('0532 123 45 67')).toBe('+905321234567');
    expect(normalizeTrPhone('0 (555) 000 11 22')).toBe('+905550001122');
    expect(normalizeTrPhone('0850 222 0 444')).toBe('+908502220444');
    expect(normalizeTrPhone('444 0 448')).toBe('+904440448');
    expect(normalizeTrPhone('+90 444 0 448')).toBe('+904440448');
    expect(normalizeTrPhone('0444 12 34')).toBe('+904441234');
  });

  it('plana uymayan ya da Turkiye disi numara null', () => {
    expect(normalizeTrPhone('0612 123 45 67')).toBeNull(); // 6xx alan kodu yok
    expect(normalizeTrPhone('0299 123 45 67')).toBeNull(); // 299 cografi kod degil
    expect(normalizeTrPhone('1234567')).toBeNull(); // 7 hane ama 444 degil
    expect(normalizeTrPhone('+44 20 7946 0958')).toBeNull();
    expect(normalizeTrPhone('123')).toBeNull();
    expect(normalizeTrPhone('')).toBeNull();
    expect(normalizeTrPhone(undefined)).toBeNull();
    expect(normalizeTrPhone('0216 123 45')).toBeNull();
  });
});

describe('formatTrPhone', () => {
  it('okunur bicim', () => {
    expect(formatTrPhone('+902161234567')).toBe('+90 216 123 45 67');
    expect(formatTrPhone('+904440448')).toBe('+90 444 04 48');
    expect(formatTrPhone('gecersiz')).toBe('gecersiz');
  });
});

describe('extractTrPhones', () => {
  it('metindeki numaralari sirayla ve tekrarsiz bulur', () => {
    const text = 'Salon X — Tel: 0216 123 45 67, cep: +90 532 111 22 33. Tekrar: (0216) 123-45-67';
    expect(extractTrPhones(text).map((p) => p.e164)).toEqual(['+902161234567', '+905321112233']);
  });

  it('bosluklu yazilmis yan yana iki numarayi ayirir', () => {
    expect(extractTrPhones('Telefon: 0216 123 45 67 0532 111 22 33').map((p) => p.e164)).toEqual(['+902161234567', '+905321112233']);
  });

  it('tarih, fiyat, posta kodu ve IBAN numara sanilmaz', () => {
    const text = '05.03.2024 tarihinde 1.250 TL. Adres: No:12, 34710 Kadıköy. IBAN TR12 0006 4000 0011 2345 6789 01. Sipariş ID2161234567';
    expect(extractTrPhones(text)).toEqual([]);
  });

  it('adresteki tek basina rakam ("Kat 5", "No:5", "5.", "4.5") sahte mobil numara uretip gercegini yutmaz', () => {
    const e = (t: string) => extractTrPhones(t).map((p) => p.e164);
    // Eskiden "5" + sonraki 9 hane → +905021612345 (sahte mobil), gercek numara kayboluyordu
    expect(e('Bağdat Cad. Kat 5 (0216) 123 45 67')).toEqual(['+902161234567']);
    expect(e('Moda Cad. No:5 - 0216 123 45 67')).toEqual(['+902161234567']);
    expect(e('No 5 0 216 123 45 67')).toEqual(['+902161234567']);
    expect(e('5. 0532 111 22 33')).toEqual(['+905321112233']);
    expect(e('Puan 4.5 (0532) 111 22 33')).toEqual(['+905321112233']);
    expect(e('Daire 5 216 123 45 67')).toEqual(['+902161234567']);
  });

  it('kapı numarası bir alan koduna benzese de yeni numaranın başı sınır sayılır', () => {
    const e = (t: string) => extractTrPhones(t).map((p) => p.e164);
    expect(e('Atatürk Blv. No:312 0216 123 45 67')).toEqual(['+902161234567']);
    expect(e('No:512 0216 123 45 67')).toEqual(['+902161234567']);
    expect(e('No:312 0 216 123 45 67')).toEqual(['+902161234567']);
  });

  it('gerçek yazımlar bozulmaz: ülke kodu + (0216), 0090, 444 ve 0850 grupları', () => {
    const e = (t: string) => extractTrPhones(t).map((p) => p.e164);
    expect(e('+90 (0216) 123 45 67')).toEqual(['+902161234567']);
    expect(e('0090 216 123 45 67')).toEqual(['+902161234567']);
    expect(e('00 90 532 111 22 33')).toEqual(['+905321112233']);
    expect(e('Çağrı merkezi: 444 0 448')).toEqual(['+904440448']);
    expect(e('444 0 212')).toEqual(['+904440212']);
    expect(e('0850 222 0 444')).toEqual(['+908502220444']);
    expect(e('0850 252 0 252')).toEqual(['+908502520252']);
  });

  it('alan koduyla yazılmış 444 numarası 7 haneli 444 numarasıdır (site ve AI cevabı aynı numaraya iner)', () => {
    expect(normalizeTrPhone('0212 444 0 448')).toBe('+904440448');
    expect(normalizeTrPhone('+90 216 444 12 34')).toBe('+904441234');
    expect(extractTrPhones('Moda Cad. No:212 444 0 448').map((p) => p.e164)).toEqual(['+904440448']);
    // Mobil ve 0850 numaralarında 444 abone hanesidir, dokunulmaz
    expect(normalizeTrPhone('0532 444 12 34')).toBe('+905324441234');
    expect(normalizeTrPhone('0850 444 0 444')).toBe('+908504440444');
  });

  it('"+"sız 90 kapı numarası olabilir: ardından gelen 0850 numarası bozulmaz', () => {
    expect(extractTrPhones('Moda Cad. No:90 0850 222 0 444').map((p) => p.e164)).toEqual(['+908502220444']);
  });

  it('KKTC (+90 392) tek numara sayılır; kalan rakamlardan sahte 444 numarası çıkmaz', () => {
    expect(extractTrPhones('Lefkoşa: +90 392 444 55 66').map((p) => p.e164)).toEqual(['+903924445566']);
    expect(extractTrPhones('Girne şubesi 0392 815 12 34').map((p) => p.e164)).toEqual(['+903928151234']);
    expect(normalizeTrPhone('+90 392 611 51 02')).toBe('+903926115102');
    expect(formatTrPhone('+903926115102')).toBe('+90 392 611 51 02');
  });

  it('Türkiye dışı uluslararası numaradan Türkiye numarası uydurulmaz', () => {
    expect(extractTrPhones('New York: +1 212 555 0100')).toEqual([]);
    expect(extractTrPhones('London +44 20 7946 0958')).toEqual([]);
    expect(extractTrPhones('001 212 555 0100')).toEqual([]);
  });

  it('konum bilgisi (index) yakinlik hesabi icin doner', () => {
    const text = 'Ara: 444 0 448';
    const [p] = extractTrPhones(text);
    expect(p.e164).toBe('+904440448');
    expect(text.slice(p.index, p.index + p.raw.length)).toBe('444 0 448');
  });
});
