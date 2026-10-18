import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';

vi.mock('@luviai/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
}));

import { GoogleAdsClientService } from './google-ads-client.service.js';
import { KeywordOptimizerService } from './keyword-optimizer.service.js';
import { AdsController } from './ads.controller.js';

/**
 * Google Ads istemcisi v26'ya tasindi (v21 5 Agustos 2026'da kapandi). Her
 * istek sahte fetch ile yakalanir: adres surumu, basliklar (developer-token
 * YOK, login-customer-id tiresiz), govdeler ve Google yanitlarinin okunusu.
 */

const V = 'https://googleads.googleapis.com/v26';
const CID = '1234567890';

type Call = { url: string; method: string; headers: Record<string, string>; body: any };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const failure = (code: Record<string, string>, message = 'x', requestId = 'req-9') => ({
  error: {
    code: 400,
    message: 'Request contains an invalid argument.',
    status: 'INVALID_ARGUMENT',
    details: [{
      '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure',
      errors: [{ errorCode: code, message }],
      requestId,
    }],
  },
});

/**
 * Sahte Google: token ucu + Ads uclari. `ads` her Ads istegi icin yanit uretir
 * (yoksa 404). Tum istekler `calls`'a yazilir.
 */
function fakeGoogle(ads: (c: Call) => Response | undefined) {
  const calls: Call[] = [];
  const tokenBodies: URLSearchParams[] = [];
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenBodies.push(new URLSearchParams(String(init?.body ?? '')));
      return json(200, { access_token: 'at-1', expires_in: 3599 });
    }
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers ?? {}) },
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return ads(call) ?? json(404, {});
  });
  const adsCalls = () => calls;
  return { fetchMock, calls: adsCalls, tokenBodies };
}

function prismaWith(site: Record<string, unknown> = {}) {
  return {
    site: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: 's1',
        googleAdsRefreshToken: 'enc:refresh-1',
        googleAdsCustomerId: '123-456-7890',
        ...site,
      })),
    },
  } as any;
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'web-client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'web-secret');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', '');
  vi.stubEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', '');
  vi.stubEnv('GOOGLE_ADS_DEV_TOKEN', '');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('surum, basliklar ve kimlik', () => {
  it('GAQL v26 search ucuna gider; developer-token gonderilmez (env dolu olsa da); kimlik tiresiz', async () => {
    vi.stubEnv('GOOGLE_ADS_DEV_TOKEN', 'legacy-dev-token');
    const g = fakeGoogle(() => json(200, { results: [{ customer: { currencyCode: 'TRY' } }] }));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.query('s1', 'SELECT customer.currency_code FROM customer LIMIT 1')).resolves.toHaveLength(1);
    const [c] = g.calls();
    expect(c.url).toBe(`${V}/customers/${CID}/googleAds:search`);
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ query: 'SELECT customer.currency_code FROM customer LIMIT 1' });
    expect(c.headers.Authorization).toBe('Bearer at-1');
    expect(c.headers).not.toHaveProperty('developer-token');
    expect(c.headers).not.toHaveProperty('login-customer-id');
  });

  it('GOOGLE_ADS_DEV_TOKEN hic yokken de calisir (Google token\'i kaldirdi)', async () => {
    // beforeEach'teki stubEnv ozgun degeri saklar; unstubAllEnvs geri yukler
    delete process.env.GOOGLE_ADS_DEV_TOKEN;
    fakeGoogle(() => json(200, { results: [] }));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.query('s1', 'SELECT customer.id FROM customer')).resolves.toEqual([]);
  });

  it('login-customer-id tiresiz ve HER cagrida (eskiden durum/negatif kelime isteklerinde yoktu)', async () => {
    vi.stubEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', '987-654-3210');
    const g = fakeGoogle((c) => (c.url.endsWith(':mutate') ? json(200, { results: [{ resourceName: 'x' }] }) : json(200, { results: [] })));
    const svc = new GoogleAdsClientService(prismaWith());
    await svc.query('s1', 'SELECT customer.id FROM customer');
    await svc.setCampaignStatus('s1', '555', 'PAUSED');
    await svc.addNegativeKeywords('s1', '555', ['bedava']);
    expect(g.calls()).toHaveLength(3);
    for (const c of g.calls()) expect(c.headers['login-customer-id']).toBe('9876543210');
  });

  it('token baglanti akisinin istemcisiyle yenilenir (GOOGLE_CLIENT_ID; yoksa GOOGLE_OAUTH_CLIENT_ID)', async () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'other-client');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'other-secret');
    const g = fakeGoogle(() => json(200, { results: [] }));
    const svc = new GoogleAdsClientService(prismaWith());
    await svc.query('s1', 'SELECT customer.id FROM customer');
    expect(g.tokenBodies[0].get('client_id')).toBe('web-client');
    expect(g.tokenBodies[0].get('client_secret')).toBe('web-secret');
    expect(g.tokenBodies[0].get('refresh_token')).toBe('refresh-1');
    expect(g.tokenBodies[0].get('grant_type')).toBe('refresh_token');

    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    await svc.query('s1', 'SELECT customer.id FROM customer');
    expect(g.tokenBodies[1].get('client_id')).toBe('other-client');
  });

  it('bagli degil / hesap secilmemis / token yenilenemedi: Google\'a istek yok, acik neden', async () => {
    const g = fakeGoogle(() => json(200, {}));
    await expect(new GoogleAdsClientService(prismaWith({ googleAdsRefreshToken: null })).setCampaignStatus('s1', '555', 'PAUSED'))
      .resolves.toEqual({ ok: false, error: expect.stringMatching(/bağlı değil/) });
    await expect(new GoogleAdsClientService(prismaWith({ googleAdsCustomerId: null })).updateBudget('s1', '555', 10, 8))
      .resolves.toEqual({ ok: false, error: expect.stringMatching(/hesabı seçilmemiş/) });
    expect(g.tokenBodies).toHaveLength(0);
    expect(g.calls()).toHaveLength(0);

    g.fetchMock.mockImplementation(async () => json(400, { error: 'invalid_grant' }));
    await expect(new GoogleAdsClientService(prismaWith()).setAdStatus('s1', `customers/${CID}/adGroupAds/1~2`, 'PAUSED'))
      .resolves.toEqual({ ok: false, error: expect.stringMatching(/yeniden bağla/) });
    await expect(new GoogleAdsClientService(prismaWith()).query('s1', 'SELECT customer.id FROM customer')).rejects.toThrow(/yenilenemedi/);
  });
});

