/**
 * Glossary — InfoTooltip icin tum terimlerin tek-source-of-truth tanimi.
 *
 * Kullanim:
 *   <InfoTooltip term="ROAS">ROAS</InfoTooltip>
 *
 * Yeni terim eklemek icin: bu dosyaya bir entry ekle.
 *
 * DIKKAT: /help/glossary sayfasi TUM girdileri herkese acik yayinlar (ve
 * DefinedTermSet JSON-LD olarak AI asistanlarina verir). Her tanim dogru ve
 * dogrulanabilir olmali; RanksUp'a ait iddialar kodla ayni kalmali
 * (public-docs.spec.ts bir kismini denetler).
 *
 * 18.10.2026 durust metin duzeltmesi — kaldirilan / duzeltilen iddialar:
 *  - TTS ("makaleyi MP3'e cevirir, podcast feed'e ekler") ve Whitelabel
 *    ("Powered by RanksUp yazisi kalkar") girdileri silindi: ses/podcast urunden
 *    cikti (0db5a1c), white-label ayarlari kaydediliyor ama hicbir yerde
 *    uygulanmiyor ve hicbir planda satilmiyor.
 *  - TRIAL "1 makale" → plans.ts (2 makale, 3 calistirma, 1 site; yayin hedefi
 *    Markdown ZIP + WordPress REST — QuotaService.LIMITS.TRIAL).
 *  - Quota eski plan adlari/sayilari ("Baslangic 10 ... Kurumsal 100") → sayi
 *    yazilmaz, fiyat sayfasina yonlendirilir; sifirlama kurali quota.service.ts.
 *  - Editor Score "60 uzerinden, 48+" → pipeline.service.ts EDITOR_MAX_SCORE 90;
 *    PASS yalniz engelleyici bulgu yokken ve GEO kapisi gecilince (aksi halde
 *    REVIZE_NEEDED). 90 olcegi 16ab0d9 ile geldi (main'e 3 Agustos 2026 23:25
 *    +03:00); oncesindeki hat 60 uzerinden puanliyordu ("xx/60" istemi). Makale
 *    sayfasi paydayi yazi basina secer (articles/[articleId]/page.tsx
 *    editorScoreMax); tanim bu yuzden eski yazilarin olcegini da soyler.
 *  - AI Sitemap "200 kelimelik AI ozet" → ai-sitemap.service.ts meta aciklamanin
 *    ilk 200 KARAKTERI.
 *  - llms.txt "robots.txt'in AI versiyonu" ve llms-full.txt "AI'lar saniyeler
 *    icinde sitenin tamamini ogrenir" → https://llmstxt.org/ (Jeremy Howard,
 *    3 Eylul 2024): bir oneri; robots.txt ile amaci farkli.
 *  - FAQ schema "arama sonuclarinda accordion gorunur" → Google SSS zengin
 *    sonucunu 7 Mayis 2026'dan itibaren gostermiyor:
 *    https://developers.google.com/search/docs/appearance/structured-data/faqpage
 *  - Speakable "Siri/Alexa" → yalniz Google Asistan, ABD, Ingilizce haber, beta:
 *    https://developers.google.com/search/docs/appearance/structured-data/speakable
 *  - Canonical "duplicate content cezasini onler" → Google ceza demiyor; sinyal
 *    birlestirme + tercih edilen URL:
 *    https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
 *  - Hreflang, Sitemap, Backlink, JSON-LD, Schema markup, Knowledge Graph
 *    tanimlari Google belgeleriyle ayni dile cekildi:
 *    https://developers.google.com/search/docs/specialty/international/localized-versions
 *    https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview
 *    https://developers.google.com/search/docs/crawling-indexing/links-crawlable
 *    https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
 *    https://support.google.com/knowledgepanel/answer/9787176
 *  - MCP "Google Ads, Meta Ads'e baglanir" (kaldirilan Ryze MCP) → Anthropic'in
 *    acik standardi (25 Kasim 2024): https://www.anthropic.com/news/model-context-protocol
 *    RanksUp MCP sunucusu ve API anahtari Kurumsal (plans.ts mcpAccess/apiAccess).
 */

