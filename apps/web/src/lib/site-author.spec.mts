/**
 * Site yazari formu: ad zorunlu, yalniz http(s) adres, satir basina profil, tekrar yok.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_AUTHOR_FORM, authorToForm, formToAuthor } from './site-author';

describe('site yazari formu', () => {
  it('ad zorunlu', () => {
    expect(formToAuthor({ ...EMPTY_AUTHOR_FORM, name: '  ' })).toEqual({ error: 'Yazar adı zorunlu.' });
  });
  it('gecerli form API govdesine doner; bos alanlar gonderilmez', () => {
    expect(formToAuthor({ name: ' Ayşe  Yılmaz ', jobTitle: '', url: '', sameAs: '' })).toEqual({ author: { name: 'Ayşe Yılmaz' } });
    expect(formToAuthor({
      name: 'Ayşe', jobTitle: 'Mali müşavir', url: 'https://ornek.com/yazar/ayse',
      sameAs: 'https://linkedin.com/in/ayse\nhttps://linkedin.com/in/ayse\n https://x.com/ayse ',
    })).toEqual({ author: { name: 'Ayşe', jobTitle: 'Mali müşavir', url: 'https://ornek.com/yazar/ayse', sameAs: ['https://linkedin.com/in/ayse', 'https://x.com/ayse'] } });
  });
  it('http(s) disi adres reddedilir', () => {
    expect(formToAuthor({ ...EMPTY_AUTHOR_FORM, name: 'A', url: 'javascript:alert(1)' })).toHaveProperty('error');
    expect(formToAuthor({ ...EMPTY_AUTHOR_FORM, name: 'A', sameAs: 'linkedin.com/in/a' })).toEqual({ error: 'Geçersiz profil adresi: linkedin.com/in/a' });
  });
  it('kayit forma geri doner', () => {
    expect(authorToForm(null)).toEqual(EMPTY_AUTHOR_FORM);
    expect(authorToForm({ name: 'A', sameAs: ['https://a.com', 'https://b.com'] })).toEqual({ name: 'A', jobTitle: '', url: '', sameAs: 'https://a.com\nhttps://b.com' });
  });
});