describe('raporlama sorgulari', () => {
  it('kampanya metrikleri: GAQL ve alan okuma (int64 alanlar dize gelir)', async () => {
    const g = fakeGoogle(() => json(200, {
      results: [{
        campaign: { resourceName: `customers/${CID}/campaigns/555`, id: '555', name: 'K', status: 'ENABLED' },
        metrics: { impressions: '1000', clicks: '50', costMicros: '25000000', conversions: 4.6, conversionsValue: 100, ctr: 0.05, averageCpc: 500000 },
      }],
    }));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.getCampaignMetrics('s1', '555')).resolves.toEqual({
      impressions: 1000, clicks: 50, spend: 25, conversions: 5, ctr: 0.05, cpc: 0.5, roas: 4,
    });
    const q: string = g.calls()[0].body.query;
    expect(q).toContain('FROM campaign');
    expect(q).toContain('campaign.id = 555');
    expect(q).toContain('segments.date DURING LAST_30_DAYS');
    for (const f of ['metrics.impressions', 'metrics.clicks', 'metrics.cost_micros', 'metrics.conversions', 'metrics.conversions_value', 'metrics.ctr', 'metrics.average_cpc']) {
      expect(q).toContain(f);
    }
  });

  it('kampanya kimligi rakam degilse sorgu atilmaz (GAQL enjeksiyonu)', async () => {
    const g = fakeGoogle(() => json(200, { results: [] }));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.getCampaignMetrics('s1', '555 AND campaign.status = PAUSED')).rejects.toThrow(/Gecersiz/);
    await expect(svc.getSearchTerms('s1', 'x')).rejects.toThrow(/Gecersiz/);
    await expect(svc.getAdVariantMetrics('s1', '')).rejects.toThrow(/Gecersiz/);
    await expect(svc.setCampaignStatus('s1', '1 OR 1', 'PAUSED')).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/kimliği geçersiz/) });
    expect(g.calls()).toHaveLength(0);
  });

  it('arama terimleri ve reklam varyantlari', async () => {
    const g = fakeGoogle((c) => {
      const q: string = c.body?.query ?? '';
      if (q.includes('FROM search_term_view')) {
        return json(200, { results: [{ searchTermView: { searchTerm: 'ucretsiz seo' }, metrics: { impressions: '80', clicks: '3', conversions: 0, costMicros: '1500000' } }] });
      }
      return json(200, { results: [abRow({ group: 9, ad: 8, impr: '200', clicks: '10', conv: 2, value: 150 })] });
    });
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.getSearchTerms('s1', '555')).resolves.toEqual([{ term: 'ucretsiz seo', impressions: 80, clicks: 3, conversions: 0, cost: 1.5 }]);
    await expect(svc.getAdVariantMetrics('s1', '555')).resolves.toEqual([{
      adId: '8', target: `customers/${CID}/adGroupAds/9~8`, groupId: '9', groupName: 'Grup 9', eligible: true,
      impressions: 200, clicks: 10, conversions: 2, conversionValue: 150,
    }]);
    expect(g.calls().map((c) => c.url)).toEqual([`${V}/customers/${CID}/googleAds:search`, `${V}/customers/${CID}/googleAds:search`]);
    expect(g.calls()[0].body.query).toContain('search_term_view.search_term');
    expect(g.calls()[1].body.query).toContain('ad_group_ad.resource_name');
    expect(g.calls()[1].body.query).toContain('LAST_7_DAYS');
    // Duraklatilmis reklamlar A/B'ye yeniden girmez (ayni kayit her turda tekrar yazilmasin)
    expect(g.calls()[1].body.query).toContain("ad_group_ad.status = 'ENABLED'");
  });

  it('GAQL hatasi kod ve requestId ile firlar (loglar icin)', async () => {
    fakeGoogle(() => json(400, failure({ queryError: 'UNRECOGNIZED_FIELD' }, 'Unrecognized field', 'rq-77')));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.query('s1', 'SELECT nope FROM campaign')).rejects.toThrow(/queryError\.UNRECOGNIZED_FIELD.*requestId rq-77/);
  });
});

