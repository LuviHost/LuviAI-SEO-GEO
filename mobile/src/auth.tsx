/**
 * Kimlik durumu — SecureStore'da saklanan Bearer token.
 * Kaynak: (a) `luvi_` API anahtarı, (b) native Google/Apple girişinden dönen session JWT.
 * Backend AuthGuard ikisini de Bearer olarak kabul eder.
 *
 * NOT: Google/Apple native modülleri Expo Go'da YOKTUR; bu yüzden lazy `require` ile
 * yüklenir — Expo Go'da uygulama çökmez, butonlar "derleme gerekir" hatası verir; EAS
 * dev/prod build'de gerçek native giriş çalışır.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { mobileGoogleLogin, mobileAppleLogin, listSites, type Site } from './api';
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, GOOGLE_CONFIGURED } from './authConfig';

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

const TOKEN_KEY = 'ranksup.authToken';
const SITE_KEY = 'ranksup.activeSiteId';

type Result = { ok: true } | { ok: false; error: string };

interface AuthState {
  token: string | null;
  sites: Site[];
  activeSite: Site | null;
  connected: boolean;
  loading: boolean; // başlangıç yüklemesi
  appleSupported: boolean; // Apple ile devam et yalnızca iOS'ta
  connect: (token: string) => Promise<Result>;
  signInWithGoogle: () => Promise<Result>;
  signInWithApple: () => Promise<Result>;
  disconnect: () => Promise<void>;
  setActiveSite: (siteId: string) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [activeSite, setActiveSiteState] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);

  // Açılışta saklanan token'ı yükle ve doğrula
  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!saved) return;
        const savedSiteId = await SecureStore.getItemAsync(SITE_KEY);
        const list = await listSites(saved); // 401 ise atar → token temizlenir
        setToken(saved);
        setSites(list);
        setActiveSiteState(list.find((s) => s.id === savedSiteId) ?? list[0] ?? null);
      } catch {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const connect = useCallback(async (raw: string): Promise<Result> => {
    const t = raw.trim();
    if (!t) return { ok: false, error: 'Bir anahtar gir.' };
    try {
      const list = await listSites(t);
      await SecureStore.setItemAsync(TOKEN_KEY, t);
      setToken(t);
      setSites(list);
      const first = list[0] ?? null;
      setActiveSiteState(first);
      if (first) await SecureStore.setItemAsync(SITE_KEY, first.id);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'Bağlanılamadı.' };
    }
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<Result> => {
    if (!GOOGLE_CONFIGURED) return { ok: false, error: 'Google giriş henüz yapılandırılmadı (client ID gerekli).' };
    let GoogleSignin: any;
    try {
      GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
    } catch {
      return { ok: false, error: 'Google girişi uygulama derlemesi gerektirir (Expo Go’da çalışmaz).' };
    }
    try {
      GoogleSignin.configure({ iosClientId: GOOGLE_IOS_CLIENT_ID, webClientId: GOOGLE_WEB_CLIENT_ID });
      await GoogleSignin.hasPlayServices();
      const res: any = await GoogleSignin.signIn();
      if (res?.type === 'cancelled') return { ok: false, error: 'Giriş iptal edildi.' };
      const idToken: string | undefined = res?.data?.idToken ?? res?.idToken;
      if (!idToken) return { ok: false, error: 'Google kimliği alınamadı.' };
      const jwt = await mobileGoogleLogin(idToken);
      return await connect(jwt);
    } catch (e: any) {
      if (e?.code === 'SIGN_IN_CANCELLED') return { ok: false, error: 'Giriş iptal edildi.' };
      return { ok: false, error: e?.message ?? 'Google girişi başarısız.' };
    }
  }, [connect]);

  const signInWithApple = useCallback(async (): Promise<Result> => {
    if (Platform.OS !== 'ios') return { ok: false, error: 'Apple girişi yalnızca iOS’ta.' };
    let Apple: any;
    try {
      Apple = require('expo-apple-authentication');
    } catch {
      return { ok: false, error: 'Apple girişi uygulama derlemesi gerektirir (Expo Go’da çalışmaz).' };
    }
    try {
      // Apple'a HASH'lenmiş nonce gider; raw nonce sunucuya gidip replay'e karşı doğrulanır
      const rawNonce = bytesToHex(await Crypto.getRandomBytesAsync(16));
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce); // hex
      const cred = await Apple.signInAsync({
        requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL],
        nonce: hashedNonce,
      });
      if (!cred.identityToken) return { ok: false, error: 'Apple kimliği alınamadı.' };
      const fullName = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(' ') || undefined;
      const jwt = await mobileAppleLogin({
        identityToken: cred.identityToken,
        rawNonce,
        fullName,
      });
      return await connect(jwt);
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return { ok: false, error: 'Giriş iptal edildi.' };
      return { ok: false, error: e?.message ?? 'Apple girişi başarısız.' };
    }
  }, [connect]);

  const disconnect = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(SITE_KEY);
    setToken(null);
    setSites([]);
    setActiveSiteState(null);
  }, []);

  const setActiveSite = useCallback((siteId: string) => {
    setSites((cur) => {
      const found = cur.find((s) => s.id === siteId);
      if (found) {
        setActiveSiteState(found);
        SecureStore.setItemAsync(SITE_KEY, siteId).catch(() => {});
      }
      return cur;
    });
  }, []);

  return React.createElement(
    Ctx.Provider,
    {
      value: {
        token,
        sites,
        activeSite,
        connected: !!token,
        loading,
        appleSupported: Platform.OS === 'ios',
        connect,
        signInWithGoogle,
        signInWithApple,
        disconnect,
        setActiveSite,
      },
    },
    children,
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return v;
}
