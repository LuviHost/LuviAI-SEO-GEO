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

export type SatirDurumu = 'CALISIYOR' | 'KREDI_BITTI' | 'AZALDI' | 'HATA' | 'ANAHTAR_YOK' | 'BILINMIYOR';

/**
 * Satir durumu. Oncelik: anahtar yok → bakiye 0 / API "kullanilamaz" → kredi hatasi → dusuk bakiye → son cagri.
 * Bakiye bilinen saglayicida bakiye, kendi cagri kaydimizdan once gelir (anlik ve kesin).
 */
export function satirDurumu(g: {
  anahtarVar: boolean;
  kayit: KrediDurumu;
  bakiyeUsd: number | null;
  bakiyeKullanilabilir?: boolean | null;
  /** Elle kontrolde kredi disi hata son basaridan yeniyse (gecersiz anahtar, model yok...) */
  kontrolHatasiGuncel?: boolean;
  /** Admin girisi − harcama (USD). Yalniz "Azaldı" uretir; "Kredi bitti" gercek 402'den gelir */
  tahminiUsd?: number | null;
}): SatirDurumu {
  if (!g.anahtarVar) return 'ANAHTAR_YOK';
  if (g.bakiyeKullanilabilir === false || (g.bakiyeUsd !== null && g.bakiyeUsd <= 0)) return 'KREDI_BITTI';
  if (g.bakiyeUsd === null && g.kayit === 'KREDI_BITTI') return 'KREDI_BITTI';
  if (g.bakiyeUsd !== null && g.bakiyeUsd < DUSUK_BAKIYE_USD) return 'AZALDI';
  if (g.kontrolHatasiGuncel) return 'HATA';
  if (g.kayit !== 'KREDI_BITTI' && typeof g.tahminiUsd === 'number' && g.tahminiUsd < DUSUK_BAKIYE_USD) return 'AZALDI';
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

// ── Uyari (zil + e-posta, 27.11.2026) ─────────────────────────────
// Sahip: "bildirim zili ve e-posta uyarısını da ekle". Saat basi kontrol; ayni saglayici ayni
// durumdayken gunde en fazla bir uyari, durum kotulesirse (Azaldı → Kredi bitti) hemen,
// duzelince kayit silinir (sonraki kesintide hemen uyarilir).

export const UYARI_KV = 'saglayici-uyari:';
export const UYARI_TEKRAR_MS = 24 * 60 * 60_000;

export interface UyariKaydi { durum: SatirDurumu; at: string }

export function uyariGerekli(durum: SatirDurumu, onceki: UyariKaydi | null, simdi: Date = new Date()): boolean {
  if (durum !== 'KREDI_BITTI' && durum !== 'AZALDI') return false;
  if (!onceki) return true;
  if (onceki.durum !== durum) return durum === 'KREDI_BITTI' || onceki.durum !== 'KREDI_BITTI';
  const at = Date.parse(onceki.at);
  return !Number.isFinite(at) || simdi.getTime() - at >= UYARI_TEKRAR_MS;
}

export function uyariMetni(s: {
  ad: string; kullanim: string; durum: SatirDurumu; yukleUrl: string;
  bakiye: { tutar: number | null; paraBirimi: string | null } | null;
  tahmin?: { tutar: number; paraBirimi: string } | null;
}): { title: string; body: string } {
  const kaynak = s.bakiye?.tutar != null ? { tutar: s.bakiye.tutar, birim: s.bakiye.paraBirimi ?? 'USD', onek: '' }
    : s.tahmin ? { tutar: s.tahmin.tutar, birim: s.tahmin.paraBirimi, onek: 'tahmini ' } : null;
  const tutar = kaynak
    ? `${kaynak.onek}${kaynak.tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${kaynak.birim === 'TRY' ? 'TL' : kaynak.birim}`
    : null;
  if (s.durum === 'KREDI_BITTI') {
    return {
      title: `${s.ad} kredisi bitti`,
      body: `${s.ad} sistem anahtarının kredisi bitti${tutar ? ` (bakiye ${tutar})` : ''}; yüklenene kadar ${s.kullanim.toLocaleLowerCase('tr')} çalışmıyor. Yüklemek için: ${s.yukleUrl}`,
    };
  }
  return {
    title: `${s.ad} bakiyesi azaldı${tutar ? `: ${tutar}` : ''}`,
    body: `${s.ad} bakiyesi ${DUSUK_BAKIYE_USD} USD'nin altına indi${tutar ? ` (${tutar})` : ''}; bitince ${s.kullanim.toLocaleLowerCase('tr')} durur. Yüklemek için: ${s.yukleUrl}`,
  };
}

// ── Tahmini bakiye (27.11.2026) ────────────────────────────────
// Sahip: "kredilerimi admin panelden girelim, her sorgudaki token x birim maliyeti düşelim".
// Bakiye API'si olmayan saglayicida: girilen bakiye − girişten bu yana bizim kayitli harcamamiz.
// SINIRI (panelde yazar): saglayicinin bildigi ama bizim gormedigimiz harcama (ayni anahtari
// kullanan baska proje, Claude Code, otomatik yukleme) tahmini kaydirir; bu yuzden tahmin yalniz
// "Azaldı" uyarisi uretir, "Kredi bitti" yalniz saglayicinin gercek 402 hatasindan gelir.

export type BakiyeTuru = 'api' | 'manuel' | 'fatura';

/** Bakiye nereden: api = saglayici sorgusu, manuel = admin girisi − harcama, fatura = kartla sonradan odeme */
export const BAKIYE_TURU: Readonly<Record<KrediSaglayici, BakiyeTuru>> = {
  anthropic: 'manuel', openai: 'manuel', gemini: 'manuel', perplexity: 'manuel', xai: 'manuel',
  deepseek: 'api', dataforseo: 'api',
  // dev.meta.ai faturasi: "Outstanding balance" kartla 500 TL'de ya da ay sonunda cekilir — biten bakiye yok
  meta: 'fatura',
};

/** Harcama kayitlarinda (ai-gercek-toplam, token_usage_records) bu kredinin saglayici adlari */
export const HARCAMA_SAGLAYICILARI: Readonly<Partial<Record<KrediSaglayici, { olcum: string[]; llm: string[] }>>> = {
  // Icerik uretimi (LLM modulu) ayni havuz anahtarini kullanir: ANTHROPIC_API_KEY, OPENAI_API_KEY
  anthropic: { olcum: ['anthropic'], llm: ['anthropic'] },
  openai: { olcum: ['openai'], llm: ['openai'] },
  // LLM modulunun Gemini saglayicisi baska env okur (GOOGLE_GENAI_API_KEY / GEMINI_API_KEY): sayilmaz
  gemini: { olcum: ['gemini'], llm: [] },
  perplexity: { olcum: ['perplexity'], llm: [] },
  xai: { olcum: ['xai'], llm: [] },
};

export interface BakiyeGirisi {
  tutar: number;
  paraBirimi: 'USD' | 'TRY';
  /** ISO */
  girisAt: string;
  /** Giris anindaki kumulatif olcum harcamasi (USD) — sonraki fark bundan */
  olcumToplamAnlikUsd: number;
}

export const BAKIYE_KV = 'saglayici-bakiye:';

export function bakiyeGirisiOku(value: string | null | undefined): BakiyeGirisi | null {
  if (!value) return null;
  try {
    const j = JSON.parse(value);
    if (typeof j?.tutar !== 'number' || (j.paraBirimi !== 'USD' && j.paraBirimi !== 'TRY') || typeof j.girisAt !== 'string') return null;
    return { tutar: j.tutar, paraBirimi: j.paraBirimi, girisAt: j.girisAt, olcumToplamAnlikUsd: Number(j.olcumToplamAnlikUsd) || 0 };
  } catch {
    return null;
  }
}

/** Girilen tutardan harcamayi (USD) dus; TRY girisinde kurla cevir. Sonuc giris para biriminde. */
export function tahminiBakiye(g: BakiyeGirisi, kullanilanUsd: number, usdTry: number | null): { tutar: number; usd: number | null } {
  const harcama = Math.max(0, kullanilanUsd);
  if (g.paraBirimi === 'USD') {
    const t = Math.round((g.tutar - harcama) * 100) / 100;
    return { tutar: t, usd: t };
  }
  if (!usdTry || !(usdTry > 0)) return { tutar: g.tutar, usd: null };
  const t = Math.round((g.tutar - harcama * usdTry) * 100) / 100;
  return { tutar: t, usd: Math.round((t / usdTry) * 100) / 100 };
}
