import { cn } from '@/lib/utils';

/**
 * Basamak motifi — sağ-üste tırmanan kare basamaklar (logodaki ↗ okunun
 * rasterize hali). Son kare RanksUp Turuncu (#E04E24) = ok ucu; diğerleri
 * currentColor düşük opacity → hem açık hem koyu zeminde çalışır.
 *
 * Kullanım: köşe süsü (sağ-üst), bölüm ayırıcı, liste bullet'ı, boş-durum.
 */

const BRAND = '#E04E24';
const UNIT = 12; // 10px kare + 2px boşluk
const SQUARE = 10;

export function StepMotif({
  size = 40,
  steps = 4,
  className,
}: {
  size?: number;
  steps?: number;
  className?: string;
}) {
  // Spec: 3-5 kare
  const n = Math.min(5, Math.max(3, Math.round(steps)));
  const dim = n * UNIT - (UNIT - SQUARE);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      {Array.from({ length: n }, (_, i) => (
        <rect
          key={i}
          x={i * UNIT}
          y={(n - 1 - i) * UNIT}
          width={SQUARE}
          height={SQUARE}
          fill={i === n - 1 ? BRAND : 'currentColor'}
          opacity={i === n - 1 ? 1 : 0.18}
        />
      ))}
    </svg>
  );
}

/**
 * Yatay bölüm ayırıcı — hairline çizgi + basamak motifi.
 * Çizgi currentColor'dan türediği için ink ve bone zeminde aynı kodla çalışır.
 */
export function StepDivider({ className }: { className?: string }) {
  return (
    <div role="separator" className={cn('flex items-center gap-4', className)}>
      <div className="h-px flex-1 bg-current opacity-10" />
      <StepMotif size={18} steps={3} />
    </div>
  );
}
