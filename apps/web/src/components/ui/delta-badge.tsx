import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Degisim rozeti — +N / -N / 0 gosterimi. Renk semantigi SABIT:
 * artis emerald, dusus rose, degisim yok muted. (Sayfa sayfa farkli
 * yesil/kirmizi tonlari yerine tek sozlesme.)
 *
 * `iyiYon="asagi"` — dususun iyi oldugu metrikler icin (orn. hata sayisi):
 * renk tersine doner, ikon yon degistirmez.
 */
export function DeltaBadge({
  delta,
  suffix,
  iyiYon = 'yukari',
  className,
}: {
  delta: number;
  /** orn. "%" ya da " sıra" */
  suffix?: string;
  iyiYon?: 'yukari' | 'asagi';
  className?: string;
}) {
  const yon = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const iyi = yon === 'flat' ? null : (yon === 'up') === (iyiYon === 'yukari');
  const Icon = yon === 'up' ? TrendingUp : yon === 'down' ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-label tabular-nums',
        iyi === null && 'bg-muted text-muted-foreground',
        iyi === true && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        iyi === false && 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {yon === 'up' ? '+' : ''}
      {delta}
      {suffix}
    </span>
  );
}
