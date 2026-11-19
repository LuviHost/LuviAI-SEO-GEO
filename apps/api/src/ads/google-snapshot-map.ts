/**
 * Kampanya Skoru icin Google Ads hesabindan okunan GAQL satirlari →
 * AccountSnapshot. Saf fonksiyonlar (IO yok); sorgular snapshot-collector'da
 * GoogleAdsClientService.queryEach ile tek erisimle calisir.
 *
 * KURAL: okunamayan alan undefined kalir (kural 'na' doner). Eskiden toplayici
 * RanksUp'in kendi kampanya tablosundan okuyup eksikleri varsayilanla
 * dolduruyordu ('people_in', adStrength 'average', sitelink 0 ...); musteri
 * hesabina dayanmayan bulgular cikiyordu. Okunmus bos liste (ornegin hesapta
 * hic donusum islemi yok) gercek veridir.
 *
 * Alan adlari Google Ads API v26 (google-ads-api.ts GOOGLE_ADS_API_VERSION)
 * kaynak referansindan: https://developers.google.com/google-ads/api/fields/v26/overview
 * REST JSON cevabinda alan adlari lowerCamelCase gelir (campaign.networkSettings
 * .targetGoogleSearch), int64 alanlar (costMicros, impressions) dize olarak.
 * Sorgular yalniz OKUR (googleAds:search); hesapta hicbir sey degistirilmez.
 */
import type { AccountSnapshot } from './rules/types.js';

type Campaign = NonNullable<AccountSnapshot['campaigns']>[number];
type AdStrength = NonNullable<NonNullable<Campaign['rsa']>['adStrength']>;

const EXTENSION_TYPES = `('SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET')`;

/**
 * Her sorgu bagimsiz: biri duserse yalniz onun alanlari undefined kalir.
 * Tarih araligi metriklerde son 30 gun (segments.date WHERE'de, SELECT'te
 * degil: satirlar donem icin toplanir).
 */
export const GOOGLE_SNAPSHOT_QUERIES = {
  currency: 'SELECT customer.currency_code FROM customer LIMIT 1',
  accountSpend: 'SELECT metrics.cost_micros FROM customer WHERE segments.date DURING LAST_30_DAYS',
  // Metriksiz: son 30 gunde gosterim almayan etkin kampanyalar da gelsin
  campaigns:
    'SELECT campaign.id, campaign.name, campaign.serving_status, campaign.advertising_channel_type, campaign.bidding_strategy_type, ' +
    'campaign.network_settings.target_google_search, campaign.network_settings.target_search_network, ' +
    'campaign.network_settings.target_content_network, campaign.geo_target_type_setting.positive_geo_target_type, ' +
    'campaign_budget.amount_micros, campaign_budget.period ' +
    "FROM campaign WHERE campaign.status = 'ENABLED'",
  campaignMetrics:
    'SELECT campaign.id, metrics.cost_micros FROM campaign ' +
    "WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS",
  conversionActions:
    'SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.primary_for_goal ' +
    "FROM conversion_action WHERE conversion_action.status != 'REMOVED'",
  searchTerms:
    'SELECT search_term_view.search_term, metrics.cost_micros, metrics.conversions FROM search_term_view ' +
    'WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.cost_micros DESC LIMIT 1000',
  negativeLists:
    'SELECT shared_set.id, shared_set.name FROM shared_set ' +
    "WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'",
  negativeListLinks:
    'SELECT campaign_shared_set.shared_set, campaign_shared_set.campaign FROM campaign_shared_set ' +
    "WHERE campaign_shared_set.status = 'ENABLED'",
  rsa:
    'SELECT campaign.id, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ' +
    'ad_group_ad.ad_strength FROM ad_group_ad ' +
    "WHERE ad_group_ad.status = 'ENABLED' AND ad_group.status = 'ENABLED' AND campaign.status = 'ENABLED' " +
    "AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'",
  // Uzanti sayisi uc seviyede: hesap, kampanya, reklam grubu (bkz. mapExtensionCounts)
  customerAssets:
    'SELECT customer_asset.field_type FROM customer_asset ' +
    `WHERE customer_asset.status = 'ENABLED' AND customer_asset.field_type IN ${EXTENSION_TYPES}`,
  campaignAssets:
    'SELECT campaign.id, campaign_asset.field_type FROM campaign_asset ' +
    `WHERE campaign_asset.status = 'ENABLED' AND campaign_asset.field_type IN ${EXTENSION_TYPES}`,
  adGroupAssets:
    'SELECT ad_group.id, ad_group.campaign, ad_group_asset.field_type FROM ad_group_asset ' +
    `WHERE ad_group_asset.status = 'ENABLED' AND ad_group_asset.field_type IN ${EXTENSION_TYPES}`,
  // Son 30 gunde gosterim alan etkin anahtar kelimeler (agirlik gosterimle)
  keywords:
    'SELECT campaign.id, ad_group_criterion.keyword.match_type, ad_group_criterion.quality_info.quality_score, metrics.impressions ' +
    "FROM keyword_view WHERE segments.date DURING LAST_30_DAYS AND ad_group_criterion.status = 'ENABLED' " +
    "AND ad_group.status = 'ENABLED' AND campaign.status = 'ENABLED'",
} as const;

