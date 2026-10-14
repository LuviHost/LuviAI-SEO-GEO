'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Apple, Globe, Smartphone, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TrackedApp } from './types';

/** Uygulama ikonu — yoksa nötr yer tutucu */
export function AppIcon({ src, size = 'md', className }: { src: string | null | undefined; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dim = { sm: 'h-8 w-8 rounded-lg', md: 'h-12 w-12 rounded-xl', lg: 'h-14 w-14 rounded-xl' }[size];
  if (src) return <img src={src} alt="" className={cn(dim, 'shrink-0', className)} />;
  return (
    <div className={cn(dim, 'grid shrink-0 place-items-center bg-muted', className)} aria-hidden>
      <Smartphone className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}

/** iOS / Android / ülke rozetleri */
export function StoreBadges({ app, className }: { app: Pick<TrackedApp, 'appStoreId' | 'playStoreId' | 'country'>; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {app.appStoreId && (
        <Badge variant="outline" className="gap-1 px-2 text-label">
          <Apple className="h-3 w-3" aria-hidden /> iOS
        </Badge>
      )}
      {app.playStoreId && (
        <Badge variant="outline" className="gap-1 px-2 text-label">
          <Smartphone className="h-3 w-3" aria-hidden /> Android
        </Badge>
      )}
      <Badge variant="outline" className="gap-1 px-2 text-label">
        <Globe className="h-3 w-3" aria-hidden /> {app.country.toUpperCase()}
      </Badge>
    </div>
  );
}

/** Puan — "★ 4,6" */
export function Rating({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <span className={cn('inline-flex items-center gap-1 tabular-nums', className)}>
      <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden />
      {value.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
    </span>
  );
}

/** 5 yıldız dizisi (yorum kartları) */
export function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} / 5 yıldız`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn('h-3 w-3', i < rating ? 'fill-warning text-warning' : 'text-muted-foreground/30')} aria-hidden />
      ))}
    </span>
  );
}

/**
 * Bağlantı tabanlı sekme çubuğu — ui/tabs ile aynı görünüm, ama her sekme
 * bir rota: derin bağlantı, Geri tuşu ve yenileme çalışır.
 */
export function LinkTabs({
  items,
  className,
  label,
}: {
  items: Array<{ href: string; label: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; exact?: boolean; count?: number }>;
  className?: string;
  label: string;
}) {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label={label} className={cn('-mx-1 overflow-x-auto px-1', className)}>
      <div className="inline-flex h-10 items-center rounded-lg bg-slate-100 p-1 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        {items.map((it) => {
          const active = it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(`${it.href}/`);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                active
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-950 dark:text-slate-50'
                  : 'hover:text-slate-900 dark:hover:text-slate-100',
              )}
            >
              {Icon && <Icon className="h-4 w-4" aria-hidden />}
              {it.label}
              {typeof it.count === 'number' && (
                <span className="rounded-full bg-slate-200 px-1.5 text-label tabular-nums text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {it.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
