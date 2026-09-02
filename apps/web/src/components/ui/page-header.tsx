import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sayfa basligi — TEK h1 sozlesmesi (text-h6 font-semibold; eski sayfa sayfa
 * degisen text-3xl font-bold yerine). Cift baslik sorununun cozumu:
 * sites/[id]/layout.tsx bunu kullanir, cocuk sayfalar h1 acmaz.
 */
export function PageHeader({
  title,
  description,
  backHref,
  backLabel = 'Geri',
  meta,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  /** Baslik altinda kucuk satir — orn. site URL'i */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {backHref && (
          <Link
            href={backHref}
            className="text-label text-muted-foreground hover:text-brand inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" /> {backLabel}
          </Link>
        )}
        <h1 className={cn('text-h6 font-semibold tracking-tight truncate', backHref && 'mt-1.5')}>{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        {meta && <div className="text-label text-muted-foreground mt-1">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
