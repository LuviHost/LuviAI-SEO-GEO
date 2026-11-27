/**
 * Olcum cagrilarinin GERCEK maliyeti (27.11.2026, sahip: "gerçek maliyet kaydını kur").
 *
 * NEDEN: butce defteri (`ai-cost:*`, citation-providers.ts COST_PER_PROBE_USD) soru basina sabit
 * UST SINIR yazar — butce korumasi icin bilerek yuksek. Gercek harcama ondan cok dusuk ve
 * saglayicinin panelindeki tutarla karsilastirilamiyordu: 25.11'de Google Gemini'ye ~₺420 yazdi,
 * bizim defterde 0,40 USD vardi; dis kullanimi gormenin yolu yoktu.
 *
 * Saglayicilar cevapta TUTAR DONMEZ (Perplexity ve DataForSEO haric); token ve arama sayisini
 * doner. Tutar = girdi x fiyat + cikti x fiyat + arama x ucret (+ istek ucreti). Yalniz HAVUZ
 * anahtari sayilir: BYOK cagrisini musteri oder.
 *
 * FIYATLAR ($ / 1M token, arama $ / cagri). Kaynaklar citation-providers.ts COST_PER_PROBE_USD
 * notlarinda (11.11.2026 canli olcumler ve saglayici fiyat sayfalari):
 *  - claude-opus-5-5 4 / 20, web aramasi 0,01; claude-haiku-5-5 0,10 / 0,50 (istem >100K: 0,50 / 2,50)
 *  - gemini-3.5-flash-lite 0,30 / 2,50 (openrouter.ai, pricepertoken.com 27.11.2026), arama sorgusu 0,014
 *  - gpt-6-astra 10 / 50, gpt-6-luna 0,10 / 0,50, web aramasi 0,01
 *  - grok-4.7 2 / 6 (istem >200K iki kati), arama 0,005
 *  - deepseek-v4-pro 1,32 / 3,96 (zirve), arama 0,00075
 *  - muse-spark-1.3 1,25 / 4,25, arama 0,0025
 *  - sonar: saglayicinin bildirdigi `usage.cost.total_cost`; yoksa 1 / 1 + istek 0,005
 * Model degisince bu tablo da guncellenir; tabloda olmayan model kaydedilmez ve loglanir.
 */

export interface KullanimOzeti {
  girdi: number;
  cikti: number;
  arama: number;
  /** Saglayici tutari kendisi bildirdiyse (Perplexity, DataForSEO) — hesap yerine bu kullanilir */
  saglayiciUsd?: number | null;
}

interface ModelFiyati {
  girdi: number;
  cikti: number;
  arama: number;
  istek?: number;
  /** Istem bu esigi asarsa pahali kart */
  ust?: { esik: number; girdi: number; cikti: number };
}

export const OLCUM_FIYATLARI: Readonly<Record<string, ModelFiyati>> = {
  'claude-opus-5-5': { girdi: 4, cikti: 20, arama: 0.01 },
  'claude-haiku-5-5': { girdi: 0.1, cikti: 0.5, arama: 0.01, ust: { esik: 100_000, girdi: 0.5, cikti: 2.5 } },
  'gemini-3.5-flash-lite': { girdi: 0.3, cikti: 2.5, arama: 0.014 },
  'gpt-6-astra': { girdi: 10, cikti: 50, arama: 0.01 },
  'gpt-6-luna': { girdi: 0.1, cikti: 0.5, arama: 0.01 },
  sonar: { girdi: 1, cikti: 1, arama: 0, istek: 0.005 },
  'grok-4.7': { girdi: 2, cikti: 6, arama: 0.005, ust: { esik: 200_000, girdi: 4, cikti: 12 } },
  'deepseek-v4-pro': { girdi: 1.32, cikti: 3.96, arama: 0.00075 },
  'muse-spark-1.3': { girdi: 1.25, cikti: 4.25, arama: 0.0025 },
  // DataForSEO cevabi `cost` tasir; tasimazsa canli uc istek basi (citation-providers.ts notu)
  google_ai_mode: { girdi: 0, cikti: 0, arama: 0, istek: 0.004 },
  google_ai_overview: { girdi: 0, cikti: 0, arama: 0, istek: 0.004 },
};

