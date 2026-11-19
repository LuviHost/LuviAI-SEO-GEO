import { describe, it, expect, vi } from 'vitest';
import { AdsSnapshotCollectorService } from './snapshot-collector.service.js';
import { GOOGLE_SNAPSHOT_QUERIES } from './google-snapshot-map.js';
import { buildMetaSnapshot, mapMetaCampaigns } from './meta-snapshot-map.js';

/**
 * Toplayici yalniz musteri hesabindan okur; eskiden RanksUp'in kendi kampanya
 * tablosundan kurup okunmayan alanlari uydurma varsayilanla dolduruyordu
 * (geoTargeting 'people_in', rsa.count 1, adStrength 'average', bidStrategy
 * 'unknown', sitelink 0, Meta'da sahte reklam seti).
 */

const FAKE_DEFAULTS = ['people_in', 'average', 'unknown'];

function collector(google: any, meta: any = {}) {
  return new AdsSnapshotCollectorService(google, meta);
}

describe('AdsSnapshotCollectorService — Google', () => {
  it('Google Ads bagli degilse snapshot bos, kaynak none, neden okunur', async () => {
    const google = { queryEach: vi.fn(async () => ({ ok: false, error: 'Google Ads bağlı değil; …' })) };
    const r = await collector(google).collect('s1', 'google');
    expect(r).toEqual({ snapshot: {}, source: 'none', readErrors: ['Google Ads bağlı değil; …'] });
  });

  it('tum sorgulari tek cagrida ister; yalniz okuma sorgulari', async () => {
    const google = { queryEach: vi.fn(async () => ({ ok: true, results: {} })) };
    await collector(google).collect('s1', 'google');
    expect(google.queryEach).toHaveBeenCalledWith('s1', GOOGLE_SNAPSHOT_QUERIES);
  });

  it('kampanya satirinda olmayan alan icin varsayilan uretmez', async () => {
    const results: Record<string, any[] | null> = Object.fromEntries(Object.keys(GOOGLE_SNAPSHOT_QUERIES).map((k) => [k, null]));
    results.campaigns = [{ campaign: { id: '1', name: 'Arama', advertisingChannelType: 'SEARCH' } }];
    const google = { queryEach: vi.fn(async () => ({ ok: true, results })) };
    const { snapshot, source, readErrors } = await collector(google).collect('s1', 'google');
    expect(source).toBe('google_ads_api');
    const c = snapshot.campaigns![0];
    for (const k of ['budget', 'bidStrategy', 'geoTargeting', 'network', 'sitelinks', 'callouts', 'structuredSnippets', 'rsa', 'qualityScore', 'learningStatus', 'spendToday'] as const) {
      expect(c[k], k).toBeUndefined();
    }
    expect(JSON.stringify(snapshot)).not.toMatch(new RegExp(FAKE_DEFAULTS.map((d) => `"${d}"`).join('|')));
    for (const k of ['conversionActions', 'searchTerms', 'negativeKeywordLists', 'ga4Linked', 'enhancedConversionsActive', 'consentModeV2', 'pmaxCampaigns', 'monthlySpendUsd'] as const) {
      expect(snapshot[k], k).toBeUndefined();
    }
    expect(readErrors).toContain('Dönüşüm işlemleri');
  });

  it('istemci firlatirsa denetim dusmez: bos snapshot', async () => {
    const google = { queryEach: vi.fn(async () => { throw new Error('ag'); }) };
    const r = await collector(google).collect('s1', 'google');
    expect(r.snapshot).toEqual({});
    expect(r.source).toBe('none');
  });
});

describe('AdsSnapshotCollectorService — Meta', () => {
  it('okunan kampanyalar: CBO + butce; reklam seti / pixel / CAPI uydurulmaz', async () => {
    const meta = {
      readAccountForAudit: vi.fn(async () => ({
        ok: true,
        currency: 'TRY',
        spend30d: 1500.5,
        campaigns: [
          { id: '10', name: 'CBO', effective_status: 'ACTIVE', daily_budget: '50000' },
          { id: '11', name: 'Ad set bütçeli', effective_status: 'ACTIVE' },
          { id: '12', name: 'Duraklatılmış', effective_status: 'PAUSED', daily_budget: '1000' },
        ],
      })),
    };
    const { snapshot, source } = await collector({}, meta).collect('s1', 'meta');
    expect(source).toBe('meta_graph_api');
    expect(snapshot.metaCampaigns).toEqual([
      { id: '10', name: 'CBO', objective: undefined, cbo: true, budget: 500, adSets: undefined },
      { id: '11', name: 'Ad set bütçeli', objective: undefined, cbo: false, budget: undefined, adSets: undefined },
    ]);
    expect(snapshot.monthlySpend).toBe(1500.5);
    expect(snapshot.monthlySpendUsd).toBeUndefined();
    for (const k of ['pixel', 'capi', 'emq', 'domainVerified', 'aem', 'attributionWindow'] as const) expect(snapshot[k], k).toBeUndefined();
  });

  it('Meta bagli degilse kaynak none', async () => {
    const meta = { readAccountForAudit: vi.fn(async () => ({ ok: false, error: 'Meta Ads bağlı değil' })) };
    const r = await collector({}, meta).collect('s1', 'meta');
    expect(r).toEqual({ snapshot: {}, source: 'none', readErrors: ['Meta Ads bağlı değil'] });
  });

  it('para birimi bilinmeden kucuk birim butce tutara cevrilmez; okunamayanlar readErrors', () => {
    expect(mapMetaCampaigns([{ id: '1', daily_budget: '5000' }], null)[0].budget).toBeUndefined();
    const { snapshot, readErrors } = buildMetaSnapshot({ currency: null, campaigns: null, spend30d: null });
    expect(snapshot).toEqual({});
    expect(readErrors).toEqual(['Para birimi', 'Hesap harcaması', 'Kampanyalar']);
  });
});
