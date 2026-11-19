import { describe, it, expect } from 'vitest';
import {
  GOOGLE_SNAPSHOT_QUERIES,
  buildGoogleSnapshot,
  mapAdStrength,
  mapCampaigns,
  mapConversionActions,
  mapExtensionCounts,
  mapGeoTargetType,
  mapKeywords,
  mapNegativeLists,
  mapRsa,
  mapSearchTerms,
  type GoogleReadResults,
} from './google-snapshot-map.js';

/**
 * Kampanya Skoru snapshot'i yalniz musteri hesabindan okunan GAQL satirlarindan
 * kurulur; okunamayan alan undefined kalir (eskiden varsayilanla doluyordu).
 * Satirlar REST JSON bicimindedir (lowerCamelCase, int64 dize).
 */

const campaignRow = (id: string, over: Record<string, any> = {}) => ({
  campaign: {
    id,
    name: `Kampanya ${id}`,
    servingStatus: 'SERVING',
    advertisingChannelType: 'SEARCH',
    biddingStrategyType: 'MAXIMIZE_CONVERSIONS',
    networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false },
    geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE' },
    ...over,
  },
  campaignBudget: { amountMicros: '25000000', period: 'DAILY' },
});

describe('GAQL sorgulari', () => {
  it('yalniz okuma (SELECT) ve metrikli sorgular son 30 gun', () => {
    for (const [k, q] of Object.entries(GOOGLE_SNAPSHOT_QUERIES)) {
      expect(q.startsWith('SELECT '), k).toBe(true);
      if (/metrics\./.test(q)) expect(q, k).toContain('DURING LAST_30_DAYS');
    }
  });
});

