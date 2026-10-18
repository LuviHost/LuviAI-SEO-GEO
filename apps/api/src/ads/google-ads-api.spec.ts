import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOOGLE_ADS_API_VERSION,
  googleAdsUrl,
  normalizeCustomerId,
  isNumericId,
  isAdGroupAdResourceName,
  isCampaignBudgetResourceName,
  envLoginCustomerId,
  googleAdsHeaders,
  googleAdsOAuthClient,
  parseGoogleAdsError,
  describeGoogleAdsError,
  googleAdsUserReason,
  partialFailureOutcome,
  googleAdsRequest,
} from './google-ads-api.js';

/**
 * Google Ads API surumu TEK yerde (google-ads-api.ts). v21 5 Agustos 2026'da,
 * v22 7 Ekim 2026'da kapandi; v26 en yeni surum (kapanis Kasim 2027).
 * Developer token 9 Eylul 2026'da kalkti: baslik gonderilmez.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Google'in REST hata govdesi: { error: google.rpc.Status } + GoogleAdsFailure */
const adsFailure = (code: Record<string, string>, message: string, requestId = 'req-123', http = 400) => ({
  error: {
    code: http,
    message: 'Request contains an invalid argument.',
    status: 'INVALID_ARGUMENT',
    details: [{
      '@type': `type.googleapis.com/google.ads.googleads.${GOOGLE_ADS_API_VERSION}.errors.GoogleAdsFailure`,
      errors: [{ errorCode: code, message }],
      requestId,
    }],
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('surum ve adres', () => {
  it('surum v26, adres tek yardimcidan kurulur', () => {
    expect(GOOGLE_ADS_API_VERSION).toBe('v26');
    expect(googleAdsUrl('customers:listAccessibleCustomers')).toBe('https://googleads.googleapis.com/v26/customers:listAccessibleCustomers');
    expect(googleAdsUrl('/customers/1/googleAds:search')).toBe('https://googleads.googleapis.com/v26/customers/1/googleAds:search');
  });

  it('kaynakta sabit surumlu Google Ads adresi ve developer-token basligi kalmadi', () => {
    // Surum yalniz google-ads-api.ts'de; baska dosya "googleads.googleapis.com/vNN" yazamaz
    const here = dirname(fileURLToPath(import.meta.url));
    const roots = [join(here, '..'), join(here, '..', '..', '..', 'worker', 'src')].filter((p) => existsSync(p));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === 'node_modules' || name === 'dist') continue;
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|js|mjs)$/.test(name) || /\.spec\.ts$/.test(name)) continue;
        const src = readFileSync(p, 'utf8');
        if (/googleads\.googleapis\.com\/v\d+/.test(src)) offenders.push(`${relative(here, p)}: sabit surum`);
        if (/['"`]developer-token['"`]/.test(src)) offenders.push(`${relative(here, p)}: developer-token basligi`);
        if (/GOOGLE_ADS_DEV_TOKEN/.test(src.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))) offenders.push(`${relative(here, p)}: GOOGLE_ADS_DEV_TOKEN okunuyor`);
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});

describe('kimlik normallestirme', () => {
  it('musteri kimligi tiresiz; rakam disi deger reddedilir', () => {
    expect(normalizeCustomerId('123-456-7890')).toBe('1234567890');
    expect(normalizeCustomerId(' 123 456 7890 ')).toBe('1234567890');
    expect(normalizeCustomerId(1234567890)).toBe('1234567890');
    expect(normalizeCustomerId('../1234')).toBeNull();
    expect(normalizeCustomerId('12a')).toBeNull();
    expect(normalizeCustomerId('')).toBeNull();
    expect(normalizeCustomerId(undefined)).toBeNull();
    expect(normalizeCustomerId(null)).toBeNull();
  });

  it('kampanya kimligi yalniz rakam (GAQL\'e ham girmez)', () => {
    expect(isNumericId('555')).toBe(true);
    expect(isNumericId('555 OR 1=1')).toBe(false);
    expect(isNumericId('')).toBe(false);
    expect(isNumericId(555 as any)).toBe(false);
  });

  it('kaynak adlari yalniz ayni musteriye ait olabilir', () => {
    expect(isAdGroupAdResourceName('customers/111/adGroupAds/22~33', '111')).toBe(true);
    expect(isAdGroupAdResourceName('customers/999/adGroupAds/22~33', '111')).toBe(false);
    expect(isAdGroupAdResourceName('customers/111/adGroupAds/22', '111')).toBe(false);
    expect(isCampaignBudgetResourceName('customers/111/campaignBudgets/7', '111')).toBe(true);
    expect(isCampaignBudgetResourceName('customers/222/campaignBudgets/7', '111')).toBe(false);
    expect(isCampaignBudgetResourceName(undefined, '111')).toBe(false);
  });

  it('GOOGLE_ADS_LOGIN_CUSTOMER_ID tiresiz; bos ya da gecersizse yok', () => {
    vi.stubEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', '987-654-3210');
    expect(envLoginCustomerId()).toBe('9876543210');
    vi.stubEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', '');
    expect(envLoginCustomerId()).toBeNull();
    vi.stubEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'mcc');
    expect(envLoginCustomerId()).toBeNull();
  });
});

describe('basliklar ve OAuth istemcisi', () => {
  it('developer-token yok; login-customer-id tiresiz; GET icin Content-Type yok', () => {
    vi.stubEnv('GOOGLE_ADS_DEV_TOKEN', 'legacy-token');
    const h = googleAdsHeaders('at', { loginCustomerId: '987-654-3210' });
    expect(h).toEqual({ Authorization: 'Bearer at', 'Content-Type': 'application/json', 'login-customer-id': '9876543210' });
    expect(googleAdsHeaders('at', { json: false })).toEqual({ Authorization: 'Bearer at' });
    expect(googleAdsHeaders('at', { loginCustomerId: 'x' })).not.toHaveProperty('login-customer-id');
  });

  it('istemci onceligi baglanti akisiyla ayni: GOOGLE_CLIENT_ID, yoksa GOOGLE_OAUTH_CLIENT_ID', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'web-client');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'web-secret');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'other-client');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'other-secret');
    expect(googleAdsOAuthClient()).toEqual({ clientId: 'web-client', clientSecret: 'web-secret' });
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    expect(googleAdsOAuthClient()).toEqual({ clientId: 'other-client', clientSecret: 'other-secret' });
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', '');
    expect(googleAdsOAuthClient()).toEqual({ clientId: null, clientSecret: null });
  });
});

