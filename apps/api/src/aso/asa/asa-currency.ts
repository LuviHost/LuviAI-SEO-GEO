/**
 * Apple Ads hesabinin para birimi — sema degismeden kv_store'da (saf yardimcilar).
 *
 * NEDEN: asa_performance_daily.spendUsd ve asa_accounts.autoPilotBudgetCap
 * adlarina ragmen HESABIN para birimini tasir: rapordaki localSpend "The total
 * spend of a campaign in the currency the organization uses."
 * (https://developer.apple.com/documentation/apple_ads/spendrow). Para birimi
 * bilinmedigi icin panel ve otopilot gerekcesi "$" yaziyordu; TL hesapta
 * 500 TL'lik harcama "$500" gorunuyordu.
 *
 * Kaynaklar:
 *  - baglanti aninda hesap bilgisi: v5 UserAcl.currency ("The organization's
 *    default currency", https://developer.apple.com/documentation/apple_ads/useracl),
 *    Platform AdAccount.currency
 *  - her performans cekiminde rapor satirlarinin localSpend.currency degeri
 *    (bir hesap tek para birimi kullanir: "An account doesn't support mixing
 *    currencies", https://developer.apple.com/documentation/apple-ads-platform-api/money)
 *
 * Anahtar site kimligini icerir: site silme (sites.service siteKvFilter) ve hesap
 * silme (account-purge.plan) planlarinin "anahtar kimligi icerir" adimi satiri
 * da siler (bkz. me/unscoped-kv-keys.ts gerekcesi). Baglanti kesilince
 * asa.service disconnectAccount ayrica siler.
 */

/** Ayni hesabin raporunda birden cok para birimi gorulurse yazilan isaret (okurken null) */
export const ASA_CURRENCY_MIXED = 'MIXED';

const ISO_4217 = /^[A-Z]{3}$/;

export function asaCurrencyKey(siteId: string, accountId: string): string {
  return `asa:currency:${siteId}:${accountId}`;
}

/** Gecerli ISO 4217 bicimli kod mu (3 buyuk harf) */
export function isIsoCurrency(code: unknown): code is string {
  return typeof code === 'string' && ISO_4217.test(code);
}

/**
 * Rapor satirlarinin para birimleri → kv'ye yazilacak deger.
 * null: satirlarda para birimi yok (yazma; onceki bilinen deger korunur).
 */
export function reportCurrencyValue(codes: Iterable<string | null | undefined>): string | null {
  const seen = new Set<string>();
  for (const c of codes) if (isIsoCurrency(c)) seen.add(c);
  if (seen.size === 0) return null;
  return seen.size === 1 ? [...seen][0] : ASA_CURRENCY_MIXED;
}

/** kv degeri → ISO kod; karisik, bozuk ya da yoksa null */
export function parseAsaCurrency(raw: string | null | undefined): string | null {
  return isIsoCurrency(raw) ? raw : null;
}

/**
 * Sitenin birden cok hesabi: hepsi AYNI bilinen koddaysa o, degilse null.
 * Toplamlar hesaplar arasinda toplandigi icin farkli birimlere tek kod yazilmaz.
 */
export function combineAsaCurrencies(values: Array<string | null>): string | null {
  if (values.length === 0) return null;
  const first = values[0];
  if (!first) return null;
  return values.every((v) => v === first) ? first : null;
}

/** Otopilot gerekcesi icin tutar: bilinen kodla "512.30 USD", bilinmiyorsa yalniz sayi */
export function formatAsaAmount(n: number, currency: string | null): string {
  const v = (Number.isFinite(n) ? n : 0).toFixed(2);
  return currency ? `${v} ${currency}` : v;
}

/** runAutoPilot butce siniri gerekcesi — '$' yok; para birimi bilinmiyorsa acikca soylenir */
export function budgetCapReason(monthSpend: number, cap: number, currency: string | null): string {
  const suffix = currency ? '' : ' (hesap para birimi)';
  return `Aylık harcama sınırına ulaşıldı: ${formatAsaAmount(monthSpend, currency)} / ${formatAsaAmount(cap, currency)}${suffix}`;
}
