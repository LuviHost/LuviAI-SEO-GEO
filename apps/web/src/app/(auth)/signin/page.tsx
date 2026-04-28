import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signIn } from '@/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export const metadata = {
  title: 'Giriş — LuviAI',
  description: 'LuviAI hesabınla giriş yapın veya hızlıca kayıt olun.',
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await auth();
  const params = await searchParams;
  const callbackUrl = params.callbackUrl ?? '/dashboard';
  const error = params.error;

  if (session?.user) redirect(callbackUrl);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="text-3xl font-bold inline-block">
            LuviAI
          </Link>
          <p className="text-muted-foreground mt-2 text-sm">
            Türkiye&apos;nin AI destekli SEO/GEO içerik platformu
          </p>
        </div>

        <Card>
          <CardContent className="p-8 space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold">Giriş yap veya kayıt ol</h1>
              <p className="text-sm text-muted-foreground mt-1">
                14 gün ücretsiz deneme — kart bilgisi gerekmez
              </p>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm p-3 rounded-md">
                {decodeURIComponent(error)}
              </div>
            )}

            <form
              action={async () => {
                'use server';
                await signIn('google', { redirectTo: callbackUrl });
              }}
            >
              <Button type="submit" variant="outline" className="w-full h-11" size="lg">
                <GoogleIcon className="h-5 w-5 mr-3" />
                Google ile devam et
              </Button>
            </form>

            <p className="text-xs text-center text-muted-foreground leading-relaxed">
              Devam ederek{' '}
              <Link href="/terms" className="underline hover:text-foreground">
                Kullanım Koşulları
              </Link>{' '}
              ve{' '}
              <Link href="/privacy" className="underline hover:text-foreground">
                Gizlilik Politikası
              </Link>
              &apos;nı kabul etmiş olursun.
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
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
