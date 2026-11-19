/**
 * Kurallarin `requires` listesi: kural yalniz hesaptan GERCEKTEN okunan
 * veriyle calisir. Okunmayan alan (undefined) 'na' demektir; okunmus bos dizi
 * (ornegin hesapta hic donusum islemi yok) gercek veridir.
 */
import type { AccountSnapshot, SnapshotPath } from './types.js';

export const NO_DATA_FINDING = 'Bu kontrol için hesaptan veri okunamadı';
export const NO_CAMPAIGN_FINDING = 'Hesapta etkin kampanya yok; bu kontrol uygulanmadı';

function hasPath(v: unknown, parts: string[]): boolean {
  if (parts.length === 0) return v !== undefined && v !== null;
  if (v === undefined || v === null || typeof v !== 'object') return false;
  const [head, ...rest] = parts;
  if (head.endsWith('[]')) {
    const arr = (v as Record<string, unknown>)[head.slice(0, -2)];
    return Array.isArray(arr) && arr.some((el) => hasPath(el, rest));
  }
  return hasPath((v as Record<string, unknown>)[head], rest);
}

export type RequirementGap =
  /** Alan okunmadi */
  | { path: SnapshotPath; reason: 'not_read' }
  /** Ust dizi okundu ama bos (hesapta kampanya yok): gercek veri, yine de kontrol uygulanmaz */
  | { path: SnapshotPath; reason: 'empty' };

/** Ilk karsilanmayan gereksinim; hepsi karsilaniyorsa null */
export function firstMissingRequirement(snap: AccountSnapshot, requires: readonly SnapshotPath[] | undefined): RequirementGap | null {
  for (const path of requires ?? []) {
    const parts = path.split('.');
    if (hasPath(snap, parts)) continue;
    const root = parts[0];
    if (root.endsWith('[]')) {
      const arr = (snap as Record<string, unknown>)[root.slice(0, -2)];
      if (Array.isArray(arr) && arr.length === 0) return { path, reason: 'empty' };
    }
    return { path, reason: 'not_read' };
  }
  return null;
}

/** Snapshot'ta hesaptan okunmus (tanimli) ust duzey alanlar */
export function definedSnapshotFields(snap: AccountSnapshot): string[] {
  return Object.entries(snap)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k]) => k);
}

/**
 * Kampanya listesinde alani okunmus ilk kampanya (toplayici kampanyalari
 * harcamaya gore buyukten kucuge siralar). Eski kurallar campaigns[0]'a
 * bakiyordu; ilk kampanya ornegin Display ise arama ayarlari yoktur.
 */
export function firstCampaignWith<K extends keyof NonNullable<AccountSnapshot['campaigns']>[number]>(
  snap: AccountSnapshot,
  key: K,
): NonNullable<AccountSnapshot['campaigns']>[number] | undefined {
  return snap.campaigns?.find((c) => c[key] !== undefined && c[key] !== null);
}
