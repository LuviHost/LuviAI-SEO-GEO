import { describe, it, expect, vi } from 'vitest';
import { encrypt } from '@luviai/shared';
import { AsaService } from './asa.service.js';
import type { AsaAdsClient } from './asa-types.js';
import {
  ASA_CURRENCY_MIXED,
  asaCurrencyKey,
  budgetCapReason,
  combineAsaCurrencies,
  parseAsaCurrency,
  reportCurrencyValue,
} from './asa-currency.js';

/**
 * ASA tutarlari HESABIN para birimindedir (spendUsd adi tarihsel). Para birimi
 * kv_store'da tutulur; panel ve otopilot gerekcesi "$" yerine bilinen kodu
 * yazar, bilinmiyorsa "hesap para birimi" der.
 */

const USER = { id: 'user-a', role: 'USER' as const };

function fakeClient(over: Partial<AsaAdsClient> = {}): AsaAdsClient {
  return {
    version: 'v5',
    getAccessToken: vi.fn(async () => ({ accessToken: 't', expiresAt: new Date(Date.now() + 3600_000), tokenType: 'Bearer' })),
    getAccountInfo: vi.fn(async () => ({ contextId: '40669820', name: 'Hesap', currency: 'EUR', orgId: '1' })),
    listCampaigns: vi.fn(async () => []),
    getCampaignDailyReport: vi.fn(async () => []),
    getKeywordReport: vi.fn(async () => []),
    ...over,
  } as unknown as AsaAdsClient;
}

const row = (campaignId: string, currency: string | null) => ({
  campaignId, date: '2026-10-10', impressions: 10, taps: 2, installs: 1, totalInstalls: 1, spend: 3.5, currency,
  avgCpt: 1.75, avgCpa: 3.5, ttr: 0.2, conversionRate: 0.5,
});

function build(client: AsaAdsClient, opts: { kv?: Record<string, string>; accounts?: Array<{ id: string }>; monthSpend?: number; cap?: number | null } = {}) {
  const kv = new Map(Object.entries(opts.kv ?? {}));
  const account = {
    id: 'acc-1', siteId: 'site-a', orgId: 'SEARCHADS.c', keyId: 'k', teamId: null,
    encryptedKey: encrypt('-----BEGIN PRIVATE KEY-----x'), autoPilotEnabled: true,
    autoPilotBudgetCap: opts.cap === undefined ? null : opts.cap, isActive: true,
  };
  const prisma: any = {
    site: { findUnique: vi.fn(async () => ({ id: 'site-a', userId: 'user-a' })) },
    asaAccount: {
      findUnique: vi.fn(async () => account),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => opts.accounts ?? [{ id: 'acc-1' }]),
      update: vi.fn(async ({ data }: any) => ({ ...account, ...data })),
      create: vi.fn(async ({ data }: any) => ({ id: 'acc-new', ...data })),
      delete: vi.fn(async () => account),
    },
    asaCampaign: {
      findUnique: vi.fn(async ({ where }: any) => ({ id: `db-${where.asaCampaignId}`, accountId: 'acc-1' })),
    },
    asaPerformanceDaily: {
      upsert: vi.fn(async () => ({})),
      aggregate: vi.fn(async () => ({ _sum: { spendUsd: opts.monthSpend ?? 0 } })),
      findMany: vi.fn(async () => [{ impressions: 100, taps: 10, installs: 2, spendUsd: 20 }]),
    },
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => (kv.has(where.key) ? { key: where.key, value: kv.get(where.key) } : null)),
      upsert: vi.fn(async ({ where, create }: any) => { kv.set(where.key, create.value); return {}; }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  const svc = new AsaService(prisma);
  vi.spyOn(svc as any, 'createClient').mockImplementation(() => client);
  return { svc, prisma, kv };
}

describe('asa-currency yardimcilari', () => {
  it('rapor birimi: tek kod → o kod; karisik → MIXED; birim yoksa yazilmaz', () => {
    expect(reportCurrencyValue(['TRY', 'TRY', null])).toBe('TRY');
    expect(reportCurrencyValue(['USD', 'EUR'])).toBe(ASA_CURRENCY_MIXED);
    expect(reportCurrencyValue([null, undefined, 'usd'])).toBeNull();
    expect(parseAsaCurrency(ASA_CURRENCY_MIXED)).toBeNull();
    expect(parseAsaCurrency('USD')).toBe('USD');
  });

  it('site birimi: tum hesaplar ayni bilinen kodda ise o; degilse null', () => {
    expect(combineAsaCurrencies(['USD', 'USD'])).toBe('USD');
    expect(combineAsaCurrencies(['USD', 'EUR'])).toBeNull();
    expect(combineAsaCurrencies(['USD', null])).toBeNull();
    expect(combineAsaCurrencies([])).toBeNull();
  });

  it('butce siniri gerekcesinde "$" yok', () => {
    expect(budgetCapReason(512.3, 500, 'USD')).toBe('Aylık harcama sınırına ulaşıldı: 512.30 USD / 500.00 USD');
    expect(budgetCapReason(512.3, 500, null)).toBe('Aylık harcama sınırına ulaşıldı: 512.30 / 500.00 (hesap para birimi)');
    expect(budgetCapReason(1, 1, null)).not.toContain('$');
  });
});

