/**
 * Yayin hedefi turu kilidi — gorunum kurallari. Saf, test edilir (publish-target-lock.spec.mts).
 *
 * SAHIP ISTEGI (15.11.2026, "yap"): deneme duzeyindeki hesap yalniz iki tur yayin hedefi
 * ekleyebilir; katalog 14 turun hepsini acik gosteriyor, musteri (ornegin) Webflow formunu
 * doldurup "Ekle"ye basinca kirmizi bildirim aliyordu. Artik kilitli tur BASTAN kilitli cizilir
 * ve tiklayinca form yerine plan penceresi acilir.
 *
 * KARAR SUNUCUDA (api publish-targets/publish-target-plan-lock.ts): hangi tur kilitli, hangi
 * plan acar ve musteriye gidecek cumle katalog yanitinda gelir (`locked`, `upgrade`,
 * `lockedReason`). Web plan tablosu tutmaz; alan yoksa (eski API) hicbir tur kilitli cizilmez
 * ve kayit ucunun plan siniri hatasi (components/upgrade-gate.tsx) guvenlik agi olarak kalir.
 */
import { readUpgradeOffer, type UpgradeRequest } from './plan-limit';

export interface LockableCatalogItem {
  type: string;
  label: string;
  locked?: boolean;
  upgrade?: unknown;
  lockedReason?: string;
}

/** Acik turler (sunucunun sirasiyla) ve bu planda eklenemeyenler */
export function splitCatalogByLock<T extends LockableCatalogItem>(catalog: readonly T[]): { open: T[]; locked: T[] } {
  const open: T[] = [];
  const locked: T[] = [];
  for (const c of catalog) (c.locked === true ? locked : open).push(c);
  return { open, locked };
}

/**
 * Kilitli grubun basligi: kilidi acan plan sunucunun onerisinden. Plan bilinmiyorsa / hicbir
 * plan acmiyorsa satis vaat etmeyen notr cumle.
 */
export function lockedGroupTitle(locked: readonly LockableCatalogItem[]): string {
  const offer = locked.map((c) => readUpgradeOffer(c.upgrade)).find((o) => o && o.kind !== 'wait' && o.planName);
  if (!offer?.planName) return 'Bu planda eklenemeyen yayın hedefleri';
  return offer.kind === 'quote'
    ? `${offer.planName} planında açılır (teklifle)`
    : `${offer.planName} ve üzeri planlarda açılır`;
}

/**
 * Kilitli kutuya tiklaninca acilacak plan / teklif penceresi istegi. Yol yoksa ('wait' ya da
 * bicim disi) null: pencere acilmaz, cagiran cumleyi notr bildirimle gosterir.
 */
export function lockedTargetRequest(item: LockableCatalogItem): UpgradeRequest | null {
  if (item.locked !== true) return null;
  const offer = readUpgradeOffer(item.upgrade);
  if (!offer || offer.kind === 'wait') return null;
  return { offer, reason: item.lockedReason?.trim() || `${item.label} bu planda eklenemiyor.` };
}
