import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractImages, classifyAlt } from './image-extract.js';

const PAGE = 'https://x.com/blog/yazi';
const run = (body: string, max?: number) => extractImages(cheerio.load(`<html><body>${body}</body></html>`), PAGE, { max });

describe('extractImages', () => {
  it('absent / empty / present ayrimi; alt="" suslemeye ait sayilir', () => {
    const r = run('<img src="/a.png"><img src="/b.png" alt=""><img src="/c.png" alt="Kırmızı bisiklet">');
    expect(r.stats).toMatchObject({ total: 3, absent: 1, emptyAlt: 1, withAlt: 1, excluded: 0 });
    expect(r.images.map((i) => i.altState)).toEqual(['absent', 'empty', 'present']);
  });

  it('aria-hidden / role=presentation → ariaDecorative, absent DEGIL', () => {
    const r = run('<img src="/a.png" aria-hidden="true"><img src="/b.png" role="presentation">');
    expect(r.stats.absent).toBe(0);
    expect(r.stats.ariaDecorative).toBe(2);
  });

  it('izleme pikseli, kucuk data URI ve kaynaksiz gorsel degerlendirme disi', () => {
    const r = run('<img src="/p.gif" width="1" height="1"><img src="data:image/gif;base64,R0lGOD"><img alt="x">');
    expect(r.stats.excluded).toBe(3);
    expect(r.stats.absent).toBe(0);
    expect(r.images).toEqual([]);
  });

  it('lazy-load: data-src / srcset gercek kaynak olur', () => {
    const r = run('<img src="data:image/gif;base64,R0lGOD" data-src="/gercek.jpg"><img srcset="/k.jpg 300w, /b.jpg 600w">');
    expect(r.images.map((i) => i.src)).toEqual(['https://x.com/gercek.jpg', 'https://x.com/k.jpg']);
    expect(r.stats.excluded).toBe(0);
  });

  it('wp-image id, bagli gorsel, goreli URL, figcaption ve baslik baglami', () => {
    const r = run('<h2>Bakım</h2><figure><a href="/urun"><img class="aligncenter wp-image-123 size-full" src="img/z.webp"></a><figcaption>Zincir yağlama</figcaption></figure>');
    const i = r.images[0];
    expect(i.wpAttachmentId).toBe(123);
    expect(i.linked).toBe(true);
    expect(i.linkHref).toBe('/urun');
    expect(i.src).toBe('https://x.com/blog/img/z.webp');
    expect(i.context.caption).toBe('Zincir yağlama');
    expect(i.context.heading).toBe('Bakım');
    expect(i.srcHash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('ayni sayfada ayni gorsel tek kayit; sayim yine hepsini sayar', () => {
    const r = run('<img src="/logo.png"><img src="/logo.png">');
    expect(r.images).toHaveLength(1);
    expect(r.stats.absent).toBe(2);
  });

  it('sayfa basi sinir: kayit kesilir, sayim kesilmez', () => {
    const body = Array.from({ length: 60 }, (_, i) => `<img src="/g${i}.png">`).join('');
    const r = run(body, 50);
    expect(r.images).toHaveLength(50);
    expect(r.capped).toBe(true);
    expect(r.stats.absent).toBe(60);
  });
});

describe('classifyAlt (WCAG F30 + WebAIM WAVE)', () => {
  it('dosya adi gibi alt', () => {
    expect(classifyAlt('IMG_0023.jpg')).toContain('filename_like');
    expect(classifyAlt('DSC01234')).toContain('filename_like');
    expect(classifyAlt('kirmizi-bisiklet.webp')).toContain('filename_like');
  });
  it('genel kelime alt (TR katlamasi dahil)', () => {
    expect(classifyAlt('Resim')).toEqual(['generic']);
    expect(classifyAlt('GÖRSEL')).toEqual(['generic']);
    expect(classifyAlt('image.')).toEqual(['generic']);
  });
  it('betimleyici alt temiz', () => {
    expect(classifyAlt('Dalmaçyalı yavru top oynuyor')).toEqual([]);
    expect(classifyAlt('2024 satış grafiği')).toEqual([]);
  });
});
