/**
 * Glossary — InfoTooltip icin tum terimlerin tek-source-of-truth tanimi.
 *
 * Kullanim:
 *   <InfoTooltip term="ROAS">ROAS</InfoTooltip>
 *
 * Yeni terim eklemek icin: bu dosyaya bir entry ekle.
 */

export interface GlossaryEntry {
  short: string;       // tooltip'te gozukecek metin (1-3 satir)
  level: 1 | 2 | 3;    // 1: basit, 2: orta, 3: derin (3 ise 'Daha fazla' link)
  link?: string;       // /help/glossary/<slug> opsiyonel
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ──────────── Reklam Metrikleri ────────────
  CTA: {
    short: 'Call To Action — kullaniciyi tiklamaya yonlendiren buton (orn: "Simdi al", "Ucretsiz dene").',
    level: 1,
  },
  CTR: {
    short: 'Click-Through Rate — gosterimlerin yuzde kaci tiklandi (tiklama / gosterim x 100).',
    level: 1,
  },
  CPC: {
    short: 'Cost Per Click — bir tiklama icin odedigin ortalama tutar.',
    level: 1,
  },
  CPL: {
    short: 'Cost Per Lead — bir lead (potansiyel musteri) toplamak icin odedigin tutar.',
    level: 1,
  },
  CPA: {
    short: 'Cost Per Acquisition — bir gercek satin alma icin harcanan tutar.',
    level: 1,
  },
  ROAS: {
    short: 'Return On Ad Spend — reklam harcamasinin kac katini geri kazandin. ROAS 3 = 1 TL\'ye 3 TL satis.',
    level: 2,
  },
  Impression: {
    short: 'Reklamin/sayfan kac kez gosterildi (tiklanmadi, sadece goruntulendi).',
    level: 1,
  },
  Conversion: {
    short: 'Hedef aksiyon (satin alma, kayit, form doldurma vb.) sayisi.',
    level: 1,
  },
  Lead: {
    short: 'Potansiyel musteri — sana iletisim bilgisini birakmis kisi (form doldurmus, abone olmus).',
    level: 1,
  },
  'Bounce Rate': {
    short: 'Sayfaya gelip hicbir sey yapmadan ayrilan kullanici yuzdesi.',
    level: 1,
  },

  // ──────────── SEO Temel ────────────
  SERP: {
    short: 'Search Engine Results Page — Google/Bing arama sonuc sayfasi.',
    level: 1,
  },
  SEO: {
    short: 'Search Engine Optimization — Google\'da ust siralarda cikmak icin yapilan tum calismalar.',
    level: 1,
  },
  Crawler: {
    short: 'Web sitelerini gezip icerigi indeksleyen yazilim (Googlebot, GPTBot, ClaudeBot vb.).',
    level: 1,
  },
  Bot: {
    short: 'Web sitelerini gezip icerigi indeksleyen yazilim (Googlebot, GPTBot, ClaudeBot vb.).',
    level: 1,
  },
  Sitemap: {
    short: 'Sitendeki tum sayfalarin listesini iceren XML dosyasi. Google ve AI bunu okuyup sayfalari daha hizli kesfeder.',
    level: 1,
  },
  Backlink: {
    short: 'Baska bir siteden senin sitene gelen baglanti. Otorite sinyali — ne kadar cok kaliteli backlink, o kadar yuksek siralama.',
    level: 1,
  },

  // ──────────── GEO / AI Search ────────────
  GEO: {
    short: 'Generative Engine Optimization — ChatGPT/Claude/Gemini gibi AI araclarinin cevap kutucugunda alintilanmak icin yapilan optimizasyon.',
    level: 3,
    link: '/help/glossary#geo',
  },
  AEO: {
    short: 'Answer Engine Optimization — Google\'in "Hizli cevap" kutucugunda gorunmek icin icerik yapilandirma.',
    level: 3,
  },
  Citation: {
    short: 'AI cevap kutucugunda site URL\'inin gecmesi. ChatGPT "iste LuviHost\'tan al" diyorsa = sen alintilandin.',
    level: 2,
  },
  'Brand Mention': {
    short: 'AI sadece marka adini soyledi ama URL vermedi. Citation\'dan yarisi degerli.',
    level: 1,
  },
  Heatmap: {
    short: 'Hangi sorgularda + hangi AI\'da kazandiginin renkli matrix gosterimi.',
    level: 1,
  },

