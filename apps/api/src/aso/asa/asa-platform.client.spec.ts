import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { AsaPlatformClient } from './asa-platform.client.js';
import { AsaApiError } from './asa-types.js';

/**
 * Platform API adaptoru — ag yok, fetch sahte. Govdeler resmi dokumandaki
 * orneklerle ayni bicimde (https://developer.apple.com/documentation/apple-ads-platform-api).
 */

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const CREDS = { orgId: 'SEARCHADS.client-1', keyId: 'key-uuid-1', privateKeyPem: PEM };
const BASE = 'https://api.ads.apple.com/v1';

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
type Route = (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const ACLS = {
  result: {
    acls: [
      { adAccount: { id: 300000002, name: 'Maps hesabi', orgId: 27154130 }, roles: ['Admin'] },
      { adAccount: { id: 300000001, name: 'App hesabi', orgId: 27154130 }, roles: ['API Account Manager'] },
      { adAccount: { id: 300000003, name: 'Ikinci app', orgId: 27154130 }, roles: ['Admin'] },
    ],
  },
};
const AD_ACCOUNTS: Record<string, unknown> = {
  '300000001': { result: { id: 300000001, name: 'App hesabi', orgId: 27154130, currency: 'USD', productFeatures: ['APPSTORE_APP_MANUAL'] } },
  '300000002': { result: { id: 300000002, name: 'Maps hesabi', orgId: 27154130, currency: 'USD', productFeatures: ['BUSINESS_BRAND_MANUAL'] } },
  '300000003': { result: { id: 300000003, name: 'Ikinci app', orgId: 27154130, currency: 'EUR', productFeatures: ['APPSTORE_APP_MANUAL'] } },
};

function fakeFetch(routes: Route[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: any, init: any = {}) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
    let body: any = init.body;
    if (typeof body === 'string' && headers['content-type'] === 'application/json') body = JSON.parse(body);
    const call: Call = { url: String(url), method: init.method ?? 'GET', headers, body };
    calls.push(call);
    if (call.url === 'https://appleid.apple.com/auth/oauth2/token') {
      return json(200, { access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' });
    }
    for (const r of routes) {
      const out = r(call);
      if (out) return json(out.status ?? 200, out.body, out.headers);
    }
    if (call.url === `${BASE}/acls`) return json(200, ACLS);
    const m = /\/ad-accounts\/(\d+)$/.exec(call.url);
    if (m && AD_ACCOUNTS[m[1]]) return json(200, AD_ACCOUNTS[m[1]]);
    return json(404, { error: { code: 'NOT_FOUND', message: `no route ${call.method} ${call.url}` } });
  });
  return { fn, calls };
}

function client(routes: Route[] = [], opts: { adAccountId?: string | null; onAdAccountResolved?: (id: string) => void } = {}) {
  const f = fakeFetch(routes);
  const sleep = vi.fn(async () => undefined);
  const c = new AsaPlatformClient(CREDS, { fetchImpl: f.fn as any, sleep, ...opts });
  return { c, ...f, sleep };
}

const ctxOf = (calls: Call[], pred: (c: Call) => boolean) => calls.find(pred)?.headers['x-ap-context'];

describe('Platform reklam hesabi cozumleme', () => {
  it('/acls → App Store yetkili EN KUCUK id secilir, kalici yazilir; context adAccountId=…', async () => {
    const resolved = vi.fn();
    const { c, calls } = client(
      [(call) => (call.url === `${BASE}/campaigns/query` ? { body: { result: [], pagination: { totalCount: 0 } } } : undefined)],
      { onAdAccountResolved: resolved },
    );
    const info = await c.getAccountInfo();
    expect(info).toEqual({ contextId: '300000001', name: 'App hesabi', currency: 'USD', orgId: '27154130' });
    expect(resolved).toHaveBeenCalledWith('300000001');
    await c.listCampaigns();
    expect(ctxOf(calls, (x) => x.url === `${BASE}/campaigns/query`)).toBe('adAccountId=300000001');
    expect(ctxOf(calls, (x) => x.url === `${BASE}/acls`)).toBeUndefined();
  });

  it('kayitli kimlik varsa /acls cagrilmaz', async () => {
    const { c, calls } = client([], { adAccountId: '300000003' });
    const info = await c.getAccountInfo();
    expect(info.contextId).toBe('300000003');
    expect(info.currency).toBe('EUR');
    expect(calls.some((x) => x.url === `${BASE}/acls`)).toBe(false);
  });

  it('kayitli hesaba erisilemiyorsa baska hesaba SESSIZCE gecmez', async () => {
    const { c, calls } = client([(call) => (call.url.endsWith('/ad-accounts/999') ? { status: 403, body: { error: { code: 'FORBIDDEN', message: 'no access' } } } : undefined)], { adAccountId: '999' });
    const err = await c.getAccountInfo().catch((e) => e);
    expect(err).toBeInstanceOf(AsaApiError);
    expect(err.kind).toBe('forbidden');
    expect(calls.some((x) => x.url === `${BASE}/acls`)).toBe(false);
  });

  it('hesap ayrintisi alinamazsa secim yapilmaz ve hicbir sey kalici yazilmaz', async () => {
    const resolved = vi.fn();
    const { c } = client(
      [(call) => (call.url.endsWith('/ad-accounts/300000001') ? { status: 403, body: { error: { code: 'FORBIDDEN', message: 'no' } } } : undefined)],
      { onAdAccountResolved: resolved },
    );
    await expect(c.getAccountInfo()).rejects.toBeInstanceOf(AsaApiError);
    expect(resolved).not.toHaveBeenCalled();
  });

  it('hic reklam hesabi yoksa acik Turkce hata', async () => {
    const { c } = client([(call) => (call.url === `${BASE}/acls` ? { body: { result: { acls: [] } } } : undefined)]);
    await expect(c.getAccountInfo()).rejects.toThrow('Bu API anahtarının erişebildiği bir Apple Ads reklam hesabı yok.');
  });

  it('yalniz Apple Maps hesabi varsa App Store yetkisi yok hatasi', async () => {
    const { c } = client([
      (call) => (call.url === `${BASE}/acls` ? { body: { result: { acls: [{ adAccount: { id: 300000002 }, roles: ['Admin'] }] } } } : undefined),
    ]);
    await expect(c.getAccountInfo()).rejects.toThrow(/APPSTORE_APP_MANUAL/);
  });
});

describe('Platform kampanyalar', () => {
  it('listCampaigns: POST /campaigns/query + normalizasyon (dailyBudget.value, targeting.include, promotedObjectId)', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/campaigns/query`
        ? {
            body: {
              result: [
                {
                  id: 444555666, name: 'AwayFinder App Campaign', adAccountId: 300000001, promotedObjectType: 'APPSTORE_APP', promotedObjectId: '123456789',
                  status: 'ENABLED', displayStatus: 'RUNNING', dailyBudget: { value: { amount: '100.00', currency: 'USD' } },
                  targeting: { countryOrRegion: { include: ['US'] }, supplyPlacement: { include: ['APPSTORE_SEARCH_RESULTS'] } }, deleted: false,
                },
                { id: 111222333, name: 'Maps', promotedObjectType: 'BUSINESS_BRAND', promotedObjectId: '987', status: 'ENABLED' },
              ],
              pagination: { totalCount: 2, offset: 0, pageSize: 1000 },
            },
          }
        : undefined),
    ], { adAccountId: '300000001' });
    const list = await c.listCampaigns();
    expect(list).toEqual([{
      id: '444555666', name: 'AwayFinder App Campaign', status: 'ENABLED', displayStatus: 'RUNNING', dailyBudget: 100, totalBudget: null,
      currency: 'USD', countriesOrRegions: ['US'], supplySources: ['APPSTORE_SEARCH_RESULTS'], adamId: '123456789', deleted: false,
    }]);
    expect(calls.find((x) => x.url === `${BASE}/campaigns/query`)!.body.pagination).toEqual({ offset: 0, pageSize: 1000, fetchTotalCount: true });
  });

  it('silinmis kampanyalar ayrica sorgulanir (deleted EQUALS true) ve deleted:true doner', async () => {
    const { c, calls } = client([
      (call) => {
        if (call.url !== `${BASE}/campaigns/query`) return undefined;
        const del = call.body.filters?.[0]?.field === 'deleted';
        return { body: { result: del ? [{ id: 2, name: 'Eski', status: 'PAUSED', promotedObjectType: 'APPSTORE_APP', promotedObjectId: '1' }] : [{ id: 1, name: 'Canli', status: 'ENABLED', promotedObjectType: 'APPSTORE_APP', promotedObjectId: '1' }] } };
      },
    ], { adAccountId: '300000001' });
    const list = await c.listCampaigns();
    expect(list.map((x) => [x.id, x.deleted])).toEqual([['1', false], ['2', true]]);
    expect(calls.filter((x) => x.url === `${BASE}/campaigns/query`)[1].body.filters).toEqual([{ field: 'deleted', operator: 'EQUALS', value: true }]);
  });

  it('silinmis sorgusunda gecici hata → senkron duser (silinmisler yetim sayilip silinmesin)', async () => {
    const { c } = client([
      (call) => (call.url === `${BASE}/campaigns/query`
        ? (call.body.filters ? { status: 503, body: { error: { code: 'internal_server_error' } } } : { body: { result: [] } })
        : undefined),
    ], { adAccountId: '300000001' });
    const err = await c.listCampaigns().catch((e) => e);
    expect(err).toBeInstanceOf(AsaApiError);
    expect(err.kind).toBe('server');
  });

  it('silinmis filtresi dogrulama hatasiyla reddedilirse canli listeyle devam', async () => {
    const { c } = client([
      (call) => (call.url === `${BASE}/campaigns/query`
        ? (call.body.filters ? { status: 400, body: { error: { code: 'INVALID_FILTER', message: 'deleted not supported' } } } : { body: { result: [{ id: 1, name: 'Canli', promotedObjectType: 'APPSTORE_APP' }] } })
        : undefined),
    ], { adAccountId: '300000001' });
    await expect(c.listCampaigns()).resolves.toHaveLength(1);
  });

  it('createCampaign: resmi App Store Search orneginin alanlari, endTime yok', async () => {
    const { c, calls } = client([
      (call) => (call.method === 'POST' && call.url === `${BASE}/campaigns`
        ? { body: { result: { id: 444555666, name: call.body.name, promotedObjectType: 'APPSTORE_APP', promotedObjectId: call.body.promotedObjectId, status: 'ENABLED', dailyBudget: call.body.dailyBudget, targeting: call.body.targeting } } }
        : undefined),
    ], { adAccountId: '300000001' });
    const camp = await c.createCampaign({ name: 'Kamp', dailyBudget: { amount: '15', currency: 'USD' }, countriesOrRegions: ['TR'], adamId: 123456789 });
    expect(camp).toMatchObject({ id: '444555666', adamId: '123456789', dailyBudget: 15, countriesOrRegions: ['TR'] });
    const body = calls.find((x) => x.method === 'POST' && x.url === `${BASE}/campaigns`)!.body;
    expect(body).toEqual({
      name: 'Kamp',
      adAccountId: 300000001,
      billingEvent: 'TAPS',
      promotedObjectType: 'APPSTORE_APP',
      promotedObjectId: '123456789',
      status: 'ENABLED',
      dailyBudget: { value: { amount: '15', currency: 'USD' } },
      targeting: {
        supplySource: { include: ['APPSTORE'] },
        supplyPlacement: { include: ['APPSTORE_SEARCH_RESULTS'] },
        countryOrRegion: { include: ['TR'] },
      },
      bidStrategy: { bidStrategyType: 'MANUAL_CPT', bidStrategyGoal: 'TAP' },
    });
  });

  it('createAdGroup: pricingModel CPT + bidStrategy.bid (v5 defaultBidAmount karsiligi)', async () => {
    const { c, calls } = client([
      (call) => (call.method === 'POST' && call.url === `${BASE}/adgroups`
        ? { body: { result: { id: 555666777, campaignId: 444555666, name: call.body.name, pricingModel: 'CPT', status: 'ENABLED', bidStrategy: call.body.bidStrategy } } }
        : undefined),
    ], { adAccountId: '300000001' });
    const g = await c.createAdGroup('444555666', { name: 'AG', defaultBid: { amount: '0.50', currency: 'USD' } });
    expect(g).toEqual({ id: '555666777', campaignId: '444555666', name: 'AG', defaultBid: 0.5, status: 'ENABLED' });
    expect(calls.find((x) => x.url === `${BASE}/adgroups`)!.body).toEqual({
      name: 'AG',
      campaignId: 444555666,
      pricingModel: 'CPT',
      status: 'ENABLED',
      automatedKeywordsOptIn: false,
      bidStrategy: { bidStrategyType: 'MANUAL_CPT', bidStrategyGoal: 'TAP', bid: { amount: '0.50', currency: 'USD' } },
    });
  });
});

describe('Platform anahtar kelimeler', () => {
  it('bulk-create: correlationId ile eslesme, kismi basari; durum ENABLED → ACTIVE', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/keywords/bulk-create`
        ? {
            body: {
              result: [
                { correlationId: 0, operation: 'CREATE', success: true, result: { id: 888999000, adGroupId: 555666777, campaignId: 444555666, text: 'photo editor', matchType: 'EXACT', bid: { amount: '2.50', currency: 'USD' }, status: 'ENABLED', deleted: false } },
                { correlationId: 1, operation: 'CREATE', success: false, error: { code: 'DUPLICATE_KEYWORD', message: 'Keyword already exists in ad group' } },
              ],
            },
          }
        : undefined),
    ], { adAccountId: '300000001' });
    const r = await c.addTargetingKeywords('444555666', '555666777', [
      { text: 'photo editor', matchType: 'EXACT', bid: { amount: '2.50', currency: 'USD' } },
      { text: 'photo app', matchType: 'BROAD', bid: { amount: '1.75', currency: 'USD' } },
    ]);
    expect(r.created).toEqual([{ id: '888999000', adGroupId: '555666777', campaignId: '444555666', text: 'photo editor', matchType: 'EXACT', bid: 2.5, status: 'ACTIVE', deleted: false }]);
    expect(r.failed).toEqual([{ text: 'photo app', reason: 'Keyword already exists in ad group' }]);
    const body = calls.find((x) => x.url === `${BASE}/keywords/bulk-create`)!.body;
    expect(body.allowPartialSuccess).toBe(true);
    expect(body.items[1]).toEqual({ correlationId: 1, data: { adGroupId: 555666777, text: 'photo app', matchType: 'BROAD', bid: { amount: '1.75', currency: 'USD' }, status: 'ENABLED' } });
  });

  it('listTargetingKeywords: POST /keywords/query adGroupId filtresi', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/keywords/query`
        ? { body: { result: [{ id: 1, adGroupId: 555666777, text: 'a', matchType: 'BROAD', status: 'PAUSED', bid: { amount: '1', currency: 'USD' } }], pagination: { totalCount: 1 } } }
        : undefined),
    ], { adAccountId: '300000001' });
    const list = await c.listTargetingKeywords('444555666', '555666777');
    expect(list[0]).toMatchObject({ id: '1', status: 'PAUSED', bid: 1 });
    expect(calls.find((x) => x.url === `${BASE}/keywords/query`)!.body.filters).toEqual([{ field: 'adGroupId', operator: 'EQUALS', value: 555666777 }]);
  });

  it('guncelleme: PUT /keywords/{id} yalniz bid + status; ACTIVE → ENABLED', async () => {
    const { c, calls } = client([
      (call) => (call.method === 'PUT' && call.url === `${BASE}/keywords/888999000`
        ? { body: { result: { id: 888999000, text: 'photo editor', matchType: 'EXACT', status: call.body.status ?? 'ENABLED', bid: call.body.bid ?? { amount: '2.5', currency: 'USD' } } } }
        : undefined),
    ], { adAccountId: '300000001' });
    const paused = await c.updateTargetingKeyword('c', 'g', '888999000', { status: 'PAUSED' });
    expect(paused?.status).toBe('PAUSED');
    await c.updateTargetingKeyword('c', 'g', '888999000', { status: 'ACTIVE', bid: { amount: '3.75', currency: 'USD' } });
    const puts = calls.filter((x) => x.method === 'PUT');
    expect(puts[0].body).toEqual({ status: 'PAUSED' });
    expect(puts[1].body).toEqual({ bid: { amount: '3.75', currency: 'USD' }, status: 'ENABLED' });
  });
});

describe('Platform varsayilan urun sayfasi reklami', () => {
  it('ad group\'ta etkin reklam varsa yenisi acilmaz', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/ads/query` ? { body: { result: [{ id: 777888999, adGroupId: 555666777, status: 'ENABLED', deleted: false }] } } : undefined),
    ], { adAccountId: '300000001' });
    expect(await c.prepareAdGroupForServing('c', '555666777', '123')).toEqual({ adId: '777888999', created: false });
    expect(calls.some((x) => x.url === `${BASE}/ads` && x.method === 'POST')).toBe(false);
  });

  it('ayni app icin creative varsa yeniden kullanilir, reklam baglanir', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/ads/query` ? { body: { result: [] } } : undefined),
      (call) => (call.url === `${BASE}/creatives/query`
        ? { body: { result: [
            { id: 1, creativeType: 'DEFAULT_PRODUCT_PAGE', destination: { parameters: { adamId: '999' } }, systemStatus: 'VALID' },
            { id: 2, creativeType: 'DEFAULT_PRODUCT_PAGE', destination: { parameters: { adamId: '123' } }, systemStatus: 'VALID' },
          ] } }
        : undefined),
      (call) => (call.url === `${BASE}/ads` && call.method === 'POST' ? { body: { result: { id: 5, status: 'ENABLED' } } } : undefined),
    ], { adAccountId: '300000001' });
    expect(await c.prepareAdGroupForServing('c', '555666777', '123')).toEqual({ adId: '5', created: true });
    expect(calls.some((x) => x.url === `${BASE}/creatives` && x.method === 'POST')).toBe(false);
    expect(calls.find((x) => x.url === `${BASE}/ads` && x.method === 'POST')!.body).toEqual({
      name: 'RanksUp default product page', adGroupId: 555666777, creativeId: 2, status: 'ENABLED',
    });
  });

  it('creative yoksa DEFAULT_PRODUCT_PAGE olusturulur', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/ads/query` ? { body: { result: [] } } : undefined),
      (call) => (call.url === `${BASE}/creatives/query` ? { body: { result: [] } } : undefined),
      (call) => (call.url === `${BASE}/creatives` && call.method === 'POST' ? { body: { result: { id: 666777889, creativeType: 'DEFAULT_PRODUCT_PAGE' } } } : undefined),
      (call) => (call.url === `${BASE}/ads` && call.method === 'POST' ? { body: { result: { id: 6 } } } : undefined),
    ], { adAccountId: '300000001' });
    await c.prepareAdGroupForServing('c', '555666777', '123');
    expect(calls.find((x) => x.url === `${BASE}/creatives` && x.method === 'POST')!.body).toEqual({
      name: 'RanksUp default product page 123',
      creativeType: 'DEFAULT_PRODUCT_PAGE',
      creativeSpec: {},
      destination: { destinationType: 'APP_STORE_PRODUCT_PAGE', parameters: { adamId: '123' } },
    });
  });
});

