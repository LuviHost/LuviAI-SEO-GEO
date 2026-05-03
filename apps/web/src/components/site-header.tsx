'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { useT } from '@/lib/i18n';

/**
 * Marketing sayfaları için global header.
 * Tüm marketing sayfalarda tutarlı navigation + brand presence.
 */
export function SiteHeader() {
  const { t } = useT();
  const { data: session } = useSession();
  const isAuthed = !!session?.user;

  return (
    <header className="sticky top-0 z-30 w-full border-b bg-background/85 backdrop-blur">
      <div className="container flex items-center justify-between py-3 sm:py-4">
        <Link href="/" className="flex items-center gap-2 group">
          <img src="/favicon.svg" alt="LuviAI" className="h-8 w-8 group-hover:scale-105 transition-transform" />
          <span className="text-lg sm:text-xl font-bold tracking-tight">LuviAI</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <Link href="/pricing" className="hover:text-foreground transition-colors">{t('nav.pricing')}</Link>
          <Link href="/use-cases" className="hover:text-foreground transition-colors">{t('nav.use_cases')}</Link>
          <Link href="/compare" className="hover:text-foreground transition-colors">{t('nav.compare')}</Link>
          <Link href="/about" className="hover:text-foreground transition-colors">Hakkımızda</Link>
          <Link href="/faq" className="hover:text-foreground transition-colors">{t('nav.faq')}</Link>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <LocaleSwitch />
          <ThemeToggle />
          {isAuthed ? (
            <Link
              href="/dashboard"
              className="text-xs sm:text-sm font-medium px-3 py-1.5 rounded-md bg-brand text-white hover:bg-brand/90 transition-colors"
            >
              {t('nav.dashboard')}
            </Link>
          ) : (
            <>
              <Link href="/signin" className="text-xs sm:text-sm hover:text-foreground/80">
                {t('nav.login')}
              </Link>
              <Link
                href="/signin?callbackUrl=/onboarding"
                className="text-xs sm:text-sm font-medium px-3 py-1.5 rounded-md bg-brand text-white hover:bg-brand/90 transition-colors"
              >
                {t('nav.signup')}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
