import NextAuth, { type DefaultSession } from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { PrismaClient } from '@prisma/client';

// Bazı sunucular (örn. public IPv6'sız VM'ler) Node 20 fetch IPv6'ya
// timeout veriyor (ETIMEDOUT). undici (Node built-in) global dispatcher'ı
// IPv4'e kilitle. undici Node 20'nin parçası ama npm'de listelenmediği için
// TS bilmiyor → require ile yükle.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undici = require('undici') as { setGlobalDispatcher: (d: unknown) => void; Agent: new (opts: unknown) => unknown };
  undici.setGlobalDispatcher(new undici.Agent({ connect: { family: 4 } }));
} catch {
  // older Node — sessizce geç
}

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      role: 'USER' | 'ADMIN' | 'AGENCY_OWNER';
      plan: 'TRIAL' | 'STARTER' | 'PRO' | 'AGENCY' | 'ENTERPRISE';
      subscriptionStatus: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
    };
  }
}

/**
 * Silme talebi olan hesabin web girisi reddedilince /signin?error=<bu kod>.
 * Giris sayfasi kodu sabit bir metne cevirir (URL'deki metin ekrana basilmaz).
 */
export const ACCOUNT_DELETED_SIGNIN_ERROR = 'AccountDeleted';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  providers: [
    /**
     * Google OAuth2 — manuel endpoint config (OIDC discovery yapmadan).
     * Sebep: bazı sunucularda Node undici "well-known" fetch'i ETIMEDOUT
     * veriyor (IPv6 routing eksik vb.); manuel config ile bağımsız.
     */
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        url: 'https://accounts.google.com/o/oauth2/v2/auth',
        params: { scope: 'openid email profile', prompt: 'select_account' },
      },
      token: 'https://oauth2.googleapis.com/token',
      userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
      issuer: 'https://accounts.google.com',
      wellKnown: undefined,
      checks: ['pkce', 'state'],
    }),
  ],
  pages: {
    signIn: '/signin',
    error: '/signin',
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const existing = await prisma.user.findUnique({ where: { email: user.email } });
      // Silme talebi olan hesap (30 gunluk kalici silme beklemesi) web'e giremez;
      // API tarafinda ayni kural AuthGuard'da. String donunce Auth.js hesap
      // baglamadan ve oturum cerezi yazmadan bu adrese yonlendirir
      // (@auth/core 0.41.2 lib/actions/callback/index.js handleAuthorized).
      if (existing?.deletionRequestedAt) return `/signin?error=${ACCOUNT_DELETED_SIGNIN_ERROR}`;
      if (!existing) {
        const created = await prisma.user.create({
          data: {
            email: user.email,
            name: user.name ?? null,
            image: user.image ?? null,
            emailVerified: new Date(),
            role: 'USER',
            plan: 'TRIAL',
            subscriptionStatus: 'TRIAL',
            // Deneme hakki 2 makale, omur boyu (ay basi sifirlanmaz) — sure kapisi yok.
            // Kaynak: api billing/quota.service.ts LIMITS.TRIAL.articles ve plans.ts trial.articlesPerMonth.
          },
        });

        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
        const internalKey = process.env.INTERNAL_API_KEY ?? process.env.NEXTAUTH_SECRET ?? '';

        // Welcome maili — fire-and-forget; signIn'i blok etmez
        if (internalKey) {
          fetch(`${apiBase}/api/auth/welcome-hook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
            body: JSON.stringify({ email: user.email }),
          }).catch((err) => {
            console.warn('[auth] welcome-hook error:', err?.message);
          });
        }

        // Affiliate attribution — luvi_ref cookie varsa yeni user'ı affiliate'a bağla
        if (internalKey) {
          try {
            const { cookies } = await import('next/headers');
            const cookieStore = await cookies();
            const refCode = cookieStore.get('luvi_ref')?.value;
            if (refCode) {
              fetch(`${apiBase}/api/affiliate/attribute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
                body: JSON.stringify({ userId: created.id, refCode }),
              }).catch((err) => {
                console.warn('[auth] affiliate attribute error:', err?.message);
              });
            }
          } catch (err: any) {
            console.warn('[auth] affiliate cookie read fail:', err?.message);
          }
        }

        // Public AI Citation Subscriber attribution — yeni kullanıcı ile aynı email'le
        // landing page'te citation testi yapmış varsa attribution kur (signed_up)
        if (internalKey) {
          fetch(`${apiBase}/api/public/citation-check/link-signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
            body: JSON.stringify({ userId: created.id, email: user.email }),
          }).catch((err) => {
            console.warn('[auth] citation link-signup error:', err?.message);
          });
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      // İlk login: user object dolu — email ile DB'den oku.
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({ where: { email: user.email } });
        // signIn zaten reddeder; ikisi arasinda talep gelirse oturum yine acilmaz
        if (dbUser?.deletionRequestedAt) return null;
        if (dbUser) {
          token.sub = dbUser.id;
          (token as any).role = dbUser.role;
          (token as any).plan = dbUser.plan;
          (token as any).subscriptionStatus = dbUser.subscriptionStatus;
        }
        return token;
      }
      // Sonraki request'ler: plan / role / status değişmiş olabilir (admin upgrade, ödeme, expire).
      // JWT bayatlanmasın diye her seferinde DB'den taze çek (~1ms, indexed by id).
      if (token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub as string },
          select: { role: true, plan: true, subscriptionStatus: true, deletionRequestedAt: true },
        });
        // Hesap silindi ya da silme talebi var: null donmek oturumu bitirir ve
        // cerezi temizler (@auth/core 0.41.2 lib/actions/session.js) — talepten
        // once acilmis oturumlar da bir sonraki istekte kapanir.
        if (!dbUser || dbUser.deletionRequestedAt) return null;
        (token as any).role = dbUser.role;
        (token as any).plan = dbUser.plan;
        (token as any).subscriptionStatus = dbUser.subscriptionStatus;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = ((token as any).role ?? 'USER') as any;
        session.user.plan = ((token as any).plan ?? 'TRIAL') as any;
        session.user.subscriptionStatus = ((token as any).subscriptionStatus ?? 'TRIAL') as any;
      }
      return session;
    },
  },
});
