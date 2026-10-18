import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { AsaApiClient } from './asa-api.client.js';
import { AsaApiError } from './asa-types.js';

/**
 * v5 (Campaign Management API) adaptoru — ag yok, fetch sahte.
 * Yollar ve govdeler resmi dokumanla karsilastirildi:
 *   https://developer.apple.com/documentation/apple_ads
 */

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const CREDS = { orgId: 'SEARCHADS.client-1', keyId: 'key-uuid-1', privateKeyPem: PEM };
const BASE = 'https://api.searchads.apple.com/api/v5';

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
type Route = (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Sahte fetch: token + /acls varsayilan, digerleri route listesinden (ilk eslesen). */
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
      return json(200, { access_token: `tok-${calls.filter((c) => c.url.includes('oauth2')).length}`, expires_in: 3600, token_type: 'Bearer' });
    }
    for (const r of routes) {
      const out = r(call);
      if (out) return json(out.status ?? 200, out.body, out.headers);
    }
    if (call.url === `${BASE}/acls`) {
      return json(200, { data: [{ orgId: 40669820, orgName: 'Trip Trek', currency: 'USD', roleNames: ['Admin'] }], pagination: null, error: null });
    }
    return json(404, { error: { errors: [{ messageCode: 'NOT_FOUND', message: `no route ${call.method} ${call.url}` }] } });
  });
  return { fn, calls };
}

function client(routes: Route[] = [], extra: Partial<ConstructorParameters<typeof AsaApiClient>[0]> = {}) {
  const f = fakeFetch(routes);
  const sleep = vi.fn(async () => undefined);
  const c = new AsaApiClient({ ...CREDS, ...extra }, { fetchImpl: f.fn as any, sleep });
  return { c, ...f, sleep };
}

function decodeJwt(token: string) {
  const [h, p, s] = token.split('.');
  const dec = (x: string) => JSON.parse(Buffer.from(x, 'base64url').toString('utf8'));
  return { header: dec(h), payload: dec(p), signingInput: `${h}.${p}`, signature: Buffer.from(s, 'base64url') };
}

describe('v5 kimlik dogrulama', () => {
  it('token takasi: form govdesi + ES256 client secret (iss=teamId, sub=clientId)', async () => {
    const { c, calls } = client([], { teamId: 'SEARCHADS.team-9' });
    const tok = await c.getAccessToken();
    expect(tok.accessToken).toBe('tok-1');
    const call = calls[0];
    expect(call.method).toBe('POST');
    const form = new URLSearchParams(call.body);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('SEARCHADS.client-1');
    expect(form.get('scope')).toBe('searchadsorg');
    const jwt = decodeJwt(form.get('client_secret')!);
    expect(jwt.header).toEqual({ alg: 'ES256', kid: 'key-uuid-1' });
    expect(jwt.payload).toMatchObject({ iss: 'SEARCHADS.team-9', sub: 'SEARCHADS.client-1', aud: 'https://appleid.apple.com' });
    expect(jwt.signature.length).toBe(64); // ham R||S
    expect(cryptoVerify('sha256', Buffer.from(jwt.signingInput), { key: publicKey, dsaEncoding: 'ieee-p1363' }, jwt.signature)).toBe(true);
  });

  it('teamId yoksa iss = clientId (eski davranis)', async () => {
    const { c, calls } = client();
    await c.getAccessToken();
    const jwt = decodeJwt(new URLSearchParams(calls[0].body).get('client_secret')!);
    expect(jwt.payload.iss).toBe('SEARCHADS.client-1');
  });

  it('token hatasi mesaji web ekraninin aradigi bicimde', async () => {
    const f = vi.fn(async () => json(400, { error: 'invalid_client' }));
    const c = new AsaApiClient(CREDS, { fetchImpl: f as any });
    await expect(c.getAccessToken()).rejects.toThrow(/Apple token swap failed: 400 .*invalid_client/);
  });
});

describe('v5 hesap baglami', () => {
  it('/acls sayisal orgId → X-AP-Context: orgId=…', async () => {
    const { c, calls } = client([(call) => (call.url.startsWith(`${BASE}/campaigns`) ? { body: { data: [], pagination: { totalResults: 0 } } } : undefined)]);
    const info = await c.getAccountInfo();
    expect(info).toEqual({ contextId: '40669820', name: 'Trip Trek', currency: 'USD', orgId: '40669820' });
    await c.listCampaigns();
    const campaignsCall = calls.find((x) => x.url.startsWith(`${BASE}/campaigns`))!;
    expect(campaignsCall.headers['x-ap-context']).toBe('orgId=40669820');
    expect(campaignsCall.headers.authorization).toBe('Bearer tok-1');
    // /acls cagrisi context istemez
    expect(calls.find((x) => x.url === `${BASE}/acls`)!.headers['x-ap-context']).toBeUndefined();
  });

  it('dokumandaki tek nesne bicimli /acls cevabi da kabul edilir', async () => {
    const { c } = client([(call) => (call.url === `${BASE}/acls` ? { body: { data: { orgId: 7, orgName: 'X', currency: 'EUR' } } } : undefined)]);
    expect((await c.getAccountInfo()).contextId).toBe('7');
    expect(await c.fetchNumericOrgId()).toBe(7);
  });
});

