'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { roofTabsForPath } from '@/lib/site-nav';

/**
 * Ayni cati altindaki sayfalar arasi sekme seridi (lib/site-nav SITE_ROOFS).
 *
 * Gorunum: sayfa basliginin alt cizgisine oturan alti cizili sekmeler. Secili sekme metin
 * renginde ve kalin cizgili, digerleri soluk; turuncu birincil eyleme kalir.
 * NEDEN cip degil (13.11.2026, sahip: "cok guzel bir tasarim degil"): cipler sayfa icindeki
 * filtre cipleriyle (FilterChip) ayni gorunuyordu — Gorsel Alt Metinleri'nde alt alta iki sira
 * ayni dugme — ve sayfa degistiren bir gezinme gibi degil, filtre gibi okunuyordu.
 *
 * Cizgi sarmalayicida, serit 1px asagi tasar: secili sekmenin kalin cizgisi ince cizginin
 * USTUNE oturur. Tasma seridin kendisinde olsaydi overflow-x-auto bu 1px'i kirpardi.
 * Yol bir catiya ait degilse hicbir sey cizmez (layout basligin kendi cizgisini korur).
 */
export function SiteSubnav({ siteId, path }: { siteId: string; path: string }) {
  const roof = roofTabsForPath(path, siteId);
  if (!roof) return null;
  return (
    <div className="border-b border-border">
      <nav
        aria-label={roof.label}
        className="-mb-px flex gap-7 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {roof.tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href as any}
            aria-current={t.active ? 'page' : undefined}
            className={cn(
              // pb-3 + pt-1: 44px'e yakin dokunma alani (eski cip 28px'ti)
              'inline-flex shrink-0 items-center whitespace-nowrap border-b-2 pb-3 pt-1 text-sm transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              t.active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:border-foreground/25 hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
