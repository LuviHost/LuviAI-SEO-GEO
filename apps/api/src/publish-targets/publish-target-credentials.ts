import { decrypt, decryptCredentials } from '@luviai/shared';
import { LEGACY_CREDENTIAL_KEYS, publishTargetCatalog } from './publish-target-catalog.js';

/**
 * Yayin hedefi kimlik bilgisi — okuma ve KISMI guncelleme.
 *
 * NEDEN VAR: update() gelen kimlik nesnesini kaydin TAMAMININ yerine
 * yaziyordu; panel formu ise duzenlemede yalniz doldurulan alanlari gonderir
 * ("Mevcut giriş bilgilerini değiştirmek istemiyorsan boş bırak"). WordPress'te
 * yalniz App Password degisince Site URL ve kullanici adi, WHMCS'e yalniz
 * erisim anahtari eklenince adres + kimlik siliniyordu; hedef sessizce
 * bozuluyordu.
 *
 * GUNCELLEME SOZLESMESI (PUT /publish-targets/:id govdesindeki `credentials`):
 *  - alan yok, undefined, bos ya da yalniz bosluk dize → kayitli deger KORUNUR;
 *  - null → alan SILINIR (acik temizleme; panelde istege bagli alanlarin
 *    "Kayıtlı değeri sil" kutusu bunu gonderir);
 *  - diger her deger (dize, sayi...) → yazilir.
 * Eski adla gelen alan katalog adina tasinir; katalog adi yazilinca ya da
 * silinince eski adli kopya da silinir (LEGACY_CREDENTIAL_KEYS). Kalsaydi:
 * adaptor eski adi yedek olarak okudugu icin "silinen" deger kullanilmaya
 * devam ederdi; formda gorunmeyen eski adres de kayitta kalip birlesik adres
 * denetimini duzeltilemez bicimde kilitleyebilirdi.
 */

export type StoredCredentials = { ok: true; creds: Record<string, unknown> } | { ok: false };

/**
 * Kayitli kimligi cozer. Yeni bicim `{ enc }` (tum alanlar tek sifreli JSON)
 * cozulemezse ok:false — anahtar degismis ya da kayit bozuk; cagiran kullaniciya
 * bilgileri yeniden girmesini soyler. Eski bicim (alan alan sifreli ya da duz
 * nesne) yayincinin kullandigi decryptCredentials ile okunur: test ve
 * guncelleme adaptorun gordugu degerle calissin.
 */
export function readStoredCredentials(raw: unknown): StoredCredentials {
  if (raw === null || raw === undefined) return { ok: true, creds: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const record = raw as Record<string, unknown>;
  if (record.enc !== undefined && record.enc !== null) {
    if (typeof record.enc !== 'string') return { ok: false };
    try {
      const parsed: unknown = JSON.parse(decrypt(record.enc));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ok: true, creds: parsed as Record<string, unknown> }
        : { ok: false };
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, creds: decryptCredentials(record) };
}

/** Sozlesmeye gore bu deger kaydi degistirir mi (bos dize/undefined: hayir; null: temizle) */
export function isCredentialChange(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/** Nesne prototipini degistirebilecek anahtarlar hic yazilmaz */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Kayitli kimlik + kismi yama → yazilacak kimlik. `changed` false ise yamada
 * etkili bir degisiklik yok (hepsi bos): kimlik hic yazilmamali.
 */
export function mergeCredentials(
  type: string,
  prev: Record<string, unknown>,
  patch: Record<string, unknown>,
): { merged: Record<string, unknown>; changed: boolean } {
  const aliases = LEGACY_CREDENTIAL_KEYS[type] ?? {};
  const merged: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(prev)) if (!UNSAFE_KEYS.has(k)) merged[k] = v;

  let changed = false;
  for (const [rawKey, value] of Object.entries(patch)) {
    if (UNSAFE_KEYS.has(rawKey) || !isCredentialChange(value)) continue;
    const key = aliases[rawKey] ?? rawKey;
    // Ayni alan katalog adiyla da geldiyse o kazanir (adaptorlerin okuma sirasi)
    if (key !== rawKey && isCredentialChange(patch[key])) continue;
    for (const [legacy, canonical] of Object.entries(aliases)) {
      if (canonical === key) delete merged[legacy];
    }
    if (value === null) delete merged[key];
    else merged[key] = value;
    changed = true;
  }
  return { merged, changed };
}

/**
 * Kayitli kimlik okunamadiginda (birlestirilecek bir sey yok) yamada eksik
 * kalan ZORUNLU alanlarin formdaki etiketleri. Bos degilse kismi kayit
 * yapilmaz: hedef sessizce yarim kalirdi.
 */
export function missingRequiredCredentialLabels(type: string, patch: Record<string, unknown>): string[] {
  const entry = publishTargetCatalog().find((c) => c.type === type);
  if (!entry) return [];
  const aliases = LEGACY_CREDENTIAL_KEYS[type] ?? {};
  const provided = new Set<string>();
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && isCredentialChange(v)) provided.add(aliases[k] ?? k);
  }
  return entry.fields.filter((f) => f.required && !provided.has(f.key)).map((f) => f.label);
}
