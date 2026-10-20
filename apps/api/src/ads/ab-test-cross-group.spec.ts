import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { GoogleAdsClientService } from './google-ads-client.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';
import { AdsClientService } from './ads-client.service.js';
import { PerformanceSyncService } from './performance-sync.service.js';
import { AB_HISTORY_RUN_MAX, AbTestManagerService } from './ab-test-manager.service.js';

/**
 * S10 (13. tur) regresyonu — gozden gecirenlerin yeniden uretimleri, gercek
 * AbTestManagerService + AdsClientService + Google/Meta istemcileri +
 * PerformanceSyncService ile, sahte platform yanitlariyla:
 *  - 11. tur startDate'i yazinca A/B adimi calismaya basladi ve tum kampanyadaki
 *    reklamlari tek havuzda karsilastirdi: 3 reklam grubunun (her birinde tek
 *    RSA) ikisinin tek reklami duraklatildi, o gruplar yayindan dustu;
 *  - musterinin duraklattigi reklam grubundaki (reklami hala ENABLED) reklam
 *    kazanan secildi, yayindaki iki reklam duraklatildi;
 *  - Meta'da farkli reklam setlerinin reklamlari birlikte siralandi;
 *  - musteri yeniden actigi reklamlar sonraki 6 saatlik turda yine duraklatildi.
 */

const CID = '1234567890';
const DAY = 86_400_000;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type GAd = {
  group: number; ad: number; impr: number; clicks: number; conv?: number;
  status?: string; groupStatus?: string; primary?: string;
};

/** Sahte KvStore (A/B defteri burada tutulur) */
function kvStoreFake() {
  const store = new Map<string, string>();
  return {
    store,
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => (store.has(where.key) ? { key: where.key, value: store.get(where.key)! } : null)),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        store.set(where.key, store.has(where.key) ? update.value : create.value);
        return { key: where.key };
      }),
    },
  };
}

/**
 * Durum tutan sahte Google Ads: reklam durumlari saklanir, A/B GAQL'i
 * ad_group_ad.status = 'ENABLED' suzgecini uygular (Google gibi); metrikler
 * LAST_7_DAYS toplami (duraklatma oncesi gosterimler pencerede kalir).
 * Reklam grubu duraklatilmissa reklamin birincil durumu PAUSED olur
 * (enums/ad_group_ad_primary_status_reason.proto AD_GROUP_PAUSED).
 */
