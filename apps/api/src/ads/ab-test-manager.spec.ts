import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  AB_HISTORY_GROUP_IDS_MAX,
  AB_HISTORY_RUN_MAX,
  AB_HISTORY_SUMMARY_IDS_MAX,
  AB_LEDGER_MAX,
  AB_LEDGER_PREFIX,
  AB_MIN_IMPRESSIONS,
  AbTestManagerService,
  ctrClearlyBetter,
  planAbGroups,
} from './ab-test-manager.service.js';
import { PerformanceSyncService } from './performance-sync.service.js';
import type { AdVariant } from './ads-client.service.js';

/**
 * A/B otopilotu.
 *  - G18: gecmise yalniz platformun onayladigi duraklatmalar "duraklatildi"
 *    yazilir (eskiden Google reddettiginde de yaziliyordu).
 *  - S10: reklamlar yalniz kendi reklam grubunda / reklam setinde ve yalniz
 *    yayinda olabilenler karsilastirilir; kazanan hic duraklatilmaz, fark
 *    istatistiksel olarak anlamli olmali, musterinin yeniden actigi reklam
 *    (defter) bir daha duraklatilmaz, okunamayan her seyde hicbir sey yapilmaz.
 */

const EU_REASON = 'Google Ads hesabında AB siyasi reklam beyanı yapılmamış kampanyalar var.';

/** Uygun bir reklam; varsayilan grup 9, 2000 gosterim */
function v(ad: string, clicks: number, over: Partial<AdVariant> = {}): AdVariant {
  return {
    adId: ad,
    target: `customers/1/adGroupAds/${over.groupId ?? '9'}~${ad}`,
    groupId: '9',
    groupName: 'Marka',
    eligible: true,
    impressions: 2000,
    clicks,
    conversions: 0,
    conversionValue: 0,
    ...over,
  };
}

// Grup 9: 1 acik ara onde (CTR %6), 2 ve 3 geride (%2, %1)
const variants = [v('1', 120), v('2', 40), v('3', 20)];

/**
 * Prisma where'inin bu adimin kullandigi kismi, SQL kurallariyla: esitlik ve
 * `lte`. NULL <= x SQL'de NULL'dur → satir SECILMEZ. Eski sahte findMany
 * where'i yok sayiyordu; startDate'i hic yazilmayan (NULL) kayitlarla adim
 * uretimde hic calismazken testler geciyordu (R18).
 */
function sqlWhereMatch(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, val] of Object.entries(where)) {
    if (val && typeof val === 'object' && !(val instanceof Date)) {
      const op = val as { lte?: Date };
      if (op.lte !== undefined) {
        const cur = row[k];
        if (cur === null || cur === undefined) return false;
        if (!(new Date(cur as Date).getTime() <= new Date(op.lte).getTime())) return false;
      }
      continue;
    }
    if (row[k] !== val) return false;
  }
  return true;
}

const OTUZ_GUN_ONCE = () => new Date(Date.now() - 30 * 86_400_000);
const LEDGER_KEY = `${AB_LEDGER_PREFIX}s1:google_ads:555`;

/** Sahte KvStore: anahtar → deger; `failRead` / `failWrite` hata atar */
function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const state = { failRead: false, failWrite: false, writes: 0 };
  const kvStore = {
    findUnique: vi.fn(async ({ where }: any) => {
      if (state.failRead) throw new Error('db down');
      return store.has(where.key) ? { key: where.key, value: store.get(where.key)! } : null;
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      if (state.failWrite) throw new Error('db down');
      state.writes++;
      store.set(where.key, store.has(where.key) ? update.value : create.value);
      return { key: where.key };
    }),
  };
  const ledger = (): Record<string, string> => (store.has(LEDGER_KEY) ? JSON.parse(store.get(LEDGER_KEY)!).paused : {});
  return { kvStore, store, state, ledger };
}

