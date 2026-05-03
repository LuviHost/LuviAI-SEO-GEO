'use client';

import Link from 'next/link';
import { Mail, Globe } from 'lucide-react';
import { useT } from '@/lib/i18n';

const X_HANDLE = 'luvihost';
const LINKEDIN_HANDLE = 'luvihost';
const SUPPORT_EMAIL = 'destek@luvihost.com';

export function SiteFooter() {
  const { t } = useT();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-muted/30 mt-auto">
      <div className="container py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2">
              <img src="/favicon.svg" alt="LuviAI" className="h-7 w-7" />
              <span className="text-lg font-bold">LuviAI</span>
            </Link>
            <p className="text-sm text-muted-foreground mt-3 max-w-md leading-relaxed">
              SEO, AI içerik üretimi, sosyal medya ve reklam denetimi tek panelden.
              Türkiye'de yapıldı, PayTR ile güvenli ödeme.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a
                href={`https://x.com/${X_HANDLE}`}
                target="_blank" rel="noopener"
                aria-label="X (Twitter)"
                className="h-8 w-8 rounded-md border bg-background hover:border-brand inline-flex items-center justify-center"
              >
                <img src="https://cdn.simpleicons.org/x/000000" alt="" width="14" height="14" className="dark:invert" />
              </a>
              <a
                href={`https://www.linkedin.com/company/${LINKEDIN_HANDLE}`}
                target="_blank" rel="noopener"
                aria-label="LinkedIn"
                className="h-8 w-8 rounded-md border bg-background hover:border-brand inline-flex items-center justify-center"
              >
                <img src="https://cdn.simpleicons.org/linkedin/0A66C2" alt="" width="16" height="16" />
              </a>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                aria-label="Destek e-posta"
                className="h-8 w-8 rounded-md border bg-background hover:border-brand inline-flex items-center justify-center text-muted-foreground hover:text-brand"
              >
                <Mail className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Ürün</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/pricing" className="text-foreground/80 hover:text-foreground">{t('nav.pricing')}</Link></li>
              <li><Link href="/use-cases" className="text-foreground/80 hover:text-foreground">{t('nav.use_cases')}</Link></li>
              <li><Link href="/compare" className="text-foreground/80 hover:text-foreground">{t('nav.compare')}</Link></li>
              <li><Link href="/faq" className="text-foreground/80 hover:text-foreground">{t('nav.faq')}</Link></li>
              <li><Link href="/help" className="text-foreground/80 hover:text-foreground">Yardım</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Şirket</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/about" className="text-foreground/80 hover:text-foreground">Hakkımızda</Link></li>
              <li><Link href="/status" className="text-foreground/80 hover:text-foreground">Sistem Durumu</Link></li>
              <li>
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-foreground/80 hover:text-foreground">
                  İletişim
                </a>
              </li>
              <li>
                <a href="https://luvihost.com" target="_blank" rel="noopener" className="text-foreground/80 hover:text-foreground inline-flex items-center gap-1">
                  <Globe className="h-3 w-3" /> LuviHost
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Yasal</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/privacy" className="text-foreground/80 hover:text-foreground">Gizlilik Politikası</Link></li>
              <li><Link href="/terms" className="text-foreground/80 hover:text-foreground">Kullanım Şartları</Link></li>
              <li><Link href="/kvkk" className="text-foreground/80 hover:text-foreground">KVKK</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t flex flex-col sm:flex-row justify-between gap-3 text-xs text-muted-foreground">
          <div>
            © {year} <a href="https://luvihost.com" className="hover:text-foreground">LuviHost</a>. Tüm hakları saklıdır.
          </div>
          <div className="flex items-center gap-3">
            <span>🇹🇷 Türkiye'de yapıldı</span>
            <span>·</span>
            <span>PayTR güvenli ödeme</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