describe('Platform raporlar', () => {
  it('kampanya gunluk raporu: granularMetrics → satirlar; timeRange DAILY/UTC', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/reports/apps/campaigns/query`
        ? {
            body: {
              result: {
                rows: [{
                  metadata: { id: 555666777, name: 'X' },
                  totalMetrics: { taps: 3210 },
                  granularMetrics: [
                    { date: '2025-01-10', localSpend: { amount: '241.25', currency: 'USD' }, impressions: 76150, taps: 1605, ttr: 0.021, tapInstalls: 300, totalInstalls: 384, tapInstallCPI: { amount: '0.80', currency: 'USD' }, cpt: { amount: '0.15', currency: 'USD' } },
                  ],
                }],
              },
              pagination: { totalCount: 1, offset: 0, pageSize: 1000 },
            },
          }
        : undefined),
    ], { adAccountId: '300000001' });
    const rows = await c.getCampaignDailyReport({ startDate: '2025-01-10', endDate: '2025-01-11' });
    expect(rows).toEqual([{
      campaignId: '555666777', date: '2025-01-10', impressions: 76150, taps: 1605, installs: 300, totalInstalls: 384,
      spend: 241.25, currency: 'USD', avgCpt: 0.15, avgCpa: 0.8, ttr: 0.021, conversionRate: null,
    }]);
    expect(calls.find((x) => x.url.endsWith('/campaigns/query') && x.url.includes('reports'))!.body.timeRange).toEqual({
      start: '2025-01-10', end: '2025-01-11', timeZone: 'UTC', granularity: 'DAILY',
    });
  });

  it('tek gunluk istek: granularity gonderilmez, totalMetrics kullanilir (Apple kurali)', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/reports/apps/campaigns/query`
        ? { body: { result: { rows: [{ metadata: { id: 1 }, totalMetrics: { taps: 4, tapInstalls: 1 } }] }, pagination: { totalCount: 1 } } }
        : undefined),
    ], { adAccountId: '300000001' });
    const rows = await c.getCampaignDailyReport({ startDate: '2025-01-10', endDate: '2025-01-10' });
    expect(rows[0]).toMatchObject({ campaignId: '1', date: '2025-01-10', taps: 4, installs: 1 });
    expect(calls.find((x) => x.url.includes('reports'))!.body.timeRange.granularity).toBeUndefined();
  });

  it('bos rapor: result {} → bos dizi', async () => {
    const { c } = client([(call) => (call.url.includes('/reports/apps/campaigns/query') ? { body: { result: {}, pagination: { totalCount: 0 } } } : undefined)], { adAccountId: '300000001' });
    expect(await c.getCampaignDailyReport({ startDate: '2025-01-01', endDate: '2025-01-07' })).toEqual([]);
  });

  it('kelime raporu: campaignId filtresi zorunlu, totalMetrics', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/reports/apps/keywords/query`
        ? { body: { result: { rows: [{ metadata: { id: 888999000, text: 'productivity app', matchType: 'BROAD', adGroupId: 555666777 }, totalMetrics: { taps: 250, tapInstalls: 60, localSpend: { amount: '75.00', currency: 'USD' } } }] }, pagination: { totalCount: 1 } } }
        : undefined),
    ], { adAccountId: '300000001' });
    const rows = await c.getKeywordReport('444555666', { startDate: '2025-01-01', endDate: '2025-01-07' });
    expect(rows[0]).toMatchObject({ keywordId: '888999000', text: 'productivity app', taps: 250, installs: 60, spend: 75 });
    const body = calls.find((x) => x.url.endsWith('/keywords/query') && x.url.includes('reports'))!.body;
    expect(body.filters).toEqual([{ field: 'campaignId', operator: 'EQUALS', value: '444555666' }]);
    expect(body.timeRange.granularity).toBeUndefined();
  });

  it('arama terimi raporu: ORTZ + searchTermText + keyword nesnesi', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/reports/apps/searchterms/query`
        ? { body: { result: { rows: [{ metadata: { searchTermText: 'best productivity app 2025', searchTermSource: 'AUTO', adGroupId: 555666777, keyword: { id: 888999000, text: 'productivity app', matchType: 'BROAD' } }, totalMetrics: { impressions: 3000, taps: 150, tapInstalls: 35 } }] } } }
        : undefined),
    ], { adAccountId: '300000001' });
    const rows = await c.getSearchTermReport('444555666', '555666777', { startDate: '2025-01-01', endDate: '2025-01-31' });
    expect(rows[0]).toMatchObject({ searchTerm: 'best productivity app 2025', keywordId: '888999000', keyword: 'productivity app', source: 'AUTO', installs: 35 });
    const body = calls.find((x) => x.url.endsWith('/searchterms/query'))!.body;
    expect(body.timeRange.timeZone).toBe('ORTZ');
    expect(body.filters).toHaveLength(2);
  });
});

