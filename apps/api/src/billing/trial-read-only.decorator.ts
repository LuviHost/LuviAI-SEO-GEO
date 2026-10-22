import { SetMetadata } from '@nestjs/common';

export const TRIAL_READ_ONLY_EXEMPT_KEY = 'trialReadOnlyExempt';
export const AI_ACTION_KEY = 'trialAiAction';

/**
 * Deneme suresi dolmus (salt okunur) hesapta da calismasi GEREKEN degistirici
 * uclar: odeme / plan secimi, hesap silme, oturum ve baglanti kesme, bildirim
 * okundu, MCP tasima ucu (arac bazinda denetlenir). TrialExpiryGuard bu isareti
 * tasimayan her POST/PUT/PATCH'i reddeder. DELETE isaretsiz de aciktir (silme ve
 * iptal yapay zeka harcamaz); yalniz @AiAction() isaretli DELETE reddedilir.
 *
 * NEDEN izin listesi (yasak listesi degil): yeni eklenen bir yapay zeka ucu
 * isaretlenmeyi unutulsa da suresi dolan hesapta LLM harcamaz. Unutulan izin ise
 * yalniz o eylemi engeller; odeme ve hesap silme bu dosyadaki isaretle korunur
 * ve trial-expiry.guard.spec.ts onlari ayrica dener.
 */
export const TrialReadOnlyExempt = () => SetMetadata(TRIAL_READ_ONLY_EXEMPT_KEY, true);

/**
 * Yapay zeka maliyeti olan GET ya da DELETE ucu (LLM cagiran okuma). GET ve DELETE
 * normalde salt okunur hesapta aciktir (goruntuleme, indirme, silme); bu isaretli
 * olanlar suresi dolan hesapta reddedilir. Yalniz gercekten LLM cagiran uca konur
 * (ASA kampanya onerisi kural tabanli; isaretli degil).
 */
export const AiAction = () => SetMetadata(AI_ACTION_KEY, true);