function setup(
  setAdStatus: (target: string) => { ok: boolean; error?: string; uncertain?: boolean },
  ads: AdVariant[] | null = variants,
  rowOver: Record<string, unknown> = {},
  kv = fakeKv(),
) {
  const row: any = { id: 'c1', siteId: 's1', platform: 'google_ads', externalId: '555', status: 'ACTIVE', autopilotActions: null, startDate: OTUZ_GUN_ONCE(), ...rowOver };
  const prisma: any = {
    site: { findMany: vi.fn(async () => [{ id: 's1' }]) },
    adCampaign: {
      findMany: vi.fn(async ({ where }: any) => (sqlWhereMatch(row, where) ? [{ ...row }] : [])),
      update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return row; }),
    },
    kvStore: kv.kvStore,
  };
  const adsClient: any = {
    getLiveBudget: vi.fn(async () => ({ ok: true, live: { status: 'ACTIVE', platformStatus: 'ENABLED', budgetType: 'daily', amount: 100 } })),
    getAdVariants: vi.fn(async () => ads),
    setAdStatus: vi.fn(async (_s: string, _p: string, target: string) => setAdStatus(target)),
  };
  return { svc: new AbTestManagerService(prisma, adsClient), prisma, adsClient, row, kv };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('planAbGroups — yalniz ayni gruptaki yayindaki reklamlar', () => {
  it('her grubun tek reklami varsa (3 reklam grubu x 1 reklam) hicbir sey duraklatilmaz', () => {
    const plans = planAbGroups([
      v('11', 300, { groupId: '1' }), // marka: %15
      v('22', 60, { groupId: '2' }), // genel: %3
      v('33', 40, { groupId: '3' }), // rakip: %2
    ], new Set());
    expect(plans).toEqual([]);
  });

  it('yayinda olmayan (eligible degil) reklam ne kazanan secilir ne duraklatilir', () => {
    const plans = planAbGroups([
      v('11', 200, { groupId: '1', eligible: false }), // grubu duraklatilmis, reklam ENABLED
      v('21', 120, { groupId: '2' }),
      v('22', 40, { groupId: '2' }),
    ], new Set());
    expect(plans).toHaveLength(1);
    expect(plans![0]).toMatchObject({ groupId: '2', winner: { adId: '21' } });
    expect(plans![0].losers.map((l) => l.adId)).toEqual(['22']);
  });

  it('kazanan hic duraklatilmaz; her grup kendi kazananiyla karsilastirilir', () => {
    const plans = planAbGroups([
      v('11', 120, { groupId: '1' }), v('12', 40, { groupId: '1' }),
      v('21', 30, { groupId: '2' }), v('22', 100, { groupId: '2' }),
    ], new Set())!;
    expect(plans.map((p) => [p.groupId, p.winner.adId, p.losers.map((l) => l.adId)])).toEqual([['1', '11', ['12']], ['2', '22', ['21']]]);
  });

  it('en az AB_MIN_IMPRESSIONS gosterim; metrigi bilinmeyen reklam karsilastirmaya girmez', () => {
    expect(AB_MIN_IMPRESSIONS).toBe(1000);
    expect(planAbGroups([v('1', 60, { impressions: 999 }), v('2', 1, { impressions: 999 })], new Set())).toEqual([]);
    for (const k of ['impressions', 'clicks', 'conversions', 'conversionValue'] as const) {
      expect(planAbGroups([v('1', 120), v('2', 10, { [k]: null })], new Set())).toEqual([]);
    }
  });

  it('fark gurultu olabilecek kadar kucukse dokunulmaz (eski kural 100 gosterimde 0,3 puanla duraklatiyordu)', () => {
    // %4 vs %3 (3000 / 2500 gosterim): 1 puan fark ama z ~ 2,0 < 2,576
    expect(planAbGroups([v('21', 120, { impressions: 3000 }), v('22', 75, { impressions: 2500 })], new Set())).toEqual([]);
    // Cok buyuk hacimde anlamli ama 0,3 puandan kucuk fark: dokunulmaz
    expect(ctrClearlyBetter({ clicks: 50_000, impressions: 1_000_000 }, { clicks: 48_000, impressions: 1_000_000 })).toBe(false);
    expect(ctrClearlyBetter({ clicks: 120, impressions: 2000 }, { clicks: 40, impressions: 2000 })).toBe(true);
  });

  it('geride kalan gosterim basina daha cok donusum ya da donusum degeri getirdiyse duraklatilmaz', () => {
    expect(planAbGroups([v('1', 120, { conversions: 1 }), v('2', 40, { conversions: 2 })], new Set())).toEqual([]);
    expect(planAbGroups([v('1', 120, { conversions: 2, conversionValue: 100 }), v('2', 40, { conversions: 1, conversionValue: 400 })], new Set())).toEqual([]);
    expect(planAbGroups([v('1', 120, { conversions: 2, conversionValue: 400 }), v('2', 40, { conversions: 2, conversionValue: 400 })], new Set())![0].losers).toHaveLength(1);
  });

  it('defterdeki (musterinin yeniden actigi) reklam duraklatma listesine girmez', () => {
    const plans = planAbGroups(variants, new Set([variants[1].target]))!;
    expect(plans[0].losers.map((l) => l.adId)).toEqual(['3']);
    expect(planAbGroups(variants, new Set([variants[1].target, variants[2].target]))).toEqual([]);
  });

  it('ayni duraklatma hedefi iki kez gelirse yanit guvenilmez (null)', () => {
    expect(planAbGroups([v('1', 120), v('1', 40)], new Set())).toBeNull();
  });
});

