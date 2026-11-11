'use client';

import { usePathname } from 'next/navigation';
import { isVitrinPath } from '@/lib/vitrin';
import { VitrinNav } from './vitrin-nav';
import { VitrinCta } from './vitrin-cta';
import { VitrinFooter } from './vitrin-footer';

/**
 * (marketing) duzeninin kabugu. Vitrin yollarinda (lib/vitrin.ts) koyu sahne:
 * acilir menulu ust cubuk + ortak kapanis + koyu alt bilgi. Diger pazarlama
 * sayfalarinda duzenin verdigi eski baslik ve alt bilgi aynen cizilir.
 *
 * Baslik/alt bilgi prop olarak gelir: consent.spec, (marketing)/layout.tsx
 * icinde `<SiteFooter />` yazisini ariyor (cerez tercihleri dugmesi kaniti).
 */
export function MarketingShell({ header, footer, children }: {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (isVitrinPath(pathname)) {
    return (
      // data-vitrin: globals.css bu isareti gorunce token'lari belge duzeyinde koyu sahneye ceker.
      // overflow-x-clip (hidden DEGIL): hidden sarmalayiciyi kaydirma kabi yapar; ust menu ve
      // yapiskan bolum basliklari (`sticky`) o zaman pencereye degil sarmalayiciya yapisir, yani yapismaz.
      <div data-vitrin className="dark vitrin flex min-h-screen flex-col overflow-x-clip bg-background text-foreground antialiased">
        <VitrinNav />
        <main className="flex-1">{children}</main>
        <VitrinCta />
        <VitrinFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {header}
      <main className="flex-1">{children}</main>
      {footer}
    </div>
  );
}
