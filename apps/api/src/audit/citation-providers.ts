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
  // Meta AI = Muse (Meta Model API, dev.meta.ai). Kasim 2026'ya kadar Groq
  // uzerinden Llama idi; Groq Llama sohbet modellerini 16.08.2026'da kapatti.
  // Ad META_APP_* (reklam entegrasyonu) ile karismasin diye "MODEL_API".
  meta:       'META_MODEL_API_KEY',
};

/**
 * Probe basina maliyet TAVANI (USD). Perplexity disinda hepsi web aramali
 * (Kasim 2026); her saglayicinin gerekcesi kendi satirinda.
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
 *
 * 11.11.2026 canli olcum (claude-opus-5-5, 5 cagri): ortalama 24K girdi (en cok 29.5K), 0.138 USD,
 * en yuksek 0.169 — 0.2'lik tavana %18 pay kaliyordu; 37K girdide asilirdi. Tavan olculen en cok
 * girdinin ~iki katina (55K) gore: 55K x 4/1M = 0.22 + 3000 cikti x 20/1M = 0.06 + 2 arama x 0.01
 * = 0.02 → 0.30.
 */
export const COST_PER_PROBE_USD: Readonly<Record<Provider, number>> = {
  anthropic:  0.3,
  // Gemini SIFIR OLAMAZ (sifirken butce guard'i hic calismiyordu).
  // 11.11.2026 (gemini-3.5-flash-lite): Gemini 3 ve ustunde arama ucreti ISTEM basina degil
  // arama SORGUSU basina 0.014 USD. Canli denemede 1–2 sorgu (0.014–0.029 USD); eski model ayni
  // sorularda 3–5 sorgu atiyordu. Tavan 5 sorguya gore: 5 x 0.014 = 0.07 + token (~0.002) → 0.08.
  // (Eski 0.04, uc ve ustu sorguda asiliyordu.)
  gemini:     0.08,
  // 11.11.2026 (gpt-6-astra, Profesyonel ve ustu): 10 / 50 USD per 1M + arama 0.01 USD/cagri;
  // arama icerigi model fiyatindan girdi tokeni. Canli deneme: 12.7K girdi, 368 cikti, 1 arama
  // = 0.156 USD. Ikinci deneme (15 cagri): ortalama 0.151, en yuksek 0.188 (13K girdi, 2 arama).
  // Tavan 3 arama ve 40K girdiye gore: 40K x 10/1M = 0.40 + max_output_tokens 1500
  // x 50/1M = 0.075 + 3 x 0.01 = 0.03 → 0.505, yuvarlanip 0.50. (Arama baglami 128K'ya kadar
  // cikabilir; o uc durum bu tavanin disindadir — olculen en yuksek deger tavanin ~%40'i.)
  // Hizli model (gpt-6-luna) tavani: COST_PER_PROBE_USD_STANDARD.
  openai:     0.50,
  // Sonar: saglayicinin kendi bildirdigi maliyet soru basina 0.0046–0.0050 USD (istek ucreti
  // 0.0025 + token; canli deneme 11.11.2026). Eski tavan 0.0006 gercegin sekizde biriydi —
  // butce guard'i Perplexity harcamasini eksik sayiyordu. max_tokens 1000 ile ust sinir ~0.007.
  perplexity: 0.008,
  // grok-4.7: 2 / 6 USD per 1M (200K girdiye kadar; ustunde iki kati) + arama 0.005 USD/cagri.
  // CANLI OLCUM (11.11.2026, 5 cagri): Grok soru basina 6–8 arama yapiyor ve sonuclarin tamamini
  // baglama yukluyor — ortalama 94K girdi (en cok 132K), 0.232 USD (en yuksek 0.318). Eski tavan
  // 0.10 "~25K girdi" varsayimiyla yazilmisti; gercek ortalamanin yarisindan azdi ve butce guard'i
  // Grok harcamasini eksik sayiyordu. Tavan 200K girdi (fiyat esigi) ve 12 aramaya gore:
  // 200K x 2/1M = 0.40 + ~4K cikti x 6/1M = 0.024 + 12 x 0.005 = 0.06 → 0.484, yuvarlanip 0.50.
  // Grok bu haliyle Profesyonel olcumunun en pahali asistani.
  xai:        0.50,
  // deepseek-v4-pro (Anthropic uyumlu uc) zirve 1.32 / 3.96 USD per 1M + arama 0.00075 USD.
  // Canli olcum (5 cagri): ortalama 34K girdi (en cok 55K), 0.054 USD (en yuksek 0.084) — eski
  // tavan 0.05 ortalamanin altindaydi. Tavan olculen en cok girdinin iki katina (110K) gore:
  // 110K x 1.32/1M = 0.145 + 3000 cikti x 3.96/1M = 0.012 + arama → 0.16.
  deepseek:   0.16,
  // Kasim 2026: Meta Muse (muse-spark-1.3) Responses API + web_search.
  // Fiyat (dev.meta.ai/docs/pricing-rate-limits, 11.11.2026): $1.25/1M girdi,
  // $4.25/1M cikti, arama $2.50/1K sorgu. Arama icerigi ~25K girdi ($0.031) +
  // max_output_tokens 3000 ($0.013; akil yurutme tokenlari ciktiya dahil) +
  // birkac arama (~$0.01) → ~$0.055; arama sayisi dokumanda sinirlanamiyor
  // (max_uses yalniz Messages API'de ve orada da 400), pay birakildi.
  // CANLI OLCUM (11.11.2026, 5 cagri): Muse soru basina ~10 arama yapiyor (en cok 13) — ortalama
  // 45K girdi (en cok 80K), 0.092 USD (en yuksek 0.141); eski tavan 0.08 ortalamanin altindaydi.
  // Tavan olculen en cok girdinin iki katina (160K) ve 20 aramaya gore:
  // 160K x 1.25/1M = 0.20 + 3000 x 4.25/1M = 0.013 + 20 x 0.0025 = 0.05 → 0.263, yuvarlanip 0.27.
  meta:       0.27,
};

