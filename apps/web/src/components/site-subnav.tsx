'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { roofTabsForPath } from '@/lib/site-nav';

/**
 * Ayni cati altindaki sayfalar arasi gecis (lib/site-nav SITE_ROOFS): aciklamali kartlar.
 * Her kart ikon + ad + tek satir "ne ise yarar"; secili kart metin renginde cerceveli,
 * digerleri soluk. Turuncu birincil eyleme kalir.
 *
 * Gecmis (13.11.2026, sahip): once filtre cipi gorunumundeydi ("cok guzel bir tasarim degil":
 * sayfa icindeki filtre cipleriyle karisiyordu), sonra alti cizili sekme oldu; bes secenek
 * arasindan bu secildi ("D yap"). Kart sayfanin adini tasidigi icin cati sayfalari kendi
 * basligini tekrar yazmaz (SectionHeader titleInTab).
 *
 * Telefonda kartlar alt alta dizilir; genis ekranda yan yana, en fazla 20rem genislikte.
 * Dort ve daha cok kartli catida (Ayarlar: 14.11.2026'da Yayin hedefleri eklendi) alt alta
 * dizmek telefonda icerigi ekranin altina iterdi: kartlar ikiserli iki sira olur, dar ekranda
 * aciklama gizlenir (ad + ikon kalir); 1440px ve ustunde dordu tek sirada (daha dar ekranda
 * tek sira kartlari sikistirip aciklamalari ikiser satira boluyordu).
 * Yol bir catiya ait degilse hicbir sey cizmez.
 */
export function SiteSubnav({ siteId, path }: { siteId: string; path: string }) {
  const roof = roofTabsForPath(path, siteId);
  if (!roof) return null;
  const cok = roof.tabs.length > 3;
  return (
    <nav
      aria-label={roof.label}
      className={cok ? 'grid grid-cols-2 gap-2.5 min-[1440px]:grid-cols-4' : 'flex flex-col gap-2.5 sm:flex-row'}
    >
      {roof.tabs.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href as any}
            aria-current={t.active ? 'page' : undefined}
            className={cn(
              'flex min-w-0 items-center rounded-md border transition-colors duration-200',
              cok ? 'gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-3.5 sm:py-3' : 'gap-3 px-3.5 py-3 sm:max-w-xs sm:flex-1',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              t.active
                ? 'border-foreground text-foreground shadow-[inset_0_0_0_1px_hsl(var(--foreground))]'
                : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'grid h-9 w-9 shrink-0 place-items-center rounded-md border',
                t.active ? 'border-foreground/25' : 'border-border',
              )}
              aria-hidden
            >
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t.label}</span>
              <span className={cn('text-xs text-muted-foreground', cok ? 'hidden sm:block' : 'block')}>{t.desc}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
