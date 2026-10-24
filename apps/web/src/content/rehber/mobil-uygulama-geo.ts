import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * Urun bilgileri kodla dogrulandi (24.10.2026): App Prompt Lab Profesyonel ve ustu
 * (plans.ts FEATURE_MIN_PLAN.appPromptLab = 'pro'), uygulama basina en fazla 50 soru,
 * uygulama adi anildi mi / magaza baglantisi verildi mi / rakip uygulamalar
 * (api aso/aso-prompt-lab.service.ts), calistirma haftalik olcum hakkini kullanir
 * (@MeasurementSession). ASO metadata optimizasyonu ve gunluk sira takibi Buyume'de.
 */
export const article: RehberArticle = {
  slug: 'mobil-uygulama-geo',
  title: 'Yapay zekâ asistanları uygulamamı önersin diye ne yapmalıyım?',
  metaTitle: 'Mobil uygulamalar için GEO: ASO ve yapay zekâ',
  description:
    'ChatGPT gibi asistanlar uygulama önerirken neye bakıyor? App Store ve Google Play metadata’sı, web sayfası, yorumlar ve önerilerin nasıl ölçüleceği.',
  topic: 'Mobil uygulama',
  answer:
    'Asistanlar uygulama önerirken mağaza sayfalarını sık kaynak gösteriyor; bu yüzden işe net ve tutarlı bir App Store ve Google Play metadata’sıyla başla. Sonra uygulamayı web’de ve dış kaynaklarda aynı dille anlat ve önerilip önerilmediğini ölç.',
  quick: [
    'AppTweak’in analizine göre ChatGPT’nin uygulama önerilerindeki alıntıların yaklaşık %47’si mağaza sayfalarına ait.',
    'Uygulamanın ne işe yaradığını mağazada, web sitende ve dış profillerde aynı cümleyle anlat.',
    'App Store’da ad ve alt başlık 30, anahtar kelime alanı 100 karakter; Google Play’de ad 30, kısa açıklama 80 karakter.',
    'Uygulama için web’de taranabilir bir ana sayfa ve SSS yayımla.',
    '“En iyi X uygulaması” sorularını asistanlara sorup uygulamanın önerilip önerilmediğini ölç.',
  ],
  sections: [
    {
      id: 'asistanlar-neye-bakiyor',
      h2: 'Asistanlar uygulama önerirken neye bakıyor?',
      blocks: [
        {
          t: 'p',
          text: 'Bu konuda üreticilerin resmi bir açıklaması yok; elimizdeki en kapsamlı veri bir ASO şirketinden. AppTweak, Mayıs 2026’da 125.000’den fazla ChatGPT uygulama önerisini inceledi. Analize göre mağaza sayfaları uygulama önerilerinde en çok alıntılanan kaynak: uygulamalarda alıntıların yaklaşık %47’si, oyunlarda yaklaşık %60’ı.',
          kaynak: ['apptweak'],
        },
        {
          t: 'p',
          text: 'Aynı yazının SSS bölümünde oran “%40’tan fazla” olarak geçiyor; yazı bu farkı açıklamıyor. Bu bir satıcı analizi ve yöntemi bağımsız olarak doğrulanmış değil. Yine de yön açık: mağaza sayfan, asistanların uygulaman hakkında okuduğu ilk yerlerden biri.',
          kaynak: ['apptweak'],
        },
        { t: 'p', text: 'Web’de arama yapan asistanlar mağaza sayfana bağlantı verebilir. Arama yapmadan cevap veren asistanlar ise uygulamanı ancak eğitim bilgisinde varsa anar.' },
      ],
    },
    {
      id: 'magaza-metadatasi',
      h2: 'Mağaza metadata’sında neye dikkat etmeliyim?',
      blocks: [
        {
          t: 'table',
          caption: 'App Store ve Google Play metin alanları',
          head: ['Alan', 'App Store', 'Google Play', 'GEO için ipucu'],
          rows: [
            ['Uygulama adı', '30 karakter', '30 karakter', 'Ad ve uygulamanın ne yaptığı birlikte anlaşılsın'],
            ['Alt başlık / kısa açıklama', 'Alt başlık 30 karakter, adın altında görünür', 'Kısa açıklama 80 karakter', 'Ana kullanım amacını tek cümlede söyle'],
            ['Anahtar kelimeler', '100 karakter, virgülle ayrılır; aramada nerede görüneceğini belirlemeye yardım eder', 'Tekrarlı ya da alakasız anahtar kelime kullanımı askıya alma sebebi olabilir', 'Ana mesajını görünür alanlarda da kullan'],
            ['Açıklama', 'Uzunluk sınırı belirtilmiyor; Apple’a göre ilk cümle en önemlisi', '4.000 karakter', 'İlk cümlede kimin, hangi iş için kullandığını yaz'],
            ['Tanıtım metni', '170 karakter; sıralamayı etkilemez, sürüm göndermeden güncellenir', '—', 'Güncel bir özelliği ya da kampanyayı anlat'],
          ],
          kaynak: ['apple-product-page', 'google-play-listing'],
        },
        {
          t: 'p',
          text: 'Apple, arama sonuçlarını iyileştirmek için açıklamaya gereksiz anahtar kelime eklememeyi öneriyor. Google Play de uygulama adında ya da açıklamada tekrarlı veya alakasız anahtar kelime kullanımının askıya almaya yol açabileceğini söylüyor. Asistanlar için de doğal, açık bir metin en iyisi.',
          kaynak: ['apple-product-page', 'google-play-listing'],
        },
      ],
    },
    {
      id: 'magaza-disinda',
      h2: 'Mağaza dışında ne yapmalıyım?',
      blocks: [
        {
          t: 'p',
          text: 'AppTweak’in önerileri mağazanın dışına da uzanıyor. Özetle:',
          kaynak: ['apptweak'],
        },
        {
          t: 'ul',
          items: [
            '**Tek bir ana amaç belirle.** Uygulamayı mağazada, web sitende ve dış profillerde aynı cümleyle anlat.',
            '**Uygulama için bir web sayfası aç.** Ana sayfa, SSS, herkese açık sürüm notları ve belgeler; taranabilir olsun.',
            '**Bağlantıları kur.** Uygun yerlerde Universal Links ve App Links ile web sayfası ile uygulama arasında bağ kur.',
            '**Dış kaynaklarda doğru anıl.** Karşılaştırma yazıları, listeler ve dizin profillerinde bilgiler tutarlı olsun ve tek bir ana adrese işaret etsin.',
          ],
          kaynak: ['apptweak'],
        },
      ],
    },
    {
      id: 'yorumlar-onemli-mi',
      h2: 'Kullanıcı yorumları önemli mi?',
      blocks: [
        {
          t: 'p',
          text: 'AppTweak, herkese açık yorumları izlemeyi ve kullanıcıları somut yorum yazmaya teşvik etmeyi öneriyor. “Harika uygulama” yerine “faturayı 2 dakikada kesiyorum” gibi bir yorum, uygulamanın ne işe yaradığını hem okura hem asistana anlatır.',
          kaynak: ['apptweak'],
        },
        { t: 'p', text: 'RanksUp’ın Profesyonel ve üstü planlarındaki App Store Connect bağlantısı yorumları çeker ve duygu analizini yapay zekâyla çıkarır; olumsuz yorum temalarından sürüm notu ve SSS taslağı hazırlanabilir.' },
      ],
    },
    {
      id: 'nasil-olculur',
      h2: 'Uygulamamın önerilip önerilmediğini nasıl ölçerim?',
      blocks: [
        { t: 'p', text: 'Elle test için “en iyi [kategori] uygulaması hangisi?” gibi soruları asistanlara birkaç kez sor. Her cevapta iki şeyi not et: uygulamanın adı geçti mi, mağaza sayfana bağlantı verildi mi. Yöntemin ayrıntısı [ChatGPT’de markam görünüyor mu rehberinde](/rehber/chatgpt-markam-gorunuyor-mu).' },
        {
          t: 'p',
          text: 'RanksUp’ın **App Prompt Lab** özelliği bunu otomatikleştirir: uygulama başına en fazla 50 soru izler, sorulara verilen cevaplarda uygulamanın adının geçip geçmediğini, mağaza sayfana bağlantı verilip verilmediğini ve hangi rakip uygulamaların önerildiğini kaydeder. Profesyonel ve üstü planlarda var; çalıştırma, hesabın haftalık ölçüm hakkını kullanır.',
        },
        { t: 'p', text: 'Mağaza tarafında ASO metadata optimizasyonu ve günlük anahtar kelime sıra takibi Büyüme planından itibaren var. Kurulum [ASO yardım sayfasında](/help/aso), planlar [fiyatlandırma sayfasında](/pricing).' },
      ],
    },
    {
      id: 'sinirlar',
      h2: 'Bu alanda neyi henüz bilmiyoruz?',
      blocks: [
        {
          t: 'ul',
          items: [
            'Asistan üreticileri uygulama önerilerinde hangi sinyallere baktıklarını açıklamıyor.',
            'Elimizdeki büyük veri setleri ASO şirketlerinin kendi analizleri; bağımsız tekrarlar henüz az.',
            'Türkçe sorgulara özgü bir uygulama önerisi analizi görmedik.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: 'Asistanlar App Store’daki sıralamaya mı bakıyor?',
      a: 'Bunu doğrulayan resmi bir açıklama yok. Bilinen şu: AppTweak’in analizine göre mağaza sayfaları ChatGPT’nin uygulama önerilerinde en çok alıntılanan kaynak. Bu yüzden mağaza sayfanın net ve güncel olması önemli.',
    },
    {
      q: 'Anahtar kelime alanı yapay zekâ asistanlarına görünür mü?',
      a: 'Apple’ın belgesi, anahtar kelime alanının uygulamanın App Store aramasında nerede görüneceğini belirlemeye yardım ettiğini söylüyor; asistanlarla ilgili bir açıklama yapmıyor. Bu yüzden ana mesajını ad, alt başlık ve açıklama gibi görünür alanlarda da söyle.',
    },
    {
      q: 'Uygulamamın web sitesi yoksa ne olur?',
      a: 'Asistanlar yine mağaza sayfanı kaynak gösterebilir. Ama AppTweak uygulama için taranabilir bir ana sayfa, SSS ve sürüm notları yayımlamayı öneriyor; bu sayfalar asistanlara daha fazla bağlam verir.',
    },
    {
      q: 'Google Play’de anahtar kelime tekrarı işe yarar mı?',
      a: 'Hayır, risklidir. Google Play, uygulama adında ya da açıklamada tekrarlı veya alakasız anahtar kelime kullanımının askıya almaya yol açabileceğini söylüyor.',
    },
    {
      q: 'App Prompt Lab hangi planda var?',
      a: 'Profesyonel ve üstü planlarda. Büyüme planında ASO metadata optimizasyonu ve günlük anahtar kelime sıra takibi bulunur. Güncel ayrıntılar fiyatlandırma sayfasında.',
    },
    {
      q: 'Oyunlar için durum farklı mı?',
      a: 'AppTweak’in analizine göre oyunlarda mağaza sayfalarının alıntı payı daha yüksek, yaklaşık %60. Yani oyunlarda mağaza metadata’sının ağırlığı daha da fazla olabilir.',
    },
  ],
  sources: [SRC.apptweak, SRC.appleProductPage, SRC.googlePlayListing],
  related: ['geo-nedir', 'chatgpt-markam-gorunuyor-mu', 'yapay-zeka-gorunurluk-araclari'],
  published: '2026-10-24',
  schemaType: 'Article',
};
