'use client';

import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMeasurementAllowance } from '@/lib/measurement-allowance';

/**
 * Haftalik AI olcum hakki kullanildiysa butonun yaninda kisa not.
 * Hak varken hicbir sey cizmez.
 */
export function MeasurementLimitNote({ className }: { className?: string }) {
  const { blocked, nextLabel } = useMeasurementAllowance();
  if (!blocked) return null;
  return (
    <p role="status" className={cn('flex items-start gap-1.5 text-xs text-muted-foreground', className)}>
      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Bu haftaki AI ölçüm hakkını kullandın. Her hesap 7 günde 1 ölçüm yapabilir; sonraki ölçüm{' '}
        <span className="font-medium text-foreground">{nextLabel}</span> itibarıyla açılır.
      </span>
    </p>
  );
}
