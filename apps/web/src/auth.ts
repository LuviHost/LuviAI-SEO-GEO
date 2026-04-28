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
      if (!existing) {
        await prisma.user.create({
          data: {
            email: user.email,
            name: user.name ?? null,
            image: user.image ?? null,
            emailVerified: new Date(),
            role: 'USER',
            plan: 'TRIAL',
            subscriptionStatus: 'TRIAL',
            trialEndsAt: new Date(Date.now() + Number(process.env.PLAN_TRIAL_DAYS ?? 14) * 86_400_000),
          },
        });
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({ where: { email: user.email } });
        if (dbUser) {
          token.sub = dbUser.id;
          (token as any).role = dbUser.role;
          (token as any).plan = dbUser.plan;
          (token as any).subscriptionStatus = dbUser.subscriptionStatus;
        }
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
