import { countCharacters } from '../keyword-field-audit.js';

/**
 * App Store Connect metadata — saf plan / diff / cakisma mantigi.
 *
 * Alanlar ve PATCH govdeleri Apple semasindan dogrulandi (docc JSON):
 *  - AppInfoLocalizationUpdateRequest: name, subtitle (+ gizlilik alanlari)
 *  - AppStoreVersionLocalizationUpdateRequest: description, keywords,
 *    promotionalText, whatsNew (+ marketingUrl, supportUrl)
 *  - AppStoreVersion.appStoreState KULLANIMDAN KALKTI → appVersionState
 *
 * Duzenlenebilirlik (on kontrol — son karar Apple'in 409 STATE_ERROR'u):
 *  - Surum metni: PREPARE_FOR_SUBMISSION, DEVELOPER_REJECTED, REJECTED,
 *    METADATA_REJECTED, INVALID_BINARY (asc CLI; Apple: "Metadata Rejected —
 *    edit the metadata").
 *  - Promosyon metni her durumda: "without requiring an updated submission"
 *    (ASC referansi).
 *  - What's New ilk surumde yok: "isn't available for the first version"
 *    (ASC referansi).
 *
 * Yerellestirme OLUSTURMAZ: ASC'de olmayan dil icin degisiklik reddedilir.
 */

export type AscField = 'name' | 'subtitle' | 'description' | 'keywords' | 'promotionalText' | 'whatsNew';
export const ASC_FIELDS: AscField[] = ['name', 'subtitle', 'description', 'keywords', 'promotionalText', 'whatsNew'];
const APP_INFO_FIELDS = new Set<AscField>(['name', 'subtitle']);

/** Karakter sinirlari — ASC referansi (keywords: karakter, bkz. keyword-field-audit.ts) */
export const FIELD_LIMITS: Record<AscField, number> = {
  name: 30, subtitle: 30, description: 4000, keywords: 100, promotionalText: 170, whatsNew: 4000,
};
/** Bos birakilamaz (ASC referansi: "This property is required") */
const REQUIRED = new Set<AscField>(['name', 'description', 'keywords', 'whatsNew']);