describe('kampanya durumu', () => {
  it('govde: update + updateMask status; onay → ok', async () => {
    const g = fakeGoogle(() => json(200, { results: [{ resourceName: `customers/${CID}/campaigns/555` }] }));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.setCampaignStatus('s1', '555', 'PAUSED')).resolves.toEqual({ ok: true });
    const [c] = g.calls();
    expect(c.url).toBe(`${V}/customers/${CID}/campaigns:mutate`);
    expect(c.body).toEqual({
      operations: [{ update: { resourceName: `customers/${CID}/campaigns/555`, status: 'PAUSED' }, updateMask: 'status' }],
    });
  });

  it('AB siyasi reklam beyani eksik hesap: ok false, musteriye neden; loga kod + requestId', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fakeGoogle(() => json(400, failure({ mutateError: 'EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED' }, 'Declaration required', 'eu-1')));
    const svc = new GoogleAdsClientService(prismaWith());
    const res = await svc.setCampaignStatus('s1', '555', 'ENABLED');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/AB siyasi reklam beyanı/);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED.*requestId eu-1/);
  });

  it('nedeni belirsiz hata musteriye ham Google metni olarak gitmez', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fakeGoogle(() => json(500, failure({ internalError: 'INTERNAL_ERROR' }, 'boom')));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.setCampaignStatus('s1', '555', 'PAUSED')).resolves.toEqual({ ok: false });
  });
});

