/**
 * OAuth baglantisini panelde tamamlama + callback hata kodlarinin Turkce metni.
 *
 * NEDEN: API callback'i tarayicinin RanksUp oturumunu okuyamazsa (API ayri alan
 * adindaysa NextAuth cerezi oraya gitmez) yetkilendirme kodunu kisa sureli park
 * eder ve paneli `?gsc=finish&k=...` ile acar (reklam popup'inda
 * 'oauth-pending' mesaji). Akis burada, OTURUMLU bir istekle tamamlanir;
 * sunucu oturum kullanicisinin akisi baslatanla ayni oldugunu dogrular.
 *
 * lib/api.ts'teki request() ile ayni taban adres ve kimlik bilgisi kurali.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type OAuthProviderId = 'gsc' | 'ga' | 'google-ads' | 'meta-ads';

const FINISH_PATH: Record<OAuthProviderId, string> = {
  gsc: '/auth/gsc/finish',
  ga: '/auth/ga/finish',
  'google-ads': '/oauth/google-ads/finish',
  'meta-ads': '/oauth/meta-ads/finish',
};

/** Ayni anahtar iki kez gonderilmesin (StrictMode cift efekt, yeniden render) — sunucu da tek kullanimlik */
const sentKeys = new Set<string>();

export async function finishOAuthConnect<T = unknown>(provider: OAuthProviderId, key: string): Promise<T | null> {
  if (!key || sentKeys.has(key)) return null;
  sentKeys.add(key);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${FINISH_PATH[provider]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ key }),
    });
  } catch {
    throw new Error('Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.');
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* govdesiz cevap */ }
  if (!res.ok) {
    const msg = typeof body?.message === 'string' ? body.message : null;
    throw new Error(msg ?? (res.status === 401 ? 'Oturumun süresi dolmuş, giriş yapıp bağlantıyı yeniden başlat.' : 'Bağlantı tamamlanamadı. Bağlantıyı yeniden başlat.'));
  }
  return body as T;
}

const SCOPE_TEXT: Record<'gsc' | 'ga', string> = {
  gsc: 'Google izin ekranında Search Console erişim kutusunu işaretlemeniz gerekiyor. Bağlantıyı yeniden başlatıp Search Console erişimine izin verin.',
  ga: 'Google izin ekranında Google Analytics erişim kutusunu işaretlemeniz gerekiyor. Bağlantıyı yeniden başlatıp Analytics erişimine izin verin.',
};

const ERROR_TEXT: Record<string, string> = {
  state_invalid: 'Bağlantı isteği geçersiz ya da daha önce kullanılmış. Bağlantıyı yeniden başlatın.',
  state_expired: 'Bağlantı isteğinin süresi doldu (10 dakika). Bağlantıyı yeniden başlatın.',
  access_denied: 'İzin ekranında erişime izin verilmedi. Bağlanmak için yeniden başlatıp izin verin.',
  provider_error: 'Google bağlantıyı tamamlamadı. Lütfen tekrar deneyin.',
  session_mismatch: 'Bağlantıyı başlatan RanksUp hesabı ile bu tarayıcıdaki oturum eşleşmiyor. Aynı hesapla giriş yapıp bağlantıyı yeniden başlatın.',
  site_access_denied: 'Bu siteye erişim yetkiniz yok.',
  no_refresh_token: 'Google kalıcı erişim izni döndürmedi. Google hesabınızın güvenlik ayarlarından RanksUp erişimini kaldırıp yeniden bağlanın.',
  token_exchange_failed: 'Google’dan erişim anahtarı alınamadı. Bağlantıyı yeniden başlatın.',
};

/** `?gsc=error&gscerror=<kod>` → kullaniciya gosterilecek metin. Bilinmeyen kod ve eski serbest metin genel mesaja duser. */
export function oauthCallbackErrorText(provider: 'gsc' | 'ga', code: string | null | undefined): string {
  if (code === 'scope_not_granted') return SCOPE_TEXT[provider];
  if (code && Object.prototype.hasOwnProperty.call(ERROR_TEXT, code)) return ERROR_TEXT[code];
  return provider === 'gsc'
    ? 'Search Console bağlantısı tamamlanamadı, tekrar deneyin.'
    : 'Google Analytics bağlantısı tamamlanamadı, tekrar deneyin.';
}