describe('pickWinners — gecmis yalniz platformun onayladigini yazar (G18)', () => {
  it('tum duraklatmalar onaylanirsa grup, kazanan, duraklatilan sayisi/kimlikleri ve failedCount: 0 yazilir', async () => {
    const { svc, row, kv } = setup(() => ({ ok: true }));
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 1, pausedAds: 2 });
    // failedCount HER ZAMAN var: panel (web lib/ads-history.ts) alansiz kaydi
    // eski surum (onaysiz pausedCount) sayar ve "duraklatildi" demez
    expect(row.autopilotActions).toEqual([{
      time: expect.any(String), action: 'ab-test-winner', groupId: '9', groupName: 'Marka',
      winnerAdId: '1', winnerCtr: 0.06, pausedCount: 2, failedCount: 0, pausedAdIds: ['2', '3'],
    }]);
    expect(row.autopilotActions[0]).not.toHaveProperty('reason');
    expect(row.autopilotActions[0]).not.toHaveProperty('uncertainCount');
    expect(Object.keys(kv.ledger())).toEqual([variants[1].target, variants[2].target]);
  });

  it('platform HICBIR duraklatmayi onaylamazsa "duraklatildi" yazilmaz; neden ile basarisizlik kaydi; defterden silinir (yeniden denenebilir)', async () => {
    const { svc, row, kv } = setup(() => ({ ok: false, error: EU_REASON }));
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    expect(row.autopilotActions).toEqual([
      expect.objectContaining({ action: 'ab-test-pause-failed', groupId: '9', winnerAdId: '1', failedCount: 2, reason: EU_REASON }),
    ]);
    expect(row.autopilotActions[0]).not.toHaveProperty('pausedCount');
    expect(kv.ledger()).toEqual({});
  });

  it('ayni grupta ayni basarisizlik her 6 saatte tekrar yazilmaz (gecmisin son 20 kaydini doldurmasin)', async () => {
    const { svc, row } = setup(() => ({ ok: false, error: EU_REASON }));
    await svc.pickWinners();
    await svc.pickWinners();
    await svc.pickWinners();
    expect(row.autopilotActions).toHaveLength(1);
  });

  it('bir kismi duraklatilirsa yalniz onaylananlar sayilir, basarisizlar ayri ve nedeniyle', async () => {
    const { svc, row, kv } = setup((target) => (target.endsWith('~2') ? { ok: true } : { ok: false, error: EU_REASON }));
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 1, pausedAds: 1 });
    expect(row.autopilotActions).toEqual([
      expect.objectContaining({ action: 'ab-test-winner', pausedCount: 1, failedCount: 1, pausedAdIds: ['2'], reason: EU_REASON }),
    ]);
    expect(Object.keys(kv.ledger())).toEqual([variants[1].target]);
  });

  it('sonucu bilinmeyen yazim (istisna / uncertain) "duraklatılamadı" sayilmaz; defterde kalir', async () => {
    const { svc, row, adsClient, kv } = setup(() => ({ ok: true }));
    adsClient.setAdStatus.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: false, uncertain: true });
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    expect(row.autopilotActions).toEqual([
      expect.objectContaining({ action: 'ab-test-winner', pausedCount: 0, failedCount: 0, uncertainCount: 2 }),
    ]);
    expect(Object.keys(kv.ledger())).toHaveLength(2);
    // Sonraki tur: ikisi hala etkin gorunse de (belki duraklatilmadi) bir daha dokunulmaz
    adsClient.setAdStatus.mockClear();
    await svc.pickWinners();
    expect(adsClient.setAdStatus).not.toHaveBeenCalled();
  });

  it('yalniz kazanan kaldiysa (kaybedenler zaten duraklatilmis) islem ve kayit yok', async () => {
    const { svc, row, adsClient } = setup(() => ({ ok: true }), [variants[0]]);
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    expect(adsClient.setAdStatus).not.toHaveBeenCalled();
    expect(row.autopilotActions).toBeNull();
  });

  it('iki grupta duraklatma: her grup icin ayri kayit (gecmis hangi grubun reklam kaybettigini soyler)', async () => {
    const ads = [
      v('11', 120, { groupId: '1', groupName: 'Marka' }), v('12', 40, { groupId: '1', groupName: 'Marka' }),
      v('21', 100, { groupId: '2', groupName: 'Genel' }), v('22', 30, { groupId: '2', groupName: 'Genel' }),
    ];
    const { svc, row } = setup(() => ({ ok: true }), ads);
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 2, pausedAds: 2 });
    expect(row.autopilotActions.map((e: any) => [e.groupName, e.winnerAdId, e.pausedAdIds])).toEqual([['Marka', '11', ['12']], ['Genel', '21', ['22']]]);
  });
});

