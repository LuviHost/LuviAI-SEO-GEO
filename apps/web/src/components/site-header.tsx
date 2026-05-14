'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Sparkles } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

/**
 * Marketing sayfaları için global header — landing tasarım dili.
 * Sticky + backdrop-blur, brand gradient logo, hover:text-orange-600 nav.
 */
export function SiteHeader() {
  const { t } = useT();
  const { data: session } = useSession();
  const isAuthed = !!session?.user;

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <span className="bg-gradient-to-br from-orange-500 to-orange-700 text-white rounded-lg w-8 h-8 grid place-items-center">
            <Sparkles className="h-4 w-4" />
          </span>
          LuviAI
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          <Link href="/pricing" className="hover:text-orange-600 transition-colors">{t('nav.pricing')}</Link>
          <Link href="/use-cases" className="hover:text-orange-600 transition-colors">{t('nav.use_cases')}</Link>
          <Link href="/compare" className="hover:text-orange-600 transition-colors">{t('nav.compare')}</Link>
          <Link href="/about" className="hover:text-orange-600 transition-colors">Hakkımızda</Link>
          <Link href="/faq" className="hover:text-orange-600 transition-colors">{t('nav.faq')}</Link>
        </nav>

        <div className="flex items-center gap-2">
          <LocaleSwitch />
          <ThemeToggle />
          {isAuthed ? (
            <Link href="/dashboard">
              <Button
                size="sm"
                className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
              >
                {t('nav.dashboard')}
              </Button>
            </Link>
          ) : (
            <>
              <Link href="/signin" className="hidden sm:inline-block">
                <Button variant="ghost" size="sm">{t('nav.login')}</Button>
              </Link>
              <Link href="/signin?callbackUrl=/onboarding">
                <Button
                  size="sm"
                  className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
                >
                  {t('nav.signup')}
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