  // ──────────── Schema / Yapısal Veri ────────────
  'Schema markup': {
    short: 'Sayfana eklenen "AI\'a anlatan" yapisal veri (JSON-LD). Google/AI bu sayede "bu bir makale, bu yazar, bu tarih..." diye anlar. Rich snippet\'leri acar.',
    level: 3,
  },
  'JSON-LD': {
    short: 'Schema markup\'un Google\'in onerdigi formati. Sayfanin <head> bolumune <script type="application/ld+json"> olarak gomulur.',
    level: 2,
  },
  'Speakable schema': {
    short: 'Sayfan sesli okunsun diye isaretlenmis cumleler. Siri/Alexa/Google Assistant bu kismi sesli cevap verir.',
    level: 2,
  },
  'FAQ schema': {
    short: 'Sikca Sorulan Sorular bolumunu Google\'a "iste burada" diye soyleyen kod. Arama sonuclarinda accordion gorunur.',
    level: 2,
  },
  Canonical: {
    short: 'Ayni icerik birden fazla URL\'de varsa Google\'a "asil olan budur" diyen tag. Duplicate content cezasini onler.',
    level: 2,
  },
  Hreflang: {
    short: 'Ayni icerigin farkli dillerdeki versiyonlarini Google\'a tanitan tag. Turkce siteyi Ingilizce kullaniciya gostermez.',
    level: 2,
  },

  // ──────────── llms.txt + AI Sitemap ────────────
  'llms.txt': {
    short: 'Sitenin AI search engine\'lere (ChatGPT/Claude/Perplexity) tanitim dosyasi. robots.txt\'in AI versiyonu.',
    level: 3,
  },
  'llms-full.txt': {
    short: 'Tum site iceriginin tek dosyada AI icin derlenmis hali. AI\'lar saniyeler icinde sitenin tamamini ogrenir.',
    level: 3,
  },
  'AI Sitemap': {
    short: 'Standart sitemap.xml\'e ek olarak AI search engines icin optimize edilmis sitemap. Custom ai:summary namespace ile her URL icin 200 kelimelik AI ozet.',
    level: 3,
  },

  // ──────────── Reklam Hedefleme ────────────
  'Lookalike audience': {
    short: 'Mevcut iyi musterilerine benzeyen yeni kisileri Meta otomatik bulur ve hedefler. "Musterilerime benzeyen 10.000 kisiyi goster" demek.',
    level: 2,
  },
  'Negative keyword': {
    short: 'Reklamin gosterilmemesi gereken kelimeler. "Hosting" kelimesinde reklam veriyorsan ama "ucretsiz hosting" aramalarda gorunmek istemiyorsan "ucretsiz" kelimesini negative ekle.',
    level: 2,
  },
  'A/B Test': {
    short: 'Ayni reklamin 2 farkli versiyonu, hangisi daha iyi performans gosteriyor diye karsilastirma.',
    level: 1,
  },
  Audience: {
    short: 'Reklamin gosterilecegi kisilerin tanimi (yas, ilgi alani, lokasyon vb.).',
    level: 1,
  },
  'Hedef Kitle': {
    short: 'Reklamin gosterilecegi kisilerin tanimi (yas, ilgi alani, lokasyon vb.).',
    level: 1,
  },
  Boost: {
    short: 'Organik (ucretsiz) bir post\'un reklam butcesi koyularak daha fazla kisiye gosterilmesi. Meta\'nin "Boost Post" feature\'i.',
    level: 1,
  },

