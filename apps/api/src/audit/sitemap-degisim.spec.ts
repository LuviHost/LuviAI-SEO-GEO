import { describe, it, expect } from 'vitest';
import { childSitemaps, newestLastmod, submitKarari } from './sitemap-degisim.js';

describe('site haritasi degisim karari', () => {
  it('en yeni lastmod (gun ve tam zaman karisik, bozuk deger atlanir)', () => {
    const xml = '<urlset><url><lastmod>2026-11-20</lastmod></url><url><lastmod>2026-11-24T10:00:00+03:00</lastmod></url><url><lastmod>bozuk</lastmod></url></urlset>';
    expect(newestLastmod(xml)?.toISOString()).toBe('2026-11-24T07:00:00.000Z');
    expect(newestLastmod('<urlset><url><loc>x</loc></url></urlset>')).toBeNull();
  });

  it('dizin dosyasinin alt site haritalari; urlset ise bos', () => {
    const idx = '<sitemapindex><sitemap><loc>https://www.kobipratik.com/sitemap-full.xml</loc></sitemap><sitemap><loc>https://api.kobipratik.com/api/sitemap/xml?a=1&amp;b=2</loc></sitemap></sitemapindex>';
    expect(childSitemaps(idx)).toEqual(['https://www.kobipratik.com/sitemap-full.xml', 'https://api.kobipratik.com/api/sitemap/xml?a=1&b=2']);
    expect(childSitemaps('<urlset><url><loc>https://a.com/</loc></url></urlset>')).toEqual([]);
  });

  it('kobipratik 24.11: gonderim 16:04, en yeni lastmod ayni gun → gonderme; ertesi gun yayin → gonder', () => {
    expect(submitKarari(new Date('2026-11-24'), '2026-11-24T16:04:15.883Z').gonder).toBe(false);
    expect(submitKarari(new Date('2026-11-25'), '2026-11-24T16:04:15.883Z').gonder).toBe(true);
  });

  it('hic gonderilmemis → gonder; tarih yoksa → gonderme', () => {
    expect(submitKarari(null, null).gonder).toBe(true);
    expect(submitKarari(null, '2026-11-24T16:04:15Z').gonder).toBe(false);
  });
});
