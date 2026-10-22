import { siteHref } from './site-routes';

/**
 * Ucretsiz denemenin sunucu hata kodlari — saf, test edilir (trial-errors.spec.mts).
 *
 * Sunucu (api billing/trial-policy.ts) iki durumda 403 + makine kodu doner:
 *  - TRIAL_EXPIRED: deneme suresi dolmus hesap salt okunur (trial-expiry.guard.ts).
 *    Panel ham hata bildirimi yerine "Deneme süren doldu" modalini acar.
 *  - TRIAL_SOURCE_REQUIRED: denemede "Uret" icin sitede yayin hedefi yok
 *    (QuotaService.consumeArticleAllowance). Panel yayin hedefleri sayfasina
 *    baglantili bildirim gosterir.
 * api.ts her hatali yanitta trialErrorAction'i hesaplar ve TRIAL_ERROR_EVENT ile
 * duyurur; components/trial-upgrade.tsx dinler.
 */

export const TRIAL_EXPIRED_CODE = 'TRIAL_EXPIRED';
export const TRIAL_SOURCE_REQUIRED_CODE = 'TRIAL_SOURCE_REQUIRED';

/** window CustomEvent adi; detail: TrialErrorAction */
export const TRIAL_ERROR_EVENT = 'ranksup:trial-error';

export const TRIAL_ERROR_COPY = {
  sourceAction: 'Yayın hedefi bağla',
  sourceFallback: 'Ücretsiz denemede makale üretmek için önce sitene bir yayın hedefi bağla (WordPress ya da Markdown ZIP).',
} as const;

export type TrialErrorAction =
  | { kind: 'expired'; message: string }
  | { kind: 'source_required'; message: string; href: string };

/** Hata govdesindeki makine kodu (Nest ForbiddenException({ code })); yoksa null */
export function readApiErrorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : null;
}

function readMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const m = (body as { message?: unknown }).message;
  return typeof m === 'string' && m.trim() ? m : null;
}

/** API yolundaki site kimligi (/sites/:siteId/...); yoksa null */
export function siteIdFromApiPath(path: string | null | undefined): string | null {
  const m = /^\/sites\/([^/?#]+)/.exec(path ?? '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/**
 * Hatali yanit bir deneme hatasi mi, panel ne yapmali? Yalniz 403 + bilinen kod.
 * Yayin hedefi baglantisi istegin site yolundan cikar; yol sitesizse (ornegin MCP
 * araci, firsat uretimi) panelin o an actigi site yolundan (pagePath) denenir, o da
 * yoksa site listesi.
 */
export function trialErrorAction(
  status: number,
  body: unknown,
  apiPath: string | null | undefined,
  pagePath?: string | null,
): TrialErrorAction | null {
  if (status !== 403) return null;
  const code = readApiErrorCode(body);
  const message = readMessage(body);
  if (code === TRIAL_EXPIRED_CODE) return { kind: 'expired', message: message ?? '' };
  if (code === TRIAL_SOURCE_REQUIRED_CODE) {
    const siteId = siteIdFromApiPath(apiPath) ?? siteIdFromApiPath(pagePath);
    return {
      kind: 'source_required',
      message: message ?? TRIAL_ERROR_COPY.sourceFallback,
      href: siteId ? siteHref(siteId, 'publishTargets') : '/sites',
    };
  }
  return null;
}

/**
 * Cagiranin kendi "toast.error(err.message)" bildirimi bu deneme hatasinin ham kopyasi mi?
 * (Panelde ~340 cagri yeri hatayi boyle gosterir; modal / baglantili bildirim acildiginda
 * ham kopya kapatilir.) Bos mesaj hicbir seyle eslesmez.
 */
export function isRawTrialToast(title: unknown, message: string): boolean {
  return !!message && typeof title === 'string' && title.includes(message);
}
