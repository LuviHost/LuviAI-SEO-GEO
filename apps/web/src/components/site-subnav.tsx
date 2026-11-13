'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { roofTabsForPath } from '@/lib/site-nav';

/**
 * Ayni cati altindaki sayfalar arasi sekme seridi (lib/site-nav SITE_ROOFS).
 * Gorunum FilterChip ile ayni sozlesme (h-7 + rounded-chip, secili notr dolu):
 * turuncu birincil eyleme kalir. Yol bir catiya ait degilse hicbir sey cizmez.
 */
export function SiteSubnav({ siteId, path }: { siteId: string; path: string }) {
  const roof = roofTabsForPath(path, siteId);
  if (!roof) return null;
  return (
    <nav aria-label={roof.label} className="flex flex-wrap gap-1.5">
      {roof.tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href as any}
          aria-current={t.active ? 'page' : undefined}
          className={cn(
            'inline-flex h-7 items-center rounded-chip border px-2.5 text-filter transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            t.active
              ? 'border-foreground bg-foreground text-background'
              : 'border-border bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
