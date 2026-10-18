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

  it('her kosumda bir HATA satiri: soru ozeti ve anilma sayaclari yalniz olculen cevaplardan', () => {
    const hata = (query: string) => ({ ...probe(query, false, false), excerpt: 'HATA: rate_limited' });
    const A = run('1', [
      { provider: 'openai', available: true, score: 50, probes: [probe('q1', true, true), probe('q2', false, false)] },
      { provider: 'gemini', available: true, score: 50, probes: [hata('q1'), probe('q2', false, true)] },
    ]);
    const B = run('2', [
      { provider: 'openai', available: true, score: 100, probes: [probe('q1', true, true), hata('q2')] },
      { provider: 'gemini', available: true, score: 50, probes: [probe('q1', false, true), probe('q2', false, true)] },
    ]);
    const c = compareCitationRuns(A, B);
    const q1 = c.queries.find((q) => q.query === 'q1')!;
    const q2 = c.queries.find((q) => q.query === 'q2')!;
    // q1 iki kosumda da yalniz openai'de olculdu (A'da gemini HATA): atif → atif, 100 → 100.
    // Eskiden B'ye gemini'nin anilmasi eklenip 100 → 75 (−25) cikiyordu: fark yalniz
    // saglayici bilesimindendi, hicbir cevap kotulesmemisti.
    expect(q1).toMatchObject({ before: 100, after: 100, delta: 0, beforeMeasured: true, afterMeasured: true, comparable: true });
    // q2 iki kosumda da yalniz gemini'de olculdu (B'de openai HATA): anilma → anilma (eskiden 25 → 50 "+25")
    expect(q2).toMatchObject({ before: 50, after: 50, delta: 0, comparable: true });
    // Sayaclar yalniz iki kosumda da hatasiz olculen ciftlerden: (openai,q1) ve (gemini,q2)
    expect(c.mentions.before).toEqual({ mentioned: 2, cited: 1, citedNotMentioned: 0, measured: 2 });
    expect(c.mentions.after).toEqual({ mentioned: 2, cited: 1, citedNotMentioned: 0, measured: 2 });
    // HATA'li ciftler kazanc/kayip degil: eklendi/cikarildi
    expect(c).toMatchObject({ gained: 0, lost: 0, added: 1, removed: 1, unchanged: 2 });
  });

  it('bir kosumda tum cevaplari HATA olan soru kiyaslanmaz: fark 0, olculmedi isaretli', () => {
    const hata = (query: string) => ({ ...probe(query, false, false), excerpt: 'HATA: timeout' });
    const A = run('1', [{ provider: 'openai', available: true, score: 100, probes: [probe('q', true, true)] }]);
    const B = run('2', [{ provider: 'openai', available: false, score: null, probes: [hata('q')] }]);
    const q = compareCitationRuns(A, B).queries[0];
    expect(q).toMatchObject({ before: 100, after: 0, delta: 0, beforeMeasured: true, afterMeasured: false, providers: [] });
    expect(compareCitationRuns(A, B).mentions.after.measured).toBe(0);
  });

  it('olcum yontemi farkli kosumlar isaretlenir', () => {
    const A = { ...run('1', []), matchVersion: 1 };
    const B = { ...run('2', []), matchVersion: 2 };
    expect(compareCitationRuns(A, B).methodChanged).toBe(true);
    expect(compareCitationRuns(A, B).matchVersions).toEqual({ a: 1, b: 2 });
    expect(compareCitationRuns(B, B).methodChanged).toBe(false);
  });

  /**
   * G7 — B'de tek bir saglayici olculemedi (tum cevaplari HATA ya da gunluk
   * havuz butcesi asildi: probes []), baska HICBIR sey degismedi. Eskiden rapor
   * "17 → 0 −17", her soruda −17, "Anilma 3 → 0" diyordu; ayni raporda
   * "kazanilan 0 / kaybedilen 0" yaziyordu.
   */
  describe('B\'de bir saglayici olculemedi, gerisi ayni: her fark 0', () => {
    const sorular = ['en iyi muhasebe programi', 'kobi kredisi', 'e-fatura nasil kesilir'];
    const sifir = (provider: string) => ({ provider, available: true, score: 0, probes: sorular.map((q) => probe(q, false, false)) });
    const digerleri = ['openai', 'gemini', 'perplexity', 'xai', 'deepseek'].map(sifir);
    const A = run('1', [
      { provider: 'anthropic', label: 'Claude', available: true, score: 100, probes: sorular.map((q) => probe(q, true, true)) },
      ...digerleri,
    ]);
    const hata = (q: string) => ({ ...probe(q, false, false), excerpt: 'HATA: HTTP 429' });

    it.each([
      ['tum cevaplari HATA', { provider: 'anthropic', label: 'Claude', available: true, score: null, probes: sorular.map(hata) }, 3],
      ['butce asimi (probe yok)', { provider: 'anthropic', label: 'Claude', available: true, score: null, probes: [] }, 3],
    ])('%s', (_ad, claudeB, cikarilan) => {
      const B = run('2', [claudeB, ...digerleri]);
      const c = compareCitationRuns(A, B);
      // Kayitli mansetler farkli kumelerin ortalamasi (6 vs 5 saglayici) — kiyas onlardan yapilmaz
      expect(c.a.headlineScore).toBe(17);
      expect(c.b.headlineScore).toBe(0);
      expect(c.headlineBasis).toEqual({
        providers: ['openai', 'gemini', 'perplexity', 'xai', 'deepseek'],
        before: 0, after: 0, aProviders: 6, bProviders: 5,
      });
      expect(c.headlineDelta).toBe(0);
      expect(c.providers.find((p) => p.provider === 'anthropic')).toMatchObject({ before: 100, after: null, delta: null });
      for (const q of c.queries) expect(q).toMatchObject({ before: 0, after: 0, delta: 0, comparable: true });
      expect(c.mentions.before).toEqual(c.mentions.after);
      expect(c.mentions.after).toEqual({ mentioned: 0, cited: 0, citedNotMentioned: 0, measured: 15 });
      expect(c).toMatchObject({ gained: 0, lost: 0, removed: cikarilan, added: 0 });
    });
  });

  it('yontem degisti (v3 → v4): manset, saglayici ve soru farki hesaplanmaz; cift degisimi kazanc/kayip sayilmaz', () => {
    const A = { ...run('1', [{ provider: 'openai', available: true, score: 100, probes: [probe('eticaret sitesi kurma', false, true)] }]), matchVersion: 3 };
    const B = { ...run('2', [{ provider: 'openai', available: true, score: 0, probes: [probe('eticaret sitesi kurma', false, false)] }]), matchVersion: 4 };
    const c = compareCitationRuns(A, B);
    expect(c.methodChanged).toBe(true);
    expect(c.headlineDelta).toBeNull();
    expect(c.headlineBasis).toMatchObject({ before: 100, after: 0 }); // degerler gosterilir, fark yok
    expect(c.providers[0]).toMatchObject({ before: 100, after: 0, delta: null });
    expect(c.queries[0]).toMatchObject({ before: 50, after: 0, delta: 0, comparable: false });
    expect(c).toMatchObject({ gained: 0, lost: 0 });
    expect(c.changed).toEqual([{ provider: 'openai', query: 'eticaret sitesi kurma', before: 'mentioned', after: 'none', direction: 0 }]);
  });

  it('soru iki kosumda da olculdu ama ORTAK saglayicida degil: kiyaslanmaz (comparable=false, fark 0)', () => {
    const hata = (q: string) => ({ ...probe(q, false, false), excerpt: 'HATA: timeout' });
    const A = run('1', [
      { provider: 'openai', available: true, score: 100, probes: [probe('q', true, true)] },
      { provider: 'gemini', available: true, score: null, probes: [hata('q')] },
    ]);
    const B = run('2', [
      { provider: 'openai', available: true, score: null, probes: [hata('q')] },
      { provider: 'gemini', available: true, score: 50, probes: [probe('q', false, true)] },
    ]);
    const c = compareCitationRuns(A, B);
    expect(c.queries[0]).toMatchObject({ before: 100, after: 50, delta: 0, beforeMeasured: true, afterMeasured: true, comparable: false });
    expect(c.headlineDelta).toBeNull(); // ortak sayisal skorlu saglayici yok
    expect(c.headlineBasis).toMatchObject({ providers: [], before: null, after: null, aProviders: 1, bProviders: 1 });
    expect(c.mentions.after.measured).toBe(0);
  });

  it('atif var anilma yok sayaci gercek sayiyi verir', () => {
    const A = run('1', [{ provider: 'openai', available: true, score: 0, probes: [probe('q1', false, false), probe('q2', false, false), probe('q3', false, false)] }]);
    const B = run('2', [{ provider: 'openai', available: true, score: 50, probes: [probe('q1', true, false), probe('q2', true, false), probe('q3', false, true)] }]);
    // cited 2, mentioned 1: eski "cited - mentioned" 1 derdi; gercekte 2 atifin ikisinde de ad yok
    expect(compareCitationRuns(A, B).mentions.after).toEqual({ mentioned: 1, cited: 2, citedNotMentioned: 2, measured: 3 });
  });

  it('outcomeOf / headlineOfProviders', () => {
    expect(outcomeOf(undefined)).toBe('n/a');
    expect(outcomeOf(probe('q', false, true))).toBe('mentioned');
    expect(headlineOfProviders([{ provider: 'a', available: false, score: null, probes: [] }])).toBeNull();
    expect(headlineOfProviders([{ provider: 'a', available: true, score: 20, probes: [] }, { provider: 'b', available: true, score: 41, probes: [] }])).toBe(31);
  });
});
