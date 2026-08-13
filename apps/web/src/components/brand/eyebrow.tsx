import { cn } from '@/lib/utils';

/**
 * Eyebrow — "ölçüm sesi" etiketi (Basamak v1).
 * Geist Mono, UPPERCASE, 0.14em tracking, 12px, weight 500, muted renk.
 * index verilirse turuncu önek basılır: <Eyebrow index="BULGU 01">İÇERİK TİPİ</Eyebrow>
 * → "BULGU 01 · İÇERİK TİPİ"
 */
export function Eyebrow({
  index,
  className,
  children,
}: {
  index?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-block font-mono text-[12px] font-medium uppercase tracking-[0.14em]',
        'text-[#6E6259] dark:text-[#A99F92]',
        className,
      )}
    >
      {index && (
        <>
          <span className="text-brand-600 dark:text-brand-400">{index}</span>
          <span aria-hidden="true"> · </span>
        </>
      )}
      {children}
    </span>
  );
}
