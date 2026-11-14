import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * 14.11.2026 (sahip: "hepsini yap"). Hedef soru: "Dijital ajanslar müşterilerinin ChatGPT ve Gemini'deki
 * görünürlüğünü hangi araçla raporluyor?" — sitede ajanslara özel yalnız kullanım alanları kartı vardı.
 *
 * Rakip bilgileri saticinin kendi sayfasindan (verbatim alintilar sources.ts'te): rankzupAI, Geovium,
 * AIWATCH, Yanıt IO, Zekabi 14.11.2026; GEON, Profound, Peec 24.10.2026 (GEON Enterprise karti 14.11'de
 * yeniden okundu, ayni). Dogrulanamayan yazilmadi: Profound Agency Growth taban fiyati, Zekabi ajans tutari.
 *
 * RanksUp tarafı KODLA ayni — iddia eklerken once kodu oku:
 *  - Musteri raporu: app/(dashboard)/sites/[id]/report/musteri (tum planlarda; PDF = tarayici yazdirma;
 *    paylasim baglantisi 7 / 30 / 90 gun, lib/musteri-raporu.ts PAYLASIM_GUNLERI; baglanti paylasim
 *    anindaki raporu dondurur). Rapor "RanksUp ile hazırlandı" yazar (rapor-belgesi.tsx).
 *  - Beyaz etiket YOK: agency whitelabel ayarlari kaydediliyor ama uygulanmiyor ve satilmiyor (glossary.ts notu).
 *  - Olcum hesap basina 7 gunde 1 ve TUM siteler ayni hakki paylasir (billing/measurement-allowance.ts,
 *    /faq); gunluk otomatik olcum uretimde kapali. Ajans icin belirleyici sinir — acikca yaziyor.
 *  - Profesyonel 5 site, Kurumsal 50 site + REST API + MCP (plans.ts). Kurumsal fiyati YAZILMAZ (teklifle).
 * Ekip koltugu / musteri girisi hakkinda iddia YOK (agency daveti kodda var, satilan planda dogrulanmadi).
 */
export const article: RehberArticle = {
  slug: 'ajanslar-icin-yapay-zeka-gorunurluk-raporu',
  title: 'Ajanslar müşterilerinin ChatGPT ve Gemini görünürlüğünü nasıl raporlar?',
  metaTitle: 'Ajanslar için yapay zekâ görünürlük raporu',
  description:
    'Ajanslar için yapay zekâ görünürlük raporu: hangi metrikler sunulur, rapor nasıl hazırlanır, hangi ürünler çoklu marka, paylaşım ve beyaz etiket sunuyor?',
  topic: 'Ajans',
  answer:
    'Ajanslar bunu, müşteriyle birlikte belirlenen sabit bir soru setini asistanlara düzenli sorup anılma, kaynak gösterilme ve rakip payını dönemsel raporlayarak yapar. Elle de yapılabilir; çoklu marka, paylaşılabilir rapor ve dışa aktarma sunan ürünler işi hızlandırır. Hangi ürünün ne sunduğunu aşağıda satıcı sayfalarına göre karşılaştırdık.',
  quick: [
    'Raporun çekirdeği üç sayı: anılma oranı, kaynak gösterilme oranı ve rakiplere göre pay.',
    'Soru setini müşteriyle birlikte onayla ve dönemler arasında değiştirme.',
    'Tek ölçümü sonuç diye sunma; en az iki dönemi yan yana göster.',
    'Sayfasında beyaz etiket rapor yazan ürünler: rankzupAI (Agency paketi), AIWATCH (Kurumsal paketi), SEOYEN (Pro ve üstü).',
    'Sayfasında ajanslar için çoklu marka paketi yazan ürünler: rankzupAI, Geovium, GEON, Profound, SEOYEN.',
    'RanksUp’ta müşteri raporu PDF ve paylaşım bağlantısıyla verilir; kendi logonla rapor yoktur.',
  ],
  sections: [
    {
      id: 'hangi-metrikler',
      h2: 'Müşteriye hangi metrikleri raporlamalıyım?',
      blocks: [
        {
          t: 'table',
          caption: 'Yapay zekâ görünürlük raporunun temel metrikleri',
          head: ['Metrik', 'Ne anlatır?', 'Nasıl hesaplanır?'],
          rows: [
            ['Anılma oranı', 'Marka cevaplarda ne sıklıkla geçiyor', 'Markanın anıldığı cevap sayısı ÷ toplam cevap sayısı'],
            ['Kaynak gösterilme oranı', 'Müşterinin sitesi cevaplarda kaynak oluyor mu', 'Sitenin kaynak gösterildiği cevap sayısı ÷ toplam cevap sayısı'],
            ['Rakip payı', 'Aynı sorularda rakipler ne sıklıkla anılıyor', 'Her rakibin anıldığı cevap sayısı, aynı soru setinde'],
            ['Sıra', 'Marka anıldığında kaçıncı sırada geçiyor', 'Cevaptaki marka sırası; yalnız liste biçimli cevaplarda anlamlı'],
            ['Kaynak siteler', 'Asistanlar bu konuda hangi siteleri okuyor', 'Cevaplarda kaynak gösterilen alan adlarının dökümü'],
          ],
        },
        {
          t: 'p',
          text: 'Ürünler bu sayıları farklı adlarla sunuyor. Semrush, AI Visibility Score’u markanın yapay zekâ cevaplarında ne sıklıkla anıldığının sektördeki önde gelen rakiplerin ortancasıyla karşılaştırması olarak tanımlıyor. Peec AI ise Visibility (ne sıklıkla anıldığın), Position (anıldığında diğer markalara göre sıran) ve Sentiment (nasıl anlatıldığın) metriklerini veriyor. Hangi ürünün skorunu gösterirsen göster, skorun nasıl hesaplandığını rapora yaz.',
          kaynak: ['semrush-score', 'peec-docs'],
        },
      ],
    },
    {
      id: 'rapor-nasil-hazirlanir',
      h2: 'Rapor nasıl hazırlanır?',
      blocks: [
        {
          t: 'ol',
          items: [
            '**Soru setini müşteriyle belirle.** 10–20 alıcı sorusu; marka adı geçmeyen sorular ağırlıkta olsun. Seti yazılı onaylat.',
            '**Rakip listesini baştan sabitle.** Dönem ortasında değişen liste, dönemleri karşılaştırılamaz kılar.',
            '**İlk ölçümü başlangıç çizgisi olarak sun.** İlk raporda yalnız bugünkü durumu göster; sonuç vaat etme.',
            '**Aynı yöntemle yeniden ölç.** Aynı sorular, aynı asistanlar, aynı sıklık. Asistan cevapları oynak olduğu için tek ölçümdeki küçük farklar anlam taşımaz.',
            '**Sayıların yanına yapılacakları yaz.** Görünmeyen her soru için: cevap veren bir sayfa var mı, botlar erişebiliyor mu, hangi siteler kaynak gösteriliyor.',
            '**Ham cevapları sakla.** Müşteri bir sayının nereden çıktığını sorduğunda cevabın kendisini gösterebilmelisin.',
          ],
        },
        { t: 'p', text: 'Ürün kullanmadan elle ölçmenin adımları [ChatGPT’de markam görünüyor mu rehberinde](/rehber/chatgpt-markam-gorunuyor-mu); metriklerin mantığı [yapay zekâ görünürlüğü rehberinde](/rehber/yapay-zeka-gorunurlugu).' },
      ],
    },
    {
      id: 'ajans-ozellikleri',
      h2: 'Hangi ürünler ajanslar için ne sunuyor?',
      blocks: [
        { t: 'p', text: 'Aşağıdaki bilgiler satıcıların kendi sayfalarından. RanksUp bizim ürünümüz; onu başa yazdık, diğerleri alfabetik sırada. Sıralama kaliteye göre değil.' },
        {
          t: 'table',
          caption: 'Ajanslar için özellikler (satıcı sayfaları; erişim tarihleri kaynak satırında)',
          head: ['Ürün', 'Ajanslar için yazdığı', 'Fiyat (satıcı sayfası)'],
          rows: [
            ['RanksUp (bizim ürünümüz)', 'Profesyonel planda 5 site, Kurumsal planda 50 site. Müşteri raporu PDF ve süreli paylaşım bağlantısıyla (tüm planlarda). Raporda “RanksUp ile hazırlandı” yazar, kendi logonla rapor yok. Ölçüm hakkı hesap başına haftada bir; siteler paylaşır. REST API ve MCP Kurumsal planda', 'Profesyonel $349/ay, KDV dahil; Kurumsal teklifle'],
            ['AIWATCH', 'Profesyonel pakette 5 markaya kadar, HTML ve PDF raporlar; Kurumsal pakette API erişimi ve white-label rapor', 'Fiyat yayımlanmıyor; teklifle'],
            ['GEON', 'Enterprise kartı “Ajanslar & Çoklu marka”: sınırsız çalışma alanı (prompt kredisi ortak), günlük tarama ve rapor', 'Enterprise fiyat kartında $259/ay, 200 prompt/ay'],
            ['Geovium', 'Ajans paketi: 10 çalışma alanı, 10 kullanıcı, çalışma alanı başına 25 takip edilen soru; raporlar ve CSV dışa aktarım', 'Ajans paketi 29.990 TL + KDV/ay'],
            ['Profound', 'Self-serve Agency Growth planı; tam müşteri çalışma alanı ek paket', 'Müşteri çalışma alanı eki $399/ay; planın taban fiyatını doğrulayamadık'],
            ['rankzupAI', 'Agency paketi: 10 proje, 10 koltuk, 250 izlenen sorgu, beyaz etiket müşteri raporu. Tüm paketlerde haftalık PDF raporu ve üyeliksiz açılan paylaşımlı rapor bağlantısı; Scale ve Agency’de REST API ve MCP', 'Agency paketi 13.699 TL/ay + KDV'],
            ['SEOYEN', 'Pro paketi “Profesyoneller ve ajanslar için”: 20 proje, 2 kişilik takım, white-label raporlar, 50 takip edilen AI prompt', 'Pro aylık 3.799 TL, KDV dahil'],
            ['Yanıt IO', 'Abonelikte 5 ekip üyesi, haftalık rapor ve paylaşılabilir rapor bağlantısı (ana sayfasında bu bölüm “beta” etiketli)', '2.499 TL/ay, KDV dahil; sayfasına göre ödeme henüz açılmadı'],
            ['Zekabi (ölçümü kendisi yapıp aylık rapor veriyor)', 'Ajanslar için ayrı fiyat, ay sonunda tek ödeme ve ajansın kendi adıyla rapor', 'Fiyat sayfasında ajans tutarı yazmıyor'],
          ],
          kaynak: ['ranksup-pricing', 'ranksup-terms', 'ranksup-panel', 'aiwatch', 'geon', 'geovium', 'profound', 'rankzup-pricing', 'seoyen-pricing', 'yanit', 'yanit-pricing', 'zekabi-pricing'],
        },
        {
          t: 'p',
          text: 'Sayıları kendi raporlama panona taşımak istersen dışa aktarma seçeneklerine bak. Peec AI sayfasında API, CSV dışa aktarma ve Looker Studio bağlayıcısı yazıyor. Diğer global ürünlerin kapsamı [karşılaştırma rehberinde](/rehber/yapay-zeka-gorunurluk-araclari), Türkiye’de satılanların tamamı [Türkiye listesinde](/rehber/turkiyede-yapay-zeka-gorunurluk-urunleri).',
          kaynak: ['peec', 'peec-home'],
        },
      ],
    },
    {
      id: 'secim-olcutleri',
      h2: 'Ajans olarak seçerken neye bakmalıyım?',
      blocks: [
        {
          t: 'table',
          caption: 'Ajanslar için seçim ölçütleri',
          head: ['Sorulacak soru', 'Neden önemli?'],
          rows: [
            ['Kaç markayı ayrı ayrı izleyebiliyorum?', 'Paketler çoğunlukla marka (çalışma alanı) ve soru sayısıyla sınırlanıyor; müşteri başına maliyeti bu belirler'],
            ['Her müşteriyi ne sıklıkla ölçebiliyorum?', 'Ölçüm hakkı marka başına mı, hesap başına mı; aylık rapor veriyorsan her müşterinin ayda en az bir ölçümü olmalı'],
            ['Raporu müşteriye nasıl veriyorum?', 'PDF, paylaşım bağlantısı ya da müşteriye ayrı giriş; hangisi iş akışına uyuyor'],
            ['Rapor kimin adını taşıyor?', 'Beyaz etiket her üründe yok; yoksa sayıları kendi sunumuna taşıman gerekir'],
            ['Veriyi dışarı alabiliyor muyum?', 'CSV ya da API, sayıları kendi raporuna koymanı sağlar'],
          ],
        },
      ],
    },
    {
      id: 'ranksup-ajans',
      h2: 'RanksUp ajanslar için ne sunuyor, sınırları ne?',
      blocks: [
        {
          t: 'callout',
          title: 'Açıklama',
          text: 'RanksUp bizim ürünümüz. Bu yüzden ajanslar için eksik kalan yanlarını da açık yazdık.',
        },
        {
          t: 'ul',
          items: [
            '**Ne sunuyor:** Her site için ayrı soru seti, rakip listesi ve marka sesi. Müşteri raporu SEO, GEO ve yapay zekâ görünürlük sonuçlarını tek belgede toplar; PDF olarak indirilir ya da 7, 30 ya da 90 gün geçerli bir bağlantıyla paylaşılır. Bağlantı, paylaşıldığı andaki raporu gösterir. İki ölçümü yan yana koyan bir karşılaştırma raporu da var. Haftalık e-posta özeti hesap sahibine gider ve Search Console verisini (tıklama, gösterim, sıra) ile yayınlanan makaleleri içerir; yapay zekâ görünürlük verisi içermez. Profesyonel planda 5 site; Kurumsal planda 50 site, REST API ve MCP sunucusu.',
            '**Sınırları:** Ölçüm hesap başına 7 günde birdir ve tüm siteler bu hakkı paylaşır; çok müşterili bir ajans için belirleyici sınır budur. Kendi logonla (beyaz etiket) rapor yok; raporda “RanksUp ile hazırlandı” yazar. Google AI Bakışı, AI Modu ve Copilot doğrudan ölçülmez.',
          ],
          kaynak: ['ranksup-pricing', 'ranksup-terms', 'ranksup-ai-visibility', 'ranksup-panel'],
        },
        { t: 'p', text: 'Plan ayrıntıları [fiyatlandırma sayfasında](/pricing); ölçüm yöntemi [AI Görünürlük yardım sayfasında](/help/ai-visibility).' },
      ],
    },
  ],
  faq: [
    {
      q: 'Müşteriye yapay zekâ görünürlük raporunu ne sıklıkla vermeliyim?',
      a: 'Aylık rapor çoğu müşteri için yeterlidir. Asistan cevapları oynak olduğu için haftalık küçük değişimler yanıltabilir; raporda en az iki dönemi yan yana göster ve eğilimi anlat.',
    },
    {
      q: 'Raporda sonuç garantisi verebilir miyim?',
      a: 'Vermemelisin. Hangi markanın anılacağına asistan karar verir ve cevaplar değişkendir. Raporda ölçtüğünü, yaptığın işi ve bir sonraki adımı yaz; belirli bir anılma oranını taahhüt etme.',
    },
    {
      q: 'Müşterinin soru setini kim belirlemeli?',
      a: 'Birlikte belirleyin. Müşteri kendi alıcısının dilini bilir, ajans hangi soruların ölçülebilir olduğunu. Seti yazılı onaylatmak, sonradan “bu soruyu neden ölçmediniz” tartışmasını önler.',
    },
    {
      q: 'Beyaz etiket rapor şart mı?',
      a: 'Şart değil. Birçok ajans sayıları kendi sunumuna ya da aylık raporuna taşıyor; bunun için PDF, paylaşım bağlantısı ya da CSV yeterli. Beyaz etiket, raporu doğrudan müşteriye açacaksan önem kazanır.',
    },
    {
      q: 'SEO raporuyla yapay zekâ görünürlük raporunu birleştirmeli miyim?',
      a: 'Aynı belgede ama ayrı bölümlerde vermek pratik olur. Google sıralaması ile asistan cevabı farklı ölçülür; aynı tabloya koymak müşteriyi yanıltabilir.',
    },
    {
      q: 'RanksUp’ta kendi logomla rapor verebilir miyim?',
      a: 'Hayır. Müşteri raporu PDF ya da paylaşım bağlantısıyla verilir ve üzerinde RanksUp ile hazırlandığı yazar. Kendi logonla rapor istiyorsan sayıları kendi sunumuna taşıman ya da beyaz etiket sunan bir ürüne bakman gerekir.',
    },
  ],
  sources: [
    SRC.ranksupPricing, SRC.ranksupTerms, SRC.ranksupAiVisibility, SRC.ranksupPanel, SRC.aiwatch, SRC.geon, SRC.geovium, SRC.profound,
    SRC.rankzupPricing, SRC.seoyenPricing, SRC.yanit, SRC.yanitPricing, SRC.zekabiPricing, SRC.peec, SRC.peecHome, SRC.semrushScore, SRC.peecDocs,
  ],
  related: ['turkiyede-yapay-zeka-gorunurluk-urunleri', 'yapay-zeka-gorunurluk-araclari', 'chatgpt-markam-gorunuyor-mu'],
  published: '2026-11-14',
  schemaType: 'Article',
};
