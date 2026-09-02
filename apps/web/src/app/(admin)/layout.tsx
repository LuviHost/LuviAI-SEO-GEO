import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signOut } from '@/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { AdminSidebar } from '@/components/admin-sidebar';
import { clearAdminUnlockCookie, isAdminUnlocked } from '@/lib/admin-unlock';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/signin?callbackUrl=/admin');
  if (session.user.role !== 'ADMIN') redirect('/dashboard');

  // 2FA: Admin paneli icin ek PIN katmani (env'de ADMIN_PIN set ise)
  if (!(await isAdminUnlocked(session.user.id))) {
    redirect('/admin-unlock?next=/admin');
  }

  return (
    <div className="min-h-screen flex bg-muted/30 tabular-nums">
      {/* ── Sol sidebar (desktop) + sliding drawer (mobile) ── */}
      <AdminSidebar userEmail={session.user.email ?? ''} />

      {/* ── Ana içerik alanı ── */}
      <div className="flex-1 min-w-0 lg:ml-64">
        {/* Üst bar — sadece sağdaki user actions */}
        <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-xl border-b">
          <div className="h-14 px-4 sm:px-6 flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground hidden md:inline truncate max-w-[200px] font-mono">
              {session.user.email}
            </span>
            <div className="h-4 w-px bg-border hidden md:inline-block" />
            <Link
              href="/dashboard"
              className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap hidden sm:inline px-2 py-1 rounded hover:bg-muted"
            >
              ← Kullanıcı Paneli
            </Link>
            <ThemeToggle />
            <form
              action={async () => {
                'use server';
                await clearAdminUnlockCookie();
              }}
            >
              <button
                type="submit"
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted hidden sm:inline-flex items-center gap-1"
                title="Admin oturumunu kilitle"
              >
                🔒 Kilitle
              </button>
            </form>
            <form
              action={async () => {
                'use server';
                await clearAdminUnlockCookie();
                await signOut({ redirectTo: '/' });
              }}
            >
              <button
                type="submit"
                className="text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 px-2.5 py-1 rounded font-medium"
              >
                Çıkış
              </button>
            </form>
          </div>
        </header>

        <main className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-[1440px] mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
