'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { UserMenu } from '@/components/user-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SiteSidebar } from '@/components/site-sidebar';
import { CommandPalette } from '@/components/command-palette';
import { NotificationBell } from '@/components/notification-bell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

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
          'fixed md:sticky top-0 left-0 z-50 h-screen w-64 bg-slate-950 text-slate-100 transition-transform md:translate-x-0 overflow-y-auto flex flex-col',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex-1">
          <SiteSidebar onClose={() => setOpen(false)} />
        </div>

        <div className="p-4 space-y-3 border-t border-slate-800">
          <UserMenu />
          <div className="flex justify-between items-center">
            <LocaleSwitch />
            <div className="flex items-center gap-1">
              <NotificationBell />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside>

      {/* Backdrop */}
      {open && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setOpen(false)} />
      )}

      <main className="flex-1 p-4 sm:p-6 md:p-10 overflow-x-hidden pt-16 md:pt-10">{children}</main>

      {/* Cmd+K command palette */}
      <CommandPalette />
    </div>
  );
}