/**
 * 'standard' kademede (Baslangic paketi ve deneme — billing/plan-engines.ts) modeli
 * DEGISEN saglayicilarin probe tavani. Burada olmayan saglayici iki kademede de ayni
 * modelle olculur ve COST_PER_PROBE_USD'deki tavani kullanir.
 *
 * anthropic (claude-haiku-5-5 + web_search_20250305, max_uses 2; 11.11.2026):
 *   Haiku 5.5'in IKI fiyat karti var: istem 100K token ya da azsa $0.10 / $0.50, daha
 *   uzunsa $0.50 / $2.50 per 1M. Temel arama sonuclarin TAMAMINI baglama yukler (dinamik
 *   suzme yok); beklenen iki arama + ara turlarla ~45K girdi → ~$0.026. Ama tavan
 *   ortalama degil UST SINIR olmali: istem 100K'yi gecerse pahali kart devreye girer.
 *   Tavan pahali kartla 200K girdiye kadar hesaplanir: 200K x $0.50/1M = $0.10
 *   + cikti max_tokens 3000 x $2.50/1M = $0.0075 (thinking ciktiya dahil) + en fazla
 *   2 arama x $0.01 = $0.02 → $0.1275, yuvarlanip 0.13. (Ilk surum 0.05 idi; yalniz ucuz
 *   karti kapsiyordu — bagimsiz inceleme.) Yine de Opus tavaninin (0.2) altinda.
 *   Canli olcum (11.11.2026, 5 cagri): ortalama 26K girdi (en cok 28K), 0.023 USD — 100K
 *   esiginin cok altinda; tavan bilerek genis.
 *   Kaynak: platform.claude.com web search tool sayfasi + model fiyat tablosu.
 */
