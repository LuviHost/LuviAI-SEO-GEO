import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * 14.11.2026 (sahip: "hepsini yap"). Hedef soru: "E-ticaret sitemin ChatGPT, Gemini ve Perplexity'de
 * önerilmesi için hangi yazılımı kullanmalıyım?" — sitede e-ticarete özel yalnız kullanım alanları
 * kartı vardı.
 *
 * Kaynaklar (hepsi 14.11.2026'da tarayicida dogrudan okundu; verbatim alintilar sources.ts'te):
 *  - OpenAI Help "Shopping with ChatGPT Search": urun sonuclari reklam degil; yapilandirilmis veri;
 *    satici siralamasi (stok, fiyat, kalite, uretici / ana satici); Shopify Catalog; dogrudan besleme basvurusu.
 *  - OpenAI Developers "Product feed schema": standart yukleme ABD'yi hedefliyor; baska pazarlar OpenAI
 *    onayiyla; "Eligibility does not guarantee display." Belgede Turkiye'nin adi GECMIYOR — rehber
 *    "kullanilamaz" DEMEZ, "dogrulayamadik" der.
 *  - Google "AI features and your website": dizin + snippet sarti, ek teknik sart yok, ozel schema.org
 *    gerekmiyor, yapilandirilmis veri gorunur metinle eslesmeli, Merchant Center guncel olmali. Sayfanin
 *    Turkce surumu 14.11'de yeniden okundu; `googleAiFeatures` ortak kaynak oldugu icin tarihi 24.10 kaldi.
 * Perplexity'nin satici programi YAZILMADI: yalniz ikincil kaynaklar bulundu.
 *
 * RanksUp tarafı kodla ayni: magaza altyapisi baglantisi ve urun beslemesi YOK (yayin hedefleri prisma
 * PublishTargetType: WordPress REST dahil 13 hedef; Shopify / ikas / Ticimax yok); olcum cevap metnini ve
 * kaynaklari olcer, ChatGPT urun kartlarini degil. Ürün Radarı yalniz Kurumsal'da (plans.ts).
 * Sonuc vaadi yok; schema / llms.txt "kaldirac" diye sunulmaz (sahip kurali).
 */
