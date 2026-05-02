'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';

/**
 * Polished empty state — illustrasyon + başlık + açıklama + CTA.
 * Kullanım: her sub-route'da data missing/empty olduğunda göster.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  primary,
  secondary,
  accent = 'brand',
  children,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  description?: string;
  primary?: { label: string; onClick?: () => void; href?: string };
  secondary?: { label: string; href: string };
  accent?: 'brand' | 'amber' | 'sky' | 'emerald' | 'rose';
  children?: React.ReactNode;
}) {
  const accentMap: Record<string, { ring: string; bg: string; iconColor: string }> = {
    brand: { ring: 'ring-brand/20', bg: 'bg-brand/5', iconColor: 'text-brand' },
    amber: { ring: 'ring-amber-500/20', bg: 'bg-amber-500/5', iconColor: 'text-amber-600 dark:text-amber-400' },
    sky: { ring: 'ring-sky-500/20', bg: 'bg-sky-500/5', iconColor: 'text-sky-600 dark:text-sky-400' },
    emerald: { ring: 'ring-emerald-500/20', bg: 'bg-emerald-500/5', iconColor: 'text-emerald-600 dark:text-emerald-400' },
    rose: { ring: 'ring-rose-500/20', bg: 'bg-rose-500/5', iconColor: 'text-rose-600 dark:text-rose-400' },
  };
  const a = accentMap[accent] ?? accentMap.brand;

  return (
    <div className={cn(
      'rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center',
      a.ring.replace('ring-', 'border-'),
      a.bg,
    )}>
      <div className={cn(
        'h-16 w-16 mx-auto mb-4 rounded-2xl grid place-items-center',
        'bg-card border shadow-sm',
        a.iconColor,
      )}>
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-xl sm:text-2xl font-bold mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-md mx-auto mb-5 leading-relaxed">
          {description}
        </p>
      )}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {primary && (
          primary.href ? (
            <Link href={primary.href as any}>
              <Button size="lg">{primary.label} <ArrowRight className="h-4 w-4 ml-1.5" /></Button>
            </Link>
          ) : (
            <Button size="lg" onClick={primary.onClick}>
              {primary.label} <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          )
        )}
        {secondary && (
          <Link href={secondary.href as any}>
            <Button size="lg" variant="outline">{secondary.label}</Button>
          </Link>
        )}
      </div>
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}

/**
 * RelatedLinks — sayfa altında "ilgili sayfalar" cross-product link footer.
 */
export function RelatedLinks({
  title = 'İlgili sayfalar',
  links,
}: {
  title?: string;
  links: Array<{ href: string; label: string; description?: string; icon?: React.ComponentType<React.SVGProps<SVGSVGElement>> }>;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-5 mt-6">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">{title}</p>
      <div className="grid sm:grid-cols-2 gap-2">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href as any}
              className="group flex items-start gap-3 rounded-lg p-3 hover:bg-card hover:border-brand/30 border border-transparent transition-all"
            >
              {Icon && (
                <div className="h-9 w-9 rounded-lg bg-card border grid place-items-center text-brand shrink-0 group-hover:bg-brand/10 transition-colors">
                  <Icon className="h-4 w-4" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{link.label}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground/60 group-hover:text-brand group-hover:translate-x-0.5 transition-all" />
                </div>
                {link.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{link.description}</p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
