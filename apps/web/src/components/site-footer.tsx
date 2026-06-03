'use client';

import Link from 'next/link';
import { Mail, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { useT } from '@/lib/i18n';

const X_HANDLE = 'luvihost';
const LINKEDIN_HANDLE = 'luvihost';
const SUPPORT_EMAIL = 'destek@luvihost.com';

/**
 * Marketing footer — Apple-grade minimal.
 * 12-col grid, italic accent on tagline, refined social icons, generous padding.
 */
export function SiteFooter() {
  const { t } = useT();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border/60 bg-neutral-50 dark:bg-neutral-950/40 mt-auto">
      <div className="container-apple py-16 lg:py-20">
        <div className="grid md:grid-cols-12 gap-10 lg:gap-16">
          {/* Brand column — wider, more breathing room */}
          <div className="md:col-span-5">
            <Link href="/" className="inline-flex items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em]">
              <BrandLogo size={28} className="rounded-md" />
              <span>RanksUp</span>
            </Link>
            <p className="mt-5 max-w-[360px] text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              SEO, AI içerik üretimi, sosyal medya ve reklam denetimi tek panelden.
              Türkiye için yapıldı, PayTR ile güvenli ödeme.
            </p>
            <p className="mt-6 text-[11px] tracking-[0.04em] uppercase text-neutral-400 dark:text-neutral-500">
              Senin yerine pazarlama yapan{' '}
              <span className="font-display italic text-[1.15em] text-neutral-700 dark:text-neutral-300 normal-case">AI</span>
            </p>
            <div className="flex items-center gap-2 mt-7">
              <a
                href={`https://x.com/${X_HANDLE}`}
                target="_blank" rel="noopener"
                aria-label="X (Twitter)"
                className="h-9 w-9 rounded-full border border-border/60 hover:border-foreground/40 hover:bg-background transition-all duration-300 ease-apple inline-flex items-center justify-center"
              >
                <img src="/brands/twitter.svg" alt="X" width="13" height="13" className="dark:invert opacity-70" />
              </a>
              <a
                href={`https://www.linkedin.com/company/${LINKEDIN_HANDLE}`}
                target="_blank" rel="noopener"
                aria-label="LinkedIn"
                className="h-9 w-9 rounded-full border border-border/60 hover:border-foreground/40 hover:bg-background transition-all duration-300 ease-apple inline-flex items-center justify-center"
              >
                <img src="/brands/linkedin.svg" alt="LinkedIn" width="15" height="15" className="opacity-70" />
              </a>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                aria-label="Destek e-posta"
                className="h-9 w-9 rounded-full border border-border/60 hover:border-foreground/40 hover:bg-background transition-all duration-300 ease-apple inline-flex items-center justify-center text-neutral-500"
              >
                <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
              </a>
            </div>
          </div>

          {/* Link columns */}
          <div className="md:col-span-7 grid grid-cols-3 gap-8">
            <div>
              <h4 className="text-eyebrow text-neutral-400 dark:text-neutral-500 mb-5">Ürün</h4>
              <ul className="space-y-3 text-[13px]">
                <li><Link href="/pricing" className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">{t('nav.pricing')}</Link></li>
                <li><Link href="/use-cases" className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">{t('nav.use_cases')}</Link></li>
                <li><Link href="/compare" className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">{t('nav.compare')}</Link></li>
                <li><Link href="/faq" className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">{t('nav.faq')}</Link></li>
                <li><Link href="/help" className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">Yardım</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-eyebrow text-neutral-400 dark:text-neutral-500 mb-5">Şirket</h4>
              <ul className="space-y-3 text-[13px]">
                <li><Link href="/about" className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">Hakkımızda</Link></li>
                <li><Link href="/status" className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">Sistem Durumu</Link></li>
                <li><a href={`mailto:${SUPPORT_EMAIL}`} className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">İletişim</a></li>
                <li><a href="https://luvihost.com" target="_blank" rel="noopener" className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">LuviHost ↗</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-eyebrow text-neutral-400 dark:text-neutral-500 mb-5">Yasal</h4>
              <ul className="space-y-3 text-[13px]">
                <li><Link href="/privacy" className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">Gizlilik</Link></li>
                <li><Link href="/terms" className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">Şartlar</Link></li>
                <li><Link href="/kvkk" className="text-neutral-600 dark:text-neutral-400 hover:text-foreground transition-colors duration-300 ease-apple">KVKK</Link></li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border/60">
        <div className="container-apple py-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-[12px] text-neutral-500 dark:text-neutral-500">
          <div>
            © {year} <a href="https://luvihost.com" className="hover:text-foreground transition-colors duration-300 ease-apple">LuviHost</a>. Tüm hakları saklıdır.
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3" /> KVKK uyumlu
            </span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <span>TR sunucu</span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <span>PayTR güvenli ödeme</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
