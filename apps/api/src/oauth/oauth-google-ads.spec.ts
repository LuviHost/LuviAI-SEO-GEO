import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { OAuthService } from './oauth.service.js';

/**
 * Google Ads hesap listesi v26'ya tasindi (v21 5 Agustos 2026'da kapandi) ve
 * developer token'a bagli degil (Google 9 Eylul 2026'da kaldirdi). Eskiden
 * GOOGLE_ADS_DEV_TOKEN yoksa ya da istek basarisizsa bos liste donuyor, panel
 * "bu Google hesabinda reklam hesabi yok mu?" diyordu.
 */

const V = 'https://googleads.googleapis.com/v26';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Call = { url: string; method: string; headers: Record<string, string>; body: any };

function fakeAds(handler: (c: Call) => Response) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const c: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers ?? {}) },
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(c);
    return handler(c);
  });
  return calls;
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.stubEnv('GOOGLE_ADS_DEV_TOKEN', '');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Google Ads hesap listesi', () => {
  it('v26 listAccessibleCustomers (GET, developer-token yok) + hesap basina ad/para birimi', async () => {
    const calls = fakeAds((c) => {
      if (c.url.endsWith('customers:listAccessibleCustomers')) {
        return json(200, { resourceNames: ['customers/1112223333', 'customers/4445556666', 'customers/abc', 42] });
      }
      if (c.url.includes('/customers/1112223333/')) {
        return json(200, { results: [{ customer: { id: '1112223333', descriptiveName: 'Kafe', currencyCode: 'TRY', manager: false } }] });
      }
      return json(403, { error: { code: 403, status: 'PERMISSION_DENIED', details: [{ errors: [{ errorCode: { authorizationError: 'CUSTOMER_NOT_ENABLED' } }], requestId: 'r1' }] } });
    });
    const svc = new OAuthService();
    const res = await svc.listGoogleAdsCustomersDetailed('at-1');
    expect(res).toEqual({
      customers: [
        { id: '1112223333', resourceName: 'customers/1112223333', descriptiveName: 'Kafe', currencyCode: 'TRY', isManager: false },
        { id: '4445556666', resourceName: 'customers/4445556666' },
      ],
    });

    const [list, s1] = calls;
    expect(list.url).toBe(`${V}/customers:listAccessibleCustomers`);
    expect(list.method).toBe('GET');
    expect(list.body).toBeUndefined();
    expect(list.headers).toEqual({ Authorization: 'Bearer at-1' });
    expect(s1.url).toBe(`${V}/customers/1112223333/googleAds:search`);
    expect(s1.headers['login-customer-id']).toBe('1112223333');
    expect(s1.headers).not.toHaveProperty('developer-token');
    expect(s1.body.query).toBe('SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1');
    // gecersiz kaynak adlari icin istek atilmaz
    expect(calls).toHaveLength(3);
  });

  it('liste alinamazsa bos dizi (eski sozlesme) + ayri neden', async () => {
    fakeAds(() => json(500, { error: { code: 500, message: 'Internal error encountered.', status: 'INTERNAL' } }));
    const svc = new OAuthService();
    await expect(svc.listGoogleAdsCustomers('at-1')).resolves.toEqual([]);
    await expect(svc.listGoogleAdsCustomersDetailed('at-1')).resolves.toEqual({
      customers: [],
      error: expect.stringMatching(/alınamadı/),
    });
  });

  it('erisimi olmayan bulut projesinde neden musteriye acik yazilir', async () => {
    fakeAds(() => json(403, { error: { code: 403, details: [{ errors: [{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' } }] }] } }));
    const res = await new OAuthService().listGoogleAdsCustomersDetailed('at-1');
    expect(res.customers).toEqual([]);
    expect(res.error).toMatch(/henüz gerçek reklam hesapları için onaylanmadı/);
  });
});

describe('Google Ads OAuth istemcisi', () => {
  it('izin adresi baglanti istemcisini kullanir; GOOGLE_CLIENT_ID bossa GOOGLE_OAUTH_CLIENT_ID', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'web-client');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'other-client');
    const svc = new OAuthService();
    const u1 = new URL(svc.buildGoogleAdsAuthUrl('state-1'));
    expect(u1.searchParams.get('client_id')).toBe('web-client');
    expect(u1.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/adwords');
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    expect(new URL(svc.buildGoogleAdsAuthUrl('state-1')).searchParams.get('client_id')).toBe('other-client');
  });
});
