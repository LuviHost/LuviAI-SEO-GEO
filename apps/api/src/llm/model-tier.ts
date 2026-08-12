import type { SettingsService } from '../settings/settings.service.js';

/**
 * Model kademesi — cagrinin KIMIN icin yapildigi.
 *
 *   'anon'   → oturum acmamis ziyaretci (landing citation-check, persona chat
 *              widget'i). Bedava, kimlik yok, rate limit disinda fren yok →
 *              ucuz model.
 *   'member' → giris yapmis kullanici (onboarding, dashboard, brain, makale).
 *              Bedelini odedigi kalite → Opus 5.
 *
 * NEDEN AYRI BIR HELPER: bu cagrilar LLMProviderService'ten degil dogrudan
 * Anthropic SDK'sindan geciyor, yani merkezi router'in model secimi onlara
 * ulasmiyor. Servislerin her biri SettingsService'i zaten global olarak
 * enjekte edebildigi icin Nest provider'i yerine saf fonksiyon: yeni modul
 * bagimliligi (SitesModule → LLMModule) acmadan calisir.
 *
 * OLCUM CAGRILARI BU AYRIMA GIRMEZ: citation probe'lari "gercek bir kullanici
 * bu soruyu sorsa marka anilir miydi?" sorusunu olcer. Modeli kademeye gore
 * degistirmek cetveli degistirmek olur — ayni domain icin anonim ve uye
 * sonuclari kiyaslanamaz hale gelir (ustelik 24h snapshot cache'i ikisi
 * arasinda paylasiliyor). Probe modeli herkes icin sabit kalir.
 */
export type Audience = 'anon' | 'member';

export const ANON_MODEL_FALLBACK = 'claude-haiku-4-5';
export const MEMBER_MODEL_FALLBACK = 'claude-opus-5';

/**
 * Kademeye gore model adi. Admin panelden MODEL_ANON / MODEL_MEMBER ile
 * degistirilebilir; ayar okunamazsa sabit fallback'e duser (AI cagrisi
 * ayar tablosu yuzunden hic dusmesin).
 */
export async function modelForAudience(
  settings: SettingsService | undefined,
  audience: Audience,
): Promise<string> {
  const fallback = audience === 'anon' ? ANON_MODEL_FALLBACK : MEMBER_MODEL_FALLBACK;
  if (!settings) return fallback;
  try {
    const value = (await settings.getString(audience === 'anon' ? 'MODEL_ANON' : 'MODEL_MEMBER'))?.trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}