export type GoogleQueryKey = keyof typeof GOOGLE_SNAPSHOT_QUERIES;
/** Sorgu sonucu: satirlar, ya da null (sorgu basarisiz → alan okunamadi) */
export type GoogleReadResults = Partial<Record<GoogleQueryKey, any[] | null>>;

/** Panelde "okunamadı" listesi icin kisa, musteriye gosterilebilir adlar */
export const GOOGLE_QUERY_LABELS: Record<GoogleQueryKey, string> = {
  currency: 'Para birimi',
  accountSpend: 'Hesap harcaması',
  campaigns: 'Kampanyalar',
  campaignMetrics: 'Kampanya harcamaları',
  conversionActions: 'Dönüşüm işlemleri',
  searchTerms: 'Arama terimleri',
  negativeLists: 'Negatif anahtar kelime listeleri',
  negativeListLinks: 'Negatif liste bağlantıları',
  rsa: 'Duyarlı arama reklamları',
  customerAssets: 'Hesap uzantıları',
  campaignAssets: 'Kampanya uzantıları',
  adGroupAssets: 'Reklam grubu uzantıları',
  keywords: 'Anahtar kelimeler ve kalite puanı',
};

// ─── Kucuk ayristiricilar ────────────────────────────────────────

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** int64 / double (JSON'da dize ya da sayi) → sonlu, negatif olmayan sayi */
function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const micros = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : n / 1_000_000;
};

/** Enum degeri; UNSPECIFIED / UNKNOWN bilinmiyor sayilir */
function enumVal(v: unknown): string | undefined {
  const s = str(v);
  return s && s !== 'UNSPECIFIED' && s !== 'UNKNOWN' ? s : undefined;
}

