import { describe, it, expect, vi, afterEach } from 'vitest';
import { MetaAdsClientService, metaMinorUnits, META_OFFSET_ONE_CURRENCIES } from './meta-ads-client.service.js';
import { GoogleAdsClientService } from './google-ads-client.service.js';
import { AdsClientService } from './ads-client.service.js';

/**
 * Reklam tutarlari hesabin PARA BIRIMINDEDIR (TL varsayilmaz). Meta butceyi
 * para biriminin en kucuk biriminde ister; offset'i 1 olan birimlerde (JPY,
 * KRW ...) eski kodun x100'u butceyi 100 kat yaziyordu.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const prismaFor = (site: Record<string, unknown>) => ({
  site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', ...site })) },
}) as any;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('metaMinorUnits', () => {
  it('TRY/USD/EUR x100 (kurus/sent), offset 1 birimlerde x1', () => {
    expect(metaMinorUnits(50, 'TRY')).toBe(5000);
    expect(metaMinorUnits(12.34, 'USD')).toBe(1234);
    expect(metaMinorUnits(50, 'EUR')).toBe(5000);
    expect(metaMinorUnits(1200, 'JPY')).toBe(1200);
    expect(metaMinorUnits(5000, 'KRW')).toBe(5000);
    for (const c of ['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']) {
      expect(META_OFFSET_ONE_CURRENCIES.has(c), c).toBe(true);
    }
  });
});

describe('MetaAdsClientService para birimi', () => {
  it('gunluk butce hesabin para birimine gore yazilir (JPY hesapta x1)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('fields=currency')) return json(200, { id: 'act_1', currency: 'JPY' });
      // Kampanya butcesi (CBO) canli okunur: 1000 JPY
      if (u.includes('/999?fields=effective_status')) return json(200, { id: '999', effective_status: 'ACTIVE', daily_budget: '1000' });
      if (init?.method === 'POST') return json(200, { success: true });
      return json(404, {});
    });
    const meta = new MetaAdsClientService(prismaFor({ metaAdsAccessToken: 'raw-token', metaAdsAccountId: 'act_1' }));
    await expect(meta.updateDailyBudget('s1', '999', 1200, 1000)).resolves.toEqual({ ok: true, applied: 1200 });
    const post = fetchMock.mock.calls.find((c) => (c[1] as any)?.method === 'POST')!;
    expect(String(post[0])).toContain('/999');
    expect(new URLSearchParams(String((post[1] as any).body)).get('daily_budget')).toBe('1200');
  });

  it('para birimi okunamazsa butceye dokunulmaz', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(500, { error: 'x' }));
    const meta = new MetaAdsClientService(prismaFor({ metaAdsAccessToken: 'raw-token', metaAdsAccountId: 'act_1' }));
    await expect(meta.updateDailyBudget('s1', '999', 100, 80)).resolves.toEqual({ ok: false });
    expect(fetchMock.mock.calls.every((c) => (c[1] as any)?.method !== 'POST')).toBe(true);
  });

  it('boost: para birimi okunamazsa kampanya acilmaz; okununca gunluk butce dogru birimde gider ve doner', async () => {
    const failing = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(500, {}));
    const meta = new MetaAdsClientService(prismaFor({ metaAdsAccessToken: 'raw-token', metaAdsAccountId: 'act_1' }));
    const r1 = await meta.boostPagePost('s1', { pageId: 'p', postId: 'p_1', dailyBudget: 50, days: 7 });
    expect(r1.ok).toBe(false);
    expect(failing.mock.calls.every((c) => (c[1] as any)?.method !== 'POST')).toBe(true);
    failing.mockRestore();

    const bodies: URLSearchParams[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      if (String(url).includes('fields=currency')) return json(200, { currency: 'TRY' });
      bodies.push(new URLSearchParams(String(init?.body ?? '')));
      return json(200, { id: `id-${bodies.length}` });
    });
    const r2 = await meta.boostPagePost('s1', { pageId: 'p', postId: 'p_1', dailyBudget: 50, days: 7 });
    expect(r2).toMatchObject({ ok: true, currency: 'TRY' });
    expect(bodies.find((b) => b.has('daily_budget'))?.get('daily_budget')).toBe('5000');
  });
});

describe('hesap para birimi okuma', () => {
  it('Google: customer.currency_code; hata → null', async () => {
    const google = new GoogleAdsClientService({} as any);
    const query = vi.spyOn(google, 'query').mockResolvedValueOnce([{ customer: { currencyCode: 'TRY' } }]);
    await expect(google.getAccountCurrency('s1')).resolves.toBe('TRY');
    expect(query.mock.calls[0][1]).toContain('customer.currency_code');
    query.mockRejectedValueOnce(new Error('GAQL 404'));
    await expect(google.getAccountCurrency('s1')).resolves.toBeNull();
  });

  it('AdsClientService platforma yonlendirir, hata null olur', async () => {
    const google: any = { getAccountCurrency: vi.fn(async () => 'USD') };
    const meta: any = { getAccountCurrency: vi.fn(async () => { throw new Error('x'); }) };
    const client = new AdsClientService({} as any, google, meta);
    await expect(client.getAccountCurrency('s1', 'google_ads')).resolves.toBe('USD');
    await expect(client.getAccountCurrency('s1', 'meta_ads')).resolves.toBeNull();
  });
});
