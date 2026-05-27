'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowRight } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { BrandLogo } from '@/components/brand-logo';
import { useT } from '@/lib/i18n';

/**
 * Marketing sayfaları için global header — Apple-grade.
 * Glassmorphic sticky, küçük tipografi, dark CTA, sticky blur.
 */
export function SiteHeader() {
  const { t } = useT();
  const { data: session } = useSession();
  const isAuthed = !!session?.user;

  return (
    <header className="sticky top-0 z-50 w-full nav-blur">
      <div className="container-apple h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em]">
          <BrandLogo size={26} className="rounded-md" />
          <span>LuviAI</span>
        </Link>

        <nav className="hidden md:flex items-center gap-9 text-[13px] text-neutral-600 dark:text-neutral-300">
          <Link href="/pricing" className="hover:text-foreground transition-colors duration-300 ease-apple">{t('nav.pricing')}</Link>
          <Link href="/use-cases" className="hover:text-foreground transition-colors duration-300 ease-apple">{t('nav.use_cases')}</Link>
          <Link href="/compare" className="hover:text-foreground transition-colors duration-300 ease-apple">{t('nav.compare')}</Link>
          <Link href="/about" className="hover:text-foreground transition-colors duration-300 ease-apple">Hakkımızda</Link>
          <Link href="/faq" className="hover:text-foreground transition-colors duration-300 ease-apple">{t('nav.faq')}</Link>
        </nav>

        <div className="flex items-center gap-1.5">
          <LocaleSwitch />
          <ThemeToggle />
          {isAuthed ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-foreground text-background text-[13px] font-medium transition-all duration-300 ease-apple hover:scale-[1.03] active:scale-[0.97] shadow-apple"
            >
              {t('nav.dashboard')}
            </Link>
          ) : (
            <>
              <Link
                href="/signin"
                className="hidden sm:inline-flex items-center px-3 h-9 text-[13px] text-neutral-600 dark:text-neutral-300 hover:text-foreground transition-colors duration-300 ease-apple"
              >
                {t('nav.login')}
              </Link>
              <Link
                href="/signin?callbackUrl=/onboarding"
                className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-foreground text-background text-[13px] font-medium transition-all duration-300 ease-apple hover:scale-[1.03] active:scale-[0.97] shadow-apple"
              >
                {t('nav.signup')}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
