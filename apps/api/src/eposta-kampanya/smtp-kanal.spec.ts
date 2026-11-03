import { describe, expect, it } from 'vitest';
import { bizimKimlikler, doldur, dsnAyikla, dsnMi, kaliciRet, kanal, smtpAyar, smtpMesaj, smtpSorunlari, yanitTuru } from './smtp-kanal.js';
import { kimlikEnv } from '../prospect/eposta-sablon.js';

const ENV = {
  EPOSTA_KANAL: 'smtp', EPOSTA_SMTP_HOST: 'mail.getranksup.com', EPOSTA_SMTP_USER: 'emir@getranksup.com', EPOSTA_SMTP_PASS: 'x',
  MAILJET_GONDEREN_ADRES: 'Osmangazi/Bursa', MAILJET_KIMLIK: 'Ad Soyad · VKN 1 · Osmangazi V.D.',
};

describe('smtp ayari', () => {
  it('kanal yalniz EPOSTA_KANAL=smtp ile degisir', () => {
    expect(kanal({})).toBe('mailjet');
    expect(kanal({ EPOSTA_KANAL: 'SMTP' })).toBe('smtp');
  });

  it('varsayilanlar: 465 TLS, gonderen = kullanici, IMAP ayni sunucu', () => {
    const a = smtpAyar(ENV);
    expect(a).toMatchObject({ port: 465, secure: true, from: 'emir@getranksup.com', imapHost: 'mail.getranksup.com', imapPort: 993 });
    expect(smtpSorunlari(a)).toEqual([]);
    expect(smtpAyar({ ...ENV, EPOSTA_SMTP_PORT: '587' }).secure).toBe(false);
  });

  it('ranksup.ai (ve alt alan adlari) soguk gonderimde reddedilir; eksik ayarlar adlariyla', () => {
    expect(smtpSorunlari(smtpAyar({ ...ENV, EPOSTA_SMTP_FROM: 'emir@ranksup.ai' })).join()).toMatch(/ranksup\.ai/);
    expect(smtpSorunlari(smtpAyar({ ...ENV, EPOSTA_SMTP_FROM: 'a@teklif.ranksup.ai' })).join()).toMatch(/ranksup\.ai/);
    expect(smtpSorunlari(smtpAyar({}))).toEqual(expect.arrayContaining(['EPOSTA_SMTP_HOST yok', 'EPOSTA_SMTP_PASS yok']));
  });
});

describe('mesaj', () => {
  const h = { email: 'Info@Firma.com.tr', firma: 'Firma Reklam A.Ş.', marka: 'Firma', sektor: 'ajans', varyant: 'A', web: 'firma.com.tr' };

  it('duz metin, doldurulmus degiskenler, imzali ret linki + tek tik ret basliklari', () => {
    const a = smtpAyar(ENV);
    const m = smtpMesaj(h, kimlikEnv(ENV), a, 'sir', 'https://api.ranksup.ai', 'rs' + 'a'.repeat(24));
    expect(m.to).toBe('info@firma.com.tr');
    expect(m.from.address).toBe('emir@getranksup.com');
    expect(m.messageId).toBe(`<rs${'a'.repeat(24)}@getranksup.com>`);
    expect(m.subject).toMatch(/^[^{}]{6,}$/);
    expect(m.text).toContain('Merhaba Firma ekibi,');
    expect(m.text).toContain('VKN 1');
    expect(m.text).toMatch(/https:\/\/api\.ranksup\.ai\/api\/eposta\/ret\?e=info%40firma\.com\.tr&t=/);
    expect(m.text).not.toMatch(/\{\{|\[\[/);
    expect(m.headers['List-Unsubscribe']).toMatch(/^<https:\/\/api\.ranksup\.ai\/api\/eposta\/ret\?.*>, <mailto:emir@getranksup\.com\?subject=ret>$/);
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('doldurulamayan etiket hata verir', () => {
    expect(() => doldur('Merhaba {{firma}} {{yok}}', { firma: 'X' })).toThrow(/yok/);
  });

  it('yalniz RCPT 5xx kalici sayilir', () => {
    expect(kaliciRet({ responseCode: 550 })).toBe(true);
    expect(kaliciRet({ responseCode: 451 })).toBe(false);
    expect(kaliciRet({ code: 'ECONNECTION' })).toBe(false);
  });
});

describe('gelen kutusu', () => {
  const DSN = [
    'Content-Type: multipart/report; report-type=delivery-status; boundary="b"',
    '',
    '--b',
    'Content-Type: message/delivery-status',
    '',
    'Reporting-MTA: dns; sv1.luvihost.com',
    '',
    'Final-Recipient: rfc822; info@yok.com.tr',
    'Action: failed',
    'Status: 5.1.1',
    '',
    'Final-Recipient: rfc822;<gecici@firma.com>',
    'Action: delayed',
    'Status: 4.4.1',
    '',
    'Final-Recipient: rfc822; dolu@firma.com',
    'Action: failed',
    'Status: 4.2.2',
    '--b--',
  ].join('\r\n');

  it('DSN: yalniz failed alicilar; 5.x.x kalici, 4.x.x degil; delayed hic sayilmaz', () => {
    expect(dsnAyikla(DSN)).toEqual([
      { alici: 'info@yok.com.tr', kalici: true, durum: '5.1.1' },
      { alici: 'dolu@firma.com', kalici: false, durum: '4.2.2' },
    ]);
    expect(dsnMi({ contentType: 'multipart/report; report-type=delivery-status; boundary="b"' })).toBe(true);
    expect(dsnMi({ from: 'mailer-daemon@sv1.luvihost.com', subject: 'Mail delivery failed: returning message to sender' })).toBe(true);
    expect(dsnMi({ from: 'ali@firma.com', subject: 'Re: teklif' })).toBe(false);
  });

  it('yanit turu: ret yalniz konu "ret" ya da ilk satirlarda; alintilanmis orijinal metin sayilmaz', () => {
    expect(yanitTuru('ret', '')).toBe('ret');
    expect(yanitTuru('Re: Firma — AI görünürlük', 'Lütfen bizi listeden çıkarın.\n')).toBe('ret');
    expect(yanitTuru('Re: Firma — AI görünürlük', 'Merhaba, görüşelim. Salı uygun.\n\n> Listeden çıkmak için: https://...\n> ret')).toBe('yanit');
  });

  it('In-Reply-To/References icinden bizim kimliklerimiz', () => {
    const k = 'rs' + 'b'.repeat(24);
    expect(bizimKimlikler(`<${k}@getranksup.com>`, '<baska@x.com> <rs123@y>')).toEqual([k]);
  });
});
