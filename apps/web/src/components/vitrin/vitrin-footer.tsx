'use client';

import Link from 'next/link';
import { BrandWordmark } from '@/components/brand-logo';
import { useT, type Key } from '@/lib/i18n';
import { openCookiePreferences } from '@/lib/consent';
import { VITRIN_WRAP } from '@/lib/vitrin';

// RanksUp'in kendi profilleri (LuviHost'unkiler degil) — site-footer.tsx ve layout.tsx sameAs ile ayni
const INSTAGRAM_URL = 'https://www.instagram.com/ranksupai/';
const LINKEDIN_URL = 'https://www.linkedin.com/company/ranksup';
const SUPPORT_EMAIL = 'destek@luvihost.com';

type Row = { k: Key; href: string } | { text: string; href: string };

const COLS: Array<{ title: Key; rows: Row[] }> = [
  {
    title: 'land.footer.product',
    rows: [
      { k: 'land.nav.pricing', href: '/pricing' },
      { k: 'land.footer.use_cases', href: '/use-cases' },
      { k: 'land.footer.compare', href: '/compare' },
    ],
  },
  {
    title: 'land.footer.resources',
    rows: [
      { k: 'nav.guides', href: '/rehber' },
      { k: 'land.footer.ai_visibility', href: '/rehber/yapay-zeka-gorunurlugu' },
      { k: 'land.footer.chatgpt_guide', href: '/rehber/chatgpt-markam-gorunuyor-mu' },
      { k: 'land.footer.gbp', href: '/google-isletme-karnesi' },
      { k: 'land.footer.help', href: '/help' },
    ],
  },
  {
    title: 'land.footer.company',
    rows: [
      { k: 'land.footer.about', href: '/about' },
      { k: 'land.nav.faq', href: '/faq' },
      { k: 'vnav.r.bot', href: '/bot' },
      { k: 'vfoot.contact', href: `mailto:${SUPPORT_EMAIL}` },
      { text: 'LinkedIn', href: LINKEDIN_URL },
      { text: 'Instagram', href: INSTAGRAM_URL },
    ],
  },
  {
    title: 'land.footer.legal',
    rows: [
      { k: 'land.footer.privacy', href: '/privacy' },
      { k: 'land.footer.terms', href: '/terms' },
      { k: 'land.footer.kvkk', href: '/kvkk' },
    ],
  },
];

const ROW_CLASS = 'transition-colors duration-200 hover:text-foreground';

/**
 * Koyu vitrinin alt bilgisi (ana sayfa + (marketing) altindaki vitrin sayfalari).
 * `updated`: sayfanin "Son güncelleme" satiri — ana sayfa kendi satirini buradan
 * gecirir (page-updated.spec satiri app/page.tsx icinde arar).
 */
export function VitrinFooter({ updated }: { updated?: React.ReactNode }) {
  const { t } = useT();

  return (
    <footer className="border-t border-border">
      <div className={`${VITRIN_WRAP} grid grid-cols-2 gap-10 py-16 md:grid-cols-5`}>
        <div className="col-span-2 md:col-span-1">
          <Link href="/" className="flex items-center" aria-label="RanksUp">
            <BrandWordmark size={20} reversed accent="hsl(var(--brand-vivid))" />
          </Link>
          <p className="mt-4 max-w-[15rem] text-sm leading-relaxed text-muted-foreground">{t('land.footer.tagline')}</p>
        </div>
        {COLS.map((col) => (
          <div key={col.title}>
            <h4 className="v-rail mb-4">{t(col.title)}</h4>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              {col.rows.map((row) => {
                const label = 'k' in row ? t(row.k) : row.text;
                const external = !row.href.startsWith('/');
                return (
                  <li key={row.href}>
                    {external ? (
                      <a
                        href={row.href}
                        className={ROW_CLASS}
                        {...(row.href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}
                      >
                        {label}
                      </a>
                    ) : (
                      <Link href={row.href} className={ROW_CLASS}>{label}</Link>
                    )}
                  </li>
                );
              })}
              {/* Riza geri alinabilir olmali (KVKK cerez rehberi 7.3; kaynaklar lib/consent.ts):
                  cerez bandi her vitrin sayfasinin altindan yeniden acilir. Baglanti degil dugme:
                  sayfa degistirmez, bandi acar. site-footer.tsx'teki dugmenin esi. */}
              {col.title === 'land.footer.legal' && (
                <li>
                  <button type="button" onClick={() => openCookiePreferences()} className={`text-left ${ROW_CLASS}`}>
                    {t('vfoot.cookies')}
                  </button>
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>
      <div className={VITRIN_WRAP}>
        <div className="v-rail flex flex-wrap justify-between gap-3 border-t border-border py-6">
          <span>© {new Date().getFullYear()} RanksUp. {t('land.footer.rights')}.</span>
          {updated}
          <span>{t('land.footer.made_in')}</span>
        </div>
      </div>
    </footer>
  );
}
