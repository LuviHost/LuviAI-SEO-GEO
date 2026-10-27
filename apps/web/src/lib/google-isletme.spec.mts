/**
 * Google Isletme Profili panel/karne yardimcilari.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import {
  gbpHataMetni, gonderiDurumu, listeAyir, maddeleriSirala, puanEtiketi, yorumlariSirala,
} from './google-isletme';
import type { GbpYorum } from './api';

describe('puanEtiketi', () => {
  it('sinirlar 85 / 70 / 50', () => {
    expect(puanEtiketi(100)).toEqual({ etiket: 'Güçlü profil', ton: 'success' });
    expect(puanEtiketi(85).etiket).toBe('Güçlü profil');
    expect(puanEtiketi(84).etiket).toBe('İyi, eksikleri var');
    expect(puanEtiketi(70).ton).toBe('success');
    expect(puanEtiketi(69)).toEqual({ etiket: 'Geliştirilmeli', ton: 'warning' });
    expect(puanEtiketi(50).ton).toBe('warning');
    expect(puanEtiketi(49)).toEqual({ etiket: 'Zayıf profil', ton: 'danger' });
    expect(puanEtiketi(0).ton).toBe('danger');
  });

  it('gecersiz sayi zayif sayilir', () => {
    expect(puanEtiketi(Number.NaN).ton).toBe('danger');
  });
});

describe('maddeleriSirala', () => {
  it('eksik → uyari → bilgi → iyi, ayni durumda agirlik buyuk once; girdi degismez', () => {
    const girdi = [
      { kod: 'a', durum: 'iyi' as const, agirlik: 20 },
      { kod: 'b', durum: 'uyari' as const, agirlik: 5 },
      { kod: 'c', durum: 'eksik' as const, agirlik: 8 },
      { kod: 'd', durum: 'uyari' as const, agirlik: 12 },
      { kod: 'e', durum: 'bilgi' as const, agirlik: 8 },
    ];
    expect(maddeleriSirala(girdi).map((m) => m.kod)).toEqual(['c', 'd', 'b', 'e', 'a']);
    expect(girdi[0].kod).toBe('a');
  });
});

describe('yorumlariSirala', () => {
  const y = (reviewId: string, tarih: string | null, yanit: string | null): GbpYorum =>
    ({ reviewId, yazar: '', yildiz: 5, metin: '', tarih, yanit, yanitTarih: null });

  it('yanitsizlar once, her grupta yeni once', () => {
    const s = yorumlariSirala([
      y('eski-yanitli', '2026-01-01T00:00:00Z', 'tesekkurler'),
      y('eski-yanitsiz', '2026-02-01T00:00:00Z', null),
      y('yeni-yanitli', '2026-10-01T00:00:00Z', 'tesekkurler'),
      y('yeni-yanitsiz', '2026-10-02T00:00:00Z', null),
      y('tarihsiz-yanitsiz', null, null),
    ]);
    expect(s.map((x) => x.reviewId)).toEqual(['yeni-yanitsiz', 'eski-yanitsiz', 'tarihsiz-yanitsiz', 'yeni-yanitli', 'eski-yanitli']);
  });
});

describe('listeAyir / gonderiDurumu', () => {
  it('virgul ve satir sonu ile ayirir, bosluklari atar', () => {
    expect(listeAyir(' Kadıköy, Üsküdar\nBeşiktaş ,, ')).toEqual(['Kadıköy', 'Üsküdar', 'Beşiktaş']);
  });

  it('bilinen durum kodlari Turkce', () => {
    expect(gonderiDurumu('LIVE')).toBe('Yayında');
    expect(gonderiDurumu('REJECTED')).toBe('Reddedildi');
    expect(gonderiDurumu('')).toBe('Bilinmiyor');
  });
});

describe('gbpHataMetni', () => {
  it('sunucunun Turkce 429 hak mesaji korunur', () => {
    const m = 'Bu site için bugünkü denetim hakkı doldu; yarın tekrar deneyin.';
    expect(gbpHataMetni({ status: 429, message: m }, 'panel')).toBe(m);
  });

  it('throttler 429 Turkce metne cevrilir', () => {
    expect(gbpHataMetni({ status: 429, message: 'ThrottlerException: Too Many Requests' }, 'panel')).toMatch(/bir dakika/);
    expect(gbpHataMetni({ status: 429, message: 'ThrottlerException: Too Many Requests' }, 'public')).toMatch(/karnesi hakkınız doldu/);
  });

  it('503: Turkce mesaj korunur, ham mesaj genel metne duser', () => {
    const m = 'Google İşletme denetimi bugünlük kapasiteye ulaştı; yarın tekrar deneyin.';
    expect(gbpHataMetni({ status: 503, message: m }, 'public')).toBe(m);
    expect(gbpHataMetni({ status: 503, message: 'Service Unavailable' }, 'public')).toMatch(/kapasiteye/);
  });

  it('400 mesaji oldugu gibi; baglanti hatasi ve mesajsiz hata genel', () => {
    expect(gbpHataMetni({ status: 400, message: 'Önce Google İşletme Profili’nizi seçin.' }, 'panel')).toBe('Önce Google İşletme Profili’nizi seçin.');
    expect(gbpHataMetni({ status: 0, message: 'x' }, 'public')).toMatch(/İnternet/);
    expect(gbpHataMetni(null, 'panel')).toMatch(/tamamlanamadı/);
  });
});
