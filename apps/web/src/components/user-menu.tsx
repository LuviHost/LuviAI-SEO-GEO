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
        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-sidebar-hover transition-colors w-full text-left"
      >
        {session.user.image ? (
          <img
            src={session.user.image}
            alt=""
            className="h-7 w-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-brand text-white flex items-center justify-center text-xs font-semibold">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate text-sidebar-foreground">
            {session.user.name ?? session.user.email}
          </div>
          <div className="text-[10px] text-sidebar-muted truncate">
            {session.user.plan === 'TRIAL' ? 'Trial' : session.user.plan}
            {session.user.role === 'ADMIN' && ' · Admin'}
          </div>
        </div>
      </button>

      <div
        className={cn(
          'absolute bottom-full mb-2 left-0 right-0 bg-sidebar border border-sidebar-border rounded-md shadow-apple-md overflow-hidden transition-all',
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
          className="flex items-center gap-2 px-3 py-2 text-sm text-rose-600 dark:text-rose-400 hover:bg-sidebar-hover w-full text-left border-t border-sidebar-border"
        >
          <LogOut className="h-4 w-4" /> Çıkış yap
        </button>
      </div>
    </div>
  );
}
