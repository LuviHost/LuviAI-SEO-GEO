import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signIn, ACCOUNT_DELETED_SIGNIN_ERROR } from '@/auth';
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

// noindex: giris sayfasi aramada sonuc olarak degersiz; kok layout'un canonical'ini (ana sayfa) miras
// aldigi icin Google onu ana sayfanin kopyasi sayip www kopyasini asil seciyordu (GSC URL denetimi
// 11.11.2026). follow kalir: sayfadaki baglantilar taranabilir.
export const metadata = {
  title: 'Giriş yap veya hesap oluştur — RanksUp panele eriş',
  description: 'RanksUp hesabınla giriş yap veya yeni hesap aç. 14 gün ücretsiz deneme, kredi kartı gerekmez. PayTR güvenli ödeme, aylık iptal hakkı.',
  alternates: { canonical: 'https://ranksup.ai/signin' },
  robots: { index: false, follow: true },
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

  // Koyu vitrin (Kasim 2026): genis ekranda iki sutun — solda marka yuzu, sagda form.
  // data-vitrin: globals.css bu isareti gorunce token'lari belge duzeyinde koyu sahneye ceker
  // (bu sayfa (marketing) duzeninin disinda; koyu tema lib/vitrin.ts yol listesiyle zorlanir).
  return (
    <div data-vitrin className="dark vitrin grid min-h-screen bg-background text-foreground antialiased lg:grid-cols-2">
      {/* Sol: marka yuzu — yalniz genis ekran */}
      <div className="relative hidden overflow-hidden border-r border-border lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div
          className="v-dots pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_top_right,black,transparent_70%)]"
          aria-hidden
        />
        <Link href="/" className="relative inline-flex items-center self-start" aria-label="RanksUp">
          <BrandWordmark size={22} reversed accent="hsl(var(--brand-vivid))" />
        </Link>
        <p className="relative max-w-xl text-vitrin-2">
          <span className="block">Türkiye&apos;nin AI destekli</span>{' '}
          <span className="block text-dim">SEO/GEO içerik platformu</span>
        </p>
      </div>

      {/* Sag: form */}
      <div className="flex flex-col justify-center px-4 py-12 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          {/* Dar ekranda marka yuzu gorunmez; wordmark ve tanim burada */}
          <div className="mb-12 lg:hidden">
            <Link href="/" className="inline-flex items-center" aria-label="RanksUp">
              <BrandWordmark size={24} reversed accent="hsl(var(--brand-vivid))" />
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">
              Türkiye&apos;nin AI destekli SEO/GEO içerik platformu
            </p>
          </div>

          <h1 className="text-vitrin-3">Giriş yap veya kayıt ol</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            14 gün ücretsiz deneme — kart bilgisi gerekmez
          </p>

          {errorText && (
            <div role="alert" className="mt-6 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm leading-relaxed text-danger">
              {errorText}
            </div>
          )}

          <form
            className="mt-8"
            action={async () => {
              'use server';
              await signIn('google', { redirectTo: callbackUrl });
            }}
          >
            {/* Google dugmesi beyaz: Google'in kendi dugme diline uygun, koyu sahnede de sayfanin tek belirgin eylemi */}
            <button
              type="submit"
              className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-md bg-white text-base font-medium text-black transition-colors duration-200 hover:bg-white/85"
            >
              <GoogleIcon className="h-5 w-5" />
              Google ile devam et
            </button>
          </form>

          <div className="v-rail mt-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span>güvenli OAuth 2.0 ile</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            Devam ederek{' '}
            <Link href="/terms" className="underline underline-offset-2 transition-colors duration-200 hover:text-foreground">
              Kullanım Koşulları
            </Link>{' '}
            ve{' '}
            <Link href="/privacy" className="underline underline-offset-2 transition-colors duration-200 hover:text-foreground">
              Gizlilik Politikası
            </Link>
            &apos;nı kabul etmiş olursun.
          </p>

          <p className="mt-10 border-t border-border pt-6 text-sm">
            <Link href="/" className="text-muted-foreground transition-colors duration-200 hover:text-foreground">
              ← Ana sayfaya dön
            </Link>
          </p>
        </div>
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
