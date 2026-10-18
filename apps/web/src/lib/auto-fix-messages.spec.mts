/**
 * Kok dosya duzeltmesi bildirimleri: sitede dogrulanamayan yazim duz basari
 * sayilmaz; wrong_root / root_unverified Turkce metinle doner.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { AUTO_FIX_ERROR_TEXT, autoFixErrorText, autoFixMessages, type AutoFixNowResult } from './api';

describe('autoFixMessages', () => {
  it('yuklenip canlida gorunmeyen dosya verified degil, API nedeniyle unverified', () => {
    const neden = 'llms.txt yüklendi ama https://ornek.com/llms.txt adresinde henüz görünmüyor; önbellek (CDN) olabilir. Birkaç dakika sonra yeniden kontrol et.';
    const r: AutoFixNowResult = {
      applied: ['sitemap', 'llms'],
      files: [
        { fix: 'sitemap', filename: 'sitemap.xml', content: '<urlset/>', verified: true, action: 'create' },
        { fix: 'llms', filename: 'llms.txt', content: '# ornek', verified: false, action: 'create' },
      ],
      unverified: [{ fix: 'llms', filename: 'llms.txt', url: 'https://ornek.com/llms.txt', reason: neden }],
    };
    const m = autoFixMessages(r);
    expect(m.applied).toEqual(['sitemap', 'llms']);
    expect(m.verified).toEqual(['sitemap']);
    expect(m.unverifiedFixes).toEqual(['llms']);
    expect(m.unverified).toEqual([neden]);
  });

  it('dogrulama kaniti yoksa (files yok) "dogrulandi" denmez', () => {
    const m = autoFixMessages({ applied: ['sitemap'] }, () => 'sitemap.xml');
    expect(m.verified).toEqual([]);
    expect(m.unverified).toEqual(['sitemap.xml yüklendi ama sitede görünüp görünmediği doğrulanamadı.']);
  });

  it('wrong_root / root_unverified: API metni oldugu gibi, metin yoksa kodun Turkce karsiligi', () => {
    const apiMetni = 'Yayın hedefinin yazdığı klasör ek.com sitesini sunmuyor: doğrulama dosyası yüklendi ama https://ek.com/ranksup-verify.txt adresinde görünmedi.';
    const m = autoFixMessages({
      applied: [],
      errors: [
        { fix: 'sitemap', code: 'wrong_root', error: apiMetni },
        { fix: 'llms', code: 'root_unverified', error: '' },
      ],
    });
    expect(m.errors).toEqual([`sitemap: ${apiMetni}`, `llms: ${AUTO_FIX_ERROR_TEXT.root_unverified}`]);
    expect(m.verified).toEqual([]);
  });

  it("write_failed 'unknown' yer tutucusu Turkce metne doner", () => {
    expect(autoFixErrorText({ code: 'write_failed', error: 'unknown' })).toBe(AUTO_FIX_ERROR_TEXT.write_failed);
    expect(autoFixErrorText({ code: 'bilinmeyen_kod', error: '' })).toBe('Düzeltme uygulanmadı (ayrıntı dönmedi).');
  });
});
