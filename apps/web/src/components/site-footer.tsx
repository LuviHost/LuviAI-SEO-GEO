'use client';

import Link from 'next/link';
import { Mail, Sparkles, ShieldCheck } from 'lucide-react';
import { useT } from '@/lib/i18n';

const X_HANDLE = 'luvihost';
const LINKEDIN_HANDLE = 'luvihost';
const SUPPORT_EMAIL = 'destek@luvihost.com';

export function SiteFooter() {
  const { t } = useT();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-background mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg mb-3">
              <span className="bg-gradient-to-br from-orange-500 to-orange-700 text-white rounded-lg w-8 h-8 grid place-items-center">
                <Sparkles className="h-4 w-4" />
              </span>
              LuviAI
            </Link>
            <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
              SEO, AI içerik üretimi, sosyal medya ve reklam denetimi tek panelden.
              Türkiye için yapıldı, PayTR ile güvenli ödeme.
            </p>
            <div className="flex items-center gap-3 mt-5">
              <a
                href={`https://x.com/${X_HANDLE}`}
                target="_blank" rel="noopener"
                aria-label="X (Twitter)"
                className="h-9 w-9 rounded-lg border bg-background hover:border-orange-500/30 hover:text-orange-600 transition-all inline-flex items-center justify-center"
              >
                <img src="/brands/twitter.svg" alt="X" width="14" height="14" className="dark:invert" />
              </a>
              <a
                href={`https://www.linkedin.com/company/${LINKEDIN_HANDLE}`}
                target="_blank" rel="noopener"
                aria-label="LinkedIn"
                className="h-9 w-9 rounded-lg border bg-background hover:border-orange-500/30 transition-all inline-flex items-center justify-center"
              >
                <img src="/brands/linkedin.svg" alt="LinkedIn" width="16" height="16" />
              </a>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                aria-label="Destek e-posta"
                className="h-9 w-9 rounded-lg border bg-background hover:border-orange-500/30 hover:text-orange-600 transition-all inline-flex items-center justify-center text-muted-foreground"
              >
                <Mail className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Ürün</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">{t('nav.pricing')}</Link></li>
              <li><Link href="/use-cases" className="text-muted-foreground hover:text-foreground transition-colors">{t('nav.use_cases')}</Link></li>
              <li><Link href="/compare" className="text-muted-foreground hover:text-foreground transition-colors">{t('nav.compare')}</Link></li>
              <li><Link href="/faq" className="text-muted-foreground hover:text-foreground transition-colors">{t('nav.faq')}</Link></li>
              <li><Link href="/help" className="text-muted-foreground hover:text-foreground transition-colors">Yardım</Link></li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Şirket</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/about" className="text-muted-foreground hover:text-foreground transition-colors">Hakkımızda</Link></li>
              <li><Link href="/status" className="text-muted-foreground hover:text-foreground transition-colors">Sistem Durumu</Link></li>
              <li><a href={`mailto:${SUPPORT_EMAIL}`} className="text-muted-foreground hover:text-foreground transition-colors">İletişim</a></li>
              <li><a href="https://luvihost.com" target="_blank" rel="noopener" className="text-muted-foreground hover:text-foreground transition-colors">LuviHost ↗</a></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Yasal</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">Gizlilik</Link></li>
              <li><Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors">Şartlar</Link></li>
              <li><Link href="/kvkk" className="text-muted-foreground hover:text-foreground transition-colors">KVKK</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-muted-foreground">
          <div>
            © {year} <a href="https://luvihost.com" className="hover:text-orange-600 transition-colors">LuviHost</a>. Tüm hakları saklıdır.
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3" /> KVKK uyumlu
            </span>
            <span>·</span>
            <span>🇹🇷 TR sunucu</span>
            <span>·</span>
            <span>PayTR güvenli ödeme</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
