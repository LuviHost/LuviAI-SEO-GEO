import { describe, it, expect } from 'vitest';
import { deletionCompletedEmail, deletionRequestedEmail, selamla } from './account-deletion.emails.js';

/**
 * Apple ile Giris adi yalniz ilk yetkilendirmede (ve paylasilirsa) verir; adi
 * bos hesap olagan. Eski yedek kelime 'merhaba' oldugu icin iki yasal e-posta
 * "Merhaba merhaba," ile basliyordu.
 */
describe('hesap silme e-postalari — selamlama', () => {
  it.each([null, undefined, '', '   '])('ad yoksa (%j) yalniz "Merhaba,"', (name) => {
    const talep = deletionRequestedEmail({ name, purgeAfterText: '17 Kasım 2026' }).html;
    const bitti = deletionCompletedEmail({ name }).html;
    for (const html of [talep, bitti]) {
      expect(html).toContain('Merhaba, RanksUp');
      expect(html.toLowerCase()).not.toContain('merhaba merhaba');
    }
  });

  it('ad varsa kirpilip kacislanarak yazilir', () => {
    expect(selamla('  Ayşe  ')).toBe('Merhaba Ayşe');
    expect(selamla('<b>x</b>')).toBe('Merhaba &lt;b&gt;x&lt;/b&gt;');
    expect(deletionCompletedEmail({ name: 'Ayşe' }).html).toContain('Merhaba Ayşe, RanksUp hesabın');
  });

  it('hesap e-postasi verilince silinen hesap adiyla yazilir; verilmezse satir yok', () => {
    expect(deletionRequestedEmail({ email: 'x@privaterelay.appleid.com', purgeAfterText: '1 Ocak 2027' }).html)
      .toContain('Hesap: <strong>x@privaterelay.appleid.com</strong>');
    expect(deletionCompletedEmail({ email: 'a@b.co' }).html).toContain('Hesap: <strong>a@b.co</strong>');
    expect(deletionCompletedEmail({}).html).not.toContain('Hesap: <strong>');
  });

  it('abonelik satiri yalniz gercekten iptal edildiyse "Aboneliğin iptal edildi" der', () => {
    expect(deletionRequestedEmail({ purgeAfterText: 'x', subscriptionCanceled: true }).html).toContain('Aboneliğin iptal edildi');
    const yok = deletionRequestedEmail({ purgeAfterText: 'x' }).html;
    expect(yok).not.toContain('Aboneliğin iptal edildi');
    expect(yok).toContain('otomatik yenileme kapatıldı');
  });
});
