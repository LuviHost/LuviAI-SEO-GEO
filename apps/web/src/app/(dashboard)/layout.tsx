'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, Search, X } from 'lucide-react';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { UserMenu } from '@/components/user-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SiteSidebar } from '@/components/site-sidebar';
import { CommandPalette, openCommandPalette } from '@/components/command-palette';
import { NotificationBell } from '@/components/notification-bell';
import { BrandWordmark } from '@/components/brand-logo';
import { TrialUpgrade } from '@/components/trial-upgrade';

/** md kirilimi (768px) — tailwind.config ile ayni */
const DESKTOP_QUERY = '(min-width: 768px)';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Masaustunde cekmece hep gorunur; inert yalniz telefonda KAPALI cekmeceye uygulanir.
  // Varsayilan true: SSR/ilk boyamada masaustu klavye erisimi hic kesilmesin.
  const [isDesktop, setIsDesktop] = useState(true);
  const pathname = usePathname();
  const asideRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Sayfa degisince cekmeceyi kapat (site degistirici gibi onClose cagirmayan yollar icin)
  useEffect(() => { setOpen(false); }, [pathname]);

  // Acik cekmece: Esc kapatir, odak cekmeceye girer; kapaninca menu dugmesine doner
  useEffect(() => {
    if (!open || isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    asideRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      menuButtonRef.current?.focus();
    };
  }, [open, isDesktop]);

  const drawerHidden = !isDesktop && !open;

  return (
    // tabular-nums KALITSAL: tum dashboard sayilari tablosal — bilesen bilesen tekrar edilmez
    <div className="flex min-h-screen bg-background tabular-nums">
      {/* Mobil ust cubuk */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center justify-between border-b border-sidebar-border bg-sidebar px-3 md:hidden">
        <Button
          ref={menuButtonRef}
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-sidebar-foreground hover:bg-sidebar-hover"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Menüyü kapat' : 'Menüyü aç'}
          aria-expanded={open}
          aria-controls="app-sidebar"
        >
          {open ? <X aria-hidden /> : <Menu aria-hidden />}
        </Button>
        <Link href="/dashboard" className="inline-flex items-center" aria-label="RanksUp — Sitelerim">
          <span className="dark:hidden"><BrandWordmark size={18} /></span>
          <span className="hidden dark:inline"><BrandWordmark size={18} reversed /></span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-sidebar-foreground hover:bg-sidebar-hover"
          onClick={openCommandPalette}
          aria-label="Ara"
        >
          <Search className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {/* Kenar cubugu — telefonda cekmece */}
      <aside
        id="app-sidebar"
        ref={asideRef}
        aria-label="Ana menü"
        inert={drawerHidden || undefined}
        aria-hidden={drawerHidden || undefined}
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen w-64 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform motion-reduce:transition-none md:sticky md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex-1">
          <SiteSidebar onClose={() => setOpen(false)} />
        </div>

        <div className="space-y-3 border-t border-sidebar-border p-4">
          <UserMenu />
          <div className="flex items-center justify-between">
            <LocaleSwitch />
            <div className="flex items-center gap-1">
              <NotificationBell />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside>

      {/* Arka perde */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}

      <main className="flex-1 overflow-x-hidden p-4 pt-16 sm:p-6 sm:pt-16 md:p-10">
        {/* 1440px sinir: genis ekranda icerik duvara yapismasin (analitik UI sozlesmesi) */}
        <div className="mx-auto w-full max-w-[1440px]">
          {/* Ucretsiz deneme: geri sayim bandi, hatirlatmalar, sure dolunca modal (lib/trial-access.ts) */}
          <TrialUpgrade />
          <ConfirmProvider>{children}</ConfirmProvider>
        </div>
      </main>

      {/* ⌘K komut paleti */}
      <CommandPalette />
    </div>
  );
}
