/**
 * Google izin kapsami (scope) dogrulamasi — token alindiktan SONRA.
 *
 * NEDEN: token cevabindaki `scope` hic okunmuyordu. Google birden fazla
 * (Sign-In disi) kapsam istendiginde izin ekraninda her kapsami ayri onay
 * kutusuyla sunar; kullanici veri kutusunu bos birakirsa token yine gelir,
 * panel "bagli" der ama hicbir veri gelmez. Varsayilan tek kapsamli istekte
 * kutu cikmaz, ancak GSC_SCOPES/GA_SCOPES ile kapsam listesi genisletilebilir
 * ve Google her durumda verilen kapsamin kontrol edilmesini ister:
 *   "Your app should always check which scopes were granted by the user"
 *     https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions
 *   Token cevabindaki `scope`: "The scopes of access granted by the access_token
 *   expressed as a list of space-delimited, case-sensitive strings."
 *     https://developers.google.com/identity/protocols/oauth2/web-server
 * `scope` alani yoksa verilen kapsam istenenle AYNIDIR (RFC 6749 §5.1:
 * "OPTIONAL, if identical to the scope requested by the client; otherwise, REQUIRED").
 */

/** Search Console verisi (searchanalytics.query) bu ikisinden biriyle okunur — API referansi: developers.google.com/webmaster-tools/v1/searchanalytics/query */
export const GSC_DATA_SCOPES = [
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

/** GA4 Data API runReport bu ikisinden birini ister — developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport */
export const GA_DATA_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/analytics',
];

export const GOOGLE_ADS_SCOPES = ['https://www.googleapis.com/auth/adwords'];

export const DEFAULT_GSC_SCOPES = ['https://www.googleapis.com/auth/webmasters'];
export const DEFAULT_GA_SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

/** Env'deki virgullu liste (bosluk/bos eleman temizlenir); bossa varsayilan */
export function scopesFromEnv(raw: string | undefined, fallback: string[]): string[] {
  const list = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

/**
 * Verilen kapsamlar arasinda kabul edilen veri kapsamlarindan en az biri var mi?
 * @param tokenScope token cevabindaki bosluklu liste (yoksa istenen kapsam verilmis sayilir)
 */
export function hasGrantedScope(tokenScope: string | undefined | null, requested: string[], accepted: string[]): boolean {
  const granted = typeof tokenScope === 'string' && tokenScope.trim()
    ? tokenScope.trim().split(/\s+/)
    : requested;
  return accepted.some((s) => granted.includes(s));
}
