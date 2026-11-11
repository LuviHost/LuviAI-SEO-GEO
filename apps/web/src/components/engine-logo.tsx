import { cn } from '@/lib/utils';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';

/**
 * AI saglayici kimligi → logo. Backend saglayici kimlikleri (anthropic, openai,
 * xai, meta ...) ile landing'deki logolar tek yerden eslesir; panelde motor adi
 * yazan her yer `<EngineLogo provider=... />` ile ayni gorsel dili kullanir.
 */
const PROVIDER_TO_VENDOR: Record<string, VendorName> = {
  anthropic: 'claude-ai',
  claude: 'claude-ai',
  openai: 'chatgpt',
  chatgpt: 'chatgpt',
  gemini: 'gemini',
  google: 'gemini',
  perplexity: 'perplexity',
  xai: 'grok',
  grok: 'grok',
  deepseek: 'deepseek',
  // `meta` = Muse (PR #69); kendi logosuyla. `llama` eski kayitlar icin Meta isaretinde kalir.
  meta: 'muse',
  llama: 'meta-ai',
};

/** Kare "uygulama ikonu" bicimindeki SVG'ler — kucuk boyutta daireye kirpilir */
const TILE: ReadonlySet<VendorName> = new Set<VendorName>(['chatgpt', 'claude-ai']);

export function engineVendor(provider: string | null | undefined): VendorName | null {
  if (!provider) return null;
  return PROVIDER_TO_VENDOR[provider.toLowerCase()] ?? null;
}

export function EngineLogo({ provider, size = 16, className }: { provider: string; size?: number; className?: string }) {
  const vendor = engineVendor(provider);
  if (!vendor) return null;
  return <VendorLogo name={vendor} size={size} alt="" className={cn(TILE.has(vendor) && 'rounded-full', className)} />;
}

/**
 * Olculen 6 asistan — plans.ts ve landing'deki yorungeyle ayni sira. Meta AI (Muse) burada
 * YOK: yalniz META_MODEL_API_KEY tanimliyken olculur (ai-citation.service.ts); "olculen"
 * seridinde kosulsuz gostermek yanlis vaat olurdu. API Llama sonucu donerse sonuc
 * listeleri onu kendi verisinden ciz.
 */
export const MEASURED_ENGINES = ['openai', 'gemini', 'anthropic', 'perplexity', 'xai', 'deepseek'] as const;

const ENGINE_NAMES: Record<string, string> = {
  openai: 'ChatGPT',
  gemini: 'Gemini',
  anthropic: 'Claude',
  perplexity: 'Perplexity',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  meta: 'Muse',
};

/**
 * Basliklarin altinda "hangi asistanlarda olculur" logo dizisi.
 *
 * `engines`: HESABIN olctugu asistanlar (lib/entitlements → api billing/entitlements.ts).
 * 11.11.2026 paket yapisi: Baslangic ve deneme dort asistan olcer; serit sabit alti logo
 * cizerse o hesaba olcmedigimiz iki asistani gosterir. Verilmezse (urunun genel anlatimi)
 * her kurulumda olculen alti asistan cizilir.
 */
export function EngineStrip({ className, engines }: { className?: string; engines?: readonly string[] }) {
  const list = (engines ?? MEASURED_ENGINES).filter((p) => ENGINE_NAMES[p] && engineVendor(p));
  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)} aria-label="Ölçülen AI asistanları">
      {list.map((p) => (
        <li key={p} className="relative grid h-7 w-7 place-items-center rounded-full border border-border bg-white" title={ENGINE_NAMES[p]}>
          <EngineLogo provider={p} size={16} />
          <span className="sr-only">{ENGINE_NAMES[p]}</span>
        </li>
      ))}
    </ul>
  );
}