/**
 * n reklam grubu; her grupta bir kazanan (%6) ve `losers` adet geride kalan
 * (%2, anlamli fark). Kimlikler: kazanan g*100, geride kalanlar g*100+i.
 */
function manyGroups(n: number, losers = 1): AdVariant[] {
  const out: AdVariant[] = [];
  for (let g = 1; g <= n; g++) {
    const grp = { groupId: String(g), groupName: `Grup ${g}` };
    out.push(v(String(g * 100), 120, grp));
    for (let i = 1; i <= losers; i++) out.push(v(String(g * 100 + i), 40, grp));
  }
  return out;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Diger otopilot adimlarinin eski kayitlari (budget-shifter bicimi) */
const otherSteps = (n: number) => range(1, n).map((i) => ({
  time: new Date(Date.UTC(2026, 8, 1, i)).toISOString(), action: 'budget-shift-in', budgetBefore: 100 + i, budgetAfter: 110 + i,
}));

describe('pickWinners — gecmis siniri: cok grupta duraklatma (S10 yan etkisi)', () => {
  it('25 grupta duraklatma: tur en fazla AB_HISTORY_RUN_MAX kayit yazar, kalan 16 grup tek ozet kayitta; her onayli kimlik gecmiste; diger adimlarin kayitlarinin yarisi kalir', async () => {
    // Eskiden grup basina 25 kayit + slice(-20): 5 grubun duraklatmasi ve kimlikleri hic yazilmiyor,
    // diger adimlarin 20 eski kaydinin hepsi siliniyordu
    expect(AB_HISTORY_RUN_MAX).toBe(10);
    const older = otherSteps(20);
    const { svc, row } = setup(() => ({ ok: true }), manyGroups(25), { autopilotActions: older });
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 25, pausedAds: 25 });

    const hist: any[] = row.autopilotActions;
    expect(hist).toHaveLength(20);
    expect(hist.slice(0, 10)).toEqual(older.slice(10));
    const run = hist.slice(10);
    expect(run.slice(0, 9).map((e) => [e.groupId, e.groupName, e.pausedAdIds])).toEqual(range(1, 9).map((g) => [String(g), `Grup ${g}`, [String(g * 100 + 1)]]));
    // Ozet: tek grup degil, bu yuzden groupId / grup adi / kazanan yok; sayilar toplam, kimlikler eksiksiz
    expect(run[9]).toEqual({
      time: run[0].time,
      action: 'ab-test-winner',
      groupCount: 16,
      groupIds: range(10, 25).map(String),
      pausedCount: 16,
      failedCount: 0,
      pausedAdIds: range(10, 25).map((g) => String(g * 100 + 1)),
    });
    const findable = run.flatMap((e) => e.pausedAdIds ?? []);
    expect([...findable].sort()).toEqual(range(1, 25).map((g) => String(g * 100 + 1)).sort());
  });

  it('sinir: tam AB_HISTORY_RUN_MAX grup ayri ayri yazilir; bir fazlasinda son iki grup ozette birlesir', async () => {
    let s = setup(() => ({ ok: true }), manyGroups(AB_HISTORY_RUN_MAX));
    await s.svc.pickWinners();
    expect(s.row.autopilotActions.map((e: any) => e.groupId)).toEqual(range(1, AB_HISTORY_RUN_MAX).map(String));
    expect(s.row.autopilotActions.some((e: any) => 'groupCount' in e)).toBe(false);

    s = setup(() => ({ ok: true }), manyGroups(AB_HISTORY_RUN_MAX + 1));
    await s.svc.pickWinners();
    const hist: any[] = s.row.autopilotActions;
    expect(hist).toHaveLength(AB_HISTORY_RUN_MAX);
    expect(hist[AB_HISTORY_RUN_MAX - 1]).toMatchObject({ action: 'ab-test-winner', groupCount: 2, groupIds: ['10', '11'], pausedCount: 2, pausedAdIds: ['1001', '1101'] });
    expect(hist[AB_HISTORY_RUN_MAX - 1]).not.toHaveProperty('groupId');
  });

  it('grup kaydinda 10\'dan fazla onayli kimlik: ilk 10 yazilir ve pausedAdIdsTotal tamaminin sayisini soyler', async () => {
    const { svc, row } = setup(() => ({ ok: true }), manyGroups(1, 12));
    await svc.pickWinners();
    expect(row.autopilotActions).toEqual([expect.objectContaining({
      groupId: '1', pausedCount: 12, pausedAdIds: range(101, 110).map(String), pausedAdIdsTotal: 12,
    })]);
    expect(AB_HISTORY_GROUP_IDS_MAX).toBe(10);
    // Kesilmeyen listede alan yok (panel "ilk N" demesin)
    const tam = setup(() => ({ ok: true }), manyGroups(1, AB_HISTORY_GROUP_IDS_MAX));
    await tam.svc.pickWinners();
    expect(tam.row.autopilotActions[0].pausedAdIds).toHaveLength(AB_HISTORY_GROUP_IDS_MAX);
    expect(tam.row.autopilotActions[0]).not.toHaveProperty('pausedAdIdsTotal');
  });

  it('ozet kayit sinirli: kimlik ve grup listesi AB_HISTORY_SUMMARY_IDS_MAX\'ta kesilir; pausedAdIdsTotal ve groupCount tamamini soyler', async () => {
    const { svc, row } = setup(() => ({ ok: true }), manyGroups(120));
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 120, pausedAds: 120 });
    const hist: any[] = row.autopilotActions;
    expect(hist).toHaveLength(AB_HISTORY_RUN_MAX);
    const ozet = hist[AB_HISTORY_RUN_MAX - 1];
    expect(ozet).toMatchObject({ groupCount: 111, pausedCount: 111, pausedAdIdsTotal: 111 });
    expect(ozet.groupIds).toEqual(range(10, 9 + AB_HISTORY_SUMMARY_IDS_MAX).map(String));
    expect(ozet.pausedAdIds).toEqual(range(10, 9 + AB_HISTORY_SUMMARY_IDS_MAX).map((g) => String(g * 100 + 1)));
  });

  it('ayri kayit onceligi onayli / belirsiz duraklatmalarda; ozet toplamlari, belirsizler ve platformun ilk nedeni', async () => {
    // 12 grup: 1-3 hic duraklatilamadi, 4'te sonuc bilinmiyor, 5'te biri onaylandi biri reddedildi, digerleri onayli
    const ads = manyGroups(12).concat(v('502', 40, { groupId: '5', groupName: 'Grup 5' }));
    const { svc, row, kv } = setup((target) => {
      const [g, ad] = target.split('/').pop()!.split('~');
      if (Number(g) <= 3) return { ok: false, error: EU_REASON };
      if (g === '4') return { ok: false, uncertain: true };
      if (ad === '502') return { ok: false, error: 'policy' };
      return { ok: true };
    }, ads);
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 8, pausedAds: 8 });
    const hist: any[] = row.autopilotActions;
    expect(hist).toHaveLength(AB_HISTORY_RUN_MAX);
    // Ayri kayitlar: duraklatmasi onaylanan / belirsiz gruplar once (4..12); hic duraklatilamayanlar ozette
    expect(hist.slice(0, 9).map((e) => e.groupId)).toEqual(range(4, 12).map(String));
    expect(hist[0]).toMatchObject({ groupId: '4', pausedCount: 0, failedCount: 0, uncertainCount: 1 });
    expect(hist[1]).toMatchObject({ groupId: '5', pausedCount: 1, failedCount: 1, pausedAdIds: ['501'], reason: 'policy' });
    expect(hist[9]).toEqual({ time: hist[0].time, action: 'ab-test-pause-failed', groupCount: 3, groupIds: ['1', '2', '3'], failedCount: 3, reason: EU_REASON });
    // Reddedilenler defterden silindi (yeniden denenebilir); belirsiz olan defterde kalir
    expect(Object.keys(kv.ledger())).toContain('customers/1/adGroupAds/4~401');
    expect(Object.keys(kv.ledger())).not.toContain('customers/1/adGroupAds/1~101');
  });

  it('ozette onayli ve belirsiz sonuc da varsa ozet "ab-test-winner": toplam sayilar ve onaylanan tum kimlikler', async () => {
    // 13 grup: 1 ve 2 hic duraklatilamadi, 12'de sonuc bilinmiyor, digerleri onayli; 9 ayri kayit 3..11'e gider
    const { svc, row } = setup((target) => {
      const g = Number(target.split('/').pop()!.split('~')[0]);
      if (g <= 2) return { ok: false, error: EU_REASON };
      if (g === 12) return { ok: false, uncertain: true };
      return { ok: true };
    }, manyGroups(13));
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 10, pausedAds: 10 });
    const hist: any[] = row.autopilotActions;
    expect(hist.slice(0, 9).map((e) => e.groupId)).toEqual(range(3, 11).map(String));
    expect(hist[9]).toEqual({
      time: hist[0].time, action: 'ab-test-winner', groupCount: 4, groupIds: ['12', '13', '1', '2'],
      pausedCount: 1, failedCount: 2, uncertainCount: 1, pausedAdIds: ['1301'], reason: EU_REASON,
    });
  });

  it('ozete giren ayni basarisizlik sonraki turlarda yeniden yazilmaz (gecmis her 6 saatte dolmasin)', async () => {
    const { svc, row, prisma } = setup(() => ({ ok: false, error: EU_REASON }), manyGroups(25));
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    expect(row.autopilotActions).toHaveLength(AB_HISTORY_RUN_MAX);
    expect(row.autopilotActions[AB_HISTORY_RUN_MAX - 1]).toMatchObject({ action: 'ab-test-pause-failed', groupCount: 16, failedCount: 16, reason: EU_REASON });
    await svc.pickWinners();
    await svc.pickWinners();
    expect(row.autopilotActions).toHaveLength(AB_HISTORY_RUN_MAX);
    expect(prisma.adCampaign.update).toHaveBeenCalledTimes(1);

    // Neden degisirse yeni bilgi: yeniden yazilir
    const other = setup(() => ({ ok: false, error: EU_REASON }), manyGroups(25));
    await other.svc.pickWinners();
    other.adsClient.setAdStatus.mockImplementation(async () => ({ ok: false, error: 'Hesap askıya alındı.' }));
    await other.svc.pickWinners();
    expect(other.row.autopilotActions.slice(AB_HISTORY_RUN_MAX).map((e: any) => e.reason)).toEqual(Array(AB_HISTORY_RUN_MAX).fill('Hesap askıya alındı.'));
  });
});