function googleHarness(ads: GAd[], opts: { servingStatus?: string } = {}) {
  const state = ads.map((a) => ({ ...a, status: a.status ?? 'ENABLED', groupStatus: a.groupStatus ?? 'ENABLED' }));
  const mutations: Array<{ rn: string; status: string }> = [];
  const gaql: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') return json(200, { access_token: 'at' });
    if (url.endsWith('/googleAds:search')) {
      const q: string = JSON.parse(String(init.body)).query;
      gaql.push(q);
      if (q.includes('FROM ad_group_ad')) {
        const enabledOnly = /ad_group_ad\.status\s*=\s*'ENABLED'/.test(q);
        return json(200, {
          results: state.filter((a) => !enabledOnly || a.status === 'ENABLED').map((a) => ({
            campaign: { advertisingChannelType: 'SEARCH' },
            adGroup: { id: String(a.group), name: `Grup ${a.group}`, status: a.groupStatus },
            adGroupAd: {
              resourceName: `customers/${CID}/adGroupAds/${a.group}~${a.ad}`,
              status: a.status,
              primaryStatus: a.primary ?? (a.groupStatus !== 'ENABLED' || a.status !== 'ENABLED' ? 'PAUSED' : 'ELIGIBLE'),
              ad: { id: String(a.ad), type: 'RESPONSIVE_SEARCH_AD' },
            },
            // ctr: eski sorgu metrics.ctr seciyordu; sahte yanit onu da tasir ki eski kod gercek oranlari gorsun
            metrics: { impressions: String(a.impr), clicks: String(a.clicks), ctr: a.clicks / a.impr, conversions: a.conv ?? 0, conversionsValue: (a.conv ?? 0) * 100 },
          })),
        });
      }
      if (q.includes('campaign.serving_status')) {
        return json(200, { results: [{
          campaign: { status: 'ENABLED', servingStatus: opts.servingStatus ?? 'SERVING', campaignBudget: `customers/${CID}/campaignBudgets/9` },
          campaignBudget: { period: 'DAILY', amountMicros: '500000000', explicitlyShared: false, referenceCount: '1' },
        }] });
      }
      if (q.includes('FROM campaign')) {
        return json(200, { results: [{ metrics: { impressions: '6000', clicks: '225', costMicros: '900000000', conversions: 12, conversionsValue: 3000, ctr: 0.0375, averageCpc: 4000000 } }] });
      }
      return json(200, { results: [] });
    }
    if (url.endsWith('/adGroupAds:mutate')) {
      const op = JSON.parse(String(init.body)).operations[0].update;
      mutations.push({ rn: op.resourceName, status: op.status });
      const a = state.find((x) => op.resourceName.endsWith(`/${x.group}~${x.ad}`));
      if (a) a.status = op.status;
      return json(200, { results: [{ resourceName: op.resourceName }] });
    }
    return json(404, {});
  });

  // Yalniz Date.now'u taklit etmek yetmez: performance-sync startDate'i
  // new Date() ile yaziyor; gercek saat sabit tarihi gecince (20.10.2026
  // 06:00 UTC) kampanya 7 gun kuralina takiliyordu. Date tamamen sahte saatte.
  let now = Date.UTC(2026, 9, 20, 6, 0, 0);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  const site = { id: 's1', name: 'Site', adsAutopilot: true, googleAdsRefreshToken: 'rt', googleAdsCustomerId: '123-456-7890' };
  const row: any = { id: 'c1', siteId: 's1', platform: 'google_ads', externalId: '111', name: 'G', objective: 'sales', status: 'ACTIVE', budgetType: 'daily', budgetAmount: 500, startDate: null, autopilotActions: null };
  const sqlLte = (val: any, bound: Date) => val != null && new Date(val).getTime() <= bound.getTime();
  const kv = kvStoreFake();
  const prisma: any = {
    site: { findMany: vi.fn(async () => [site]), findUniqueOrThrow: vi.fn(async () => site) },
    adCampaign: {
      findMany: vi.fn(async ({ where }: any = {}) => [row]
        .filter((c) => !where?.status || c.status === where.status)
        .filter((c) => !where?.startDate?.lte || sqlLte(c.startDate, where.startDate.lte))
        .map((c) => ({ ...c, site }))),
      update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return row; }),
    },
    kvStore: kv.kvStore,
  };
  const google = new GoogleAdsClientService(prisma);
  const meta = new MetaAdsClientService(prisma);
  const adsClient = new AdsClientService(prisma, google, meta);
  const sync = new PerformanceSyncService(prisma, adsClient);
  const ab = new AbTestManagerService(prisma, adsClient);
  const enabledPerGroup = (groups: number[]) => groups.map((g) => state.filter((a) => a.group === g && a.status === 'ENABLED').length);
  return { state, mutations, gaql, row, kv, sync, ab, enabledPerGroup, advance: (ms: number) => { now += ms; vi.setSystemTime(now); } };
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'sec');
  vi.stubEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', '');
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Google: reklamlar yalniz kendi reklam grubunda karsilastirilir', () => {
  it('3 reklam grubu x 1 RSA (eski kayit, deploydan 7 gun sonra): hicbir reklam duraklatilmaz, her grup yayinda kalir', async () => {
    const h = googleHarness([
      { group: 1, ad: 11, impr: 500, clicks: 75, conv: 5 }, // marka: %15
      { group: 2, ad: 22, impr: 4000, clicks: 120, conv: 6 }, // genel: %3
      { group: 3, ad: 33, impr: 1500, clicks: 30, conv: 1 }, // rakip: %2
    ]);
    await h.sync.syncAllActive(); // deploy gunu: baslangic yazilir
    expect(h.row.startDate).toBeInstanceOf(Date);
    h.advance(7 * DAY + 3_600_000);
    await expect(h.ab.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    expect(h.mutations).toEqual([]);
    expect(h.enabledPerGroup([1, 2, 3])).toEqual([1, 1, 1]);
    expect(h.row.autopilotActions).toBeNull();
    const abQ = h.gaql.find((q) => q.includes('FROM ad_group_ad'))!;
    expect(abQ).toContain('ad_group.id');
    expect(abQ).toContain('ad_group.status');
  });

  it('musterinin duraklattigi reklam grubundaki (reklami ENABLED) reklam kazanan secilmez; yayindaki reklamlara gurultu farkiyla dokunulmaz', async () => {
    const h = googleHarness([
      { group: 1, ad: 11, impr: 600, clicks: 60, conv: 3, groupStatus: 'PAUSED' }, // 2 gun once duraklatildi
      { group: 2, ad: 21, impr: 3000, clicks: 120, conv: 4 }, // %4
      { group: 2, ad: 22, impr: 2500, clicks: 75, conv: 2 }, // %3 — z ~ 2,0: anlamli degil
    ]);
    h.row.startDate = new Date(Date.UTC(2026, 9, 1));
    await expect(h.ab.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    expect(h.mutations).toEqual([]);
    expect(h.enabledPerGroup([2])).toEqual([2]);
  });

  it('ayni grupta anlamli fark varsa YALNIZ o gruptaki geride kalan duraklatilir; duraklatilmis gruptaki reklam kazanan olmaz', async () => {
    const h = googleHarness([
      { group: 1, ad: 11, impr: 1600, clicks: 160, conv: 3, groupStatus: 'PAUSED' }, // %10, grubu duraklatilmis
      { group: 2, ad: 21, impr: 3000, clicks: 150, conv: 4 }, // %5
      { group: 2, ad: 22, impr: 2500, clicks: 50, conv: 1 }, // %2
      { group: 3, ad: 31, impr: 2000, clicks: 20 }, // tek reklamli grup: %1
    ]);
    h.row.startDate = new Date(Date.UTC(2026, 9, 1));
    await expect(h.ab.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 1, pausedAds: 1 });
    expect(h.mutations).toEqual([{ rn: `customers/${CID}/adGroupAds/2~22`, status: 'PAUSED' }]);
    expect(h.enabledPerGroup([2, 3])).toEqual([1, 1]);
    expect(h.row.autopilotActions).toEqual([expect.objectContaining({
      action: 'ab-test-winner', groupId: '2', groupName: 'Grup 2', winnerAdId: '21', pausedCount: 1, failedCount: 0, pausedAdIds: ['22'],
    })]);
  });

  it('musteri duraklatilan reklami yeniden acarsa sonraki turlarda bir daha duraklatilmaz', async () => {
    const h = googleHarness([
      { group: 2, ad: 21, impr: 3000, clicks: 150 }, // %5
      { group: 2, ad: 22, impr: 2500, clicks: 50 }, // %2
    ]);
    await h.sync.syncAllActive();
    h.advance(7 * DAY + 3_600_000);
    await h.ab.pickWinners();
    expect(h.enabledPerGroup([2])).toEqual([1]);

    // Musteri reklamin durdugunu fark edip yeniden acti; pencere icindeki eski gosterimler duruyor
    h.state[1].status = 'ENABLED';
    for (let i = 0; i < 3; i++) {
      h.advance(6 * 3_600_000);
      await h.sync.syncAllActive();
      await expect(h.ab.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    }
    expect(h.enabledPerGroup([2])).toEqual([2]);
    expect(h.mutations.filter((m) => m.status === 'PAUSED')).toHaveLength(1);
    expect(h.row.autopilotActions.filter((e: any) => e.action === 'ab-test-winner')).toHaveLength(1);
  });

  it('tek turda 25 reklam grubunda duraklatma (rv15 G9): her onayli duraklatmanin kimligi gecmiste; diger adimlarin kayitlarinin yarisi kalir', async () => {
    // Eskiden grup basina kayit + slice(-20): 25 PAUSE yapiliyor ama yalniz son 20 grup yaziliyordu
    // (5 grubun kimlikleri panelde hic yok) ve diger adimlarin eski kayitlarinin hepsi siliniyordu
    const ads: GAd[] = [];
    for (let g = 1; g <= 25; g++) ads.push({ group: g, ad: g * 10 + 1, impr: 30000, clicks: 1200 }, { group: g, ad: g * 10 + 2, impr: 25000, clicks: 750 });
    const h = googleHarness(ads);
    h.row.startDate = new Date(Date.UTC(2026, 9, 1));
    const older = Array.from({ length: 20 }, (_, i) => ({
      time: new Date(Date.UTC(2026, 8, 1, i)).toISOString(), action: 'budget-shift-in', budgetBefore: 100 + i, budgetAfter: 110 + i,
    }));
    h.row.autopilotActions = older;

    await expect(h.ab.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 25, pausedAds: 25 });
    expect(h.mutations).toHaveLength(25);
    expect(h.enabledPerGroup(Array.from({ length: 25 }, (_, i) => i + 1))).toEqual(Array(25).fill(1));

    const hist: any[] = h.row.autopilotActions;
    expect(hist).toHaveLength(20);
    expect(hist.slice(0, 20 - AB_HISTORY_RUN_MAX)).toEqual(older.slice(AB_HISTORY_RUN_MAX));
    const run = hist.slice(20 - AB_HISTORY_RUN_MAX);
    expect(run.slice(0, 9).map((e) => e.groupName)).toEqual(Array.from({ length: 9 }, (_, i) => `Grup ${i + 1}`));
    expect(run[9]).toMatchObject({ action: 'ab-test-winner', groupCount: 16, pausedCount: 16, failedCount: 0 });
    expect(run[9]).not.toHaveProperty('groupId');
    const findable = run.flatMap((e) => e.pausedAdIds ?? []).sort();
    expect(findable).toEqual(Array.from({ length: 25 }, (_, i) => String((i + 1) * 10 + 2)).sort());
  });

  it('kampanya ENABLED ama yayinda degil (serving_status ENDED): reklamlar okunmaz, dokunulmaz', async () => {
    const h = googleHarness([
      { group: 2, ad: 21, impr: 3000, clicks: 150 },
      { group: 2, ad: 22, impr: 2500, clicks: 50 },
    ], { servingStatus: 'ENDED' });
    h.row.startDate = new Date(Date.UTC(2026, 9, 1));
    await expect(h.ab.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    expect(h.gaql.some((q) => q.includes('FROM ad_group_ad'))).toBe(false);
    expect(h.mutations).toEqual([]);
  });
});

