/**
 * F43 — silme/bağlantı ekranı hangi hesabın etkilendiğini maskeli e-postayla gösterir.
 * Çalıştırma: cd mobile && ../apps/api/node_modules/.bin/vitest run --root . src
 */
import { describe, expect, it } from 'vitest';
import { initialsFrom, maskEmail } from './account';

describe('maskEmail', () => {
  it('yerel kısmın ilk harfini ve alan adını gösterir', () => {
    expect(maskEmail('emir@gmail.com')).toBe('e***@gmail.com');
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
    expect(maskEmail('  Foo.Bar@Example.com ')).toBe('F***@Example.com');
  });

  it('Apple "E-postamı Gizle" adresini tanınır bırakır (ayrı hesap olduğu görülsün)', () => {
    expect(maskEmail('x7k2abc9@privaterelay.appleid.com')).toBe('x***@privaterelay.appleid.com');
  });

  it('geçersiz ya da boş girdide boş döner', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail(null)).toBe('');
    expect(maskEmail(undefined)).toBe('');
    expect(maskEmail('adres-yok')).toBe('');
    expect(maskEmail('@gmail.com')).toBe('');
    expect(maskEmail('emir@')).toBe('');
  });
});

describe('initialsFrom', () => {
  it('ad-soyaddan iki harf, tek addan bir harf', () => {
    expect(initialsFrom('Emir Burgazli')).toBe('EB');
    expect(initialsFrom('Ali Veli Yılmaz')).toBe('AY');
    expect(initialsFrom('emir')).toBe('E');
  });

  it('Türkçe büyük harf kuralı (i → İ)', () => {
    expect(initialsFrom('irem işık')).toBe('İİ');
  });

  it('ad yoksa e-postanın ilk harfi, ikisi de yoksa boş', () => {
    expect(initialsFrom(null, 'kobi@ornek.com')).toBe('K');
    expect(initialsFrom('   ', 'kobi@ornek.com')).toBe('K');
    expect(initialsFrom(null, null)).toBe('');
  });
});
