/**
 * Kampanya Skoru icin Meta Graph API okumalari → AccountSnapshot (saf).
 *
 * Okunan: para birimi, etkin kampanyalar (id, ad, objective, CBO, kampanya
 * gunluk butcesi), son 30 gun harcamasi. CBO: kampanyada daily_budget ya da
 * lifetime_budget varsa butce kampanya seviyesindedir ("You can either set
 * budget at the campaign level or at the adset level, not both" — resmi
 * Campaign referansi; meta-ads-client readBudgetPlan).
 *
 * Okunmayan (undefined → kural 'na'): reklam setleri / kreatifler / frekans /
 * ogrenme durumu, pixel, CAPI, EMQ, alan adi dogrulamasi, AEM, atif penceresi.
 * Eskiden toplayici RanksUp'in kendi kampanya tablosundan sahte reklam seti
 * ('active', UGC degil, yas 30 gun ...) uretiyordu.
 */
import type { AccountSnapshot } from './rules/types.js';
import { metaAmountFromMinor, parseMetaMinor } from './meta-ads-client.service.js';

type MetaCampaign = NonNullable<AccountSnapshot['metaCampaigns']>[number];

const META_ID = /^\d{1,32}$/;

export function mapMetaCampaigns(rows: any[], currency: string | null | undefined): MetaCampaign[] {
  const out: MetaCampaign[] = [];
  for (const c of rows) {
    if (typeof c?.id !== 'string' || !META_ID.test(c.id)) continue;
    // Kenar suzgecine guvenilmez; durum satirdan da denetlenir
    if (c.effective_status !== undefined && c.effective_status !== 'ACTIVE') continue;
    const daily = parseMetaMinor(c.daily_budget);
    const lifetime = parseMetaMinor(c.lifetime_budget);
    out.push({
      id: c.id,
      name: typeof c.name === 'string' ? c.name : undefined,
      objective: typeof c.objective === 'string' ? c.objective : undefined,
      cbo: daily !== null || lifetime !== null,
      // Para birimi bilinmeden en kucuk birim tutara cevrilmez
      budget: daily !== null && currency ? metaAmountFromMinor(daily, currency) : undefined,
      adSets: undefined,
    });
  }
  return out;
}

export function buildMetaSnapshot(r: {
  currency: string | null;
  campaigns: any[] | null;
  spend30d: number | null;
}): { snapshot: AccountSnapshot; readErrors: string[] } {
  const snap: AccountSnapshot = {};
  const readErrors: string[] = [];
  if (r.currency) snap.currency = r.currency;
  else readErrors.push('Para birimi');
  if (r.spend30d !== null) {
    snap.monthlySpend = Math.round(r.spend30d * 100) / 100;
    if (snap.currency === 'USD') snap.monthlySpendUsd = snap.monthlySpend;
  } else readErrors.push('Hesap harcaması');
  if (r.campaigns) {
    snap.metaCampaigns = mapMetaCampaigns(r.campaigns, r.currency);
    snap.campaignNamingSamples = snap.metaCampaigns.map((c) => c.name).filter((n): n is string => !!n);
  } else readErrors.push('Kampanyalar');
  return { snapshot: snap, readErrors };
}
