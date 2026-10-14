'use client';

import { AlertCircle, RotateCw } from 'lucide-react';
import { Button } from './button';
import { Skeleton } from './skeleton';
import { cn } from '@/lib/utils';

/**
 * Yükleniyor / hata / boş / içerik — TEK sarmalayıcı.
 * Eskiden ekranlar düz "Yükleniyor…" metni, tek spinner, iskelet ya da hiçbir
 * şey (widget null dönüp sonradan "patlıyordu") arasında dağınıktı; hatalar
 * çoğu yerde sessizce yutuluyordu.
 */
export function AsyncState({
  loading,
  error,
  empty,
  onRetry,
  skeleton,
  emptyView,
  children,
  className,
}: {
  loading: boolean;
  error?: unknown;
  empty?: boolean;
  onRetry?: () => void;
  /** Gelecek içeriğin şekli — varsayılan 3 satır */
  skeleton?: React.ReactNode;
  emptyView?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  if (loading) {
    return (
      <div className={cn('space-y-3', className)} aria-busy="true" aria-label="Yükleniyor">
        {skeleton ?? [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={onRetry} className={className} />;
  if (empty && emptyView) return <>{emptyView}</>;
  return <>{children}</>;
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const message = (error as { message?: string })?.message ?? 'Bir şeyler ters gitti.';
  return (
    <div role="alert" className={cn('flex flex-wrap items-center gap-3 rounded-lg border border-danger/25 bg-danger/5 p-4 text-sm', className)}>
      <AlertCircle className="h-5 w-5 shrink-0 text-danger" aria-hidden />
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Tekrar dene
        </Button>
      )}
    </div>
  );
}
