'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { Sparkles, Zap, Globe } from 'lucide-react';

export default function HomePage() {
  const { t } = useT();
  const { data: session, status } = useSession();
  const isAuthed = !!session?.user;
  const primaryHref = isAuthed ? '/dashboard' : '/signin?callbackUrl=/onboarding';
  const primaryLabel = isAuthed
    ? `Dashboard'a git`
    : status === 'loading'
      ? '...'
      : `Erken Erişime Katıl`;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-brand via-brand-light to-brand/30">
      <header className="container flex justify-between items-center py-4 sm:py-6 px-4">
        <div className="text-xl sm:text-2xl font-bold text-white">LuviAI</div>
        <div className="flex items-center gap-2 sm:gap-3">
          <LocaleSwitch />
          <Link href="/pricing" className="text-white text-xs sm:text-sm hover:underline">{t('nav.pricing')}</Link>
          {isAuthed ? (
            <Link href="/dashboard" className="text-white text-xs sm:text-sm font-medium hover:underline">
              Dashboard
            </Link>
          ) : (
            <Link href="/signin" className="text-white text-xs sm:text-sm font-medium hover:underline">
              Giriş yap
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center container px-4 py-8">
        <div className="max-w-3xl text-center text-white">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur px-3 py-1 rounded-full text-xs font-medium mb-6">
            <Sparkles className="h-3 w-3" />
            {t('hero.beta_note')}
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold mb-6 tracking-tight leading-tight">
            {t('hero.title')}
          </h1>

          <p className="text-base sm:text-xl md:text-2xl mb-8 sm:mb-10 text-white/90 max-w-2xl mx-auto leading-relaxed">
            {t('hero.subtitle')}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-white text-brand hover:bg-white/95 shadow-xl">
              <Link href={primaryHref}>{primaryLabel} →</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white text-white hover:bg-white/10">
              <Link href="/pricing">{t('hero.cta_secondary')}</Link>
            </Button>
          </div>

          <div className="mt-12 sm:mt-20 grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 text-left">
            <Feature icon={<Zap className="h-5 w-5" />} title="Otopilotta blog büyüme" desc="Onboarding sonu ilk makale otomatik üretilir. Kotanız boyunca Claude + Gemini çalışır." />
            <Feature icon={<Globe className="h-5 w-5" />} title="14 yayın hedefi" desc="WordPress, FTP, SFTP, Webflow, Sanity, Ghost, GitHub… İstediğin yere yayınla." />
            <Feature icon={<Sparkles className="h-5 w-5" />} title="GEO + SEO + AEO" desc="ChatGPT/Perplexity/Claude AI alıntılanması için Auriti GEO ile optimize." />
          </div>
        </div>
      </main>

      <footer className="container py-6 text-center text-white/70 text-xs">
        © 2026 LuviHost · A LuviAI experiment
      </footer>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white/10 backdrop-blur rounded-xl p-5 text-white">
      <div className="bg-white/20 w-10 h-10 rounded-lg flex items-center justify-center mb-3">{icon}</div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-white/80">{desc}</p>
    </div>
  );
}
