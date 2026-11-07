import { describe, it, expect } from 'vitest';
import { GeneratorsService } from './generators.service.js';

/**
 * 08.11.2026 kanit denetimi: musterinin sitesine yazilan llms.txt AI
 * asistanlarina dair etki iddiasi tasimaz (Google llms.txt'i yok sayiyor;
 * hangi asistanin dosyayi okudugu aciklanmis degil).
 */
describe('generateLlmsTxt — iddiasiz giris cumlesi', () => {
  const crawl: any = {
    baseUrl: 'https://kuafor.com/',
    pages: [
      { url: 'https://kuafor.com/', title: 'Kuaför', h1: 'Kuaför', metaDescription: 'Bursa kuaför salonu' },
      { url: 'https://kuafor.com/fiyat', title: 'Fiyat', h1: 'Fiyatlar', metaDescription: 'Hizmet fiyatları' },
    ],
  };
  const txt = new GeneratorsService().generateLlmsTxt(crawl, 'Kuaför', 'Bursa kuaför salonu');

  it('notr giris: "Bu dosya sitenin içerik özetidir."', () => {
    expect(txt).toContain('Bu dosya sitenin içerik özetidir.');
  });

  it('AI asistanlarina dair vaat yok', () => {
    expect(txt).not.toMatch(/doğru ve güncel bilgi|AI search asistan|ChatGPT|Perplexity|Gemini|Claude/);
  });

  it('icerik ozeti korunur (baslik, sayfalar, marka bilgisi)', () => {
    expect(txt.startsWith('# Kuaför\n\n> Bursa kuaför salonu\n\n')).toBe(true);
    expect(txt).toContain('- [Fiyatlar](https://kuafor.com/fiyat): Hizmet fiyatları');
    expect(txt).toContain('## Marka Bilgisi');
  });
});
