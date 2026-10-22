import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signIn, ACCOUNT_DELETED_SIGNIN_ERROR } from '@/auth';
import { Button } from '@/components/ui/button';
import { BrandWordmark } from '@/components/brand-logo';

/** Ayni parametre URL'de iki kez gelirse Next.js dizi verir */
type SearchParam = string | string[] | undefined;

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: SearchParam; error?: SearchParam }>;
};

/**
 * ?error= kodu -> gosterilecek sabit metin. URL'deki metin ASLA ekrana basilmaz:
 * eskiden decodeURIComponent(error) yaziliyordu; herkes /signin?error=<istedigi
 * cumle> linkiyle RanksUp sayfasinda sahte uyari gosterebiliyordu (icerik
 * enjeksiyonu), bozuk bir % dizisi de sayfayi URIError ile dusuruyordu.
 *
 * Kodlar: AccountDeleted bizim (auth.ts signIn). Digerleri Auth.js'in istemciye
 * actigi hata turleri; geri kalan her hata "Configuration" olarak gelir
 * (@auth/core 0.41.2 errors.js clientErrors, index.js). Uygulamada yalniz
 * Google OAuth + JWT oturumu var: Verification (e-posta linki), CredentialsSignin,
 * AccountNotLinked / WebAuthnVerificationError (WebAuthn) uretilemez.
 * Map: '__proto__' / 'constructor' gibi anahtarlar nesne prototipine dusmez.
 */
const SIGNIN_ERRORS = new Map<string, string>([
  [ACCOUNT_DELETED_SIGNIN_ERROR, 'Bu hesap için silme talebi alındı; hesaba erişim kapatıldı. Verileriniz talepten 30 gün sonra kalıcı olarak silinir.'],
  // signIn geri cevirdi (Google e-posta vermedi) ya da hesap kaydi sirasinda hata olustu
  ['AccessDenied', 'Giriş onaylanmadı. Lütfen Google hesabınızla yeniden deneyin.'],
  // Izin ekrani iptal edildi ya da Google hata dondu
  ['OAuthCallbackError', 'Google ile giriş tamamlanmadı: izin ekranı kapatılmış ya da Google bir hata döndürmüş olabilir. Lütfen yeniden deneyin.'],
  ['OAuthAccountNotLinked', 'Bu Google hesabı başka bir RanksUp hesabıyla ilişkili. Çıkış yapıp o hesapla giriş yapmayı deneyin.'],
  ['MissingCSRF', 'Güvenlik doğrulaması tamamlanamadı. Sayfayı yenileyip yeniden deneyin.'],
  // Cogunlukla durum (state/PKCE) cerezi eksik: cerez engeli ya da bekletilen giris sekmesi
  ['Configuration', 'Giriş tamamlanamadı. Sayfayı yenileyip yeniden deneyin; tarayıcınızın çerezlere izin verdiğinden emin olun.'],
]);
const SIGNIN_ERROR_FALLBACK = 'Giriş tamamlanamadı. Lütfen yeniden deneyin.';

const firstParam = (v: SearchParam): string | undefined => (Array.isArray(v) ? v[0] : v);

function signInErrorText(code: string | undefined): string | null {
  if (!code) return null;
  return SIGNIN_ERRORS.get(code) ?? SIGNIN_ERROR_FALLBACK;
}

export const metadata = {
  title: 'Giriş yap veya hesap oluştur — RanksUp panele eriş',
  description: 'RanksUp hesabınla giriş yap veya yeni hesap aç. 14 gün ücretsiz deneme, 2 makale, kredi kartı gerekmez. PayTR güvenli ödeme, aylık iptal hakkı.',
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await auth();
  const params = await searchParams;
  // Open-redirect engeli: yalnızca uygulama-içi göreli yol ('/...') kabul; protocol-relative ('//')
  // ve backslash kaçışları reddedilir, aksi halde /dashboard'a düşülür.
  const rawCallback = firstParam(params.callbackUrl) ?? '/dashboard';
  const callbackUrl =
    rawCallback.startsWith('/') && !rawCallback.startsWith('//') && !rawCallback.startsWith('/\\')
      ? rawCallback
      : '/dashboard';
  const errorText = signInErrorText(firstParam(params.error));

  if (session?.user) redirect(callbackUrl);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* gradient blobs */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-brand-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-20 -right-20 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center">
            <BrandWordmark size={32} />
          </Link>
          <p className="text-muted-foreground mt-3 text-sm">
            Türkiye&apos;nin AI destekli SEO/GEO içerik platformu
          </p>
        </div>

        <div className="rounded-2xl border bg-background/80 backdrop-blur-xl shadow-xl p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold">Giriş yap veya kayıt ol</h1>
            <p className="text-sm text-muted-foreground mt-1">
              14 gün ücretsiz deneme · 2 makale — kart bilgisi gerekmez
            </p>
          </div>

          {errorText && (
            <div role="alert" className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm p-3 rounded-lg">
              {errorText}
            </div>
          )}

          <form
            action={async () => {
              'use server';
              await signIn('google', { redirectTo: callbackUrl });
            }}
          >
            <Button type="submit" variant="outline" className="w-full h-12 text-base hover:border-brand-500/30 transition-colors" size="lg">
              <GoogleIcon className="h-5 w-5 mr-3" />
              Google ile devam et
            </Button>
          </form>

          <div className="relative flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex-1 h-px bg-border" />
            <span>güvenli OAuth 2.0 ile</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <p className="text-xs text-center text-muted-foreground leading-relaxed">
            Devam ederek{' '}
            <Link href="/terms" className="underline hover:text-brand-600 transition-colors">
              Kullanım Koşulları
            </Link>{' '}
            ve{' '}
            <Link href="/privacy" className="underline hover:text-brand-600 transition-colors">
              Gizlilik Politikası
            </Link>
            &apos;nı kabul etmiş olursun.
          </p>
        </div>

        <p className="text-center text-sm">
          <Link href="/" className="text-muted-foreground hover:text-brand-600 transition-colors">
            ← Ana sayfaya dön
          </Link>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