describe('gunluk butce', () => {
  const budgetRow = (
    budget: Record<string, unknown>,
    rn = `customers/${CID}/campaignBudgets/777`,
    campaignStatus = 'ENABLED',
    // null: alan yanitta yok (varsayilan parametre undefined'da devreye girdigi icin null)
    servingStatus: string | null = 'SERVING',
  ) => ({
    results: [{
      campaign: {
        resourceName: `customers/${CID}/campaigns/555`, status: campaignStatus, campaignBudget: rn,
        ...(servingStatus === null ? {} : { servingStatus }),
      },
      campaignBudget: { resourceName: rn, ...budget },
    }],
  });
  const daily = (amountMicros: string, over: Record<string, unknown> = {}) =>
    ({ explicitlyShared: false, referenceCount: '1', period: 'DAILY', amountMicros, ...over });

  it('once canli butce ve turu okunur, deger beklenenle ayniysa amount_micros yazilir', async () => {
    const g = fakeGoogle((c) => (c.url.endsWith('googleAds:search')
      ? json(200, budgetRow(daily('10000000')))
      : json(200, { results: [{ resourceName: `customers/${CID}/campaignBudgets/777` }] })));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.updateBudget('s1', '555', 12.34, 10)).resolves.toEqual({ ok: true, applied: 12.34 });
    const [search, mutate] = g.calls();
    for (const f of [
      'campaign.status', 'campaign.serving_status', 'campaign.campaign_budget', 'campaign_budget.amount_micros', 'campaign_budget.total_amount_micros',
      'campaign_budget.explicitly_shared', 'campaign_budget.reference_count', 'campaign_budget.period',
    ]) {
      expect(search.body.query).toContain(f);
    }
    expect(search.body.query).toContain('campaign.id = 555');
    expect(mutate.url).toBe(`${V}/customers/${CID}/campaignBudgets:mutate`);
    expect(mutate.body).toEqual({
      operations: [{ update: { resourceName: `customers/${CID}/campaignBudgets/777`, amountMicros: '12340000' }, updateMask: 'amount_micros' }],
    });
    // Token bir kez yenilenir (eskiden sorgu + mutate icin iki kez)
    expect(g.tokenBodies).toHaveLength(1);
  });

  it('canli butce cagiranin dayandigi degerden farkliysa YAZILMAZ (bayat kayit: canli 50, beklenen 500)', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const g = fakeGoogle(() => json(200, budgetRow(daily('50000000'))));
    const res = await new GoogleAdsClientService(prismaWith()).updateBudget('s1', '555', 600, 500);
    expect(res).toEqual({ ok: false, stale: true, live: 50, error: expect.stringMatching(/değişmiş/) });
    expect(g.calls().filter((c) => c.url.endsWith(':mutate'))).toHaveLength(0);
  });

  it('kaldirilmis (REMOVED) ya da durumu bilinmeyen kampanyanin butcesine dokunulmaz', async () => {
    let g = fakeGoogle(() => json(200, budgetRow(daily('50000000'), undefined, 'REMOVED')));
    await expect(new GoogleAdsClientService(prismaWith()).updateBudget('s1', '555', 60, 50))
      .resolves.toEqual({ ok: false, error: expect.stringMatching(/kaldırılmış/) });
    expect(g.calls().filter((c) => c.url.endsWith(':mutate'))).toHaveLength(0);
    vi.restoreAllMocks();

    g = fakeGoogle(() => json(200, budgetRow(daily('50000000'), undefined, 'UNKNOWN')));
    await expect(new GoogleAdsClientService(prismaWith()).updateBudget('s1', '555', 60, 50)).resolves.toEqual({ ok: false });
    expect(g.calls().filter((c) => c.url.endsWith(':mutate'))).toHaveLength(0);
  });

  it('ENABLED ama YAYINDA olmayan kampanya (serving_status ENDED/PENDING/SUSPENDED/NONE ya da alan yok): butceye dokunulmaz', async () => {
    // Bitis tarihi gecen kampanya campaign.status'ta ENABLED kalir; eskiden
    // 'ACTIVE' sayilip butcesi yaziliyordu (kaydirici yayindaki Meta'dan ona aktariyordu)
    const cases: Array<[string | null, unknown]> = [
      ['ENDED', { ok: false, error: expect.stringMatching(/yayında olmadığını bildiriyor \(yayın durumu: sona erdi\)/) }],
      ['PENDING', { ok: false, error: expect.stringMatching(/henüz başlamadı/) }],
      ['SUSPENDED', { ok: false, error: expect.stringMatching(/askıya alındı/) }],
      ['NONE', { ok: false }],
      [null, { ok: false }],
    ];
    for (const [serving, expected] of cases) {
      const g = fakeGoogle(() => json(200, budgetRow(daily('50000000'), undefined, 'ENABLED', serving)));
      await expect(new GoogleAdsClientService(prismaWith()).updateBudget('s1', '555', 60, 50)).resolves.toEqual(expected);
      expect(g.calls().filter((c) => c.url.endsWith(':mutate'))).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });

  it('mutate ag hatasiyla dusunce sonuc belirsiz doner (cagiran emniyet kaydini korur)', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const g = fakeGoogle((c) => {
      if (c.url.endsWith(':mutate')) throw new TypeError('fetch failed');
      return json(200, budgetRow(daily('50000000')));
    });
    await expect(new GoogleAdsClientService(prismaWith()).updateBudget('s1', '555', 60, 50)).resolves.toEqual({ ok: false, uncertain: true });
    expect(g.calls().filter((c) => c.url.endsWith(':mutate'))).toHaveLength(1);
  });

  it('paylasilan butce degistirilmez (diger kampanyalarin harcamasi da artardi)', async () => {
    for (const budget of [daily('20000000', { explicitlyShared: true }), daily('20000000', { referenceCount: '3' })]) {
      const g = fakeGoogle(() => json(200, budgetRow(budget)));
      const res = await new GoogleAdsClientService(prismaWith()).updateBudget('s1', '555', 24, 20);
      expect(res).toEqual({ ok: false, error: expect.stringMatching(/paylaşılıyor/) });
      expect(g.calls().filter((c) => c.url.endsWith(':mutate'))).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });

  it('toplam (CUSTOM_PERIOD) butceye gunluk tutar yazilmaz; baska musterinin butcesine dokunulmaz', async () => {
    let g = fakeGoogle(() => json(200, budgetRow({ explicitlyShared: false, referenceCount: '1', period: 'CUSTOM_PERIOD', totalAmountMicros: '900000000' })));
    await expect(new GoogleAdsClientService(prismaWith()).updateBudget('s1', '555', 20, 900)).resolves.toEqual({ ok: false, error: expect.stringMatching(/günlük değil/) });
    expect(g.calls().filter((c) => c.url.endsWith(':mutate'))).toHaveLength(0);
    vi.restoreAllMocks();

    g = fakeGoogle(() => json(200, budgetRow(daily('20000000'), 'customers/999/campaignBudgets/1')));
    await expect(new GoogleAdsClientService(prismaWith()).updateBudget('s1', '555', 24, 20)).resolves.toEqual({ ok: false });
    expect(g.calls().filter((c) => c.url.endsWith(':mutate'))).toHaveLength(0);
  });

  it('gecersiz tutar ve bulunamayan kampanya', async () => {
    const g = fakeGoogle(() => json(200, { results: [] }));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.updateBudget('s1', '555', Number.NaN, 5)).resolves.toEqual({ ok: false });
    await expect(svc.updateBudget('s1', '555', -5, 5)).resolves.toEqual({ ok: false });
    await expect(svc.updateBudget('s1', '555', 6, Number.NaN)).resolves.toEqual({ ok: false });
    expect(g.calls()).toHaveLength(0);
    await expect(svc.updateBudget('s1', '555', 6, 5)).resolves.toEqual({ ok: false });
    expect(g.calls()).toHaveLength(1);
  });

  it('canli butce okuma: durum ve tur platformdan (gunluk, paylasilan, toplam, kaldirilmis)', async () => {
    const cases: Array<[ReturnType<typeof budgetRow>, Record<string, unknown>]> = [
      [budgetRow(daily('50000000')), { status: 'ACTIVE', platformStatus: 'ENABLED', budgetType: 'daily', amount: 50 }],
      [budgetRow(daily('33333333')), { status: 'ACTIVE', budgetType: 'daily', amount: 33.333333 }],
      [budgetRow(daily('70000000', { explicitlyShared: true })), { budgetType: 'shared', amount: 70 }],
      [budgetRow({ period: 'CUSTOM_PERIOD', totalAmountMicros: '900000000' }), { budgetType: 'lifetime', amount: 900 }],
      [budgetRow(daily('50000000'), undefined, 'PAUSED'), { status: 'PAUSED', budgetType: 'daily' }],
      [budgetRow(daily('50000000'), undefined, 'REMOVED'), { status: 'ENDED', platformStatus: 'REMOVED' }],
      [budgetRow(daily('50000000'), 'customers/999/campaignBudgets/1'), { budgetType: null, amount: null }],
      // ENABLED + yayinda degil: KALICI son degil ('ENDED' yazilsaydi liveSyncPatch kaydi
      // sonsuza dek ENDED yapardi; bitis tarihi uzatilinca kampanya geri doner)
      [budgetRow(daily('50000000'), undefined, 'ENABLED', 'ENDED'), { status: 'OTHER', platformStatus: 'ENABLED/ENDED', budgetType: 'daily', amount: 50 }],
      [budgetRow(daily('50000000'), undefined, 'ENABLED', 'SUSPENDED'), { status: 'OTHER', platformStatus: 'ENABLED/SUSPENDED' }],
      [budgetRow(daily('50000000'), undefined, 'ENABLED', 'PENDING'), { status: 'OTHER', platformStatus: 'ENABLED/PENDING' }],
      [budgetRow(daily('50000000'), undefined, 'ENABLED', null), { status: 'OTHER', platformStatus: 'ENABLED/UNKNOWN' }],
      // Duraklatilmis kampanya duraklatilmis kalir (serving_status ne olursa olsun)
      [budgetRow(daily('50000000'), undefined, 'PAUSED', 'ENDED'), { status: 'PAUSED', platformStatus: 'PAUSED' }],
    ];
    for (const [body, expected] of cases) {
      fakeGoogle(() => json(200, body));
      const res = await new GoogleAdsClientService(prismaWith()).getLiveBudget('s1', '555');
      expect(res.ok).toBe(true);
      expect((res as any).live).toMatchObject(expected);
      vi.restoreAllMocks();
    }
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fakeGoogle(() => json(200, { results: [] }));
    await expect(new GoogleAdsClientService(prismaWith()).getLiveBudget('s1', '555')).resolves.toEqual({ ok: false });
    await expect(new GoogleAdsClientService(prismaWith()).getLiveBudget('s1', '555 OR 1=1')).resolves.toMatchObject({ ok: false });
  });
});

