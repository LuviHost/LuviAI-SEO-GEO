import { describe, expect, it } from 'vitest';
import { kimlikSorunlari, mailjetMesaj, mesajDenetimi, type EpostaKimlik } from './eposta-sablon.js';

const K: EpostaKimlik = {
  fromEmail: 'emir@ranksup.ai', fromName: 'Emir · RanksUp', replyTo: 'emir@ranksup.ai', gonderenAd: 'Emir Burgazlı',
  gonderenUnvan: 'RanksUp Kurucusu', gonderenAdres: 'Osmangazi/Bursa', mersis: '', kimlik: 'Emirhan Burgazlı · VKN 1 · Osmangazi V.D.',
};

describe('eposta-sablon yasal denetim', () => {
  it('gercek sablonlarla uretilen mesaj denetimden gecer (her sektor)', () => {
    for (const sektor of ['ajans', 'diger', 'finans', 'eticaret-perakende-teknoloji', 'turizm-havayolu-telekom-otomotiv']) {
      const m = mailjetMesaj({ email: 'info@a.com', ad: '', soyad: '', firma: 'Acme', sektor, varyant: 'A' }, { kimlik: K, kampanya: 'kurumsal-2026-10' });
      expect(mesajDenetimi(m, K), sektor).toEqual([]);
      expect(m.TextPart).toContain('Merhaba {{var:firma}} ekibi,');
    }
    expect(kimlikSorunlari(K, ['ajans', 'diger'])).toEqual([]);
  });

  it('ret linki ya da kimlik satiri silinmisse denetim yakalar', () => {
    const m = mailjetMesaj({ email: 'info@a.com', ad: '', soyad: '', firma: 'Acme', sektor: 'ajans', varyant: 'A' }, { kimlik: K, kampanya: 'k' });
    const bozuk = { TextPart: m.TextPart.replace('[[UNSUB_LINK_EN]]', ''), HTMLPart: m.HTMLPart.replace(/VKN 1/g, '') };
    const eksik = mesajDenetimi(bozuk, K);
    expect(eksik.join(' ')).toMatch(/düz metinde ret linki yok/);
    expect(eksik.join(' ')).toMatch(/HTML'de kimlik/);
  });

  it('bosluktan ibaret adres eksik sayilir', () => {
    expect(kimlikSorunlari({ ...K, gonderenAdres: '  ' }, [])).toContain('MAILJET_GONDEREN_ADRES bos');
  });
});
