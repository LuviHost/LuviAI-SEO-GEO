import { readArticleQuota } from './article-quota';
import { PURCHASE_CLOSED_FALLBACK } from './checkout-availability';

/**
 * Ucretsiz deneme bandi, hatirlatma pencereleri ve sure dolunca acilan modal — saf,
 * test edilir (trial-access.spec.mts). Sahip karari 21.10.2026: deneme 14 gun.
 *
 * KARAR SUNUCUDA: GET /billing/users/:id/current `trialAccess` alani (api
 * billing/trial-policy.ts trialAccess). Panel kalan gunu ya da kilidi kendisi
 * hesaplamaz; alan yoksa (eski API) hicbir sey gosterilmez. Asil kapi da sunucuda
 * (api billing/trial-expiry.guard.ts): sure dolmus VE satin alma acikken yapay zeka
 * eylemleri 403 doner. Satin alma kapaliyken (PayTR test modu) modal kapatilabilir
 * ve test modu metnini gosterir; kilit yok.
 */

/** Deneme suresi (gun) — api trial-policy.ts TRIAL_DAYS ile ayni; web kaydi (auth.ts) bitisi bununla yazar */
export const TRIAL_DAYS = 14;

/** Kayit anindan deneme bitisi (web NextAuth kaydi) */
export function trialEndsAtFrom(start: Date): Date {
  return new Date(start.getTime() + TRIAL_DAYS * 86_400_000);
}

export type TrialPhase = 'paid' | 'trial' | 'expired';

export interface TrialAccessView {
  phase: TrialPhase;
  endsAt: string | null;
  daysLeft: number | null;
  checkoutOpen: boolean;
  readOnly: boolean;
}

/** Sunucunun trialAccess alani; yoksa ya da bicim disiysa null (hicbir sey gosterilmez) */
export function readTrialAccess(raw: unknown): TrialAccessView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.phase !== 'paid' && r.phase !== 'trial' && r.phase !== 'expired') return null;
  const daysLeft = typeof r.daysLeft === 'number' && Number.isFinite(r.daysLeft) && r.daysLeft >= 0 ? Math.floor(r.daysLeft) : null;
  return {
    phase: r.phase,
    endsAt: typeof r.endsAt === 'string' ? r.endsAt : null,
    daysLeft,
    checkoutOpen: r.checkoutOpen === true,
    readOnly: r.readOnly === true,
  };
}

/** Fiyatlandirma (plan kartlari) ve abonelik sayfasi */
export const TRIAL_UPGRADE_HREF = '/pricing';
export const TRIAL_BILLING_HREF = '/billing';

export const TRIAL_COPY = {
  bannerCta: 'Planını yükselt',
  expiredTitle: 'Deneme süren doldu — devam etmek için bir plan seç',
  expiredReadOnly:
    'Hesabın şu an salt okunur: sitelerini, makalelerini ve raporlarını görebilir, indirebilirsin. Yapay zekâ ile yeni üretim, ölçüm ve analiz için bir plan seçmen gerekiyor. Verilerin hesabında duruyor.',
  continueReadOnly: 'Salt okunur devam et',
  seePlans: 'Planları gör',
  later: 'Daha sonra',
} as const;

export interface TrialBanner {
  text: string;
  tone: 'info' | 'warning';
}

/**
 * Engellemeyen geri sayim bandi: deneme surerken her panel sayfasinin ustunde.
 * Son 3 gunde uyari tonunda. Sure dolmussa bant yok (modal soyler).
 */
export function trialBanner(access: TrialAccessView | null): TrialBanner | null {
  if (!access || access.phase !== 'trial' || access.daysLeft === null) return null;
  const text = access.daysLeft === 0
    ? `Deneme süren bugün bitiyor · ${TRIAL_COPY.bannerCta}`
    : `Deneme sürenin bitmesine ${access.daysLeft} gün kaldı · ${TRIAL_COPY.bannerCta}`;
  return { text, tone: access.daysLeft <= 3 ? 'warning' : 'info' };
}

/** Hatirlatma penceresi anahtarlari: deneme gunu 7, 11, 13 ve 2 makale hakki bitince */
export type TrialPopupKey = 'day7' | 'day11' | 'day13' | 'limit';

export interface TrialPopup {
  key: TrialPopupKey;
  title: string;
  body: string;
}

