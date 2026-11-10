import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * NEDEN bu makale (11.11.2026, ranksup.ai Search Console): "ai görünürlüğü", "yapay zeka görünürlük",
 * "ai görünürlük analizi", "google ai görünürlüğü", "perplexity görünürlüğü", "yapay zeka cevaplarında
 * görünürlük" sorgulari /help/ai-visibility yardim sayfasina dusuyordu (sira 26-80). Bu sorulari
 * dogrudan cevaplayan bir rehber yoktu: geo-nedir disiplini, chatgpt-markam-gorunuyor-mu elle testi anlatiyor.
 *
 * Metrik tanimlari iki ayri saticidan (iki-kaynak kurali): Peec AI dokumani (Visibility / Position /
 * Sentiment) ve Semrush bilgi bankasi (AI Visibility Score; Brand Performance "Share of Voice").
 * Fiyat modeli icin tutar YAZILMADI; paketlerin prompt sayisiyla tanimlandigi sources.ts'teki verbatim
 * alintilara dayanir (Otterly "15 search prompts", Peec "50 prompts", Semrush "25 prompts").
 *
 * Urun bilgileri kodla dogrulandi (11.11.2026): 6 asistan, en fazla 5 soru, 100 / 50 / 0 puan, marka adi
 * gecen soru puana girmez, hesap basina 7 gunde 1 olcum (help/ai-visibility); ucretli planda her soru her
 * asistana 3 kez, denemede 1 kez (api audit/citation-repeat.ts, prod CITATION_TEKRAR tanimsiz = 3).
 */
