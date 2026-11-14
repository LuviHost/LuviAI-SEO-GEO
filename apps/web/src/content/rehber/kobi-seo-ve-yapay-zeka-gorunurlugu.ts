import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * 14.11.2026 (sahip: "hepsini yap"). Hedef soru: "KOBİ'ler için hem SEO'yu hem AI görünürlüğünü
 * tek panelde takip eden uygun fiyatlı platform önerir misin?" — 10.11 ölçümünde bu soruda yalnız
 * bir asistan bizi andı; sitede KOBİ'ye özel sayfa yoktu.
 *
 * Ürün karşılaştırması yapay-zeka-gorunurluk-araclari.ts ile AYNI doğrulanmış bilgileri kullanır
 * (satıcı sayfaları 24.10.2026; RanksUp 11.11.2026) — burada yeni rakip iddiası YOK. RanksUp plan
 * maddeleri api billing/plans.ts ile aynı: Başlangıç 2 site, dört asistan, makale yok; Profesyonel
 * 5 site, ayda 40 makale. Fiyat ifadeleri public-docs.spec.ts tarafından plans.ts ile karşılaştırılır.
 *
 * Yazılım için "araç" sözcüğü kullanılmaz (sahip tercihi); "ürün", "platform", "yazılım".
 */
export const article: RehberArticle = {
  slug: 'kobi-seo-ve-yapay-zeka-gorunurlugu',
  title: 'KOBİ’ler SEO ve yapay zekâ görünürlüğünü tek panelden nasıl takip eder?',
  metaTitle: 'KOBİ için SEO ve yapay zekâ görünürlüğü takibi',
  description:
    'Küçük işletmeler SEO ve yapay zekâ görünürlüğünü birlikte nasıl izler: neyi takip etmeli, ücretsiz yöntem, tek panel sunan ürünler ve seçim ölçütleri.',
  topic: 'KOBİ',
  answer:
    'Küçük bir işletme için pratik yol, Google’daki sıralamayı Search Console’dan, asistanlardaki görünürlüğü ise aynı soruları düzenli sorarak tek bir yerde izlemektir. Bunu ücretsiz olarak elle yapabilir ya da ikisini birlikte gösteren bir ürün kullanabilirsin; hangisinin uygun olduğu ayıracağın zamana ve bütçene bağlı.',
  quick: [
    'Google tarafı için Search Console yeterli ve ücretsiz: gösterim, tıklama, ortalama sıra.',
    'Asistanlar için 5–10 alıcı sorusu seç ve her ay aynı sorularla ölç.',
    'İkisini elle takip etmek zaman alır; ürünler bu işi otomatikleştirir.',
    'Tek panelde ikisini birlikte sunan ürün az; kapsam ve fiyatları aşağıdaki tabloda.',
    'Ölçüm tek başına sonucu değiştirmez; görünmediğin sorulara cevap veren sayfalar gerekir.',
  ],
  sections: [
    {
      id: 'neden-birlikte',
      h2: 'SEO ile yapay zekâ görünürlüğünü neden birlikte izlemeliyim?',
      blocks: [
        {
          t: 'p',
          text: 'İkisi birbirine bağlı ama aynı şey değil. Google’a göre AI Bakışı, arama dizinindeki sayfaları temel sıralama sistemleriyle bulur ve cevabı bunlardan üretir; yani Google’da dizinde ve iyi durumda olan sayfalar orada da kaynak olabilir. ChatGPT, Claude ya da Perplexity gibi asistanlar ise kendi aramalarını yapar ve farklı kaynaklar seçebilir.',
          kaynak: ['google-ai-guide', 'google-ai-features'],
        },
        {
          t: 'table',
          caption: 'Hangi veri nereden gelir?',
          head: ['Ne izlenir?', 'Nereden bakılır?', 'Ne sıklıkla?'],
          rows: [
            ['Google’da gösterim, tıklama ve ortalama sıra', 'Search Console (ücretsiz)', 'Haftalık'],
            ['Asistan cevaplarında anılma ve kaynak gösterilme', 'Aynı soruları sorup cevapları kaydederek (elle ya da bir ürünle)', 'Aylık; düzenli takipte haftalık'],
            ['Rakiplerin aynı cevaplarda anılması', 'Aynı ölçümden', 'Aylık'],
            ['Sitenin teknik durumu ve botların erişimi', 'Site denetimi ve robots.txt kontrolü', 'Ayda bir ve büyük değişikliklerden sonra'],
          ],
        },
      ],
    },
    {
      id: 'ucretsiz-yontem',
      h2: 'Bunu ücretsiz nasıl yaparım?',
      blocks: [
        {
          t: 'ol',
          items: [
            '**Search Console’u kur.** Siteni doğrula; birkaç gün sonra hangi aramalarda göründüğünü gösterir.',
            '**5–10 alıcı sorusu yaz.** Müşterinin gerçekten soracağı cümleler olsun; marka adını soruya koyma.',
            '**Her ay aynı soruları asistanlara sor.** Oturum kapalıyken, her turu yeni sohbette ve mümkünse birkaç kez.',
            '**İkisini tek tabloya yaz.** Soru, Google’daki sıra, asistanlarda anıldın mı, sitene bağlantı var mı, hangi rakipler anıldı.',
            '**Eksik kalan soruyu seç.** Hiç görünmediğin bir soru için o soruyu doğrudan cevaplayan bir sayfa yaz ve bir sonraki ay yeniden ölç.',
          ],
        },
        { t: 'p', text: 'Elle testin adımlarını ve örnek kayıt tablosunu [ChatGPT’de markam görünüyor mu rehberinde](/rehber/chatgpt-markam-gorunuyor-mu) anlattık.' },
        {
          t: 'tool',
          title: 'Önce ücretsiz ölç',
          text: 'Alan adını yaz; sitene uygun alıcı sorularını ChatGPT, Gemini, Claude ve Perplexity’ye soralım, markanın anılıp anılmadığını ve sitenin kaynak gösterilip gösterilmediğini gösterelim. Kayıt gerekmez; aynı ağdan haftada bir test yapılabilir.',
        },
      ],
    },
    {
      id: 'tek-panel-urunler',
      h2: 'Tek panelde ikisini birlikte sunan ürünler hangileri?',
      blocks: [
        { t: 'p', text: 'Aşağıdaki bilgiler satıcıların kendi sayfalarından alındı. Fiyatlar orada gösterildiği gibi; para birimi, vergi ve faturalama dönemi üründen ürüne değişiyor.' },
        {
          t: 'table',
          caption: 'SEO ile yapay zekâ görünürlüğünü birlikte sunan ürünler (satıcı sayfaları, erişim 24.10.2026; RanksUp satırı 11.11.2026)',
          head: ['Ürün', 'Kapsam', 'Ölçülen asistanlar', 'Başlangıç fiyatı (satıcı sayfası)'],
          rows: [
            ['RanksUp (bizim ürünümüz)', 'Site SEO/GEO denetimi, Search Console bağlıyken günlük sıra takibi, kendi sorularınla ölçüm, rakip ve kaynak takibi; makale üretimi Profesyonel ve üstünde', 'Başlangıç’ta ChatGPT, Gemini, Claude, Perplexity; Profesyonel ve üstünde ayrıca Grok, DeepSeek', 'Başlangıç $99/ay, KDV dahil (TL tutarı ödeme günü kuruyla); 14 gün ücretsiz deneme, kart istemez'],
            ['SEOYEN', 'SEO paketi içinde yapay zekâ görünürlüğü ve içerik', 'ChatGPT, Gemini, Claude; ayrıca Google AI Overview takibi', 'Bireysel aylık 1.299 TL ya da yıllık 12.470,40 TL peşin; fiyatlar %20 KDV dahil; 7 günlük deneme 50 TL'],
            ['Semrush AI Visibility Toolkit', 'Yapay zekâ görünürlüğü ayrı bir paket; mevcut yıllık Semrush aboneliğine eklenebiliyor', 'Bilgi bankasında ChatGPT ve Google AI Mode adı geçiyor', '$99/ay (25 prompt takibi dahil); ücretsiz deneme yok'],
            ['Ahrefs Brand Radar', 'Ücretli Ahrefs planlarının içinde; kendi sorularınla takip Custom Prompts ile', 'Index: AI Overviews, AI Mode, ChatGPT, Perplexity, Gemini, Copilot; Claude yalnız Custom Prompts’ta', 'Ücretli Lite ve üstü planlara Custom Prompts dahil (Lite’ta 5 prompt); ek Custom Prompts paketi $50/ay’dan'],
          ],
          kaynak: ['ranksup-pricing', 'ranksup-terms', 'seoyen', 'seoyen-pricing', 'semrush', 'ahrefs'],
        },
        { t: 'p', text: 'Yalnız yapay zekâ görünürlüğünü ölçen, daha düşük fiyatlı ürünler de var. Türkiye’de satılanları [Türkiye listesinde](/rehber/turkiyede-yapay-zeka-gorunurluk-urunleri), global ürünleri [karşılaştırma rehberinde](/rehber/yapay-zeka-gorunurluk-araclari) kaynaklarıyla bulabilirsin.' },
      ],
    },
    {
      id: 'neye-bakmali',
      h2: 'Bir ürün seçerken neye bakmalıyım?',
      blocks: [
        {
          t: 'table',
          caption: 'Seçim ölçütleri',
          head: ['Sorulacak soru', 'Neden önemli?'],
          rows: [
            ['Türkçe sorularla ölçüyor mu?', 'Türkiye’de satış yapıyorsan Türkçe ölçmek gerekir; İngilizce sorular başka kaynakları ve başka rakipleri getirebilir'],
            ['Hangi asistanları ölçüyor?', 'Müşterilerinin kullandığı asistanlar listede olmalı'],
            ['Aynı soruyu kaç kez soruyor?', 'Asistan cevapları oynaktır; tek turluk ölçüm yanıltabilir'],
            ['Kaç soru, ne sıklıkta?', 'Paketler çoğunlukla takip edilen soru sayısıyla tanımlanıyor; fiyatı büyük ölçüde bu belirler'],
            ['Ölçümden sonra ne sunuyor?', 'Ölçüm sonucu değiştirmez; eksik kalan sorular için ne yapılacağını gösteren bir akış işini kolaylaştırır'],
          ],
          kaynak: ['otterly', 'peec', 'semrush'],
        },
      ],
    },
    {
      id: 'ranksup-kobi',
      h2: 'RanksUp’ta bu nasıl görünüyor, sınırları ne?',
      blocks: [
        {
          t: 'callout',
          title: 'Açıklama',
          text: 'RanksUp bizim ürünümüz. Bu yüzden sınırlarını da güçlü yanları kadar açık yazdık.',
        },
        {
          t: 'ul',
          items: [
            '**Başlangıç $99/ay (KDV dahil):** 2 site; ChatGPT, Gemini, Claude ve Perplexity’de ölçüm; kendi sorularınla ölçüm (Prompt Lab); rakip ve kaynak takibi; 14 teknik kontrollü site denetimi; Search Console bağlıyken günlük sıra takibi; haftalık e-posta özeti (Search Console verisi). Bu planda makale üretimi yok.',
            '**Profesyonel $349/ay (KDV dahil):** 5 site; ölçüme Grok ve DeepSeek eklenir; ayda 40 makale üretimi ve yayın; görünmediğin soruya içerik üretip yeniden ölçen içerik fırsatları.',
            '**Sınırları:** Google AI Bakışı, AI Modu ve Copilot doğrudan ölçülmez. Ölçüm hesap başına 7 günde birdir. Yalnız ölçüm isteyen bir işletme için daha ucuz seçenekler var.',
          ],
          kaynak: ['ranksup-pricing', 'ranksup-terms', 'ranksup-ai-visibility'],
        },
        { t: 'p', text: 'Plan ayrıntıları ve deneme koşulları [fiyatlandırma sayfasında](/pricing); ölçüm yöntemi [AI Görünürlük yardım sayfasında](/help/ai-visibility).' },
      ],
    },
  ],
  faq: [
    {
      q: 'Küçük bir işletmenin yapay zekâ görünürlüğünü ölçmesi gerekir mi?',
      a: 'Müşterilerin ürün ya da hizmet ararken asistanlara soruyorsa evet. Önce ücretsiz elle testle başla; düzenli takip gerektiğini görürsen bir ürüne geçersin.',
    },
    {
      q: 'SEO yapıyorsam yapay zekâ görünürlüğü kendiliğinden gelir mi?',
      a: 'Kısmen. Google’a göre AI Bakışı arama dizinindeki sayfalardan beslenir; diğer asistanlar ise farklı kaynaklar seçebilir. Bu yüzden ikisini ayrı ölçmek gerekir.',
    },
    {
      q: 'Küçük bir işletme ayda kaç soruyu takip etmeli?',
      a: '5–10 alıcı sorusu yeterli bir başlangıçtır. Soruları değiştirmeden aynı yöntemle yeniden ölçmek, soru sayısını artırmaktan daha önemlidir.',
    },
    {
      q: 'Tek panel yerine iki ayrı ürün kullansam olur mu?',
      a: 'Olur. Search Console ücretsizdir; yanına yalnız yapay zekâ görünürlüğünü ölçen bir ürün eklemek çoğu zaman daha ucuzdur. Tek panelin farkı verileri aynı yerde görmek ve ölçümden içeriğe geçişi kolaylaştırmaktır.',
    },
    {
      q: 'Yeni sayfa yazdıktan sonra ölçüm sonucum ne zaman değişir?',
      a: 'Kesin bir süre yok. Sayfanın önce arama motorlarınca dizine alınması gerekir; bu günler ya da haftalar sürebilir. Bu yüzden haftalık oynamalara değil aylık eğilime bak.',
    },
    {
      q: 'RanksUp’ın ücretsiz denemesinde neler var?',
      a: '14 gün boyunca 1 site, 2 yapay zekâ makalesi ve 3 görünürlük çalıştırması (haftada en fazla 1 ölçüm). Kredi kartı istenmez.',
    },
  ],
  sources: [
    SRC.googleAiGuide, SRC.googleAiFeatures, SRC.ranksupPricing, SRC.ranksupTerms, SRC.ranksupAiVisibility,
    SRC.seoyen, SRC.seoyenPricing, SRC.semrush, SRC.ahrefs, SRC.otterly, SRC.peec,
  ],
  related: ['turkiyede-yapay-zeka-gorunurluk-urunleri', 'yapay-zeka-gorunurluk-araclari', 'chatgpt-markam-gorunuyor-mu'],
  published: '2026-11-14',
  schemaType: 'Article',
};
