'use client';

import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { LogOut, ShieldCheck, User as UserIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function UserMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);

  if (status === 'loading') {
    return <div className="h-9 w-32 bg-sidebar-hover animate-pulse rounded-md" />;
  }
  if (!session?.user) return null;

  const initials = (session.user.name ?? session.user.email ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-200 hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {session.user.image ? (
          <img
            src={session.user.image}
            alt=""
            className="h-7 w-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sidebar-hover text-xs font-medium text-sidebar-foreground">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate text-sidebar-foreground">
            {session.user.name ?? session.user.email}
          </div>
          <div className="truncate font-mono text-vitrin-rail text-sidebar-muted">
            {session.user.plan === 'TRIAL' ? 'Trial' : session.user.plan}
            {session.user.role === 'ADMIN' && ' · Admin'}
          </div>
        </div>
      </button>

      <div
        className={cn(
          'absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-md border border-sidebar-border bg-popover transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      >
        <Link
          href="/billing"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground/85 hover:bg-sidebar-hover"
        >
          <UserIcon className="h-4 w-4" /> Hesabım & Abonelik
        </Link>
        {session.user.role === 'ADMIN' && (
          <Link
            href="/admin"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground/85 hover:bg-sidebar-hover"
          >
            <ShieldCheck className="h-4 w-4" /> Admin Paneli
          </Link>
        )}
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="flex w-full items-center gap-2 border-t border-sidebar-border px-3 py-2 text-left text-sm text-danger hover:bg-sidebar-hover"
        >
          <LogOut className="h-4 w-4" /> Çıkış yap
        </button>
      </div>
    </div>
  );
}