describe('alan esleyicileri', () => {
  it('kampanya: butce mikro → tutar, teklif stratejisi, ag, konum hedefi', () => {
    const [c] = mapCampaigns([campaignRow('11')]);
    expect(c).toMatchObject({
      id: '11', name: 'Kampanya 11', objective: 'SEARCH', budget: 25, bidStrategy: 'MAXIMIZE_CONVERSIONS',
      network: { search: true, searchPartners: true, display: false }, geoTargeting: 'people_in',
    });
  });

  it('konum hedefi: PRESENCE_OR_INTEREST → interest, bilinmeyen → undefined', () => {
    expect(mapGeoTargetType('PRESENCE')).toBe('people_in');
    expect(mapGeoTargetType('PRESENCE_OR_INTEREST')).toBe('interest');
    expect(mapGeoTargetType('UNSPECIFIED')).toBeUndefined();
    expect(mapGeoTargetType(undefined)).toBeUndefined();
  });

  it('kampanya: okunmayan alan varsayilan almaz; Display kampanyada ag ayari yok; bitmis kampanya disarida', () => {
    const rows = [
      { campaign: { id: '1', advertisingChannelType: 'DISPLAY', networkSettings: { targetContentNetwork: true } } },
      campaignRow('2', { servingStatus: 'ENDED' }),
      { campaign: { id: '3', advertisingChannelType: 'SEARCH', biddingStrategyType: 'UNKNOWN' }, campaignBudget: { period: 'CUSTOM_PERIOD', totalAmountMicros: '1000000000' } },
    ];
    const cs = mapCampaigns(rows);
    expect(cs.map((c) => c.id)).toEqual(['1', '3']);
    expect(cs[0].network).toBeUndefined();
    expect(cs[0].geoTargeting).toBeUndefined();
    expect(cs[0].budget).toBeUndefined();
    expect(cs[0].bidStrategy).toBeUndefined();
    // toplam butceli kampanyada gunluk tutar yok
    expect(cs[1].budget).toBeUndefined();
    expect(cs[1].bidStrategy).toBeUndefined();
  });

  it('donusum islemleri: primary_for_goal ve kucuk harf durum', () => {
    expect(mapConversionActions([
      { conversionAction: { id: '5', status: 'ENABLED', primaryForGoal: true } },
      { conversionAction: { id: '6', status: 'HIDDEN', primaryForGoal: false } },
    ])).toEqual([
      { id: '5', primary: true, status: 'enabled' },
      { id: '6', primary: false, status: 'hidden' },
    ]);
    expect(mapConversionActions([])).toEqual([]);
  });

  it('arama terimleri reklam grubu satirlarindan terim bazinda toplanir, harcamaya gore siralanir', () => {
    expect(mapSearchTerms([
      { searchTermView: { searchTerm: 'ucuz hosting' }, metrics: { costMicros: '4000000', conversions: 0 } },
      { searchTermView: { searchTerm: 'web hosting' }, metrics: { costMicros: '9000000', conversions: 2 } },
      { searchTermView: { searchTerm: 'ucuz hosting' }, metrics: { costMicros: '7000000', conversions: 1 } },
    ])).toEqual([
      { term: 'ucuz hosting', cost: 11, conversions: 1 },
      { term: 'web hosting', cost: 9, conversions: 2 },
    ]);
  });

  it('negatif listeler: kampanyaya bagliysa campaign, degilse ya da baglanti okunamadiysa null', () => {
    const sets = [{ sharedSet: { id: '7', name: 'Rakipler' } }, { sharedSet: { id: '8', name: 'İş ilanları' } }];
    const links = [{ campaignSharedSet: { sharedSet: 'customers/123/sharedSets/7', campaign: 'customers/123/campaigns/1' } }];
    expect(mapNegativeLists(sets, links)).toEqual([
      { name: 'Rakipler', appliedScope: 'campaign' },
      { name: 'İş ilanları', appliedScope: null },
    ]);
    expect(mapNegativeLists(sets, null).every((l) => l.appliedScope === null)).toBe(true);
  });

  it('reklam gucu: EXCELLENT/GOOD/AVERAGE/POOR; digerleri undefined', () => {
    expect(mapAdStrength('EXCELLENT')).toBe('excellent');
    expect(mapAdStrength('GOOD')).toBe('good');
    expect(mapAdStrength('AVERAGE')).toBe('average');
    expect(mapAdStrength('POOR')).toBe('poor');
    for (const v of ['UNSPECIFIED', 'UNKNOWN', 'PENDING', 'NO_ADS', undefined]) expect(mapAdStrength(v)).toBeUndefined();
  });

  it('RSA: kampanya basina ortalama baslik / aciklama, en sik reklam gucu, gercek metin ornekleri', () => {
    const ad = (h: number, d: number, strength: string) => ({
      campaign: { id: '1' },
      adGroupAd: {
        adStrength: strength,
        ad: { responsiveSearchAd: {
          headlines: Array.from({ length: h }, (_, i) => ({ text: `Başlık ${i}` })),
          descriptions: Array.from({ length: d }, (_, i) => ({ text: `Açıklama ${i}` })),
        } },
      },
    });
    const { byCampaign, adCopySamples } = mapRsa([ad(10, 4, 'GOOD'), ad(6, 2, 'GOOD'), ad(3, 2, 'POOR')]);
    expect(byCampaign.get('1')).toEqual({ count: 3, headlines: 6, descriptions: 3, adStrength: 'good' });
    expect(adCopySamples[0]).toEqual({ headline: 'Başlık 0', description: 'Açıklama 0' });
    // reklam gucu okunmayan reklamlar
    expect(mapRsa([ad(5, 2, 'PENDING')]).byCampaign.get('1')?.adStrength).toBeUndefined();
  });

  it('uzantilar: hesap / kampanya / reklam grubu seviyelerinin en buyugu', () => {
    const m = mapExtensionCounts(
      ['1', '2'],
      [{ customerAsset: { fieldType: 'SITELINK' } }, { customerAsset: { fieldType: 'SITELINK' } }],
      [
        { campaign: { id: '1' }, campaignAsset: { fieldType: 'SITELINK' } },
        { campaign: { id: '1' }, campaignAsset: { fieldType: 'SITELINK' } },
        { campaign: { id: '1' }, campaignAsset: { fieldType: 'SITELINK' } },
        { campaign: { id: '1' }, campaignAsset: { fieldType: 'CALLOUT' } },
      ],
      [
        { adGroup: { id: '9', campaign: 'customers/123/campaigns/2' }, adGroupAsset: { fieldType: 'STRUCTURED_SNIPPET' } },
      ],
    );
    expect(m.get('1')).toEqual({ sitelinks: 3, callouts: 1, structuredSnippets: 0 });
    expect(m.get('2')).toEqual({ sitelinks: 2, callouts: 0, structuredSnippets: 1 });
  });

  it('anahtar kelime: gosterimle agirlikli QS, QS<=3 payi, eslesme turu payi', () => {
    const kw = (qs: number | undefined, imp: string, matchType: string) => ({
      campaign: { id: '1' },
      adGroupCriterion: { keyword: { matchType }, ...(qs !== undefined ? { qualityInfo: { qualityScore: qs } } : {}) },
      metrics: { impressions: imp },
    });
    const m = mapKeywords([kw(8, '300', 'EXACT'), kw(2, '100', 'BROAD'), kw(undefined, '50', 'PHRASE'), kw(6, '0', 'PHRASE')]);
    expect(m.get('1')?.qualityScore).toEqual({ weighted: 6.5, criticalPct: 33.3 });
    expect(m.get('1')?.matchTypeMix).toEqual({ exact: 25, phrase: 50, broad: 25 });
    // QS hic yoksa qualityScore verilmez
    expect(mapKeywords([kw(undefined, '10', 'EXACT')]).get('1')?.qualityScore).toBeUndefined();
  });
});

