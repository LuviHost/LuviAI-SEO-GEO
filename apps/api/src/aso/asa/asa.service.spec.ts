import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { encrypt } from '@luviai/shared';
import { AsaService } from './asa.service.js';
import { AsaApiError, type AsaAdsClient, type AsaApiVersion } from './asa-types.js';

/**
 * AsaService surumden bagimsiz: Apple istemcisi sahte (AsaAdsClient), Prisma sahte.
 * Asil sorular: dogru veri DB'ye yaziliyor mu, otopilot yanlis kelimeyi durduruyor mu,
 * surum gecisi veri siliyor mu.
 */

const USER = { id: 'user-a', role: 'USER' as const };

function fakeClient(version: AsaApiVersion, over: Partial<AsaAdsClient> = {}): AsaAdsClient {
  return {
    version,
    getAccessToken: vi.fn(async () => ({ accessToken: 't', expiresAt: new Date(Date.now() + 3600_000), tokenType: 'Bearer' })),
    getAccountInfo: vi.fn(async () => ({ contextId: version === 'platform' ? '300000001' : '40669820', name: 'Hesap', currency: 'USD', orgId: '1' })),
    listCampaigns: vi.fn(async () => []),
    createCampaign: vi.fn(async (input) => ({ id: '9100', name: input.name, status: 'ENABLED', displayStatus: null, dailyBudget: 15, totalBudget: null, currency: 'USD', countriesOrRegions: input.countriesOrRegions, supplySources: ['APPSTORE_SEARCH_RESULTS'], adamId: String(input.adamId), deleted: false })),
    createAdGroup: vi.fn(async (campaignId, input) => ({ id: '9200', campaignId, name: input.name, defaultBid: 0.5, status: 'ENABLED' })),
    addTargetingKeywords: vi.fn(async () => ({ created: [], failed: [] })),
    listTargetingKeywords: vi.fn(async () => []),
    updateTargetingKeyword: vi.fn(async () => null),
    prepareAdGroupForServing: vi.fn(async () => ({ adId: null, created: false })),
    getCampaignDailyReport: vi.fn(async () => []),
    getKeywordReport: vi.fn(async () => []),
    getSearchTermReport: vi.fn(async () => []),
    ...over,
  } as AsaAdsClient;
}

