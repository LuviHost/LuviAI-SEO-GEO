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
  meta: 'meta-ai',
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
 * Olculen 6 asistan — plans.ts ve landing'deki yorungeyle ayni sira. Meta Llama burada
 * YOK: yalniz GROQ_LLAMA_MODEL tanimliyken olculur (ai-citation.service.ts); "olculen"
 * seridinde kosulsuz gostermek yanlis vaat olurdu. API Llama sonucu donerse sonuc
 * listeleri onu kendi verisinden ciz.
 */
export const MEASURED_ENGINES = ['openai', 'gemini', 'anthropic', 'perplexity', 'xai', 'deepseek'] as const;

const ENGINE_NAMES: Record<(typeof MEASURED_ENGINES)[number], string> = {
  openai: 'ChatGPT',
  gemini: 'Gemini',
  anthropic: 'Claude',
  perplexity: 'Perplexity',
  xai: 'Grok',
  deepseek: 'DeepSeek',
};

/** Basliklarin altinda "hangi asistanlarda olculur" logo dizisi */
export function EngineStrip({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)} aria-label="Ölçülen AI asistanları">
      {MEASURED_ENGINES.map((p) => (
        <li key={p} className="grid h-7 w-7 place-items-center rounded-full border border-border bg-white" title={ENGINE_NAMES[p]}>
          <EngineLogo provider={p} size={16} />
          <span className="sr-only">{ENGINE_NAMES[p]}</span>
        </li>
      ))}
    </ul>
  );
}