describe('buildGoogleSnapshot', () => {
  const full = (): GoogleReadResults => ({
    currency: [{ customer: { currencyCode: 'TRY' } }],
    accountSpend: [{ metrics: { costMicros: '1234560000' } }],
    campaigns: [campaignRow('1'), campaignRow('2', { advertisingChannelType: 'PERFORMANCE_MAX', networkSettings: undefined })],
    campaignMetrics: [{ campaign: { id: '1' }, metrics: { costMicros: '1000000' } }, { campaign: { id: '2' }, metrics: { costMicros: '9000000' } }],
    conversionActions: [],
    searchTerms: [],
    negativeLists: [],
    negativeListLinks: [],
    rsa: [],
    customerAssets: [],
    campaignAssets: [],
    adGroupAssets: [],
    keywords: [],
  });

  it('hepsi okununca: para birimi, harcama, bos listeler gercek veri; kampanyalar harcamaya gore', () => {
    const { snapshot, readErrors } = buildGoogleSnapshot(full());
    expect(readErrors).toEqual([]);
    expect(snapshot.currency).toBe('TRY');
    expect(snapshot.monthlySpend).toBe(1234.56);
    // kur donusumu yok: USD disi hesapta USD alan bos
    expect(snapshot.monthlySpendUsd).toBeUndefined();
    expect(snapshot.conversionActions).toEqual([]);
    expect(snapshot.negativeKeywordLists).toEqual([]);
    expect(snapshot.campaigns?.map((c) => c.id)).toEqual(['2', '1']);
    // arama kampanyasinda uzanti sayisi okundu (0), PMax'ta verilmez
    const search = snapshot.campaigns?.find((c) => c.id === '1');
    const pmax = snapshot.campaigns?.find((c) => c.id === '2');
    expect(search?.sitelinks).toBe(0);
    expect(pmax?.sitelinks).toBeUndefined();
    // RSA'si yok → rsa ozeti yok (uydurma "1 reklam, average" degil)
    expect(search?.rsa).toBeUndefined();
    expect(snapshot.campaignNamingSamples).toEqual(['Kampanya 2', 'Kampanya 1']);
  });

  it('USD hesapta monthlySpendUsd dolar', () => {
    const r = full();
    r.currency = [{ customer: { currencyCode: 'USD' } }];
    expect(buildGoogleSnapshot(r).snapshot.monthlySpendUsd).toBe(1234.56);
  });

  it('dusen sorgu yalniz kendi alanlarini bos birakir ve readErrors\'a girer', () => {
    const r = full();
    r.conversionActions = null;
    r.adGroupAssets = null;
    delete r.keywords;
    const { snapshot, readErrors } = buildGoogleSnapshot(r);
    expect(snapshot.conversionActions).toBeUndefined();
    expect(snapshot.campaigns?.find((c) => c.id === '1')?.sitelinks).toBeUndefined();
    expect(snapshot.campaigns?.length).toBe(2);
    expect(readErrors).toEqual(expect.arrayContaining(['Dönüşüm işlemleri', 'Reklam grubu uzantıları', 'Anahtar kelimeler ve kalite puanı']));
  });

  it('hicbir sey okunamazsa snapshot bos (uydurma alan yok)', () => {
    const { snapshot, readErrors } = buildGoogleSnapshot({});
    expect(Object.values(snapshot).filter((v) => v !== undefined)).toEqual([]);
    expect(readErrors.length).toBe(Object.keys(GOOGLE_SNAPSHOT_QUERIES).length);
  });
});