describe('v5 kampanyalar', () => {
  it('listCampaigns sayfalar ve normalize eder (gunluk butce dailyBudgetAmount\'tan)', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: 1000 + i,
      name: `C${i}`,
      status: 'ENABLED',
      dailyBudgetAmount: { amount: '15', currency: 'USD' },
      countriesOrRegions: ['TR'],
      supplySources: ['APPSTORE_SEARCH_RESULTS'],
      adamId: 123,
    }));
    const page2 = [{ id: 2000, name: 'Eski', status: 'PAUSED', deleted: true, displayStatus: 'DELETED', budgetAmount: { amount: '450', currency: 'USD' }, dailyBudgetAmount: { amount: '15', currency: 'USD' } }];
    const { c, calls } = client([
      (call) => (call.url.includes('/campaigns?limit=100&offset=0') ? { body: { data: page1, pagination: { totalResults: 101 } } } : undefined),
      (call) => (call.url.includes('/campaigns?limit=100&offset=100') ? { body: { data: page2, pagination: { totalResults: 101 } } } : undefined),
    ]);
    const list = await c.listCampaigns();
    expect(list).toHaveLength(101);
    expect(list[0]).toMatchObject({ id: '1000', dailyBudget: 15, totalBudget: null, adamId: '123', deleted: false, supplySources: ['APPSTORE_SEARCH_RESULTS'] });
    expect(list[100]).toMatchObject({ id: '2000', deleted: true, dailyBudget: 15, totalBudget: 450 });
    expect(calls.filter((x) => x.url.includes('/campaigns?')).length).toBe(2);
  });

  it('createCampaign: resmi ornekteki alanlar; budgetAmount ve paymentModel yok', async () => {
    const { c, calls } = client([
      (call) => (call.method === 'POST' && call.url === `${BASE}/campaigns`
        ? { body: { data: { id: 886873328, name: call.body.name, status: 'ENABLED', dailyBudgetAmount: call.body.dailyBudgetAmount, adamId: 535500008, countriesOrRegions: ['TR'] } } }
        : undefined),
    ]);
    const camp = await c.createCampaign({ name: 'Kamp', dailyBudget: { amount: '15', currency: 'USD' }, countriesOrRegions: ['TR'], adamId: 535500008 });
    expect(camp.id).toBe('886873328');
    const body = calls.find((x) => x.method === 'POST' && x.url === `${BASE}/campaigns`)!.body;
    expect(body).toEqual({
      name: 'Kamp',
      adamId: 535500008,
      countriesOrRegions: ['TR'],
      dailyBudgetAmount: { amount: '15', currency: 'USD' },
      supplySources: ['APPSTORE_SEARCH_RESULTS'],
      adChannelType: 'SEARCH',
      billingEvent: 'TAPS',
      status: 'ENABLED',
    });
  });

  it('createAdGroup: pricingModel CPC, startTime Z\'siz', async () => {
    const { c, calls } = client([
      (call) => (call.method === 'POST' && call.url.endsWith('/campaigns/55/adgroups')
        ? { body: { data: { id: 77, campaignId: 55, name: call.body.name, defaultBidAmount: call.body.defaultBidAmount, status: 'ENABLED' } } }
        : undefined),
    ]);
    const g = await c.createAdGroup('55', { name: 'AG', defaultBid: { amount: '0.50', currency: 'USD' }, startTime: new Date('2026-10-17T10:00:00Z') });
    expect(g).toEqual({ id: '77', campaignId: '55', name: 'AG', defaultBid: 0.5, status: 'ENABLED' });
    const body = calls.find((x) => x.url.endsWith('/adgroups'))!.body;
    expect(body).toMatchObject({ pricingModel: 'CPC', startTime: '2026-10-17T10:00:00.000', defaultBidAmount: { amount: '0.50', currency: 'USD' } });
  });
});

