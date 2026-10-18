/**
 * AI gorunurluk olcumunun saglayici sabitleri — saf modul (Nest, Prisma, ag yok).
 *
 * NEDEN AYRI DOSYA: ayni tablolar uc yerden okunuyor: olcum servisi
 * (ai-citation.service.ts), App Prompt Lab (aso/aso-prompt-lab.service.ts) ve
 * kurum karnesi CLI'i (cli/prospect-karne.ts). CLI on maliyet tahminini servisi
 * YUKLEMEDEN yapar (--dry-run Prisma acmaz); bu yuzden tablolarin kopyasini
 * tutuyordu ve kopya bayatlamisti: Claude probe tavani CLI'da 0.03, serviste
 * 0.2 USD — tahmin ~6.7 kat dusuk cikiyordu. "Bu saglayici yapilandirilmis mi"
 * kurali da iki yerde ayri yaziliyordu. Tek kaynak burasi.
 *
 * Provider tipi YALNIZ TIP olarak ice aktarilir (calisma zamaninda silinir):
 * modul servisi yuklemez, servis de bu modulu yukler — dongu olusmaz.
 */
import type { Provider } from './ai-citation.service.js';

/** Havuz (platform) anahtarinin env adi — saglayici basina */
export const POOL_ENV_KEY: Readonly<Record<Provider, string>> = {
  anthropic:  'ANTHROPIC_API_KEY',
  gemini:     'GOOGLE_AI_API_KEY',
  openai:     'OPENAI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  xai:        'XAI_API_KEY',
  deepseek:   'DEEPSEEK_API_KEY',
  meta:       'GROQ_API_KEY',          // Llama via Groq
};

/**
 * Probe basina maliyet TAVANI (USD). Aramasiz sohbet uclarinda (Grok,
 * DeepSeek, Llama) bir probe yaklasik ~150 girdi + ~400 cikti tokeni;
 * web aramali saglayicilarin (Claude, Gemini, ChatGPT) gerekcesi satirlarinda.
 *
 * DIKKAT — bu sabitler MATEMATIKSEL UST SINIR olmak zorunda, ortalama degil:
 * butce guard'i (ai-citation.service.ts isOverBudget) harcamayi cagri ONCESI
 * projekte eder, gercek fatura sabitten buyukse gunluk cap sessizce asilir.
 * Kurum karnesi CLI'i da on tahminini bu tablodan yapar.
 *
 * anthropic (Opus 5.5 + web_search, 2026-10): olculen ~23K girdi (arama
 *   sonuclari dahil) x $4/1M = $0.09 + cikti max_tokens 3000 x $20/1M = $0.06
 *   + en fazla 2 arama x $0.01 → tavan ~$0.17, guvenli pay ile 0.2.
 * Thinking Opus 5.5'te kapatilamiyor ve thinking tokenlari da cikti olarak
 * faturalanir; bu yuzden tavan max_tokens uzerinden hesaplanir.
 * Model, max_tokens veya max_uses degistirirken BURAYI da guncelle.
 */
export const COST_PER_PROBE_USD: Readonly<Record<Provider, number>> = {
  anthropic:  0.2,
  // Gemini SIFIR OLAMAZ (sifirken butce guard'i hic calismiyordu).
  // Ekim 2026: Google Search grounding — istek basi $14–35/1K + ~1K token.
  gemini:     0.04,
  // Ekim 2026: Responses API web_search — arama basi $10–25/1K +
  // ~9K arama icerigi girdi tokeni (gpt-4o-mini $0.15/1M) + cikti.
  openai:     0.03,
  perplexity: 0.0006,
  xai:        0.0003,
  deepseek:   0.0006,
  meta:       0.0002,        // Groq Llama 3.3 70B ~$0.59/1M in + $0.79/1M out → ~$0.0002/probe
};

/**
 * Meta AI (Llama) olculebilir mi: Groq eski varsayilan modeli
 * (llama-3.3-70b-versatile) kaldirdi; GROQ_LLAMA_MODEL ile yeni model
 * verilmeden Llama cagrilmaz. Bos ya da yalniz bosluk = tanimsiz.
 *
 * Kaynak (18.10.2026'da dogrulandi): https://console.groq.com/docs/deprecations
 * — llama-3.3-70b-versatile ve llama-3.1-8b-instant 16.08.2026'da kapatildi
 * (kurumsal taahhutlu sozlesmeler haric), Llama 4 Scout/Maverick daha once;
 * onerilen yerine gecenler Llama degil (openai/gpt-oss-*, qwen).
 */
export function llamaModelConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.GROQ_LLAMA_MODEL?.trim();
}

/** Bir saglayicinin olcum sonucu (runPublicProbes satiri) — yalniz kuralin baktigi alanlar */
export interface ProviderRunState {
  provider: string;
  available?: boolean;
  reason?: string;
}

/**
 * Saglayici bu kurulumda HIC yapilandirilmamis mi: havuz anahtari yok ya da
 * Meta/Llama icin GROQ_LLAMA_MODEL tanimsiz.
 *
 * Boyle saglayici cagrilmaz (runPublicProbes 'NO_KEY' doner) ve sonuc
 * listelerinde "Kullanılamadı" karti olarak GOSTERILMEZ: musteri olcmedigimiz
 * bir asistanin kartini gormemeli; karne de onu kapsam disi sayar (karne-html
 * yalniz reason 'NO_KEY' satirini kapsam disi tutar). Yapilandirilmis ama o
 * olcumde hata veren saglayici bu kurala GIRMEZ — "ölçülemedi" olarak kalir.
 *
 * Iki kullanim, tek kural:
 *  - olcum ONCESI saglayici adiyla (runPublicProbes, karne CLI'i): anahtar
 *    yoksa ya da model tanimsiz Llama ise true;
 *  - olcum SONRASI sonuc satiriyla (App Prompt Lab): 'NO_KEY' ya da model
 *    tanimsiz Llama ise true. available:false + 'HATA: ...' satiri saglayicinin
 *    CAGRILDIGINI (anahtari oldugunu) gosterir — false, listede kalir.
 *
 * Bilinmeyen saglayici adi (Provider disi) olcum oncesi yapilandirilmamis sayilir.
 */
export function isUnconfiguredProvider(input: string | ProviderRunState, env: NodeJS.ProcessEnv = process.env): boolean {
  const r: ProviderRunState = typeof input === 'string' ? { provider: input } : input;
  // Olculdu: yapilandirilmis demektir
  if (r.available === true) return false;
  if (r.reason === 'NO_KEY') return true;
  if (r.provider === 'meta' && !llamaModelConfigured(env)) return true;
  // Sonuc yok (olcum oncesi): havuz anahtari var mi
  if (r.available === undefined) {
    const keyVar = (POOL_ENV_KEY as Record<string, string | undefined>)[r.provider];
    return !keyVar || !env[keyVar];
  }
  return false;
}