describe('negatif anahtar kelime (partialFailure)', () => {
  it('yalniz Google\'in kabul ettikleri eklendi sayilir; tekrar eden kelime gonderilmez', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const g = fakeGoogle(() => json(200, {
      results: [{ resourceName: `customers/${CID}/campaignCriteria/555~1` }, {}, { resourceName: `customers/${CID}/campaignCriteria/555~3` }],
      partialFailureError: { code: 3, message: 'Multiple errors', details: [{ errors: [{ errorCode: { criterionError: 'KEYWORD_HAS_INVALID_CHARS' } }], requestId: 'pf-1' }] },
    }));
    const svc = new GoogleAdsClientService(prismaWith());
    const res = await svc.addNegativeKeywords('s1', '555', ['bedava', 'İndir!!@@', 'Bedava', 'crack', ' ']);
    expect(res).toEqual({ ok: true, added: 2, addedKeywords: ['bedava', 'crack'] });
    const [c] = g.calls();
    expect(c.url).toBe(`${V}/customers/${CID}/campaignCriteria:mutate`);
    expect(c.body.partialFailure).toBe(true);
    expect(c.body.operations).toEqual(['bedava', 'İndir!!@@', 'crack'].map((text) => ({
      create: { campaign: `customers/${CID}/campaigns/555`, negative: true, keyword: { text, matchType: 'BROAD' } },
    })));
  });

  it('hicbiri eklenmezse ok false', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fakeGoogle(() => json(200, { results: [{}], partialFailureError: { code: 3, details: [{ errors: [{ errorCode: { criterionError: 'X' } }] }] } }));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.addNegativeKeywords('s1', '555', ['a'])).resolves.toEqual({ ok: false, added: 0, addedKeywords: [] });
  });

  it('istek reddedilirse (AB beyani) ok false ve neden', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fakeGoogle(() => json(400, failure({ mutateError: 'EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED' })));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.addNegativeKeywords('s1', '555', ['a'])).resolves.toEqual({ ok: false, added: 0, error: expect.stringMatching(/AB siyasi/) });
  });
});

