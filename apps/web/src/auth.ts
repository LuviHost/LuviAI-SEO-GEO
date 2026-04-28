import NextAuth, { type DefaultSession } from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { PrismaClient } from '@prisma/client';

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
  debug: true,
  logger: {
    error(error: any) {
      console.error('[auth][error]', error?.type ?? error?.name, error?.message);
      if (error?.cause) {
        console.error('[auth][error.cause]', error.cause?.code, error.cause?.message, error.cause?.address);
      }
      if (error?.stack) console.error(error.stack);
    },
    warn(code: any) {
      console.warn('[auth][warn]', code);
    },
    debug(message: any, metadata: any) {
      console.log('[auth][debug]', message, metadata ?? '');
    },
  },
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
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
