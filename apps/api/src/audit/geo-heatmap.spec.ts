import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { classifyHeatmapText, summarizeHeatmap, isMeasuredCell, GeoHeatmapService, type HeatmapCell } from './geo-heatmap.service.js';
import { brandMatcher } from './brand-in-query.js';

describe('classifyHeatmapText — ana olcumle ayni eslesme', () => {
  const kobi = brandMatcher('Kobipratik', 'kobipratik.com');

  it('alan adi etiket sinirli: benzer alan adi alinti sayilmaz', () => {
    expect(classifyHeatmapText('Kaynak: kobipratik.com/kredi', 'kobipratik.com', [], kobi).status).toBe('cited');
    // baska alan adlari alinti degil; "kobipratik.com.tr" icindeki marka KELIMESI ise anilmadir
    expect(classifyHeatmapText('notkobipratik.com ve kobipratik.com.tr', 'kobipratik.com', [], kobi).status).toBe('mentioned');
    expect(classifyHeatmapText('notkobipratik.com', 'kobipratik.com', [], kobi).status).toBe('none');
  });

  it('rakip alan adi, sonra marka adi', () => {
    expect(classifyHeatmapText('hesapkurdu.com onerilir', 'kobipratik.com', ['hesapkurdu.com'], kobi))
      .toEqual({ status: 'competitor', competitor: 'hesapkurdu.com' });
    expect(classifyHeatmapText('Kobipratik iyi bir secenek', 'kobipratik.com', ['hesapkurdu.com'], kobi).status).toBe('mentioned');
  });

  it('marka baska kelimenin icinde gecerse anilma degil; Turkce I katlamasi calisir', () => {
    expect(classifyHeatmapText('Kobipratikci firmalar', 'kobipratik.com', [], kobi).status).toBe('none');
    const iddaa = brandMatcher('İddaa', 'iddaa.com');
    expect(classifyHeatmapText('IDDAA ve diger siteler', 'iddaa.com', [], iddaa).status).toBe('mentioned');
  });

  it('jenerik turetilmis marka: "Hepsiemlak" ya da yalin "emlak" anilma sayilmaz', () => {
    const emlak = brandMatcher('emlak', 'emlak.com');
    expect(classifyHeatmapText('Emlak icin Hepsiemlak ve sahibinden', 'emlak.com', [], emlak).status).toBe('none');
    expect(classifyHeatmapText('emlak.com iyi', 'emlak.com', [], emlak).status).toBe('cited');
  });
});

/**
 * Hata ve etkin olmayan saglayici hucresi OLCUM DEGILDIR: skor paydasina ve
 * firsat/zayif/guzel siniflarina girmez. Eskiden 'none' yaziliyordu — 429 alan
 * saglayici 0 puan, hata alan sorgu "fırsat (kimse yok)" gorunuyordu.
 */
describe('summarizeHeatmap — yalniz olculen hucreler', () => {
  const cell = (query: string, provider: string, status: HeatmapCell['status'], competitor?: string): HeatmapCell =>
    ({ query, provider, status, excerpt: status === 'error' ? 'HATA: rate_limited' : '', ...(competitor ? { competitor } : {}) });
  const IDS = ['anthropic', 'gemini', 'openai', 'perplexity'];

  it('tum hucreleri hatali saglayici null (0 degil); kismi hatada payda yalniz olculenler', () => {
    const cells = [
      cell('q1', 'anthropic', 'cited'), cell('q1', 'gemini', 'error'), cell('q1', 'openai', 'none'), cell('q1', 'perplexity', 'disabled'),
      cell('q2', 'anthropic', 'error'), cell('q2', 'gemini', 'error'), cell('q2', 'openai', 'mentioned'), cell('q2', 'perplexity', 'disabled'),
    ];
    const s = summarizeHeatmap(cells, IDS, ['q1', 'q2']);
    expect(s.scoreByProvider).toEqual({ anthropic: 100, gemini: null, openai: 25, perplexity: null });
    // q1: cited + none olculdu → (100+0)/2; q2: yalniz mentioned olculdu → 50
    expect(s.scoreByQuery).toEqual({ q1: 50, q2: 50 });
  });

  it('hic olculemeyen sorgu firsat sayilmaz; ayri listeye gider', () => {
    const cells = [
      cell('hepsi-hata', 'anthropic', 'error'), cell('hepsi-hata', 'gemini', 'disabled'),
      cell('bos', 'anthropic', 'none'), cell('bos', 'gemini', 'error'),
      cell('rakip', 'anthropic', 'competitor', 'rakip.com'), cell('rakip', 'gemini', 'error'),
      cell('biz', 'anthropic', 'error'), cell('biz', 'gemini', 'cited'),
    ];
    const s = summarizeHeatmap(cells, ['anthropic', 'gemini'], ['hepsi-hata', 'bos', 'rakip', 'biz']);
    expect(s.olculemeyenQueries).toEqual(['hepsi-hata']);
    expect(s.fırsatQueries).toEqual(['bos']);
    expect(s.zayifQueries).toEqual(['rakip']);
    expect(s.guzelQueries).toEqual(['biz']);
    expect(s.scoreByQuery['hepsi-hata']).toBeNull();
    expect(s.competitorWins).toEqual({ 'rakip.com': 1 });
  });

  it('isMeasuredCell', () => {
    expect(isMeasuredCell({ status: 'none' })).toBe(true);
    expect(isMeasuredCell({ status: 'error' })).toBe(false);
    expect(isMeasuredCell({ status: 'disabled' })).toBe(false);
  });
});