describe('Platform insights', () => {
  it('arama terimi populerligi: fields + WEEKLY_SUN_SAT + goreli puanlar', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/insights/apps/search-term-popularity/query`
        ? { body: { result: { rows: [{ week: '2025-01-12', countryOrRegion: 'US', genre: 'PRODUCTIVITY_UTILITIES', searchTerm: 'task manager', rankInGenre: 1, searchPopularityInGenre: 95, searchPopularity1to100: 88, searchPopularity1to5: 5 }] } } }
        : undefined),
    ], { adAccountId: '300000001' });
    const rows = await c.getSearchTermPopularity({ countryOrRegion: 'US', genre: 'PRODUCTIVITY_UTILITIES', searchTerms: ['task manager'], startDate: '2025-01-05', endDate: '2025-01-11' });
    expect(rows).toEqual([{ searchTerm: 'task manager', countryOrRegion: 'US', genre: 'PRODUCTIVITY_UTILITIES', period: '2025-01-12', popularity1to100: 88, popularityInGenre: 95, popularity1to5: 5, rankInGenre: 1 }]);
    const body = calls.find((x) => x.url.includes('search-term-popularity'))!.body;
    expect(body.fields).toEqual(['rankInGenre', 'searchPopularityInGenre', 'searchPopularity1to100', 'searchPopularity1to5']);
    expect(body.timeRange).toEqual({ start: '2025-01-05', end: '2025-01-11', granularity: 'WEEKLY_SUN_SAT' });
    expect(body.filters).toContainEqual({ field: 'searchTerm', operator: 'IN', value: ['task manager'] });
  });

  it('gosterim payi: promotedObjectId IN filtresi, ALL_SLOTS, kademeli kodlama korunur', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/insights/apps/impression-share/query`
        ? { body: { result: { rows: [{ day: '2025-01-01', appName: 'A', promotedObjectId: '123', countryOrRegion: 'US', searchTerm: 'trip', lowImpressionShare: 0.91, highImpressionShare: 1, rank: 1, searchPopularity1to5: 3 }] } } }
        : undefined),
    ], { adAccountId: '300000001' });
    const rows = await c.getImpressionShare({ adamId: '123', countryOrRegion: 'US', startDate: '2025-01-01', endDate: '2025-01-07' });
    expect(rows[0]).toEqual({ date: '2025-01-01', searchTerm: 'trip', countryOrRegion: 'US', lowShare: 0.91, highShare: 1, rank: 1, popularity1to5: 3 });
    const body = calls.find((x) => x.url.includes('impression-share'))!.body;
    expect(body.filters[0]).toEqual({ field: 'promotedObjectId', operator: 'IN', value: ['123'] });
    expect(body.options).toEqual({ impressionShareReportType: 'ALL_SLOTS' });
  });
});

