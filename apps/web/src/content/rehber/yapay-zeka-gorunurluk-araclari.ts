import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * Rakip bilgilerinin TAMAMI 24.10.2026'da (ikinci tur) saticinin kendi sayfasindan, JS ile render edilmis haliyle
 * okundu (verbatim alintilar sources.ts'te). 24.10'daki ilk surumde GEON ve Peec icin "sayfada fiyat
 * yok" yaziyordu: fiyatlar JS ile basiliyor, statik HTML'de gorunmuyordu — duzeltildi. Ucuncu taraf
 * fiyatlari kullanilmaz; dogrudan okunamayan bilgi (or. Profound Agency Growth taban fiyati) yazilmaz.
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
        { t: 'p', text: 'Sıralama kaliteye göre değil, “kime uygun?” sorusuna göre. Fiyatlar satıcının kendi sayfasında gösterildiği gibi; para birimi, vergi ve faturalama dönemi araçtan araca değişiyor, bu yüzden tabloda ayrıca yazdık.' },
        {
          t: 'table',
          caption: 'Yapay zekâ görünürlük araçları (satıcı sayfaları, erişim 24.10.2026)',
          head: ['Araç', 'Kime uygun?', 'Başlangıç fiyatı (satıcı sayfası)', 'Ölçülen motorlar', 'Temel sınırlama'],
          rows: [
            ['RanksUp (bizim ürünümüz)', 'Türkçe, tek panelde SEO, GEO, ASO ve içerik isteyen KOBİ’ler, uygulama sahipleri, ajanslar', 'Büyüme $149/ay, KDV dahil (TL tutarı ödeme günü kuruyla); 14 gün ücretsiz deneme, kart istemez', 'ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek', 'Google AI Bakışı, AI Modu ve Copilot doğrudan ölçülmüyor; hesap başına 7 günde 1 ölçüm'],
            ['GEON', 'Altı asistanda Türkçe ölçüm ve aksiyon önerisi isteyen markalar', 'Growth $99/ay (ilk ay sınırlı süre $39), 50 prompt/ay; Enterprise fiyat kartında $259/ay (sitedeki bir SSS’de “custom”), 200 prompt/ay; kayıtta 5 ücretsiz kredi', 'ChatGPT, Perplexity, Claude, Gemini, Grok, DeepSeek', 'Makale üretimi, yayın ve ASO sayfada yer almıyor; Google AI Bakışı takip listesinde yok'],
            ['SEOYEN', 'TL ile ödeyen, SEO paketi içinde AI görünürlük ve içerik isteyenler', 'Bireysel aylık 1.299 TL ya da yıllık 12.470,40 TL peşin (ayda 1.039 TL karşılığı); fiyatlar %20 KDV dahil; 7 günlük deneme 50 TL', 'ChatGPT, Gemini, Claude; ayrıca Google AI Overview takibi', 'Perplexity, Grok ve DeepSeek sayfada geçmiyor; deneme ücretli ve dönem seçilmezse yıllık dönemle devam ediyor'],
            ['Otterly.AI', 'Düşük bütçeyle izlemeye başlamak isteyenler', 'Lite $29/ay aylık faturada (yıllık faturada aylık $25), 15 prompt; vergi hariç', 'Tüm planlarda ChatGPT, Google AI Overviews, Perplexity, Microsoft Copilot', 'Claude, Gemini ve Google AI Mode ek ücretli'],
            ['Peec AI', 'Prompt takibi ve kaynak analizine odaklanan SEO ekipleri', 'Starter $95/ay, 50 prompt, 3 model seçimi (erişimimizde dolar gösterildi)', 'Starter’da seçilebilenler: ChatGPT, AI Mode, AI Overviews, Microsoft Copilot, Gemini, Naver AI', 'Plan başına 3 model; Perplexity ve Claude Enterprise listesinde; deneme süresi yazmıyor'],
            ['Profound', 'Çok motorlu takip ve pazarlama ajanları isteyen kurumsal ekipler ve ajanslar', 'Markalar için liste fiyatı yok (ücretsiz deneme ve özel fiyatlı Enterprise); ajans planında tam müşteri çalışma alanı ek olarak $399/ay', 'Deneme: ChatGPT, Gemini, Google AI Overviews; Enterprise: 9 motora kadar', 'Marka planlarında liste fiyatı yok; geniş motor kapsamı Enterprise’da'],
            ['Semrush AI Visibility Toolkit', 'Zaten Semrush kullanan ekipler', '$99/ay (25 prompt takibi dahil)', 'Bilgi bankasında ChatGPT ve Google AI Mode adı geçiyor', 'Ücretsiz deneme yok'],
            ['Ahrefs Brand Radar', 'Zaten Ahrefs kullanan ekipler', 'Ücretli Lite ve üstü planlara Custom Prompts dahil (Lite’ta 5 prompt); ek Custom Prompts paketi $50/ay’dan, AI Visibility Index $199/ay’dan (ABD’den erişimde dolar; bölgeye göre farklı para birimi gösterilebilir)', 'Index: AI Overviews, AI Mode, ChatGPT, Perplexity, Gemini, Copilot; Claude yalnız Custom Prompts’ta', 'Custom Prompts için ücretli Ahrefs planı gerekiyor; Claude her güncellemede 8 kontrol harcıyor'],
          ],
          kaynak: ['ranksup-pricing', 'ranksup-terms', 'geon', 'seoyen', 'seoyen-pricing', 'otterly', 'peec', 'profound', 'semrush', 'ahrefs'],
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
            ['Grok ve DeepSeek’te ölçüm', 'RanksUp, GEON; Peec AI Enterprise’da Grok ve DeepSeek; Profound Enterprise’da DeepSeek'],
            ['Google AI Overviews takibi', 'Otterly.AI, Peec AI, Profound, Ahrefs Brand Radar, SEOYEN'],
            ['Ölçümle birlikte içerik üretimi ve yayın', 'RanksUp, SEOYEN'],
            ['Mobil uygulama (ASO) ile AI görünürlüğü birlikte', 'RanksUp'],
            ['Mevcut SEO aracına ek', 'Semrush AI Visibility Toolkit, Ahrefs Brand Radar'],
          ],
          kaynak: ['ranksup-pricing', 'geon', 'seoyen', 'otterly', 'peec', 'profound', 'ahrefs', 'semrush'],
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
            '**Sınırlamaları:** Google AI Bakışı, AI Modu ve Copilot’u doğrudan ölçmez (AI Bakışı için Search Console verisi içe aktarılabilir). Ölçüm hesap başına 7 günde birdir. Grok ve DeepSeek ölçümünde web araması yoktur. Ücretli planlar Büyüme $149/ay’dan başlar (KDV dahil); yalnız ölçüm isteyen biri için daha ucuz seçenekler var.',
          ],
          kaynak: ['ranksup-pricing', 'ranksup-terms', 'ranksup-ai-visibility'],
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
            '**Güçlü yanları:** Kendini “Türkiye’nin ilk GEO platformu” olarak tanıtıyor. RanksUp ile aynı altı asistanı ölçüyor. Türkçe arayüz, Türkçe prompt analizi ve Türkçe destek; etki skoruyla önceliklendirilmiş aksiyon önerileri, eksik alıntıları içerik taslağı, SSS güncellemesi ve karşılaştırma sayfası önerisine çeviren öneriler, rakip analizi ve günlük tarama. Kayıt gerektirmeyen ücretsiz bir “AI hazırlık analizi” robots.txt erişimini, sitemap’i, yapılandırılmış veriyi ve içerik derinliğini kontrol ediyor. Kayıtta 5 ücretsiz kredi (5 prompt taraması) veriyor.',
            '**Sınırlamaları:** Growth $99/ay (ilk ay sınırlı süre $39) ve 50 prompt/ay. Enterprise için fiyat kartında $259/ay yazıyor, sitedeki bir SSS ise “custom” diyor. Makale üretimi, yayın ve ASO sayfada yer almıyor. Google AI Bakışı takip listesinde yok; Microsoft Copilot yol haritasında.',
          ],
          kaynak: ['geon'],
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
            '**Güçlü yanları:** Türkçe bir SEO platformu; sıra takibi, site denetimi (245 otomatik kontrol), backlink analizi ve rakip kıyaslamayı tek panelde sunuyor. Yapay zekâ ile içerik üretimi ve WordPress’e tek tıkla yayın var. AI görünürlük takibi Bireysel paketten başlıyor (ayda 100 AI görünürlük sorgusu). Fiyatlar TL ve %20 KDV dahil; ödemeler iyzico üzerinden. Verilerin Türkiye’deki sunucularda saklandığını yazıyor.',
            '**Sınırlamaları:** AI görünürlükte sayfada ChatGPT, Gemini, Claude ve Google AI Overview geçiyor; Perplexity, Grok ve DeepSeek geçmiyor. 7 günlük deneme 50 TL; süre dolunca abonelik seçilen dönemle (aylık ya da yıllık) devam ediyor, dönem seçilmediyse varsayılan yıllık. SEOYEN çekimden önce tarih ve tutarı e-postayla hatırlattığını yazıyor. ASO sayfada yer almıyor.',
          ],
          kaynak: ['seoyen', 'seoyen-pricing'],
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
            '**Güçlü yanları:** Yalnız AI görünürlüğüne odaklanan araçlar içinde, satıcı sayfasında dolar cinsinden yayımlanmış en düşük aylık fiyat bu listede Otterly.AI’de: Lite $29/ay aylık faturada (15 prompt); Standard $189/ay (100 prompt), Premium $489/ay (400 prompt). Yıllık faturada %15 indirimli (Lite aylık $25). Fiyatlar vergi hariç dolar. Tüm planlarda ChatGPT, Google AI Overviews, Perplexity ve Microsoft Copilot var.',
            '**Sınırlamaları:** Gemini, Google AI Mode ve Claude ek ücretli. Lite planda ek prompt alınamıyor. Türkçe adı açıkça geçmiyor. Ücretsiz deneme var, süresi yazmıyor.',
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
            '**Güçlü yanları:** Prompt yönetimi (etiketleme, önerilen promptlar ve arama hacmi), rakip kıyaslaması, alıntılanan kaynak alan adlarını gösteren kaynak analizi ve öneriler. MCP sunucusu, API, CSV dışa aktarma ve Looker Studio bağlayıcısı var. Ülke ve dil için ek ücret alınmadığını yazıyor. Starter $95/ay (50 prompt), Pro $245/ay (150 prompt), Advanced $495/ay (350 prompt); erişimimizde fiyatlar dolar olarak gösterildi.',
            '**Sınırlamaları:** Her planda 3 model seçiliyor. Starter’da seçilebilen modeller ChatGPT, AI Mode, AI Overviews, Microsoft Copilot, Gemini ve Naver AI; Perplexity ve Claude Enterprise listesinde. Ücretsiz deneme butonu var ama süresi yazmıyor.',
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
            '**Sınırlamaları:** Markalar için liste fiyatı yok: ücretsiz deneme ve özel fiyatlı Enterprise var. Ajanslar için self-serve Agency Growth planında tam müşteri çalışma alanı ek olarak $399/ay. Deneme 7 gün, günde 50 prompt, 1 dil ve 1 bölge ile ChatGPT, Gemini ve Google AI Overviews’la sınırlı.',
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
            '**Güçlü yanları:** $99/ay, 25 prompt takibi dahil. Görünürlük skoru, rakip araştırması, hacim, zorluk ve niyet bilgisiyle prompt araştırması, ses payı ve duygu içeren marka performansı, günlük prompt takibi ve yapay zekâ tarayıcılarını engelleyen sorunları arayan site denetimi. Mevcut yıllık Semrush aboneliğine eklenebiliyor.',
            '**Sınırlamaları:** Ücretsiz deneme yok. Bilgi bankasında adı geçen platformlar ChatGPT ve Google AI Mode.',
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
            '**Güçlü yanları:** AI Visibility Index, 496 milyon prompt üzerinden AI Overviews, AI Mode, ChatGPT, Perplexity, Gemini ve Copilot’ta hazır görünürlük verisi sunuyor; kurulum gerektirmiyor. Custom Prompts bunlara ek olarak Claude’u da destekliyor. Yapay zekâ trafiği ve bot ziyaretlerini gösteren AI Analytics ve ücretsiz bir AI Visibility Checker var.',
            '**Sınırlamaları:** Custom Prompts ücretli Ahrefs Lite ve üstü planlara dahil, Lite’ta 5 prompt; ek paketler $50/ay’dan. AI Visibility Index $199/ay’dan başlıyor. Fiyatları ABD’den erişimde dolar olarak gördük; bölgeye göre farklı para birimi gösterilebilir. Claude her güncellemede 8 kontrol harcıyor.',
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
            'Her bilgi 24 Ekim 2026’da satıcının kendi sayfasından, tarayıcıda görünen haliyle okundu. Kaynaklar sayfanın sonunda, erişim tarihiyle.',
            'Fiyat yalnızca satıcı sayfasında gösteriliyorsa verildi; para birimi, vergi ve faturalama dönemi sayfada nasıl yazıyorsa öyle. Üçüncü taraf sitelerdeki fiyatları kullanmadık.',
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
      a: 'Ölçüte bağlı. Yalnız AI görünürlüğüne odaklanan araçlar içinde, aylık faturalı ve satıcı sayfasında dolar cinsinden yayımlanmış en düşük başlangıç fiyatı Otterly.AI’nin Lite planında. SEOYEN ise genel bir SEO paketi; TL ile ve KDV dahil fiyatlanıyor, Bireysel pakete ayda 100 AI görünürlük sorgusu dahil. Tutarlar karşılaştırma tablosunda kaynağıyla birlikte; ucuz planlarda prompt sayısı ve motor kapsamı dar olabilir.',
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
      a: 'Bazıları ölçüyor. Satıcı sayfalarına göre Otterly.AI, Peec AI, Profound, Ahrefs Brand Radar ve SEOYEN Google AI Overviews takibi sunuyor. RanksUp AI Bakışı’nı doğrudan ölçmüyor; GEON’un takip listesinde AI Bakışı yok.',
    },
    {
      q: 'Ücretsiz deneme sunan araçlar hangileri?',
      a: 'RanksUp 14 gün ücretsiz deneme veriyor ve kart istemiyor. Profound 7 günlük ücretsiz deneme, GEON kayıtta 5 ücretsiz kredi sunuyor. Otterly.AI ve Peec AI deneme sunuyor ama süresini yazmıyor. SEOYEN’in 7 günlük denemesi ücretli. Semrush AI Visibility Toolkit’te deneme yok.',
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
  sources: [SRC.ranksupPricing, SRC.ranksupTerms, SRC.ranksupAiVisibility, SRC.geon, SRC.seoyen, SRC.seoyenPricing, SRC.otterly, SRC.peec, SRC.peecHome, SRC.profound, SRC.semrush, SRC.ahrefs],
  related: ['chatgpt-markam-gorunuyor-mu', 'geo-nedir', 'mobil-uygulama-geo'],
  published: '2026-10-24',
  schemaType: 'Article',
};