  // ──────────── LuviAI Ozel Terimler ────────────
  Otopilot: {
    short: 'LuviAI\'in senin yerine kararlar alip uygulamasi. Dusuk performans → pause, yuksek → butce artir, A/B winner sec, vs.',
    level: 2,
  },
  Brain: {
    short: 'LuviAI\'in senin sitenle ilgili tuttugu AI hafiza: marka tonu, hedef kitle, rakipler, SEO stratejisi.',
    level: 2,
  },
  'Site Brain': {
    short: 'LuviAI\'in senin sitenle ilgili tuttugu AI hafiza: marka tonu, hedef kitle, rakipler, SEO stratejisi.',
    level: 2,
  },
  Persona: {
    short: 'Tipik musterin (orn: 35 yas KOBI sahibi Mert). AI metinlerini ona gore yazar.',
    level: 1,
  },
  'Editor Score': {
    short: 'Uretilen makalenin AI editorden aldigi kalite puani (60 uzerinden). 48+ olmadan yayina cikmaz.',
    level: 2,
  },
  Tier: {
    short: 'Ranker\'in oncelıklendırdığı konular: Tier 1 = hemen yaz, Tier 2 = bu hafta, Tier 3 = sonra.',
    level: 2,
  },
  Pillar: {
    short: 'Ana konu (orn: "hosting") + alt konular (cluster — "shared hosting nedir", "wordpress hosting" vb.). SEO mimarisi.',
    level: 2,
  },
  Cluster: {
    short: 'Pillar\'in altindaki ilgili alt konular. Pillar = ana cati, cluster = yan kollar.',
    level: 2,
  },
  'Knowledge Graph': {
    short: 'Google\'in "sirket bilgi karti". Wikipedia/Wikidata kaynakli. Marka adinizi arattiginizda sagda cikan bilgi kutusu.',
    level: 3,
  },
  'GEO Score': {
    short: '6 pillar uzerinden agirlikli AI gorunurluk skoru: Crawler · Schema · Citation · Otorite · Tazelik · Multi-Modal. A+ → F harf notu.',
    level: 2,
  },

  // ──────────── Teknik / Geliştirici ────────────
  MCP: {
    short: 'Model Context Protocol — AI\'in gercek API\'lere (Google Ads, Meta Ads) baglanmasini saglayan standart. Anthropic gelistirdi.',
    level: 3,
  },
  Webhook: {
    short: 'Bir olay oldugunda otomatik bildirim gonderilen URL. Slack/Discord\'a baglanir.',
    level: 2,
  },
  'API Key': {
    short: 'LuviAI\'a programatik erisim icin kisisel anahtar. Gelistiriciler kendi yazilimlarindan LuviAI\'i kullanabilir.',
    level: 1,
  },
  Scope: {
    short: 'API key\'in hangi yetkilere sahip oldugu (orn: articles:read = sadece okuma, ads:write = reklam olusturma).',
    level: 2,
  },
  TTS: {
    short: 'Text-To-Speech — yazili metni sesli okutma. Makaleyi MP3\'e cevirir, podcast feed\'e ekler.',
    level: 1,
  },

  // ──────────── Paket / İş ────────────
  Whitelabel: {
    short: 'LuviAI markasini gizleyip kendi marka adinla satma. "Powered by LuviAI" yazisi kalkar.',
    level: 2,
  },
  Affiliate: {
    short: 'Bir baskasini LuviAI\'a yonlendirip kaydolduklarinda komisyon kazanma programi (%30, 3 ay).',
    level: 1,
  },
  TRIAL: {
    short: 'Ucretsiz deneme plani — 1 makale uretebilirsin, paket secince tum yayin hedefleri acilir.',
    level: 1,
  },
  Quota: {
    short: 'Aylik makale uretim limitin. Plan basina degisir (Baslangic 10, Profesyonel 40, Kurumsal 100). Ay sonu sifirlanir.',
    level: 1,
  },
};

/**
 * Bir terimi normalize edip glossary'den entry doner.
 */
export function getGlossaryEntry(term: string): GlossaryEntry | null {
  // Direct match
  if (GLOSSARY[term]) return GLOSSARY[term];
  // Case insensitive
  const lower = term.toLowerCase();
  for (const [key, entry] of Object.entries(GLOSSARY)) {
    if (key.toLowerCase() === lower) return entry;
  }
  return null;
}
