import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signOut } from '@/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { AdminMobileNav } from '@/components/admin-mobile-nav';
import { clearAdminUnlockCookie, isAdminUnlocked } from '@/lib/admin-unlock';

const ADMIN_NAV = [
  { href: '/admin', label: 'Genel Bakış' },
  { href: '/admin/users', label: 'Kullanıcılar' },
  { href: '/admin/invoices', label: 'Faturalar' },
  { href: '/admin/sites', label: 'Siteler' },
  { href: '/admin/jobs', label: 'Hatalı İşler' },
  { href: '/admin/settings', label: 'Ayarlar' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/signin?callbackUrl=/admin');
  if (session.user.role !== 'ADMIN') redirect('/dashboard');

  // 2FA: Admin paneli icin ek PIN katmani (env'de ADMIN_PIN set ise)
  if (!(await isAdminUnlocked(session.user.id))) {
    redirect('/admin-unlock?next=/admin');
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <header className="bg-slate-900 text-slate-100 border-b border-slate-800 sticky top-0 z-30">
        <div className="container mx-auto flex items-center justify-between h-14 px-3 sm:px-4 gap-2">
          <div className="flex items-center gap-2 sm:gap-6 min-w-0">
            <AdminMobileNav />
            <Link href="/admin" className="text-base sm:text-lg font-bold truncate">
              LuviAI <span className="text-xs text-amber-400 font-normal ml-1">Admin</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {ADMIN_NAV.map((it) => (
                <Link
                  key={it.href}
                  href={it.href as any}
                  className="px-3 py-1.5 rounded-md text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  {it.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 text-sm shrink-0">
            <span className="text-slate-400 hidden lg:inline truncate max-w-[180px]">{session.user.email}</span>
            <Link
              href="/dashboard"
              className="text-xs text-slate-400 hover:text-white whitespace-nowrap hidden sm:inline"
            >
              ← Panel
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
                className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-800 hidden sm:inline"
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
                className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-slate-800"
              >
                Çıkış
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto py-6 sm:py-8 px-3 sm:px-4">{children}</main>
    </div>
  );
}
