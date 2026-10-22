import { SetMetadata } from '@nestjs/common';

export const TRIAL_READ_ONLY_EXEMPT_KEY = 'trialReadOnlyExempt';
export const AI_ACTION_KEY = 'trialAiAction';

/**
 * Deneme suresi dolmus (salt okunur) hesapta da calismasi GEREKEN degistirici
 * uclar: odeme / plan secimi, hesap silme, oturum ve baglanti kesme, bildirim
 * okundu. TrialExpiryGuard bu isareti tasimayan her POST/PUT/PATCH/DELETE'i
 * reddeder.
 *
 * NEDEN izin listesi (yasak listesi degil): yeni eklenen bir yapay zeka ucu
 * isaretlenmeyi unutulsa da suresi dolan hesapta LLM harcamaz. Unutulan izin ise
 * yalniz o eylemi engeller; odeme ve hesap silme bu dosyadaki isaretle korunur
 * ve trial-expiry.guard.spec.ts onlari ayrica dener.
 */
export const TrialReadOnlyExempt = () => SetMetadata(TRIAL_READ_ONLY_EXEMPT_KEY, true);

/**
 * Yapay zeka maliyeti olan GET ucu (ornegin AI kampanya onerisi). GET normalde
 * salt okunur hesapta aciktir (goruntuleme, indirme); bu isaretli GET'ler
 * suresi dolan hesapta reddedilir.
 */
export const AiAction = () => SetMetadata(AI_ACTION_KEY, true);