/**
 * Sahte Meta Graph: hesap para birimi, kampanya (CBO gunluk butce, yayinda),
 * A/B'nin uc okumasi ve POST durum yazimlari.
 */
function metaHarness(o: {
  insights: Array<Record<string, unknown>>;
  ads: Array<Record<string, unknown>>;
  adsets: Array<Record<string, unknown>>;
}) {
  const posts: Array<{ id: string; status: string | null }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (!url.startsWith('https://graph.facebook.com/')) return json(404, {});
    if (init?.method === 'POST') {
      posts.push({ id: url.split('/').pop()!.split('?')[0], status: new URLSearchParams(String(init.body)).get('status') });
      return json(200, { success: true });
    }
    if (url.includes('?fields=currency')) return json(200, { currency: 'TRY' });
    // Eski okuma clicks + ctr (yuzde) istiyordu: sahte satirlar onlari da tasir (eski kod gercek oranlari gorsun)
    if (url.includes('/insights?') && url.includes('level=ad')) {
      return json(200, { data: o.insights.map((r) => ({ ...r, clicks: r.inline_link_clicks, ctr: String((Number(r.inline_link_clicks) / Number(r.impressions)) * 100) })) });
    }
    if (url.includes('/ads?fields=id,adset_id,effective_status')) return json(200, { data: o.ads });
    if (url.includes('/adsets?fields=id,effective_status,optimization_goal')) return json(200, { data: o.adsets });
    if (url.includes('/222?fields=effective_status')) return json(200, { id: '222', effective_status: 'ACTIVE', daily_budget: '10000' });
    return json(404, {});
  });
  const site = { id: 's1', name: 'Site', adsAutopilot: true, metaAdsAccessToken: 'mt', metaAdsAccountId: 'act_1' };
  const row: any = { id: 'm1', siteId: 's1', platform: 'meta_ads', externalId: '222', status: 'ACTIVE', startDate: new Date(Date.now() - 30 * DAY), autopilotActions: null };
  const kv = kvStoreFake();
  const prisma: any = {
    site: { findMany: vi.fn(async () => [site]), findUniqueOrThrow: vi.fn(async () => site) },
    adCampaign: { findMany: vi.fn(async () => [{ ...row }]), update: vi.fn(async ({ data }: any) => Object.assign(row, data)) },
    kvStore: kv.kvStore,
  };
  const ab = new AbTestManagerService(prisma, new AdsClientService(prisma, new GoogleAdsClientService(prisma), new MetaAdsClientService(prisma)));
  return { posts, row, ab };
}

