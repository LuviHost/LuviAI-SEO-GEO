import { cn } from '@/lib/utils';

/**
 * Kurulum ekrani kabugu — duz sahne.
 *
 * 12.11.2026 (vitrin dili ic sayfalarda): eski "dijital sahne" (turuncu-mavi
 * radyal isik, turuncu izgara, yanip sonen 28 nokta) kaldirildi. Panel artik
 * vitrinle ayni sahnede: notr zemin, susleme yok; dikkat ortadaki tek rakamda
 * (MissionWheel).
 */
export function MissionShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('relative min-h-[calc(100vh-4rem)]', className)}>{children}</div>;
}