/** Gercek tutar (USD). Model tabloda yoksa ve saglayici tutar bildirmediyse null. */
export function gercekMaliyetUsd(model: string, k: KullanimOzeti): number | null {
  if (typeof k.saglayiciUsd === 'number' && Number.isFinite(k.saglayiciUsd) && k.saglayiciUsd >= 0) return k.saglayiciUsd;
  const f = OLCUM_FIYATLARI[model];
  if (!f) return null;
  const pahali = f.ust && k.girdi > f.ust.esik;
  const girdiFiyat = pahali ? f.ust!.girdi : f.girdi;
  const ciktiFiyat = pahali ? f.ust!.cikti : f.cikti;
  const usd = (k.girdi * girdiFiyat + k.cikti * ciktiFiyat) / 1_000_000 + k.arama * f.arama + (f.istek ?? 0);
  return Math.round(usd * 1e6) / 1e6;
}

const sayi = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);

/** Anthropic Messages (Claude ve DeepSeek'in Anthropic uyumlu ucu) */
export function anthropicKullanim(resp: unknown): KullanimOzeti {
  const u = (resp as any)?.usage ?? {};
  return {
    girdi: sayi(u.input_tokens) + sayi(u.cache_creation_input_tokens) + sayi(u.cache_read_input_tokens),
    cikti: sayi(u.output_tokens),
    arama: sayi(u.server_tool_use?.web_search_requests),
  };
}

/** Gemini generateContent: dusunme tokenlari ciktiya, arama sonuclari girdiye dahil faturalanir */
export function geminiKullanim(resp: unknown): KullanimOzeti {
  const m = (resp as any)?.usageMetadata ?? {};
  const sorgular = (resp as any)?.candidates?.[0]?.groundingMetadata?.webSearchQueries;
  return {
    girdi: sayi(m.promptTokenCount) + sayi(m.toolUsePromptTokenCount),
    cikti: sayi(m.candidatesTokenCount) + sayi(m.thoughtsTokenCount),
    arama: Array.isArray(sorgular) ? sorgular.length : 0,
  };
}

/** OpenAI bicimli Responses API (ChatGPT, Grok, Meta Muse): arama = web_search_call ogeleri */
export function responsesKullanim(data: unknown): KullanimOzeti {
  const u = (data as any)?.usage ?? {};
  const cikti = Array.isArray((data as any)?.output) ? (data as any).output : [];
  return {
    girdi: sayi(u.input_tokens),
    cikti: sayi(u.output_tokens),
    arama: cikti.filter((o: any) => o?.type === 'web_search_call').length,
  };
}

/** Perplexity chat completions: tutar `usage.cost.total_cost` olarak gelir */
export function perplexityKullanim(data: unknown): KullanimOzeti {
  const u = (data as any)?.usage ?? {};
  const toplam = u?.cost?.total_cost;
  return {
    girdi: sayi(u.prompt_tokens),
    cikti: sayi(u.completion_tokens),
    arama: 0,
    saglayiciUsd: typeof toplam === 'number' ? toplam : null,
  };
}

/** DataForSEO: her cevapta ust duzey `cost` (USD) */
export function dataforseoKullanim(data: unknown): KullanimOzeti {
  const c = (data as any)?.cost;
  return { girdi: 0, cikti: 0, arama: 0, saglayiciUsd: typeof c === 'number' ? c : null };
}

/** Gercek maliyet gunluk sayaci (UTC gunu; butce defteriyle ayni gun anahtari) */
export function gercekMaliyetAnahtari(provider: string, gun: string): string {
  return `ai-gercek:${provider}:${gun}`;
}
