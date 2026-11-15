import { LAPSED_LEAD, upgradePathSentence, type UpgradeOffer } from '../billing/plan-limit.js';
import type { PublishTargetCatalogEntry } from './publish-target-catalog.js';

/**
 * Yayin hedefi turu kilidi — saf (I/O: QuotaService.publishTargetAccess, publish-targets.service).
 *
 * NEDEN VAR (15.11.2026, sahip "yap" dedi): deneme duzeyindeki hesap yalniz iki tur yayin hedefi
 * ekleyebilir (QuotaService LIMITS.TRIAL.publishTargets). Katalog bunu soylemiyordu: musteri 14
 * turun hepsini acik goruyor, ornegin Webflow'u secip anahtarlarini giriyor, "Ekle"ye basinca
 * "WEBFLOW yayın hedefi planına dahil değil" kirmizi bildirimini aliyordu (ham tur kodu, bosuna
 * doldurulan form).
 *
 * Artik katalog kilitli turu BASTAN isaretler: panel kutuyu kilitli cizer, tiklayinca form yerine
 * plan penceresi acilir. Kayit ucu da ayni cumleyle plan siniri hatasi doner (guvenlik agi).
 *
 * DURUSTLUK: kilidi acan plan sunucudan (billing/plan-limit upgradeOfferFor) ve yalniz yayin
 * hedeflerinin tamamini acan plan onerilir. Hangi turlerin acik oldugu da cumlede yazar.
 */

export interface PublishTargetAccess {
  /** Hesabin ekleyebildigi turler; 'all' = hepsi */
  allowed: 'all' | readonly string[];
  /** Kilitli turleri acan plan ('all' ise 'wait': kilit yok) */
  upgrade: UpgradeOffer;
  /** Plani biten eski musteri mi (hitap icin; deneme hesabi degil) */
  lapsed: boolean;
}

export type LockableCatalogEntry = PublishTargetCatalogEntry & {
  /** true: bu hesap bu turu ekleyemez */
  locked?: true;
  /** Kilidi acan plan (panel dugmeyi / pencereyi bundan kurar) */
  upgrade?: UpgradeOffer;
  /** Musteriye gosterilen cumle (plan penceresinin gerekcesi) */
  lockedReason?: string;
};

/** "A", "A ve B", "A, B ve C" */
function joinTr(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ve ${names[names.length - 1]}`;
}

/**
 * Kilitli tur cumlesi: hangi turler acik + bu turu hangi plan acar. Tur ADIYLA yazilir
 * (katalog etiketi: "Webflow CMS"); eski metin ham kodu ("WEBFLOW") basiyordu.
 */
export function publishTargetLockedMessage(
  label: string,
  allowedLabels: readonly string[],
  access: Pick<PublishTargetAccess, 'upgrade' | 'lapsed'>,
): string {
  const acik = allowedLabels.length > 0 ? `yalnız ${joinTr(allowedLabels)} yayın hedefi eklenebilir` : 'bu yayın hedefi eklenemez';
  const durum = access.lapsed ? `${LAPSED_LEAD}; bu düzeyde ${acik}.` : `Ücretsiz denemede ${acik}.`;
  const yol = upgradePathSentence(access.upgrade, `${label} için`);
  return yol ? `${durum} ${yol}` : durum;
}

/** Hesabin ekleyebildigi turlerin katalog etiketleri (cumle icin) */
export function allowedTargetLabels(catalog: readonly PublishTargetCatalogEntry[], access: Pick<PublishTargetAccess, 'allowed'>): string[] {
  if (access.allowed === 'all') return [];
  const izinli = new Set(access.allowed);
  return catalog.filter((c) => izinli.has(c.type)).map((c) => c.label);
}

/** Katalogu hesabin haklarina gore isaretle; her tur aciksa katalog AYNEN doner */
export function lockCatalog(catalog: PublishTargetCatalogEntry[], access: PublishTargetAccess): LockableCatalogEntry[] {
  if (access.allowed === 'all') return catalog;
  const izinli = new Set(access.allowed);
  const etiketler = allowedTargetLabels(catalog, access);
  return catalog.map((c) => (izinli.has(c.type)
    ? c
    : { ...c, locked: true as const, upgrade: access.upgrade, lockedReason: publishTargetLockedMessage(c.label, etiketler, access) }));
}
