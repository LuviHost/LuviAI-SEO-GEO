import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * NEDEN (25.11.2026): Google Keyword Planner (Turkiye, Turkce) "google ai mode" 4.400 aylik arama;
 * sitede bu konuya ayrilmis sayfa yoktu (AI Bakisi rehberi AI Modu'na yalniz birkac cumleyle
 * deginiyordu). Ayni olcumde "yapay zeka görünürlüğü" 10 aylik arama.
 *
 * Kaynaklar 25.11.2026'da okundu, her iddia en az iki Google kaynagina dayanir:
 *  - Google Arama Yardim (TR) AI Modu: "AI Modu, Google'ın en güçlü yapay zeka destekli arama
 *    deneyimidir." · "Sorunuz alt konulara bölünür ve her biri aynı anda aranır." · "AI Modu, yapay
 *    zeka destekli bir yanıtın kalitesi veya faydasından yeterince emin olamadığında bir dizi web
 *    bağlantısı sağlar." · erisim: google.com/ai ve arama cubugundaki AI Modu · desteklenen ulke ve
 *    diller listesinde Turkiye ve Turkce. Kapatma secenegi anlatilmiyor (bu yuzden yazilmadi).
 *  - AI features and your website: "Both AI Overviews and AI Mode may use a "query fan-out"
 *    technique" · "There are no additional requirements to appear in AI Overviews or AI Mode, nor
 *    other special optimizations necessary." · "AI Mode and AI Overviews may use different models and
 *    techniques, so the set of responses and links they show will vary." · Performance raporunda
 *    "Web" arama turunde · nosnippet, data-nosnippet, max-snippet, noindex.
 *  - Search Console Yardim, Generative AI performance report: AI Overviews ve AI Mode gosterimleri;
 *    "As of August 31, 2026, we've rolled out these insights to all websites worldwide." · yalniz
 *    gosterim tanimi var, tiklama yok · Search Labs deneyleri dahil degil.
 *  - Google Turkiye blogu (18.02.2026): AI Modu ve AI Bakisi Turkiye'de kademeli acildi, AI Modu Gemini 3.
 * Urun bilgisi kodla dogrulandi: AI Modu her planda (deneme dahil) olculur, DataForSEO anahtarina bagli
 * (api billing/plans.ts GOOGLE_SURFACES); organik sira ayni yanittan (api google-ai-surfaces.ts, 24.11.2026).
 * Ucretsiz test AI Modu'nu OLCMEZ (ChatGPT, Gemini, Claude, Perplexity) — tool metni bu yuzden asistan der.
 */