export const article: RehberArticle = {
  slug: 'e-ticaret-yapay-zeka-gorunurlugu',
  title: 'E-ticaret sitem ChatGPT, Gemini ve Perplexity’de nasıl önerilir?',
  metaTitle: 'E-ticaret için yapay zekâ görünürlüğü rehberi',
  description:
    'Asistanlar ürünleri ve mağazaları nasıl seçiyor, mağazanda neyi kontrol etmelisin, hangi sorularla ölçmelisin ve hangi yazılımlar işini kolaylaştırır?',
  topic: 'E-ticaret',
  answer:
    'Bunu garanti eden bir yöntem yok; önce asistanların mağazanı bulabildiğinden emin ol: botlara açık sayfalar, güncel ürün bilgisi ve alıcı sorularını cevaplayan içerik. Sonra aynı alıcı sorularını düzenli sorup markanın ve rakip mağazaların cevaplarda ne sıklıkla geçtiğini ölç; bunu elle ya da bir yazılımla yapabilirsin.',
  quick: [
    'OpenAI’a göre ChatGPT’deki ürün sonuçları reklam değildir; seçimde sağlayıcılardan gelen ürün verisi (ör. fiyat, ürün açıklaması) kullanılır.',
    'Shopify mağazalarının ürün verisi ChatGPT’ye Shopify Catalog üzerinden ulaşıyor.',
    'OpenAI’ın doğrudan ürün beslemesi şu an ABD’yi hedefliyor; başka pazarlar OpenAI onayına bağlı.',
    'Google AI Bakışı için ek teknik şart yok: sayfa dizinde ve snippet ile gösterilmeye uygun olmalı.',
    'Arama botlarına (OAI-SearchBot, Claude-SearchBot, PerplexityBot) izin ver.',
    'Ölçümde kategori, karşılaştırma ve “nereden alınır” sorularını kullan; marka adını soruya koyma.',
  ],
  sections: [
    {
      id: 'asistanlar-nereden-buluyor',
      h2: 'Asistanlar ürünleri ve mağazaları nereden buluyor?',
      blocks: [
        { t: 'p', text: 'Her asistan farklı çalışıyor. Ortak nokta şu: cevap, asistanın o an ulaşabildiği sayfalardan ve ürün verisinden üretiliyor. Aşağıdaki tablo üreticilerin kendi belgelerine dayanıyor.' },
        {
          t: 'table',
          caption: 'Asistanlar bilgiyi nereden alıyor? (üretici belgelerine göre)',
          head: ['Asistan', 'Bilgiyi nereden alıyor?', 'Senin kontrolündeki şey'],
          rows: [
            ['ChatGPT', 'Web araması (OAI-SearchBot); ürün sonuçlarında birinci ve üçüncü taraf sağlayıcılardan gelen yapılandırılmış ürün verisi', 'OAI-SearchBot’a izin vermek. Shopify’da ürün verisi Shopify Catalog üzerinden gidiyor; diğer mağazalar ürün beslemesi için başvurabiliyor'],
            ['Google AI Bakışı ve AI Modu', 'Google arama dizini ve temel sıralama sistemleri', 'Sayfanın dizinde ve snippet ile gösterilmeye uygun olması; Merchant Center bilgilerinin güncel olması'],
            ['Gemini', 'Google’ın taradığı web içeriğiyle temellendirme', 'Google-Extended belirtecini engellersen içeriğin Gemini uygulamalarındaki temellendirmede kullanılmaz; bu, Google Arama’yı etkilemez'],
            ['Perplexity', 'Web araması (PerplexityBot)', 'PerplexityBot’a izin vermek'],
            ['Claude', 'Web araması (Claude-SearchBot)', 'Claude-SearchBot’a izin vermek'],
          ],
          kaynak: ['openai-bots', 'openai-shopping-help', 'google-ai-guide', 'google-ai-features', 'google-crawlers', 'perplexity-bots', 'anthropic-bots'],
        },
      ],
    },
    {
      id: 'chatgpt-alisveris',
      h2: 'ChatGPT alışveriş sonuçlarını nasıl seçiyor?',
      blocks: [
        { t: 'p', text: 'OpenAI bunu yardım sayfasında ve geliştirici belgelerinde anlatıyor. Özetle:' },
        {
          t: 'ul',
          items: [
            '**Reklam değil:** OpenAI, ürün sonuçlarının reklam olmadığını ve reklamların ürün sonuçlarından ayrı tutulduğunu yazıyor.',
            '**Bakılan veri:** Birinci ve üçüncü taraf sağlayıcılardan gelen yapılandırılmış ürün verisi (ör. fiyat, ürün açıklaması) ve diğer üçüncü taraf içerikler. Ürün yorumu özetleri herkese açık sitelerdeki yorumlardan üretiliyor.',
            '**Satıcı sıralaması:** Aynı ürünü birden çok satıcı satıyorsa sıralamada stok durumu, fiyat, kalite ve satıcının ürünün üreticisi ya da ana satıcısı olup olmadığı gibi etkenler rol oynuyor.',
            '**Shopify:** Shopify mağazalarının ürün verisi ChatGPT’ye Shopify Catalog üzerinden ulaşıyor; OpenAI mağazanın ek bir şey yapmasına gerek olmadığını yazıyor.',
            '**Doğrudan ürün beslemesi:** Diğer mağazalar ürün beslemesi için başvurabiliyor. Geliştirici belgesine göre standart yükleme şu an ABD’yi hedefliyor, ortak biçim ise ABD, Kanada ve Meksika’yı kapsıyor; başka pazarlar ancak OpenAI entegrasyonu ve izin verilen ülkeleri onayladıktan sonra kullanılabiliyor. Belge, uygunluğun gösterimi garanti etmediğini de yazıyor.',
          ],
          kaynak: ['openai-shopping-help', 'openai-product-feed'],
        },
        {
          t: 'callout',
          title: 'Türkiye’deki mağazalar için',
          text: 'Ürün beslemesi belgesinde Türkiye’nin adı geçmiyor; beslemenin Türkiye’de kullanılıp kullanılamadığını doğrulayamadık. OpenAI, Shopify Catalog için de ülke belirtmiyor; Türkiye’deki Shopify mağazaları için ayrıca doğrulayamadık. Bugün kendi başına kontrol edebildiğin şeyler bir sonraki bölümde: sayfaların taranabilir olması ve ürün bilgisinin sayfada açıkça yazılı olması. İşletme profilini sahiplenmek ayrı bir konu; onu [ChatGPT işletme profili rehberinde](/rehber/chatgpt-isletme-profili) anlattık.',
          kaynak: ['openai-product-feed', 'openai-shopping-help'],
        },
      ],
    },
    {
      id: 'magazamda-kontrol',
      h2: 'Mağazamda neyi kontrol etmeliyim?',
      blocks: [
        {
          t: 'ol',
          items: [
            '**Botlara izin ver.** robots.txt’de, CDN’de ve güvenlik duvarında OAI-SearchBot, Claude-SearchBot ve PerplexityBot’u engelleme. Hazır kurallar [robots.txt rehberinde](/rehber/yapay-zeka-botlari-robots-txt).',
            '**Ürün bilgisini metin olarak yaz.** Fiyat, stok, kargo ve iade koşulları sayfada görünür metin olsun; Google önemli içeriğin metin biçiminde sunulmasını öneriyor.',
            '**Yapılandırılmış veri görünen metinle aynı olsun.** Google, yapılandırılmış verinin sayfadaki görünür metinle eşleşmesini öneriyor; AI Bakışı için özel bir schema.org işaretlemesi ise gerekmiyor.',
            '**Merchant Center’ı güncel tut.** Google, Merchant Center bilgilerinin güncel olmasını en iyi uygulamalar arasında sayıyor.',
            '**Alıcı sorularına cevap veren sayfalar yaz.** Kategori rehberi, karşılaştırma ve “hangisini seçmeliyim” sayfaları, asistanın bir soruya cevap ararken bulabileceği içeriktir.',
            '**Mağaza bilgisini tutarlı tut.** Mağaza adı, ne sattığın, teslimat ve iade bilgisi sitenin her yerinde aynı olsun.',
          ],
          kaynak: ['openai-bots', 'anthropic-bots', 'perplexity-bots', 'google-ai-features'],
        },
        {
          t: 'p',
          text: 'Bunların hiçbiri önerilmeyi garanti etmez. Google da bir sayfa tüm koşulları karşılasa bile dizine eklenmesinin ve gösterilmesinin garanti olmadığını yazıyor.',
          kaynak: ['google-ai-features'],
        },
      ],
    },
    {
      id: 'hangi-sorular',
      h2: 'Hangi sorularla ölçmeliyim?',
      blocks: [
        {
          t: 'table',
          caption: 'E-ticaret için soru türleri',
          head: ['Soru türü', 'Örnek', 'Ne gösterir?'],
          rows: [
            ['Kategori', '“Bebek arabası için güvenilir online mağazalar hangileri?”', 'Kategoride adın geçiyor mu'],
            ['Karşılaştırma', '“A marka mı B marka mı, hangisini almalıyım?”', 'Sattığın ürünler karşılaştırmalarda nasıl anlatılıyor'],
            ['Nereden alınır', '“Organik zeytinyağı nereden alınır?”', 'Asistan hangi mağazaları ve hangi sayfaları kaynak gösteriyor'],
            ['Sorun çözme', '“Hassas cilt için hangi güneş kremi uygun?”', 'Rehber ve içerik sayfaların kaynak oluyor mu'],
            ['Güven', '“Bu mağaza güvenilir mi?” (mağaza adınla)', 'Markan hakkında ne söyleniyor, bilgi doğru mu'],
          ],
        },
        { t: 'p', text: 'Marka adını yalnız güven sorularında kullan; diğer sorularda adını yazmazsan asistanın seni kendiliğinden önerip önermediğini görürsün. Aynı soruları her ay aynı yöntemle sor ve tek bir cevaba değil eğilime bak; asistan cevapları oynaktır.' },
        {
          t: 'tool',
          title: 'Mağazanı ücretsiz ölç',
          text: 'Alan adını yaz; sitene uygun alıcı sorularını ChatGPT, Gemini, Claude ve Perplexity’ye soralım, markanın anılıp anılmadığını ve sitenin kaynak gösterilip gösterilmediğini gösterelim. Kayıt gerekmez; aynı ağdan haftada bir test yapılabilir.',
        },
      ],
    },
    {
      id: 'hangi-yazilim',
      h2: 'Hangi yazılımı kullanmalıyım?',
      blocks: [
        { t: 'p', text: 'Ölçüm yapan yazılımların çoğu her tür sitede çalışır. Aşağıda, sayfasında e-ticarete özel bir özellik yazan ölçüm ürünlerinden doğrulayabildiklerimizi ve bizim ürünümüzü listeledik; liste eksiksiz olmayabilir. Tüm ürünlerin fiyatı ve kapsamı [Türkiye listesinde](/rehber/turkiyede-yapay-zeka-gorunurluk-urunleri) ve [karşılaştırma rehberinde](/rehber/yapay-zeka-gorunurluk-araclari).' },
        {
          t: 'table',
          caption: 'E-ticaret için yazılım seçenekleri (satıcı sayfaları; erişim tarihleri kaynak satırında)',
          head: ['Ürün', 'E-ticaret için yazdığı özellik', 'Başlangıç fiyatı (satıcı sayfası)'],
          rows: [
            ['RanksUp (bizim ürünümüz)', 'Mağaza bağlantısı yok. Kendi alıcı sorularınla ölçüm, rakip ve kaynak takibi; Profesyonel ve üstünde WordPress ve WooCommerce sitelerine WordPress REST ile içerik yayını', 'Başlangıç $99/ay, KDV dahil'],
            ['Geovium', 'Ürün ve kategori sorularını takip, rakip mağazalarla karşılaştırma; isteğe bağlı Shopify ve Google Merchant Center bağlantısı', 'Starter 2.990 TL + KDV/ay'],
            ['Profound', 'Enterprise planında ChatGPT Shopping takibi', 'Markalar için liste fiyatı yok'],
            ['rankzupAI', 'Shopify App Store eklentisi: ürün başlıklarından soru üretimi ve ürün (SKU) bazında takip', 'Starter 1.749 TL/ay + KDV (fiyat sayfası); eklentide ödeme Shopify faturasına ekleniyor'],
            ['SEOYEN', 'Pro ve üstü paketlerde “E-Ticaret analizi”', 'Pro aylık 3.799 TL, KDV dahil'],
            ['Visby', 'Starter’da Shopify entegrasyonu; Growth ve üstünde Google Merchant Center entegrasyonu', 'Starter $79/ay'],
            ['Yanıt IO', 'Abonelikte mağaza bağlantısı: 2 mağaza, 5.000 ürün', '2.499 TL/ay, KDV dahil; sayfasına göre ödeme henüz açılmadı'],
          ],
          kaynak: ['ranksup-pricing', 'ranksup-terms', 'geovium', 'profound', 'rankzup', 'rankzup-pricing', 'seoyen-pricing', 'visby-pricing', 'yanit-pricing'],
        },
      ],
    },
    {
      id: 'ranksup-eticaret',
      h2: 'RanksUp e-ticaret için ne yapar, ne yapmaz?',
      blocks: [
        {
          t: 'callout',
          title: 'Açıklama',
          text: 'RanksUp bizim ürünümüz. Bu yüzden yapmadıklarını da yaptıkları kadar açık yazdık.',
        },
        {
          t: 'ul',
          items: [
            '**Yapar:** Senin belirlediğin alıcı sorularını asistanlara sorar; markanın anılıp anılmadığını, sitenin kaynak gösterilip gösterilmediğini ve cevaplarda hangi rakiplerin, hangi kaynak sitelerin geçtiğini gösterir. 14 teknik kontrollü site denetimi ve Search Console bağlıyken günlük sıra takibi Başlangıç planında. Profesyonel ve üstü planlarda makale üretir ve WordPress dahil 13 yayın hedefine yayınlar. Kurumsal planda Ürün Radarı haftalık rakip ses payını ve kategori sırasını izler.',
            '**Yapmaz:** Shopify, ikas ya da Ticimax gibi mağaza altyapılarına doğrudan bağlanmaz ve ürün beslemesi üretmez. ChatGPT’nin ürün kartlarını ayrı ölçmez; cevap metnini ve kaynakları ölçer. Copilot ölçülmez.',
          ],
          kaynak: ['ranksup-pricing', 'ranksup-terms', 'ranksup-ai-visibility'],
        },
        { t: 'p', text: 'Plan ayrıntıları [fiyatlandırma sayfasında](/pricing); ölçüm yöntemi [AI Görünürlük yardım sayfasında](/help/ai-visibility).' },
      ],
    },
  ],
  faq: [
    {
      q: 'ChatGPT’de ürünlerimin çıkması için reklam vermem gerekir mi?',
      a: 'Hayır. OpenAI’ın yardım sayfasına göre ürün sonuçları reklam değildir ve reklamlar ürün sonuçlarından ayrı tutulur. Ürün sonuçlarında görünmek reklam satın almaya bağlı değildir; görünmek de garanti değildir.',
    },
    {
      q: 'Shopify kullanmıyorum; ürünlerim ChatGPT’de görünebilir mi?',
      a: 'Görünebilir. OpenAI ürün verisini birinci ve üçüncü taraf sağlayıcılardan aldığını yazıyor ve Shopify dışındaki mağazaların doğrudan ürün beslemesi için başvurabildiğini belirtiyor. Standart besleme şu an ABD’yi hedeflediği için, Türkiye’deki bir mağazanın bugün kendi başına kontrol edebildiği şey sayfalarının arama botlarına açık olmasıdır.',
    },
    {
      q: 'Ürün yorumları asistan cevaplarını etkiler mi?',
      a: 'OpenAI, ChatGPT’nin ürün yorumu özetlerini herkese açık sitelerdeki yorumlardan ürettiğini ve yorumları doğrulamadığını yazıyor. Bu yüzden yorumların nerede ve nasıl yer aldığı, ürünün nasıl özetlendiğini etkileyebilir.',
    },
    {
      q: 'Mağazam için kaç soruyla ölçüme başlamalıyım?',
      a: 'En çok satan iki üç kategorin için beşer soru iyi bir başlangıçtır: kategori, karşılaştırma ve nereden alınır soruları. Soruları değiştirmeden her ay yeniden ölç.',
    },
    {
      q: 'Ürün sayfalarıma özel bir işaretleme eklemem gerekir mi?',
      a: 'Google’a göre AI Bakışı ve AI Modu için özel bir schema.org işaretlemesi ya da yeni bir dosya gerekmiyor. Yapılandırılmış veri kullanıyorsan sayfadaki görünür metinle aynı olmalı.',
    },
    {
      q: 'RanksUp ürün beslemesi oluşturuyor mu?',
      a: 'Hayır. RanksUp ölçüm, site denetimi ve içerik tarafında çalışır; ürün beslemesi üretmez ve mağaza altyapılarına doğrudan bağlanmaz.',
    },
  ],
  sources: [
    SRC.openaiShoppingHelp, SRC.openaiProductFeed, SRC.openaiBots, SRC.anthropicBots, SRC.perplexityBots, SRC.googleCrawlers,
    SRC.googleAiGuide, SRC.googleAiFeatures, SRC.ranksupPricing, SRC.ranksupTerms, SRC.ranksupAiVisibility, SRC.geovium,
    SRC.profound, SRC.rankzupHome, SRC.rankzupPricing, SRC.seoyenPricing, SRC.visbyPricing, SRC.yanitPricing,
  ],
  related: ['yapay-zeka-botlari-robots-txt', 'chatgpt-isletme-profili', 'turkiyede-yapay-zeka-gorunurluk-urunleri'],
  published: '2026-11-14',
  schemaType: 'Article',
};
