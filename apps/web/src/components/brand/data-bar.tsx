import { cn } from '@/lib/utils';

/**
 * DataBar — spec'teki yatay bar dili.
 * Track = zemine zıt renk %8 alpha, tam genişlik; dolgu turuncu (birincil) /
 * taş (diğer seriler) / açık taş (muted); değer sağda Sora 700 tabular.
 *
 * value: 0-100 (bar genişliği). display: sağda gösterilecek metin
 * (verilmezse "%value" basılır — ör. display="1.240" ile ham sayı gösterilebilir).
 */
export function DataBar({
  label,
  value,
  display,
  tone = 'primary',
  className,
}: {
  label: string;
  value: number;
  display?: string;
  tone?: 'primary' | 'stone' | 'muted';
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  const fillClass = {
    primary: 'bg-brand-600 dark:bg-brand-400',
    stone: 'bg-stone-data',
    muted: 'bg-[#C9BFB2]',
  }[tone];

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#6E6259] dark:text-[#A99F92]">
          {label}
        </span>
        <span className="font-brandDisplay text-sm font-bold tabular-nums">
          {display ?? `%${v}`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-[2px] bg-ink/[0.08] dark:bg-bone/[0.08]">
        <div className={cn('h-full rounded-[2px]', fillClass)} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

/**
 * DataBarGroup — birden çok DataBar'ı spec ritmiyle dizer.
 */
export function DataBarGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('flex w-full flex-col gap-4', className)}>{children}</div>;
}
