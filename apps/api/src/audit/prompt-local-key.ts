/**
 * Prompt Lab yerel sonucunun kv_store anahtari: `prompt-local:<promptId>`.
 *
 * Deger sitenin telefonunu, adresini ve AI cevaplarindaki telefon/adres
 * parcalarini tasir (prompt-lab.service.ts LocalRunSummary). Anahtar kullanici
 * ya da site kimligi TASIMAZ; bu yuzden hesap silme (me/account-purge.plan.ts)
 * ve site silme (sites/sites.service.ts siteRemovalSteps) planlarinin "anahtar kimligi icerir"
 * kv filtresi bu kayitlari yakalamaz — iki plan da toplanan prompt
 * kimlikleriyle bu anahtari acikca siler.
 *
 * NEDEN AYRI DOSYA: planlar Nest servisini (ve onun bagimliliklarini) ice
 * aktarmadan ayni anahtari uretebilsin; anahtar bicimi tek yerde degissin.
 */
export const PROMPT_LOCAL_KEY_PREFIX = 'prompt-local:';

export function promptLocalKey(promptId: string): string {
  return `${PROMPT_LOCAL_KEY_PREFIX}${promptId}`;
}
