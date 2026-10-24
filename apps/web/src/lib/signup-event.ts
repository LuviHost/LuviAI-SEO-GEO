/**
 * GA4 `sign_up` olayi: yeni hesap ilk girisi tamamladiginda bir kez.
 *
 * Sinyal: hesap auth.ts signIn callback'inde olusturulur (Google ile ilk
 * giris); hemen ardindan gelen jwt callback'i (ilk giris dali) kaydin
 * createdAt'ini okur ve hesap SIGNUP_FRESH_MS icinde olusturulduysa token'a
 * `signupAt` yazar. Var olan hesabin girisi bu pencereye girmez. NEDEN
 * Auth.js'in isNewUser / trigger 'signUp'u degil: kullaniciyi adaptor degil
 * signIn callback'i olusturuyor, adaptor hesabi mevcut buldugu icin o bayrak
 * hic dogru olmaz.
 *
 * Istemci (components/signup-event.tsx) oturumdan signupAt'i okur ve olayi
 * yalniz su kosullarda gonderir:
 *  - cerez onayi 'granted' ve window.gtag var (onaysiz hic gonderilmez; gtag
 *    yalniz lib/consent.ts loadTrackers onayla calisinca tanimlanir);
 *  - kayit SIGNUP_EVENT_WINDOW_MS icinde (onay kayittan biraz sonra verilirse
 *    de sayilir, gunler sonra degil);
 *  - bu tarayicida bu kayit icin daha once gonderilmemis (localStorage isareti;
 *    yenileme ve diger sekmeler ikinci kez saymaz). Depo kullanilamiyorsa
 *    gonderilmez: eksik saymak cift saymaktan iyidir.
 *
 * Olaya kisisel veri girmez: yalniz { method: 'google' } (e-posta, ad, kullanici
 * kimligi yok). Isaret degeri hesabin olusturulma zamanidir; yalniz tarayicida
 * kalir, Google'a gitmez.
 */
import type { ConsentState } from './consent';

/** Hesap olusturma ile ilk girisin tamamlanmasi arasindaki azami fark (saat kaymasi payi dahil) */
export const SIGNUP_FRESH_MS = 10 * 60 * 1000;

/** Kayittan sonra olayin hala gonderilebilecegi sure (onay sonradan verilirse) */
export const SIGNUP_EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** localStorage anahtari: gonderilen kaydin signupAt degeri */
export const SIGNUP_MARKER_KEY = 'ranksup-ga-signup';

/**
 * jwt callback (ilk giris): hesap az once olusturulduysa olusturulma zamani,
 * degilse null.
 */
export function freshSignupAt(createdAt: Date | number | null | undefined, now: number): number | null {
  if (createdAt === null || createdAt === undefined) return null;
  const t = createdAt instanceof Date ? createdAt.getTime() : createdAt;
  if (!Number.isFinite(t)) return null;
  return Math.abs(now - t) <= SIGNUP_FRESH_MS ? t : null;
}

/** Olay hala gonderilebilir mi (oturumdaki signupAt gecerli ve pencere icinde) */
export function signupEventDue(signupAt: unknown, now: number): signupAt is number {
  if (typeof signupAt !== 'number' || !Number.isFinite(signupAt) || signupAt <= 0) return false;
  return now - signupAt <= SIGNUP_EVENT_WINDOW_MS && signupAt - now <= SIGNUP_FRESH_MS;
}

export interface SignupMarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SignupEventEnv {
  consent: ConsentState;
  gtag: unknown;
  now: number;
  /** Erisimin kendisi de hata atabilir (gizli pencere); yakalanir */
  storage: () => SignupMarkerStorage | null | undefined;
}

/** Kosullar tutarsa sign_up gonderir, isareti yazar; gonderildiyse true */
export function sendSignupEvent(env: SignupEventEnv, signupAt: unknown): boolean {
  if (env.consent !== 'granted') return false;
  if (typeof env.gtag !== 'function') return false;
  if (!signupEventDue(signupAt, env.now)) return false;
  const marker = String(signupAt);
  try {
    const s = env.storage();
    if (!s || s.getItem(SIGNUP_MARKER_KEY) === marker) return false;
    // Isaret once: yazilamazsa gonderilmez (her yenilemede yeniden sayilmasin)
    s.setItem(SIGNUP_MARKER_KEY, marker);
  } catch {
    return false;
  }
  try {
    (env.gtag as (...args: unknown[]) => void)('event', 'sign_up', { method: 'google' });
  } catch {
    /* olcum hatasi uygulamayi etkilemesin */
  }
  return true;
}