function build(opts: {
  client: AsaAdsClient;
  dbCampaigns?: Array<{ id: string; asaCampaignId: string; accountId?: string }>;
  kv?: Record<string, string>;
  activeBids?: any[];
  allBids?: Array<{ keyword: string }>;
} = { client: fakeClient('v5') }) {
  const kv = new Map(Object.entries(opts.kv ?? {}));
  const dbCampaigns = opts.dbCampaigns ?? [];
  const account = {
    id: 'acc-1', siteId: 'site-a', orgId: 'SEARCHADS.c', keyId: 'k', teamId: null,
    encryptedKey: encrypt('-----BEGIN PRIVATE KEY-----x'), autoPilotEnabled: true, autoPilotBudgetCap: null, isActive: true,
  };
  const prisma: any = {
    site: { findUnique: vi.fn(async ({ where }: any) => (where.id === 'site-a' ? { id: 'site-a', userId: 'user-a' } : null)) },
    asaAccount: {
      findUnique: vi.fn(async () => account),
      findFirst: vi.fn(async () => account),
      findMany: vi.fn(async () => [account]),
      update: vi.fn(async ({ data }: any) => ({ ...account, ...data })),
      create: vi.fn(async ({ data }: any) => ({ id: 'acc-new', ...data })),
      delete: vi.fn(async () => account),
    },
    asaCampaign: {
      findMany: vi.fn(async () => dbCampaigns.map(({ id, asaCampaignId }) => ({ id, asaCampaignId, status: 'ENABLED' }))),
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async ({ data }: any) => data),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: any) => ({ id: 'db-camp-1', ...data })),
      findUnique: vi.fn(async ({ where }: any) => {
        const c = dbCampaigns.find((x) => x.asaCampaignId === where.asaCampaignId);
        return c ? { id: c.id, accountId: c.accountId ?? 'acc-1' } : null;
      }),
      findFirst: vi.fn(async () => ({ appAdamId: '123456789' })),
    },
    asaAdGroup: {
      create: vi.fn(async ({ data }: any) => ({ id: 'db-adg-1', ...data })),
      findFirst: vi.fn(async () => ({ id: 'db-adg-1', asaAdGroupId: '9200', campaign: { asaCampaignId: '9100' } })),
    },
    asaKeywordBid: {
      create: vi.fn(async ({ data }: any) => ({ id: `kb-${data.asaKeywordId}`, ...data })),
      findMany: vi.fn(async (args: any) => (args?.select ? (opts.allBids ?? []) : (opts.activeBids ?? []))),
      update: vi.fn(async ({ data }: any) => data),
      findUnique: vi.fn(async () => ({
        id: 'kb-1', asaKeywordId: '777', bidAmount: 0.5,
        adGroup: { asaAdGroupId: '9200', campaign: { asaCampaignId: '9100', accountId: 'acc-1', account: { siteId: 'site-a' } } },
      })),
    },
    asaPerformanceDaily: {
      upsert: vi.fn(async () => ({})),
      aggregate: vi.fn(async () => ({ _sum: { spendUsd: 0 } })),
      findMany: vi.fn(async () => []),
    },
    trackedApp: { findFirst: vi.fn(async () => ({ id: 'app-1', name: 'App', appStoreId: '123456789', country: 'tr' })) },
    trackedAppKeyword: { findMany: vi.fn(async () => []) },
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => (kv.has(where.key) ? { key: where.key, value: kv.get(where.key) } : null)),
      upsert: vi.fn(async ({ where, create }: any) => { kv.set(where.key, create.value); return {}; }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  const svc = new AsaService(prisma);
  const createClient = vi.spyOn(svc as any, 'createClient').mockImplementation(() => opts.client);
  return { svc, prisma, kv, createClient, client: opts.client };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const camp = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `C${id}`, status: 'ENABLED', displayStatus: 'RUNNING', dailyBudget: 15, totalBudget: null, currency: 'USD',
  countriesOrRegions: ['TR'], supplySources: ['APPSTORE_SEARCH_RESULTS'], adamId: '123', deleted: false, ...over,
});

describe('syncCampaigns', () => {
  it('budget sutununa GUNLUK butce yazilir (eski kod omur boyu butceyi yaziyordu)', async () => {
    const client = fakeClient('v5', {
      listCampaigns: vi.fn(async () => [camp('1', { dailyBudget: 15, totalBudget: 450 })]),
    });
    const { svc, prisma, kv } = build({ client, dbCampaigns: [{ id: 'db-1', asaCampaignId: '1' }] });
    await expect(svc.syncCampaigns('acc-1', USER)).resolves.toEqual({ synced: 1, removed: 0 });
    const up = prisma.asaCampaign.upsert.mock.calls[0][0];
    expect(up.create.budget).toBe(15);
    expect(up.update.budget).toBe(15);
    expect(up.update.totalBudget).toBe(450);
    expect(kv.get('asa:sync-api-version:acc-1')).toBe('v5');
  });

  it('Apple\'da silinmis kampanya DELETED isaretlenir (gecmis korunur); hic donmeyen yetim silinir', async () => {
    const client = fakeClient('v5', {
      listCampaigns: vi.fn(async () => [camp('1'), camp('2', { deleted: true }), camp('8', { deleted: true })]),
    });
    const { svc, prisma } = build({
      client,
      dbCampaigns: [{ id: 'db-1', asaCampaignId: '1' }, { id: 'db-2', asaCampaignId: '2' }, { id: 'db-3', asaCampaignId: '3' }],
    });
    await expect(svc.syncCampaigns('acc-1', USER)).resolves.toEqual({ synced: 1, removed: 2 });
    expect(prisma.asaCampaign.update).toHaveBeenCalledWith({ where: { id: 'db-2' }, data: { status: 'DELETED' } });
    // DB'de olmayan silinmis kampanya eklenmez
    expect(prisma.asaCampaign.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.asaCampaign.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['db-3'] } } });
  });

  it('kampanya listesi DELETED olanlari gostermez', async () => {
    const { svc, prisma } = build({ client: fakeClient('v5') });
    prisma.asaCampaign.findMany.mockResolvedValue([]);
    await svc.listCampaigns('site-a', USER);
    expect(prisma.asaCampaign.findMany.mock.calls[0][0].where).toEqual({ account: { siteId: 'site-a' }, status: { not: 'DELETED' } });
  });

  it('surum gecisi (v5→platform) sonrasi kimlikler hic eslesmezse hicbir sey silinmez', async () => {
    vi.stubEnv('ASA_API_VERSION', 'platform');
    const client = fakeClient('platform', { listCampaigns: vi.fn(async () => [camp('900'), camp('901')]) });
    const { svc, prisma } = build({ client, dbCampaigns: [{ id: 'db-1', asaCampaignId: '1' }] });
    await expect(svc.syncCampaigns('acc-1', USER)).rejects.toThrow(BadRequestException);
    expect(prisma.asaCampaign.upsert).not.toHaveBeenCalled();
    expect(prisma.asaCampaign.deleteMany).not.toHaveBeenCalled();
    expect(prisma.asaAccount.update.mock.calls[0][0].data.lastError).toMatch(/kimlikleri/);
  });

  it('surum gecisinde kimlikler ortussa senkron normal calisir ve surum kaydedilir', async () => {
    vi.stubEnv('ASA_API_VERSION', 'platform');
    const client = fakeClient('platform', { listCampaigns: vi.fn(async () => [camp('1'), camp('5')]) });
    const { svc, kv } = build({ client, dbCampaigns: [{ id: 'db-1', asaCampaignId: '1' }] });
    await expect(svc.syncCampaigns('acc-1', USER)).resolves.toEqual({ synced: 2, removed: 0 });
    expect(kv.get('asa:sync-api-version:acc-1')).toBe('platform');
  });
});

