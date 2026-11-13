'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowUpRight, ChevronDown, Menu, X } from 'lucide-react';
import { BrandWordmark } from '@/components/brand-logo';
import { LocaleSwitch } from '@/components/locale-switch';
import { useT, type Key } from '@/lib/i18n';
import { trackCta } from '@/lib/landing-track';
import { cn } from '@/lib/utils';
import { VITRIN_WRAP } from '@/lib/vitrin';

/**
 * Koyu vitrinin ust menusu: iki acilir grup (Urun, Kaynaklar) + duz baglantilar.
 *
 * DURUSTLUK: menudeki her satir VAR OLAN bir sayfaya gider. Ozelliklerin ayri
 * tanitim sayfasi yok; "Urun" satirlari o ozelligi anlatan yardim yazisina ya da
 * ana sayfadaki bolume baglanir. Sayfasi olmayan ozellik (ornegin MCP / REST API)
 * menuye konmaz — yeni satir eklerken once sayfanin var oldugunu dogrula.
 */

type Item = { k: Key; href: string };
type GroupId = 'urun' | 'kaynak';

const GROUPS: Array<{ id: GroupId; label: Key; items: Item[] }> = [
  {
    id: 'urun',
    label: 'vnav.product',
    items: [
      { k: 'vnav.p.overview', href: '/#yuzeyler' },
      { k: 'vnav.p.ai', href: '/help/ai-visibility' },
      { k: 'vnav.p.aso', href: '/help/aso' },
      { k: 'vnav.p.asa', href: '/help/asa-asc' },
      { k: 'vnav.p.autopilot', href: '/help/auto-pilot' },
      { k: 'vnav.p.video', href: '/help/video' },
      { k: 'vnav.p.byok', href: '/help/api-keys' },
      { k: 'land.footer.use_cases', href: '/use-cases' },
      { k: 'land.footer.compare', href: '/compare' },
    ],
  },
  {
    id: 'kaynak',
    label: 'vnav.resources',
    items: [
      { k: 'vnav.r.test', href: '/#test' },
      { k: 'nav.guides', href: '/rehber' },
      { k: 'land.footer.ai_visibility', href: '/rehber/yapay-zeka-gorunurlugu' },
      { k: 'land.footer.chatgpt_guide', href: '/rehber/chatgpt-markam-gorunuyor-mu' },
      { k: 'vnav.r.glossary', href: '/help/glossary' },
      { k: 'vnav.r.start', href: '/help/getting-started' },
      { k: 'vnav.r.help', href: '/help' },
      { k: 'vnav.r.bot', href: '/bot' },
    ],
  },
];

const LINKS: Item[] = [
  { k: 'land.nav.pricing', href: '/pricing' },
  { k: 'vnav.about', href: '/about' },
  { k: 'land.nav.faq', href: '/faq' },
];

const LINK_CLASS = 'transition-colors duration-200 hover:text-foreground';