/** customers/{cid}/campaigns/{id} → id */
const lastId = (rn: unknown): string | undefined => {
  const m = typeof rn === 'string' ? /\/(\d+)$/.exec(rn) : null;
  return m ? m[1] : undefined;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

// ─── Esleyiciler ────────────────────────────────────────────────

export function mapCurrency(rows: any[]): string | undefined {
  const code = rows[0]?.customer?.currencyCode;
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : undefined;
}

/** Hesabin son 30 gun harcamasi (hesap para biriminde); satir yoksa 0 */
export function mapAccountSpend(rows: any[]): number {
  return rows.reduce((a, r) => a + (micros(r?.metrics?.costMicros) ?? 0), 0);
}

/** campaign.geo_target_type_setting.positive_geo_target_type → snapshot */
export function mapGeoTargetType(v: unknown): Campaign['geoTargeting'] {
  if (v === 'PRESENCE') return 'people_in';
  if (v === 'PRESENCE_OR_INTEREST') return 'interest';
  return undefined;
}

/** ad_group_ad.ad_strength → snapshot; PENDING / NO_ADS / UNSPECIFIED / UNKNOWN → undefined */
export function mapAdStrength(v: unknown): AdStrength | undefined {
  switch (v) {
    case 'EXCELLENT': return 'excellent';
    case 'GOOD': return 'good';
    case 'AVERAGE': return 'average';
    case 'POOR': return 'poor';
    default: return undefined;
  }
}

/**
 * Etkin kampanyalar (campaign.status ENABLED; serving_status ENDED /
 * SUSPENDED olanlar yayinda olmadigi icin disarida). Ag ayari yalniz arama
 * kampanyasinda anlamlidir (G12 "arama kampanyasinda Display acik").
 */
export function mapCampaigns(rows: any[]): Campaign[] {
  const out: Campaign[] = [];
  for (const r of rows) {
    const c = r?.campaign;
    const id = str(c?.id);
    if (!id) continue;
    if (c?.servingStatus === 'ENDED' || c?.servingStatus === 'SUSPENDED') continue;
    const channel = enumVal(c?.advertisingChannelType);
    const b = r?.campaignBudget;
    // amount_micros gunluk ortalama; toplam butceli (CUSTOM_PERIOD) kampanyada gunluk tutar yok
    const period = str(b?.period) ?? 'DAILY';
    const budget = period === 'DAILY' ? micros(b?.amountMicros) : undefined;
    const ns = c?.networkSettings;
    const network = channel === 'SEARCH' && ns && typeof ns === 'object'
      ? {
        search: ns.targetGoogleSearch === true,
        searchPartners: ns.targetSearchNetwork === true,
        display: ns.targetContentNetwork === true,
      }
      : undefined;
    out.push({
      id,
      name: str(c?.name) ?? id,
      objective: channel,
      budget,
      bidStrategy: enumVal(c?.biddingStrategyType),
      network,
      geoTargeting: mapGeoTargetType(c?.geoTargetTypeSetting?.positiveGeoTargetType),
    });
  }
  return out;
}

/** Kampanya → son 30 gun harcama */
export function mapCampaignSpend(rows: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const id = str(r?.campaign?.id);
    if (!id) continue;
    m.set(id, (m.get(id) ?? 0) + (micros(r?.metrics?.costMicros) ?? 0));
  }
  return m;
}

/** conversion_action → { id, primary, status } (status kucuk harf: 'enabled', 'hidden') */
export function mapConversionActions(rows: any[]): NonNullable<AccountSnapshot['conversionActions']> {
  return rows
    .map((r) => r?.conversionAction)
    .filter((a) => str(a?.id))
    .map((a) => ({
      id: String(a.id),
      primary: a.primaryForGoal === true,
      status: String(a.status ?? 'UNKNOWN').toLowerCase(),
    }));
}

/** search_term_view satirlari (terim x reklam grubu) terim bazinda toplanir */
export function mapSearchTerms(rows: any[]): NonNullable<AccountSnapshot['searchTerms']> {
  const m = new Map<string, { term: string; cost: number; conversions: number }>();
  for (const r of rows) {
    const term = str(r?.searchTermView?.searchTerm);
    if (!term) continue;
    const t = m.get(term) ?? { term, cost: 0, conversions: 0 };
    t.cost += micros(r?.metrics?.costMicros) ?? 0;
    t.conversions += num(r?.metrics?.conversions) ?? 0;
    m.set(term, t);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost);
}

/**
 * Negatif anahtar kelime listeleri. appliedScope: bir kampanyaya bagliysa
 * 'campaign'; bagli degilse ya da baglantilar okunamadiysa null.
 */
export function mapNegativeLists(sets: any[], links: any[] | null | undefined): NonNullable<AccountSnapshot['negativeKeywordLists']> {
  const attached = new Set<string>();
  for (const l of links ?? []) {
    const id = lastId(l?.campaignSharedSet?.sharedSet);
    if (id) attached.add(id);
  }
  return sets
    .map((r) => r?.sharedSet)
    .filter((s) => str(s?.id))
    .map((s) => ({
      name: str(s.name) ?? String(s.id),
      appliedScope: links && attached.has(String(s.id)) ? ('campaign' as const) : null,
    }));
}