describe('fetchPerformance', () => {
  it('yukleme normalize edilmis installs\'tan; tarih UTC gece yarisi; baska hesabin kampanyasina yazilmaz', async () => {
    const client = fakeClient('v5', {
      getCampaignDailyReport: vi.fn(async () => [
        { campaignId: '1', date: '2026-10-10', impressions: 100, taps: 10, installs: 4, totalInstalls: 6, spend: 3.5, currency: 'USD', avgCpt: 0.35, avgCpa: 0.875, ttr: 0.1, conversionRate: 0.4 },
        { campaignId: '7', date: '2026-10-10', impressions: 1, taps: 1, installs: 1, totalInstalls: 1, spend: 1, currency: 'USD', avgCpt: 1, avgCpa: 1, ttr: 1, conversionRate: 1 },
      ]),
    });
    const { svc, prisma } = build({ client, dbCampaigns: [{ id: 'db-1', asaCampaignId: '1' }, { id: 'db-7', asaCampaignId: '7', accountId: 'acc-OTHER' }] });
    await expect(svc.fetchPerformance('acc-1', 7)).resolves.toEqual({ saved: 1 });
    const call = prisma.asaPerformanceDaily.upsert.mock.calls[0][0];
    expect(call.where.campaignId_date.date.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(call.create).toMatchObject({ campaignId: 'db-1', installs: 4, taps: 10, spendUsd: 3.5, avgCpa: 0.875, conversionRate: 0.4 });
  });

  it('cron: ilk kosu 85 gun geri doldurur ve isaretler, sonraki kosu 7 gun', async () => {
    const getCampaignDailyReport = vi.fn(async () => []);
    const { svc, kv } = build({ client: fakeClient('v5', { getCampaignDailyReport }) });
    await expect(svc.fetchPerformanceScheduled('acc-1')).resolves.toMatchObject({ backfill: true });
    const first = (getCampaignDailyReport.mock.calls[0] as any[])[0];
    const span = (Date.parse(first.endDate) - Date.parse(first.startDate)) / 86_400_000;
    expect(span).toBe(85);
    expect(kv.has('asa:perf-installs-backfill:acc-1')).toBe(true);
    await expect(svc.fetchPerformanceScheduled('acc-1')).resolves.toMatchObject({ backfill: false });
    const second = (getCampaignDailyReport.mock.calls[1] as any[])[0];
    expect((Date.parse(second.endDate) - Date.parse(second.startDate)) / 86_400_000).toBe(7);
  });
});

describe('runAutoPilot — kelime duzeyinde karar', () => {
  const bid = (id: string, keyword: string, asaCampaignId: string) => ({
    id: `kb-${id}`, asaKeywordId: id, keyword, bidAmount: 0.5, status: 'ACTIVE',
    adGroup: { asaAdGroupId: `ag-${asaCampaignId}`, campaignId: `db-${asaCampaignId}`, campaign: { asaCampaignId } },
  });

  it('yalniz 20+ dokunma ve 0 yuklemeli kelime durur; rapor alinamayan kampanyada hicbiri durmaz', async () => {
    const getKeywordReport = vi.fn(async (campaignId: string) => {
      if (campaignId === 'B') throw new AsaApiError('ASA POST … → 500', { kind: 'server', apiVersion: 'v5' });
      return [
        { keywordId: '1', adGroupId: 'ag-A', text: 'kayip', matchType: 'EXACT', impressions: 300, taps: 25, installs: 0, totalInstalls: 0, spend: 10, currency: 'USD', avgCpt: 0.4, avgCpa: null, ttr: 0.08, conversionRate: 0 },
        { keywordId: '2', adGroupId: 'ag-A', text: 'iyi', matchType: 'EXACT', impressions: 300, taps: 25, installs: 3, totalInstalls: 3, spend: 10, currency: 'USD', avgCpt: 0.4, avgCpa: 3.3, ttr: 0.08, conversionRate: 0.12 },
      ];
    });
    const updateTargetingKeyword = vi.fn(async () => null);
    const client = fakeClient('v5', { getKeywordReport, updateTargetingKeyword });
    const { svc, prisma } = build({
      client,
      activeBids: [bid('1', 'kayip', 'A'), bid('2', 'iyi', 'A'), bid('3', 'verisiz', 'A'), bid('4', 'b-kelime', 'B')],
    });
    const res = await svc.runAutoPilot('acc-1');
    expect(res.paused).toEqual(['kayip']);
    expect(updateTargetingKeyword).toHaveBeenCalledTimes(1);
    expect(updateTargetingKeyword).toHaveBeenCalledWith('A', 'ag-A', '1', { status: 'PAUSED' });
    expect(res.skipped).toContain('keyword-report-failed:B');
    expect(prisma.asaKeywordBid.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'kb-1' }, data: expect.objectContaining({ status: 'PAUSED' }) }));
  });

  it('yeni kelimeler: normalize durum yazilir, Apple\'in reddettikleri atlandi olarak raporlanir', async () => {
    const addTargetingKeywords = vi.fn(async () => ({
      created: [{ id: '501', adGroupId: '9200', campaignId: '9100', text: 'yeni', matchType: 'EXACT', bid: 0.5, status: 'ACTIVE', deleted: false }],
      failed: [{ text: 'kopya', reason: 'exists' }],
    }));
    const client = fakeClient('platform', { addTargetingKeywords });
    const { svc, prisma } = build({ client, allBids: [{ keyword: 'Durmus' }] });
    prisma.trackedAppKeyword.findMany.mockResolvedValue([
      { keyword: 'yeni', currentRank: null, traffic: 50, popularity: null },
      { keyword: 'kopya', currentRank: null, traffic: 40, popularity: null },
      { keyword: 'durmus', currentRank: null, traffic: 90, popularity: null },
    ]);
    const res = await svc.runAutoPilot('acc-1');
    // Duraklatilmis (paused) kelime yeniden eklenmeye calisilmaz
    expect((addTargetingKeywords.mock.calls[0] as any[])[2].map((k: any) => k.text)).toEqual(['yeni', 'kopya']);
    expect(res.added).toEqual(['yeni']);
    expect(res.skipped).toContain('add-failed:kopya');
    expect(prisma.asaKeywordBid.create.mock.calls[0][0].data).toMatchObject({ asaKeywordId: '501', status: 'ACTIVE' });
  });
});

