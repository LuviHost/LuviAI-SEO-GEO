import { describe, it, expect } from 'vitest';
import { contentSignalsFromHtml } from './geo-content-signals.js';

const sayfa = (govde: string, kabuk = '') =>
  `<html><body><nav>Ana sayfa Fiyatlar %50 indirim 3 gün</nav>${kabuk}<article>${govde}</article><footer>© 2026 · 0850 123 45 67</footer></body></html>`;
const kelimeler = (n: number) => Array.from({ length: n }, (_, i) => `kelime${i % 7 === 0 ? '' : 'ler'}`).join(' ');

describe('contentSignals — kanit bloklari', () => {
  it('birimli rakamlar olgu sayilir; ciplak sayi, telefon ve menu/altbilgi sayilmaz', () => {
    const s = contentSignalsFromHtml(sayfa(
      '<p>Kurulum 14 gün sürer, ücret 3.500 TL. Dönüşüm yüzde 40 arttı, hata %12 düştü, hız 2 kat.</p>'
      + '<p>Sayfa 7, 2026 yılı, numara 123.</p>',
    ));
    expect(s.facts).toBe(5);
    expect(s.evidenceScore).toBe(50);
  });

  it('en az 3 satir ve 3 sutunlu tablo karsilastirmadir (25); yalniz "karşılaştırma" kelimesi 10', () => {
    const tablo = '<table><tr><th>Özellik</th><th>A</th><th>B</th></tr><tr><td>x</td><td>1</td><td>2</td></tr><tr><td>y</td><td>3</td><td>4</td></tr></table>';
    expect(contentSignalsFromHtml(sayfa(tablo)).evidenceScore).toBe(25);
    expect(contentSignalsFromHtml(sayfa('<p>SEO ile GEO karşılaştırması</p>')).evidenceScore).toBe(10);
    // Iki sutunlu duzen tablosu karsilastirma degil
    expect(contentSignalsFromHtml(sayfa('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr><tr><td>e</td><td>f</td></tr></table>')).hasComparison).toBe(false);
  });

  it('3+ maddeli sirali liste ya da 3 numarali baslik adim blogudur', () => {
    expect(contentSignalsFromHtml(sayfa('<ol><li>a</li><li>b</li><li>c</li></ol>')).hasSteps).toBe(true);
    expect(contentSignalsFromHtml(sayfa('<ol><li>a</li><li>b</li></ol>')).hasSteps).toBe(false);
    expect(contentSignalsFromHtml(sayfa('<h2>1. Hedef seç</h2><h2>2. Ölç</h2><h2>Adım 3: Yayınla</h2>')).hasSteps).toBe(true);
  });

  it('kanit puani 100 ile sinirli', () => {
    const tam = '<p>' + Array.from({ length: 9 }, (_, i) => `${i + 1} gün`).join(', ') + '</p>'
      + '<table><tr><th>a</th><th>b</th><th>c</th></tr><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>4</td><td>5</td><td>6</td></tr></table>'
      + '<ol><li>a</li><li>b</li><li>c</li></ol>';
    expect(contentSignalsFromHtml(sayfa(tam)).evidenceScore).toBe(100);
  });

  it('menu ve altbilgideki rakam kanit sayilmaz (yalniz ana metin)', () => {
    expect(contentSignalsFromHtml(sayfa('<p>Merhaba</p>')).facts).toBe(0);
  });
});

describe('contentSignals — icerik derinligi', () => {
  it('ince sayfa 0; 1000+ kelime ve 6+ alt baslik 100; daha uzunu ekstra odul almaz', () => {
    expect(contentSignalsFromHtml(sayfa(`<p>${kelimeler(170)}</p>`)).depthScore).toBe(0);
    const bolumler = Array.from({ length: 6 }, (_, i) => `<h2>Bölüm ${i}</h2><p>${kelimeler(170)}</p>`).join('');
    const uzun = contentSignalsFromHtml(sayfa(bolumler));
    expect(uzun.words).toBeGreaterThanOrEqual(1000);
    expect(uzun.sections).toBe(6);
    expect(uzun.depthScore).toBe(100);
    const cokUzun = Array.from({ length: 6 }, (_, i) => `<h2>Bölüm ${i}</h2><p>${kelimeler(800)}</p>`).join('');
    expect(contentSignalsFromHtml(sayfa(cokUzun)).depthScore).toBe(100);
  });

  it('ara basamaklar: 600 kelime + 3 baslik = 0.7*70 + 0.3*60', () => {
    const s = contentSignalsFromHtml(sayfa(`<h2>a</h2><h2>b</h2><h3>c</h3><p>${kelimeler(620)}</p>`));
    expect(s.depthScore).toBe(Math.round(70 * 0.7 + 60 * 0.3));
  });

  it('article yoksa main, o da yoksa body olculur; script/style metni sayilmaz', () => {
    const html = `<html><body><main><p>${kelimeler(320)}</p><script>${kelimeler(5000)}</script></main></body></html>`;
    const s = contentSignalsFromHtml(html);
    expect(s.words).toBeGreaterThanOrEqual(320);
    expect(s.words).toBeLessThan(400);
  });
});

describe('contentSignals — buyuk girdide dogrusal', () => {
  it('2 MB bosluksuz harf ve rakam dizisi bir saniyenin altinda biter', () => {
    const t0 = Date.now();
    contentSignalsFromHtml(`<html><body><p>${'a'.repeat(1_000_000)}</p><p>${'1'.repeat(1_000_000)}</p></body></html>`);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