describe('v5 anahtar kelimeler', () => {
  it('kopya kelime: cevap 200 + govdede hata → id\'siz kayit olusmus sayilmaz', async () => {
    const { c } = client([
      (call) => (call.url.endsWith('/targetingkeywords/bulk') && call.method === 'POST'
        ? {
            body: {
              data: [{ id: 9001, adGroupId: 77, text: 'fotograf', status: 'ACTIVE', matchType: 'EXACT', bidAmount: { amount: '0.5', currency: 'USD' } }],
              error: { errors: [{ messageCode: 'DUPLICATE_KEYWORD', message: 'Keyword already exists' }] },
            },
          }
        : undefined),
    ]);
    const r = await c.addTargetingKeywords('55', '77', [
      { text: 'fotograf', matchType: 'EXACT', bid: { amount: '0.50', currency: 'USD' } },
      { text: 'editor', matchType: 'EXACT', bid: { amount: '0.50', currency: 'USD' } },
    ]);
    expect(r.created).toEqual([{ id: '9001', adGroupId: '77', campaignId: null, text: 'fotograf', matchType: 'EXACT', bid: 0.5, status: 'ACTIVE', deleted: false }]);
    expect(r.failed).toEqual([{ text: 'editor', reason: 'Keyword already exists' }]);
  });

  it('teklif/durum guncelleme v5\'in TOPLU PUT ucuna dizi govdeyle gider', async () => {
    const { c, calls } = client([
      (call) => (call.method === 'PUT' && call.url === `${BASE}/campaigns/55/adgroups/77/targetingkeywords/bulk`
        ? { body: { data: [{ id: 9001, text: 'x', status: 'PAUSED', matchType: 'EXACT', bidAmount: { amount: '0.7', currency: 'USD' } }] } }
        : undefined),
    ]);
    const kw = await c.updateTargetingKeyword('55', '77', '9001', { bid: { amount: '0.70', currency: 'USD' }, status: 'PAUSED' });
    expect(kw?.status).toBe('PAUSED');
    const put = calls.find((x) => x.method === 'PUT')!;
    expect(put.body).toEqual([{ id: 9001, bidAmount: { amount: '0.70', currency: 'USD' }, status: 'PAUSED' }]);
    // Eski kodun kullandigi (v5'te olmayan) tekil uc cagrilmaz
    expect(calls.some((x) => x.url.endsWith('/targetingkeywords/9001'))).toBe(false);
  });
});

describe('v5 raporlar', () => {
  it('gunluk kampanya raporu: yukleme tapInstalls\'tan, tarih normalize', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/reports/campaigns`
        ? {
            body: {
              data: {
                reportingDataResponse: {
                  row: [{
                    metadata: { campaignId: 542370539 },
                    granularity: [
                      { date: '2026-10-10', impressions: 17, taps: 6, localSpend: { amount: '0.95', currency: 'USD' }, tapInstalls: 5, totalInstalls: 10, tapInstallCPI: { amount: '0.19', currency: 'USD' }, tapInstallRate: 0.8333, ttr: 0.27, avgCPT: { amount: '0.16', currency: 'USD' } },
                    ],
                  }],
                },
              },
            },
          }
        : undefined),
    ]);
    const rows = await c.getCampaignDailyReport({ startDate: '2026-10-10', endDate: '2026-10-17' });
    expect(rows).toEqual([{
      campaignId: '542370539', date: '2026-10-10', impressions: 17, taps: 6, installs: 5, totalInstalls: 10,
      spend: 0.95, currency: 'USD', avgCpt: 0.16, avgCpa: 0.19, ttr: 0.27, conversionRate: 0.8333,
    }]);
    const body = calls.find((x) => x.url === `${BASE}/reports/campaigns`)!.body;
    expect(body).toMatchObject({ startTime: '2026-10-10', endTime: '2026-10-17', granularity: 'DAILY', timeZone: 'UTC', returnRowTotals: false, returnGrandTotals: false });
    expect(body.selector.orderBy).toEqual([{ field: 'impressions', sortOrder: 'DESCENDING' }]);
  });

  it('kelime raporu: /reports/campaigns/{id}/keywords, donem toplami (total)', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/reports/campaigns/55/keywords`
        ? { body: { data: { reportingDataResponse: { row: [{ metadata: { keywordId: 9001, keyword: 'fotograf', matchType: 'EXACT', adGroupId: 77 }, total: { taps: 25, tapInstalls: 0, impressions: 300, localSpend: { amount: '12', currency: 'USD' } } }] } } } }
        : undefined),
    ]);
    const rows = await c.getKeywordReport('55', { startDate: '2026-10-10', endDate: '2026-10-17' });
    expect(rows[0]).toMatchObject({ keywordId: '9001', adGroupId: '77', text: 'fotograf', taps: 25, installs: 0, spend: 12 });
    const body = calls.find((x) => x.url.endsWith('/keywords'))!.body;
    expect(body.returnRowTotals).toBe(true);
    expect(body.granularity).toBeUndefined();
  });

  it('arama terimi raporu: ad group yolu + ORTZ', async () => {
    const { c, calls } = client([
      (call) => (call.url === `${BASE}/reports/campaigns/55/adgroups/77/searchterms`
        ? { body: { data: { reportingDataResponse: { row: [{ metadata: { searchTermText: 'foto duzenle', keywordId: 9001, keyword: 'foto', matchType: 'BROAD', adGroupId: 77, searchTermSource: 'TARGETED' }, total: { impressions: 41, taps: 1, tapInstalls: 1 } }] } } } }
        : undefined),
    ]);
    const rows = await c.getSearchTermReport('55', '77', { startDate: '2026-10-10', endDate: '2026-10-17' });
    expect(rows[0]).toMatchObject({ searchTerm: 'foto duzenle', keyword: 'foto', source: 'TARGETED', installs: 1 });
    expect(calls.find((x) => x.url.endsWith('/searchterms'))!.body.timeZone).toBe('ORTZ');
  });
});

