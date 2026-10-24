import type { RehberArticle } from './types';
import { SRC } from './sources';

export const article: RehberArticle = {
  slug: 'geo-nedir',
  title: 'GEO nedir, SEO’dan farkı ne?',
  metaTitle: 'GEO nedir, SEO’dan farkı ne?',
  description:
    'GEO (üretken motor optimizasyonu) nedir, SEO ve ASO’dan farkı ne? Karşılaştırma tablosu, değişmeyen temeller ve yaygın yanlışlar, kaynaklarıyla.',
  topic: 'Temeller',
  answer:
    'GEO, markanın ChatGPT, Gemini ve Perplexity gibi yapay zekâ asistanlarının cevaplarında anılması ve kaynak gösterilmesi için yapılan çalışmadır. SEO arama sonuçlarında sıralamayı, GEO ise cevabın içinde yer almayı hedefler.',
  quick: [
    'SEO: Google ve Bing sonuçlarında sıralama ve tıklama.',
    'GEO: yapay zekâ cevaplarında anılma ve kaynak gösterilme.',
    'ASO: App Store ve Google Play’de bulunma ve indirilme.',
    'Temel aynı kalıyor: taranabilir site, soruya doğrudan cevap veren özgün içerik.',
    'Google, AI özellikleri için özel dosya, işaretleme ya da yazım biçimi gerekmediğini söylüyor.',
  ],
  sections: [
    {
      id: 'geo-terimi-nereden-geliyor',
      h2: 'GEO terimi nereden geliyor?',
      blocks: [
        {
          t: 'p',
          text: 'GEO, “Generative Engine Optimization” yani üretken motor optimizasyonu demektir. Terim, Pranjal Aggarwal ve arkadaşlarının 16 Kasım 2023’te yayımladığı “GEO: Generative Engine Optimization” makalesiyle yaygınlaştı. Makale KDD 2024 konferansına kabul edildi.',
          kaynak: ['geo-paper'],
        },
        {
          t: 'p',
          text: 'Makaleye göre önerilen yöntemler, deney ortamında içeriğin üretken motor cevaplarındaki görünürlüğünü %40’a kadar artırdı. Bu bir araştırma sonucudur; her site için vaat değildir.',
          kaynak: ['geo-paper'],
        },
        { t: 'p', text: 'AEO (cevap motoru optimizasyonu) ve LLMO gibi terimler de aynı işi anlatmak için kullanılıyor. Bu rehberde hepsine GEO diyoruz.' },
      ],
    },
    {
      id: 'seo-geo-aso-farki',
      h2: 'SEO, GEO ve ASO arasındaki fark ne?',
      blocks: [
        {
          t: 'table',
          caption: 'SEO, GEO ve ASO karşılaştırması',
          head: ['', 'SEO', 'GEO', 'ASO'],
          rows: [
            ['Hedef yüzey', 'Google ve Bing arama sonuçları', 'ChatGPT, Claude, Gemini, Perplexity gibi asistanların cevapları; Google AI Bakışı', 'App Store ve Google Play arama ve öneriler'],
            ['Başarı ölçüsü', 'Sıralama, gösterim, tıklama', 'Anılma oranı, kaynak gösterilme oranı, ses payı', 'Anahtar kelime sırası, mağaza sayfası dönüşümü, indirme'],
            ['Kim okur?', 'İnsan, sonuç listesinden seçer', 'Önce model okur ve özetler; insan cevabı okur', 'İnsan, mağaza sayfasını okur'],
            ['Nasıl ölçülür?', 'Search Console', 'Asistanlara soru sorup cevapları kaydederek; Google için Search Console’daki Üretken AI raporu', 'App Store Connect, Google Play Console'],
            ['Sonuç ne kadar kararlı?', 'Görece kararlı', 'Aynı soruda bile her seferinde değişebilir', 'Görece kararlı'],
          ],
          kaynak: ['google-ai-guide'],
        },
      ],
    },
    {
      id: 'seo-bitti-mi',
      h2: 'GEO geldi, SEO bitti mi?',
      blocks: [
        {
          t: 'p',
          text: 'Hayır. Google, AI özelliklerinin temel arama sıralama ve kalite sistemleri üzerine kurulduğunu ve SEO’nun en iyi uygulamalarının geçerliliğini koruduğunu söylüyor. Bir sayfanın AI Bakışı’nda kaynak olabilmesi için önce dizine eklenmiş ve snippet ile gösterilmeye uygun olması gerekiyor.',
          kaynak: ['google-ai-guide', 'google-ai-features'],
        },
        { t: 'p', text: 'ChatGPT, Claude, Gemini ve Perplexity web’de arama yaparak cevap verebiliyor. Aramada bulunamayan bir sayfa bu cevaplara kaynak olamaz. Bu yüzden GEO, SEO’nun üzerine kurulur.' },
        {
          t: 'p',
          text: 'Kendi ölçtüğümüz bir örnek: KobiPratik’te (kurucu ekibimizin ortağı olduğu bir site) AI asistanlarında kaynak gösterilme artarken Google’dan gelen günlük tıklama da 3 ayda 52’den 340’a çıktı. İkisi birbirinin yerine geçmedi, birlikte büyüdü.',
          kaynak: ['kp-gsc'],
        },
      ],
    },
    {
      id: 'ne-degismiyor',
      h2: 'GEO’da ne değişmiyor?',
      blocks: [
        {
          t: 'ul',
          items: [
            'Sayfanın taranabilir ve dizine eklenebilir olması.',
            'Soruya doğrudan, açık ve özgün bir cevap vermesi.',
            'Kimin yazdığının ve bilginin nereden geldiğinin belli olması.',
            'Hızlı açılan, düzgün HTML ile yazılmış sayfalar.',
          ],
        },
        {
          t: 'p',
          text: 'Google bunu açıkça yazıyor: üretken AI aramada görünmek için yapısal veri şart değil, özel bir schema.org işaretlemesi yok, içeriği küçük parçalara bölmek gerekmiyor ve AI için farklı yazmak gerekmiyor.',
          kaynak: ['google-ai-guide'],
        },
      ],
    },
    {
      id: 'ne-farkli',
      h2: 'GEO’da ne farklı?',
      blocks: [
        {
          t: 'ul',
          items: [
            '**Ölçü sıralama değil, cevapta yer almak.** “Kaçıncı sıradayım?” yerine “Kaç cevapta anıldım, kaçında kaynak gösterildim?” diye sorulur.',
            '**Botlar ayrışıyor.** Arama botu, eğitim botu ve kullanıcı adına sayfa açan ajan farklı. robots.txt kararını bot bot vermek gerekiyor ([botlar rehberi](/rehber/yapay-zeka-botlari-robots-txt)).',
            '**Sonuç oynak.** Aynı soruya farklı cevaplar gelir. Tek ölçüm yerine oran ve eğilim izlenir ([nasıl test edilir](/rehber/chatgpt-markam-gorunuyor-mu)).',
            '**Başka sitelerdeki anlatım da önemli olabilir.** Asistanlar cevabı birden çok kaynaktan derler; markanın kendi sitesi dışında tutarlı anlatılması bu yüzden işe yarayabilir.',
          ],
        },
      ],
    },
    {
      id: 'yaygin-yanlislar',
      h2: 'GEO hakkında yaygın yanlışlar neler?',
      blocks: [
        {
          t: 'table',
          caption: 'Yanlış ve gerçek',
          head: ['Yaygın inanış', 'Kaynaklar ne diyor?'],
          rows: [
            ['“Yapay zekâda görünmek için llms.txt şart.”', 'Google, Arama’da görünmek için yeni makine-okunur dosya, AI metin dosyası, işaretleme ya da Markdown gerekmediğini ve Arama’nın llms.txt dosyalarını yok saydığını söylüyor ([llms.txt rehberi](/rehber/llms-txt-nedir)).'],
            ['“FAQ şeması eklersem Google’da SSS zengin sonucu çıkar.”', 'Google, 8 Ağustos 2023’ten beri SSS zengin sonuçlarını yalnızca tanınmış, yetkili devlet ve sağlık sitelerinde gösteriyor.'],
            ['“İçeriği yapay zekâ için küçük parçalara bölmek gerekir.”', 'Google’a göre böyle bir gereklilik yok.'],
            ['“GEO, SEO’nun yerine geçer.”', 'Google’ın AI özellikleri temel arama sıralama sistemleri üzerine kurulu; SEO uygulamaları geçerli.'],
            ['“ChatGPT tamamen Bing’den beslenir.”', 'OpenAI’nin kendi arama tarayıcısı OAI-SearchBot var. ChatGPT aramasında hangi kaynağın ne ağırlıkla kullanıldığı açıklanmadı.'],
          ],
          kaynak: ['google-ai-guide', 'google-faq-2023', 'openai-bots'],
        },
      ],
    },
    {
      id: 'nereden-baslamali',
      h2: 'GEO’ya nereden başlamalıyım?',
      blocks: [
        {
          t: 'ol',
          items: [
            'Yapay zekâ botlarının sitene erişebildiğini kontrol et ([robots.txt rehberi](/rehber/yapay-zeka-botlari-robots-txt)).',
            'Alıcılarının sorduğu 5–10 soruyu belirle ve asistanlarda elle test et ([test yöntemi](/rehber/chatgpt-markam-gorunuyor-mu)).',
            'Görünmediğin sorular için o soruya doğrudan cevap veren bir sayfa yaz.',
            'Aynı soruları düzenli olarak yeniden ölç ve eğilime bak.',
          ],
        },
        {
          t: 'p',
          text: 'RanksUp bu döngüyü tek panelde yürütür: 14 kontrollü site SEO/GEO denetimi, ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’te ölçüm ve Profesyonel ve üstü planlarda kaybedilen sorudan içerik üretip yeniden ölçen kapalı döngü. Mobil uygulaman varsa [mobil uygulamalar için GEO rehberine](/rehber/mobil-uygulama-geo) de bak. Planlar [fiyatlandırma sayfasında](/pricing), terimler [sözlükte](/help/glossary).',
        },
      ],
    },
  ],
  faq: [
    {
      q: 'GEO ile AEO aynı şey mi?',
      a: 'Büyük ölçüde evet. İkisi de içeriğin yapay zekâ cevaplarında yer alması için yapılan işi anlatır. Terimler kaynağa göre farklı kullanılıyor ama aynı temellere dayanıyor.',
    },
    {
      q: 'GEO için ayrı bir ajans ya da araç şart mı?',
      a: 'Şart değil. Temel adımları kendin yapabilirsin: bot erişimini kontrol et, soruları elle test et, eksik içerikleri yaz. Araçlar ölçümü düzenli ve birden çok asistanda yapılabilir hale getirir.',
    },
    {
      q: 'GEO sonuçları ne zaman görülür?',
      a: 'Garanti edilebilecek bir süre yok. Web’de arama yapan asistanlar yeni bir sayfayı dizine girdikten sonra kullanabilir. Modelin eğitim bilgisine dayanan cevaplar ise model güncellenene kadar değişmeyebilir.',
    },
    {
      q: 'Yapısal veri (schema) GEO için gerekli mi?',
      a: 'Google’a göre üretken AI aramada görünmek için yapısal veri gerekmez ve özel bir schema.org işaretlemesi yoktur. Google yine de zengin sonuçlara uygunluk için yapısal veri kullanmayı öneriyor.',
    },
    {
      q: 'GEO yalnızca büyük markalar için mi?',
      a: 'Hayır. Dar bir konuda soruya net cevap veren küçük bir site de kaynak gösterilebilir. Önemli olan, alıcının sorduğu soruya doğrudan cevap veren bir sayfanın olmasıdır.',
    },
    {
      q: 'ASO’nun GEO ile ilgisi ne?',
      a: 'Asistanlar uygulama önerirken mağaza sayfalarını sık kaynak gösteriyor. AppTweak’in analizine göre ChatGPT’nin uygulama önerilerindeki alıntıların yaklaşık %47’si mağaza sayfalarına ait. Ayrıntı mobil uygulamalar için GEO rehberinde.',
    },
  ],
  sources: [SRC.geoPaper, SRC.googleAiGuide, SRC.googleAiFeatures, SRC.googleFaq2023, SRC.openaiBots, SRC.apptweak, SRC.kpGsc],
  related: ['chatgpt-markam-gorunuyor-mu', 'llms-txt-nedir', 'ai-bakisi-gorunurluk'],
  published: '2026-10-24',
  schemaType: 'Article',
};
