'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Receipt, Globe, BarChart3, MessageSquare,
  ListChecks, DollarSign, AlertTriangle, Settings, Sparkles,
  Menu, X, Radar, UserPlus,
} from 'lucide-react';
import { BrandWordmark } from '@/components/brand-logo';

const SECTIONS = [
  {
    label: 'Genel',
    items: [
      { href: '/admin', label: 'Genel Bakış', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Kullanıcı & Faturalama',
    items: [
      { href: '/admin/users', label: 'Kullanıcılar', icon: Users },
      { href: '/admin/invoices', label: 'Faturalar', icon: Receipt },
      { href: '/admin/sites', label: 'Siteler', icon: Globe },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { href: '/admin/landing', label: 'Landing Analytics', icon: BarChart3 },
      { href: '/admin/leads', label: 'AI Test Leadleri', icon: Sparkles },
      { href: '/admin/testimonials', label: 'Müşteri Yorumları', icon: MessageSquare },
    ],
  },
  {
    label: 'Araştırma',
    items: [
      { href: '/admin/intel', label: 'Sektör İstihbaratı', icon: Radar },
      { href: '/admin/linkedin', label: 'LinkedIn Outreach', icon: UserPlus },
    ],
  },
  {
    label: 'Sistem',
    items: [
      { href: '/admin/queue', label: 'Queue Monitor', icon: ListChecks },
      { href: '/admin/spend', label: 'AI Spend', icon: DollarSign },
      { href: '/admin/jobs', label: 'Hatalı İşler', icon: AlertTriangle },
      { href: '/admin/settings', label: 'Ayarlar', icon: Settings },
    ],
  },
];

export function AdminSidebar({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Mobile hamburger — sticky top-left */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-30 h-9 w-9 rounded-lg bg-background border shadow grid place-items-center hover:bg-muted"
        aria-label="Menüyü aç"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Backdrop (mobile) */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:fixed top-0 left-0 z-50 h-screen w-64 bg-background border-r flex flex-col transition-transform ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo */}
        <div className="h-14 px-4 flex items-center justify-between border-b shrink-0">
          <Link href="/admin" className="flex items-center gap-2 font-bold" onClick={() => setOpen(false)}>
            <BrandWordmark size={20} />
            <span className="text-[9px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-600 dark:text-brand-400">
              Admin
            </span>
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden h-7 w-7 grid place-items-center rounded hover:bg-muted text-muted-foreground"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-5">
          {SECTIONS.map((sec) => (
            <div key={sec.label}>
              <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                {sec.label}
              </p>
              <div className="space-y-0.5">
                {sec.items.map((item) => {
                  const active = pathname === item.href ||
                    (item.href !== '/admin' && pathname?.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href as any}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                        active
                          ? 'bg-gradient-to-r from-brand-500/15 to-brand-500/5 text-brand-700 dark:text-brand-400 font-semibold'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      <item.icon className={`h-4 w-4 shrink-0 ${active ? 'text-brand-600' : ''}`} />
                      <span className="truncate">{item.label}</span>
                      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer — user email */}
        <div className="border-t p-3 shrink-0">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/40">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white grid place-items-center text-[10px] font-bold">
              {(userEmail[0] || 'A').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold truncate">{userEmail}</p>
              <p className="text-[10px] text-muted-foreground">Admin</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