describe('reklam durumu', () => {
  it('yalniz bu musterinin reklam kaynak adi kabul edilir', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const g = fakeGoogle(() => json(200, { results: [{ resourceName: 'ok' }] }));
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.setAdStatus('s1', 'customers/999/adGroupAds/1~2', 'PAUSED')).resolves.toEqual({ ok: false });
    expect(g.calls()).toHaveLength(0);
    await expect(svc.setAdStatus('s1', `customers/${CID}/adGroupAds/1~2`, 'PAUSED')).resolves.toEqual({ ok: true });
    expect(g.calls()[0].url).toBe(`${V}/customers/${CID}/adGroupAds:mutate`);
    expect(g.calls()[0].body).toEqual({ operations: [{ update: { resourceName: `customers/${CID}/adGroupAds/1~2`, status: 'PAUSED' }, updateMask: 'status' }] });
  });

  it('sonucu bilinmeyen yazim (ag hatasi, 5xx, okunamayan 2xx) uncertain; kesin red uncertain degil', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const rn = `customers/${CID}/adGroupAds/1~2`;
    const svc = new GoogleAdsClientService(prismaWith());
    const g = fakeGoogle(() => json(400, failure({ mutateError: 'EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED' })));
    await expect(svc.setAdStatus('s1', rn, 'PAUSED')).resolves.toEqual({ ok: false, error: expect.stringMatching(/AB siyasi/) });

    g.fetchMock.mockImplementation(async (input: any) =>
      (String(input).includes('oauth2') ? json(200, { access_token: 'at' }) : json(503, { error: { code: 503, message: 'x', status: 'UNAVAILABLE' } })));
    await expect(svc.setAdStatus('s1', rn, 'PAUSED')).resolves.toMatchObject({ ok: false, uncertain: true });

    g.fetchMock.mockImplementation(async (input: any) => {
      if (String(input).includes('oauth2')) return json(200, { access_token: 'at' });
      throw new TypeError('fetch failed');
    });
    await expect(svc.setAdStatus('s1', rn, 'PAUSED')).resolves.toMatchObject({ ok: false, uncertain: true });

    g.fetchMock.mockImplementation(async (input: any) =>
      (String(input).includes('oauth2') ? json(200, { access_token: 'at' }) : new Response('<html>', { status: 200 })));
    await expect(svc.setAdStatus('s1', rn, 'PAUSED')).resolves.toMatchObject({ ok: false, uncertain: true });
  });
});

/**
 * A/B satiri: GAQL REST yanitindaki gibi (lowerCamelCase, int64 dize, enum adi).
 * Varsayilan: arama kampanyasi, etkin reklam grubu, ELIGIBLE RSA.
 */
function abRow(o: {
  group: number; ad: number; impr?: string; clicks?: string; conv?: number; value?: number;
  channel?: string; groupStatus?: string; adStatus?: string; primary?: string; type?: string;
  rn?: string; omit?: string[];
}) {
  const row: any = {
    campaign: { advertisingChannelType: o.channel ?? 'SEARCH' },
    adGroup: { id: String(o.group), name: `Grup ${o.group}`, status: o.groupStatus ?? 'ENABLED' },
    adGroupAd: {
      resourceName: o.rn ?? `customers/${CID}/adGroupAds/${o.group}~${o.ad}`,
      status: o.adStatus ?? 'ENABLED',
      primaryStatus: o.primary ?? 'ELIGIBLE',
      ad: { id: String(o.ad), type: o.type ?? 'RESPONSIVE_SEARCH_AD' },
    },
    metrics: { impressions: o.impr ?? '2000', clicks: o.clicks ?? '100', conversions: o.conv ?? 0, conversionsValue: o.value ?? 0 },
  };
  for (const path of o.omit ?? []) {
    const [a, b] = path.split('.');
    delete row[a][b];
  }
  return row;
}