export const COST_PER_PROBE_USD_STANDARD: Readonly<Partial<Record<Provider, number>>> = {
  anthropic: 0.13,
  // gpt-6-luna (0.10 / 0.50 per 1M + arama 0.01 USD/cagri): canli deneme 8.7K girdi, 1 arama
  // = 0.011 USD. Tavan 3 arama ve tam 128K arama baglamina gore: 0.03 + 0.0128 + 0.00075 → 0.05.
  openai: 0.05,
};

/**
 * Tek bir kiracinin gunluk havuzdan alabilecegi azami pay (ai-citation.service isOverBudget).
 * Butce once yalniz GLOBAL'di: bir kullanici birkac istekle bir saglayicinin havuzunu bitirip
 * gun sonuna kadar TUM musterilere "olculemedi" aldirabiliyordu.
 *
 * 0.25 → 0.5 (sahip, 11.11.2026: "180 dolar yuksek degil mi?"): pay 0.25 iken kiracinin bir
 * gunluk hakkini tasimak icin global tavanin dort kati gerekiyordu (ChatGPT 180 USD). Bugun
 * odeyen iki hesap var; tavan IKI hesabin en agir gununu tasiyacak kadar tutulur, kacak / dongu
 * durumunda deftere yazilabilecek ust sinir yariya iner. Musteri sayisi artinca pay degil
 * TAVAN buyutulur (AI_BUDGET_*_USD).
 */
export const PER_USER_BUDGET_SHARE = 0.5;

/**
 * GUNLUK HAVUZ TAVANI varsayilanlari (USD, saglayici basina; env AI_BUDGET_*_USD ile degisir).
 * Yalniz havuz (RanksUp anahtari) kullanimina uygulanir; BYOK musterinin kendi parasidir.
 *
 * BU SAYILAR HARCAMA DEGILDIR: deftere her olculen soru TAVAN fiyattan yazilir
 * (COST_PER_PROBE_USD — olculen gercek maliyetin 2–3 kati; ChatGPT ust modelde tavan 0.50,
 * gercek ortalama 0.15 USD). Tavan, bir hata / dongu durumunda deftere bir gunde en cok ne
 * yazilabilecegini sinirlayan frendir. Hesap basi maliyeti bu tavan degil, haftalik olcum hakki
 * ve aylik calistirma hakki sinirlar.
 *
 * KURAL (11.11.2026, bagimsiz inceleme): kiraci payi (tavan x PER_USER_BUDGET_SHARE), satistaki
 * en yuksek planin (Profesyonel) BIR GUNDE hakki olan en buyuk isi tasimak zorunda:
 *   kurulum / site olcumu (5 soru x 3 tekrar = 15 soru)
 *   + Prompt Lab: aylik calistirma hakkinin tamami tek istekte kullanilabilir (75; her soru ve
 *     her dal 1 calistirma). Dallar yalniz ChatGPT, Claude ve Gemini'ye sorulur; diger
 *     asistanlar en cok "Tümünü çalıştır" sinirini (50 soru) gorur.
 *   → ChatGPT / Claude / Gemini 90 soru, digerleri 65 soru.
 * Model atamasinin ilk surumunde pay yalniz TEK bir site olcumunu tasiyordu: Profesyonel
 * musterinin 50 soruluk "Tümünü çalıştır"i yari yolda asistan kaybediyor (Claude 25, ChatGPT
 * ve Grok 30 soruda kesiliyordu), kesilen sorular yine calistirma hakkindan dusuyordu.
 *   ChatGPT   90 x 0.50 = 45.00 → pay 50 → tavan 100     Grok      65 x 0.50 = 32.50 → tavan 70
 *   Claude    90 x 0.30 = 27.00 → pay 30 → tavan 60      DeepSeek  65 x 0.16 = 10.40 → tavan 25
 *   Gemini    90 x 0.08 =  7.20 → pay 10 → tavan 20      Muse      65 x 0.27 = 17.55 → tavan 40
 *   Perplexity 65 x 0.008 = 0.52 → tavan 5 (degismedi)
 * Kural citation-providers.spec.ts'te sabitlendi: probe tavani ya da plan hakki buyurse test
 * kirilir. Kurumsal (ayda 1.000 calistirma) varsayilanlara SIGMAZ: teklif asamasinda
 * AI_BUDGET_*_USD buyutulur ya da musteri kendi anahtarini (BYOK) kullanir.
 *
 * KAPASITE: tavan global; ayni gun IKI Profesyonel hesabin en agir gununu tasir (olagan gun —
 * bir site olcumu ya da 25 soruluk calistirma — icin 7–12 hesap). Ucuncu hesap ayni gun en
 * agir isi yaparsa bazi asistanlar "bugünkü ölçüm sınırına ulaşıldı" ile o gun olculmez:
 * odeyen Profesyonel hesap sayisi ikiyi gecince tavanlar env ile ayni oranda buyutulmeli.
 */