/**
 * Kampanya basina RSA ozeti: reklam sayisi, ortalama baslik / aciklama sayisi,
 * reklam gucu (en sik gorulen; esitlikte zayif olan). Ayrica LLM kurallari
 * icin gercek reklam metni ornekleri.
 */
export function mapRsa(rows: any[]): {
  byCampaign: Map<string, NonNullable<Campaign['rsa']>>;
  adCopySamples: NonNullable<AccountSnapshot['adCopySamples']>;
} {
  const acc = new Map<string, { count: number; headlines: number; descriptions: number; strengths: AdStrength[] }>();
  const samples: NonNullable<AccountSnapshot['adCopySamples']> = [];
  for (const r of rows) {
    const id = str(r?.campaign?.id);
    if (!id) continue;
    const ad = r?.adGroupAd?.ad?.responsiveSearchAd ?? {};
    const hs: string[] = (Array.isArray(ad.headlines) ? ad.headlines : []).map((h: any) => str(h?.text)).filter(Boolean);
    const ds: string[] = (Array.isArray(ad.descriptions) ? ad.descriptions : []).map((d: any) => str(d?.text)).filter(Boolean);
    const a = acc.get(id) ?? { count: 0, headlines: 0, descriptions: 0, strengths: [] };
    a.count++;
    a.headlines += hs.length;
    a.descriptions += ds.length;
    const st = mapAdStrength(r?.adGroupAd?.adStrength);
    if (st) a.strengths.push(st);
    acc.set(id, a);
    hs.forEach((h, i) => {
      if (samples.length < 30) samples.push(i === 0 && ds[0] ? { headline: h, description: ds[0] } : { headline: h });
    });
  }
  const order: AdStrength[] = ['poor', 'average', 'good', 'excellent'];
  const byCampaign = new Map<string, NonNullable<Campaign['rsa']>>();
  for (const [id, a] of acc) {
    let adStrength: AdStrength | undefined;
    let best = 0;
    for (const s of order) {
      const n = a.strengths.filter((x) => x === s).length;
      if (n > best) { best = n; adStrength = s; }
    }
    byCampaign.set(id, {
      count: a.count,
      headlines: Math.round(a.headlines / a.count),
      descriptions: Math.round(a.descriptions / a.count),
      adStrength,
    });
  }
  return { byCampaign, adCopySamples: samples };
}

type ExtCounts = { sitelinks: number; callouts: number; structuredSnippets: number };
const EXT_KEY: Record<string, keyof ExtCounts> = {
  SITELINK: 'sitelinks',
  CALLOUT: 'callouts',
  STRUCTURED_SNIPPET: 'structuredSnippets',
};

/**
 * Kampanyada gecerli uzanti sayisi. Uzanti hesap, kampanya ya da reklam grubu
 * seviyesinde eklenebilir; alt seviyedeki uzanti ustekini gecersiz kilar. Her
 * tur icin uc seviyenin en buyugu alinir (reklam grubunda en cok uzantili grup):
 * eksik saymak "sitelink yok" diye yanlis fail uretirdi. Uc sorgudan biri
 * okunamadiysa sayi hic verilmez (cagiran undefined birakir).
 */