export function VitrinNav() {
  const { t } = useT();
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAuthed = !!session?.user;
  const [open, setOpen] = useState<GroupId | null>(null);
  const [mobile, setMobile] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  const closeAll = () => { setOpen(null); setMobile(false); };

  // Sayfa degisince menuler kapanir (ayni sayfadaki #baglantilar icin onClick de kapatir)
  useEffect(() => { closeAll(); }, [pathname]);

  // Esc ve menu disina dokunma
  useEffect(() => {
    if (!open && !mobile) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll(); };
    const onDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) closeAll();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, mobile]);

  return (
    <nav
      ref={navRef}
      aria-label={t('vnav.menu')}
      className={cn('sticky top-0 z-50 border-b border-border', mobile ? 'bg-background' : 'bg-background/85 backdrop-blur-md')}
    >
      <div className={`${VITRIN_WRAP} flex h-16 items-center justify-between gap-4`}>
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center" aria-label="RanksUp" onClick={closeAll}>
            <BrandWordmark size={22} reversed accent="hsl(var(--brand-vivid))" />
          </Link>

          {/* Masaustu */}
          <div className="hidden items-center gap-7 whitespace-nowrap text-sm text-muted-foreground lg:flex">
            {GROUPS.map((g) => {
              const on = open === g.id;
              return (
                <div
                  key={g.id}
                  className="relative"
                  // Yalniz fare: dokunmatikte pointerenter + click art arda gelip menuyu acip kapatiyordu
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(g.id); }}
                  onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(null); }}
                  onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(null); }}
                >
                  <button
                    type="button"
                    aria-expanded={on}
                    aria-controls={`vnav-${g.id}`}
                    onClick={() => setOpen(g.id)}
                    className={cn('inline-flex h-16 items-center gap-1.5', LINK_CLASS, on && 'text-foreground')}
                  >
                    {t(g.label)}
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', on && 'rotate-180')} aria-hidden />
                  </button>
                  {on && (
                    <div id={`vnav-${g.id}`} className="absolute -left-5 top-full w-80 rounded-b-lg border border-t-0 border-border bg-card py-2">
                      <ul>
                        {g.items.map((it) => (
                          <li key={it.href}>
                            <Link
                              href={it.href}
                              onClick={closeAll}
                              className="group flex items-center justify-between gap-4 px-5 py-2.5 text-sm text-muted-foreground transition-colors duration-200 hover:bg-white/5 hover:text-foreground"
                            >
                              {t(it.k)}
                              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-dim transition-colors duration-200 group-hover:text-brand-vivid" aria-hidden />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
            {LINKS.map((it) => (
              <Link key={it.href} href={it.href} className={cn(LINK_CLASS, pathname === it.href && 'text-foreground')}>
                {t(it.k)}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-5">
          <LocaleSwitch quiet />
          {isAuthed ? (
            <Link href="/dashboard" className="v-btn h-9 px-4">
              {t('nav.dashboard')}
              <ArrowUpRight className="hidden h-4 w-4 sm:block" aria-hidden />
            </Link>
          ) : (
            <>
              <Link href="/signin" className={cn('hidden text-sm text-muted-foreground sm:inline', LINK_CLASS)}>
                {t('land.nav.login')}
              </Link>
              <Link href="/signin?signup=1" onClick={() => trackCta('nav_signup')} className="v-btn h-9 px-4">
                {t('land.nav.signup')}
                <ArrowUpRight className="hidden h-4 w-4 sm:block" aria-hidden />
              </Link>
            </>
          )}
          <button
            type="button"
            aria-expanded={mobile}
            aria-controls="vnav-mobil"
            aria-label={t('vnav.menu')}
            onClick={() => { setOpen(null); setMobile((v) => !v); }}
            className="grid h-9 w-9 place-items-center rounded-md border border-white/25 text-foreground transition-colors duration-200 hover:border-white lg:hidden"
          >
            {mobile ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </div>

      {/* Mobil ve tablet: tum baglantilar tek panelde, gruplar baslikli */}
      {mobile && (
        <div id="vnav-mobil" className="max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-t border-border lg:hidden">
          <div className={`${VITRIN_WRAP} grid gap-8 py-8 sm:grid-cols-2`}>
            {GROUPS.map((g) => (
              <div key={g.id}>
                <p className="v-rail mb-3">{t(g.label)}</p>
                <ul>
                  {g.items.map((it) => (
                    <li key={it.href} className="border-b border-border">
                      <Link href={it.href} onClick={closeAll} className="flex items-center justify-between gap-4 py-3 text-base">
                        {t(it.k)}
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-dim" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <ul className="sm:col-span-2">
              {[...LINKS, ...(isAuthed ? [] : [{ k: 'land.nav.login' as Key, href: '/signin' }])].map((it) => (
                <li key={it.href} className="border-b border-border">
                  <Link href={it.href} onClick={closeAll} className="flex items-center justify-between gap-4 py-3 text-base">
                    {t(it.k)}
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-dim" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </nav>
  );
}
