import { describe, it, expect } from 'vitest';
import { extractRawAnchors, sitemapLocs, assessJsFreeDiscovery, normalizeUrlKey } from './js-free-discovery.js';

const BASE = 'https://example.com';
const urlset = (paths: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="x">${paths.map((p) => `<url><loc>https://www.example.com${p}</loc></url>`).join('')}</urlset>`;
const html = (hrefs: string[]) => `<html><body>${hrefs.map((h) => `<a href="${h}">x</a>`).join('')}</body></html>`;

describe('normalizeUrlKey', () => {
  it('protokol / www / sondaki slash / hash farklarini yok sayar', () => {
    expect(normalizeUrlKey('http://www.Example.com/blog/#top')).toBe('example.com/blog');
    expect(normalizeUrlKey('https://example.com/blog')).toBe('example.com/blog');
    expect(normalizeUrlKey('https://example.com/')).toBe('example.com/');
  });
});

describe('extractRawAnchors', () => {
  it('goreli ve mutlak origin-ici linkleri toplar, dis/mailto/#/js linklerini eler, tekrarlari birlestirir', () => {
    const out = extractRawAnchors(html([
      '/blog', 'https://www.example.com/blog/', '/about#team', 'mailto:a@b.c', '#', 'javascript:void(0)',
      'https://other.com/x', "/contact", 'tel:123',
    ]), BASE);
    expect(out.sort()).toEqual(['example.com/about', 'example.com/blog', 'example.com/contact']);
  });

  it('tek tirnakli ve tirnaksiz href de okunur', () => {
    const out = extractRawAnchors(`<a href='/a'>1</a><a href=/b>2</a>`, BASE);
    expect(out.sort()).toEqual(['example.com/a', 'example.com/b']);
  });
});

describe('sitemapLocs', () => {
  it('urlset loc listesi', () => {
    expect(sitemapLocs(urlset(['/a', '/b']))).toEqual({ isIndex: false, locs: ['https://www.example.com/a', 'https://www.example.com/b'] });
  });
  it('sitemapindex isaretlenir', () => {
    const r = sitemapLocs('<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>');
    expect(r.isIndex).toBe(true);
    expect(r.locs).toEqual(['https://example.com/s1.xml']);
  });
});

describe('assessJsFreeDiscovery', () => {
  it('sitemapindex → olculemedi (alt sitemap loc\'lari sayfa degil)', () => {
    const r = assessJsFreeDiscovery(html(['/a']), '<sitemapindex><sitemap><loc>https://example.com/s.xml</loc></sitemap></sitemapindex>', BASE);
    expect(r.applicable).toBe(false);
    expect(r.internalLinks).toBe(1);
  });

  it('sitemap URL\'si yok → olculemedi', () => {
    expect(assessJsFreeDiscovery(html(['/a']), '', BASE).applicable).toBe(false);
  });

  it('ana sayfa bos → olculemedi', () => {
    expect(assessJsFreeDiscovery('', urlset(['/a']), BASE).applicable).toBe(false);
  });

  it('kesisim >= %20 → ok (www farki normalize edilir)', () => {
    const r = assessJsFreeDiscovery(html(['/a', '/b']), urlset(['/a', '/b', '/c', '/d', '/e', '/f', '/g', '/h', '/i', '/j']), BASE);
    expect(r.applicable).toBe(true);
    expect(r.overlap).toBe(2); expect(r.sampled).toBe(10);
    expect(r.ok).toBe(true);
  });

  it('az link + sifir kesisim → JS-bagimli kesif suphesi (ok=false)', () => {
    const r = assessJsFreeDiscovery(html(['/x', '/y']), urlset(['/a', '/b', '/c', '/d', '/e']), BASE);
    expect(r.ok).toBe(false);
    expect(r.overlap).toBe(0);
  });

  it('>=10 ic link varsa kesisim dusuk olsa da ok (az sayfali sitemap / buyuk nav)', () => {
    const links = Array.from({ length: 12 }, (_, i) => `/nav-${i}`);
    const r = assessJsFreeDiscovery(html(links), urlset(['/a', '/b', '/c', '/d', '/e']), BASE);
    expect(r.ok).toBe(true);
  });

  it('orneklem 50 ile sinirli', () => {
    const many = Array.from({ length: 80 }, (_, i) => `/p${i}`);
    const r = assessJsFreeDiscovery(html(['/p0']), urlset(many), BASE);
    expect(r.sampled).toBe(50);
    expect(r.sitemapUrls).toBe(80);
  });
});