export function mapExtensionCounts(
  campaignIds: string[],
  customerRows: any[],
  campaignRows: any[],
  adGroupRows: any[],
): Map<string, ExtCounts> {
  const zero = (): ExtCounts => ({ sitelinks: 0, callouts: 0, structuredSnippets: 0 });
  const account = zero();
  for (const r of customerRows) {
    const k = EXT_KEY[r?.customerAsset?.fieldType];
    if (k) account[k]++;
  }
  const camp = new Map<string, ExtCounts>();
  for (const r of campaignRows) {
    const id = str(r?.campaign?.id);
    const k = EXT_KEY[r?.campaignAsset?.fieldType];
    if (!id || !k) continue;
    const c = camp.get(id) ?? zero();
    c[k]++;
    camp.set(id, c);
  }
  // reklam grubu → sayilar, sonra kampanya basina en buyuk grup
  const groups = new Map<string, { campaignId: string; counts: ExtCounts }>();
  for (const r of adGroupRows) {
    const gid = str(r?.adGroup?.id);
    const cid = lastId(r?.adGroup?.campaign);
    const k = EXT_KEY[r?.adGroupAsset?.fieldType];
    if (!gid || !cid || !k) continue;
    const g = groups.get(gid) ?? { campaignId: cid, counts: zero() };
    g.counts[k]++;
    groups.set(gid, g);
  }
  const groupMax = new Map<string, ExtCounts>();
  for (const { campaignId, counts } of groups.values()) {
    const m = groupMax.get(campaignId) ?? zero();
    for (const k of Object.keys(m) as (keyof ExtCounts)[]) m[k] = Math.max(m[k], counts[k]);
    groupMax.set(campaignId, m);
  }
  const out = new Map<string, ExtCounts>();
  for (const id of campaignIds) {
    const c = camp.get(id) ?? zero();
    const g = groupMax.get(id) ?? zero();
    const e = zero();
    for (const k of Object.keys(e) as (keyof ExtCounts)[]) e[k] = Math.max(account[k], c[k], g[k]);
    out.set(id, e);
  }
  return out;
}

/**
 * Kampanya basina kalite puani (gosterimle agirlikli ortalama; toplam gosterim
 * 0 ise duz ortalama) ve QS<=3 anahtar kelime payi (yuzde) + eslesme turu payi
 * (yuzde, anahtar kelime sayisiyla). Kalite puani olmayan kelime QS
 * hesabina girmez; hicbirinde yoksa qualityScore verilmez.
 */
export function mapKeywords(rows: any[]): Map<string, { qualityScore?: Campaign['qualityScore']; matchTypeMix?: Campaign['matchTypeMix'] }> {
  const acc = new Map<string, { qs: { score: number; imp: number }[]; match: { exact: number; phrase: number; broad: number; total: number } }>();
  for (const r of rows) {
    const id = str(r?.campaign?.id);
    if (!id) continue;
    const a = acc.get(id) ?? { qs: [], match: { exact: 0, phrase: 0, broad: 0, total: 0 } };
    const qs = num(r?.adGroupCriterion?.qualityInfo?.qualityScore);
    if (qs !== undefined && qs >= 1 && qs <= 10) a.qs.push({ score: qs, imp: num(r?.metrics?.impressions) ?? 0 });
    const mt = r?.adGroupCriterion?.keyword?.matchType;
    if (mt === 'EXACT') a.match.exact++;
    else if (mt === 'PHRASE') a.match.phrase++;
    else if (mt === 'BROAD') a.match.broad++;
    if (mt === 'EXACT' || mt === 'PHRASE' || mt === 'BROAD') a.match.total++;
    acc.set(id, a);
  }
  const out = new Map<string, { qualityScore?: Campaign['qualityScore']; matchTypeMix?: Campaign['matchTypeMix'] }>();
  for (const [id, a] of acc) {
    let qualityScore: Campaign['qualityScore'];
    if (a.qs.length > 0) {
      const imp = a.qs.reduce((s, q) => s + q.imp, 0);
      const weighted = imp > 0
        ? a.qs.reduce((s, q) => s + q.score * q.imp, 0) / imp
        : a.qs.reduce((s, q) => s + q.score, 0) / a.qs.length;
      const critical = a.qs.filter((q) => q.score <= 3).length;
      qualityScore = { weighted: round1(weighted), criticalPct: round1((critical / a.qs.length) * 100) };
    }
    const t = a.match.total;
    const matchTypeMix = t > 0
      ? { exact: round1((a.match.exact / t) * 100), phrase: round1((a.match.phrase / t) * 100), broad: round1((a.match.broad / t) * 100) }
      : undefined;
    out.set(id, { qualityScore, matchTypeMix });
  }
  return out;
}

