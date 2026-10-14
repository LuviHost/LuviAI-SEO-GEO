import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sayfa basligi — TEK h1 sozlesmesi (Sora text-h5 font-semibold; eski sayfa sayfa
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
  leading,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  /** Baslik altinda kucuk satir — orn. site URL'i */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** Basligin solunda kimlik ogesi — orn. site favicon'u */
  leading?: React.ReactNode;
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
        <div className={cn('flex min-w-0 items-center gap-3', backHref && 'mt-2')}>
          {leading}
          <div className="min-w-0">
            <h1 className="truncate font-brand text-h5 font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
            {meta && <div className="mt-0.5 text-label text-muted-foreground">{meta}</div>}
          </div>
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