describe('hata modeli', () => {
  it('REST hata govdesinden kod, mesaj ve requestId', () => {
    const info = parseGoogleAdsError(400, JSON.stringify(adsFailure(
      { mutateError: 'EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED' },
      'Mutates are not allowed if the customer contains campaigns without the EU political advertising declaration.',
      'abc-1',
    )));
    expect(info.codes).toEqual(['mutateError.EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED']);
    expect(info.requestId).toBe('abc-1');
    expect(info.status).toBe('INVALID_ARGUMENT');
    expect(describeGoogleAdsError(info)).toContain('requestId abc-1');
    expect(describeGoogleAdsError(info)).toContain('HTTP 400');
  });

  it('partialFailureError (google.rpc.Status) de ayni bicimde okunur', () => {
    const info = parseGoogleAdsError(200, {
      code: 3,
      message: 'Multiple errors in details.',
      details: [{ errors: [{ errorCode: { criterionError: 'KEYWORD_HAS_INVALID_CHARS' }, message: 'bad' }], requestId: 'r2' }],
    });
    expect(info.codes).toEqual(['criterionError.KEYWORD_HAS_INVALID_CHARS']);
    expect(info.requestId).toBe('r2');
  });

  it('JSON olmayan govde ve bos govde', () => {
    expect(parseGoogleAdsError(404, '<html>Not Found</html>')).toEqual({ httpStatus: 404, codes: [], messages: ['<html>Not Found</html>'] });
    expect(parseGoogleAdsError(500, '')).toEqual({ httpStatus: 500, codes: [], messages: [] });
    expect(parseGoogleAdsError(403, { error: { code: 403, message: 'denied', status: 'PERMISSION_DENIED' } }))
      .toMatchObject({ status: 'PERMISSION_DENIED', messages: ['denied'] });
  });

  it('musteriye yalniz nedeni kesin hatalar aciklanir', () => {
    const eu = parseGoogleAdsError(400, adsFailure({ mutateError: 'EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED' }, 'x'));
    expect(googleAdsUserReason(eu)).toMatch(/AB siyasi reklam beyanı/);
    const crit = parseGoogleAdsError(400, adsFailure({ criterionError: 'MISSING_EU_POLITICAL_ADVERTISING_SELF_DECLARATION' }, 'x'));
    expect(googleAdsUserReason(crit)).toMatch(/AB siyasi reklam beyanı/);
    const test = parseGoogleAdsError(403, adsFailure({ authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' }, 'x', 'r', 403));
    expect(googleAdsUserReason(test)).toMatch(/henüz gerçek reklam hesapları için onaylanmadı/);
    const disabled = parseGoogleAdsError(403, adsFailure({ authorizationError: 'CUSTOMER_NOT_ENABLED' }, 'x', 'r', 403));
    expect(googleAdsUserReason(disabled)).toMatch(/etkin değil/);
    const other = parseGoogleAdsError(400, adsFailure({ fieldError: 'REQUIRED' }, 'x'));
    expect(googleAdsUserReason(other)).toBeUndefined();
    expect(googleAdsUserReason(null)).toBeUndefined();
  });

  it('kismi basari: bos sonuc = reddedilen islem', () => {
    const out = partialFailureOutcome({
      results: [{ resourceName: 'customers/1/campaignCriteria/5~1' }, {}, { resourceName: 'customers/1/campaignCriteria/5~3' }],
      partialFailureError: { code: 3, details: [{ errors: [{ errorCode: { criterionError: 'X' } }] }] },
    }, 3);
    expect(out.succeeded).toEqual([0, 2]);
    expect(out.error?.codes).toEqual(['criterionError.X']);
    expect(partialFailureOutcome({}, 2)).toEqual({ succeeded: [], error: null });
  });
});

describe('googleAdsRequest', () => {
  it('adres surumle, govde JSON, zaman asimi sinyali; hata govdesi cozulur', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, { results: [1] }))
      .mockResolvedValueOnce(json(400, adsFailure({ requestError: 'INVALID_CUSTOMER_ID' }, 'bad id')));
    const ok = await googleAdsRequest('customers/1/googleAds:search', { headers: { a: 'b' }, body: { query: 'q' } });
    expect(ok).toEqual({ ok: true, status: 200, data: { results: [1] } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://googleads.googleapis.com/v26/customers/1/googleAds:search');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"query":"q"}');
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const bad = await googleAdsRequest('customers/1/googleAds:search', { headers: {}, body: {} });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.codes).toEqual(['requestError.INVALID_CUSTOMER_ID']);
  });

  it('GET govdesiz gider; ag hatasi ve JSON olmayan basari firlatmaz', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, { resourceNames: [] }))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(new Response('not json', { status: 200 }));
    await googleAdsRequest('customers:listAccessibleCustomers', { method: 'GET', headers: {} });
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBeUndefined();
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
    await expect(googleAdsRequest('x', { headers: {} })).resolves.toMatchObject({ ok: false, status: 0 });
    await expect(googleAdsRequest('x', { headers: {} })).resolves.toMatchObject({ ok: false, status: 200 });
  });
});