// ─── Birlestirme ────────────────────────────────────────────────

/**
 * Sorgu sonuclarindan snapshot. null / eksik sonuc → ilgili alanlar
 * undefined + readErrors'a etiket. Kampanyalar harcamaya gore buyukten kucuge
 * siralanir (kurallar en cok harcayan kampanyaya bakar).
 *
 * Okunmayanlar (undefined kalir → 'na'): ga4Linked, enhancedConversionsActive,
 * consentModeV2, pmaxCampaigns ayrintisi, learningStatus, spendToday,
 * searchTermLastReviewedAt, landingPageThemes.
 */
export function buildGoogleSnapshot(r: GoogleReadResults): { snapshot: AccountSnapshot; readErrors: string[] } {
  const readErrors = (Object.keys(GOOGLE_SNAPSHOT_QUERIES) as GoogleQueryKey[])
    .filter((k) => !Array.isArray(r[k]))
    .map((k) => GOOGLE_QUERY_LABELS[k]);
  const ok = (k: GoogleQueryKey): any[] | undefined => (Array.isArray(r[k]) ? (r[k] as any[]) : undefined);

  const snap: AccountSnapshot = {};

  const cur = ok('currency');
  if (cur) snap.currency = mapCurrency(cur);
  const spendRows = ok('accountSpend');
  if (spendRows) {
    snap.monthlySpend = round2(mapAccountSpend(spendRows));
    // Kur donusumu yok: USD esikli kurallar yalniz USD hesapta
    if (snap.currency === 'USD') snap.monthlySpendUsd = snap.monthlySpend;
  }

  const ca = ok('conversionActions');
  if (ca) snap.conversionActions = mapConversionActions(ca);
  const st = ok('searchTerms');
  if (st) snap.searchTerms = mapSearchTerms(st);
  const nl = ok('negativeLists');
  if (nl) snap.negativeKeywordLists = mapNegativeLists(nl, ok('negativeListLinks'));

  const rsaRows = ok('rsa');
  const rsa = rsaRows ? mapRsa(rsaRows) : undefined;
  if (rsa) snap.adCopySamples = rsa.adCopySamples;

  const campRows = ok('campaigns');
  if (campRows) {
    const campaigns = mapCampaigns(campRows);
    const spend = ok('campaignMetrics') ? mapCampaignSpend(ok('campaignMetrics') as any[]) : undefined;
    const cust = ok('customerAssets');
    const campA = ok('campaignAssets');
    const grpA = ok('adGroupAssets');
    const ext = cust && campA && grpA ? mapExtensionCounts(campaigns.map((c) => c.id), cust, campA, grpA) : undefined;
    const kwRows = ok('keywords');
    const kw = kwRows ? mapKeywords(kwRows) : undefined;

    for (const c of campaigns) {
      const search = c.objective === 'SEARCH';
      const rs = rsa?.byCampaign.get(c.id);
      // RSA'si olmayan kampanyada (ornegin dinamik arama) RSA ozeti verilmez
      if (rs) c.rsa = rs;
      // Uzanti sayisi arama kampanyasinda anlamli; Display'de "sitelink yok" yanlis olurdu
      const e = search ? ext?.get(c.id) : undefined;
      if (e) {
        c.sitelinks = e.sitelinks;
        c.callouts = e.callouts;
        c.structuredSnippets = e.structuredSnippets;
      }
      const k = kw?.get(c.id);
      if (k?.qualityScore) c.qualityScore = k.qualityScore;
      if (k?.matchTypeMix) c.matchTypeMix = k.matchTypeMix;
    }
    if (spend) campaigns.sort((a, b) => (spend.get(b.id) ?? 0) - (spend.get(a.id) ?? 0));
    snap.campaigns = campaigns;
    snap.campaignNamingSamples = campaigns.map((c) => c.name);
  }

  return { snapshot: snap, readErrors };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