describe('pickWinners — emin olunmayan her durumda hicbir sey yapilmaz (S10)', () => {
  it('kampanya platformda yayinda degil ya da durumu okunamadi: reklamlar okunmaz, dokunulmaz', async () => {
    for (const live of [
      { ok: false },
      { ok: true, live: { status: 'PAUSED', platformStatus: 'PAUSED', budgetType: 'daily', amount: 100 } },
      { ok: true, live: { status: 'OTHER', platformStatus: 'ENABLED/ENDED', budgetType: 'daily', amount: 100 } },
    ]) {
      const { svc, adsClient, row } = setup(() => ({ ok: true }));
      adsClient.getLiveBudget.mockResolvedValue(live);
      await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
      expect(adsClient.getAdVariants).not.toHaveBeenCalled();
      expect(adsClient.setAdStatus).not.toHaveBeenCalled();
      expect(row.autopilotActions).toBeNull();
    }
  });

  it('reklam satirlari okunamadi (null): dokunulmaz', async () => {
    const { svc, adsClient } = setup(() => ({ ok: true }), null);
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    expect(adsClient.setAdStatus).not.toHaveBeenCalled();
  });

  it('defter okunamadi ya da bozuk: dokunulmaz (musterinin yeniden actigi reklam taninamazdi)', async () => {
    const bad = fakeKv({ [LEDGER_KEY]: '{bozuk' });
    let s = setup(() => ({ ok: true }), variants, {}, bad);
    await s.svc.pickWinners();
    expect(s.adsClient.setAdStatus).not.toHaveBeenCalled();

    const down = fakeKv();
    down.state.failRead = true;
    s = setup(() => ({ ok: true }), variants, {}, down);
    await s.svc.pickWinners();
    expect(s.adsClient.setAdStatus).not.toHaveBeenCalled();
  });

  it('duraklatma niyeti deftere yazilamazsa duraklatma yapilmaz', async () => {
    const kv = fakeKv();
    kv.state.failWrite = true;
    const { svc, adsClient, row } = setup(() => ({ ok: true }), variants, {}, kv);
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    expect(adsClient.setAdStatus).not.toHaveBeenCalled();
    expect(row.autopilotActions).toBeNull();
  });

  it('musterinin yeniden actigi reklam (defterde, ama etkin) bir daha duraklatilmaz', async () => {
    const kv = fakeKv({ [LEDGER_KEY]: JSON.stringify({ v: 1, paused: { [variants[1].target]: '2026-10-01T00:00:00.000Z', [variants[2].target]: '2026-10-01T00:00:00.000Z' } }) });
    const { svc, adsClient, row } = setup(() => ({ ok: true }), variants, {}, kv);
    await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 0, pausedAds: 0 });
    expect(adsClient.setAdStatus).not.toHaveBeenCalled();
    expect(row.autopilotActions).toBeNull();
  });

  it('defter doluysa yeni duraklatma yapilmaz (eski kayit silinip yeniden acilan reklam unutulmaz)', async () => {
    const paused: Record<string, string> = {};
    for (let i = 0; i < AB_LEDGER_MAX; i++) paused[`customers/1/adGroupAds/8~${1000 + i}`] = '2026-10-01T00:00:00.000Z';
    const kv = fakeKv({ [LEDGER_KEY]: JSON.stringify({ v: 1, paused }) });
    const { svc, adsClient } = setup(() => ({ ok: true }), variants, {}, kv);
    await svc.pickWinners();
    expect(adsClient.setAdStatus).not.toHaveBeenCalled();
  });
});

