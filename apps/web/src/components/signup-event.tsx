'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  CONSENT_CHANGE_EVENT,
  CONSENT_STORAGE_KEY,
  browserConsentStorage,
  readConsent,
  type TagWindow,
} from '@/lib/consent';
import { sendSignupEvent } from '@/lib/signup-event';

/**
 * Yeni hesabin GA4 `sign_up` olayi (kosullar ve sinyal: lib/signup-event.ts).
 * Hicbir sey cizmez. Onay kayittan sonra verilirse de bir kez gonderilir: bant
 * once CONSENT_CHANGE_EVENT yayar, sonra etiketleri yukler; deneme bu yuzden
 * bir sonraki gorev turuna (setTimeout 0) birakilir. Ilk deneme de oyle:
 * CookieConsent'in ilk okuma efekti once calissin.
 */
export function SignupEvent() {
  const { data } = useSession();
  const signupAt = data?.user?.signupAt;

  useEffect(() => {
    if (typeof signupAt !== 'number') return;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      if (done) return;
      done = sendSignupEvent(
        {
          consent: readConsent(browserConsentStorage, Date.now()),
          gtag: (window as unknown as TagWindow).gtag,
          now: Date.now(),
          storage: () => window.localStorage,
        },
        signupAt,
      );
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(attempt, 0);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === CONSENT_STORAGE_KEY) schedule();
    };
    schedule();
    window.addEventListener(CONSENT_CHANGE_EVENT, schedule);
    window.addEventListener('storage', onStorage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(CONSENT_CHANGE_EVENT, schedule);
      window.removeEventListener('storage', onStorage);
    };
  }, [signupAt]);

  return null;
}
