import { VendorLogo } from '@/components/vendor-logo';
import { engineVendor } from '@/components/engine-logo';
import { cn } from '@/lib/utils';

/**
 * Fiyat kartinda "bu plan hangi asistanlarda olcer" logo sirasi.
 *
 * Liste API'den gelir (GET /billing/plans → plan.engines): plan kapsami ile o an olculen
 * asistanlarin kesisimi (api billing.service toDefinition). Burada ikinci bir liste
 * TUTULMAZ — Baslangic dort, Profesyonel ve ustu alti asistan; Muse yalniz anahtari
 * tanimliyken listeye girer. Eski API yanitinda alan yoksa sira hic cizilmez.
 *
 * Logolarin bir kismi siyah ya da koyu tonlu (Grok): koyu vitrinde ancak beyaz rozette
 * okunur (ana sayfadaki seritle ayni rozet). Adlar ekran okuyucuya ve `title` ile verilir.
 */
const NAMES: Record<string, string> = {
  openai: 'ChatGPT',
  gemini: 'Gemini',
  anthropic: 'Claude',
  perplexity: 'Perplexity',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  meta: 'Muse',
};

/** Kare "uygulama ikonu" bicimindeki logolar rozeti doldurur */
const TILE = new Set(['chatgpt', 'claude-ai']);

export function PlanEngineRow({ engines, label, className }: {
  engines?: readonly string[];
  /** Ekran okuyucu icin liste adi ("Ölçülen AI asistanları") */
  label: string;
  className?: string;
}) {
  const known = (engines ?? []).filter((e) => engineVendor(e) && NAMES[e]);
  if (known.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)} aria-label={label}>
      {known.map((e) => {
        const vendor = engineVendor(e)!;
        const tile = TILE.has(vendor);
        return (
          <li
            key={e}
            title={NAMES[e]}
            className="relative grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded bg-white"
          >
            <VendorLogo name={vendor} size={tile ? 24 : 15} alt="" className={tile ? 'h-full w-full' : undefined} />
            <span className="sr-only">{NAMES[e]}</span>
          </li>
        );
      })}
    </ul>
  );
}