describe('A/B reklam satirlari (S10: reklam grubu ve yayin uygunlugu)', () => {
  it('GAQL reklam grubunu, durumlari, birincil durumu, reklam turunu ve kanal turunu secer (v26 alan adlari)', async () => {
    const g = fakeGoogle(() => json(200, { results: [] }));
    await expect(new GoogleAdsClientService(prismaWith()).getAdVariantMetrics('s1', '555')).resolves.toEqual([]);
    const q: string = g.calls()[0].body.query;
    for (const f of [
      'campaign.advertising_channel_type', 'ad_group.id', 'ad_group.name', 'ad_group.status',
      'ad_group_ad.resource_name', 'ad_group_ad.ad.id', 'ad_group_ad.ad.type', 'ad_group_ad.status',
      'ad_group_ad.primary_status', 'metrics.impressions', 'metrics.clicks', 'metrics.conversions', 'metrics.conversions_value',
    ]) expect(q).toContain(f);
    expect(q).toMatch(/FROM ad_group_ad\s+WHERE campaign\.id = 555/);
  });

  it('yalniz arama kampanyasinda, etkin reklam grubundaki ELIGIBLE metin reklami uygun', async () => {
    fakeGoogle(() => json(200, { results: [
      abRow({ group: 1, ad: 11 }),
      abRow({ group: 1, ad: 12, type: 'EXPANDED_TEXT_AD' }),
      abRow({ group: 2, ad: 21, groupStatus: 'PAUSED' }), // musteri reklam grubunu duraklatti, reklam hala ENABLED
      abRow({ group: 3, ad: 31, primary: 'NOT_ELIGIBLE' }), // reddedilmis
      abRow({ group: 3, ad: 32, primary: 'LIMITED' }),
      abRow({ group: 3, ad: 33, primary: 'PENDING' }),
      abRow({ group: 4, ad: 41, type: 'CALL_AD' }),
      abRow({ group: 4, ad: 42, adStatus: 'PAUSED' }),
      abRow({ group: 5, ad: 51, omit: ['adGroupAd.primaryStatus'] }), // alan gelmedi
      abRow({ group: 5, ad: 52, omit: ['adGroup.status'] }),
    ] }));
    const rows = await new GoogleAdsClientService(prismaWith()).getAdVariantMetrics('s1', '555');
    expect(rows!.filter((r) => r.eligible).map((r) => r.adId)).toEqual(['11', '12']);
    expect(rows!.find((r) => r.adId === '21')).toMatchObject({ groupId: '2', eligible: false });
  });

  it('kanal arama degilse (goruntulu / video) hicbir reklam uygun degil', async () => {
    fakeGoogle(() => json(200, { results: [abRow({ group: 1, ad: 11, channel: 'DISPLAY' }), abRow({ group: 1, ad: 12, channel: 'VIDEO' })] }));
    const rows = await new GoogleAdsClientService(prismaWith()).getAdVariantMetrics('s1', '555');
    expect(rows!.every((r) => !r.eligible)).toBe(true);
  });

  it('eksik metrik null olur (bilinmiyor; karsilastirmaya girmez), sifir degil', async () => {
    fakeGoogle(() => json(200, { results: [abRow({ group: 1, ad: 11, omit: ['metrics.clicks', 'metrics.conversionsValue'] })] }));
    const [r] = (await new GoogleAdsClientService(prismaWith()).getAdVariantMetrics('s1', '555'))!;
    expect(r).toMatchObject({ impressions: 2000, clicks: null, conversions: 0, conversionValue: null });
  });

  it('kimligi eksik, baska musterinin ya da kaynak adi satirla tutarsiz reklam: tum yanit guvenilmez (null)', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    for (const bad of [
      abRow({ group: 1, ad: 12, omit: ['adGroup.id'] }),
      abRow({ group: 1, ad: 12, rn: 'customers/999/adGroupAds/1~12' }),
      abRow({ group: 1, ad: 12, rn: `customers/${CID}/adGroupAds/7~12` }),
    ]) {
      fakeGoogle(() => json(200, { results: [abRow({ group: 1, ad: 11 }), bad] }));
      await expect(new GoogleAdsClientService(prismaWith()).getAdVariantMetrics('s1', '555')).resolves.toBeNull();
      vi.restoreAllMocks();
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    }
  });
});

describe('Keyword Planner', () => {
  it('v26 generateKeywordIdeas; developer token gerekmez; alanlar ayni', async () => {
    vi.stubEnv('GOOGLE_ADS_REFRESH_TOKEN', 'env-refresh');
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '111-222-3333');
    const g = fakeGoogle(() => json(200, {
      results: [{ text: 'seo ajansi', keywordIdeaMetrics: { avgMonthlySearches: '1900', competition: 'HIGH', competitionIndex: '87' } }],
    }));
    const svc = new GoogleAdsClientService({} as any);
    await expect(svc.generateKeywordIdeas({ keywords: ['seo'] })).resolves.toEqual([
      { keyword: 'seo ajansi', avgMonthlySearches: 1900, competition: 'HIGH', competitionIndex: 87 },
    ]);
    const [c] = g.calls();
    expect(c.url).toBe(`${V}/customers/1112223333:generateKeywordIdeas`);
    expect(c.headers).not.toHaveProperty('developer-token');
    expect(c.body).toEqual({
      keywordSeed: { keywords: ['seo'] },
      geoTargetConstants: ['geoTargetConstants/2792'],
      language: 'languageConstants/1037',
      keywordPlanNetwork: 'GOOGLE_SEARCH',
    });
    expect(g.tokenBodies[0].get('refresh_token')).toBe('env-refresh');
  });
});

