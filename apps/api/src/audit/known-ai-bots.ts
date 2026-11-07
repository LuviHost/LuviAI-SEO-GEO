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
  /**
   * Isletmecisi bu adi (robots.txt belirteci olarak) RESMI bir sayfada
   * belgeliyor mu. Auto-fix robots.txt'e YALNIZ belgeli botlar icin grup ekler
   * (ROBOTS_MERGE_BOTS); taramadaki gozlem / durus olcumu tum listeyi kullanir.
   */
  documented: boolean;
}

/*
 * documented=false (08.11.2026 denetimi): resmi belge bulunamadi.
 *  - anthropic-ai: Anthropic'in guncel bot sayfasi yalniz ClaudeBot,
 *    Claude-User ve Claude-SearchBot'u listeliyor
 *    (https://support.claude.com/en/articles/8896518-anthropic-crawlers);
 *    eski belirtec emekli.
 *  - cohere-ai, cohere-training-data-crawler, Timpibot: yalniz ucuncu taraf
 *    bot dizinlerinde geciyor; isletmecinin sayfasi yok.
 *  - Bytespider: ByteDance belgesi oldugu yalniz ucuncu taraf kaynaklarda
 *    iddia ediliyor, dogrulanamadi.
 *  - Omgilibot: webz.io blogu botu anlatiyor ama robots.txt belirtecini
 *    vermiyor (sunucu kaydindaki UA "omgili/0.5").
 * DeepSeek ve xAI (Grok) icin resmi bot belgesi yok; bu listede de yoklar.
 * Belge kaynaklari (documented=true): OpenAI platform.openai.com/docs/bots,
 * Anthropic (yukarida), Google common crawlers, Apple Applebot, Common Crawl
 * commoncrawl.org/ccbot, Meta web crawlers, allenai.org/crawler,
 * docs.perplexity.ai bots, DuckDuckGo DuckAssistBot, docs.you.com/youbot,
 * developer.amazon.com/amazonbot, docs.diffbot.com, Mistral robots.
 */
export const KNOWN_AI_BOTS: readonly KnownAiBot[] = [
  // ── Egitim verisi toplayanlar
  { name: 'GPTBot',                        category: 'training', documented: true,  description: 'OpenAI ChatGPT egitim crawler\'i' },
  { name: 'ClaudeBot',                     category: 'training', documented: true,  description: 'Anthropic Claude egitim crawler\'i' },
  { name: 'anthropic-ai',                  category: 'training', documented: false, description: 'Anthropic genel (emekli belirtec)' },
  { name: 'Google-Extended',               category: 'training', documented: true,  description: 'Gemini egitim (Google Search\'i etkilemez)' },
  { name: 'Applebot-Extended',             category: 'training', documented: true,  description: 'Apple Intelligence egitim' },
  { name: 'CCBot',                         category: 'training', documented: true,  description: 'Common Crawl (egitim verisi)' },
  { name: 'cohere-ai',                     category: 'training', documented: false, description: 'Cohere egitim' },
  { name: 'cohere-training-data-crawler',  category: 'training', documented: false, description: 'Cohere egitim verisi crawler\'i' },
  { name: 'Bytespider',                    category: 'training', documented: false, description: 'ByteDance/TikTok AI' },
  { name: 'Meta-ExternalAgent',            category: 'training', documented: true,  description: 'Meta AI egitim' },
  { name: 'AI2Bot',                        category: 'training', documented: true,  description: 'Allen Institute for AI' },
  { name: 'Timpibot',                      category: 'training', documented: false, description: 'Timpi indeks' },
  { name: 'Omgilibot',                     category: 'training', documented: false, description: 'Omgili / webz.io' },
  // ── AI arama indeksleri (canli cevaplarda atif kaynagi)
  { name: 'OAI-SearchBot',                 category: 'search', documented: true, description: 'ChatGPT Search indeksi' },
  { name: 'Claude-SearchBot',              category: 'search', documented: true, description: 'Claude arama indeksi' },
  { name: 'PerplexityBot',                 category: 'search', documented: true, description: 'Perplexity arama indeksi' },
  { name: 'GoogleOther',                   category: 'search', documented: true, description: 'Google diger urunler (AI dahil)' },
  { name: 'DuckAssistBot',                 category: 'search', documented: true, description: 'DuckDuckGo AI cevaplari' },
  { name: 'YouBot',                        category: 'search', documented: true, description: 'You.com AI arama' },
  { name: 'Amazonbot',                     category: 'search', documented: true, description: 'Amazon Alexa+ / Rufus' },
  { name: 'Diffbot',                       category: 'search', documented: true, description: 'Diffbot bilgi grafigi' },
  // ── Kullanici-tetikli fetcher'lar (robots.txt garantisi YOK)
  { name: 'ChatGPT-User',                  category: 'user-triggered', documented: true,  description: 'ChatGPT sohbet sirasinda canli sayfa cekimi' },
  { name: 'Claude-User',                   category: 'user-triggered', documented: true,  description: 'Claude sohbet sirasinda canli sayfa cekimi' },
  { name: 'Perplexity-User',               category: 'user-triggered', documented: true,  description: 'Perplexity sohbet sirasinda canli sayfa cekimi' },
  { name: 'MistralAI-User',                category: 'user-triggered', documented: true,  description: 'Mistral Le Chat canli sayfa cekimi' },
  { name: 'Meta-ExternalFetcher',          category: 'user-triggered', documented: true,  description: 'Meta AI canli sayfa cekimi' },
  // Google'in kullanici tetikli fetcher listesinde bu ad yok; yalniz ucuncu taraf dizinler
  { name: 'Gemini-Deep-Research',          category: 'user-triggered', documented: false, description: 'Gemini Deep Research canli cekim' },
];

export const KNOWN_AI_BOT_NAMES: readonly string[] = KNOWN_AI_BOTS.map((b) => b.name);

/** Stance skoruna giren alt kume — user-triggered HARIC (bkz. dosya basi) */
export const STANCE_SCORED_BOTS: readonly KnownAiBot[] = KNOWN_AI_BOTS.filter((b) => b.category !== 'user-triggered');

export const USER_TRIGGERED_BOTS: readonly KnownAiBot[] = KNOWN_AI_BOTS.filter((b) => b.category === 'user-triggered');

/**
 * Auto-fix robots.txt birlestirmesinin (robots-merge.ts mergeRobotsTxt) isimle
 * grup ekledigi botlar: stance skoruna giren (egitim + AI arama) ve RESMI
 * belgesi olan botlar. Belgesiz bir adi robots.txt'e yazmak hicbir botun
 * davranisini guvenilir bicimde degistirmez, yalniz dosyayi kalabaliklastirir;
 * botlari adiyla anmak da bir standart degil (RFC 9309 isimsiz botlari "*"
 * grubuna baglar). Eski ROBOTS_ALLOW_EXTRAS listesi (DeepSeekBot dahil)
 * hicbir yerde yazilmiyordu; kaldirildi.
 */
export const ROBOTS_MERGE_BOTS: readonly KnownAiBot[] = STANCE_SCORED_BOTS.filter((b) => b.documented);

export const AI_BOT_CATEGORY_LABEL: Record<AiBotCategory, string> = {
  'training': 'Eğitim',
  'search': 'AI arama',
  'user-triggered': 'Kullanıcı-tetikli',
};