describe('createCampaign', () => {
  const args = {
    accountId: 'acc-1', name: 'Kamp', dailyBudgetUsd: 15, countries: ['TR'], appleAppId: 123456789,
    keywords: [{ text: 'foto', bidUsd: 0.5 }, { text: 'editor', bidUsd: 0.7 }],
  };

  it('kopya isim → zaman damgali tekrar; kismi kelime hatasi ve reklam hatasi uyari olarak doner', async () => {
    let n = 0;
    const createCampaign = vi.fn(async (input: any) => {
      n++;
      if (n === 1) throw new AsaApiError('ASA POST /campaigns → 400: DUPLICATE_NAME', { kind: 'duplicate_name', status: 400, apiVersion: 'platform' });
      return { id: '9100', name: input.name, status: 'ENABLED', displayStatus: null, dailyBudget: 15, totalBudget: null, currency: 'USD', countriesOrRegions: ['TR'], supplySources: [], adamId: '123456789', deleted: false };
    });
    const addTargetingKeywords = vi.fn(async () => ({
      created: [{ id: '777', adGroupId: '9200', campaignId: '9100', text: 'foto', matchType: 'EXACT', bid: 0.5, status: 'ACTIVE', deleted: false }],
      failed: [{ text: 'editor', reason: 'Keyword already exists' }],
    }));
    const prepareAdGroupForServing = vi.fn(async () => { throw new Error('creative reddedildi'); });
    const client = fakeClient('platform', { createCampaign, addTargetingKeywords, prepareAdGroupForServing });
    const { svc, prisma } = build({ client });

    const res = await svc.createCampaign(args, USER);
    expect(createCampaign).toHaveBeenCalledTimes(2);
    expect((createCampaign.mock.calls[1] as any[])[0].name).toMatch(/^Kamp #\d{5}$/);
    expect(prisma.asaCampaign.create.mock.calls[0][0].data.name).toMatch(/^Kamp #\d{5}$/);
    expect(res.asaCampaignId).toBe('9100');
    expect(res.warnings).toHaveLength(2);
    expect(res.warnings?.[0]).toContain('"editor" eklenemedi');
    expect(res.warnings?.[1]).toContain('Varsayılan ürün sayfası reklamı oluşturulamadı');
    expect(prisma.asaKeywordBid.create).toHaveBeenCalledTimes(1);
    expect(prepareAdGroupForServing).toHaveBeenCalledWith('9100', '9200', '123456789');
  });

  it('odeme yontemi eksik → acik Turkce mesaj', async () => {
    const client = fakeClient('v5', {
      createCampaign: vi.fn(async () => { throw new AsaApiError('ASA POST /campaigns → 400: NO_PAYMENT_METHOD_ON_FILE', { kind: 'payment', status: 400, apiVersion: 'v5' }); }),
    });
    const { svc } = build({ client });
    await expect(svc.createCampaign(args, USER)).rejects.toThrow(/Apple ödeme yöntemi yok/);
  });

  it('gecersiz butce Apple\'a gitmeden reddedilir', async () => {
    const client = fakeClient('v5');
    const { svc } = build({ client });
    await expect(svc.createCampaign({ ...args, dailyBudgetUsd: Number.NaN }, USER)).rejects.toThrow(/Günlük bütçe/);
    expect(client.createCampaign).not.toHaveBeenCalled();
  });
});

describe('updateKeywordBid', () => {
  it('Apple\'a teklif gider, DB guncellenir', async () => {
    const client = fakeClient('v5');
    const { svc, prisma } = build({ client });
    await svc.updateKeywordBid('kb-1', 0.8, USER);
    expect(client.updateTargetingKeyword).toHaveBeenCalledWith('9100', '9200', '777', { bid: { amount: '0.80', currency: 'USD' } });
    expect(prisma.asaKeywordBid.update).toHaveBeenCalled();
  });

  it('hiz siniri → anlasilir mesaj, DB degismez', async () => {
    const client = fakeClient('platform', {
      updateTargetingKeyword: vi.fn(async () => { throw new AsaApiError('429', { kind: 'rate_limited', status: 429, apiVersion: 'platform', retryAfterSeconds: 40 }); }),
    });
    const { svc, prisma } = build({ client });
    await expect(svc.updateKeywordBid('kb-1', 0.8, USER)).rejects.toThrow(/40 sn sonra/);
    expect(prisma.asaKeywordBid.update).not.toHaveBeenCalled();
  });
});

describe('istemci uretimi ve baglanti', () => {
  it('platform: kayitli reklam hesabi istemciye verilir; ilk cozumleme KvStore\'a yazilir', async () => {
    vi.stubEnv('ASA_API_VERSION', 'platform');
    const client = fakeClient('platform');
    const { svc, createClient, kv } = build({ client, kv: { 'asa:platform-ad-account:acc-1': '300000009' } });
    await svc.fetchPerformance('acc-1', 7);
    const opts = createClient.mock.calls[0][1] as any;
    expect(opts.version).toBe('platform');
    expect(opts.adAccountId).toBe('300000009');
    await opts.onAdAccountResolved('300000010');
    expect(kv.get('asa:platform-ad-account:acc-1')).toBe('300000010');
  });

  it('v5 varsayilan: reklam hesabi secenegi verilmez', async () => {
    const { svc, createClient } = build({ client: fakeClient('v5') });
    await svc.fetchPerformance('acc-1', 7);
    expect(createClient.mock.calls[0][1]).toEqual({ version: 'v5' });
  });

  it('platform baglantisi: secilen reklam hesabi kaydedilir', async () => {
    vi.stubEnv('ASA_API_VERSION', 'platform');
    const { svc, kv, prisma } = build({ client: fakeClient('platform') });
    prisma.asaAccount.findFirst.mockResolvedValue(null);
    const res = await svc.connectAccount({ siteId: 'site-a', orgId: 'SEARCHADS.c', keyId: 'k', privateKeyPem: '-----BEGIN PRIVATE KEY-----x' }, USER);
    expect(res).toMatchObject({ id: 'acc-new', status: 'created' });
    expect(kv.get('asa:platform-ad-account:acc-new')).toBe('300000001');
  });

  it('hesap erisimi yoksa baglanti acik mesajla reddedilir', async () => {
    const client = fakeClient('platform', {
      getAccountInfo: vi.fn(async () => { throw new AsaApiError('Bu API anahtarının erişebildiği bir Apple Ads reklam hesabı yok.', { kind: 'config', apiVersion: 'platform' }); }),
    });
    const { svc, prisma } = build({ client });
    await expect(
      svc.connectAccount({ siteId: 'site-a', orgId: 'SEARCHADS.c', keyId: 'k', privateKeyPem: '-----BEGIN PRIVATE KEY-----x' }, USER),
    ).rejects.toThrow('Bu API anahtarının erişebildiği bir Apple Ads reklam hesabı yok.');
    expect(prisma.asaAccount.create).not.toHaveBeenCalled();
  });
});

describe('insights — goreli skor', () => {
  it('v5 istemcisinde populerlik: available:false (uydurma veri yok)', async () => {
    const { svc } = build({ client: fakeClient('v5') });
    await expect(svc.getSearchTermPopularity('site-a', USER, { terms: ['foto'] })).resolves.toMatchObject({ available: false });
  });

  it('platform: etiketli goreli skor; TR icin Turkce kucuk harf', async () => {
    const getSearchTermPopularity = vi.fn(async () => [
      { searchTerm: 'ılık', countryOrRegion: 'TR', genre: 'LIFESTYLE', period: '2026-10-11', popularity1to100: 40, popularityInGenre: 70, popularity1to5: 3, rankInGenre: 12 },
    ]);
    const { svc } = build({ client: fakeClient('platform', { getSearchTermPopularity }) });
    const res: any = await svc.getSearchTermPopularity('site-a', USER, { terms: ['ILIK', ''] });
    expect(res.label).toBe('göreli skor (Apple Ads)');
    expect(res.country).toBe('TR'); // sitenin iOS app ulkesinden
    expect((getSearchTermPopularity.mock.calls[0] as any[])[0]).toMatchObject({ countryOrRegion: 'TR', searchTerms: ['ılık'] });
    expect(res.terms[0]).toMatchObject({ term: 'ılık', relativeScore: 40 });
  });

  it('gecersiz tur reddedilir', async () => {
    const { svc } = build({ client: fakeClient('platform', { getSearchTermPopularity: vi.fn(async () => []) }) });
    await expect(svc.getSearchTermPopularity('site-a', USER, { genre: 'MUZIK' })).rejects.toThrow(/Geçersiz tür/);
  });

  it('gosterim payi: kampanyadaki app kimligi kullanilir', async () => {
    const getImpressionShare = vi.fn(async () => []);
    const { svc } = build({ client: fakeClient('platform', { getImpressionShare }) });
    const res: any = await svc.getImpressionShare('site-a', USER, { days: 7 });
    expect(res.label).toBe('göreli skor (Apple Ads)');
    expect((getImpressionShare.mock.calls[0] as any[])[0]).toMatchObject({ adamId: '123456789' });
  });
});
