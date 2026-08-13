/**
 * Intel kaynak katalogu — GEO/SEO/ASO dunyasini besleyen dogrulanmis akislar.
 *
 * NEDEN KOD ICINDE, DB'DE DEGIL: katalog urunun bilgi tabaninin bir parcasi;
 * hangi kaynagin ne agirlikta oldugu bir URUN KARARI ve code review'dan
 * gecmeli. DB'ye seed edilir (IntelSource), oradan enabled/lastFetched gibi
 * CALISMA ZAMANI durumu tutulur — ama kaynagin kendisi burada versiyonlanir.
 *
 * TUM KAYNAKLAR CANLI DOGRULANDI (2026-08-13): yalnizca HTTP 200 degil,
 * GERCEKTEN KAYIT DONDURDUKLERI olculdu. HTTP 200 donup govdesi bos gelen
 * kaynaklar (seroundtable gibi) DISABLED_SOURCES'a alindi.
 *
 * intervalHours degerleri de olculdu: her feed'in KAC GUNLUK icerik
 * tuttugu hesaplandi. Penceresi dar olan kaynak seyrek cekilirse yayin
 * sessizce kaybolur (bkz. search-engine-land notu).
 */

/** Kaynagin nasil cekildigi — collector bu alana gore dallanir. */
export type SourceKind = 'rss' | 'reddit' | 'hn' | 'x' | 'github';

/**
 * Kaynak katmani. Bir bulgunun kanit gucu NIHAI olarak icerikten cikar
 * (bkz. EvidenceGrade), ama katman ON AGIRLIK verir: Google'in kendi
 * dokumaninda yazan bir cumle ile bir ajans blogunun ayni cumlesi ayni
 * seyi ifade etmez.
 */
export type SourceTier =
  /** Arama motoru / AI saglayici / platform sahibinin kendi agzi */
  | 'official'
  /** Buyuk orneklemli, metodolojisi acik veri calismasi yayinlayanlar */
  | 'primary-research'
  /** Sahada calisan, testini paylasan taninmis uzman */
  | 'practitioner'
  /** Sektor haberciligi — hizli ama ikincil */
  | 'news'
  /** Forum/topluluk — erken sinyal, dusuk guvenilirlik */
  | 'community';

/**
 * Konu etiketleri. RanksUp'in urun yuzeyleriyle eslesir ki bir bulgu
 * "kimi ilgilendiriyor" sorusu otomatik cevaplanabilsin.
 */
export type IntelTopic =
  | 'geo'          // uretken motorlarda gorunurluk, atif
  | 'seo'          // klasik arama
  | 'aso'          // uygulama magazasi
  | 'ai-crawler'   // bot erisimi, robots.txt, llms.txt, cloudflare
  | 'schema'       // yapilandirilmis veri
  | 'measurement'  // olcum metodolojisi, attribution, GA4
  | 'agents'       // agentic search, OpenClaw, MCP, ajan tarayicilar
  | 'platform';    // Google/OpenAI/Anthropic/Apple urun degisiklikleri

