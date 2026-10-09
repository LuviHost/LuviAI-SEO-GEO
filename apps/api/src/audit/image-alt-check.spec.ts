import { describe, it, expect } from 'vitest';
import { computeImageAltCheck, IMAGE_ALT_METHOD_VERSION } from './image-alt-check.js';

const stats = (s: Partial<Record<'total' | 'withAlt' | 'emptyAlt' | 'absent' | 'ariaDecorative' | 'suspicious' | 'excluded', number>>) => ({
  total: 0, withAlt: 0, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0, ...s,
});

describe('computeImageAltCheck (yontem v2)', () => {
  it('yalnizca alt="" (suslemeye ait) → 100, sorun yok (v1 bunu cezalandiriyordu)', () => {
    const r = computeImageAltCheck([{ url: 'https://x.com/', imageAltStats: stats({ total: 5, emptyAlt: 5 }) }]);
    expect(r.score).toBe(100);
    expect(r.issues).toEqual([]);
    expect(r.details?.methodVersion).toBe(IMAGE_ALT_METHOD_VERSION);
  });

  it('alt attribute u olmayan gorsel → image_alt_missing + sayfa listesi', () => {
    const r = computeImageAltCheck([
      { url: 'https://x.com/a', imageAltStats: stats({ total: 4, withAlt: 3, absent: 1 }) },
      { url: 'https://x.com/b', imageAltStats: stats({ total: 2, withAlt: 2 }) },
    ]);
    expect(r.score).toBe(83);
    expect(r.issues.map((i) => [i.type, i.severity])).toEqual([['image_alt_missing', 'info']]);
    expect(r.details?.missingAltPages).toEqual(['https://x.com/a']);
  });

  it('alt siz oran yariyi asarsa warning', () => {
    const r = computeImageAltCheck([{ url: 'https://x.com/', imageAltStats: stats({ total: 3, absent: 2, withAlt: 1 }) }]);
    expect(r.issues[0].severity).toBe('warning');
  });

  it('supheli alt bilgi olarak raporlanir, skoru dusurmez', () => {
    const r = computeImageAltCheck([{ url: 'https://x.com/s', imageAltStats: stats({ total: 2, withAlt: 2, suspicious: 1 }) }]);
    expect(r.score).toBe(100);
    expect(r.issues.map((i) => i.type)).toEqual(['image_alt_suspicious']);
    expect(r.details?.suspiciousPages).toEqual(['https://x.com/s']);
  });

  it('degerlendirme disi gorseller paydaya girmez; hic icerik gorseli yoksa 100', () => {
    const r = computeImageAltCheck([{ url: 'https://x.com/', imageAltStats: stats({ total: 3, excluded: 3 }) }]);
    expect(r.score).toBe(100);
  });
});