export const article: RehberArticle = {
  slug: 'yapay-zeka-gorunurlugu',
  title: 'Yapay zekâ görünürlüğü nedir, nasıl ölçülür?',
  metaTitle: 'Yapay zekâ görünürlüğü nedir, nasıl ölçülür?',
  description:
    'Yapay zekâ (AI) görünürlüğü, markanın ChatGPT, Gemini ve Perplexity cevaplarında anılması ve kaynak gösterilmesidir. Metrikler ve ölçüm yöntemi.',
  topic: 'Temeller',
  answer:
    'Yapay zekâ görünürlüğü, markanın ChatGPT, Gemini veya Perplexity gibi asistanların cevaplarında ne sıklıkla anıldığı ve sitenin ne sıklıkla kaynak gösterildiğidir. Tek bir cevaba bakılarak değil, aynı soru setini birden çok asistana düzenli sorup sonuçları oran olarak izleyerek ölçülür.',
  quick: [
    'İki temel metrik var: anılma oranı (marka adı cevapta geçti mi) ve kaynak gösterme oranı (cevap sitene bağlantı verdi mi).',
    'Ölçüm, müşterinin soracağı markasız sorularla yapılır. Marka adı geçen sorular tanınırlığı ölçer, görünürlüğü değil.',
    'Her asistan ayrı ölçülür; birinde görünmek diğerinde görünmeyi garanti etmez.',
    'Cevaplar her denemede değişir. Tek ölçüm yerine aynı yöntemle tekrarlanan ölçümlerin eğilimine bakılır.',
    'Google AI Bakışı için ayrıca Search Console’daki Üretken AI performans raporu izlenir.',
  ],
  sections: [
    {
      id: 'neyi-olcer',
      h2: 'Yapay zekâ görünürlüğü neyi ölçer?',
      blocks: [
        {
          t: 'p',
          text: 'Alıcılar artık “hangi firmayı önerirsin?” gibi soruları arama motorunun yanında yapay zekâ asistanlarına da soruyor. Asistan tek bir cevap yazar ve birkaç marka ya da kaynak anar. Yapay zekâ görünürlüğü, markanın bu cevaplarda yer alıp almadığını ve nasıl yer aldığını ölçer.',
        },
        {
          t: 'table',
          caption: 'Yapay zekâ görünürlüğünün temel metrikleri',
          head: ['Metrik', 'Cevapladığı soru', 'Nasıl hesaplanır?'],
          rows: [
            ['Anılma oranı', 'Marka adı cevapta geçiyor mu?', 'Markanın geçtiği cevap sayısı / toplam cevap'],
            ['Kaynak gösterme oranı', 'Cevap sitene bağlantı veriyor mu?', 'Sitene bağlantı veren cevap sayısı / toplam cevap'],
            ['Konum', 'Anıldığında kaçıncı sırada?', 'Cevapta markadan önce anılan marka sayısına ya da paragrafa bakılır'],
            ['Ses payı (rakip payı)', 'Aynı sorularda rakiplere göre ne kadar yer kaplıyor?', 'Markanın anılma sayısı / tüm markaların anılma sayısı'],
            ['Duygu', 'Marka olumlu mu, olumsuz mu anlatılıyor?', 'Markanın anıldığı cümlelerdeki ifadeler olumlu, nötr ya da olumsuz diye sınıflanır'],
          ],
          not: 'İlk iki metrik temel göstergedir; diğerleri markanın nasıl anıldığını ayrıntılandırır.',
        },
        {
          t: 'p',
          text: 'Ölçüm araçları da benzer tanımlar kullanıyor. Peec AI, görünürlüğü markanın AI cevaplarında ne sıklıkla anıldığı, konumu ise markanın göründüğünde diğer markalara göre kaçıncı sırada olduğu diye tanımlıyor. Semrush’ın AI Visibility Score’u, markanın AI cevaplarında ne sıklıkla anıldığını sektördeki güçlü rakiplerin medyan anılma sayısıyla karşılaştırıyor.',
          kaynak: ['peec-docs', 'semrush-score'],
        },
      ],
    },
    {
      id: 'aramadan-farki',
      h2: 'Google’daki görünürlükten farkı ne?',
      blocks: [
        {
          t: 'table',
          caption: 'Klasik arama ile asistan cevabı',
          head: ['', 'Klasik Google araması', 'Yapay zekâ asistanı'],
          rows: [
            ['Kullanıcı ne görür?', 'Sıralı bağlantı listesi', 'Tek bir yazılı cevap ve birkaç kaynak'],
            ['Başarı ne demek?', 'Üst sıralarda çıkmak ve tıklanmak', 'Cevapta anılmak ve kaynak gösterilmek'],
            ['Nasıl ölçülür?', 'Search Console: gösterim, tıklama, ortalama sıra', 'Aynı soruları sorup cevapları kaydetmek; oranları izlemek'],
            ['Sonuç ne kadar sabit?', 'Görece sabit, günler içinde değişir', 'Aynı soruya her seferinde farklı cevap gelebilir'],
          ],
        },
        {
          t: 'p',
          text: 'Google AI Bakışı ikisinin arasında duruyor. Google’a göre sistem, arama dizininden ilgili sayfaları temel sıralama sistemleriyle bulur, cevabı bunlardan üretir ve destekleyen sayfalara bağlantı verir. Bu yüzden Google’da dizinde ve iyi durumda olan sayfalar AI Bakışı’nda da kaynak olabilir. Ayrıntılar [AI Bakışı rehberinde](/rehber/ai-bakisi-gorunurluk).',
          kaynak: ['google-ai-guide', 'google-ai-features'],
        },
      ],
    },
    {
      id: 'nasil-olculur',
      h2: 'Yapay zekâ görünürlüğü nasıl ölçülür?',
      blocks: [
        {
          t: 'ol',
          items: [
            '**Soru setini yaz.** Müşterinin soracağı 5–20 soru seç. Marka adını sorulara koyma.',
            '**Asistanları seç.** Müşterilerinin kullandığı asistanlarla başla; her birini ayrı ölç.',
            '**Soruları web araması açıkken sor.** Kaynak bağlantısı veren cevaplar, asistanın o an web’de arama yaptığını gösterir.',
            '**Her cevabı kaydet.** Marka anıldı mı, sitene bağlantı var mı, hangi rakipler anıldı?',
            '**Oranları hesapla.** Örneğin 5 soru × 3 tur = 15 cevap; bunların 6’sında kaynak gösterildiysen oran %40’tır.',
            '**Aynı yöntemle tekrarla.** Soruları ve yöntemi değiştirmeden haftalık ya da aylık ölç; eğilime bak.',
          ],
        },
        { t: 'p', text: 'Elle test adımlarını ve örnek kayıt tablosunu [ChatGPT’de markam görünüyor mu rehberinde](/rehber/chatgpt-markam-gorunuyor-mu) ayrıntılı anlattık.' },
        {
          t: 'tool',
          title: 'Kendi siteni ücretsiz ölç',
          text: 'Alan adını yaz; sitene uygun alıcı sorularını ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’e soralım, markanın anılıp anılmadığını ve sitenin kaynak gösterilip gösterilmediğini gösterelim. Kayıt gerekmez; aynı ağdan haftada bir test yapılabilir.',
        },
      ],
    },
    {
      id: 'hangi-sorular',
      h2: 'Hangi soruları ölçmeliyim?',
      blocks: [
        { t: 'p', text: 'Ölçüm, sorduğun soru kadar anlamlıdır. Satın alma kararına yakın soruları seç ve bunları türlerine göre grupla.' },
        {
          t: 'table',
          caption: 'Soru türleri',
          head: ['Soru türü', 'Örnek', 'Ne gösterir?'],
          rows: [
            ['Öneri', '“KOBİ’ler için e-fatura programı öner”', 'Kategoride akla gelen markalar arasında mısın?'],
            ['Yerel öneri', '“Bursa’da kurumsal web tasarım ajansı hangisi?”', 'Bölgendeki aramalarda anılıyor musun?'],
            ['Karşılaştırma', '“X ile Y arasındaki fark ne, hangisini seçmeliyim?”', 'Rakiplerle birlikte anıldığında nasıl tarif ediliyorsun?'],
            ['Sorun-çözüm', '“Web sitem neden Google’da çıkmıyor?”', 'Sorunu çözen kaynak olarak seçiliyor musun?'],
            ['Marka adı geçen', '“X firması güvenilir mi?”', 'Tanınırlık ve itibar; görünürlük puanından ayrı tut'],
          ],
        },
        { t: 'p', text: 'Soruları müşterinin dilinde yaz. Türkiye’de satış yapıyorsan Türkçe sor; İngilizce sorular başka kaynakları ve başka rakipleri getirebilir.' },
      ],
    },
    {
      id: 'asistanlar-neden-farkli',
      h2: 'Her asistanda sonuç neden farklı?',
      blocks: [
        {
          t: 'p',
          text: 'Her asistan farklı bir arama altyapısı ve farklı botlar kullanıyor. Örneğin OpenAI, sitelerin ChatGPT arama özelliklerinde gösterilmesi için OAI-SearchBot’u kullanıyor; Perplexity ise siteleri kendi arama sonuçlarında göstermek için PerplexityBot’u kullanıyor. Bir asistanın botu siteye erişemiyorsa o asistan seni kaynak olarak gösteremez.',
          kaynak: ['openai-bots', 'perplexity-bots'],
        },
        {
          t: 'callout',
          title: 'Açıklama',
          text: 'Aşağıdaki örnek KobiPratik’ten. KobiPratik, kurucu ekibimizin ortağı olduğu bir site; bağımsız bir vaka değil, rakamları kaynağı ve dönemiyle veriyoruz.',
        },
        {
          t: 'table',
          caption: 'Aynı site, aynı sorular: asistan başına kaynak gösterme oranı (16 Ekim 2026)',
          head: ['Asistan', 'Kaynak gösterme oranı'],
          rows: [
            ['ChatGPT', '%40'],
            ['Perplexity', '%40'],
            ['Gemini', '%33'],
            ['Claude', '%20'],
          ],
          not: 'Asistan başına 3 tur × 5 soru, yani 15 cevap.',
          kaynak: ['kp-citation'],
        },
        { t: 'p', text: 'Botların tek tek ne yaptığını ve robots.txt ayarlarını [yapay zekâ botları rehberinde](/rehber/yapay-zeka-botlari-robots-txt) anlattık.' },
      ],
    },
    {
      id: 'nasil-yorumlanir',
      h2: 'Sonuçları nasıl yorumlamalıyım?',
      blocks: [
        {
          t: 'p',
          text: 'Oranlar dönemden döneme oynar. KobiPratik’te Perplexity’nin kaynak gösterme oranı günlük ölçümlerde dördüncü ayda %79’a ulaştı, 16 Ekim’deki ölçümde ise %40 çıktı. Bu yüzden tek bir ölçümü kesin sonuç sayma.',
          kaynak: ['kp-perplexity', 'kp-citation'],
        },
        {
          t: 'ul',
          items: [
            '**Eğilime bak.** Aynı soru seti ve aynı yöntemle yapılan ölçümleri karşılaştır.',
            '**Örneklem küçükse temkinli ol.** 15 cevaplık bir ölçüm yönü gösterir; küçük farklar gürültü olabilir.',
            '**“Görünmüyor” ile “yok” aynı değil.** Bir soruda anılmamak, o soru setinde ve o ölçümde görünmediğin anlamına gelir.',
            '**Rakipleri not et.** Senin yerine anılan markalar, hangi içerik ve kaynak eksiğinin olduğunu gösterir.',
          ],
        },
      ],
    },
    {
      id: 'fiyat-neye-gore',
      h2: 'Yapay zekâ görünürlük ölçümünün fiyatı neye göre değişir?',
      blocks: [
        {
          t: 'p',
          text: 'Araçların çoğu paketlerini aylık takip edilen soru (prompt) sayısıyla tanımlıyor; bazıları izlenen asistan sayısını da pakete bağlıyor. Örneğin Otterly, Peec AI ve Semrush paketlerini takip edilen prompt sayısıyla anlatıyor.',
          kaynak: ['otterly', 'peec', 'semrush'],
        },
        {
          t: 'table',
          caption: 'Maliyeti belirleyen kalemler',
          head: ['Kalem', 'Neden önemli?'],
          rows: [
            ['Soru sayısı', 'Her soru her asistana ayrı sorulur; soru arttıkça çağrı sayısı artar'],
            ['Asistan sayısı', 'Altı asistanı ölçmek, birini ölçmenin yaklaşık altı katı çağrı demek'],
            ['Tekrar sayısı', 'Cevaplar oynak olduğu için aynı soruyu birkaç kez sormak sonucu güvenilir kılar ama maliyeti artırır'],
            ['Sıklık', 'Günlük ölçüm haftalık ölçümün yaklaşık yedi katı çağrı demek'],
          ],
        },
        { t: 'p', text: 'Güncel paket fiyatlarını kaynaklarıyla [yapay zekâ görünürlük araçları karşılaştırmasında](/rehber/yapay-zeka-gorunurluk-araclari) topladık.' },
      ],
    },
    {
      id: 'nasil-artirilir',
      h2: 'Yapay zekâ görünürlüğü nasıl artırılır?',
      blocks: [
        {
          t: 'ul',
          items: [
            '**Sorulara doğrudan cevap veren sayfalar yaz.** Görünmediğin soruların çoğunda o soruyu cevaplayan bir sayfan yoktur.',
            '**Botların erişimini kontrol et.** Arama botlarını engelliyorsan asistanlar seni kaynak gösteremez.',
            '**Google’da dizinde ol.** AI Bakışı için tek şart, sayfanın dizinde ve snippet ile gösterilmeye uygun olması.',
            '**Bilgiyi güncel ve tutarlı tut.** Marka adını, ne yaptığını ve fiyat gibi bilgileri sitende açık ve tutarlı yaz.',
          ],
          kaynak: ['google-ai-features'],
        },
        {
          t: 'p',
          text: 'Bu çalışmanın adı GEO (Generative Engine Optimization). Neyin değişip neyin değişmediğini [GEO rehberinde](/rehber/geo-nedir) anlattık. llms.txt gibi dosyaların etkisi ise ölçülmüş değil; bilinenleri [llms.txt rehberinde](/rehber/llms-txt-nedir) topladık.',
        },
      ],
    },
    {
      id: 'ranksup-nasil-olcuyor',
      h2: 'RanksUp yapay zekâ görünürlüğünü nasıl ölçüyor?',
      blocks: [
        {
          t: 'ul',
          items: [
            'Siten için seçilen en fazla 5 markasız soruyu ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’e sorar; altı asistan da web’de arama yaparak cevap verir.',
            'Ücretli planlarda her soru her asistana 3 kez, birbirinden bağımsız sorulur; ücretsiz denemede bir kez.',
            'Puanlama: siten kaynak gösterildiyse 100, marka yalnız anıldıysa 50, hiç geçmiyorsa 0. Marka adı geçen sorular puana girmez.',
            'Skorun yanında güven aralığı gösterilir; iki ölçüm arasındaki fark ancak aralıklar örtüşmüyorsa “arttı” ya da “azaldı” diye yazılır.',
            'Duygu, konum ve rakiplere göre ses payı da ölçülür. Ölçümü sen başlatırsın; hesap başına 7 günde bir ölçüm yapılır.',
          ],
          kaynak: ['ranksup-ai-visibility'],
        },
        { t: 'p', text: 'Ayrıntılar [AI Görünürlük yardım sayfasında](/help/ai-visibility); planlar ve deneme koşulları [fiyatlandırma sayfasında](/pricing).' },
      ],
    },
  ],
  faq: [
    {
      q: 'Yapay zekâ görünürlüğü ile GEO aynı şey mi?',
      a: 'Hayır. Yapay zekâ görünürlüğü ölçülen sonuçtur: markanın asistan cevaplarında ne sıklıkla anıldığı ve kaynak gösterildiği. GEO ise bu sonucu iyileştirmek için yapılan çalışmanın adıdır.',
    },
    {
      q: 'Yapay zekâ görünürlüğü ücretsiz ölçülebilir mi?',
      a: 'Evet. Soruları asistanlara elle sorup cevapları kaydedebilirsin; tek maliyeti zamandır. Birden çok asistanı düzenli izlemek için bir ölçüm aracı işi kolaylaştırır.',
    },
    {
      q: 'Hangi asistanları ölçmeliyim?',
      a: 'Müşterilerinin kullandığı asistanlarla başla. Bilmiyorsan ChatGPT, Gemini ve Perplexity gibi web’de arama yapan asistanlar iyi bir başlangıçtır. Her asistanı ayrı değerlendir; birinde görünmek diğerinde görünmeyi garanti etmez.',
    },
    {
      q: 'Google AI Bakışı yapay zekâ görünürlüğüne dahil mi?',
      a: 'Evet, AI Bakışı Google Arama’daki yapay zekâ özetidir. Ölçümü farklıdır: Google, bu özelliklerdeki performansı görmek için Search Console’daki Üretken AI performans raporunu öneriyor.',
    },
    {
      q: 'Asistan markamı benzer adlı başka bir markayla karıştırıyorsa ne yapmalıyım?',
      a: 'Bu, asistanın markanı tanıdığını ama emin olmadığını gösterir. Sitende marka adını, ne yaptığını ve kim için olduğunu açık ve tutarlı yazmak, başka sitelerde de aynı adla anılmak karışıklığı azaltmaya yardım edebilir.',
    },
    {
      q: 'Bir soruda görünmemek ne anlama gelir?',
      a: 'O soru setinde ve o ölçümde markanın anılmadığı anlamına gelir; markanın kötü olduğu anlamına gelmez. Çoğu zaman o soruya doğrudan cevap veren bir sayfan yoktur ya da asistan başka kaynakları seçmiştir.',
    },
  ],
  sources: [
    SRC.peecDocs, SRC.semrushScore, SRC.googleAiGuide, SRC.googleAiFeatures, SRC.openaiBots, SRC.perplexityBots,
    SRC.otterly, SRC.peec, SRC.semrush, SRC.ranksupAiVisibility, SRC.kpCitation, SRC.kpPerplexity,
  ],
  related: ['chatgpt-markam-gorunuyor-mu', 'geo-nedir', 'yapay-zeka-gorunurluk-araclari', 'ai-bakisi-gorunurluk'],
  published: '2026-11-11',
  schemaType: 'Article',
};
