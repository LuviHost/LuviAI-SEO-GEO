'use client';

import { useT } from '@/lib/i18n';
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
  google_ai_mode: 'Google AI Modu',
  google_ai_overview: 'Google AI Bakışı',
};
/** Ingilizce arayuzde Google yuzeylerinin adi (digerleri ozel ad, cevrilmez) */
const NAMES_EN: Record<string, string> = { google_ai_mode: 'Google AI Mode', google_ai_overview: 'Google AI Overviews' };

/** Kare "uygulama ikonu" bicimindeki logolar rozeti doldurur */
const TILE = new Set(['chatgpt', 'claude-ai']);

export function PlanEngineRow({ engines, label, className }: {
  engines?: readonly string[];
  /** Ekran okuyucu icin liste adi ("Ölçülen AI asistanları") */
  label: string;
  className?: string;
}) {
  // Dil ziyaretcinin secimi (lib/i18n); Google yuzeylerinin adi EN'de Ingilizce
  const { locale } = useT();
  const ad = (e: string) => (locale === 'en' ? NAMES_EN[e] : undefined) ?? NAMES[e];
  const tanimli = (engines ?? []).filter((e) => engineVendor(e) && NAMES[e]);
  // Google AI Modu ve AI Bakisi ayni Google isaretini tasir: tek rozet, adi ikisini birden soyler
  const ikiGoogle = tanimli.includes('google_ai_mode') && tanimli.includes('google_ai_overview');
  const known = ikiGoogle ? tanimli.filter((e) => e !== 'google_ai_overview') : tanimli;
  const ikisi = locale === 'en' ? 'Google AI Mode and AI Overviews' : 'Google AI Modu ve AI Bakışı';
  const adi = (e: string) => (ikiGoogle && e === 'google_ai_mode' ? ikisi : ad(e));
  if (known.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)} aria-label={label}>
      {known.map((e) => {
        const vendor = engineVendor(e)!;
        const tile = TILE.has(vendor);
        return (
          <li
            key={e}
            title={adi(e)}
            className="relative grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded bg-white"
          >
            <VendorLogo name={vendor} size={tile ? 24 : 15} alt="" className={tile ? 'h-full w-full' : undefined} />
            <span className="sr-only">{adi(e)}</span>
          </li>
        );
      })}
    </ul>
  );
}
