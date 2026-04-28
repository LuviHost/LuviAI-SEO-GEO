import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signOut } from '@/auth';
import { ThemeToggle } from '@/components/theme-toggle';

const ADMIN_NAV = [
  { href: '/admin', label: 'Genel Bakış' },
  { href: '/admin/users', label: 'Kullanıcılar' },
  { href: '/admin/invoices', label: 'Faturalar' },
  { href: '/admin/sites', label: 'Siteler' },
  { href: '/admin/jobs', label: 'Hatalı İşler' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/signin?callbackUrl=/admin');
  if (session.user.role !== 'ADMIN') redirect('/dashboard');

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <header className="bg-slate-900 text-slate-100 border-b border-slate-800">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="text-lg font-bold">
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
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-400 hidden sm:inline">{session.user.email}</span>
            <Link href="/dashboard" className="text-xs text-slate-400 hover:text-white">
              ← Kullanıcı paneline dön
            </Link>
            <ThemeToggle />
            <form
              action={async () => {
                'use server';
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

      <main className="flex-1 container mx-auto py-8 px-4">{children}</main>
    </div>
  );
}
