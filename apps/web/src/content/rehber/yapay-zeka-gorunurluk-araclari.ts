import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * Rakip bilgilerinin TAMAMI 24.10.2026'da saticinin kendi sayfasindan okundu. Ucuncu taraf
 * fiyatlari (Profound $99/$399, Peec €85-89 gibi) bilincli olarak KULLANILMADI: satici
 * sayfasinda yoksa "sayfada fiyat yok" yazilir. Dogrulanamayan bilgi yazilmaz.
 *
 * RanksUp fiyati plans.ts ile ayni olmak zorunda: apps/api/src/mcp/public-docs.spec.ts
 * bu dosyadaki "Büyüme $N/ay" ifadesini BASE_PLANS ile karsilastirir.
 */
export const article: RehberArticle = {
  slug: 'yapay-zeka-gorunurluk-araclari',
  title: 'Hangi yapay zekâ görünürlük aracı kime uygun? (2026 karşılaştırması)',
  metaTitle: 'Yapay zekâ görünürlük araçları karşılaştırması',
  description:
    'RanksUp, GEON, SEOYEN, Otterly, Peec AI, Profound, Semrush ve Ahrefs Brand Radar: motorlar, başlangıç fiyatı, deneme ve sınırlamalar (24.10.2026).',
  topic: 'Karşılaştırma',
  answer:
    'Tek bir en iyi araç yok; doğru seçim ölçmek istediğin asistanlara, Türkçe ihtiyacına, bütçene ve ölçümden sonra içerik de üretip üretmeyeceğine bağlı. Aşağıdaki tablo sekiz aracı satıcıların kendi sayfalarına göre karşılaştırıyor.',
  quick: [
    'Türkçe ve tek panelde SEO, GEO, ASO ve içerik isteyenler: RanksUp (bizim ürünümüz).',
    'Aynı altı asistanda Türkçe ölçüm ve aksiyon önerisi isteyenler: GEON.',
    'TL ile ödenen bir SEO paketinde AI görünürlük ve içerik isteyenler: SEOYEN.',
    'Düşük bütçeyle global izlemeye başlamak isteyenler: Otterly.AI.',
    'Zaten Semrush ya da Ahrefs kullananlar: kendi AI görünürlük ürünleri.',
    'Çok motorlu kurumsal takip isteyenler: Profound.',
  ],
  sections: [
    {
      id: 'karsilastirma-tablosu',
      h2: 'Araçlar yan yana nasıl görünüyor?',
      blocks: [
        { t: 'p', text: 'Sıralama kaliteye göre değil, “kime uygun?” sorusuna göre. Fiyat yalnızca satıcının kendi sayfasında yazıyorsa verildi; KDV ve kur farkı içerebilir.' },
        {
          t: 'table',
          caption: 'Yapay zekâ görünürlük araçları (satıcı sayfaları, erişim 24.10.2026)',
          head: ['Araç', 'Kime uygun?', 'Başlangıç fiyatı', 'Ölçülen motorlar', 'Temel sınırlama'],
          rows: [
            ['RanksUp (bizim ürünümüz)', 'Türkçe, tek panelde SEO, GEO, ASO ve içerik isteyen KOBİ’ler, uygulama sahipleri, ajanslar', 'Büyüme $149/ay; 14 gün ücretsiz deneme, kart istemez', 'ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek', 'Google AI Bakışı, AI Modu ve Copilot doğrudan ölçülmüyor; hesap başına 7 günde 1 ölçüm'],
            ['GEON', 'Altı asistanda Türkçe ölçüm ve aksiyon önerisi isteyen markalar', 'Sayfada fiyat yok (Growth: 50 prompt/ay, Enterprise: 200 prompt/ay); kayıtta 5 ücretsiz kredi', 'ChatGPT, Gemini, Perplexity, Claude, Grok, DeepSeek', 'Sayfada içerik üretimi, site denetimi ve ASO yer almıyor'],
            ['SEOYEN', 'TL ile ödeyen, SEO paketi içinde AI görünürlük ve içerik isteyenler', 'Bireysel: yıllık 12.470,40 TL peşin (ayda 1.039 TL karşılığı, KDV dahil); 7 günlük deneme 50 TL', 'ChatGPT, Gemini, Claude; ayrıca Google AI Overview takibi', 'Perplexity sayfada geçmiyor; deneme ücretli ve iptal edilmezse yıllık ücret alınıyor'],
            ['Otterly.AI', 'Düşük bütçeyle izlemeye başlamak isteyenler', 'Lite $29/ay (15 prompt)', 'Tüm planlarda ChatGPT, Google AI Overviews, Perplexity, Microsoft Copilot', 'Gemini, Google AI Mode ve Claude ek ücretli'],
            ['Peec AI', 'Prompt takibi ve kaynak analizine odaklanan SEO ekipleri', 'Sayfada fiyat yok', 'ChatGPT, Perplexity, Gemini; menüde AI Mode takibi', 'Fiyat, limit ve deneme süresi sayfa metninde yok'],
            ['Profound', 'Çok motorlu takip ve pazarlama ajanları isteyen kurumsal ekipler', 'Sayfada fiyat yok; 7 günlük ücretsiz deneme (günde 50 prompt)', 'Deneme: ChatGPT, Gemini, Google AI Overviews; Enterprise: 9 motora kadar', 'Liste fiyatı yok; geniş motor kapsamı Enterprise’da'],
            ['Semrush AI Visibility Toolkit', 'Zaten Semrush kullanan ekipler', '$99/ay', 'Sayfada ChatGPT ve Google AI Mode adı geçiyor', 'Ücretsiz deneme yok'],
            ['Ahrefs Brand Radar', 'Zaten Ahrefs kullanan ekipler', 'Custom Prompts €47/ay’dan (sayfa ücretli Lite ve üstü planlara dahil olduğunu da yazıyor); AI Visibility Index €179/ay', 'AI Overviews, AI Mode, ChatGPT, Perplexity, Gemini, Copilot; Claude yalnız Index’te', 'Custom Prompts için ücretli Ahrefs planı gerekiyor'],
          ],
          kaynak: ['ranksup-pricing', 'geon', 'geon-pricing', 'seoyen', 'otterly', 'peec', 'profound', 'semrush', 'ahrefs'],
        },
      ],
    },
    {
      id: 'nasil-secmeliyim',
      h2: 'İhtiyacıma göre hangisine bakmalıyım?',
      blocks: [
        {
          t: 'table',
          caption: 'İhtiyaca göre kısa liste',
          head: ['İhtiyacın', 'Bakılacak araçlar'],
          rows: [
            ['Türkçe arayüz ve destek', 'RanksUp, GEON, SEOYEN'],
            ['Grok ve DeepSeek’te ölçüm', 'RanksUp, GEON; Profound Enterprise’da DeepSeek'],
            ['Google AI Overviews takibi', 'Otterly.AI, Profound, Ahrefs Brand Radar, SEOYEN'],
            ['Ölçümle birlikte içerik üretimi ve yayın', 'RanksUp, SEOYEN'],
            ['Mobil uygulama (ASO) ile AI görünürlüğü birlikte', 'RanksUp'],
            ['Mevcut SEO aracına ek', 'Semrush AI Visibility Toolkit, Ahrefs Brand Radar'],
          ],
          kaynak: ['ranksup-pricing', 'geon', 'seoyen', 'otterly', 'profound', 'ahrefs', 'semrush'],
        },
      ],
    },
    {
      id: 'ranksup',
      h2: 'RanksUp kime uygun, sınırları ne?',
      blocks: [
        {
          t: 'callout',
          title: 'Açıklama',
          text: 'RanksUp bizim ürünümüz. Bu yüzden onun için de sınırlamaları, diğer araçlar kadar açık yazdık.',
        },
        {
          t: 'ul',
          items: [
            '**Güçlü yanları:** ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’te ölçüm; 14 kontrollü site SEO/GEO denetimi; ASO, Profesyonel ve üstü planlarda App Prompt Lab; yapay zekâ ile makale üretimi ve 14 yayın hedefi; Profesyonel ve üstü planlarda kaybedilen sorudan içerik üretip yeniden ölçen kapalı döngü; Türkçe arayüz ve destek, PayTR ile Türk lirası ödeme.',
            '**Sınırlamaları:** Google AI Bakışı, AI Modu ve Copilot’u doğrudan ölçmez (AI Bakışı için Search Console verisi içe aktarılabilir). Ölçüm hesap başına 7 günde birdir. Grok ve DeepSeek ölçümünde web araması yoktur. Ücretli planlar Büyüme $149/ay’dan başlar; yalnız ölçüm isteyen biri için daha ucuz seçenekler var.',
          ],
          kaynak: ['ranksup-pricing', 'ranksup-ai-visibility'],
        },
      ],
    },
    {
      id: 'geon',
      h2: 'GEON kime uygun, sınırları ne?',
      blocks: [
        {
          t: 'ul',
          items: [
            '**Güçlü yanları:** Kendini “Türkiye’nin ilk GEO platformu” olarak tanıtıyor. RanksUp ile aynı altı asistanı ölçüyor. Türkçe arayüz, Türkçe prompt analizi ve Türkçe destek; etki skoruyla önceliklendirilmiş aksiyon önerileri, haftalık ve aylık e-posta raporu, rakip analizi ve Slack entegrasyonu. Planlarda günlük tarama ve rapor yazıyor. Kayıtta 5 ücretsiz kredi (5 prompt taraması) veriyor.',
            '**Sınırlamaları:** Sayfada plan tutarı yok. İçerik üretimi, site denetimi ve ASO sayfada yer almıyor. Microsoft Copilot yol haritasında, henüz desteklenmiyor.',
          ],
          kaynak: ['geon', 'geon-pricing'],
        },
      ],
    },
    {
      id: 'seoyen',
      h2: 'SEOYEN kime uygun, sınırları ne?',
      blocks: [
        {
          t: 'ul',
          items: [
            '**Güçlü yanları:** Türkçe bir SEO platformu; sıra takibi, site denetimi (245 otomatik kontrol), backlink analizi ve rakip kıyaslamayı tek panelde sunuyor. 2.000–5.000+ kelimelik yapay zekâ makalesi ve WordPress’e tek tıkla yayın tanıtıyor. AI görünürlük takibi giriş paketinden başlıyor (ayda 100 sorgu). Fiyatlar TL; verilerin Türkiye’deki sunucularda saklandığını yazıyor.',
            '**Sınırlamaları:** AI görünürlükte sayfada ChatGPT, Gemini, Claude ve Google AI Overview geçiyor; Perplexity, Grok ve DeepSeek geçmiyor. 7 günlük deneme 50 TL ve iptal edilmezse deneme sonunda yıllık ücret peşin alınıyor (Bireysel 12.470,40 TL). ASO sayfada yer almıyor.',
          ],
          kaynak: ['seoyen'],
        },
      ],
    },
    {
      id: 'otterly',
      h2: 'Otterly.AI kime uygun, sınırları ne?',
      blocks: [
        {
          t: 'ul',
          items: [
            '**Güçlü yanları:** Bu listede satıcı sayfasında yayımlanmış en düşük başlangıç fiyatı: Lite $29/ay (15 prompt); Standard $189/ay (100 prompt), Premium $489/ay (400 prompt). Tüm planlarda ChatGPT, Google AI Overviews, Perplexity ve Microsoft Copilot var. Yıllık ödemede %15 indirim.',
            '**Sınırlamaları:** Gemini, Google AI Mode ve Claude ek ücretli. Lite planda ek prompt alınamıyor. Planlarda “sınırsız ülke ve dil” yazıyor ama Türkçe adı geçmiyor. Ücretsiz deneme var, süresi yazmıyor.',
          ],
          kaynak: ['otterly'],
        },
      ],
    },
    {
      id: 'peec-ai',
      h2: 'Peec AI kime uygun, sınırları ne?',
      blocks: [
        {
          t: 'ul',
          items: [
            '**Güçlü yanları:** Prompt yönetimi (etiketleme, önerilen promptlar ve arama hacmi), rakip kıyaslaması, alıntılanan kaynak alan adlarını gösteren kaynak analizi ve öneriler. MCP sunucusu, API, CSV dışa aktarma ve Looker Studio bağlayıcısı var. ChatGPT, Perplexity ve Gemini adı geçiyor; menüde AI Mode takibi var.',
            '**Sınırlamaları:** Fiyat sayfasında tutar, prompt limiti ve plan maddeleri metin olarak yok. Deneme butonu var ama süresi ve koşulları yazmıyor. Dil desteği belirtilmiyor.',
          ],
          kaynak: ['peec', 'peec-home'],
        },
      ],
    },
    {
      id: 'profound',
      h2: 'Profound kime uygun, sınırları ne?',
      blocks: [
        {
          t: 'ul',
          items: [
            '**Güçlü yanları:** Enterprise planında 9 motora kadar takip: ChatGPT, Perplexity, Google AI Mode, Gemini, Microsoft Copilot, DeepSeek, Claude, Google AI Overviews ve Exa Search. Kampanya araştırması ve içerik yazımını da kapsayan pazarlama ajanları, ChatGPT Shopping takibi (Enterprise), sınırsız kullanıcı. 7 günlük ücretsiz deneme.',
            '**Sınırlamaları:** Sayfada liste fiyatı yok; Enterprise özel fiyatlı. Deneme günde 50 prompt, 1 dil ve 1 bölge ile ChatGPT, Gemini ve Google AI Overviews’la sınırlı.',
          ],
          kaynak: ['profound'],
        },
      ],
    },
    {
      id: 'semrush',
      h2: 'Semrush AI Visibility Toolkit kime uygun, sınırları ne?',
      blocks: [
        {
          t: 'ul',
          items: [
            '**Güçlü yanları:** $99/ay. Görünürlük skoru, rakip araştırması, hacim, zorluk ve niyet bilgisiyle prompt araştırması, ses payı ve duygu içeren marka performansı, günlük prompt takibi ve yapay zekâ tarayıcılarını engelleyen sorunları arayan site denetimi. Mevcut yıllık Semrush aboneliğine eklenebiliyor.',
            '**Sınırlamaları:** Ücretsiz deneme yok. Sayfada adı geçen platformlar ChatGPT ve Google AI Mode.',
          ],
          kaynak: ['semrush'],
        },
      ],
    },
    {
      id: 'ahrefs-brand-radar',
      h2: 'Ahrefs Brand Radar kime uygun, sınırları ne?',
      blocks: [
        {
          t: 'ul',
          items: [
            '**Güçlü yanları:** AI Overviews, AI Mode, ChatGPT, Perplexity, Gemini ve Copilot; AI Visibility Index’te Claude da var. Index, 496 milyonu aşkın promptla hazır bir görünürlük verisi sunuyor. Yapay zekâ trafiği ve bot ziyaretlerini gösteren AI Analytics (bot analitiği beta süresince ücretsiz) ve ücretsiz bir AI Visibility Checker var.',
            '**Sınırlamaları:** Custom Prompts ücretli Ahrefs Lite ve üstü planlara dahil, Lite’ta 5 prompt; sayfa ayrıca €47/ay’dan başlayan bir Custom Prompts fiyatı gösteriyor. AI Visibility Index €179/ay’dan başlıyor. Claude yalnız Index’te.',
          ],
          kaynak: ['ahrefs'],
        },
      ],
    },
    {
      id: 'yontem',
      h2: 'Bu karşılaştırmayı nasıl hazırladık?',
      blocks: [
        {
          t: 'ul',
          items: [
            'Her bilgi 24 Ekim 2026’da satıcının kendi sayfasından okundu. Kaynaklar sayfanın sonunda, erişim tarihiyle.',
            'Fiyat yalnızca satıcı sayfasında yazıyorsa verildi. Üçüncü taraf sitelerdeki fiyatları kullanmadık; yoksa “sayfada fiyat yok” yazdık.',
            'Satıcı sayfasında doğrulayamadığımız bir özelliği “yok” diye yazmadık; “sayfada yer almıyor” dedik.',
            'Ölçütler: ölçülen asistanlar, Türkçe desteği, içerik üretimi, ASO, deneme koşulu, başlangıç fiyatı ve temel sınırlama.',
            'Araçları kendi hesabımızla tek tek test etmedik; bu bir ürün sayfası karşılaştırmasıdır.',
            'RanksUp bizim ürünümüz. Sıralamayı “en iyi”ye göre değil, “kime uygun”a göre yaptık.',
          ],
        },
        { t: 'p', text: 'Ürün özelinde daha ayrıntılı bir tablo için [karşılaştırma sayfamıza](/compare) bakabilirsin.' },
      ],
    },
  ],
  faq: [
    {
      q: 'En ucuz yapay zekâ görünürlük aracı hangisi?',
      a: 'Bu listede satıcı sayfasında yayımlanmış en düşük başlangıç fiyatı Otterly.AI’nin Lite planında; tutar karşılaştırma tablosunda kaynağıyla birlikte yer alıyor. Ucuz planlarda prompt sayısı ve motor kapsamı dar olabilir; ikisine birlikte bak.',
    },
    {
      q: 'Türkçe destekleyen araçlar hangileri?',
      a: 'Bu listede arayüzü Türkçe olanlar RanksUp, GEON ve SEOYEN. GEON ayrıca Türkçe prompt analizi ve Türkçe destek sunduğunu yazıyor. Diğer araçların sayfalarında Türkçe adı açıkça geçmiyor.',
    },
    {
      q: 'Bu karşılaştırma tarafsız mı?',
      a: 'RanksUp bizim ürünümüz; bu yüzden tam tarafsız olduğumuzu iddia etmiyoruz. Bunu dengelemek için her bilgiyi satıcının kendi sayfasından aldık, tarihini yazdık, doğrulayamadığımız bilgiyi koymadık ve RanksUp’ın sınırlamalarını da listeledik.',
    },
    {
      q: 'Bu araçlar Google AI Bakışı’nı ölçüyor mu?',
      a: 'Bazıları ölçüyor. Satıcı sayfalarına göre Otterly.AI, Profound, Ahrefs Brand Radar ve SEOYEN Google AI Overviews takibi sunuyor. RanksUp AI Bakışı’nı doğrudan ölçmüyor; GEON’un sayfasında AI Bakışı yer almıyor.',
    },
    {
      q: 'Ücretsiz deneme sunan araçlar hangileri?',
      a: 'RanksUp 14 gün ücretsiz deneme veriyor ve kart istemiyor. Profound 7 günlük ücretsiz deneme, GEON kayıtta 5 ücretsiz kredi sunuyor. Otterly.AI deneme sunuyor ama süresini yazmıyor. SEOYEN’in 7 günlük denemesi ücretli. Semrush AI Visibility Toolkit’te deneme yok.',
    },
    {
      q: 'Ölçüm aracı mı almalıyım, ajansla mı çalışmalıyım?',
      a: 'Ölçüm aracı hangi sorularda görünmediğini gösterir; düzeltmeyi senin ekibin yapar. Ajans hem ölçer hem uygular. İçerik üretecek bir ekibin yoksa bu fark önemli olabilir.',
    },
    {
      q: 'Bu tablo ne sıklıkla güncelleniyor?',
      a: 'Bilgiler 24 Ekim 2026’da kontrol edildi. Fiyatlar ve özellikler sık değişiyor; karar vermeden önce satıcının güncel sayfasına bak. Sayfanın üstündeki son güncelleme satırı son kontrol tarihini gösterir.',
    },
  ],
  sources: [SRC.ranksupPricing, SRC.ranksupAiVisibility, SRC.geon, SRC.geonPricing, SRC.seoyen, SRC.otterly, SRC.peec, SRC.peecHome, SRC.profound, SRC.semrush, SRC.ahrefs],
  related: ['chatgpt-markam-gorunuyor-mu', 'geo-nedir', 'mobil-uygulama-geo'],
  published: '2026-10-24',
  schemaType: 'Article',
};
