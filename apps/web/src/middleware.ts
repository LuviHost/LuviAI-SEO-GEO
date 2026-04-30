import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard', '/sites', '/billing', '/onboarding', '/affiliate', '/admin'];

const ADMIN_PREFIXES = ['/admin'];

const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Affiliate ref tracking — ?ref=CODE query parametresi varsa cookie set et.
  // 60 gün TTL. Mevcut cookie varsa override etme (ilk gelen ref kazanır).
  // URL'den ref'i temizleyip clean URL'e rewrite et (kullanıcı paylaşırsa
  // ref kodu kazara dağılmasın).
  const refParam = req.nextUrl.searchParams.get('ref');
  if (refParam && /^[a-z0-9-_]{4,64}$/i.test(refParam)) {
    const url = req.nextUrl.clone();
    url.searchParams.delete('ref');
    const res = NextResponse.redirect(url);
    if (!req.cookies.has('luvi_ref')) {
      res.cookies.set('luvi_ref', refParam, {
        maxAge: 60 * 24 * 60 * 60,
        path: '/',
        sameSite: 'lax',
        httpOnly: false, // signIn callback Server Component'tan da okuyabilsin
      });
    }
    return res;
  }


  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
  if (!needsAuth) return NextResponse.next();

  const hasSession = SESSION_COOKIE_NAMES.some((n) => req.cookies.has(n));
  if (!hasSession) {
    // Reverse proxy arkasinda req.nextUrl.host bazen upstream bind adresine
    // (127.0.0.1:3000) duser; absolute redirect olusunca tarayici localhost'a
    // gider. Forwarded host header'larindan dogru host'u tespit edip absolute
    // URL'i orayla insa ediyoruz.
    const proto =
      req.headers.get('x-forwarded-proto')?.split(',')[0].trim() ??
      req.nextUrl.protocol.replace(':', '');
    const host =
      req.headers.get('x-forwarded-host')?.split(',')[0].trim() ??
      req.headers.get('host') ??
      req.nextUrl.host;
    const target = new URL(`/signin?callbackUrl=${encodeURIComponent(pathname + (req.nextUrl.search ?? ''))}`, `${proto}://${host}`);
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/sites/:path*',
    '/billing/:path*',
    '/onboarding/:path*',
    '/affiliate/:path*',
    '/admin/:path*',
  ],
};
