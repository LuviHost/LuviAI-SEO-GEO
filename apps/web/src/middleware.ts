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

  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
  if (!needsAuth) return NextResponse.next();

  const hasSession = SESSION_COOKIE_NAMES.some((n) => req.cookies.has(n));
  if (!hasSession) {
    // Relative Location — reverse proxy arkasinda req.nextUrl.host
    // bazen upstream bind adresine (127.0.0.1:3000) duser ve absolute
    // redirect localhost'a gider. Relative Location tarayicinin tasidigi
    // origin'i kullanir, bu da production'da ai.luvihost.com olur.
    const search = pathname + (req.nextUrl.search ?? '');
    const location = `/signin?callbackUrl=${encodeURIComponent(search)}`;
    return new NextResponse(null, {
      status: 307,
      headers: { Location: location },
    });
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
