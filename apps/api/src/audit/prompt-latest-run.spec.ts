import { describe, expect, it } from 'vitest';
import { buildLatestRun, LATEST_RUN_EXCERPT_MAX, LATEST_RUN_SOURCES_MAX, type LatestRunRow } from './prompt-latest-run.js';
import { buildCompetitorMatchers } from './source-domain-types.js';

const ctx = { ownHost: 'ranksup.ai', competitors: buildCompetitorMatchers(['https://rakip.com']) };
const labels = { openai: 'OpenAI ChatGPT', anthropic: 'Anthropic Claude', perplexity: 'Perplexity', gemini: 'Google Gemini' };

function row(over: Partial<LatestRunRow>): LatestRunRow {
  return {
    provider: 'openai',
    date: new Date('2026-10-25T00:00:00Z'),
    createdAt: new Date('2026-10-25T00:36:00Z'),
    cited: false,
    brandMentioned: false,
    brandInQuery: false,
    position: null,
    sentiment: null,
    excerpt: null,
    competitors: null,
    sources: null,
    sourcesVersion: 1,
    ...over,
  };
}

describe('buildLatestRun', () => {
  it('olcum yoksa bos', () => {
    expect(buildLatestRun([], ctx, labels)).toEqual({ date: null, providers: [] });
  });

  it('yalniz en son gunu alir, ayni saglayicida en yeni satiri secer, sabit sirada dizer', () => {
    const v = buildLatestRun([
      row({ provider: 'perplexity', cited: true }),
      row({ provider: 'openai', date: new Date('2026-10-18T00:00:00Z'), cited: true }),
      row({ provider: 'openai', createdAt: new Date('2026-10-25T00:10:00Z'), brandMentioned: true }),
      row({ provider: 'openai', createdAt: new Date('2026-10-25T00:40:00Z'), brandMentioned: false }),
      row({ provider: 'anthropic' }),
    ], ctx, labels);
    expect(v.date).toBe('2026-10-25');
    expect(v.providers.map((p) => p.provider)).toEqual(['openai', 'anthropic', 'perplexity']);
    expect(v.providers[0]).toMatchObject({ label: 'OpenAI ChatGPT', mentioned: false, cited: false });
    expect(v.providers[2].cited).toBe(true);
  });

  it('kaynak durumunu ayirir: listelendi / aramasiz / kayit oncesi', () => {
    const v = buildLatestRun([
      row({ provider: 'openai', sources: [], sourcesVersion: 1 }),
      row({ provider: 'anthropic', sources: null, sourcesVersion: 1 }),
      row({ provider: 'perplexity', sources: null, sourcesVersion: null }),
    ], ctx, labels);
    expect(v.providers.map((p) => p.sourcesStatus)).toEqual(['listed', 'no_search', 'not_recorded']);
  });

  it('kaynaklari turler; kendi site ve rakip one alinir; tavan ve kalan sayisi', () => {
    const many = Array.from({ length: LATEST_RUN_SOURCES_MAX + 2 }, (_, i) => ({ url: `https://site${i}.com/a`, domain: `site${i}.com` }));
    const v = buildLatestRun([row({
      sources: [
        ...many,
        { url: 'https://rakip.com/blog', domain: 'rakip.com' },
        { url: 'https://ranksup.ai/rehber/geo-nedir', domain: 'ranksup.ai', title: 'GEO nedir' },
        { url: 42, domain: 'bozuk' },
        { url: 'javascript:alert(1)', domain: 'kotu.com' },
      ],
    })], ctx, labels);
    const p = v.providers[0];
    expect(p.sources[0]).toMatchObject({ domain: 'ranksup.ai', type: 'own', title: 'GEO nedir' });
    expect(p.sources[1]).toMatchObject({ domain: 'rakip.com', type: 'competitor' });
    expect(p.sources).toHaveLength(LATEST_RUN_SOURCES_MAX);
    expect(p.moreSources).toBe(4);
    expect(p.sources.some((s) => s.url.startsWith('javascript:'))).toBe(false);
  });

  it('rakip adlarini (yalniz anilanlar) ve kisaltilmis alinti metnini dondurur', () => {
    const long = 'a'.repeat(LATEST_RUN_EXCERPT_MAX + 50);
    const v = buildLatestRun([row({
      excerpt: long,
      competitors: [{ name: 'Semrush', mentions: 2, positionFirst: 1 }, { name: 'Profound', mentions: 0 }, { name: '' }, 'x'],
    })], ctx, labels);
    expect(v.providers[0].competitors).toEqual(['Semrush']);
    expect(v.providers[0].excerpt).toHaveLength(LATEST_RUN_EXCERPT_MAX);
    expect(v.providers[0].excerpt?.endsWith('…')).toBe(true);
  });

  it('bilinmeyen saglayici sona gider, etiketi kendi adi', () => {
    const v = buildLatestRun([row({ provider: 'yeni' }), row({ provider: 'gemini' })], ctx, labels);
    expect(v.providers.map((p) => [p.provider, p.label])).toEqual([['gemini', 'Google Gemini'], ['yeni', 'yeni']]);
  });
});
