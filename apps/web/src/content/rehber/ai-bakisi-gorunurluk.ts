import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * "Turkce AI Bakisi Yandex YaCevap'i kaynak gosteriyor" gozlemi ALINMADI: tek kaynak
 * (webtekno, 24.04.2026) tek bir ornege dayaniyor ve gozlemi kimin yaptigi belirtilmiyor;
 * iki-kaynak kuralini gecmedi. Stradiji'nin Turkiye AIO orani da tek kaynak oldugu icin yok.
 *
 * Urun bilgisi kodla dogrulandi: RanksUp AI Bakisi'ni kendisi sorgulamaz; Search Console
 * Uretken AI raporunun tarih tablosu CSV'si Analitik sekmesine yuklenir
 * (components/google-ai-surface-card.tsx, analytics-tab.tsx).
 */
export const article: RehberArticle = {
  slug: 'ai-bakisi-gorunurluk',
  title: 'Google AI Bakışı’nda nasıl görünürsün? (Türkiye)',
  metaTitle: 'Google AI Bakışı’nda nasıl görünülür? (Türkiye)',
  description:
    'Google AI Bakışı Türkiye’de 18 Şubat 2026’dan itibaren kademeli olarak açıldı. Kaynakların nasıl seçildiği, Google’ın resmi kuralları ve kontrol listesi.',
  topic: 'Google',
  answer:
    'AI Bakışı’nda kaynak olmak için sayfanın Google’da dizine eklenmiş ve snippet ile gösterilmeye uygun olması gerekir; Google bunun dışında teknik şart koymuyor. Gerisi iyi SEO ve soruya doğrudan cevap veren içerikle ilgili.',
  quick: [
    'Türkiye’de 18 Şubat 2026’dan itibaren kademeli olarak açıldı (Google Türkiye blogu).',
    'Tek şart: dizine eklenme ve snippet ile gösterilmeye uygunluk. Görünme garantisi yok.',
    'Kaynaklar Google’ın temel sıralama sistemleriyle ve ilgili alt aramalarla (query fan-out) bulunuyor.',
    'llms.txt, özel schema ya da içeriği küçük parçalara bölmek gerekmiyor.',
    'Görünürlüğü Search Console’daki Üretken AI performans raporundan izle.',
  ],
  sections: [
    {
      id: 'turkiyede-ne-zaman-acildi',
      h2: 'AI Bakışı Türkiye’de ne zaman açıldı?',
      blocks: [
        {
          t: 'p',
          text: 'Google Türkiye, 18 Şubat 2026’da AI Modu ve AI Bakışı’nın Türkiye’de kullanıma açıldığını duyurdu. Duyuruya göre özellikler Android ve iOS’taki Google uygulamasında ve arama sonuçlarında kademeli olarak açıldı; AI Modu Gemini 3 ile destekleniyor.',
          kaynak: ['google-tr-blog'],
        },
        {
          t: 'p',
          text: 'Google Arama Yardım’daki Türkçe AI Bakışı sayfasına göre Türkiye ve Türkçe, özelliğin kullanılabildiği ülke ve diller arasında. Aynı sayfa, AI Bakışı’nın hata yapabileceğini de açıkça yazıyor.',
          kaynak: ['google-tr-help'],
        },
      ],
    },
    {
      id: 'kaynaklar-nasil-seciliyor',
      h2: 'Google AI Bakışı’ndaki kaynakları nasıl seçiyor?',
      blocks: [
        {
          t: 'p',
          text: 'Google’ın AI optimizasyon rehberine göre sistem, arama dizininden ilgili ve güncel sayfaları temel arama sıralama sistemleriyle bulur, cevabı bunlardan üretir ve cevabı destekleyen sayfalara tıklanabilir bağlantılar gösterir.',
          kaynak: ['google-ai-guide'],
        },
        {
          t: 'p',
          text: 'Buna ek olarak model, daha fazla bilgi bulmak için soruyla ilgili birkaç alt arama üretir. Google buna “query fan-out” diyor. Yani sayfan yalnızca ana soruda değil, ana sorunun yan sorularında da kaynak olarak seçilebilir.',
          kaynak: ['google-ai-guide', 'google-ai-features'],
        },
        {
          t: 'p',
          text: 'Google’ın AI özellikleri sayfası şartı net koyuyor: sayfa dizine eklenmiş ve Google Arama’da snippet ile gösterilmeye uygun olmalı; ek bir teknik şart yok. Dizine eklenme ve gösterim yine de garanti değil.',
          kaynak: ['google-ai-features'],
        },
      ],
    },
    {
      id: 'ne-gerekmiyor',
      h2: 'AI Bakışı için ne yapmam gerekmiyor?',
      blocks: [
        {
          t: 'ul',
          items: [
            'Yeni makine-okunur dosya, AI metin dosyası (llms.txt gibi), özel işaretleme ya da Markdown.',
            'Üretken AI arama için özel bir schema.org işaretlemesi. Aynı rehber, yapısal veriyi genel SEO stratejisinin parçası olarak kullanmaya devam etmeyi öneriyor; Google Arama’daki diğer zengin sonuçlara uygunluğa yardım ediyor.',
            'İçeriği yapay zekâ için küçük parçalara bölmek.',
            'Yapay zekâ için farklı bir yazım biçimi. Google’a göre sistemler eş anlamlıları ve genel anlamı anlıyor.',
          ],
          kaynak: ['google-ai-guide'],
        },
        { t: 'p', text: 'llms.txt hakkında bilinenleri [ayrı bir rehberde](/rehber/llms-txt-nedir) topladık.' },
      ],
    },
    {
      id: 'kontrol-listesi',
      h2: 'Pratik kontrol listesi nedir?',
      blocks: [
        {
          t: 'table',
          caption: 'AI Bakışı kontrol listesi',
          head: ['Kontrol', 'Nasıl yapılır?', 'Neden?'],
          rows: [
            ['Sayfa dizinde mi?', 'Search Console → URL denetimi', 'Google’ın tek şartının ilk yarısı'],
            ['Snippet engeli var mı?', 'Sayfada nosnippet, max-snippet ve data-nosnippet kullanımını kontrol et', 'Şartın ikinci yarısı: snippet ile gösterilmeye uygunluk'],
            ['Googlebot engelli mi?', 'robots.txt’de Googlebot kurallarını kontrol et', 'Taranamayan sayfa dizine giremez; Google-Extended bu konuda belirleyici değil'],
            ['Sayfa soruya doğrudan cevap veriyor mu?', 'Cevabı ilk paragrafta, kısa cümlelerle ver', 'Sistem cevabı destekleyen sayfalara bağlantı veriyor'],
            ['Yan soruları kapsıyor mu?', 'Ana sorunun alt sorularını ayrı başlıklarda cevapla', 'Query fan-out ilgili alt aramalar üretiyor'],
            ['Bilgi güncel mi?', 'Tarih, fiyat ve sürüm bilgisini güncelle; “Son güncelleme” göster', 'Sistem güncel sayfaları arıyor'],
            ['Sonucu izliyor musun?', 'Search Console → Üretken AI performans raporu', 'Neyin işe yaradığını ancak ölçerek görürsün'],
          ],
          kaynak: ['google-ai-features', 'google-ai-guide'],
        },
      ],
    },
    {
      id: 'nasil-olculur',
      h2: 'AI Bakışı görünürlüğümü nasıl ölçerim?',
      blocks: [
        {
          t: 'p',
          text: 'Google’ın Temmuz 2026 rehberi, içeriğin Google Arama’daki üretken AI özelliklerinde nasıl performans gösterdiğini görmek için Search Console’daki Üretken AI performans raporunu öneriyor. Google’ın AI özellikleri sayfasına göre bu özelliklerden gelen trafik, Performans raporunda genel Web trafiğine de dahil.',
          kaynak: ['google-ai-guide', 'google-ai-features'],
        },
        {
          t: 'p',
          text: 'RanksUp, AI Bakışı’nı kendisi sorgulayarak ölçmez. Search Console’daki Üretken AI raporundan dışa aktardığın tarih tablosunu (CSV) RanksUp’ın Analitik sekmesine yükleyip gösterimleri zaman içinde izleyebilirsin. Bu dosyada AI Bakışı ile AI Modu ayrılmıyor. ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’teki görünürlüğü ise RanksUp doğrudan ölçer ([nasıl ölçülür](/rehber/chatgpt-markam-gorunuyor-mu)).',
        },
      ],
    },
    {
      id: 'ai-bakisini-engellemek',
      h2: 'Sitemi AI Bakışı’ndan çıkarmak istersem ne yapmalıyım?',
      blocks: [
        {
          t: 'p',
          text: 'Google, bu özelliklerde gösterilen içeriği nosnippet, data-nosnippet, max-snippet ya da noindex ile sınırlamayı öneriyor. Bu kontroller normal arama sonuçlarındaki snippet’ları da etkiler. Google-Extended ise AI Bakışı’nı değil, Gemini eğitimini ve Gemini uygulamalarındaki grounding kullanımını yönetir; Google Arama’ya dahil olmayı etkilemez.',
          kaynak: ['google-ai-features', 'google-crawlers'],
        },
        { t: 'p', text: 'Bot bot ayrıntı için [yapay zekâ botları ve robots.txt rehberine](/rehber/yapay-zeka-botlari-robots-txt) bak.' },
      ],
    },
    {
      id: 'neyi-bilmiyoruz',
      h2: 'AI Bakışı hakkında neyi bilmiyoruz?',
      blocks: [
        {
          t: 'ul',
          items: [
            'Google, belirli bir sayfanın neden kaynak seçildiğini sayfa bazında açıklamıyor.',
            'Türkiye’de AI Bakışı’nın hangi sorgularda ne sıklıkla çıktığına ve tıklamalara etkisine dair bağımsız ve tekrarlanmış bir çalışma görmedik. Tek kaynağa dayanan oranları bu yüzden buraya almadık.',
            'Sosyal medyada paylaşılan tekil örnekler (belirli bir sitenin AI Bakışı’nda sık kaynak gösterildiği gibi) genel bir kural göstermez.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: 'AI Bakışı Türkçe aramalarda çıkıyor mu?',
      a: 'Evet. Google Arama Yardım sayfasında Türkiye ve Türkçe, AI Bakışı’nın kullanılabildiği ülke ve diller arasında yer alıyor. Özellik Türkiye’de 18 Şubat 2026’dan itibaren kademeli olarak açıldı.',
    },
    {
      q: 'AI Bakışı için özel bir optimizasyon gerekiyor mu?',
      a: 'Google’a göre hayır. Sayfanın dizine eklenmiş ve snippet ile gösterilmeye uygun olması yeterli; ek bir teknik şart ya da özel optimizasyon yok. Görünmek yine de garanti değil.',
    },
    {
      q: 'AI Bakışı trafiğini Search Console’da görebilir miyim?',
      a: 'Evet. Google, üretken AI özelliklerindeki performansı görmek için Search Console’daki Üretken AI performans raporunu öneriyor. Bu özelliklerden gelen trafik Performans raporundaki genel Web trafiğine de dahil.',
    },
    {
      q: 'Sitemi AI Bakışı’ndan çıkarabilir miyim?',
      a: 'Google, gösterilen içeriği nosnippet, data-nosnippet, max-snippet ya da noindex ile sınırlamanı öneriyor. Bu kontroller normal arama sonuçlarındaki snippet’ları da etkiler.',
    },
    {
      q: 'Google-Extended’i engellersem AI Bakışı’ndan çıkar mıyım?',
      a: 'Hayır. Google-Extended, Gemini modellerinin eğitimi ve Gemini uygulamalarındaki grounding için içerik kullanımını yönetir. Google’a göre Google Arama’ya dahil olmayı etkilemez.',
    },
    {
      q: 'RanksUp AI Bakışı’nı ölçüyor mu?',
      a: 'Doğrudan değil. Search Console’un Üretken AI raporundan dışa aktardığın tarih tablosunu RanksUp’a yükleyip gösterimleri izleyebilirsin. RanksUp’ın kendi ölçümü ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’te yapılır.',
    },
  ],
  sources: [SRC.googleTrBlog, SRC.googleTrHelp, SRC.googleAiGuide, SRC.googleAiFeatures, SRC.googleCrawlers],
  related: ['geo-nedir', 'llms-txt-nedir', 'yapay-zeka-botlari-robots-txt'],
  published: '2026-10-24',
  schemaType: 'Article',
};
