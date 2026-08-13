import { cn } from '@/lib/utils';

/**
 * StatBlock — veri dili: dev sayı (Sora 800, tabular-nums) + mono uppercase label.
 * Sayı kahramandır.
 *
 * tone:
 *  - 'orange' → turuncu sayı (vurgu istatistik)
 *  - 'ink'    → açık zeminde ink, koyu zeminde bone (varsayılan)
 *  - 'bone'   → her zaman bone (surface-ink üstünde kullan)
 */
export function StatBlock({
  value,
  label,
  tone = 'ink',
  className,
}: {
  value: string | number;
  label: string;
  tone?: 'orange' | 'ink' | 'bone';
  className?: string;
}) {
  const toneClass = {
    orange: 'text-brand-600 dark:text-brand-400',
    ink: 'text-ink dark:text-bone',
    bone: 'text-bone',
  }[tone];

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        className={cn(
          'font-brandDisplay text-5xl font-extrabold leading-none tracking-[-0.03em] tabular-nums sm:text-6xl',
          toneClass,
        )}
      >
        {value}
      </div>
      <div className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#6E6259] dark:text-[#A99F92]">
        {label}
      </div>
    </div>
  );
}
