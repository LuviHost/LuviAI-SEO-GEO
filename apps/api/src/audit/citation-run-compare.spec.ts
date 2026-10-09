import { describe, it, expect } from 'vitest';
import { compareCitationRuns, headlineOfProviders, outcomeOf } from './citation-run-compare.js';

const probe = (query: string, cited: boolean, mentioned: boolean, branded = false) => ({ query, cited, brandMentioned: mentioned, brandInQuery: branded });
const run = (id: string, providers: any[]) => ({ id, runAt: `2026-08-27T0${id}:00:00Z`, trigger: 'user', headlineScore: headlineOfProviders(providers), providers });

describe('compareCitationRuns', () => {
  it('saglayici skor farki, kazanilan/kaybedilen sorular, degismeyenler', () => {
    const A = run('1', [
      { provider: 'openai', available: true, score: 50, probes: [probe('en iyi on muhasebe', true, true), probe('kobi kredisi hesaplama', false, false)] },
      { provider: 'gemini', available: true, score: 0, probes: [probe('en iyi on muhasebe', false, false)] },
    ]);
    const B = run('2', [
      { provider: 'openai', available: true, score: 25, probes: [probe('en iyi on muhasebe', false, true), probe('kobi kredisi hesaplama', false, false)] },
      { provider: 'gemini', available: true, score: 100, probes: [probe('en iyi on muhasebe', true, true)] },
    ]);
    const c = compareCitationRuns(A, B);
    expect(c.a.headlineScore).toBe(25); expect(c.b.headlineScore).toBe(63); expect(c.headlineDelta).toBe(38);
    expect(c.providers.find((p) => p.provider === 'openai')?.delta).toBe(-25);
    expect(c.providers.find((p) => p.provider === 'gemini')?.delta).toBe(100);
    expect(c.gained).toBe(1); expect(c.lost).toBe(1); expect(c.unchanged).toBe(1);
    expect(c.changed[0]).toMatchObject({ provider: 'gemini', before: 'none', after: 'cited', direction: 1 });
    expect(c.changed[1]).toMatchObject({ provider: 'openai', before: 'cited', after: 'mentioned', direction: -1 });
  });

  it('markali sorular kiyasa girmez; olculemeyen saglayici (score null) delta null', () => {
    const A = run('1', [{ provider: 'openai', available: true, score: 100, probes: [probe('kobipratik guvenilir mi', true, true, true)] }]);
    const B = run('2', [{ provider: 'openai', available: false, score: null, probes: [] }]);
    const c = compareCitationRuns(A, B);
    expect(c.changed).toEqual([]);
    expect(c.providers[0].delta).toBeNull();
    expect(c.headlineDelta).toBeNull();
  });

  it('bir kosumda olmayan soru n/a gorunur ama kazanc/kayip SAYILMAZ (eklendi/cikarildi)', () => {
    const A = run('1', [{ provider: 'openai', available: true, score: 0, probes: [probe('eski soru', false, false)] }]);
    const B = run('2', [{ provider: 'openai', available: true, score: 100, probes: [probe('yeni soru', true, false)] }]);
    const c = compareCitationRuns(A, B);
    expect(c.changed.find((x) => x.query === 'yeni soru')).toMatchObject({ before: 'n/a', after: 'cited', direction: 0 });
    expect(c).toMatchObject({ gained: 0, lost: 0, added: 1, removed: 1 });
  });

  it('saglayici hatasi (HATA:) olcum degildir — n/a', () => {
    const A = run('1', [{ provider: 'openai', available: true, score: 100, probes: [probe('q', true, true)] }]);
    const B = run('2', [{ provider: 'openai', available: true, score: null, probes: [{ ...probe('q', false, false), excerpt: 'HATA: 429' }] }]);
    const c = compareCitationRuns(A, B);
    expect(c.lost).toBe(0);
    expect(c.removed).toBe(1);
  });

  it('olcum yontemi farkli kosumlar isaretlenir', () => {
    const A = { ...run('1', []), matchVersion: 1 };
    const B = { ...run('2', []), matchVersion: 2 };
    expect(compareCitationRuns(A, B).methodChanged).toBe(true);
    expect(compareCitationRuns(B, B).methodChanged).toBe(false);
  });

  it('outcomeOf / headlineOfProviders', () => {
    expect(outcomeOf(undefined)).toBe('n/a');
    expect(outcomeOf(probe('q', false, true))).toBe('mentioned');
    expect(headlineOfProviders([{ provider: 'a', available: false, score: null, probes: [] }])).toBeNull();
    expect(headlineOfProviders([{ provider: 'a', available: true, score: 20, probes: [] }, { provider: 'b', available: true, score: 41, probes: [] }])).toBe(31);
  });
});