export const VERSION_EDITABLE_STATES = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY']);
export const APP_INFO_EDITABLE_STATES = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED']);
const APP_INFO_LIVE_STATES = new Set(['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'ACCEPTED', 'PENDING_RELEASE', 'REPLACED_WITH_NEW_INFO']);

export const scopeOf = (f: AscField): 'appInfo' | 'version' => (APP_INFO_FIELDS.has(f) ? 'appInfo' : 'version');

export interface VersionRef { id: string; versionString: string; state: string }
export interface AppInfoRef { id: string; state: string }
export interface LocaleValues { appInfoLocId?: string; versionLocId?: string; values: Partial<Record<AscField, string>> }

export interface MetadataSnapshot {
  version: (VersionRef & { editable: boolean }) | null;
  appInfo: (AppInfoRef & { editable: boolean }) | null;
  isFirstVersion: boolean;
  locales: Record<string, LocaleValues>;
}

export const versionStateOf = (attrs: any): string => attrs?.appVersionState ?? attrs?.appStoreState ?? 'UNKNOWN';
export const appInfoStateOf = (attrs: any): string => attrs?.state ?? attrs?.appStoreState ?? 'UNKNOWN';

/** Yazilacak surum: en yeni duzenlenebilir; yoksa en yeni (yalniz promosyon metni). Girdi en yeni once. */
export function pickVersion(versions: VersionRef[]): (VersionRef & { editable: boolean }) | null {
  const editable = versions.find((v) => VERSION_EDITABLE_STATES.has(v.state));
  if (editable) return { ...editable, editable: true };
  return versions[0] ? { ...versions[0], editable: false } : null;
}

/** asc CLI SelectBestAppInfoID: PREPARE_FOR_SUBMISSION > ilk canli olmayan > ilk */
export function pickAppInfo(infos: AppInfoRef[]): (AppInfoRef & { editable: boolean }) | null {
  const pick = infos.find((i) => i.state === 'PREPARE_FOR_SUBMISSION') ?? infos.find((i) => !APP_INFO_LIVE_STATES.has(i.state)) ?? infos[0];
  return pick ? { ...pick, editable: APP_INFO_EDITABLE_STATES.has(pick.state) } : null;
}

export function fieldEditable(field: AscField, snap: MetadataSnapshot): string | null {
  if (scopeOf(field) === 'appInfo') {
    if (!snap.appInfo) return 'App bilgisi bulunamadı';
    return snap.appInfo.editable ? null : `Ad ve alt başlık yalnız yeni sürüm hazırlanırken değişir (durum: ${snap.appInfo.state})`;
  }
  if (!snap.version) return 'App Store sürümü bulunamadı';
  if (field === 'promotionalText') return null;
  if (!snap.version.editable) return `Sürüm ${snap.version.versionString} düzenlenemez (durum: ${snap.version.state}) — yeni sürüm oluştur`;
  if (field === 'whatsNew' && snap.isFirstVersion) return "Yenilikler (What's New) ilk sürümde girilemez";
  return null;
}

export interface PlannedChange {
  locale: string;
  field: AscField;
  from: string;
  to: string;
  length: number;
  limit: number;
  ok: boolean;
  reason?: string;
}

/** Istenen degerlerden degisiklik listesi — ayni kalan alanlar listeye girmez */
export function planChanges(snap: MetadataSnapshot, desired: Record<string, Partial<Record<AscField, unknown>>>): PlannedChange[] {
  const out: PlannedChange[] = [];
  for (const [locale, fields] of Object.entries(desired ?? {})) {
    const loc = snap.locales[locale];
    for (const field of ASC_FIELDS) {
      const raw = fields?.[field];
      if (raw === undefined) continue;
      const to = typeof raw === 'string' ? raw.trim() : '';
      const from = loc?.values[field] ?? '';
      if (loc && to === from) continue;
      const length = countCharacters(to);
      const limit = FIELD_LIMITS[field];
      let reason: string | undefined;
      if (typeof raw !== 'string') reason = 'Değer metin olmalı';
      else if (!loc) reason = `"${locale}" dili App Store Connect'te yok — önce orada ekle`;
      else if (scopeOf(field) === 'appInfo' ? !loc.appInfoLocId : !loc.versionLocId) reason = `"${locale}" için bu alanın kaydı yok`;
      else if (length > limit) reason = `${length}/${limit} karakter — sınır aşıldı`;
      else if (!to && REQUIRED.has(field)) reason = 'Bu alan boş bırakılamaz';
      else reason = fieldEditable(field, snap) ?? undefined;
      out.push({ locale, field, from, to, length, limit, ok: !reason, ...(reason ? { reason } : {}) });
    }
  }
  return out;
}

export interface Conflict { locale: string; field: AscField; expected: string; actual: string }

/** Plandan sonra ASC'de degisen alan var mi? (baskasi panelden degistirdiyse yazma) */
export function detectConflicts(changes: PlannedChange[], current: MetadataSnapshot): Conflict[] {
  return changes
    .filter((c) => c.ok)
    .map((c) => ({ locale: c.locale, field: c.field, expected: c.from, actual: current.locales[c.locale]?.values[c.field] ?? '' }))
    .filter((c) => c.expected !== c.actual);
}

export interface PatchGroup { scope: 'appInfo' | 'version'; locId: string; locale: string; attributes: Partial<Record<AscField, string>>; from: Partial<Record<AscField, string>> }

/** Yerellestirme basina TEK PATCH (alanlar birlikte gider) */
export function groupPatches(changes: PlannedChange[], snap: MetadataSnapshot): PatchGroup[] {
  const groups = new Map<string, PatchGroup>();
  for (const c of changes) {
    if (!c.ok) continue;
    const scope = scopeOf(c.field);
    const locId = scope === 'appInfo' ? snap.locales[c.locale]?.appInfoLocId : snap.locales[c.locale]?.versionLocId;
    if (!locId) continue;
    const key = `${scope}:${locId}`;
    const g = groups.get(key) ?? { scope, locId, locale: c.locale, attributes: {}, from: {} };
    g.attributes[c.field] = c.to;
    g.from[c.field] = c.from;
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** Ham ASC yanitlarindan anlik goruntu */
export function buildSnapshot(input: {
  versions: Array<{ id: string; attributes?: any }>;
  appInfos: Array<{ id: string; attributes?: any }>;
  versionLocs: Array<{ id: string; attributes?: any }>;
  appInfoLocs: Array<{ id: string; attributes?: any }>;
  version: (VersionRef & { editable: boolean }) | null;
  appInfo: (AppInfoRef & { editable: boolean }) | null;
}): MetadataSnapshot {
  const locales: Record<string, LocaleValues> = {};
  const at = (l: string) => (locales[l] ??= { values: {} });
  for (const l of input.appInfoLocs) {
    const a = l.attributes ?? {};
    if (!a.locale) continue;
    const e = at(a.locale);
    e.appInfoLocId = l.id;
    e.values.name = a.name ?? '';
    e.values.subtitle = a.subtitle ?? '';
  }
  for (const l of input.versionLocs) {
    const a = l.attributes ?? {};
    if (!a.locale) continue;
    const e = at(a.locale);
    e.versionLocId = l.id;
    e.values.description = a.description ?? '';
    e.values.keywords = a.keywords ?? '';
    e.values.promotionalText = a.promotionalText ?? '';
    e.values.whatsNew = a.whatsNew ?? '';
  }
  return {
    version: input.version,
    appInfo: input.appInfo,
    isFirstVersion: input.versions.length <= 1,
    locales,
  };
}
