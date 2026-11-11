'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Receipt, Globe, BarChart3, MessageSquare,
  ListChecks, DollarSign, AlertTriangle, Settings, Sparkles,
  Menu, X, Radar, UserPlus, Mail, ClipboardList,
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
      { href: '/admin/eposta', label: 'E-posta Kampanyası', icon: Mail },
      { href: '/admin/karneler', label: 'Karneler', icon: ClipboardList },
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
        className="lg:hidden fixed top-3 left-3 z-30 h-9 w-9 rounded-md bg-background border grid place-items-center hover:bg-muted"
        aria-label="Menüyü aç"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Backdrop (mobile) */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/70"
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
          <Link href="/admin" className="flex items-center gap-2 font-semibold" onClick={() => setOpen(false)}>
            <span className="dark:hidden"><BrandWordmark size={20} accent="hsl(var(--brand-vivid))" /></span>
            <span className="hidden dark:inline"><BrandWordmark size={20} reversed accent="hsl(var(--brand-vivid))" /></span>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-vitrin-rail text-muted-foreground">
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
              <p className="mb-1.5 px-2.5 font-mono text-vitrin-rail text-muted-foreground">
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
                      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-filter transition-colors duration-200 ${
                        active
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      <item.icon className={`h-4 w-4 shrink-0 ${active ? 'text-brand' : ''}`} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer — user email */}
        <div className="border-t p-3 shrink-0">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-muted text-xs font-medium text-foreground">
              {(userEmail[0] || 'A').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-medium">{userEmail}</p>
              <p className="font-mono text-vitrin-rail text-muted-foreground">Admin</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