describe('GeoHeatmapService.runForSite — bos cevap, hata ve etkin olmayan saglayici', () => {
  const KEYS = ['ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY'];
  let backup: Record<string, string | undefined> = {};
  beforeEach(() => {
    backup = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-test';
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(backup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('bos cevap ve firlatilan hata "error", anahtarsiz saglayici "disabled"; skorlar yalniz olculenlerden', async () => {
    const prisma = {
      site: {
        findUniqueOrThrow: async () => ({
          id: 's1', name: 'Kobipratik', url: 'https://kobipratik.com', niche: 'finans',
          brain: { seoStrategy: { aeoQueries: ['en iyi kredi karsilastirma sitesi', 'kobi kredisi nereden alinir'] }, competitors: [] },
        }),
      },
    };
    const svc = new GeoHeatmapService(prisma as any, { assertAiEnabled: async () => undefined } as any);
    (svc as any).askProvider = async (provider: string, q: string) => {
      if (provider === 'openai') throw new Error('HTTP 400: bad request');
      return q.startsWith('en iyi') ? 'Kaynak: kobipratik.com' : '   ';
    };
    const r = await svc.runForSite('s1');
    expect(r.providerIds).toEqual(['anthropic', 'gemini', 'openai', 'perplexity']);
    const st = (q: string, p: string) => r.cells.find((c) => c.query === q && c.provider === p)?.status;
    expect(st('en iyi kredi karsilastirma sitesi', 'anthropic')).toBe('cited');
    expect(st('kobi kredisi nereden alinir', 'anthropic')).toBe('error');   // bos cevap
    expect(st('en iyi kredi karsilastirma sitesi', 'openai')).toBe('error'); // firlatilan hata
    expect(st('en iyi kredi karsilastirma sitesi', 'gemini')).toBe('disabled');
    expect(r.scoreByProvider).toEqual({ anthropic: 100, gemini: null, openai: null, perplexity: null });
    expect(r.guzelQueries).toEqual(['en iyi kredi karsilastirma sitesi']);
    expect(r.olculemeyenQueries).toEqual(['kobi kredisi nereden alinir']);
    expect(r.fırsatQueries).toEqual([]);
  });

  /**
   * Sorgu basina 4 saglayici cagrisi; 20 tavani yalniz controller/DTO'daydi —
   * servisi dogrudan cagiran yol (MCP, worker) sinirsiz sorgu gecebiliyordu.
   */
  it('maxQueries servis icinde [1, 20] araligina sikistirilir', async () => {
    const queries = Array.from({ length: 40 }, (_, i) => `kredi sorusu ${i + 1}`);
    const prisma = {
      site: {
        findUniqueOrThrow: async () => ({
          id: 's1', name: 'Kobipratik', url: 'https://kobipratik.com', niche: 'finans',
          brain: { seoStrategy: { aeoQueries: queries }, competitors: [] },
        }),
      },
    };
    const svc = new GeoHeatmapService(prisma as any, { assertAiEnabled: async () => undefined } as any);
    const ask = vi.fn(async () => 'cevap');
    (svc as any).askProvider = ask;
    for (const [max, beklenen] of [[500, 20], [undefined, 10], [0, 1], [Number.NaN, 10], [3, 3]] as const) {
      ask.mockClear();
      const r = await svc.runForSite('s1', { maxQueries: max as number | undefined });
      expect(r.queries, String(max)).toHaveLength(beklenen);
      // anthropic + openai etkin (beforeEach): sorgu basina 2 cagri
      expect(ask, String(max)).toHaveBeenCalledTimes(beklenen * 2);
    }
  });
});