describe('Platform hiz siniri ve hatalar', () => {
  it('RateLimit-Remaining dusukse sonraki istek RateLimit-Reset kadar bekler', async () => {
    let n = 0;
    const { c, sleep } = client([
      (call) => {
        if (call.url !== `${BASE}/keywords/query`) return undefined;
        n++;
        return { body: { result: [] }, headers: { 'ratelimit-limit': '100', 'ratelimit-remaining': n === 1 ? '2' : '90', 'ratelimit-reset': '7' } };
      },
    ], { adAccountId: '300000001' });
    await c.listTargetingKeywords('c', '1');
    expect(sleep).not.toHaveBeenCalled();
    await c.listTargetingKeywords('c', '2');
    expect(sleep).toHaveBeenCalledTimes(1);
    const waited = (sleep.mock.calls[0] as unknown as number[])[0];
    expect(waited).toBeGreaterThan(6000);
    expect(waited).toBeLessThanOrEqual(7000);
  });

  it('429 Retry-After\'i RateLimit-Reset\'e tercih eder', async () => {
    let n = 0;
    const { c, sleep } = client([
      (call) => {
        if (call.url !== `${BASE}/keywords/query`) return undefined;
        n++;
        return n === 1
          ? { status: 429, body: { error: { code: 'rate_limit_exceeded' } }, headers: { 'retry-after': '4', 'ratelimit-reset': '30', 'ratelimit-remaining': '0' } }
          : { body: { result: [] } };
      },
    ], { adAccountId: '300000001' });
    await c.listTargetingKeywords('c', '1');
    expect(sleep).toHaveBeenCalledWith(4000);
  });

  it('Platform hata govdesi: DUPLICATE_NAME → duplicate_name', async () => {
    const { c } = client([
      (call) => (call.method === 'POST' && call.url === `${BASE}/campaigns`
        ? { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Validation errors found', details: [{ code: 'DUPLICATE_NAME', message: 'Campaign name already exists.', info: { field: 'name' } }] } } }
        : undefined),
    ], { adAccountId: '300000001' });
    const err = await c.createCampaign({ name: 'K', dailyBudget: { amount: '1', currency: 'USD' }, countriesOrRegions: ['TR'], adamId: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(AsaApiError);
    expect(err.kind).toBe('duplicate_name');
    expect(err.apiVersion).toBe('platform');
    expect(err.message).toContain('DUPLICATE_NAME');
  });
});
