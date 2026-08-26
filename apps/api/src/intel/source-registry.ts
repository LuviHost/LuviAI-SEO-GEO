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
export type SourceKind = 'rss' | 'reddit' | 'hn' | 'x' | 'github' | 'x-curation';

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

  // ── 2026-08-21 genislemesi: AI saglayicilarin kendi agzi eksikti ──
  // Feed'ler eklenmeden once curl ile dogrulandi (HTTP 200 + >=3 kayit +
  // son kayit <60 gun). Google kategori feed'leri The Keyword genel feed'iyle
  // kesisebilir — sorun degil: collector fingerprint'i normalize URL bazli,
  // ayni yazi iki feed'den gelse de TEK kayit olur.
  {
    key: 'deepmind-blog',
    name: 'Google DeepMind Blog',
    kind: 'rss',
    target: 'https://deepmind.google/blog/rss.xml',
    tier: 'official',
    topics: ['platform', 'agents'],
    weight: 92,
    intervalHours: 24,
    note: 'Gemini arastirma tarafinin birincil agzi',
  },
  {
    key: 'google-blog-gemini',
    name: 'The Keyword — Gemini',
    kind: 'rss',
    target: 'https://blog.google/products/gemini/rss/',
    tier: 'official',
    topics: ['platform', 'agents'],
    weight: 92,
    intervalHours: 12,
    note: 'Gemini asistaninin tarama/kaynak gosterme/agent duyurulari',
  },
  {
    key: 'google-blog-ai',
    name: 'The Keyword — AI',
    kind: 'rss',
    target: 'https://blog.google/technology/ai/rss/',
    tier: 'official',
    topics: ['platform', 'geo', 'agents'],
    weight: 90,
    intervalHours: 24,
    note: 'Search/Gemini kategorilerine dusmeyen Labs/arastirma duyurulari',
  },
  {
    key: 'mistral-blog',
    name: 'Mistral AI Blog',
    kind: 'rss',
    target: 'https://mistral.ai/rss.xml',
    tier: 'official',
    topics: ['platform', 'agents'],
    weight: 90,
    intervalHours: 24,
    note: 'Avrupanin ana model saglayicisi — agentic search duyurulari',
  },
  {
    key: 'anthropic-news-mirror',
    name: 'Anthropic News (RSSHub aynasi)',
    kind: 'rss',
    target: 'https://rsshub.bestblogs.dev/anthropic/news',
    tier: 'official',
    topics: ['platform', 'ai-crawler', 'agents'],
    weight: 88,
    intervalHours: 12,
    note: 'Anthropic resmi feed YAYINLAMIYOR (tum yollar 404 — bkz. DISABLED). ' +
      'Icerik resmi, tasiyici topluluk aynasi (RSSHub): kirilirsa failCount ' +
      'mekanizmasi kapatir, alternatif ayna aranir. ClaudeBot/Claude-User ' +
      'davranisinin birincil agzi baska yerde yok.',
  },
  {
    key: 'meta-eng-ai',
    name: 'Meta Engineering — AI Research',
    kind: 'rss',
    target: 'https://engineering.fb.com/category/ai-research/feed/',
    tier: 'official',
    topics: ['platform', 'agents'],
    weight: 88,
    intervalHours: 24,
    note: 'ai.meta.com feed vermiyor; erisilen tek resmi Meta AI feed bu. Aylik ritim.',
  },
  {
    key: 'mcp-blog',
    name: 'Model Context Protocol Blog',
    kind: 'rss',
    target: 'https://blog.modelcontextprotocol.io/index.xml',
    tier: 'official',
    topics: ['agents', 'platform'],
    weight: 95,
    intervalHours: 24,
    note: 'Ajan-arac protokolunun spec sahibi — MCP degisiklikleri AXO/mcpAccess yuzeyini dogrudan etkiler',
  },
  {
    key: 'vercel-news',
    name: 'Vercel News',
    kind: 'rss',
    target: 'https://vercel.com/atom',
    tier: 'official',
    topics: ['ai-crawler', 'agents', 'platform'],
    weight: 90,
    intervalHours: 24,
    note: 'AI crawling/bot olcumleri yayinliyor. DIKKAT: feed tum arsivi ' +
      'tasiyor (~1500 kayit) — ilk cekim kuyrugu sisirir, triage birkac ' +
      'gunde eritir; kalici maliyet yok (fingerprint dedup).',
  },
  {
    key: 'fastly-blog',
    name: 'Fastly Blog',
    kind: 'rss',
    target: 'https://www.fastly.com/blog_rss.xml',
    tier: 'official',
    topics: ['ai-crawler', 'platform'],
    weight: 88,
    intervalHours: 24,
    note: 'CDN gozunden bot/AI crawler olcumleri — Cloudflare tekeline ikinci ses. Feed yolu standart disi.',
  },
  {
    key: 'stripe-blog',
    name: 'Stripe Blog',
    kind: 'rss',
    target: 'https://stripe.com/blog/feed.rss',
    tier: 'official',
    topics: ['agents', 'platform'],
    weight: 88,
    intervalHours: 24,
    note: 'Agentic commerce birincil agzi; genel fintech karisimini triage eler',
  },
  {
    key: 'github-blog-ai',
    name: 'GitHub Blog — AI & ML',
    kind: 'rss',
    target: 'https://github.blog/ai-and-ml/feed/',
    tier: 'official',
    topics: ['agents', 'platform'],
    weight: 88,
    intervalHours: 24,
    note: 'Ajan/araclarin gelistirici ekosistemi tarafi',
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

  // ── 2026-08-21 genislemesi ──
  {
    key: 'searchpilot',
    name: 'SearchPilot Blog',
    kind: 'rss',
    target: 'https://www.searchpilot.com/resources/blog/rss.xml',
    tier: 'primary-research',
    topics: ['seo', 'geo', 'measurement'],
    weight: 88,
    intervalHours: 24,
    note: 'Sektorun tek duzenli SEO A/B test yayincisi — kontrollu deney ' +
      'kaniti (grade: controlled-test adayi). Feed sayfada ilan edilmiyor; ' +
      'URL sessizce degisirse bos-feed alarmi yakalar.',
  },
  {
    key: 'profound-blog',
    name: 'Profound Blog',
    kind: 'rss',
    target: 'https://www.tryprofound.com/rss/blog.xml',
    tier: 'primary-research',
    topics: ['geo', 'measurement', 'ai-crawler'],
    weight: 88,
    intervalHours: 24,
    note: 'AI gorunurluk olcumunde buyuk orneklemli calismalar (158K iddia ' +
      'analizi, citation dagilimlari). Rakip olmasi sorun degil — veri veri.',
  },
  {
    key: 'brightedge-blog',
    name: 'BrightEdge Blog',
    kind: 'rss',
    target: 'https://www.brightedge.com/rss.xml',
    tier: 'primary-research',
    topics: ['geo', 'seo', 'measurement'],
    weight: 85,
    intervalHours: 24,
    note: 'Generative Parser buyuk orneklemli AI atif calismalari; urun duyurusu karisimini triage eler',
  },
  {
    key: 'sistrix-blog',
    name: 'SISTRIX Blog',
    kind: 'rss',
    target: 'https://www.sistrix.com/feed/',
    tier: 'primary-research',
    topics: ['seo', 'geo', 'measurement'],
    weight: 85,
    intervalHours: 24,
    note: 'Gorunurluk endeksi + AI arama calismalari. /blog/feed/ BOS donuyor — kok /feed/ kullanilmali.',
  },
  {
    key: 'seoclarity-blog',
    name: 'seoClarity Blog',
    kind: 'rss',
    target: 'https://www.seoclarity.net/blog/rss.xml',
    tier: 'primary-research',
    topics: ['seo', 'geo', 'measurement'],
    weight: 80,
    intervalHours: 24,
    note: 'Kurumsal veri setiyle AEO olcum calismalari',
  },
  {
    key: 'commoncrawl-blog',
    name: 'Common Crawl Foundation Blog',
    kind: 'rss',
    target: 'https://commoncrawl.org/blog/rss.xml',
    tier: 'primary-research',
    topics: ['ai-crawler', 'platform'],
    weight: 85,
    intervalHours: 24,
    note: 'AI egitim verisinin ana kaynagi kendi agzi; rutin crawl-surumu duyurulari triage ile elenir',
  },
  {
    key: 'arxiv-cs-ir',
    name: 'arXiv cs.IR (Information Retrieval)',
    kind: 'rss',
    target: 'https://rss.arxiv.org/rss/cs.IR',
    tier: 'primary-research',
    topics: ['geo', 'measurement', 'agents'],
    weight: 75,
    intervalHours: 12,
    note: 'GEO/LLM-arama akademik on-baskilari. PENCERE 1 GUN — feed yalnizca ' +
      'o gunun duyurularini tasir, 12 saatte cekilmezse kayit KAYBOLUR. ' +
      'Hakemsiz on-baski oldugu icin weight dusuk; gunde ~30 kayit gurultusunu ' +
      'triage eler. cs.CL BILEREK alinmadi: gunde ~110 kayit, tek basina ' +
      'gunluk triage butcesinin yarisini yiyordu.',
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

  // ── 2026-08-21 genislemesi ──
  {
    key: 'amsive-insights',
    name: 'Amsive Insights (Lily Ray)',
    kind: 'rss',
    target: 'https://www.amsive.com/feed/',
    tier: 'practitioner',
    topics: ['geo', 'seo', 'measurement'],
    weight: 75,
    intervalHours: 24,
    note: 'Lily Ray ekibinin AI-search testleri; ajans geneli feed — GEO disi icerigi triage eler',
  },
  {
    key: 'marie-haynes',
    name: 'Marie Haynes',
    kind: 'rss',
    target: 'https://www.mariehaynes.com/feed/',
    tier: 'practitioner',
    topics: ['seo', 'geo'],
    weight: 72,
    intervalHours: 24,
    note: 'Google algoritma degisimlerinin en dikkatli practitioner izleyicilerinden; ayda 2-3 kayit',
  },
  {
    key: 'duane-forrester',
    name: 'Duane Forrester Decodes',
    kind: 'rss',
    target: 'https://duaneforresterdecodes.substack.com/feed',
    tier: 'practitioner',
    topics: ['geo', 'seo'],
    weight: 70,
    intervalHours: 24,
    note: 'Eski Bing arama urun yoneticisi, AI-arama analizleri. DIKKAT: ' +
      'duaneforrester.substack.com (tekil, Decodes\'suz) FARKLI ve bos bir ' +
      'muzik hesabi — karistirma.',
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

  // ── 2026-08-21 genislemesi ──
  {
    key: 'phiture-blog',
    name: 'Phiture (ASO Stack)',
    kind: 'rss',
    target: 'https://phiture.com/feed/',
    tier: 'practitioner',
    topics: ['aso'],
    weight: 78,
    intervalHours: 24,
    note: 'ASO Stack ekolunun ana kaynagi — katalogdaki en buyuk ASO eksigiydi',
  },
  {
    key: 'revenuecat-blog',
    name: 'RevenueCat Blog',
    kind: 'rss',
    target: 'https://www.revenuecat.com/blog/rss.xml',
    tier: 'primary-research',
    topics: ['aso', 'platform'],
    weight: 82,
    intervalHours: 24,
    note: 'State of Subscription Apps — mobil gelir tarafinin en buyuk orneklemli veri seti',
  },
  {
    key: 'appsflyer-blog',
    name: 'AppsFlyer Blog',
    kind: 'rss',
    target: 'https://www.appsflyer.com/feed/',
    tier: 'primary-research',
    topics: ['aso', 'measurement'],
    weight: 78,
    intervalHours: 24,
    note: 'Atribusyon veri calismalari. /blog/feed/ 403 doner — kok /feed/ kullanilmali.',
  },
  {
    key: 'branch-blog',
    name: 'Branch Blog',
    kind: 'rss',
    target: 'https://www.branch.io/feed/',
    tier: 'practitioner',
    topics: ['aso', 'platform'],
    weight: 65,
    intervalHours: 24,
    note: 'Deep link / mobil kesif tarafi',
  },
  {
    key: 'appfigures-resources',
    name: 'Appfigures Resources',
    kind: 'rss',
    target: 'https://appfigures.com/resources/rss',
    tier: 'practitioner',
    topics: ['aso'],
    weight: 75,
    intervalHours: 24,
    note: 'Magaza verisi analizleri. Eski /resources/feed yolu 404 idi (bkz. ' +
      'DISABLED) — calisan yol bu. Item pubDate tasimiyor: publishedAt null ' +
      'kalir, recencyFactor 0.6 varsayilanina duser; kanit agirligi hafif ' +
      'cezali ama kabul edilebilir.',
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
  {
    key: 'x-geo-genel',
    name: 'X — GEO/AI SEO genel tartisma',
    kind: 'x',
    target: '"geo seo" OR "GEO optimization" OR "AI SEO" OR "answer engine optimization"',
    tier: 'community',
    topics: ['geo', 'seo'],
    weight: 30,
    intervalHours: 24,
    note: 'Alanin gunluk dili — dar teknik sorgularin kacirdigi tartismalar burada',
  },
  {
    key: 'x-oss-araclar',
    name: 'X — acik kaynak SEO/GEO arac duyurulari',
    kind: 'x',
    target: '"open sourced" SEO tool OR "open source" "AI visibility" OR github "llms.txt" generator',
    tier: 'community',
    topics: ['geo', 'seo', 'agents'],
    weight: 35,
    intervalHours: 24,
    // Bu sorgunun asil degeri postun kendisi degil, isaret ettigi DEPO.
    // Toplayici depoyu acip inceler ve ayri bir bulgu olarak kaydeder.
    note: 'Depo cikma olasiligi en yuksek sorgu — rakip arac cikislarini erken yakalar',
  },
  {
    key: 'x-rakipler',
    name: 'X — GEO araclari pazar sinyalleri',
    kind: 'x',
    target: 'Profound OR "Peec AI" OR Otterly OR "AI search monitoring" OR "brand visibility AI"',
    tier: 'community',
    topics: ['geo', 'measurement'],
    weight: 30,
    intervalHours: 24,
    note: 'Rakip hamleleri, fiyatlama ve kullanici sikayetleri',
  },
];

/**
 * Kisisel kurasyon — kullanicinin X'te YER ISARETLERINE ekledigi gonderiler
 * (x-curation.service.ts). Gonderi kaynak degil kesif kanali: makale kendi
 * yayincisina atfedilir (meta.attributeTo); yalniz katalogda olmayan
 * yayincilar bu kovada kalir. target = sayfa URL'leri (virgulle coklu;
 * Premium klasor URL'si de olur). DM DEGIL: XChat uctan uca sifreli,
 * cerez senkronuyla okunamiyor (2026-08-27 denendi).
 * Sunucuda OPENCLAW_X_CURATION_ENABLED=1 degilse toplayici bos doner.
 */
const X_CURATION_SOURCES: IntelSourceDef[] = [
  {
    key: 'x-curated',
    name: 'X Yer İşaretleri — "ranksup.ai" klasörü',
    kind: 'x-curation',
    // "ranksup.ai" yer-isareti klasoru — #folder=<ad>: klasor URL'si soguk yuklemede
    // hata verdigi icin servis sayfayi acip sekme + klasor adina tiklar (x-curation-links.ts)
    target: 'https://x.com/i/bookmarks#folder=ranksup.ai',
    tier: 'community',
    topics: ['geo', 'seo', 'aso', 'ai-crawler', 'measurement', 'agents', 'platform'],
    weight: 30,
    intervalHours: 24,
    note: 'OpenClaw tarayicisi, LLM yok. Oturum dusunce lastError "X oturumu yok" der; Mac\'te OPENCLAW_HOST=luvi108 node scripts/x-oturum-aktar.mjs.',
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
  ...X_CURATION_SOURCES,
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
  // ── 2026-08-21 kesif dalgasinda denenip ELENENLER — ayni cukura dusme ──
  { name: 'IETF AI Preferences (aipref) WG', target: 'https://datatracker.ietf.org/feed/group/aipref/', reason: 'Kesif ajani dogruladi sanmisti ama tum datatracker feed yollari 404 — bagimsiz yeniden dogrulamada yakalandi. Standart onemli: aipref RFC tasla klari X sorgulari + Cloudflare/Google resmi kanallarindan izlenir; feed yolu bulunursa yeniden eklenmeli.' },
  { name: 'Anthropic resmi feed', target: 'https://www.anthropic.com/rss.xml', reason: '/rss.xml, /news/rss.xml, /feed hepsi 404 — resmi feed yok. RSSHub aynasi kullaniliyor (anthropic-news-mirror).' },
  { name: 'xAI News', target: 'https://x.ai/rss.xml', reason: 'Feed yok + Cloudflare 403. X sorgulari (x-*) kismen kapatiyor.' },
  { name: 'Microsoft AI Blog', target: 'https://blogs.microsoft.com/ai/feed/', reason: 'Cloudflare bot korumasi — 403 "Just a moment".' },
  { name: 'Meta AI Blog', target: 'https://ai.meta.com/blog/rss/', reason: 'Feed yok (404). Ikame: engineering.fb.com AI Research kategorisi (meta-eng-ai).' },
  { name: 'Adjust Blog', target: 'https://www.adjust.com/blog/rss.xml', reason: 'HTTP 429 — Astro challenge, bot korumasi.' },
  { name: 'Otterly.ai Blog', target: 'https://otterly.ai/blog/rss.xml', reason: 'Feed URL kendi uzerine 302 donguyor — sunucu yapilandirma hatasi.' },
  { name: 'Peec AI / AthenaHQ / Scrunch / Evertune', target: '(cesitli)', reason: 'GEO olcum girisimlerinin cogu Framer/Astro/Webflow — feed uretmiyorlar. Veri yayinlarlarsa X sorgulari yakalar.' },
  { name: 'Conductor / Botify / Advanced Web Ranking', target: '(cesitli)', reason: 'RSS yok — modern site kabuklari feed uretmiyor.' },
  { name: 'HTTP Archive / Web Almanac', target: 'https://httparchive.org/atom.xml', reason: 'Feed yok (404). Yillik Almanac cikinca elle islenebilir.' },
  { name: 'Apple Search Ads duyurulari', target: 'https://ads.apple.com/news', reason: 'Resmi feed yok — sadece HTML. ASA degisiklikleri Apple Developer News + ASO kaynaklarindan geliyor.' },
  { name: 'arXiv cs.CL', target: 'https://rss.arxiv.org/rss/cs.CL', reason: 'Calisiyor AMA gunde ~110 kayit — tek basina gunluk triage butcesinin yarisi. cs.IR yeterli.' },
  { name: 'Bing Blogs / Microsoft Copilot Blog', target: 'https://blogs.bing.com/Home/feed', reason: 'Feed calisiyor ama bayat (son kayit >60 gun). Canlanirsa yeniden degerlendir.' },
  { name: 'Shopify Engineering', target: 'https://shopify.engineering/blog.atom', reason: 'Belgelenen feed 404. Platform changelog ise 789 kayitlik arsiv + ajan-disi gurultu.' },
];

export function sourceByKey(key: string): IntelSourceDef | undefined {
  return INTEL_SOURCES.find((s) => s.key === key);
}
