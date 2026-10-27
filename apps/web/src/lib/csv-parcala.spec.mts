/** Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib */
import { describe, expect, it } from 'vitest';
import { csvParcala } from './csv-parcala';

describe('csvParcala', () => {
  it('basligi her parcada tekrarlar, butceyi asmaz, satir kaybetmez', () => {
    const satirlar = Array.from({ length: 100 }, (_, i) => `info@f${i}.com,,,"Firma ${i}, A.Ş.",ajans`);
    const csv = '﻿email,ad,soyad,firma,sektor\r\n' + satirlar.join('\r\n') + '\r\n';
    const p = csvParcala(csv, 1_000);
    expect(p.length).toBeGreaterThan(1);
    for (const x of p) {
      expect(x.startsWith('email,ad,soyad,firma,sektor\n')).toBe(true);
      expect(x.length).toBeLessThanOrEqual(1_000);
    }
    expect(p.flatMap((x) => x.split('\n').slice(1))).toEqual(satirlar);
  });

  it('tirnak icindeki satir sonu parcayi bolmez', () => {
    const csv = 'email,not\na@b.com,"iki\nsatir"\nc@d.com,x';
    expect(csvParcala(csv, 10_000)).toEqual([csv]);
  });
});
