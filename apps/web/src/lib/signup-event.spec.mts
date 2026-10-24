/**
 * GA4 sign_up: yeni hesap sinyali (jwt callback), pencere, onay sarti, tek
 * gonderim (localStorage isareti) ve kisisel veri icermeyen yuk.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SIGNUP_EVENT_WINDOW_MS,
  SIGNUP_FRESH_MS,
  SIGNUP_MARKER_KEY,
  freshSignupAt,
  sendSignupEvent,
  signupEventDue,
  type SignupEventEnv,
  type SignupMarkerStorage,
} from './signup-event';

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const MIN = 60_000;

function memory(): SignupMarkerStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function env(over: Partial<SignupEventEnv> = {}) {
  const calls: unknown[][] = [];
  const store = memory();
  const e: SignupEventEnv = {
    consent: 'granted',
    gtag: (...a: unknown[]) => void calls.push(a),
    now: NOW,
    storage: () => store,
    ...over,
  };
  return { e, calls, store };
}

describe('freshSignupAt — jwt callback ilk giris', () => {
  it('az once olusturulan hesap yeni sayilir; eski hesap ve bozuk deger sayilmaz', () => {
    expect(freshSignupAt(new Date(NOW - 2_000), NOW)).toBe(NOW - 2_000);
    expect(freshSignupAt(NOW - SIGNUP_FRESH_MS, NOW)).toBe(NOW - SIGNUP_FRESH_MS);
    expect(freshSignupAt(new Date(NOW + MIN), NOW)).toBe(NOW + MIN); // saat kaymasi
    expect(freshSignupAt(NOW - SIGNUP_FRESH_MS - 1, NOW)).toBeNull();
    expect(freshSignupAt(new Date(NOW - 30 * 86_400_000), NOW)).toBeNull();
    expect(freshSignupAt(new Date('gecersiz'), NOW)).toBeNull();
    expect(freshSignupAt(null, NOW)).toBeNull();
    expect(freshSignupAt(undefined, NOW)).toBeNull();
  });

  it('pencere: kayittan 24 saat sonrasina kadar; sayi olmayan deger gecmez', () => {
    expect(signupEventDue(NOW - MIN, NOW)).toBe(true);
    expect(signupEventDue(NOW - SIGNUP_EVENT_WINDOW_MS, NOW)).toBe(true);
    expect(signupEventDue(NOW - SIGNUP_EVENT_WINDOW_MS - 1, NOW)).toBe(false);
    expect(signupEventDue(NOW + SIGNUP_FRESH_MS + 1, NOW)).toBe(false);
    for (const bad of [undefined, null, '1', NaN, Infinity, 0, -5]) expect(signupEventDue(bad, NOW), String(bad)).toBe(false);
  });
});

describe('sendSignupEvent', () => {
  const AT = NOW - 3 * MIN;

  it('onay + gtag + yeni kayit: sign_up bir kez, yalniz { method: google }', () => {
    const { e, calls, store } = env();
    expect(sendSignupEvent(e, AT)).toBe(true);
    expect(calls).toEqual([['event', 'sign_up', { method: 'google' }]]);
    expect(store.data.get(SIGNUP_MARKER_KEY)).toBe(String(AT));
    // Yenileme / ikinci sekme: isaret var, tekrar gonderilmez
    expect(sendSignupEvent(e, AT)).toBe(false);
    expect(sendSignupEvent({ ...e, now: NOW + MIN }, AT)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('kisisel veri yok: yukte yalniz method alani', () => {
    const { e, calls } = env();
    sendSignupEvent(e, AT);
    expect(Object.keys(calls[0][2] as object)).toEqual(['method']);
    expect(JSON.stringify(calls)).not.toMatch(/@|email|name|user_id|userId/i);
  });

  it('onay yoksa (ret / secim yok) ya da gtag yoksa gonderilmez ve isaret yazilmaz; onay sonra gelince gonderilir', () => {
    for (const consent of ['denied', 'unset'] as const) {
      const { e, calls, store } = env({ consent });
      expect(sendSignupEvent(e, AT), consent).toBe(false);
      expect(calls).toHaveLength(0);
      expect(store.data.size).toBe(0);
    }
    const yok = env({ gtag: undefined });
    expect(sendSignupEvent(yok.e, AT)).toBe(false);
    expect(yok.store.data.size).toBe(0);
    // Ayni tarayicida onay sonradan verildi (pencere icinde): bir kez
    const sonra = env({ consent: 'unset' });
    expect(sendSignupEvent(sonra.e, AT)).toBe(false);
    expect(sendSignupEvent({ ...sonra.e, consent: 'granted' }, AT)).toBe(true);
    expect(sonra.calls).toHaveLength(1);
  });

  it('oturumda signupAt yok ya da pencere disi: gonderilmez', () => {
    const { e, calls } = env();
    expect(sendSignupEvent(e, undefined)).toBe(false);
    expect(sendSignupEvent(e, NOW - SIGNUP_EVENT_WINDOW_MS - 1)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('depo kullanilamiyorsa gonderilmez (her yenilemede yeniden sayilmasin)', () => {
    const throwing = () => {
      throw new Error('SecurityError');
    };
    for (const storage of [throwing, () => null, () => ({ getItem: () => null, setItem: throwing })]) {
      const { e, calls } = env({ storage });
      expect(sendSignupEvent(e, AT)).toBe(false);
      expect(calls).toHaveLength(0);
    }
  });

  it('ayni tarayicida baska yeni hesap ayrica sayilir; gtag hatasi disari tasmaz', () => {
    const { e, calls } = env();
    expect(sendSignupEvent(e, AT)).toBe(true);
    expect(sendSignupEvent(e, AT + MIN)).toBe(true);
    expect(calls).toHaveLength(2);
    const bozuk = env({
      gtag: () => {
        throw new Error('gtag');
      },
    });
    expect(() => sendSignupEvent(bozuk.e, AT)).not.toThrow();
  });
});

describe('kaynak: sinyal ve bilesen baglantisi', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('jwt ilk giris dali signupAt yazar; oturum yalniz pencere icinde verir', () => {
    const auth = read('../auth.ts');
    expect(auth).toContain('const signupAt = freshSignupAt(dbUser.createdAt, Date.now());');
    expect(auth).toContain('if (signupEventDue(signupAt, Date.now())) session.user.signupAt = signupAt;');
  });

  it('bilesen onayi depodan okur, window.gtag kullanir, onay degisiminde yeniden dener; kok layout baglar', () => {
    const c = read('../components/signup-event.tsx');
    expect(c).toContain('consent: readConsent(browserConsentStorage, Date.now())');
    expect(c).toContain('gtag: (window as unknown as TagWindow).gtag');
    expect(c).toContain('window.addEventListener(CONSENT_CHANGE_EVENT, schedule)');
    expect(c).not.toMatch(/email|user\.id|user\.name/);
    expect(read('../app/layout.tsx')).toContain('<SignupEvent />');
  });
});
