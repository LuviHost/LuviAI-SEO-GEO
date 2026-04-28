'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Home, Plus, CreditCard, Menu, X, Users as UsersIcon } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { UserMenu } from '@/components/user-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Sitelerim', icon: Home },
  { href: '/onboarding', label: 'Yeni Site', icon: Plus },
  { href: '/billing', label: 'Abonelik', icon: CreditCard },
  { href: '/affiliate', label: 'Affiliate', icon: UsersIcon },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-12 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-3">
        <Button
          variant="ghost"
          size="icon"
          className="text-slate-100 hover:bg-slate-800 hover:text-white h-9 w-9"
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </Button>
        <Link href="/" className="text-base font-bold text-white">LuviAI</Link>
        <div className="w-9" />
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed md:sticky top-0 left-0 z-50 h-screen w-64 bg-slate-950 text-slate-100 transition-transform md:translate-x-0 overflow-y-auto',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="p-6">
          <Link href="/" className="text-2xl font-bold text-white">LuviAI</Link>
          <div className="text-xs text-slate-500 mt-1">v0.7 Faz 2 Beta</div>
        </div>

        <nav className="px-3 space-y-1">
          {NAV.map((item) => {
            const active = path === item.href || path.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href as any}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-brand text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-4 left-4 right-4 space-y-3">
          <UserMenu />
          <div className="flex justify-between items-center">
            <LocaleSwitch />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Backdrop */}
      {open && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setOpen(false)} />
      )}

      <main className="flex-1 p-4 sm:p-6 md:p-10 overflow-x-hidden pt-16 md:pt-10">{children}</main>
    </div>
  );
}
