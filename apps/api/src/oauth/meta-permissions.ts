/**
 * Meta (Facebook Login) izin dogrulamasi — token alindiktan SONRA.
 *
 * NEDEN: Meta izin ekraninda kisi istenen izinlerin bir kismini kaldirip
 * yine de "Devam" diyebiliyor; token yine gelir. Eskiden token alininca
 * site "bagli" yaziliyordu: reklam izinleri reddedilmis bir hesap panelde
 * bagli gorunuyor, ama Ads API cagrilari (rapor, butce, kampanya) izin
 * hatasiyla dusuyordu. Meta'nin kurali: hangi izinlerin verildigini kontrol et.
 *   "They can choose not to grant certain permissions during the login process."
 *   "Apps should check for the validity of permissions before attempting to
 *    perform an API call where they are required."
 *     https://developers.facebook.com/docs/facebook-login/guides/permissions/request-revoke
 *   GET /{user-id}/permissions → { data: [{ permission, status }], paging },
 *   status su ucunden biri: granted, declined, expired
 *     https://developers.facebook.com/docs/graph-api/reference/user/permissions/
 *
 * Reddedilen izni Login Dialog ancak `auth_type=rerequest` ile yeniden sorar:
 *   "the Login Dialog will not re-ask them for it unless you explicitly tell
 *    the dialog you're re-asking"
 *     https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 */

/**
 * OAuth akisinin kullandigi Graph API surumu (dialog, token, /me/* uclari).
 * Graph API v21.0: 2 Ekim 2024'te cikti, 21 Ocak 2027'ye kadar gecerli
 * (https://developers.facebook.com/docs/graph-api/changelog/versions/).
 * Tek sabit: surum yukseltmesi tek satir olsun.
 */
export const META_GRAPH_VERSION = 'v21.0';

/** Izin ekraninda istenen tum izinler (buildMetaAuthUrl `scope`). */
export const META_REQUESTED_PERMISSIONS = [
  'public_profile',
  'email',
  'ads_read',
  'ads_management',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
] as const;

/**
 * Baglantinin calismasi icin VERILMIS olmasi gereken izinler — kodun gercekten
 * cagirdigi uclardan:
 *  - ads_read: kampanya raporlari (Insights API; performance-sync, A/B olcumu).
 *    Insights API sayfasi gereken izin olarak yalniz ads_read'i yaziyor:
 *    https://developers.facebook.com/docs/marketing-api/insights/
 *  - ads_management: yazma — kampanya baslat/duraklat (ads.controller), butce
 *    kaydirma ve A/B kazanani (otopilot), Sayfa gonderisi one cikarma
 *    (auto-boost). "read and manage ads" → ads_management:
 *    https://developers.facebook.com/docs/marketing-api/get-started/authorization/
 *  - pages_show_list: one cikarma ve reklam metni bir Facebook Sayfasina
 *    baglidir; Sayfa listesi (GET /me/accounts) bu izinle gelir ve panel Sayfa
 *    secmeden hesabi kaydetmiyor. "access the list of Pages a person manages":
 *    https://developers.facebook.com/docs/permissions/
 * Istenip ZORUNLU tutulmayanlar: business_management (kod Business Manager
 * API'sini cagirmiyor), instagram_basic (Instagram yerlesimi istege bagli),
 * pages_read_engagement, email, public_profile.
 */
export const META_REQUIRED_PERMISSIONS = ['ads_read', 'ads_management', 'pages_show_list'] as const;

/**
 * GET /me/permissions govdesinden VERILMIS izin adlarini cikarir.
 * Govde beklenen bicimde degilse null (dogrulanamadi — cagiran reddeder).
 * 'declined' ve 'expired' verilmis sayilmaz.
 */
export function grantedMetaPermissions(body: unknown): Set<string> | null {
  const data = (body as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(data)) return null;
  const granted = new Set<string>();
  for (const row of data) {
    const permission = (row as { permission?: unknown } | null)?.permission;
    const status = (row as { status?: unknown } | null)?.status;
    if (typeof permission === 'string' && status === 'granted') granted.add(permission);
  }
  return granted;
}

/** Zorunlu izinlerden verilmemis olanlar (bos dizi = tamam). */
export function missingMetaPermissions(
  granted: ReadonlySet<string>,
  required: readonly string[] = META_REQUIRED_PERMISSIONS,
): string[] {
  return required.filter((p) => !granted.has(p));
}

/**
 * GET /me/permissions ile token'in zorunlu izinlerinden eksik olanlari getirir.
 * null = liste okunamadi (HTTP/ag hatasi ya da bicim disi govde) — "eksik
 * yok" ile karistirilmaz; cagiran ne yapacagina karar verir. Saglayici
 * govdesi loga yalniz hata tipi/kodu olarak gider (token asla).
 * OAuth akisi (oauth.service) ve elle token kaydi (ads.controller) ortak kullanir.
 */
export async function fetchMissingMetaPermissions(
  accessToken: string,
  log?: { warn(message: string): void },
): Promise<string[] | null> {
  let body: unknown = null;
  try {
    const params = new URLSearchParams({ access_token: accessToken });
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/permissions?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    body = await res.json().catch(() => null);
    if (!res.ok) {
      const e = (body as { error?: { type?: unknown; code?: unknown } } | null)?.error;
      log?.warn(`Meta izin listesi HTTP ${res.status}: ${String(e?.type ?? '')} ${String(e?.code ?? '')}`);
      return null;
    }
  } catch (err) {
    log?.warn(`Meta izin listesi istegi basarisiz: ${String((err as { message?: unknown })?.message ?? err).slice(0, 160)}`);
    return null;
  }
  const granted = grantedMetaPermissions(body);
  if (!granted) {
    log?.warn('Meta izin listesi beklenmeyen bicimde dondu');
    return null;
  }
  return missingMetaPermissions(granted);
}
