'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

const ADMIN_NAV = [
  { href: '/admin', label: 'Genel Bakış' },
  { href: '/admin/users', label: 'Kullanıcılar' },
  { href: '/admin/invoices', label: 'Faturalar' },
  { href: '/admin/sites', label: 'Siteler' },
  { href: '/admin/jobs', label: 'Hatalı İşler' },
  { href: '/admin/settings', label: 'Ayarlar' },
];

export function AdminMobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="md:hidden text-muted-foreground hover:text-foreground p-1.5 -ml-1.5"
        aria-label="Menüyü aç"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 md:hidden"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-background border-r border-border flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between h-14 px-4 border-b border-border">
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="text-lg font-medium tracking-[-0.02em] text-foreground"
              >
                RanksUp <span className="text-xs text-amber-400 font-normal ml-1">Admin</span>
              </Link>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground p-1">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {ADMIN_NAV.map((it) => (
                <Link
                  key={it.href}
                  href={it.href as any}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {it.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
