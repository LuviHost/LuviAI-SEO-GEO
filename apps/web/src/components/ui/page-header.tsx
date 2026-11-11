import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sayfa basligi — TEK h1 sozlesmesi (eski sayfa sayfa degisen text-3xl font-bold
 * yerine). Cift baslik sorununun cozumu: sites/[id]/layout.tsx bunu kullanir,
 * cocuk sayfalar h1 acmaz.
 *
 * 12.11.2026 (vitrin dili): baslik vitrindeki gibi ince agirlikli, siki aralikli
 * Geist (text-panel-1); geri baglantisi ve alt satir mono serit; basligin altinda
 * vitrin bolumlerindeki ince cizgi.
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
    <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-border pb-6', className)}>
      <div className="min-w-0">
        {backHref && (
          <Link
            href={backHref}
            className="v-rail inline-flex items-center gap-1.5 transition-colors duration-200 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> {backLabel}
          </Link>
        )}
        <div className={cn('flex min-w-0 items-center gap-3.5', backHref && 'mt-4')}>
          {leading}
          <div className="min-w-0">
            {/* pb-1: truncate tasmayi kirpar; siki satir yuksekliginde g/s/y kuyruklari kesilmesin */}
            <h1 className="truncate pb-1 text-panel-1">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            {meta && <div className="mt-1 font-mono text-vitrin-rail text-muted-foreground">{meta}</div>}
          </div>
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