const POPUP_COPY: Record<TrialPopupKey, Omit<TrialPopup, 'key'>> = {
  day7: {
    title: 'Denemenin ilk haftası doldu',
    body: 'Ücretsiz denemenin 7 günü kaldı. Plan seçtiğinde aylık makale hakkın başlar, takvimindeki konular sırayla yazılır ve sitelerin, içeriklerin olduğu gibi kalır.',
  },
  day11: {
    title: 'Deneme sürenin bitmesine 3 gün kaldı',
    body: 'Deneme bittiğinde yapay zekâ ile yeni üretim ve ölçüm için bir plan seçmen gerekecek. Şimdi plan seçersen kaldığın yerden kesintisiz devam edersin.',
  },
  day13: {
    title: 'Deneme süren yarın bitiyor',
    body: 'Yarından itibaren yapay zekâ ile yeni üretim ve ölçüm için bir plan gerekecek. Sitelerin, makalelerin ve raporların hesabında kalır.',
  },
  limit: {
    title: 'Ücretsiz 2 makale hakkını kullandın',
    body: 'Takvimindeki diğer konular, bir plan seçtiğinde yazılır. Plan seçtiğinde aylık makale hakkın başlar.',
  },
};

/**
 * Hangi hatirlatma penceresi acilsin (en fazla biri)? Kapatilan anahtar bir daha
 * acilmaz (tarayicida saklanir). Gun esikleri: kalan 7 gun (7. gun), kalan 3 gun
 * (11. gun), kalan 1 gun ya da daha az (13. gun). Yalniz ULASILAN EN SON esik
 * aday: 13. gunde 7. gunun penceresi geriye donup acilmaz. Hak bitti penceresi
 * once gelir (musteri o an uretmek istedi). Deneme disinda hicbiri.
 */
export function trialPopup(
  access: TrialAccessView | null,
  opts: { quota?: unknown; dismissed: ReadonlySet<string> },
): TrialPopup | null {
  if (!access || access.phase !== 'trial') return null;
  const q = readArticleQuota(opts.quota);
  const exhausted = !!q && q.limit > 0 && q.remaining === 0 && q.used >= q.limit;
  if (exhausted && !opts.dismissed.has('limit')) return { key: 'limit', ...POPUP_COPY.limit };
  const d = access.daysLeft;
  if (d === null) return null;
  const milestone: TrialPopupKey | null = d <= 1 ? 'day13' : d <= 3 ? 'day11' : d <= 7 ? 'day7' : null;
  if (!milestone || opts.dismissed.has(milestone)) return null;
  return { key: milestone, ...POPUP_COPY[milestone] };
}

export interface ExpiredModal {
  title: string;
  body: string;
  /**
   * false: engelleyen modal (kapatma dugmesi, Esc ve dis tik yok); kullanici plan
   * secer ya da acikca "salt okunur devam" der. true: satin alma kapali (test modu),
   * normal kapatilabilir pencere.
   */
  dismissible: boolean;
  /** Satin alma kapaliyken gosterilen test modu metni; acikken null */
  checkoutMessage: string | null;
}

/**
 * Sure dolunca panele giriste acilan modal. Abonelik sayfasinda acilmaz (plan
 * secilen yer orasi). Satin alma acik → salt okunur (sunucu da oyle davranir);
 * kapali → kapatilabilir, test modu metni, kilit yok.
 */
export function expiredModal(
  access: TrialAccessView | null,
  opts: { pathname?: string | null; checkoutMessage?: string | null },
): ExpiredModal | null {
  if (!access || access.phase !== 'expired') return null;
  if ((opts.pathname ?? '').startsWith(TRIAL_BILLING_HREF)) return null;
  if (access.readOnly) {
    return { title: TRIAL_COPY.expiredTitle, body: TRIAL_COPY.expiredReadOnly, dismissible: false, checkoutMessage: null };
  }
  return {
    title: TRIAL_COPY.expiredTitle,
    body: 'Deneme süren doldu. Ödeme altyapımız şu an test aşamasında olduğu için hesabın kilitlenmedi; satın alma açılana kadar kalan deneme haklarınla devam edebilirsin.',
    dismissible: true,
    checkoutMessage: opts.checkoutMessage?.trim() || PURCHASE_CLOSED_FALLBACK,
  };
}

/** Kapatilan hatirlatmalarin tarayici anahtari (hesap basina) */
export function trialPopupStorageKey(userId: string): string {
  return `ranksup.trialPopups.${userId}`;
}

/** Saklanan liste → kume; bozuk veri bos kume (pencere bir kez fazla acilir, zarar yok) */
export function parseDismissed(raw: string | null | undefined): Set<string> {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
