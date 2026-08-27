import { describe, it, expect } from 'vitest';
import { checkGeoGate } from '@luviai/shared';

/**
 * WEAK_LEDE kurali: H1'den sonraki ilk anlamli blok cevap tasimali.
 * OpenAI'nin indeksi sayfadan yalniz baslik + ~200 karakter sakliyor
 * (2 bagimsiz kaynak); ilk 200 karakter gorsel/giris klisesi ise makale
 * indekste bos gorunur.
 */
const GOOD_REST = `
## KDV nasıl hesaplanır?
> **Kısa cevap:** Tutarı KDV oranıyla çarpın.

| Oran | Tutar |
|---|---|
| %20 | 200 |

Kaynak: GİB.

*Son güncelleme: 2026-08-27*
`;

const codes = (md: string) => checkGeoGate(md).issues.map((i) => i.code);

describe('checkGeoGate — WEAK_LEDE (H1 sonrasi ilk 200 karakter)', () => {
  it('H1 + Hizli cevap blockquote → gecer', () => {
    expect(codes(`# KDV Hesaplama\n> **Hızlı cevap:** KDV, tutarın oranla çarpımıdır; %20 için tutar × 0,20.\n${GOOD_REST}`)).not.toContain('WEAK_LEDE');
  });

  it('H1 sonrasi ilk blok gorselse → WEAK_LEDE', () => {
    expect(codes(`# KDV Hesaplama\n![Hero](placeholder-hero.webp)\n\nKDV tutar × oran.\n${GOOD_REST}`)).toContain('WEAK_LEDE');
  });

  it('giris klisesiyle baslayan uzun lede → WEAK_LEDE', () => {
    const md = `# KDV Hesaplama\nGünümüzde işletmeler için vergi konuları giderek daha karmaşık hale gelmektedir ve bu yazıda KDV hesaplamanın inceliklerini ele alacağız.\n${GOOD_REST}`;
    expect(codes(md)).toContain('WEAK_LEDE');
  });

  it('H1 ile ilk H2 arasi bos → WEAK_LEDE', () => {
    expect(codes(`# KDV Hesaplama\n${GOOD_REST}`)).toContain('WEAK_LEDE');
  });

  it('H1 yoksa kural uygulanmaz (regresyon yok)', () => {
    expect(codes(GOOD_REST)).not.toContain('WEAK_LEDE');
  });

  it('stats lede alanlarini tasir', () => {
    const r = checkGeoGate(`# KDV\n> **Hızlı cevap:** Tutar × oran.\n${GOOD_REST}`);
    expect(r.stats.ledeHasAnswer).toBe(true);
    expect(r.stats.ledeChars).toBeGreaterThan(0);
  });
});
