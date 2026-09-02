'use client';

import NumberFlow, { type Format } from '@number-flow/react';

/**
 * Sayi animasyonu — @number-flow/react sarmalayicisi.
 * Eski elle yazilmis CountUp kopyalarinin (4 adet, ikisi DOM selector'a yaziyordu)
 * yerine TEK bilesen. prefers-reduced-motion'i NumberFlow kendisi tanir.
 * Yerellestirme: varsayilan tr-TR ayraclari (Intl uzerinden).
 */
export function NumberTicker({
  value,
  format,
  prefix,
  suffix,
  className,
}: {
  value: number;
  /** Intl.NumberFormat secenekleri — orn. { maximumFractionDigits: 1 } */
  format?: Format;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <NumberFlow
      value={value}
      format={format}
      prefix={prefix}
      suffix={suffix}
      locales="tr-TR"
      className={className}
    />
  );
}
