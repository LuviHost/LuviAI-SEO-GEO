/**
 * Bilinen AI botlari — TEK kaynak.
 *
 * Daha once iki ayri liste vardi: AXO taramasi (agent-readiness.service.ts,
 * 27 bot) ve auto-fix'in yazdigi robots.txt (generators.service.ts, 25 bot).
 * Ikisi uyusmuyordu: 'Mistral-AI-User' yazim hatasi (dogrusu MistralAI-User),
 * bayat 'Claude-Web', kesisim 17/27 — yani auto-fix'ten sonra bile site
 * taramada 27/27 alamiyordu. Bu dosya ikisini de besler.
 *
 * KATEGORI — stance skoru icin belirleyici (defter: user-initiated-ai-fetchers-
 * ignore-robots-txt, 2 bagimsiz kaynak): kullanici-tetikli fetcher'lar
 * (ChatGPT-User, Perplexity-User, Claude-User...) bir insanin AI sohbeti
 * sirasinda sayfayi canli ceker ve robots.txt'e GUVENILIR UYMAZ. Onlari
 * "bilincli robots durusu" olcumune katmak yaniltici: robots.txt'te anilmalari
 * ne erisimi engeller ne de acar. Bu yuzden stance skoru yalniz training +
 * search botlarindan hesaplanir; user-triggered botlar panelde bilgi olarak
 * ayri gosterilir.
 */

export type AiBotCategory = 'training' | 'search' | 'user-triggered';

export interface KnownAiBot {
  name: string;
  category: AiBotCategory;
  /** robots.txt yorum satiri + UI aciklamasi */
  description: string;
}

export const KNOWN_AI_BOTS: readonly KnownAiBot[] = [
  // ── Egitim verisi toplayanlar
  { name: 'GPTBot',                        category: 'training', description: 'OpenAI ChatGPT egitim crawler\'i' },
  { name: 'ClaudeBot',                     category: 'training', description: 'Anthropic Claude egitim crawler\'i' },
  { name: 'anthropic-ai',                  category: 'training', description: 'Anthropic genel' },
  { name: 'Google-Extended',               category: 'training', description: 'Gemini egitim (Google Search\'i etkilemez)' },
  { name: 'Applebot-Extended',             category: 'training', description: 'Apple Intelligence egitim' },
  { name: 'CCBot',                         category: 'training', description: 'Common Crawl (egitim verisi)' },
  { name: 'cohere-ai',                     category: 'training', description: 'Cohere egitim' },
  { name: 'cohere-training-data-crawler',  category: 'training', description: 'Cohere egitim verisi crawler\'i' },
  { name: 'Bytespider',                    category: 'training', description: 'ByteDance/TikTok AI' },
  { name: 'Meta-ExternalAgent',            category: 'training', description: 'Meta AI egitim' },
  { name: 'AI2Bot',                        category: 'training', description: 'Allen Institute for AI' },
  { name: 'Timpibot',                      category: 'training', description: 'Timpi indeks' },
  { name: 'Omgilibot',                     category: 'training', description: 'Omgili / webz.io' },
  // ── AI arama indeksleri (canli cevaplarda atif kaynagi)
  { name: 'OAI-SearchBot',                 category: 'search', description: 'ChatGPT Search indeksi' },
  { name: 'Claude-SearchBot',              category: 'search', description: 'Claude arama indeksi' },
  { name: 'PerplexityBot',                 category: 'search', description: 'Perplexity arama indeksi' },
  { name: 'GoogleOther',                   category: 'search', description: 'Google diger urunler (AI dahil)' },
  { name: 'DuckAssistBot',                 category: 'search', description: 'DuckDuckGo AI cevaplari' },
  { name: 'YouBot',                        category: 'search', description: 'You.com AI arama' },
  { name: 'Amazonbot',                     category: 'search', description: 'Amazon Alexa+ / Rufus' },
  { name: 'Diffbot',                       category: 'search', description: 'Diffbot bilgi grafigi' },
  // ── Kullanici-tetikli fetcher'lar (robots.txt garantisi YOK)
  { name: 'ChatGPT-User',                  category: 'user-triggered', description: 'ChatGPT sohbet sirasinda canli sayfa cekimi' },
  { name: 'Claude-User',                   category: 'user-triggered', description: 'Claude sohbet sirasinda canli sayfa cekimi' },
  { name: 'Perplexity-User',               category: 'user-triggered', description: 'Perplexity sohbet sirasinda canli sayfa cekimi' },
  { name: 'MistralAI-User',                category: 'user-triggered', description: 'Mistral Le Chat canli sayfa cekimi' },
  { name: 'Meta-ExternalFetcher',          category: 'user-triggered', description: 'Meta AI canli sayfa cekimi' },
  { name: 'Gemini-Deep-Research',          category: 'user-triggered', description: 'Gemini Deep Research canli cekim' },
];

export const KNOWN_AI_BOT_NAMES: readonly string[] = KNOWN_AI_BOTS.map((b) => b.name);

/** Stance skoruna giren alt kume — user-triggered HARIC (bkz. dosya basi) */
export const STANCE_SCORED_BOTS: readonly KnownAiBot[] = KNOWN_AI_BOTS.filter((b) => b.category !== 'user-triggered');

export const USER_TRIGGERED_BOTS: readonly KnownAiBot[] = KNOWN_AI_BOTS.filter((b) => b.category === 'user-triggered');

/**
 * Auto-fix robots.txt'inin AI listesine ek olarak yazdigi klasik arama /
 * onizleme botlari. AXO stance olcumune GIRMEZLER (AI botu degiller) ama
 * uretilen robots.txt'ten dusmemeliler — eski listede vardilar.
 * DeepSeekBot: urunun olctugu bir saglayici (ai-citation.service.ts) oldugu
 * icin robots'ta kalir; resmi UA dokumantasyonu zayif oldugu icin stance
 * listesine alinmadi.
 */
export const ROBOTS_ALLOW_EXTRAS: readonly { name: string; description: string }[] = [
  { name: 'Googlebot',       description: 'Google Search' },
  { name: 'Googlebot-Image', description: 'Google Gorseller / Lens' },
  { name: 'Bingbot',         description: 'Bing + Copilot' },
  { name: 'Applebot',        description: 'Apple Search' },
  { name: 'FacebookBot',     description: 'Meta link onizleme' },
  { name: 'DeepSeekBot',     description: 'DeepSeek crawler' },
];

export const AI_BOT_CATEGORY_LABEL: Record<AiBotCategory, string> = {
  'training': 'Eğitim',
  'search': 'AI arama',
  'user-triggered': 'Kullanıcı-tetikli',
};
