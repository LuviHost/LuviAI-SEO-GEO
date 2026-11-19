import { describe, expect, it, vi } from 'vitest';
import { ADS_TERM_LIMIT, ADS_TERMS_GAQL, parseAdsTermRows, selectContentTerms } from './ads-terms.js';
import { AdsTermsService } from './ads-terms.service.js';
import { ScorerService } from './scorer.service.js';

const satir = (term: string, clicks: number, conversions = 0, cost = 1, impressions = 100) => ({ term, clicks, conversions, cost, impressions });

describe('Google Ads arama terimleri → icerik konusu', () => {
  it('GAQL hesap duzeyinde, yalniz okuma, son 30 gun, tiklama alanlar', () => {
    expect(ADS_TERMS_GAQL).toContain('FROM search_term_view');
    expect(ADS_TERMS_GAQL).toContain('DURING LAST_30_DAYS');
    expect(ADS_TERMS_GAQL).not.toMatch(/campaign\.id\s*=/);
  });

  it('satirlar ayristirilir; maliyet mikrodan birime', () => {
    expect(parseAdsTermRows([{ searchTermView: { searchTerm: ' pos cihazi ' }, metrics: { impressions: '120', clicks: '9', conversions: 2, costMicros: '3500000' } }]))
      .toEqual([{ term: 'pos cihazi', impressions: 120, clicks: 9, conversions: 2, cost: 3.5 }]);
  });

  it('ayni terim toplanir; marka terimi cikar; donusum ya da 5+ tiklama; donusum, sonra harcama sirasi', () => {
    const r = selectContentTerms([
      satir('Rotatif kredi hesaplama', 3, 1, 4),
      satir('rotatif kredi hesaplama', 2, 1, 2),
      satir('kobipratik pos', 40, 5, 20),
      satir('esnaf kredisi faiz', 12, 0, 9),
      satir('ucuz pos', 2, 0, 1),
    ], 'KobiPratik', 'kobipratik.com');
    expect(r.map((t) => t.term)).toEqual(['Rotatif kredi hesaplama', 'esnaf kredisi faiz']);
    expect(r[0]).toMatchObject({ clicks: 5, conversions: 2, cost: 6, source: 'google_ads' });
  });

  it('en cok 25 terim', () => {
    const cok = Array.from({ length: 40 }, (_, i) => satir(`terim numara ${i}`, 10, i));
    expect(selectContentTerms(cok, 'Marka')).toHaveLength(ADS_TERM_LIMIT);
  });

  it('reklam hesabi bagli degil / hata: bos liste, konu motoru durmaz', async () => {
    const prisma = { site: { findUnique: vi.fn(async () => ({ name: 'S', url: 'https://s.com' })) } };
    const svc = new AdsTermsService(prisma as any, { query: vi.fn(async () => { throw new Error('Google Ads bagli degil'); }) } as any);
    await expect(svc.fetchContentTerms('s1')).resolves.toEqual([]);
  });

  it('siralayiciya besinci kaynak olarak gider; terim yoksa girdi eskisiyle ayni', async () => {
    const run = vi.fn(async () => ({ output: '{}', usage: {}, costUsd: 0 }));
    const scorer = new ScorerService({ run } as any);
    const temel = { brainContext: {} as any, planTopics: [], gscOpportunities: [], geoGaps: [], competitorMoves: [], existingPages: [] };
    await scorer.rank({ ...temel, adsSearchTerms: [{ term: 'pos komisyonu', clicks: 9, conversions: 2 }] });
    const ile = (run.mock.calls[0] as any)[0].input as string;
    expect(ile).toContain('5 kaynaktan');
    expect(ile).toContain('"ads_search_terms"');
    expect(ile).toContain('ads_search_terms: Google Ads');
    await scorer.rank(temel);
    const olmadan = (run.mock.calls[1] as any)[0].input as string;
    expect(olmadan).toContain('4 kaynaktan');
    expect(olmadan).not.toContain('ads_search_terms');
  });
});
