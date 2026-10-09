import { describe, it, expect } from 'vitest';
import { deterministicQaIssues } from './qa-deterministic.js';
import { stripHeroPlaceholder, isHeroPlaceholder, applyHeroImageToJsonLd } from './hero-placeholder.js';

const LONG = Array.from({ length: 320 }, (_, i) => `kelime${i}`).join(' ');
const types = (r: { blockers: { type: string }[]; warnings: { type: string }[] }) => ({
  blockers: r.blockers.map((i) => i.type),
  warnings: r.warnings.map((i) => i.type),
});

describe('deterministicQaIssues', () => {
  it('yazar sablonunun hero yer tutucusu tek basina ENGEL DEGIL (eski hata: her makale BLOCKED)', () => {
    const body = `# Baslik\n\n> **Hızlı cevap:** ...\n\nGiris paragrafi.\n\n![Hero](placeholder-hero.webp)\n\n## Bolum\n\n${LONG}`;
    expect(types(deterministicQaIssues({ heroImageUrl: null }, body)).blockers).toEqual([]);
  });

  it('baska placeholder gorsel hala engel', () => {
    const body = `${LONG}\n\n![Grafik](placeholder-chart.png)`;
    expect(types(deterministicQaIssues({}, body)).blockers).toContain('placeholder_image');
  });

  it('bos URL li gorsel hala engel', () => {
    expect(types(deterministicQaIssues({}, `${LONG}\n\n![Grafik]()`)).blockers).toContain('placeholder_image');
  });

  it('hero ALANI placeholder ise engel (yayinda kirik gorsel)', () => {
    expect(types(deterministicQaIssues({ heroImageUrl: 'placeholder-hero.webp' }, LONG)).blockers).toContain('placeholder_image');
  });

  it('alt metni bos gercek gorsel → uyari, engel degil', () => {
    const r = types(deterministicQaIssues({}, `${LONG}\n\n![](https://cdn.example.com/a.png)`));
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toContain('image_alt_empty');
  });

  it('alt metni dolu gorsel → uyari yok', () => {
    const r = types(deterministicQaIssues({}, `${LONG}\n\n![Dalmaçyalı yavru top oynuyor](https://cdn.example.com/a.png)`));
    expect(r.warnings).not.toContain('image_alt_empty');
  });

  it('sablon kalintisi ve mock icerik engel kalir', () => {
    expect(types(deterministicQaIssues({}, `${LONG} {{marka_adi}}`)).blockers).toContain('template_leak');
    expect(types(deterministicQaIssues({}, `${LONG} MOCK ARTICLE`)).blockers).toContain('mock_content');
  });
});

describe('hero-placeholder', () => {
  it('yer tutucu satirini bos satir birakmadan siler, digerine dokunmaz', () => {
    const md = 'Giris.\n\n![Hero](placeholder-hero.webp)\n\n## H2\n\n![Grafik](placeholder-chart.png)';
    expect(stripHeroPlaceholder(md)).toBe('Giris.\n\n\n## H2\n\n![Grafik](placeholder-chart.png)');
  });

  it('satir ici ve bosluklu varyantlar da silinir; publisher regexiyle ayni eslesme', () => {
    expect(stripHeroPlaceholder('a ![x]( placeholder-hero.webp ) b')).toBe('a  b');
  });

  it('yer tutucu yoksa metni aynen dondurur', () => {
    const md = '![Gercek](https://a/b.webp)';
    expect(stripHeroPlaceholder(md)).toBe(md);
  });

  it('JSON-LD: yer tutucu image → gercek mutlak URL; hero yoksa alan silinir', () => {
    const hero = 'https://ranksup.ai/blog/x/hero.webp';
    const a: any[] = [{ '@type': 'BlogPosting', image: 'placeholder-hero.webp' }, { '@type': 'BreadcrumbList' }];
    expect(applyHeroImageToJsonLd(a, hero)).toBe(1);
    expect(a[0].image).toBe(hero);
    expect(a[1].image).toBeUndefined();

    const b: any[] = [{ '@type': 'Article', image: 'placeholder-hero.webp' }];
    expect(applyHeroImageToJsonLd(b, null)).toBe(1);
    expect('image' in b[0]).toBe(false);
  });

  it('JSON-LD: image hic yoksa Article a eklenir, gercek image a dokunulmaz', () => {
    const hero = 'https://ranksup.ai/blog/x/hero.webp';
    const a: any[] = [{ '@type': ['Article'], headline: 'x' }, { '@type': 'Article', image: 'https://cdn/a.png' }];
    expect(applyHeroImageToJsonLd(a, hero)).toBe(1);
    expect(a[0].image).toBe(hero);
    expect(a[1].image).toBe('https://cdn/a.png');
    expect(applyHeroImageToJsonLd(a, hero)).toBe(0); // idempotent
  });

  it('isHeroPlaceholder: goreli ve mutlak yol', () => {
    expect(isHeroPlaceholder('placeholder-hero.webp')).toBe(true);
    expect(isHeroPlaceholder('https://x.com/blog/placeholder-hero.webp')).toBe(true);
    expect(isHeroPlaceholder('https://x.com/blog/a/hero.webp')).toBe(false);
    expect(isHeroPlaceholder(null)).toBe(false);
  });
});
