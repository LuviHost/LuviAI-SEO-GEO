import { describe, it, expect } from 'vitest';
import { ozelSorulariOku, OZEL_SORU_SINIRI } from './karne-sorular.js';

describe('ozelSorulariOku', () => {
  it('bos satir ve yorum atlanir, numaralandirma kirpilir, tekrar tek sayilir', () => {
    const metin = [
      '# Avasya — kurumsal BT',
      '',
      '1. İstanbul\'da kurumsal sistem entegratörü firmalar hangileri?',
      '2) Veri merkezi kurulumu yapan Türk firmaları',
      '- 7/24 yönetilen BT hizmeti veren firmalar',
      '  istanbul\'da   kurumsal sistem entegratörü firmalar hangileri?  ',
    ].join('\n');
    expect(ozelSorulariOku(metin)).toEqual([
      'İstanbul\'da kurumsal sistem entegratörü firmalar hangileri?',
      'Veri merkezi kurulumu yapan Türk firmaları',
      '7/24 yönetilen BT hizmeti veren firmalar',
    ]);
  });

  it('7/24 gibi rakamla baslayan soru bozulmaz', () => {
    expect(ozelSorulariOku('7/24 destek veren BT firmaları')).toEqual(['7/24 destek veren BT firmaları']);
  });

  it('sinir ustu hata verir', () => {
    const metin = Array.from({ length: OZEL_SORU_SINIRI + 1 }, (_, i) => `soru ${i}`).join('\n');
    expect(() => ozelSorulariOku(metin)).toThrow(/en fazla/);
  });
});