export const DAILY_BUDGET_DEFAULT_USD: Readonly<Record<Provider, number>> = {
  anthropic: 60,
  gemini: 20,
  openai: 100,
  perplexity: 5,
  xai: 70,
  deepseek: 25,
  meta: 40,
};

/** Probe basina maliyet tavani — kademeye gore (butce guard'i ve muhasebe ayni fonksiyonu kullanir) */
export function costPerProbe(provider: Provider, tier: 'standard' | 'premium' = 'premium'): number {
  const standard = tier === 'standard' ? COST_PER_PROBE_USD_STANDARD[provider] : undefined;
  return standard ?? COST_PER_PROBE_USD[provider] ?? 0;
}

/** Bir saglayicinin olcum sonucu (runPublicProbes satiri) — yalniz kuralin baktigi alanlar */
export interface ProviderRunState {
  provider: string;
  available?: boolean;
  reason?: string;
}

/**
 * Saglayici bu kurulumda HIC yapilandirilmamis mi: havuz anahtari yok.
 * (Kasim 2026'ya kadar Meta/Llama icin ayrica GROQ_LLAMA_MODEL aranirdi;
 * Meta artik Muse — tek kosul META_MODEL_API_KEY.)
 *
 * Boyle saglayici cagrilmaz (runPublicProbes 'NO_KEY' doner) ve sonuc
 * listelerinde "Kullanılamadı" karti olarak GOSTERILMEZ: musteri olcmedigimiz
 * bir asistanin kartini gormemeli; karne de onu kapsam disi sayar (karne-html
 * yalniz reason 'NO_KEY' satirini kapsam disi tutar). Yapilandirilmis ama o
 * olcumde hata veren saglayici bu kurala GIRMEZ — "ölçülemedi" olarak kalir.
 *
 * Iki kullanim, tek kural:
 *  - olcum ONCESI saglayici adiyla (runPublicProbes, karne CLI'i): anahtar
 *    yoksa true;
 *  - olcum SONRASI sonuc satiriyla (App Prompt Lab): 'NO_KEY' ise true.
 *    available:false + 'HATA: ...' satiri saglayicinin CAGRILDIGINI
 *    (anahtari oldugunu) gosterir — false, listede kalir.
 *
 * Bilinmeyen saglayici adi (Provider disi) olcum oncesi yapilandirilmamis sayilir.
 */
export function isUnconfiguredProvider(input: string | ProviderRunState, env: NodeJS.ProcessEnv = process.env): boolean {
  const r: ProviderRunState = typeof input === 'string' ? { provider: input } : input;
  // Olculdu: yapilandirilmis demektir
  if (r.available === true) return false;
  if (r.reason === 'NO_KEY') return true;
  // Sonuc yok (olcum oncesi): havuz anahtari var mi
  if (r.available === undefined) {
    const keyVar = (POOL_ENV_KEY as Record<string, string | undefined>)[r.provider];
    return !keyVar || !env[keyVar];
  }
  return false;
}