export interface GlossaryEntry {
  short: string;       // tooltip'te gozukecek metin (1-3 satir)
  level: 1 | 2 | 3;    // 1: basit, 2: orta, 3: derin (3 ise 'Daha fazla' link)
  link?: string;       // /help/glossary/<slug> opsiyonel
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ──────────── Reklam Metrikleri ────────────
  CTA: {
    short: 'Call To Action — kullanıcıyı tıklamaya yönlendiren buton ya da metin (örn: "Şimdi al", "Ücretsiz dene").',
    level: 1,
  },
  CTR: {
    short: 'Click-Through Rate — gösterimlerin yüzde kaçının tıklandığı (tıklama / gösterim × 100).',
    level: 1,
  },
  CPC: {
    short: 'Cost Per Click — bir tıklama için ödediğin ortalama tutar.',
    level: 1,
  },
  CPL: {
    short: 'Cost Per Lead — bir potansiyel müşteri (lead) kazanmak için ödediğin tutar.',
    level: 1,
  },
  CPA: {
    short: 'Cost Per Acquisition — bir satın alma ya da hedeflenen dönüşüm başına harcanan tutar.',
    level: 1,
  },
  ROAS: {
    short: 'Return On Ad Spend — reklam harcamasının kaç katını geri kazandığın. ROAS 3 = harcanan 1 TL\'ye 3 TL satış.',
    level: 2,
  },
  Impression: {
    short: 'Reklamın ya da sayfanın kaç kez gösterildiği; tıklanması gerekmez, görüntülenmesi sayılır.',
    level: 1,
  },
  Conversion: {
    short: 'Hedef aksiyonların (satın alma, kayıt, form doldurma vb.) sayısı.',
    level: 1,
  },
  Lead: {
    short: 'Potansiyel müşteri — sana iletişim bilgisini bırakmış kişi (form doldurmuş, abone olmuş).',
    level: 1,
  },
  'Bounce Rate': {
    short: 'Sayfaya gelip hiçbir etkileşim olmadan ayrılan ziyaretçilerin yüzdesi.',
    level: 1,
  },

  // ──────────── SEO Temel ────────────
  SERP: {
    short: 'Search Engine Results Page — Google ya da Bing arama sonuç sayfası.',
    level: 1,
  },
  SEO: {
    short: 'Search Engine Optimization — sitenin arama sonuçlarında daha görünür olması için yapılan çalışmaların tümü.',
    level: 1,
  },
  Crawler: {
    short: 'Web sitelerini gezip içeriği toplayan yazılım (Googlebot, GPTBot, ClaudeBot vb.).',
    level: 1,
  },
  Bot: {
    short: 'Web sitelerini gezip içeriği toplayan yazılım (Googlebot, GPTBot, ClaudeBot vb.).',
    level: 1,
  },
  Sitemap: {
    short: 'Sitendeki sayfaların listesini içeren XML dosyası. Google gibi arama motorları siteyi daha verimli taramak için bu dosyayı okur.',
    level: 1,
  },
  Backlink: {
    short: 'Başka bir siteden senin sitene verilen bağlantı. Google, sayfaların alakasını belirlerken ve yeni sayfaları keşfederken bağlantıları sinyal olarak kullanır.',
    level: 1,
  },

  // ──────────── GEO / AI Search ────────────
  GEO: {
    short: 'Generative Engine Optimization — ChatGPT, Claude, Gemini gibi AI asistanlarının cevaplarında anılmak ve kaynak gösterilmek için yapılan optimizasyon.',
    level: 3,
    link: '/help/glossary#geo',
  },
  AEO: {
    short: 'Answer Engine Optimization — arama motorlarının ve AI asistanlarının doğrudan cevap verdiği yerlerde (öne çıkan snippet, AI cevapları) görünmek için içeriği soru-cevap biçiminde yapılandırma.',
    level: 3,
  },
  Citation: {
    short: 'AI cevabında sitenin adresinin kaynak olarak gösterilmesi. Cevapta yalnız marka adın geçiyorsa bu atıf değil, anılmadır (Brand Mention).',
    level: 2,
  },
  'Brand Mention': {
    short: 'AI cevabında marka adının geçmesi ama site adresinin kaynak gösterilmemesi. RanksUp skorunda atıfın yarısı kadar sayılır (atıf 100, anılma 50 puan).',
    level: 1,
  },
  Heatmap: {
    short: 'Hangi soruda, hangi AI asistanında anıldığını renklerle gösteren tablo (GEO ısı haritası).',
    level: 1,
  },