export const article: RehberArticle = {
  slug: 'google-ai-modu',
  title: 'Google AI Modu (AI Mode) nedir, markan nasıl görünür?',
  metaTitle: 'Google AI Mode (AI Modu) nedir, nasıl görünülür?',
  description:
    'Google AI Mode nedir, Türkiye’de nasıl kullanılır, AI Bakışı’ndan farkı ne? Kaynak seçimi, Search Console’da ölçüm ve görünmek için kontrol listesi.',
  topic: 'Google',
  answer:
    'Google AI Modu (AI Mode), soruyu alt konulara bölüp her birini aynı anda arayan ve kaynak bağlantılı tek cevap yazan yapay zekâ arama deneyimidir. Kaynak olmak için sayfanın dizinde ve snippet’e uygun olması yeterli; özel bir optimizasyon gerekmiyor.',
  quick: [
    'AI Modu, Google’ın sohbet biçimindeki yapay zekâ arama deneyimi; google.com/ai adresinden ya da arama çubuğundaki AI Modu seçeneğinden açılıyor.',
    'Türkiye’de 18 Şubat 2026’dan itibaren kademeli olarak açıldı; Türkçe destekleniyor.',
    'Soruyu alt konulara bölüp her birini aynı anda arıyor (query fan-out), sonuçları tek cevapta birleştiriyor.',
    'AI Bakışı ile aynı şart geçerli: dizine eklenme ve snippet’e uygunluk. Ama farklı modeller kullanabildiği için gösterdiği bağlantılar farklı olabilir.',
    'Search Console’da AI Modu trafiği Performans raporunun Web türünde; Üretken AI raporu ayrıca gösterim sayısını veriyor.',
  ],
  sections: [
    {
      id: 'ai-modu-nedir',
      h2: 'Google AI Modu nedir?',
      blocks: [
        {
          t: 'p',
          text: 'Google Arama Yardım, AI Modu’nu “Google’ın en güçlü yapay zeka destekli arama deneyimi” olarak tanımlıyor. Klasik arama sonuç listesinin yerine soruyu yapay zekâyla cevaplıyor, cevabın içinde ve yanında web’deki kaynaklara bağlantı veriyor. Takip sorusu sorarak sohbet gibi devam edebiliyorsun.',
          kaynak: ['google-ai-mode-help'],
        },
        {
          t: 'p',
          text: 'Google’a göre AI Modu, yapay zekâ cevabının kalitesinden ya da faydasından yeterince emin olamadığında cevap yerine bir dizi web bağlantısı gösteriyor. Yani her soruda yapay zekâ cevabı çıkmıyor.',
          kaynak: ['google-ai-mode-help'],
        },
      ],
    },
    {
      id: 'turkiyede-nasil-kullanilir',
      h2: 'AI Modu Türkiye’de nasıl kullanılır?',
      blocks: [
        {
          t: 'p',
          text: 'Google Türkiye, 18 Şubat 2026’da AI Modu ve AI Bakışı’nın Türkiye’de kullanıma açıldığını duyurdu. Özellikler Android ve iOS’taki Google uygulamasında ve arama sonuçlarında kademeli olarak açıldı; duyuruya göre AI Modu Gemini 3 ile destekleniyor. Google Arama Yardım’daki AI Modu sayfasında da Türkiye ve Türkçe, desteklenen ülke ve diller arasında.',
          kaynak: ['google-tr-blog', 'google-ai-mode-help'],
        },
        {
          t: 'ul',
          items: [
            'Tarayıcıdan **google.com/ai** adresine git.',
            'Google’da bir soru yaz ve sonuç sayfasında **AI Modu** seçeneğine dokun.',
            'Google uygulamasının ana ekranındaki AI Modu girişini kullan.',
          ],
          kaynak: ['google-ai-mode-help'],
        },
      ],
    },
    {
      id: 'nasil-calisir',
      h2: 'AI Modu cevabı nasıl hazırlıyor?',
      blocks: [
        {
          t: 'p',
          text: 'Google’ın anlatımına göre AI Modu soruyu alt konulara böler ve her alt konuyu farklı veri kaynaklarında aynı anda arar; sonra sonuçları anlaşılır tek bir cevapta birleştirir. Google bu tekniğe “query fan-out” (Türkçe yardım sayfasında “sorgu yayılımı”) diyor. Search Central belgesi aynı tekniği hem AI Modu hem AI Bakışı için anlatıyor.',
          kaynak: ['google-ai-mode-help', 'google-ai-features'],
        },
        {
          t: 'p',
          text: 'Site sahibi için anlamı şu: sayfan yalnızca kullanıcının yazdığı soruda değil, modelin ürettiği yan sorularda da kaynak olarak seçilebilir. Örneğin (bizim örneğimiz) “İstanbul’da kurumsal web sitesi yaptırmak” gibi bir soru fiyat, süre, ajans seçimi ve altyapı gibi alt aramalara bölünebilir. Bu yan sorulara ayrı başlıklarda doğrudan cevap veren sayfa, daha çok alt aramada aday olur.',
        },
      ],
    },
    {
      id: 'ai-bakisi-ile-farki',
      h2: 'AI Modu ile AI Bakışı arasındaki fark ne?',
      blocks: [
        {
          t: 'table',
          caption: 'Google AI Modu ve AI Bakışı karşılaştırması',
          head: ['', 'AI Modu (AI Mode)', 'AI Bakışı (AI Overviews)'],
          rows: [
            ['Nerede çıkıyor?', 'Ayrı bir arama deneyimi: google.com/ai ya da AI Modu seçeneği', 'Normal arama sonuçlarının üstünde, Google gerekli gördüğünde'],
            ['Nasıl kullanılıyor?', 'Sohbet gibi; takip soruları sorulabiliyor', 'Tek seferlik özet'],
            ['Kaynak bulma', 'Query fan-out ile alt aramalar', 'Query fan-out ile alt aramalar'],
            ['Kaynak olma şartı', 'Dizine eklenme ve snippet’e uygunluk', 'Dizine eklenme ve snippet’e uygunluk'],
            ['Gösterilen bağlantılar', 'Farklı model kullanabildiği için AI Bakışı’ndan farklı olabilir', 'Farklı model kullanabildiği için AI Modu’ndan farklı olabilir'],
            ['Search Console', 'Performans → Web; Üretken AI raporunda gösterim', 'Performans → Web; Üretken AI raporunda gösterim'],
          ],
          kaynak: ['google-ai-features', 'google-ai-mode-help', 'gsc-genai-report'],
        },
        { t: 'p', text: 'AI Bakışı’nın ayrıntılarını (Türkiye’de açılışı, kapatılıp kapatılamayacağı) [AI Bakışı rehberinde](/rehber/ai-bakisi-gorunurluk) anlattık.' },
      ],
    },
    {
      id: 'kaynak-olmak-icin-ne-gerekir',
      h2: 'AI Modu’nda kaynak gösterilmek için ne gerekir?',
      blocks: [
        {
          t: 'p',
          text: 'Google’ın şartı tek cümle: sayfa dizine eklenmiş ve Google Arama’da snippet ile gösterilmeye uygun olmalı. Google, AI Bakışı ya da AI Modu’nda görünmek için ek bir şart ya da özel bir optimizasyon olmadığını açıkça yazıyor. Şartı sağlamak görünmeyi garanti etmiyor.',
          kaynak: ['google-ai-features', 'google-ai-guide'],
        },
        {
          t: 'table',
          caption: 'AI Modu kontrol listesi',
          head: ['Kontrol', 'Nasıl yapılır?', 'Neden?'],
          rows: [
            ['Sayfa dizinde mi?', 'Search Console → URL denetimi', 'Şartın ilk yarısı'],
            ['Snippet engeli var mı?', 'nosnippet, max-snippet ve data-nosnippet kullanımını kontrol et', 'Şartın ikinci yarısı'],
            ['Googlebot taranabiliyor mu?', 'robots.txt’de Googlebot kurallarını kontrol et', 'Taranamayan sayfa dizine giremez'],
            ['Ana soruya ilk paragrafta cevap var mı?', 'Cevabı ilk cümlelerde, kısa ve net ver', 'Cevap, onu destekleyen sayfalara bağlanıyor'],
            ['Yan sorular ayrı başlıklarda mı?', 'Fiyat, süre, karşılaştırma, nasıl yapılır gibi alt soruları ayrı başlıkla cevapla', 'Query fan-out alt aramalar üretiyor'],
            ['Bilgi güncel mi?', 'Tarih, fiyat ve sürüm bilgisini güncel tut', 'Sistem ilgili ve güncel sayfaları arıyor'],
          ],
          kaynak: ['google-ai-features', 'google-ai-guide'],
        },
        { t: 'p', text: 'llms.txt, özel schema ya da içeriği küçük parçalara bölmek gerekmiyor; Google bunu AI rehberinde açıkça söylüyor. Ayrıntı: [llms.txt nedir](/rehber/llms-txt-nedir).', kaynak: ['google-ai-guide'] },
      ],
    },
    {
      id: 'nasil-olculur',
      h2: 'AI Modu görünürlüğümü nasıl ölçerim?',
      blocks: [
        {
          t: 'p',
          text: 'Search Console’da AI Modu’ndan gelen trafik, Performans raporunda Web arama türünün içinde sayılıyor; ayrı bir “AI Modu” filtresi yok. Üretken AI performans raporu ise AI Bakışı ve AI Modu’ndaki gösterimleri veriyor. Google’a göre bu rapor 31 Ağustos 2026’dan beri bütün sitelerde açık; yalnız gösterim sayısını gösteriyor, Search Labs deneylerini kapsamıyor.',
          kaynak: ['google-ai-features', 'gsc-genai-report'],
        },
        {
          t: 'p',
          text: 'Search Console hangi soruda, hangi rakiple birlikte çıktığını söylemiyor. RanksUp sektörüne dair soruları Türkiye’den Google AI Modu’nda sorar, cevapta markanın ya da sitenin geçip geçmediğine ve yanında hangi rakiplerin anıldığına bakar. Aynı aramada sitenin Google organik sırasını da gösterir. AI Modu ölçümü her planda (deneme dahil) var. ChatGPT, Gemini, Claude ve Perplexity’de [nasıl ölçüldüğünü ayrı rehberde](/rehber/chatgpt-markam-gorunuyor-mu) anlattık.',
        },
        {
          t: 'tool',
          title: 'Yapay zekâ asistanlarında ücretsiz test et',
          text: 'Alan adını yaz; sitene uygun alıcı sorularını ChatGPT, Gemini, Claude ve Perplexity’ye soralım, markanın anılıp anılmadığını ve sitenin kaynak gösterilip gösterilmediğini gösterelim. Ücretsiz, kayıt gerekmez; aynı ağdan haftada bir test yapılabilir.',
        },
      ],
    },
    {
      id: 'ai-modundan-cikmak',
      h2: 'Sitemi AI Modu’ndan çıkarmak istersem ne yapmalıyım?',
      blocks: [
        {
          t: 'p',
          text: 'Google, aramada sayfalarından gösterilen bilgiyi nosnippet, data-nosnippet, max-snippet ya da noindex ile sınırlamayı öneriyor. Bu kontroller normal arama sonuçlarındaki snippet’ları da etkiler. Google-Extended ise Google Arama’yı değil, Gemini eğitimi ve Google’ın bazı diğer sistemlerindeki kullanımı yönetiyor. Bot bot ayrıntı: [yapay zekâ botları ve robots.txt](/rehber/yapay-zeka-botlari-robots-txt).',
          kaynak: ['google-ai-features', 'google-crawlers'],
        },
      ],
    },
    {
      id: 'neyi-bilmiyoruz',
      h2: 'AI Modu hakkında neyi bilmiyoruz?',
      blocks: [
        {
          t: 'ul',
          items: [
            'Google, belirli bir sayfanın AI Modu’nda neden kaynak seçildiğini sayfa bazında açıklamıyor.',
            'Search Console’da AI Modu’na özel tıklama sayısı yok; Üretken AI raporu yalnız gösterim veriyor.',
            'Türkiye’de AI Modu’nun ne kadar kullanıldığına ve sitelere ne kadar tıklama getirdiğine dair bağımsız, tekrarlanmış bir çalışma görmedik.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: 'Google AI Mode Türkiye’de var mı?',
      a: 'Evet. Google Türkiye, AI Modu’nun 18 Şubat 2026’dan itibaren Türkiye’de kademeli olarak açıldığını duyurdu. Google Arama Yardım’da da Türkiye ve Türkçe desteklenen ülke ve diller arasında.',
    },
    {
      q: 'AI Modu’na nasıl girilir?',
      a: 'Tarayıcıdan google.com/ai adresine gidebilir, Google’da arama yaptıktan sonra AI Modu seçeneğine dokunabilir ya da Google uygulamasının ana ekranındaki AI Modu girişini kullanabilirsin.',
    },
    {
      q: 'AI Modu ile AI Bakışı aynı şey mi?',
      a: 'Hayır. AI Bakışı normal arama sonuçlarının üstünde çıkan bir özet; AI Modu ise takip sorusu sorulabilen ayrı bir arama deneyimi. İkisi de query fan-out kullanabilir, ama farklı modeller kullanabildikleri için gösterdikleri bağlantılar farklı olabilir.',
    },
    {
      q: 'AI Modu’nda görünmek için özel bir şey yapmam gerekiyor mu?',
      a: 'Google’a göre hayır. Sayfanın dizine eklenmiş ve snippet ile gösterilmeye uygun olması yeterli; ek bir teknik şart ya da özel optimizasyon yok. Görünmek yine de garanti değil.',
    },
    {
      q: 'AI Modu trafiğini Search Console’da görebilir miyim?',
      a: 'Evet. AI Modu’ndan gelen trafik Performans raporunda Web arama türünün içinde sayılıyor. Üretken AI performans raporu ise AI Bakışı ve AI Modu’ndaki gösterimleri veriyor.',
    },
    {
      q: 'AI Modu her soruda yapay zekâ cevabı veriyor mu?',
      a: 'Hayır. Google’a göre AI Modu, yapay zekâ cevabının kalitesinden ya da faydasından yeterince emin olamadığında cevap yerine bir dizi web bağlantısı gösteriyor.',
    },
    {
      q: 'RanksUp AI Modu’nu ölçüyor mu?',
      a: 'Evet. Sektörüne dair sorular Türkiye’den Google AI Modu’nda sorulur; cevapta markanın ya da siten geçiyor mu, yanında hangi rakipler anılıyor bakılır. Aynı aramada sitenin Google organik sırası da gösterilir. Bu ölçüm her planda var.',
    },
  ],
  sources: [SRC.googleAiModeHelp, SRC.googleTrBlog, SRC.googleAiFeatures, SRC.googleAiGuide, SRC.gscGenAiReport, SRC.googleCrawlers],
  related: ['ai-bakisi-gorunurluk', 'yapay-zeka-gorunurlugu', 'chatgpt-markam-gorunuyor-mu'],
  published: '2026-11-25',
  schemaType: 'Article',
};