describe('kampanya olusturma (panelden cagrilmiyor; v21+ AB beyani zorunlu)', () => {
  const base = {
    name: 'Kamp',
    dailyBudget: 50,
    headlines: ['Baslik 1', 'Baslik 2', 'Baslik 3'],
    descriptions: ['Aciklama 1', 'Aciklama 2'],
    finalUrl: 'https://ornek.com',
    keywords: ['seo'],
  };

  function creationGoogle() {
    return fakeGoogle((c) => {
      const kind = c.url.split('/').pop()!;
      const ids: Record<string, string> = {
        'campaignBudgets:mutate': `customers/${CID}/campaignBudgets/1`,
        'campaigns:mutate': `customers/${CID}/campaigns/2`,
        'adGroups:mutate': `customers/${CID}/adGroups/3`,
        'adGroupAds:mutate': `customers/${CID}/adGroupAds/3~4`,
        'adGroupCriteria:mutate': `customers/${CID}/adGroupCriteria/3~5`,
        'campaignCriteria:mutate': `customers/${CID}/campaignCriteria/2~6`,
      };
      const n = Array.isArray(c.body?.operations) ? c.body.operations.length : 1;
      return json(200, { results: Array.from({ length: n }, () => ({ resourceName: ids[kind] })) });
    });
  }

  it('beyan verilmeden Google\'a hic istek atilmaz', async () => {
    const g = creationGoogle();
    const res = await new GoogleAdsClientService(prismaWith()).createCampaign('s1', { ...base } as any);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/AB siyasi reklam beyanı zorunlu/) });
    expect(g.calls()).toHaveLength(0);
    expect(g.tokenBodies).toHaveLength(0);
  });

  it('beyan kampanya govdesine enum olarak gider; tum adimlar v26 ve sirali', async () => {
    const g = creationGoogle();
    const svc = new GoogleAdsClientService(prismaWith());
    await expect(svc.createCampaign('s1', { ...base, containsEuPoliticalAdvertising: false })).resolves.toEqual({ ok: true, campaignId: '2' });
    expect(g.calls().map((c) => c.url)).toEqual([
      `${V}/customers/${CID}/campaignBudgets:mutate`,
      `${V}/customers/${CID}/campaigns:mutate`,
      `${V}/customers/${CID}/adGroups:mutate`,
      `${V}/customers/${CID}/adGroupAds:mutate`,
      `${V}/customers/${CID}/adGroupCriteria:mutate`,
      `${V}/customers/${CID}/campaignCriteria:mutate`,
    ]);
    const campaign = g.calls()[1].body.operations[0].create;
    expect(campaign).toMatchObject({
      advertisingChannelType: 'SEARCH',
      status: 'PAUSED',
      campaignBudget: `customers/${CID}/campaignBudgets/1`,
      containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    });
    expect(g.calls()[0].body.operations[0].create.amountMicros).toBe('50000000');
    expect(g.calls()[5].body.operations).toEqual([
      { create: { campaign: `customers/${CID}/campaigns/2`, location: { geoTargetConstant: 'geoTargetConstants/2792' } } },
      { create: { campaign: `customers/${CID}/campaigns/2`, language: { languageConstant: 'languageConstants/1037' } } },
    ]);

    vi.restoreAllMocks();
    const g2 = creationGoogle();
    await svc.createCampaign('s1', { ...base, containsEuPoliticalAdvertising: true });
    expect(g2.calls()[1].body.operations[0].create.containsEuPoliticalAdvertising).toBe('CONTAINS_EU_POLITICAL_ADVERTISING');
  });
});

describe('otopilot ve panel', () => {
  it('negatif kelime gecmisine yalniz eklenenler yazilir (panel "N negatif" sayar)', async () => {
    const update = vi.fn(async () => ({}));
    const prisma: any = {
      site: { findMany: vi.fn(async () => [{ id: 's1', niche: 'seo' }]) },
      adCampaign: {
        findMany: vi.fn(async () => [{ id: 'c1', externalId: '555', name: 'Kamp', autopilotActions: [] }]),
        update,
      },
    };
    const adsClient: any = {
      getSearchTerms: vi.fn(async () => [{ term: 'bedava seo' }]),
      addNegativeKeywords: vi.fn(async () => ({ ok: true, added: 1, addedKeywords: ['bedava'] })),
    };
    const svc = new KeywordOptimizerService(prisma, adsClient);
    (svc as any).anthropic = {
      messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: '{"negativeKeywords": ["bedava", "indir!!"], "reason": "alakasiz"}' }] })) },
    };
    await expect(svc.optimizeAllGoogleCampaigns()).resolves.toEqual({ analyzed: 1, addedKeywords: 1 });
    const history = (update.mock.calls[0] as any[])[0].data.autopilotActions;
    expect(history[history.length - 1]).toMatchObject({ action: 'add-negative-keywords', keywords: ['bedava'] });
  });

  it('elle duraklatma reddinde platformun kesin nedeni mesaja eklenir', async () => {
    const prisma: any = {
      adCampaign: {
        findFirstOrThrow: vi.fn(async () => ({ id: 'c1', platform: 'google_ads', externalId: '555' })),
        update: vi.fn(async () => ({})),
      },
    };
    const reason = 'Google Ads hesabında AB siyasi reklam beyanı yapılmamış kampanyalar var.';
    const ctrl = new AdsController(prisma, { setStatus: vi.fn(async () => ({ ok: false, error: reason })) } as any, {} as any);
    const res: any = await ctrl.pause('s1', 'c1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/onaylamadı/);
    expect(res.error).toContain(`Neden: ${reason}`);
    expect(prisma.adCampaign.update).not.toHaveBeenCalled();

    const ctrl2 = new AdsController(prisma, { setStatus: vi.fn(async () => ({ ok: false })) } as any, {} as any);
    expect(((await ctrl2.pause('s1', 'c1')) as any).error).not.toContain('Neden:');
  });
});
