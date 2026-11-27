/**
 * Admin "AI Spend" sayfasindaki saglayici kredi tablosu — saf kurallar (27.11.2026).
 * Sahip: "yapay zeka modellerinin kredi durumlarını admin panelde görelim; Yükle deyince ilgili
 * linke yönlendirsin, ordan yükleyeyim". Yukleme sayfayi ACAR; odeme kullanicinin kendisi yapar.
 *
 * YUKLEME ADRESLERI (27.11.2026 dogrulandi):
 *  - Anthropic  platform.claude.com/settings/billing — support.claude.com/en/articles/8977456
 *  - OpenAI     platform.openai.com/settings/organization/billing/overview — help.openai.com/en/articles/8264644 ("API billing overview")
 *  - Gemini     ai.studio/projects — Gemini'nin kendi 402 hata metni bu adrese yonlendiriyor
 *  - Perplexity console.perplexity.ai/project/billing — docs.perplexity.ai FAQ
 *  - xAI        console.x.ai/team/default/billing — docs.x.ai/console/billing
 *  - DeepSeek   platform.deepseek.com/top_up — api-docs.deepseek.com/faq
 *  - Meta       dev.meta.ai — Meta Model API konsolu (citation-providers.ts notu + kurulum rehberleri); ayri fatura
 *               sayfasinin adresi belgede bulunamadi, konsoldan Billing'e gidilir
 *  - DataForSEO app.dataforseo.com — panel (bakiye ve odeme)
 *
 * BAKIYE API'si yalniz iki saglayicida var (digerleri bakiye ucu sunmuyor; xAI'inki ayri yonetim
 * anahtari ister): DeepSeek GET /user/balance, DataForSEO GET /v3/appendix/user_data (ucretsiz).
 */
import type { KrediDurumu } from '../audit/saglayici-durum.js';

export type KrediSaglayici = 'anthropic' | 'openai' | 'gemini' | 'perplexity' | 'xai' | 'deepseek' | 'meta' | 'dataforseo';

export interface SaglayiciTanimi {
  id: KrediSaglayici;
  ad: string;
  /** Havuz anahtarinin env adi (anahtar yoksa satir "anahtar yok" der) */
  envAnahtari: string;
  yukleUrl: string;
  /** Ne icin kullaniliyor (panel aciklamasi) */
  kullanim: string;
}

export const KREDI_SAGLAYICILARI: readonly SaglayiciTanimi[] = [
  { id: 'anthropic', ad: 'Anthropic (Claude)', envAnahtari: 'ANTHROPIC_API_KEY', yukleUrl: 'https://platform.claude.com/settings/billing', kullanim: 'Claude ölçümü, içerik ve asistan' },
  { id: 'openai', ad: 'OpenAI (ChatGPT)', envAnahtari: 'OPENAI_API_KEY', yukleUrl: 'https://platform.openai.com/settings/organization/billing/overview', kullanim: 'ChatGPT ölçümü, görseller' },
  { id: 'gemini', ad: 'Google Gemini', envAnahtari: 'GOOGLE_AI_API_KEY', yukleUrl: 'https://ai.studio/projects', kullanim: 'Gemini ölçümü' },
  { id: 'perplexity', ad: 'Perplexity', envAnahtari: 'PERPLEXITY_API_KEY', yukleUrl: 'https://console.perplexity.ai/project/billing', kullanim: 'Perplexity ölçümü' },
  { id: 'xai', ad: 'xAI (Grok)', envAnahtari: 'XAI_API_KEY', yukleUrl: 'https://console.x.ai/team/default/billing', kullanim: 'Grok ölçümü, X araması' },
  { id: 'deepseek', ad: 'DeepSeek', envAnahtari: 'DEEPSEEK_API_KEY', yukleUrl: 'https://platform.deepseek.com/top_up', kullanim: 'DeepSeek ölçümü' },
  { id: 'meta', ad: 'Meta AI (Muse)', envAnahtari: 'META_MODEL_API_KEY', yukleUrl: 'https://dev.meta.ai/', kullanim: 'Meta AI ölçümü' },
  { id: 'dataforseo', ad: 'DataForSEO', envAnahtari: 'DATAFORSEO_AUTH', yukleUrl: 'https://app.dataforseo.com/', kullanim: 'Google AI Modu ve AI Bakışı ölçümü' },
];

/** Bakiye bu tutarin altindaysa "azaldı" (USD) */
export const DUSUK_BAKIYE_USD = 5;

export type SatirDurumu = 'CALISIYOR' | 'KREDI_BITTI' | 'AZALDI' | 'ANAHTAR_YOK' | 'BILINMIYOR';

/**
 * Satir durumu. Oncelik: anahtar yok → bakiye 0 / API "kullanilamaz" → kredi hatasi → dusuk bakiye → son cagri.
 * Bakiye bilinen saglayicida bakiye, kendi cagri kaydimizdan once gelir (anlik ve kesin).
 */
export function satirDurumu(g: {
  anahtarVar: boolean;
  kayit: KrediDurumu;
  bakiyeUsd: number | null;
  bakiyeKullanilabilir?: boolean | null;
}): SatirDurumu {
  if (!g.anahtarVar) return 'ANAHTAR_YOK';
  if (g.bakiyeKullanilabilir === false || (g.bakiyeUsd !== null && g.bakiyeUsd <= 0)) return 'KREDI_BITTI';
  if (g.bakiyeUsd === null && g.kayit === 'KREDI_BITTI') return 'KREDI_BITTI';
  if (g.bakiyeUsd !== null && g.bakiyeUsd < DUSUK_BAKIYE_USD) return 'AZALDI';
  if (g.bakiyeUsd !== null) return 'CALISIYOR';
  return g.kayit;
}

/** DeepSeek /user/balance → USD bakiye (yoksa ilk para birimi) */
export function deepseekBakiye(j: unknown): { bakiye: number | null; paraBirimi: string | null; kullanilabilir: boolean | null } {
  const o = j as { is_available?: unknown; balance_infos?: Array<{ currency?: unknown; total_balance?: unknown }> } | null;
  const liste = Array.isArray(o?.balance_infos) ? o!.balance_infos : [];
  const secilen = liste.find((b) => b?.currency === 'USD') ?? liste[0];
  const n = Number(secilen?.total_balance);
  return {
    bakiye: Number.isFinite(n) ? n : null,
    paraBirimi: typeof secilen?.currency === 'string' ? secilen.currency : null,
    kullanilabilir: typeof o?.is_available === 'boolean' ? o.is_available : null,
  };
}

/** DataForSEO /v3/appendix/user_data → tasks[0].result[0].money.balance (USD) */
export function dataforseoBakiye(j: unknown): number | null {
  const n = Number((j as any)?.tasks?.[0]?.result?.[0]?.money?.balance);
  return Number.isFinite(n) ? n : null;
}