describe('R18 — A/B uygunlugu gercekten yazilan baslangic tarihine dayanir', () => {
  it('baslangic tarihi bos (NULL) ya da 7 gunden yeni kampanya incelenmez', async () => {
    for (const startDate of [null, new Date(Date.now() - 3 * 86_400_000)]) {
      const { svc, adsClient } = setup(() => ({ ok: true }), variants, { startDate });
      await expect(svc.pickWinners()).resolves.toEqual({ analyzed: 0, winnersChosen: 0, pausedAds: 0 });
      expect(adsClient.getAdVariants).not.toHaveBeenCalled();
    }
  });

  it('uctan uca: performance-sync platformda yayinda gordugu kampanyaya baslangic yazar; A/B 7 gun sonra calisir', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-01T06:00:00Z'));
      // Eski kayit: sihirbazdan kalma, startDate hic yazilmamis (uretimdeki tum satirlar boyle)
      const row: any = { id: 'c1', siteId: 's1', platform: 'google_ads', externalId: '555', status: 'ACTIVE', autopilotActions: null, startDate: null, budgetType: 'daily', budgetAmount: 500 };
      const site = { id: 's1', googleAdsRefreshToken: 'r', googleAdsCustomerId: '1' };
      const kv = fakeKv();
      const prisma: any = {
        site: { findMany: vi.fn(async () => [site]) },
        adCampaign: {
          findMany: vi.fn(async ({ where }: any) => (sqlWhereMatch(row, where) ? [{ ...row, site }] : [])),
          update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return row; }),
        },
        kvStore: kv.kvStore,
      };
      let serving = false;
      const adsClient: any = {
        getMetrics: vi.fn(async () => null),
        getLiveBudget: vi.fn(async () => ({
          ok: true,
          live: serving
            ? { status: 'ACTIVE', platformStatus: 'ENABLED', budgetType: 'daily', amount: 500 }
            : { status: 'OTHER', platformStatus: 'ENABLED/PENDING', budgetType: 'daily', amount: 500 },
        })),
        getAdVariants: vi.fn(async () => variants),
        setAdStatus: vi.fn(async () => ({ ok: true })),
      };
      const sync = new PerformanceSyncService(prisma, adsClient);
      const ab = new AbTestManagerService(prisma, adsClient);

      // Platformda henuz yayinda degil (baslamamis): baslangic yazilmaz
      await sync.syncAllActive();
      expect(row.startDate).toBeNull();

      serving = true;
      await sync.syncAllActive();
      expect(row.startDate).toEqual(new Date('2026-10-01T06:00:00Z'));
      await expect(ab.pickWinners()).resolves.toEqual({ analyzed: 0, winnersChosen: 0, pausedAds: 0 });

      // Sonraki senkronlar ilk gorulme anini degistirmez
      vi.setSystemTime(new Date('2026-10-05T06:00:00Z'));
      await sync.syncAllActive();
      expect(row.startDate).toEqual(new Date('2026-10-01T06:00:00Z'));

      vi.setSystemTime(new Date('2026-10-08T07:00:00Z'));
      await expect(ab.pickWinners()).resolves.toEqual({ analyzed: 1, winnersChosen: 1, pausedAds: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
});