  // ──────────── Schema / Yapısal Veri ────────────
  'Schema markup': {
    short: 'Sayfanın içeriğini makinelere tanıtan yapısal veri (genellikle JSON-LD): "bu bir makale, yazarı şu, tarihi şu" gibi. Google sayfanın içeriğini anlamak için kullanır; bazı arama sonucu görünümleri de buna dayanır.',
    level: 3,
  },
  'JSON-LD': {
    short: 'Yapısal veri biçimi; Google, sitenin altyapısı uygunsa JSON-LD kullanmayı önerir. Sayfaya <script type="application/ld+json"> etiketiyle eklenir.',
    level: 2,
  },
  'Speakable schema': {
    short: 'Sayfada sesli okunmaya uygun bölümleri işaretleyen yapısal veri. Google\'ın beta özelliğidir: Google Asistan bunu ABD\'de, İngilizce haber içeriği için akıllı hoparlörlerde kullanır.',
    level: 2,
  },
  'FAQ schema': {
    short: 'Sıkça sorulan sorular bölümünü işaretleyen yapısal veri (FAQPage). Google buna dayanan SSS zengin sonucunu 7 Mayıs 2026\'dan itibaren arama sonuçlarında göstermiyor; işaretleme soru-cevap yapısını makinelere yine açıkça tanımlar.',
    level: 2,
  },
  Canonical: {
    short: 'Aynı içerik birden fazla adreste varsa arama motoruna hangisinin asıl (kanonik) adres olduğunu bildiren etiket. Sinyallerin tek adreste toplanmasına yardım eder; Google bunu güçlü bir sinyal sayar ama son kararı kendisi verir.',
    level: 2,
  },
  Hreflang: {
    short: 'Aynı sayfanın farklı dil ya da bölge sürümlerini Google\'a tanıtan işaret; Google\'ın kullanıcıya en uygun sürümü göstermesine yardım eder.',
    level: 2,
  },

  // ──────────── llms.txt + AI Sitemap ────────────
  'llms.txt': {
    short: 'Sitenin AI araçlarına yönelik özetini sunmak için önerilmiş bir dosya standardı taslağı (llmstxt.org, 2024). robots.txt gibi erişim kuralı koymaz; hangi AI asistanının bu dosyayı okuduğu resmî olarak açıklanmış değil.',
    level: 3,
  },
  'llms-full.txt': {
    short: 'Sitenin içeriğinin AI araçları için tek dosyada derlenmiş hali; RanksUp her hafta yeniden oluşturur. llms.txt gibi bir öneridir, okunacağı garanti değildir.',
    level: 3,
  },
  'AI Sitemap': {
    short: 'Standart sitemap.xml\'e ek olarak RanksUp\'ın ürettiği sitemap-ai.xml: her makale adresi için meta açıklamanın ilk 200 karakteri ai:summary alanına yazılır. Standart dışı bir uzantıdır; hangi AI aracının okuduğu açıklanmış değil.',
    level: 3,
  },

  // ──────────── Reklam Hedefleme ────────────
  'Lookalike audience': {
    short: 'Mevcut iyi müşterilerine benzeyen yeni kişileri Meta\'nın bulup hedeflemesi. "Müşterilerime benzeyen kişilere göster" demek.',
    level: 2,
  },
  'Negative keyword': {
    short: 'Reklamının gösterilmemesi gereken aramaları belirleyen kelimeler. "Hosting" için reklam veriyor ama "ücretsiz hosting" aramalarında görünmek istemiyorsan "ücretsiz" kelimesini negatif eklersin.',
    level: 2,
  },
  'A/B Test': {
    short: 'Aynı reklamın ya da sayfanın iki farklı sürümünü karşılaştırıp hangisinin daha iyi sonuç verdiğini ölçme.',
    level: 1,
  },
  Audience: {
    short: 'Reklamın gösterileceği kişilerin tanımı (yaş, ilgi alanı, konum vb.).',
    level: 1,
  },
  'Hedef Kitle': {
    short: 'Reklamın gösterileceği kişilerin tanımı (yaş, ilgi alanı, konum vb.).',
    level: 1,
  },
  Boost: {
    short: 'Organik (ücretsiz) bir gönderiye reklam bütçesi koyarak daha fazla kişiye gösterilmesi. Meta\'nın "Gönderiyi öne çıkar" (Boost Post) özelliği.',
    level: 1,
  },

