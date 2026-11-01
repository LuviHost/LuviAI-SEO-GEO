/**
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { splitSeriesByMethod, LEGACY_SUFFIX } from './citation-chart-segments';
import { geoImpact } from '../components/geo-impact';

describe('splitSeriesByMethod — yontem degisiminde seri bolunur', () => {
  const byProvider = {
    openai: [{ date: '2026-10-16', score: 40 }, { date: '2026-11-01', score: 40 }],
    gemini: [{ date: '2026-10-16', score: 20 }, { date: '2026-11-01', score: 60 }],
  };

  it('kesimden onceki nokta eski seride, sonraki guncel seride; ayni satirda ikisi birden dolu degil', () => {
    const { rows, series } = splitSeriesByMethod(byProvider, [
      { provider: 'openai', methodChangedAt: '2026-11-01' },
      { provider: 'gemini', methodChangedAt: '2026-11-01' },
    ]);
    expect(series).toEqual([
      { key: `openai${LEGACY_SUFFIX}`, provider: 'openai', legacy: true },
      { key: 'openai', provider: 'openai', legacy: false },
      { key: `gemini${LEGACY_SUFFIX}`, provider: 'gemini', legacy: true },
      { key: 'gemini', provider: 'gemini', legacy: false },
    ]);
    expect(rows).toEqual([
      { date: '10-16', [`openai${LEGACY_SUFFIX}`]: 40, openai: null, [`gemini${LEGACY_SUFFIX}`]: 20, gemini: null },
      { date: '11-01', [`openai${LEGACY_SUFFIX}`]: null, openai: 40, [`gemini${LEGACY_SUFFIX}`]: null, gemini: 60 },
    ]);
  });

  it('yontem degismediyse tek seri (eski davranis)', () => {
    const { series, rows } = splitSeriesByMethod(byProvider, [{ provider: 'openai', methodChangedAt: null }]);
    expect(series.map((s) => s.key)).toEqual(['openai', 'gemini']);
    expect(rows[0]).toEqual({ date: '10-16', openai: 40, gemini: 20 });
  });

  it('kesim gunu saglayici basina; tarih saat iceriyorsa gun bazinda karsilastirilir', () => {
    const { series } = splitSeriesByMethod(byProvider, [{ provider: 'gemini', methodChangedAt: '2026-11-01T00:00:00.000Z' }]);
    expect(series.map((s) => s.key)).toEqual(['openai', `gemini${LEGACY_SUFFIX}`, 'gemini']);
  });

  it('bos saglayici seri uretmez', () => {
    expect(splitSeriesByMethod({ xai: [] }, []).series).toEqual([]);
  });
});

describe('geoImpact — "N/M asistanda gorunuyorsun" paydasi', () => {
  it('olculmeyen saglayici (son skor yok) paydaya girmez: 4/6, 4/7 degil', () => {
    const trends = [
      { provider: 'anthropic', first: 20, last: 20 },
      { provider: 'gemini', first: 20, last: 20 },
      { provider: 'openai', first: 40, last: 40 },
      { provider: 'perplexity', first: 40, last: 40 },
      { provider: 'xai', first: 0, last: 0 },
      { provider: 'deepseek', first: 0, last: 0 },
      { provider: 'meta', first: null, last: null },
    ].map((t) => ({ ...t, firstDate: '2026-10-16', lastDate: '2026-10-16' }));
    const g = geoImpact({ trends, byProvider: {} });
    expect(g.state).toBe('baseline');
    expect(g.enginesNow).toBe(4);
    expect(g.totalEngines).toBe(6);
  });
});
