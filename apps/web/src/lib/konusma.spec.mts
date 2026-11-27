/**
 * Takip kaydindan sohbet balonlari.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib/konusma.spec.mts
 */
import { describe, expect, it } from 'vitest';
import { konusmaBalonlari, konusmaOzeti } from './konusma';

describe('konusmaBalonlari', () => {
  it('elle kayit bloklari: giden sagda, Gelen solda, saat ve konu okunur', () => {
    const b = konusmaBalonlari({
      messageText: [
        '── 19.11.2026 15:58 · LinkedIn ──', 'Merhaba Ayşe Hanım', '',
        '── 21.11.2026 20:08 · LinkedIn · Gelen ──', 'Gönderebilirsiniz.', '',
        '── 23.11.2026 13:05 · LinkedIn · Konu: Ek: rapor.pdf ──', 'Raporu ekte gönderiyorum.',
      ].join('\n'),
    });
    expect(b.map((x) => [x.yon, x.tarih, x.saat, x.baslik, x.metin])).toEqual([
      ['giden', '19.11.2026', '15:58', null, 'Merhaba Ayşe Hanım'],
      ['gelen', '21.11.2026', '20:08', null, 'Gönderebilirsiniz.'],
      ['giden', '23.11.2026', '13:05', 'Ek: rapor.pdf', 'Raporu ekte gönderiyorum.'],
    ]);
    expect(konusmaOzeti(b)).toBe('2 mesaj · 1 cevap');
  });

  it('eski bicim (saatsiz) ve e-posta konusu', () => {
    const b = konusmaBalonlari({ kanal: 'EPOSTA', messageText: '── 20.11.2026 · E-posta · Konu: Öneri · ikinci kısım ──\nKaan Bey merhaba' });
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ yon: 'giden', tarih: '20.11.2026', saat: null, kanal: 'E-posta', baslik: 'Öneri · ikinci kısım', metin: 'Kaan Bey merhaba' });
  });

  it('botun kaydi: baglanti notu + InMail konusu ayrilir, tarih ISO alanlardan', () => {
    const b = konusmaBalonlari({
      noteText: 'Bağlantı notu metni',
      requestedAt: '2026-09-10T07:45:00Z',
      messageText: '[InMail] Konu satırı\n\nMesaj gövdesi',
      messagedAt: '2026-09-12T08:00:00Z',
    });
    expect(b.map((x) => [x.yon, x.baslik, x.metin, x.tarih, x.saat])).toEqual([
      ['giden', 'Bağlantı notu', 'Bağlantı notu metni', '10.09.2026', '10:45'],
      ['giden', 'InMail: Konu satırı', 'Mesaj gövdesi', '12.09.2026', '11:00'],
    ]);
  });

  it('cevap verdi ama metni yoksa yer tutucu gelen balon; metin varsa eklenmez', () => {
    const b = konusmaBalonlari({ messageText: 'Düz mesaj', messagedAt: '2026-09-12T08:00:00Z', repliedAt: '2026-09-13T08:00:00Z' });
    expect(b.at(-1)).toMatchObject({ yon: 'gelen', yerTutucu: true });
    const c = konusmaBalonlari({ messageText: '── 21.11.2026 20:08 · LinkedIn · Gelen ──\nTamam', repliedAt: '2026-11-21T17:08:00Z' });
    expect(c.filter((x) => x.yon === 'gelen')).toHaveLength(1);
  });

  it('bos kayit', () => {
    expect(konusmaBalonlari({})).toEqual([]);
    expect(konusmaOzeti([])).toBe('—');
  });
});

describe('yazan (iki yonetici, 28.11.2026)', () => {
  it('"· Yazan: Talat" giden balona yazan olarak, konu yine okunur', () => {
    const b = konusmaBalonlari({
      messageText: [
        '── 27.11.2026 14:05 · LinkedIn · Yazan: Talat ──', 'Merhaba Ayşe Hanım', '',
        '── 27.11.2026 15:10 · LinkedIn · Gelen ──', 'Teşekkürler', '',
        '── 27.11.2026 16:00 · E-posta · Yazan: Emir · Konu: Karne ──', 'Ekte',
      ].join('\n'),
    });
    expect(b.map((x) => [x.yon, x.yazan ?? null, x.baslik])).toEqual([
      ['giden', 'Talat', null],
      ['gelen', null, null],
      ['giden', 'Emir', 'Karne'],
    ]);
  });
});