  // ──────────── RanksUp Ozel Terimler ────────────
  Otopilot: {
    short: 'RanksUp\'ın seçtiğin işleri senin yerine yürütmesi. Site otopilotu konuları takvime koyar ve makale hakkın yettikçe makaleleri üretir; reklam otopilotu (varsayılan kapalı) düşük getirili kampanyayı durdurur, yüksek getirilinin bütçesini artırır.',
    level: 2,
  },
  Brain: {
    short: 'RanksUp\'ın sitenle ilgili tuttuğu AI hafızası: marka tonu, hedef kitle, rakipler, SEO stratejisi.',
    level: 2,
  },
  'Site Brain': {
    short: 'RanksUp\'ın sitenle ilgili tuttuğu AI hafızası: marka tonu, hedef kitle, rakipler, SEO stratejisi.',
    level: 2,
  },
  Persona: {
    short: 'Tipik müşterin (örn: 35 yaşında KOBİ sahibi Mert). AI metinleri ona göre yazar.',
    level: 1,
  },
  'Editor Score': {
    short: 'Üretilen makalenin AI editörden aldığı kalite puanı (9 kategori × 10 = 90 üzerinden). 3 Ağustos 2026\'dan önce üretilen yazılar eski ölçekle 60 üzerinden puanlandı; makale sayfası her yazının kendi ölçeğini gösterir. Editör onayı ve yayın öncesi kalite kapısı geçilmeden ya da engelleyici bir bulgu kaldıysa makale yayına hazır sayılmaz, revizyon bekler.',
    level: 2,
  },
  Tier: {
    short: 'Konu motorunun önceliklendirdiği konular: Tier 1 = hemen yaz, Tier 2 = bu hafta, Tier 3 = planlı (sonra).',
    level: 2,
  },
  Pillar: {
    short: 'Ana konu (örn: "hosting") ve altındaki ilgili alt konular (cluster: "paylaşımlı hosting nedir", "WordPress hosting" vb.). SEO mimarisinin temeli.',
    level: 2,
  },
  Cluster: {
    short: 'Pillar\'ın altındaki ilgili alt konular. Pillar ana çatı, cluster yan kollardır.',
    level: 2,
  },
  'Knowledge Graph': {
    short: 'Google\'ın kişi, kurum ve markalar hakkındaki bilgi tabanı; marka adını arattığında çıkan bilgi panelini besler. Bilgiler web\'deki herkese açık kaynaklardan, lisanslı verilerden ve içerik sahiplerinden derlenir.',
    level: 3,
  },
  'GEO Score': {
    short: '6 başlık üzerinden ağırlıklı AI görünürlük skoru: tarayıcı erişimi · yapısal veri · AI atıfları · otorite · tazelik · çoklu ortam. A+ → F harf notu.',
    level: 2,
  },

  // ──────────── Teknik / Geliştirici ────────────
  MCP: {
    short: 'Model Context Protocol — AI asistanlarını verinin bulunduğu sistemlere bağlamak için açık standart (Anthropic, Kasım 2024). RanksUp\'ın MCP sunucusu Kurumsal planda; Claude Code, Cursor gibi ajanlardan bağlanılır.',
    level: 3,
  },
  Webhook: {
    short: 'Bir olay olduğunda otomatik bildirim gönderilen adres (URL). Örneğin Slack ya da Discord kanalına bildirim düşürmek için kullanılır.',
    level: 2,
  },
  'API Key': {
    short: 'RanksUp\'a programla erişim için kişisel anahtar (Kurumsal plan). Geliştiriciler kendi yazılımlarından RanksUp\'ı kullanabilir.',
    level: 1,
  },
  Scope: {
    short: 'API anahtarının hangi kaynaklara erişebildiği. Örn: articles:read makaleleri yalnız okur; articles:write makale uçlarında değişiklik yapmaya da izin verir. Kapsam seçilmezse anahtar yalnız okuma yetkisi alır.',
    level: 2,
  },

  // ──────────── Paket / İş ────────────
  Affiliate: {
    short: 'Birini RanksUp\'a yönlendirip, kayıt olan kişinin ödemelerinden komisyon kazanma programı (%30, kayıttan sonraki 3 ay).',
    level: 1,
  },
  // Haftalik sinir: denemede de hesap basina 7 gunde 1 olcum (billing/measurement-allowance);
  // "3 calistirma" tek basina "3 olcum" diye okunuyordu. Fiyat karti ve SSS ile ayni ifade.
  TRIAL: {
    short: 'Ücretsiz deneme planı — 2 makale (site eklenince yazılan ilk makale dahil), 3 AI görünürlük çalıştırması (haftada en fazla 1 ölçüm) ve 1 site; makaleler Markdown ZIP olarak indirilir ya da WordPress\'e gönderilir. Takvimin geri kalanı kilitli görünür ve ücretli plan seçince yazılır; diğer yayın hedefleri de o zaman açılır.',
    level: 1,
  },
  Quota: {
    short: 'Aylık makale üretim limitin; plana göre değişir (güncel sayılar fiyatlandırma sayfasında). Her makale, kendin başlatsan da takvimden gelse de, üretime alındığı anda bir kez düşer. Sayaç her takvim ayının başında sıfırlanır; ücretsiz denemedeki 2 makale hakkı sıfırlanmaz.',
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
