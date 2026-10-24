import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * Urun bilgileri kodla dogrulandi (24.10.2026): olculen 6 asistan ve web aramasi yalniz
 * ChatGPT / Claude / Gemini / Perplexity'de (api audit/ai-citation.service.ts), en fazla 5 soru,
 * puan 100 / 50 / 0 ve marka adi gecen sorular puana girmez (help/ai-visibility), hesap
 * basina 7 gunde 1 olcum (billing/measurement-allowance.ts).
 */
export const article: RehberArticle = {
  slug: 'chatgpt-markam-gorunuyor-mu',
  title: 'ChatGPT’de markam görünüyor mu, nasıl anlarım?',
  metaTitle: 'ChatGPT’de markam görünüyor mu? Test yöntemi',
  description:
    'ChatGPT’de markan anılıyor mu, siten kaynak gösteriliyor mu? Ücretsiz elle test yöntemi, sonuçların neden değiştiği ve ölçülmüş bir örnek.',
  topic: 'Ölçüm',
  answer:
    'Bunu anlamanın yolu, müşterilerinin soracağı soruları oturum açmadan ChatGPT’ye birkaç kez sorup markanın anılıp anılmadığını ve sitenin kaynak gösterilip gösterilmediğini kaydetmektir. Tek bir deneme yetmez, çünkü aynı soruya her seferinde farklı bir cevap gelebilir.',
  quick: [
    'Alıcının ağzından 5–10 soru yaz. Marka adını soruya koyma.',
    'Her soruyu en az 3 kez, oturum kapalıyken ya da gizli pencerede ve her seferinde yeni sohbette sor.',
    'İki şeyi ayrı not et: marka adı geçti mi, sitene bağlantı (kaynak) verildi mi.',
    'Sonucu oran olarak yaz: kaynak gösterilen cevap sayısı / toplam cevap.',
    'Aynı soruları aynı yöntemle düzenli tekrarla; tek ölçüm yerine eğilime bak.',
  ],
  sections: [
    {
      id: 'kendim-nasil-test-ederim',
      h2: 'Kendim nasıl test ederim?',
      blocks: [
        { t: 'p', text: 'Elle test ücretsizdir ve yaklaşık yarım saat sürer. Önemli olan, her seferinde aynı yöntemi kullanmaktır.' },
        {
          t: 'ol',
          items: [
            '**Soruları alıcı gibi yaz.** “İstanbul’da KOBİ’ler için muhasebe yazılımı öner” gibi, müşterinin gerçekten soracağı cümleler kullan. “X markası iyi mi?” gibi marka adı geçen sorular tanınırlığı ölçer, görünürlüğü değil; onları ayrı tut.',
            '**Kişiselleştirmeyi kapat.** Oturum açmadan ya da gizli pencerede dene. Oturum açıkken sohbet geçmişi ve kayıtlı tercihler cevabı etkileyebilir.',
            '**Web aramasının çalışıp çalışmadığına bak.** Cevabın içinde ya da altında kaynak bağlantıları varsa ChatGPT web’de arama yapmıştır. Bağlantı yoksa cevap büyük olasılıkla modelin kendi bilgisinden gelir; bu durumda markan ancak modelin eğitim bilgisinde varsa anılır.',
            '**Her soruyu en az 3 kez sor.** Her turu yeni bir sohbette başlat; önceki cevap bir sonrakini etkilemesin.',
            '**Sonucu tabloya yaz.** Soru, tur, marka anıldı mı, sitene bağlantı var mı ve hangi rakipler anıldı.',
            '**Oranı hesapla.** Örneğin 5 soru × 3 tur = 15 cevap. Bunların 6’sında siten kaynak gösterildiyse kaynak gösterme oranın %40’tır.',
          ],
        },
        {
          t: 'table',
          caption: 'Örnek kayıt tablosu',
          head: ['Soru', 'Tur', 'Marka anıldı mı?', 'Sitene bağlantı var mı?', 'Anılan rakipler'],
          rows: [
            ['KOBİ’ler için muhasebe yazılımı öner', '1', 'Evet', 'Hayır', 'Rakip A, Rakip B'],
            ['KOBİ’ler için muhasebe yazılımı öner', '2', 'Evet', 'Evet', 'Rakip A'],
            ['KOBİ’ler için muhasebe yazılımı öner', '3', 'Hayır', 'Hayır', 'Rakip A, Rakip C'],
          ],
          not: 'Rakam yerine “Evet / Hayır” yaz; oranı en sonda hesapla.',
        },
      ],
    },
    {
      id: 'anilma-ve-kaynak-gosterilme',
      h2: '“Anılma” ile “kaynak gösterilme” arasındaki fark ne?',
      blocks: [
        { t: 'p', text: 'İkisi farklı şeyleri ölçer. Anılma, marka adının cevap metninde geçmesidir. Kaynak gösterilme ise cevabın senin sitene bağlantı vermesidir.' },
        {
          t: 'table',
          caption: 'Üç olası sonuç',
          head: ['Durum', 'Ne görürsün?', 'Ne anlama gelir?'],
          rows: [
            ['Kaynak gösterildi', 'Cevapta sitene giden bir bağlantı var', 'Asistan sayfanı kaynak olarak gösterdi; trafik gelebilir'],
            ['Yalnız anıldı', 'Marka adı geçiyor, bağlantı yok', 'Marka biliniyor ama sayfan kaynak olarak seçilmedi'],
            ['Yok', 'Ne ad ne bağlantı', 'Bu soruda görünmüyorsun; hangi rakiplerin anıldığını not et'],
          ],
        },
        { t: 'p', text: 'Bir durum daha var: siten bağlantı olarak çıkar ama marka adın metinde geçmez. Okuyucu bağlantıya tıklamazsa markanı hiç görmez. Sayfanda marka adını ve ne yaptığını açıkça yazmak bu farkı kapatmaya yardım edebilir.' },
      ],
    },
    {
      id: 'sonuclar-neden-degisiyor',
      h2: 'Sonuçlar neden her denemede değişiyor?',
      blocks: [
        {
          t: 'ul',
          items: [
            'Dil modelleri cevabı her seferinde yeniden üretir. Aynı soruya farklı cevap gelmesi normaldir.',
            'Web araması açıksa, o an bulunan kaynaklar değişebilir.',
            'Sorunun ifadesi, dili ve konum sonucu etkiler.',
            'Modeller ve arama altyapısı zamanla güncellenir.',
          ],
        },
        { t: 'p', text: 'Bu yüzden tek bir ekran görüntüsü kanıt değildir. Birkaç tur, bir oran ve zaman içindeki eğilim gerekir.' },
      ],
    },
    {
      id: 'botlar-siteme-erisebiliyor-mu',
      h2: 'ChatGPT’nin botu siteme erişebiliyor mu?',
      blocks: [
        {
          t: 'p',
          text: 'ChatGPT aramasında kaynak olmak için OpenAI’nin arama botu **OAI-SearchBot**’un sitene erişebilmesi gerekir. OpenAI’ye göre bu bot, sitelerin ChatGPT arama özelliklerinde gösterilmesi için kullanılır ve robots.txt değişikliğinin sistemlere yansıması yaklaşık 24 saat sürebilir. GPTBot’u (içeriğin model eğitiminde kullanılmasıyla ilgili bot) engellemek bu ayarı etkilemez; OpenAI her ayarın birbirinden bağımsız olduğunu söylüyor.',
          kaynak: ['openai-bots'],
        },
        { t: 'p', text: 'Botların tek tek ne yaptığını ve hazır robots.txt örneklerini [yapay zekâ botları ve robots.txt rehberinde](/rehber/yapay-zeka-botlari-robots-txt) anlattık.' },
      ],
    },
    {
      id: 'ranksup-nasil-olcuyor',
      h2: 'RanksUp bunu nasıl ölçüyor?',
      blocks: [
        { t: 'p', text: 'RanksUp benzer bir yöntemi altı asistanda otomatik uygular. Bir fark var: elle testte her soruyu 3 kez sormanı öneriyoruz, RanksUp ise her ölçümde her soruyu bir kez sorar ve oynaklığı haftalık ölçümler arasındaki eğilimle izler. Ölçüm şöyle çalışır:' },
        {
          t: 'ul',
          items: [
            'Siten için seçilen en fazla 5 soruyu ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’e sorar.',
            'ChatGPT, Claude, Gemini ve Perplexity ölçümde web’de arama yaparak cevap verir. Grok ve DeepSeek ölçümünde web araması yoktur; cevap modelin kendi bilgisinden gelir.',
            'Puanlama: siten kaynak gösterildiyse 100, marka yalnız anıldıysa 50, hiç geçmiyorsa 0. Marka adı geçen sorular puana girmez.',
            'Ölçümü sen başlatırsın. Hesap başına 7 günde bir ölçüm yapılır ve tüm sitelerin bu hakkı paylaşır.',
          ],
          kaynak: ['ranksup-ai-visibility'],
        },
        { t: 'p', text: 'Ayrıntılar [AI Görünürlük yardım sayfasında](/help/ai-visibility). Planlar ve deneme koşulları [fiyatlandırma sayfasında](/pricing).' },
      ],
    },
    {
      id: 'kobipratik-ornegi',
      h2: 'Gerçek bir örnekte sonuçlar nasıl görünüyor?',
      blocks: [
        {
          t: 'callout',
          title: 'Açıklama',
          text: 'KobiPratik, kurucu ekibimizin ortağı olduğu bir site. Bu yüzden bağımsız bir vaka değil; rakamları kaynağı ve dönemiyle veriyoruz.',
        },
        {
          t: 'table',
          caption: 'KobiPratik: asistan başına kaynak gösterme oranı (16 Ekim 2026)',
          head: ['Asistan', 'Kaynak gösterme oranı'],
          rows: [
            ['ChatGPT', '%40'],
            ['Perplexity', '%40'],
            ['Gemini', '%33'],
            ['Claude', '%20'],
          ],
          not: 'Asistan başına 3 tur × 5 soru, yani 15 cevap. %40 = 15 cevabın 6’sı.',
          kaynak: ['kp-citation'],
        },
        {
          t: 'p',
          text: 'Oranlar döneme göre değişiyor. RanksUp’ın aynı site için yaptığı günlük ölçümlerde Perplexity’nin kaynak gösterme oranı dördüncü ayda %79’a ulaştı. 16 Ekim’deki ölçümde ise %40 çıktı. Bu fark, tek ölçüme güvenmemek için iyi bir örnek.',
          kaynak: ['kp-perplexity', 'kp-citation'],
        },
        {
          t: 'p',
          text: 'Aynı sitede Google’dan gelen günlük ortalama tıklama 52’den 340’a çıktı (ilk 30 gün ile son 30 gün; Search Console, 16 Mayıs – 13 Ağustos 2026). 13 Ağustos 2026’da biten 28 günde yaklaşık 12.000 tıklama geldi (Search Console yalnız organik tıklamayı sayar). Yani AI görünürlüğü klasik aramanın yerine geçmedi; ikisi birlikte büyüdü.',
          kaynak: ['kp-gsc'],
        },
        {
          t: 'p',
          text: 'Cloudflare AI Crawl Control paneline göre ChatGPT-User, Ekim 2026’da 7 günde siteyi 1.330 kez ziyaret etti. ChatGPT-User, ChatGPT’de kullanıcının başlattığı işlemler için sayfa açan ajandır; bu ziyaretler sayfaların cevaplarda kullanıldığına dair dolaylı bir işarettir.',
          kaynak: ['kp-cloudflare', 'cloudflare-acc', 'openai-bots'],
        },
      ],
    },
    {
      id: 'yontemin-sinirlari',
      h2: 'Bu yöntemin sınırları neler?',
      blocks: [
        {
          t: 'ul',
          items: [
            'Elle test küçük bir örneklemdir. 15 cevap eğilimi gösterir, kesin sonucu değil.',
            'OpenAI, ChatGPT aramasında kaynakların nasıl sıralandığını ayrıntılı açıklamıyor. Bot belgesi yalnızca hangi botun ne için kullanıldığını anlatıyor.',
            'Ölçüm araçları asistanlara API üzerinden sorar. API cevabı, uygulamada gördüğün cevapla birebir aynı olmayabilir.',
            'Bir soruda görünmemek, markanın kötü olduğu anlamına gelmez. Çoğu zaman o soruya doğrudan cevap veren bir sayfan yoktur.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: 'ChatGPT’de markamı ücretsiz kontrol edebilir miyim?',
      a: 'Evet. Bu rehberdeki elle test yöntemi ücretsizdir; tek maliyeti zamandır. Düzenli ve birden çok asistanda takip için bir ölçüm aracı işini kolaylaştırır.',
    },
    {
      q: 'Kaç soru ve kaç tur yeterli?',
      a: 'Kesin bir sayı yok. Başlangıç için 5 soru ve soru başına 3 tur, yani 15 cevap, oran hesaplamak için makul bir örneklemdir. KobiPratik ölçümünde de asistan başına 3 tur × 5 soru kullandık.',
    },
    {
      q: 'Marka adını soruya yazarsam ne olur?',
      a: 'Cevapta markanın geçmesi zaten beklenir; bu tanınırlığı gösterir, görünürlüğü değil. Bu yüzden marka adı geçen soruları ayrı değerlendir. RanksUp da bu soruları puana katmaz.',
    },
    {
      q: 'ChatGPT sitemi kaynak gösteriyor ama markamı anmıyor; bu iyi mi?',
      a: 'Kısmen. Bağlantı trafik getirebilir ama okuyucu markanı metinde görmez. Sayfanda marka adını ve ne yaptığını açıkça yazmak bu farkı kapatmaya yardım edebilir.',
    },
    {
      q: 'Ölçüm aracının gördüğü cevap benim gördüğümle aynı mı?',
      a: 'Birebir aynı olmayabilir. Ölçüm araçları asistanlara API üzerinden sorar; uygulamadaki cevap kişiselleştirme, konum ve model sürümüne göre farklılaşabilir. Bu yüzden aracın verdiği oranı, ara sıra yaptığın elle testle birlikte değerlendir.',
    },
    {
      q: 'Sonuçları ne sıklıkla kontrol etmeliyim?',
      a: 'Çoğu site için haftalık takip yeterlidir; cevaplar zaten günden güne oynar. Önemli olan aynı soruları aynı yöntemle sormak ve eğilime bakmaktır.',
    },
  ],
  sources: [SRC.openaiBots, SRC.ranksupAiVisibility, SRC.kpCitation, SRC.kpPerplexity, SRC.kpGsc, SRC.kpCloudflare, SRC.cloudflareAcc],
  related: ['geo-nedir', 'yapay-zeka-botlari-robots-txt', 'yapay-zeka-gorunurluk-araclari'],
  published: '2026-10-24',
  schemaType: 'Article',
};