export interface IntelSourceDef {
  /** Benzersiz slug — DB'de upsert anahtari */
  key: string;
  name: string;
  kind: SourceKind;
  /** RSS/Atom feed URL'i, Reddit subreddit adi, HN/X sorgusu */
  target: string;
  tier: SourceTier;
  topics: IntelTopic[];
  /**
   * Kaynak on-agirligi 0-100. Kanit skorunun carpani olarak kullanilir
   * (bkz. evidence-grade.ts). Resmi kaynak 100, forum 25.
   */
  weight: number;
  /** Kac saatte bir cekilecegi. Feed penceresinden DAR olmali. */
  intervalHours: number;
  note?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  RESMI — platform sahibinin kendi agzi. En yuksek kanit degeri.
//  "Google llms.txt'yi kullanmiyor" gibi bir cumle YALNIZCA burada
//  kesinlesir; ajans bloglari bunu ancak aktarabilir.
// ═══════════════════════════════════════════════════════════════════════

const OFFICIAL: IntelSourceDef[] = [
  {
    key: 'google-search-central',
    name: 'Google Search Central Blog',
    kind: 'rss',
    target: 'https://developers.google.com/search/blog/feed.xml',
    tier: 'official',
    topics: ['seo', 'geo', 'ai-crawler', 'schema', 'platform'],
    weight: 100,
    intervalHours: 6,
    note: 'llms.txt aciklamasi, AI Overviews rehberi, spam politikasi — hepsi buradan cikar',
  },
  {
    key: 'google-blog-search',
    name: 'The Keyword — Google Search',
    kind: 'rss',
    target: 'https://blog.google/products/search/rss/',
    tier: 'official',
    topics: ['seo', 'geo', 'platform'],
    weight: 95,
    intervalHours: 12,
    note: 'AI Mode / AI Overviews urun duyurulari',
  },
  {
    key: 'bing-webmaster',
    name: 'Bing Webmaster Blog',
    kind: 'rss',
    target: 'https://blogs.bing.com/webmaster/feed',
    tier: 'official',
    topics: ['seo', 'ai-crawler', 'platform'],
    weight: 90,
    intervalHours: 24,
    note: 'IndexNow ve Copilot indeksleme tarafi',
  },
  {
    key: 'openai-news',
    name: 'OpenAI News',
    kind: 'rss',
    target: 'https://openai.com/news/rss.xml',
    tier: 'official',
    topics: ['geo', 'agents', 'platform'],
    weight: 95,
    intervalHours: 12,
    note: 'ChatGPT search/shopping/agent degisiklikleri — atif davranisini dogrudan etkiler',
  },
  {
    key: 'apple-developer-news',
    name: 'Apple Developer News',
    kind: 'rss',
    target: 'https://developer.apple.com/news/rss/news.rss',
    tier: 'official',
    topics: ['aso', 'platform'],
    weight: 100,
    intervalHours: 12,
    note: 'App Store inceleme kurallari, metadata alani degisiklikleri, ASA duyurulari',
  },
  {
    key: 'cloudflare-blog',
    name: 'Cloudflare Blog',
    kind: 'rss',
    target: 'https://blog.cloudflare.com/rss/',
    tier: 'official',
    topics: ['ai-crawler', 'agents'],
    weight: 85,
    intervalHours: 24,
    note: 'AI bot trafigi olcumleri + pay-per-crawl; crawler erisimi tarafinin birincil kaynagi',
  },
];

// ═══════════════════════════════════════════════════════════════════════
//  BIRINCIL ARASTIRMA — buyuk orneklemli veri yayinlayanlar.
//  Bu katman "llms.txt calismiyor" tarzi mit yikmalarin geldigi yer:
//  137K site, 500M istek gibi N'ler burada uretilir.
// ═══════════════════════════════════════════════════════════════════════

const PRIMARY_RESEARCH: IntelSourceDef[] = [
  {
    key: 'ahrefs-blog',
    name: 'Ahrefs Blog',
    kind: 'rss',
    target: 'https://ahrefs.com/blog/feed/',
    tier: 'primary-research',
    topics: ['seo', 'geo', 'ai-crawler', 'measurement'],
    weight: 90,
    intervalHours: 12,
    note: 'Kendi crawl veri setiyle buyuk-N calismalar yayinliyor',
  },
  {
    key: 'seranking-blog',
    name: 'SE Ranking Blog',
    kind: 'rss',
    target: 'https://seranking.com/blog/feed/',
    tier: 'primary-research',
    topics: ['seo', 'geo', 'measurement'],
    weight: 80,
    intervalHours: 24,
    note: 'AI Overviews / atif korelasyon calismalari',
  },
  {
    key: 'sparktoro',
    name: 'SparkToro (Rand Fishkin)',
    kind: 'rss',
    target: 'https://sparktoro.com/blog/feed/',
    tier: 'primary-research',
    topics: ['seo', 'geo', 'measurement'],
    weight: 85,
    intervalHours: 24,
    note: 'Zero-click ve tiklama akisi veri analizleri',
  },
  {
    key: 'similarweb-blog',
    name: 'Similarweb Blog',
    kind: 'rss',
    target: 'https://www.similarweb.com/blog/feed/',
    tier: 'primary-research',
    topics: ['geo', 'measurement', 'platform'],
    weight: 80,
    intervalHours: 24,
    note: 'AI asistan trafik paylasimi panel verisi',
  },
  {
    key: 'ipullrank',
    name: 'iPullRank (Mike King)',
    kind: 'rss',
    target: 'https://ipullrank.com/feed',
    tier: 'primary-research',
    topics: ['seo', 'geo', 'agents'],
    weight: 85,
    intervalHours: 24,
    note: 'Arama sizintilarinin ve IR literaturunun teknik cozumlemeleri',
  },
  {
    key: 'onely',
    name: 'Onely',
    kind: 'rss',
    // /blog/feed/ HTML donduruyor (feed yolu degismis); /feed/ dogru olan
    target: 'https://www.onely.com/feed/',
    tier: 'primary-research',
    topics: ['seo', 'ai-crawler', 'schema'],
    weight: 75,
    intervalHours: 24,
    note: 'Render/indeksleme deneyleri',
  },
];

// ═══════════════════════════════════════════════════════════════════════
//  UYGULAYICI — sahada test eden, sonucunu paylasan uzmanlar.
// ═══════════════════════════════════════════════════════════════════════

const PRACTITIONER: IntelSourceDef[] = [
  {
    key: 'aleyda-solis',
    name: 'Aleyda Solis',
    kind: 'rss',
    target: 'https://www.aleydasolis.com/en/feed/',
    tier: 'practitioner',
    topics: ['seo', 'geo', 'measurement'],
    weight: 75,
    intervalHours: 24,
  },
  {
    key: 'growth-memo',
    name: 'Growth Memo (Kevin Indig)',
    kind: 'rss',
    target: 'https://www.growth-memo.com/feed',
    tier: 'practitioner',
    topics: ['seo', 'geo', 'measurement'],
    weight: 80,
    intervalHours: 24,
    note: 'Veri destekli haftalik analiz',
  },
  {
    key: 'gsqi-glenn-gabe',
    name: 'GSQi (Glenn Gabe)',
    kind: 'rss',
    target: 'https://www.gsqi.com/marketing-blog/feed/',
    tier: 'practitioner',
    topics: ['seo', 'platform'],
    weight: 75,
    intervalHours: 24,
    note: 'Algoritma guncellemesi sonrasi saha gozlemleri',
  },
  {
    key: 'seer-interactive',
    name: 'Seer Interactive',
    kind: 'rss',
    target: 'https://www.seerinteractive.com/insights/rss.xml',
    tier: 'practitioner',
    topics: ['seo', 'geo', 'measurement'],
    weight: 75,
    intervalHours: 24,
    note: 'LLM gorunurlugu olcum metodolojisi denemeleri',
  },
  {
    key: 'backlinko',
    name: 'Backlinko',
    kind: 'rss',
    target: 'https://backlinko.com/feed',
    tier: 'practitioner',
    topics: ['seo', 'geo'],
    weight: 60,
    intervalHours: 48,
  },
  {
    key: 'moz-blog',
    name: 'Moz Blog',
    kind: 'rss',
    target: 'https://moz.com/posts/rss/blog',
    tier: 'practitioner',
    topics: ['seo', 'geo', 'schema'],
    weight: 65,
    intervalHours: 24,
  },
];

// ═══════════════════════════════════════════════════════════════════════
//  HABER — hizli sinyal, dusuk kanit. Bir seyin OLDUGUNU buradan
//  ogrenip, DOGRULUGUNU resmi/arastirma katmanindan teyit ederiz.
// ═══════════════════════════════════════════════════════════════════════

const NEWS: IntelSourceDef[] = [
  {
    key: 'search-engine-land',
    name: 'Search Engine Land',
    kind: 'rss',
    target: 'https://searchengineland.com/feed',
    tier: 'news',
    topics: ['seo', 'geo', 'platform'],
    weight: 60,
    // OLCULDU: feed yalnizca son ~5 SAATI tutuyor (gunde ~44 yazi, 10
    // kayitlik pencere). Seyrek cekim SESSIZ KAYIP demek — toplama
    // cron'unun frekansiyla (3 saat) ayni seviyede tutuluyor.
    intervalHours: 3,
    note: 'Feed penceresi cok dar — gunde 1 cekimde icerigin %80i kaybolur',
  },
  {
    key: 'search-engine-journal',
    name: 'Search Engine Journal',
    kind: 'rss',
    target: 'https://www.searchenginejournal.com/feed/',
    tier: 'news',
    topics: ['seo', 'geo', 'platform'],
    weight: 50,
    // Olculen pencere ~3 gun, gunde ~7 yazi
    intervalHours: 12,
  },
];

// ═══════════════════════════════════════════════════════════════════════
//  ASO — uygulama magazasi tarafi.
// ═══════════════════════════════════════════════════════════════════════

const ASO_SOURCES: IntelSourceDef[] = [
  {
    key: 'apptweak-blog',
    name: 'AppTweak ASO Blog',
    kind: 'rss',
    target: 'https://www.apptweak.com/en/aso-blog/feed',
    tier: 'primary-research',
    topics: ['aso'],
    weight: 80,
    intervalHours: 24,
    note: 'Magaza algoritma degisikliklerini kendi veri setiyle olcuyor',
  },
  {
    key: 'mobileaction-blog',
    name: 'MobileAction Blog',
    kind: 'rss',
    target: 'https://www.mobileaction.co/blog/feed/',
    tier: 'primary-research',
    topics: ['aso'],
    weight: 75,
    intervalHours: 24,
  },
  {
    key: 'medium-aso',
    name: 'Medium — App Store Optimization etiketi',
    kind: 'rss',
    target: 'https://medium.com/feed/tag/app-store-optimization',
    tier: 'community',
    topics: ['aso'],
    weight: 30,
    intervalHours: 24,
  },
  {
    key: 'reddit-aso',
    name: 'r/AppStoreOptimization',
    kind: 'reddit',
    target: 'AppStoreOptimization',
    tier: 'community',
    topics: ['aso'],
    weight: 30,
    // Olculen pencere 1.6 gun (gunde ~16 gonderi) — 12 saat guvenli
    intervalHours: 12,
    note: 'Indie gelistirici saha deneyleri — erken sinyal',
  },
];

// ═══════════════════════════════════════════════════════════════════════
//  TOPLULUK — en erken sinyal, en dusuk guven. Bir sey once burada
//  konusulur, haftalar sonra veri calismasina donusur.
// ═══════════════════════════════════════════════════════════════════════

const COMMUNITY: IntelSourceDef[] = [
  {
    key: 'reddit-seo',
    name: 'r/SEO',
    kind: 'reddit',
    target: 'SEO',
    tier: 'community',
    topics: ['seo', 'geo'],
    weight: 25,
    // Olculen pencere 1.2 gun (gunde ~20 gonderi) — 12 saat gerekli
    intervalHours: 12,
  },
  {
    key: 'reddit-bigseo',
    name: 'r/bigseo',
    kind: 'reddit',
    target: 'bigseo',
    tier: 'community',
    topics: ['seo', 'geo', 'measurement'],
    weight: 35,
    intervalHours: 12,
    note: 'r/SEO\'dan belirgin olcude daha teknik',
  },
  {
    key: 'medium-geo',
    name: 'Medium — LLM SEO etiketi',
    kind: 'rss',
    // 'generative-engine-optimization' ve 'ai-seo' etiketleri feed
    // dondurmuyor (canli testte 0 kayit); 'llm-seo' ayni konuyu kapsiyor.
    target: 'https://medium.com/feed/tag/llm-seo',
    tier: 'community',
    topics: ['geo'],
    weight: 25,
    intervalHours: 24,
    note: 'Cogunlukla icerik pazarlamasi; triage burada agresif elemeli',
  },
  {
    key: 'hn-ai-search',
    name: 'Hacker News — AI arama & ajanlar',
    kind: 'hn',
    // Algolia boolean operator ALMAZ; '|' ile ayrilan her terim AYRI
    // sorgu olarak calisir. Tek bir "A OR B" dizesi 0 sonuc dondurur.
    target: 'llms.txt|AI search|generative engine optimization|agentic browser|AI crawler',
    tier: 'community',
    topics: ['geo', 'agents', 'ai-crawler'],
    weight: 40,
    intervalHours: 12,
    note: 'Algolia HN API — puan esigi (>=15) ve tekillestirme collector tarafinda',
  },
  {
    key: 'openclaw-releases',
    name: 'OpenClaw surumleri',
    kind: 'github',
    target: 'openclaw/openclaw',
    tier: 'official',
    topics: ['agents'],
    weight: 70,
    intervalHours: 12,
    note: 'Ajan ekosisteminin fiili referansi — surum notlari yetenek degisimini gosterir',
  },
];

// ═══════════════════════════════════════════════════════════════════════
//  X (Twitter) — xAI Live Search uzerinden. Feed degil SORGU tabanli:
//  her kayit bir arama sorgusudur, Grok canli X indeksinde calistirir.
//
//  XAI_API_KEY yoksa collector bu kayitlari sessizce atlar.
// ═══════════════════════════════════════════════════════════════════════

const X_QUERIES: IntelSourceDef[] = [
  {
    key: 'x-geo-evidence',
    name: 'X — GEO olcum & kanit tartismalari',
    kind: 'x',
    target: 'generative engine optimization OR "AI visibility" OR "LLM citations" data study',
    tier: 'community',
    topics: ['geo', 'measurement'],
    weight: 35,
    intervalHours: 24,
  },
  {
    key: 'x-llms-txt',
    name: 'X — llms.txt & crawler erisimi',
    kind: 'x',
    target: 'llms.txt OR GPTBot OR ClaudeBot OR "AI crawler" robots.txt',
    tier: 'community',
    topics: ['ai-crawler'],
    weight: 35,
    intervalHours: 24,
  },
  {
    key: 'x-google-updates',
    name: 'X — Google arama guncellemeleri',
    kind: 'x',
    target: '"AI Overviews" OR "AI Mode" ranking update volatility',
    tier: 'community',
    topics: ['seo', 'platform'],
    weight: 30,
    intervalHours: 24,
  },
  {
    key: 'x-agentic-commerce',
    name: 'X — ajan tabanli arama & ticaret',
    kind: 'x',
    target: '"agentic search" OR "agentic commerce" OR OpenClaw SEO',
    tier: 'community',
    topics: ['agents', 'geo'],
    weight: 30,
    intervalHours: 24,
  },
  {
    key: 'x-aso',
    name: 'X — ASO algoritma sinyalleri',
    kind: 'x',
    target: '"app store optimization" algorithm change OR "custom product page" results',
    tier: 'community',
    topics: ['aso'],
    weight: 30,
    intervalHours: 24,
  },
];

export const INTEL_SOURCES: IntelSourceDef[] = [
  ...OFFICIAL,
  ...PRIMARY_RESEARCH,
  ...PRACTITIONER,
  ...NEWS,
  ...ASO_SOURCES,
  ...COMMUNITY,
  ...X_QUERIES,
];

/**
 * Denenmis ve SU AN calismayan kaynaklar. Silmiyoruz: birinin engeli
 * kalkarsa yukari tasinsin, ayni URL tekrar tekrar denenmesin diye.
 */
export const DISABLED_SOURCES: Array<{ name: string; target: string; reason: string }> = [
  { name: 'Search Engine Roundtable', target: 'https://www.seroundtable.com/rss.xml', reason: 'HTTP 200 donuyor ama govde BOS — tarayici UA ile de 0 kayit. Bot korumasi.' },
  { name: 'r/TechSEO', target: 'https://www.reddit.com/r/TechSEO/new.rss', reason: 'HTTP 200 ama 0 kayit — subreddit erisime kapali. r/SEO + r/bigseo kapsiyor.' },
  { name: 'Medium — generative-engine-optimization / ai-seo etiketleri', target: 'https://medium.com/feed/tag/generative-engine-optimization', reason: 'Etiket feed dondurmuyor (0 kayit); llm-seo etiketi kullanildi' },
  { name: 'Semrush Blog', target: 'https://www.semrush.com/blog/feed/', reason: 'Bot korumasi — baglanti kuruluyor, yanit gelmiyor (curl 000)' },
  { name: 'Perplexity Hub', target: 'https://www.perplexity.ai/hub/blog/rss.xml', reason: 'HTTP 403 — feed korumali' },
  { name: 'Sensor Tower Blog', target: 'https://sensortower.com/blog/rss', reason: 'HTTP 404 — feed kaldirilmis' },
  { name: 'Appfigures Blog', target: 'https://www.appfigures.com/resources/feed', reason: 'HTTP 404' },
  { name: 'OpenClaw Blog', target: 'https://openclaw.ai/blog/rss.xml', reason: 'HTTP 404 — feed yok, GitHub releases kullaniliyor' },
];

export function sourceByKey(key: string): IntelSourceDef | undefined {
  return INTEL_SOURCES.find((s) => s.key === key);
}