describe('v5 hiz siniri ve hata davranisi', () => {
  it('429 → Retry-After kadar bekle, tekrar dene', async () => {
    let n = 0;
    const { c, sleep } = client([
      (call) => {
        if (!call.url.includes('/campaigns?')) return undefined;
        n++;
        return n === 1 ? { status: 429, body: { error: { errors: [{ messageCode: '429', message: 'rate' }] } }, headers: { 'retry-after': '3' } } : { body: { data: [] } };
      },
    ]);
    await expect(c.listCampaigns()).resolves.toEqual([]);
    expect(n).toBe(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('429 Retry-After cok uzunsa beklemeden rate_limited hatasi', async () => {
    const { c } = client([
      (call) => (call.url.includes('/campaigns?') ? { status: 429, body: {}, headers: { 'retry-after': '120' } } : undefined),
    ]);
    const err = await c.listCampaigns().catch((e) => e);
    expect(err).toBeInstanceOf(AsaApiError);
    expect(err.kind).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBe(120);
  });

  it('401 → token bir kez yenilenir ve istek tekrarlanir', async () => {
    let n = 0;
    const { c, calls } = client([
      (call) => {
        if (!call.url.includes('/campaigns?')) return undefined;
        n++;
        return n === 1 ? { status: 401, body: {} } : { body: { data: [] } };
      },
    ]);
    await c.listCampaigns();
    const listCalls = calls.filter((x) => x.url.includes('/campaigns?'));
    expect(listCalls[0].headers.authorization).toBe('Bearer tok-1');
    expect(listCalls[1].headers.authorization).toBe('Bearer tok-2');
  });

  it('5xx: okuma tekrarlanir, kampanya OLUSTURMA tekrarlanmaz (kopya kampanya riski)', async () => {
    let gets = 0;
    let posts = 0;
    const { c } = client([
      (call) => {
        if (call.url.includes('/campaigns?')) {
          gets++;
          return gets === 1 ? { status: 500, body: {} } : { body: { data: [] } };
        }
        if (call.method === 'POST' && call.url === `${BASE}/campaigns`) {
          posts++;
          return { status: 500, body: { error: { errors: [{ messageCode: '500', message: 'down' }] } } };
        }
        return undefined;
      },
    ]);
    await expect(c.listCampaigns()).resolves.toEqual([]);
    expect(gets).toBe(2);
    const err = await c.createCampaign({ name: 'K', dailyBudget: { amount: '1', currency: 'USD' }, countriesOrRegions: ['TR'], adamId: 1 }).catch((e) => e);
    expect(err.kind).toBe('server');
    expect(posts).toBe(1);
  });

  it('kopya kampanya adi → duplicate_name turu, mesaj eski bicimde', async () => {
    const { c } = client([
      (call) => (call.method === 'POST' && call.url === `${BASE}/campaigns`
        ? { status: 400, body: { error: { errors: [{ messageCode: 'DUPLICATE_CAMPAIGN_NAME', message: 'Campaign name is not unique', field: 'name' }] } } }
        : undefined),
    ]);
    const err = await c.createCampaign({ name: 'K', dailyBudget: { amount: '1', currency: 'USD' }, countriesOrRegions: ['TR'], adamId: 1 }).catch((e) => e);
    expect(err.kind).toBe('duplicate_name');
    expect(err.message).toMatch(/^ASA POST \/campaigns → 400: DUPLICATE_CAMPAIGN_NAME/);
  });
});
