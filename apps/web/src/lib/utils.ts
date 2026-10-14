import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind.config'teki OZEL font boyutlari tailwind-merge'e tanitilir.
 *
 * NEDEN: tanitilmazsa `text-label`, `text-metric-lg` gibi siniflar RENK sanilir
 * ve ayni cn() cagrisindaki `text-muted-foreground` onu SILER — yani
 * `cn('text-label text-muted-foreground')` sessizce yalniz renge duser ve
 * token sozlesmesi (metrik/etiket olcegi) hic uygulanmaz.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'body', 'eyebrow', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'display-sm', 'display', 'display-lg', 'display-xl',
            'metric', 'metric-lg', 'label', 'filter',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