describe('Meta: reklamlar yalniz kendi reklam setinde karsilastirilir', () => {
  it('farkli kitleli iki reklam seti x 1 reklam: diger reklam setinin tek reklami duraklatilmaz', async () => {
    const h = metaHarness({
      insights: [
        { ad_id: '9001', adset_id: '71', adset_name: 'İstanbul 25-34', impressions: '3000', inline_link_clicks: '120' },
        { ad_id: '9002', adset_id: '72', adset_name: 'Ankara 35-54', impressions: '5000', inline_link_clicks: '75' },
      ],
      ads: [{ id: '9001', adset_id: '71', effective_status: 'ACTIVE' }, { id: '9002', adset_id: '72', effective_status: 'ACTIVE' }],
      adsets: [{ id: '71', effective_status: 'ACTIVE', optimization_goal: 'LINK_CLICKS' }, { id: '72', effective_status: 'ACTIVE', optimization_goal: 'LINK_CLICKS' }],
    });
    await expect(h.ab.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    expect(h.posts).toEqual([]);
    expect(h.row.autopilotActions).toBeNull();
  });

  it('baglanti tiklamasi hedefli ayni reklam setinde anlamli fark: yalniz geride kalan duraklatilir', async () => {
    const h = metaHarness({
      insights: [
        { ad_id: '9001', adset_id: '71', adset_name: 'Trafik', impressions: '3000', inline_link_clicks: '150' }, // %5
        { ad_id: '9003', adset_id: '71', adset_name: 'Trafik', impressions: '3000', inline_link_clicks: '45' }, // %1,5
        { ad_id: '9002', adset_id: '72', adset_name: 'Mesaj', impressions: '5000', inline_link_clicks: '20' },
        { ad_id: '9004', adset_id: '72', adset_name: 'Mesaj', impressions: '5000', inline_link_clicks: '200' },
      ],
      ads: ['9001', '9003'].map((id) => ({ id, adset_id: '71', effective_status: 'ACTIVE' }))
        .concat(['9002', '9004'].map((id) => ({ id, adset_id: '72', effective_status: 'ACTIVE' }))),
      // Mesaj hedefli reklam setinde tiklama orani hedef degil: dokunulmaz
      adsets: [{ id: '71', effective_status: 'ACTIVE', optimization_goal: 'LINK_CLICKS' }, { id: '72', effective_status: 'ACTIVE', optimization_goal: 'CONVERSATIONS' }],
    });
    await expect(h.ab.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 1, pausedAds: 1 });
    expect(h.posts).toEqual([{ id: '9003', status: 'PAUSED' }]);
    expect(h.row.autopilotActions).toEqual([expect.objectContaining({ action: 'ab-test-winner', groupId: '71', groupName: 'Trafik', winnerAdId: '9001', pausedAdIds: ['9003'] })]);
  });

  it('reklam setinde 12 geride kalan: kimlik listesi 10\'da kesilir ve kesildigi pausedAdIdsTotal ile yazilir', async () => {
    // Eskiden ilk 10 kimlik sessizce yaziliyordu; panel "kimlikleri" deyip eksik listeyi tam liste gibi gosteriyordu
    const losers = Array.from({ length: 12 }, (_, i) => String(9101 + i));
    const h = metaHarness({
      insights: [{ ad_id: '9001', adset_id: '71', adset_name: 'Trafik', impressions: '3000', inline_link_clicks: '150' }]
        .concat(losers.map((id) => ({ ad_id: id, adset_id: '71', adset_name: 'Trafik', impressions: '3000', inline_link_clicks: '45' }))),
      ads: ['9001', ...losers].map((id) => ({ id, adset_id: '71', effective_status: 'ACTIVE' })),
      adsets: [{ id: '71', effective_status: 'ACTIVE', optimization_goal: 'LINK_CLICKS' }],
    });
    await expect(h.ab.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 1, pausedAds: 12 });
    expect(h.posts.map((p) => p.id)).toEqual(losers);
    expect(h.row.autopilotActions).toEqual([expect.objectContaining({
      action: 'ab-test-winner', groupId: '71', pausedCount: 12, failedCount: 0, pausedAdIds: losers.slice(0, 10), pausedAdIdsTotal: 12,
    })]);
  });
});
