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
  // Ekim 2026: renkli kesikli cerceve + renkli zemin kaldirildi (bos durum sayfanin en
  // "bagiran" ogesiydi). accent yalniz ikon rengini hafifce belirler.
  const iconColor: Record<string, string> = {
    brand: 'text-foreground/70',
    amber: 'text-warning',
    sky: 'text-info',
    emerald: 'text-success',
    rose: 'text-danger',
  };

  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center sm:p-12">
      <div className={cn('mx-auto mb-5 grid h-11 w-11 place-items-center rounded-md border', iconColor[accent] ?? iconColor.brand)}>
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mb-2 text-panel-2">{title}</h3>
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
    <div className="mt-6 rounded-lg border p-5">
      <p className="v-rail mb-3">{title}</p>
      <div className="grid sm:grid-cols-2 gap-2">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href as any}
              className="group flex items-start gap-3 rounded-md border border-transparent p-3 transition-colors duration-200 hover:border-border hover:bg-muted/50"
            >
              {Icon && (
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border text-muted-foreground transition-colors group-hover:text-foreground">
                  <Icon className="h-4 w-4" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{link.label}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground/60 transition-all group-hover:translate-x-0.5 group-hover:text-foreground" />
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
