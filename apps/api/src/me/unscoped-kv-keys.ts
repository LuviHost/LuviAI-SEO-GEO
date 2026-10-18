import { asaKvKeys } from '../aso/asa/asa-rules.js';
import { promptLocalKey } from '../audit/prompt-local-key.js';

/**
 * kv_store'da anahtari kullanici ya da site kimligi TASIMAYAN ama kisiye ait
 * kayitlar. Hesap silme (account-purge.plan.ts) ve site silme
 * (sites.service.ts siteRemovalSteps) planlarinin "anahtar kimligi icerir"
 * kv adimi bunlari yakalamaz; iki plan da toplanan alt kayit kimlikleriyle
 * acikca siler. Bu kayitlarin cogunda expiresAt da yok: silinmezlerse sonsuza
 * kalirlar (gunluk kv temizligi yalniz suresi dolani siler).
 */

/** Prompt Lab yerel sonucu — sitenin telefonu/adresi (bkz. audit/prompt-local-key.ts) */
export function promptLocalKeys(promptIds: string[]): string[] {
  return promptIds.map(promptLocalKey);
}

/**
 * ASA hesabinin durum anahtarlari: secilen reklam hesabi kimligi, son senkron
 * API surumu, geri doldurma isareti (aso/asa/asa-rules.ts asaKvKeys). Oradaki
 * her anahtar ureticisi kullanilir: yeni anahtar eklenirse silme planina da girer.
 */
export function asaStateKeys(accountIds: string[]): string[] {
  const builders = Object.values(asaKvKeys) as Array<(accountId: string) => string>;
  return accountIds.flatMap((id) => builders.map((key) => key(id)));
}