describe('AsaService para birimi', () => {
  it('performans cekimi rapor satirlarinin birimini site kimlikli anahtara yazar; ozet bunu dondurur', async () => {
    const client = fakeClient({ getCampaignDailyReport: vi.fn(async () => [row('1', 'TRY'), row('2', 'TRY')]) });
    const { svc, kv } = build(client);
    await svc.fetchPerformance('acc-1', 7);
    expect(kv.get(asaCurrencyKey('site-a', 'acc-1'))).toBe('TRY');
    const summary: any = await svc.getPerformanceSummary('site-a', USER, 30);
    expect(summary.currency).toBe('TRY');
    // Eski alanlar aynen duruyor
    expect(summary.totals).toMatchObject({ spendUsd: 20, taps: 10 });
  });

  it('karisik birim → MIXED kaydi ve ozette null; satirlarda birim yoksa onceki deger korunur', async () => {
    const mixed = fakeClient({ getCampaignDailyReport: vi.fn(async () => [row('1', 'USD'), row('2', 'EUR')]) });
    const { svc, kv } = build(mixed);
    await svc.fetchPerformance('acc-1', 7);
    expect(kv.get(asaCurrencyKey('site-a', 'acc-1'))).toBe(ASA_CURRENCY_MIXED);
    expect((await svc.getPerformanceSummary('site-a', USER) as any).currency).toBeNull();

    const noUnit = fakeClient({ getCampaignDailyReport: vi.fn(async () => [row('1', null)]) });
    const b2 = build(noUnit, { kv: { [asaCurrencyKey('site-a', 'acc-1')]: 'GBP' } });
    await b2.svc.fetchPerformance('acc-1', 7);
    expect(b2.kv.get(asaCurrencyKey('site-a', 'acc-1'))).toBe('GBP');
  });

  it('iki hesap farkli birimde ya da biri bilinmiyorsa ozet null', async () => {
    const { svc } = build(fakeClient(), {
      accounts: [{ id: 'acc-1' }, { id: 'acc-2' }],
      kv: { [asaCurrencyKey('site-a', 'acc-1')]: 'USD', [asaCurrencyKey('site-a', 'acc-2')]: 'EUR' },
    });
    expect((await svc.getPerformanceSummary('site-a', USER) as any).currency).toBeNull();
    const b2 = build(fakeClient(), { accounts: [{ id: 'acc-1' }, { id: 'acc-2' }], kv: { [asaCurrencyKey('site-a', 'acc-1')]: 'USD' } });
    expect((await b2.svc.getPerformanceSummary('site-a', USER) as any).currency).toBeNull();
  });

  it('hesap listesi hesap basina para birimini ekler (bilinmiyorsa null)', async () => {
    const { svc } = build(fakeClient(), { accounts: [{ id: 'acc-1' }, { id: 'acc-2' }], kv: { [asaCurrencyKey('site-a', 'acc-1')]: 'USD' } });
    const list: any[] = await svc.listAccounts('site-a', USER);
    expect(list.map((a) => [a.id, a.currency])).toEqual([['acc-1', 'USD'], ['acc-2', null]]);
  });

  it('baglanti aninda hesap bilgisindeki birim kaydedilir', async () => {
    const { svc, kv } = build(fakeClient());
    const res = await svc.connectAccount({ siteId: 'site-a', orgId: 'SEARCHADS.c', keyId: 'k', privateKeyPem: '-----BEGIN PRIVATE KEY-----x' }, USER);
    expect(kv.get(asaCurrencyKey('site-a', res.id))).toBe('EUR');
  });

  it('baglanti kesilince birim kaydi da silinir', async () => {
    const { svc, prisma } = build(fakeClient());
    await svc.disconnectAccount('acc-1', USER);
    expect(prisma.kvStore.deleteMany.mock.calls[0][0].where.key.in).toContain(asaCurrencyKey('site-a', 'acc-1'));
  });

  it('otopilot butce siniri gerekcesi "$" yerine hesabin birimini yazar', async () => {
    const client = fakeClient({ getCampaignDailyReport: vi.fn(async () => [row('1', 'EUR')]) });
    const { svc } = build(client, { monthSpend: 512.3, cap: 500 });
    const res = await svc.runAutoPilot('acc-1');
    expect(res.reason).toBe('Aylık harcama sınırına ulaşıldı: 512.30 EUR / 500.00 EUR');
    expect(res.skipped).toContain('budget-cap-reached');

    const unknown = build(fakeClient(), { monthSpend: 600, cap: 500 });
    const r2 = await unknown.svc.runAutoPilot('acc-1');
    expect(r2.reason).toBe('Aylık harcama sınırına ulaşıldı: 600.00 / 500.00 (hesap para birimi)');
  });
});
