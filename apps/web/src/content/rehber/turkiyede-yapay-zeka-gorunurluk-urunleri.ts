import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * 14.11.2026 (sahip: "hepsini yap"). Hedef soru: "Türkiye'de markaların AI görünürlüğünü ölçen araçlar
 * hangileri?" — 25.10 ve 10.11 ölçümlerinde asistanlar bu soruda rakiplerin "Türkiye'de … araçları"
 * liste sayfalarını kaynak gösterdi; bizde Türkiye'ye özel bir sayfa yoktu.
 *
 * HER SATIR saticinin kendi sayfasindan, headless Chrome ile render edilmis haliyle 14.11.2026'da
 * okundu (verbatim alintilar sources.ts'te). SEOYEN'in iki sayfasi 14.11'de bastan sona yeniden okundu.
 * GEON 24.10.2026 kaynagi; fiyat kartlari 14.11'de yeniden kontrol edildi, ayniydi. GEON'un tirnak
 * icindeki tanimi GORUNEN metinden ("AI Görünürlük Platformu — Herkes için GEO"); statik <title>'daki
 * "AI Arama Görünürlük Platformu" kullanilmadi (bagimsiz inceleme, 14.11). Dogrulanamayan bilgi yazilmadi:
 *  - "Türkiye'nin ilk" iddialari (GEON, Sheltron, AIWATCH ayni iddiayi yaziyor) ALINMADI.
 *  - Visby'nin sirket merkezi, AIWATCH'in deneme kosulu (kapali SSS cevabi) YAZILMADI.
 *  - Tirnak icindeki tanimlar saticinin kendi ifadesi.
 *
 * rankzupAI ≠ RanksUp: 10.11 olcumunde cevaplarda "rankzup.ai" 5 kez gecti; ad benzerligi icin ayri
 * bolum var (iki ayri sirket, iki ayri alan adi).
 *
 * RanksUp fiyati plans.ts ile ayni (public-docs.spec.ts "<plan adi> $N/ay" denetimi). Yazilim icin
 * "araç" sozcugu kullanilmaz (sahip tercihi); alicinin arama terimi yalniz tirnak icinde anilir.
 * Sira: RanksUp (bizim, acikca yazili) basta, digerleri alfabetik — kalite sirasi DEGIL.
 */
export const article: RehberArticle = {
  slug: 'turkiyede-yapay-zeka-gorunurluk-urunleri',
  title: 'Türkiye’de yapay zekâ görünürlüğünü ölçen ürünler hangileri?',
  metaTitle: 'Türkiye’de yapay zekâ görünürlük ürünleri (2026)',
  description:
    'Türkiye’de satılan yapay zekâ görünürlük ürünleri: RanksUp, AIWATCH, GEON, Geovium, rankzupAI, SEOYEN, Visby, Yanıt IO. Ölçülen asistanlar, fiyat, deneme.',
  topic: 'Türkiye',
  answer:
    'Türkiye’de markaların yapay zekâ cevaplarındaki görünürlüğünü ölçen ve Türkçe sitesi olan sekiz yazılım bulduk: RanksUp, AIWATCH, GEON, Geovium, rankzupAI, SEOYEN, Visby ve Yanıt IO. Ölçtükleri asistanlar, fiyatları ve deneme koşulları farklı; aşağıdaki tablo hepsini satıcıların kendi sayfalarına göre karşılaştırıyor.',
  quick: [
    'Site denetimi, yapay zekâ görünürlük ölçümü, içerik ve ASO’yu tek panelde isteyenler: RanksUp (bizim ürünümüz).',
    'TL fiyatla yalnız yapay zekâ görünürlüğünü ölçmek isteyenler: Geovium, rankzupAI, Yanıt IO.',
    'TL ile ödenen bir SEO paketinin içinde isteyenler: SEOYEN.',
    'Altı asistanda ölçüm ve aksiyon önerisi isteyenler: GEON.',
    'Google AI Overviews takibi isteyenler: AIWATCH, rankzupAI, SEOYEN, Visby.',
    'Fiyatı teklifle verilen seçenek: AIWATCH.',
    'Ölçümü kendisi yapıp rapor teslim eden ya da danışmanlıkla sunan şirketler de var: Zekabi, Sheltron.',
  ],
  sections: [
    {
      id: 'urun-tablosu',
      h2: 'Türkiye’de hangi ürünler var, ne ölçüyorlar?',
      blocks: [
        {
          t: 'p',
          text: 'Listeye, sitesi Türkçe olan ve markaların yapay zekâ cevaplarındaki görünürlüğünü ölçtüğünü yazan yazılımları aldık. RanksUp bizim ürünümüz; onu başa yazdık, diğerleri alfabetik sırada. Sıralama kaliteye göre değil. Fiyatlar satıcının sayfasında gösterildiği gibi; para birimi ve KDV üründen ürüne değişiyor.',
        },
        {
          t: 'table',
          caption: 'Türkiye’de satılan yapay zekâ görünürlük ürünleri (satıcı sayfaları; erişim tarihleri kaynak satırında)',
          head: ['Ürün', 'Kendini nasıl tanımlıyor?', 'Ölçtüğünü yazdığı asistanlar', 'Başlangıç fiyatı (satıcı sayfası)', 'Deneme'],
          rows: [
            ['RanksUp (bizim ürünümüz)', 'Site denetimi, yapay zekâ görünürlük ölçümü, içerik ve ASO’yu tek panelde sunan platform', 'Başlangıç’ta ChatGPT, Gemini, Claude, Perplexity; Profesyonel ve üstünde ayrıca Grok, DeepSeek', 'Başlangıç $99/ay, KDV dahil (TL tutarı ödeme günü kuruyla)', '14 gün ücretsiz, kart istemez'],
            ['AIWATCH', '“Türkiye pazarı için geliştirilen, kanıt odaklı AI görünürlük platformu”', 'Ana sayfada ChatGPT, Gemini ve “kurulumunuzda açık diğer AI motorları”; hakkımızda sayfasında Claude, Copilot, Perplexity, DeepSeek, Grok ve Google AI Overviews’u da sayarak 12 motor', 'Fiyat yayımlanmıyor; teklifle', 'Ücretsiz site taraması; self-servis başlangıç hesabı açılabiliyor'],
            ['GEON', '“AI Görünürlük Platformu”', 'ChatGPT, Perplexity, Gemini, Claude, Grok, DeepSeek', 'Growth $99/ay (ilk ay sınırlı süre $39), 50 prompt/ay', 'Kayıtta 5 ücretsiz kredi (5 prompt taraması)'],
            ['Geovium', '“GEO platformu”', 'ChatGPT, Gemini, Claude, Perplexity, Grok', 'Starter 2.990 TL + KDV/ay, 25 takip edilen soru', '14 gün ücretsiz, kart gerekmez'],
            ['rankzupAI', '“AI görünürlük (GEO) platformu”', 'Her pakette Google AI Overviews, ChatGPT, Gemini, Perplexity; Claude, Grok ve Google AI Mode ek ücretli; hepsiyle birlikte sayı yediye çıkıyor', 'Starter 1.749 TL/ay + KDV, 25 izlenen sorgu', '7 gün ücretsiz, kart gerekmez'],
            ['SEOYEN', 'SEO platformu; yapay zekâ görünürlüğü paketin bir parçası', 'ChatGPT, Gemini, Claude; ayrıca Google AI Overview takibi', 'Bireysel aylık 1.299 TL, KDV dahil; ayda 100 AI görünürlük sorgusu, 20 takip edilen AI prompt', '7 günlük deneme 50 TL'],
            ['Visby', '“ChatGPT, Claude ve Gemini için AI Görünürlük Platformu”', 'ChatGPT, Claude, Gemini ve Google AI Overviews içinden plan başına üç motor', 'Starter $79/ay, 15 takip edilen prompt, ayda 45 AI yanıtı analizi', 'Starter’da ücretsiz deneme; süresi yazmıyor'],
            ['Yanıt IO', '“Türkiye merkezli bir yapay zekâ görünürlük (GEO) platformu”', 'ChatGPT, Claude, Gemini; Perplexity beta', '2.499 TL/ay, KDV dahil (200 soru); sayfasına göre ödeme henüz açılmadı', 'Ödeme açılana kadar ücretsiz erken erişim (10 soru), kart istenmez'],
          ],
          not: 'GEON fiyatları 14 Kasım 2026’da yeniden kontrol edildi; 24 Ekim’deki tutarlarla aynıydı.',
          kaynak: ['ranksup-pricing', 'ranksup-terms', 'aiwatch', 'aiwatch-about', 'geon', 'geovium', 'rankzup', 'rankzup-pricing', 'seoyen', 'seoyen-pricing', 'visby', 'visby-pricing', 'yanit', 'yanit-pricing'],
        },
        {
          t: 'p',
          text: 'Bu ürünler “AI görünürlük aracı”, “GEO aracı” ya da “yapay zekâ arama izleme yazılımı” adlarıyla da aranıyor; bu adların hepsi aynı işi anlatır: belirlediğin soruları asistanlara sormak, markanın anılıp anılmadığını ve sitenin kaynak gösterilip gösterilmediğini kaydetmek. Ölçümün mantığını [yapay zekâ görünürlüğü rehberinde](/rehber/yapay-zeka-gorunurlugu) anlattık.',
        },
      ],
    },
    {
      id: 'ad-benzerligi',
      h2: 'RanksUp ile rankzupAI aynı ürün mü?',
      blocks: [
        {
          t: 'p',
          text: 'Hayır. Adları benziyor ama iki ayrı şirketin iki ayrı ürünü. RanksUp’ın adresi ranksup.ai. rankzupAI’nin adresi rankzup.ai; kendi sayfasına göre İstanbul merkezli SEO ve GEO ajansı rankZup tarafından geliştiriliyor. Bir asistan cevabında ya da bir listede bu adlardan birini görürsen alan adına bakman yeterli.',
          // Fiyat sayfasinin alt bilgisi: "Geliştiren: rankZup, SEO ve GEO ajansı"; hakkinda sayfasi: "İstanbul merkezli"
          kaynak: ['rankzup-about', 'rankzup-pricing'],
        },
      ],
    },
    {
      id: 'ihtiyaca-gore',
      h2: 'İhtiyacıma göre hangisine bakmalıyım?',
      blocks: [
        {
          t: 'table',
          caption: 'İhtiyaca göre kısa liste',
          head: ['İhtiyacın', 'Bakılacak ürünler'],
          rows: [
            ['Fiyatı TL olarak yazılan abonelik', 'Geovium, rankzupAI, SEOYEN, Yanıt IO. RanksUp fiyatı dolar olarak yazıyor, ödemeyi TL karşılığıyla alıyor'],
            ['Grok ya da DeepSeek’te ölçüm', 'RanksUp (Profesyonel ve üstü) ve GEON ikisini de ölçüyor; Geovium Grok’u ölçüyor; rankzupAI’de Grok ek ücretli'],
            ['Google AI Overviews takibi', 'rankzupAI (her pakette), SEOYEN, Visby (seçilen üç motordan biri olarak); AIWATCH ayrı bir akışta izlediğini yazıyor'],
            ['Ölçümle birlikte makale üretimi', 'RanksUp (Profesyonel ve üstü), SEOYEN, Visby (plan karşılaştırma tablosuna göre Starter’da ayda 5, Growth’ta 15, Enterprise’da 25 makale); rankzupAI içerik planını taslak makaleye dönüştürüyor'],
            ['Mağaza bağlantısı (Shopify, Google Merchant Center)', 'Geovium ve Visby ikisini de yazıyor; rankzupAI’nin Shopify eklentisi var; Yanıt IO abonelikte mağaza bağlantısı sunuyor'],
            ['Mobil uygulama (ASO) ile birlikte', 'RanksUp'],
            ['Ajanslar için çoklu marka', 'rankzupAI (Agency paketi), Geovium (Ajans paketi), GEON (Enterprise), SEOYEN (Pro paketinde 20 proje); RanksUp’ta Profesyonel planda 5 site'],
          ],
          kaynak: ['ranksup-pricing', 'aiwatch', 'geon', 'geovium', 'rankzup', 'rankzup-pricing', 'seoyen', 'seoyen-pricing', 'visby-pricing', 'yanit-pricing'],
        },
        { t: 'p', text: 'Ajanslar için ayrıntılı tablo [ajans raporlama rehberinde](/rehber/ajanslar-icin-yapay-zeka-gorunurluk-raporu), mağazalar için [e-ticaret rehberinde](/rehber/e-ticaret-yapay-zeka-gorunurlugu).' },
      ],
    },
    {
      id: 'hizmet-olarak',
      h2: 'Ölçümü kendisi yapıp rapor veren şirketler de var mı?',
      blocks: [
        { t: 'p', text: 'Evet. Paneli sana bırakmak yerine ölçümü kendisi yapıp rapor teslim eden ya da işi danışmanlıkla birlikte sunan şirketler de var. İki örnek:' },
        {
          t: 'ul',
          items: [
            '**Zekabi:** Aylık ya da yıllık abonelikle çalışıyor. Ücrete marka araştırması, Türkçe soru seti, her ay ChatGPT, Gemini ve Claude’da ölçüm ve aylık web raporu dahil. Hafif paketi 5.000 TL + KDV/ay.',
            '**Sheltron:** Yapay zekâ görünürlük danışmanlığını sprint paketleriyle satıyor; Starter paketi aylık 35.000 TL ve 12 haftalık, fiyatlar KDV hariç. AiSEO gibi yazılım ürünlerinde fiyatı teklifle veriyor.',
          ],
          kaynak: ['zekabi-pricing', 'sheltron-pricing'],
        },
        { t: 'p', text: 'Fark şu: yazılımda soruları sen girer, sonuçları panelden sen okursun ve düzeltmeyi sen yaparsın. Bu şirketlerde ölçümü ve raporu karşı taraf hazırlar; bazıları uygulamayı da üstlenir.' },
      ],
    },
    {
      id: 'global-urunler',
      h2: 'Global ürünler Türkiye’de kullanılabilir mi?',
      blocks: [
        {
          t: 'p',
          text: 'Kullanılabilir. Otterly.AI, Peec AI, Profound, Semrush AI Visibility Toolkit ve Ahrefs Brand Radar’ın kapsamını ve fiyatlarını [karşılaştırma rehberinde](/rehber/yapay-zeka-gorunurluk-araclari) kaynaklarıyla yazdık. Bu ürünlerin sayfalarında Türkçe desteği açıkça yazmıyor; Peec AI ise ülke ve dil için ek ücret almadığını yazıyor. Karar vermeden önce denemede kendi Türkçe sorularınla ölçüm yapmanı öneririz.',
          kaynak: ['peec'],
        },
      ],
    },
    {
      id: 'ranksup',
      h2: 'RanksUp bu listede nerede duruyor, sınırları ne?',
      blocks: [
        {
          t: 'callout',
          title: 'Açıklama',
          text: 'RanksUp bizim ürünümüz ve bu sayfayı biz hazırladık. Bu yüzden kendi sınırlarımızı da yazdık ve her bilgiyi satıcının kendi sayfasına bağladık.',
        },
        {
          t: 'ul',
          items: [
            '**Ne sunuyor:** ChatGPT, Gemini, Claude ve Perplexity’de ölçüm, Profesyonel ve üstü planlarda ayrıca Grok ve DeepSeek; kendi sorularınla ölçüm; rakip ve kaynak takibi; 14 teknik kontrollü site denetimi; Search Console bağlıyken günlük sıra takibi; ASO. Makale üretimi ve yayın Profesyonel ve üstü planlarda.',
            '**Sınırları:** Ücretli planlar Başlangıç $99/ay’dan başlar (KDV dahil); yalnız ölçüm isteyen biri için bu listede daha düşük fiyatlı seçenekler var. Copilot ölçülmez. Ölçüm hesap başına 7 günde birdir. Kendi logonla (beyaz etiket) rapor yoktur.',
          ],
          kaynak: ['ranksup-pricing', 'ranksup-terms', 'ranksup-ai-visibility'],
        },
        {
          t: 'tool',
          title: 'Önce kendi siteni ücretsiz ölç',
          text: 'Alan adını yaz; sitene uygun alıcı sorularını ChatGPT, Gemini, Claude ve Perplexity’ye soralım, markanın anılıp anılmadığını ve sitenin kaynak gösterilip gösterilmediğini gösterelim. Kayıt gerekmez; aynı ağdan haftada bir test yapılabilir.',
        },
      ],
    },
    {
      id: 'yontem',
      h2: 'Bu listeyi nasıl hazırladık?',
      blocks: [
        {
          t: 'ul',
          items: [
            'Her bilgi satıcının kendi sayfasından, tarayıcıda görünen haliyle okundu. GEON dışındaki ürünler 14 Kasım 2026’da okundu; GEON 24 Ekim 2026’da okunmuştu, fiyatları 14 Kasım’da yeniden kontrol edildi.',
            'Tırnak içindeki tanımlar satıcının kendi ifadesidir, bizim değerlendirmemiz değil.',
            'Satıcı sayfasında doğrulayamadığımız bir bilgiyi yazmadık. Birden çok şirket kendini “Türkiye’nin ilk” platformu ya da şirketi olarak tanıtıyor; doğrulayamadığımız için bu ifadeyi tabloya almadık.',
            'Ürünleri kendi hesabımızla tek tek test etmedik; bu bir ürün sayfası karşılaştırmasıdır.',
            'Listede eksik ya da değişmiş bir bilgi görürsen destek@luvihost.com adresine yaz; kaynağıyla birlikte düzeltiriz.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: 'Türkiye’de yapay zekâ görünürlüğünü ölçmek için Türkçe arayüz şart mı?',
      a: 'Şart değil; önemli olan soruların Türkçe sorulabilmesi. Türkiye’de satış yapıyorsan ölçüm Türkçe sorularla yapılmalı, çünkü İngilizce sorular başka kaynakları ve başka rakipleri getirebilir. Arayüzün Türkçe olması ekibin işini kolaylaştırır.',
    },
    {
      q: 'Bu ürünlerin hangisi fiyatını TL olarak yazıyor?',
      a: 'Satıcı sayfalarına göre Geovium, rankzupAI, SEOYEN ve Yanıt IO fiyatını TL olarak yazıyor. RanksUp, GEON ve Visby dolar fiyatı gösteriyor; RanksUp ödemeyi TL karşılığıyla alıyor. AIWATCH fiyat yayımlamıyor.',
    },
    {
      q: 'Hangi ürün en çok asistanı ölçüyor?',
      a: 'Sayfalarına göre GEON altı asistanı, RanksUp Profesyonel ve üstü planlarda altı asistanı, Geovium beş asistanı ölçüyor. rankzupAI dört motoru pakete dahil ediyor, ek ücretli üç motorla yediye çıkıyor. AIWATCH hakkımızda sayfasında 12 motor yazıyor, ana sayfasında ise kapsamın kuruluma göre değiştiğini belirtiyor. Sayıdan önce müşterilerinin hangi asistanı kullandığına bak.',
    },
    {
      q: 'Kart vermeden deneyebileceğim ürünler hangileri?',
      a: 'Sayfalarına göre RanksUp ve Geovium 14 gün, rankzupAI 7 gün kart istemeden deneme veriyor. GEON kayıtta 5 ücretsiz kredi veriyor, Yanıt IO ödeme açılana kadar ücretsiz erken erişim sunuyor. SEOYEN’in 7 günlük denemesi ücretli. Visby deneme sunuyor ama süresini yazmıyor.',
    },
    {
      q: 'Bu liste tarafsız mı?',
      a: 'RanksUp bizim ürünümüz; tam tarafsız olduğumuzu iddia etmiyoruz. Bunu dengelemek için her bilgiyi satıcının kendi sayfasından aldık, erişim tarihini yazdık, diğer ürünleri alfabetik sıraladık ve RanksUp’ın sınırlarını da listeledik.',
    },
    {
      q: 'Yerli bir ürün seçmenin faydası ne?',
      a: 'Türkçe destek, TL fatura ve Türkçe soru setiyle ölçüm, işini kolaylaştırabilir. Ölçülen asistanlar ve yöntem ise ürünün nerede geliştirildiğinden bağımsızdır; tabloda her ürünün kapsamına ayrı bak.',
    },
    {
      q: 'Bu liste ne zaman güncellendi?',
      a: 'GEON dışındaki ürünler 14 Kasım 2026’da okundu; GEON’un fiyatları aynı gün yeniden kontrol edildi. Bu alanda fiyatlar ve kapsam sık değişiyor; karar vermeden önce satıcının güncel sayfasına bak. Sayfanın üstündeki son güncelleme satırı son kontrol tarihini gösterir.',
    },
  ],
  sources: [
    SRC.ranksupPricing, SRC.ranksupTerms, SRC.ranksupAiVisibility, SRC.aiwatch, SRC.aiwatchAbout, SRC.geon, SRC.geovium,
    SRC.rankzupHome, SRC.rankzupPricing, SRC.rankzupAbout, SRC.seoyen, SRC.seoyenPricing, SRC.visbyHome, SRC.visbyPricing, SRC.yanit,
    SRC.yanitPricing, SRC.zekabiPricing, SRC.sheltronPricing, SRC.peec,
  ],
  related: ['yapay-zeka-gorunurluk-araclari', 'kobi-seo-ve-yapay-zeka-gorunurlugu', 'yapay-zeka-gorunurlugu'],
  published: '2026-11-14',
  schemaType: 'Article',
};
