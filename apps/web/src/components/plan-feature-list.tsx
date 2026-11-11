import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Fiyat kartinin madde listesi — /pricing ve ana sayfadaki fiyat bolumu ayni bileseni kullanir.
 *
 * Maddeler API'den gelir (tek kaynak apps/api/src/billing/plans.ts); burada metin TUTULMAZ.
 * Yalniz gorunum: " — " ile ayrilan madde iki kademede cizilir — ozelligin adi parlak, ayrintisi
 * altinda soluk. Kart boyle taranir (sol kenar ozellik adlari), ayrinti ise kaybolmaz: plan
 * maddelerindeki kosullar ("Search Console bağlıyken", "haftada 1 ölçüm kuralı geçerli")
 * musteriye verilen sozun parcasi, kisaltmak icin atilamaz.
 */
export function splitFeature(text: string): { title: string; detail: string } {
  const i = text.indexOf(' — ');
  return i === -1 ? { title: text, detail: '' } : { title: text.slice(0, i), detail: text.slice(i + 3) };
}

export function PlanFeatureList({ features, className }: { features: readonly string[]; className?: string }) {
  return (
    <ul className={cn('space-y-3 text-sm leading-snug', className)}>
      {features.map((f, i) => {
        const { title, detail } = splitFeature(f);
        return (
          <li key={i} className="flex items-start gap-2.5">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-vivid" aria-hidden />
            <span>
              {title}
              {detail && (
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {/* Ekran okuyucu ve kopyalanan metin icin ayirici korunur */}
                  <span className="sr-only"> — </span>
                  {detail}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
