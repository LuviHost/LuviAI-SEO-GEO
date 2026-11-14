import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * 14.11.2026 (sahip: "Yap"). OpenAI 10.11.2026'da "Businesses in ChatGPT"i beta olarak acti.
 *
 * Dayanaklar (hepsi 14.11.2026'da okundu):
 *  - OpenAI duyurusu (community.openai.com): Business Hub; "eligible businesses located wherever
 *    ChatGPT is available can get started by claiming their business"; isletme asistani
 *    "eligible ecommerce and online service businesses in the U.S."; toplu rakamlar; sohbetler
 *    isletmeyle paylasilmaz.
 *  - OpenAI yardim sayfasi: sahiplenme web sitesi olan uygun isletmelere acik, reklam hesabi /
 *    Enterprise sozlesmesi gerekmez; dogrulama telefon, is e-postasi, alan adi (TXT), Shopify;
 *    yayimlamak / rakam gormek / asistan icin Persona kimlik dogrulamasi; rakamlar son 28 gun;
 *    cevrimici islemede "anilma" = siteye atif; "claiming doesn't guarantee increased visibility
 *    or give you direct control over ChatGPT's independent recommendations".
 *    (help.openai.com otomatik istegi 403 ile reddediyor; metin arama sonucundaki sayfa
 *    ozetinden okundu — sources.ts notu.)
 *  - VentureBeat (10.11.2026): basvuru ChatGPT'nin calistigi VE dogrulamanin desteklendigi
 *    pazarlarda; yontemler "depending on the business"; yerel isletme yalniz mevcut ABD kaydi;
 *    acilista ucretsiz, ileride ucret olasiligi acik; yayimlamadan once Persona.
 *  - IT Brief UK (11.11.2026): kuresel acilis, asistan yalniz ABD, rakam esigi.
 *  - LLM Pulse derlemesi: adimlarin sirasi, acilista ucretsiz, yerel isletme yalniz ABD,
 *    ABD disindan bir basvurunun bekleme listesine alindigi (PPC Land'e atifla; TEK kaynak,
 *    yazida "bir habere göre" diye gecer).
 *
 * BILINMEYEN — yazida oldugu gibi soylenir: Turkiye'den bir basvurunun onaylandigi
 * dogrulanmadi (ulke listesi yok). Sahip kendi basvurusunu yapinca "Türkiye'deki durum"
 * kutusu ve ilgili SSS guncellenir.
 *
 * DIL (14.11.2026 bagimsiz inceleme): profil icin "saglar" / "elinde olur" gibi sonuc vaadi
 * yok — yalniz "guncelleyebilirsin"; gorunurluk icin "saglamaz" degil OpenAI'in sozu
 * "garanti etmez"; dogrulama yontemleri icin "dordunden birini sec" degil "sana sunulan".
 *
 * Asistan SAYISI yazilmaz (plana gore degisir; public-docs.spec sabit sayiyi reddeder).
 */
export const article: RehberArticle = {
  slug: 'chatgpt-isletme-profili',
  title: 'ChatGPT’de işletme profili nasıl sahiplenilir?',
  metaTitle: 'ChatGPT işletme profili nasıl sahiplenilir?',
  description:
    'ChatGPT Business Hub’da işletme profilini sahiplenme adımları, istenen doğrulamalar, Türkiye’deki durum ve profilin görünürlüğe etkisi.',
  topic: 'ChatGPT',
  answer:
    'İşletme profili için ChatGPT’nin Business Hub sayfasında işletmeni arayıp sahiplenme başvurusu yapar, ardından işletmeyle bağını ve kimliğini doğrularsın. Başvuruyu OpenAI inceler; onay garanti değildir. Özellik 10 Kasım 2026’da beta olarak açıldı. OpenAI ülke listesi yayımlamadı; Türkiye’den yapılan bir başvurunun onaylandığını bu yazı yazılırken doğrulayamadık.',
  quick: [
    'Adres chatgpt.com/business-hub. ChatGPT hesabınla girersin; reklam hesabı ya da kurumsal sözleşme gerekmez.',
    'Şimdilik web sitesi olan işletmeler başvurabilir.',
    'İşletmeyle bağını telefon, iş e-postası, alan adı ya da Shopify ile doğrularsın; hangisinin sunulduğu işletmeye göre değişir.',
    'Bilgileri yayımlamak ve rakamları görmek için ayrıca kimlik doğrulaması istenir.',
    'Profili sahiplenmek cevaplarda daha çok anılmanı garanti etmez.',
    'Türkiye’deki durum belirsiz; emin olmanın yolu başvurmak.',
  ],
  sections: [
    {
      id: 'isletme-profili-nedir',
      h2: 'ChatGPT’de işletme profili nedir?',
      blocks: [
        {
          t: 'p',
          text: 'OpenAI, 10 Kasım 2026’da “Businesses in ChatGPT” adıyla beta bir özellik açtı. İşletmeler Business Hub adlı sayfada ChatGPT’de görünen bilgilerini yönetebiliyor ve ChatGPT’de nasıl yer aldıklarına dair toplu rakamları görebiliyor.',
          kaynak: ['openai-business-announce'],
        },
        {
          t: 'table',
          caption: 'Özellikler ve kimlere açık olduğu (Kasım 2026)',
          head: ['Özellik', 'Ne işe yarar?', 'Kimlere açık?'],
          rows: [
            ['Profili sahiplenme', 'İşletme bilgilerini güncellersin; çevrimiçi satış yapıyorsan fiyat ve stok bilgili ürün listesi eklersin', 'ChatGPT’nin kullanılabildiği ve doğrulamanın desteklendiği yerlerdeki uygun işletmeler; ülke listesi yayımlanmadı'],
            ['Rakamlar (Insights)', 'Anılma, siteye tıklama ve konu başlıkları gibi toplu rakamları görürsün', 'Sahiplenmesi ve kimlik doğrulaması onaylanan işletmeler'],
            ['İşletme asistanı (Business Agent)', 'Müşteri, ChatGPT içinde işletmenin sunduklarını bu asistana sorar', 'Şimdilik yalnız ABD’deki uygun e-ticaret ve çevrimiçi hizmet işletmeleri'],
          ],
          kaynak: ['openai-business-announce', 'itbrief-business-hub', 'venturebeat-business-hub'],
        },
      ],
    },
    {
      id: 'kimler-basvurabilir',
      h2: 'Kimler başvurabilir, Türkiye’den olur mu?',
      blocks: [
        {
          t: 'p',
          text: 'OpenAI’ın yardım sayfasına göre başvurmak için işletmenin sahibi ya da onu temsil etmeye yetkili kişi olman gerekir. Sahiplenme ilk aşamada web sitesi olan uygun işletmelere açık. Reklam hesabı ya da ChatGPT Enterprise sözleşmesi gerekmiyor.',
          kaynak: ['openai-business-help'],
        },
        {
          t: 'p',
          text: 'Başvuru, ChatGPT’nin kullanılabildiği ve gereken doğrulamanın desteklendiği yerlerdeki uygun işletmelere açık. Hangi ülkelerin bu iki koşulu sağladığını yazan bir liste ise yayımlanmadı.',
          kaynak: ['openai-business-announce', 'venturebeat-business-hub', 'llmpulse-business-hub'],
        },
        {
          t: 'callout',
          title: 'Türkiye’deki durum',
          text: 'Bu yazı yazılırken (14 Kasım 2026) Türkiye’den yapılan bir başvurunun onaylandığını doğrulayamadık. Bir habere göre ABD dışından yapılan en az bir başvuru açılış günü bekleme listesine alındı. Emin olmanın yolu Business Hub’da işletmeni arayıp başvurmak.',
          kaynak: ['llmpulse-business-hub'],
        },
        {
          t: 'p',
          text: 'Mağaza, restoran ya da kuaför gibi fiziksel adresi olan işletmeler için bir sınır daha var. Yayımlanan haberlere göre bu işletmeler şimdilik yalnız ABD’deki mevcut bir kaydı sahiplenebiliyor.',
          kaynak: ['venturebeat-business-hub', 'llmpulse-business-hub'],
        },
      ],
    },
    {
      id: 'adim-adim-sahiplenme',
      h2: 'Adım adım nasıl sahiplenirim?',
      blocks: [
        {
          t: 'ol',
          items: [
            '**Business Hub’ı aç.** ChatGPT hesabınla giriş yap ve chatgpt.com/business-hub adresine git.',
            '**İşletmeni ara.** Kayıt çıkarsa onu seç. Çıkmazsa ve çevrimiçi bir işletmeysen web siteni ekleyip işletme türünü seç.',
            '**Sahiplenme başvurusu yap.** İşletmeyle bağını göstermek için sana sunulan doğrulama yöntemlerinden birini seç.',
            '**OpenAI’ın onayını bekle.** Başvurular incelenir; OpenAI onayı garanti etmiyor.',
            '**Kimlik doğrulamasını tamamla.** Bilgileri yayımlamak ve rakamları görmek için gerekir.',
            '**Bilgilerini güncelle.** Çevrimiçi satış yapıyorsan ürün listeni ekle.',
          ],
          kaynak: ['openai-business-help', 'llmpulse-business-hub'],
        },
        {
          t: 'table',
          caption: 'İşletmeyle bağını doğrulama yöntemleri',
          head: ['Yöntem', 'Nasıl çalışır?', 'Kime uygun?'],
          rows: [
            ['Alan adı', 'ChatGPT’nin verdiği TXT kaydını alan adının DNS ayarlarına eklersin', 'Alan adının yönetim paneline erişimi olana'],
            ['İş e-postası', 'İşletmenin e-posta adresine gönderilen kodu girersin', 'Kendi alan adında e-posta kullanana'],
            ['Telefon', 'İşletmenin telefonuna gelen kodu girersin', 'İşletme telefonunu kendisi yanıtlayana'],
            ['Shopify', 'Mağazanı Business Hub’a bağlarsın', 'Mağazası Shopify’da olana'],
          ],
          not: 'Hangi yöntemlerin sunulduğu işletmeye göre değişir. “Kime uygun?” sütunu bizim önerimizdir.',
          kaynak: ['openai-business-help', 'venturebeat-business-hub', 'llmpulse-business-hub'],
        },
      ],
    },
    {
      id: 'kimlik-dogrulamasi',
      h2: 'Kimlik doğrulamasında ne istenir?',
      blocks: [
        {
          t: 'p',
          text: 'OpenAI’a göre bilgilerdeki değişiklikleri yayımlamak, rakamları görmek ya da işletme asistanı oluşturmak için Persona adlı doğrulama hizmeti üzerinden kimlik doğrulaması yapman gerekir. Resmî kimlik belgesi, işletme kayıt bilgileri ve işletmeyi temsil etmeye yetkili olduğunu gösteren belge istenebilir.',
          kaynak: ['openai-business-help', 'venturebeat-business-hub', 'llmpulse-business-hub'],
        },
        {
          t: 'p',
          text: 'Sahiplenmek tek başına profile doğrulanmış rozeti vermez. Mavi onay işareti, kimlik doğrulaması onaylandıktan sonra görünür.',
          kaynak: ['openai-business-help'],
        },
        {
          t: 'ul',
          items: [
            'Girdiğin ad, adres ve kayıt bilgilerinin resmî kayıtlarla aynı olmasına dikkat et.',
            'Şahıs işletmesiysen yasal ad kendi adın olabilir. Yayımlamadan önce profilde hangi adın görüneceğine bak.',
            'OpenAI’ın geliştirici forumunda bazı kullanıcılar, doğrulamanın neden gösterilmeden reddedildiğini ve yeniden deneme seçeneği çıkmadığını yazdı. Böyle bir durumda OpenAI desteğine yaz.',
          ],
          kaynak: ['openai-business-announce'],
        },
      ],
    },
    {
      id: 'gorunurlugu-artirir-mi',
      h2: 'Profili sahiplenmek ChatGPT’de görünürlüğümü artırır mı?',
      blocks: [
        {
          t: 'p',
          text: 'Hayır, bunu garanti etmez. OpenAI’ın yardım sayfasına göre sahiplenmek görünürlüğün artacağını garanti etmez ve ChatGPT’nin bağımsız önerileri üzerinde sana doğrudan kontrol vermez.',
          kaynak: ['openai-business-help'],
        },
        {
          t: 'p',
          text: 'Yani profil, cevaplarda anılıp anılmayacağını belirleyen bir ayar değil. ChatGPT’de görünen işletme bilgilerini kendin güncelleyebildiğin ve OpenAI’ın kendi rakamlarını görebildiğin bir kayıt. Cevaplarda anılmanın nelere bağlı olduğunu [yapay zekâ görünürlüğü rehberinde](/rehber/yapay-zeka-gorunurlugu) anlattık.',
        },
      ],
    },
    {
      id: 'rakamlar-ne-gosterir',
      h2: 'Business Hub’daki rakamlar ne gösterir, ne göstermez?',
      blocks: [
        {
          t: 'ul',
          items: [
            'Son 28 günün toplu rakamlarını gösterir: anılma, siteye tıklama ve işletmenin anıldığı sohbetlerdeki konu başlıkları.',
            'Çevrimiçi işletmede “anılma”, ChatGPT’nin web sitene atıf yaptığı durumdur. Yalnız marka adının geçmesi sayılmaz.',
            'Etkileşim belli bir eşiğin altındaysa rakam gösterilmez. Boş bir kutu sıfır anlamına gelmez.',
            'OpenAI, kullanıcıların sohbetlerini işletmelerle paylaşmaz.',
          ],
          kaynak: ['openai-business-help', 'openai-business-announce', 'itbrief-business-hub', 'llmpulse-business-hub'],
        },
        {
          t: 'table',
          caption: 'Business Hub rakamları ile soru bazlı ölçümün farkı',
          head: ['', 'Business Hub rakamları', 'Soru bazlı ölçüm'],
          rows: [
            ['Veri nereden gelir?', 'OpenAI’ın kendi kayıtlarından, toplu olarak', 'Seçtiğin sorular asistanlara sorulur, cevap kaydedilir'],
            ['Hangi asistanlar?', 'Yalnız ChatGPT', 'Birden çok asistan'],
            ['Tek tek sorular görünür mü?', 'Hayır, yalnız konu başlıkları', 'Evet, her soru ve cevabı'],
            ['Rakipler görünür mü?', 'Hayır', 'Evet, aynı cevaplarda anılan rakipler'],
          ],
          not: 'Soru bazlı ölçüm sütunu RanksUp’ın yaptığı işi anlatır; RanksUp bizim ürünümüz.',
          kaynak: ['openai-business-help', 'llmpulse-business-hub'],
        },
        {
          t: 'p',
          text: 'İkisi birbirinin yerine geçmez. Business Hub gerçek kullanımın toplu sayısını verir; ölçüm ise belirli bir soruda hangi cevabın verildiğini ve kimin anıldığını gösterir. Elle nasıl ölçeceğini [ChatGPT’de markam görünüyor mu rehberinde](/rehber/chatgpt-markam-gorunuyor-mu) anlattık.',
        },
      ],
    },
    {
      id: 'simdi-sahiplenmeli-miyim',
      h2: 'Şimdi sahiplenmeli miyim?',
      blocks: [
        {
          t: 'p',
          text: 'Web siten varsa denemeye değer: açılışta ücret alınmıyor ve ChatGPT’de görünen işletme bilgilerini kendin güncelleyebilirsin. Beklentini doğru kur; bu adım cevaplarda daha çok anılmanı garanti etmez.',
          kaynak: ['venturebeat-business-hub', 'llmpulse-business-hub', 'openai-business-help'],
        },
        {
          t: 'ul',
          items: [
            '**Hemen dene:** çevrimiçi satış ya da çevrimiçi hizmet veriyorsan ve alan adının yönetimine erişimin varsa.',
            '**Bekleyebilirsin:** yalnız fiziksel adresle çalışıyorsan ya da kimlik belgesi paylaşmak istemiyorsan.',
            '**Her durumda:** özellik beta aşamasında; koşullar ve ekranlar değişebilir.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: 'ChatGPT Business Hub ücretli mi?',
      a: 'Açılışta ücret alınmıyor; sahiplenmek için reklam hesabı ya da kurumsal sözleşme de gerekmiyor. Haberlere göre OpenAI ileride ücret alma olasılığını açık bıraktı.',
    },
    {
      q: 'Türkiye’deki işletmeler ChatGPT’de profil sahiplenebilir mi?',
      a: 'Belirsiz. Başvuru, ChatGPT’nin kullanılabildiği ve gereken doğrulamanın desteklendiği yerlerdeki uygun işletmelere açık; ülke listesi yayımlanmadı. 14 Kasım 2026 itibarıyla Türkiye’den onaylanan bir başvuruyu doğrulayamadık.',
    },
    {
      q: 'Profili sahiplenince ChatGPT beni daha çok önerir mi?',
      a: 'Bunun garantisi yok. OpenAI’a göre sahiplenmek görünürlüğün artacağını garanti etmez ve ChatGPT’nin bağımsız önerileri üzerinde doğrudan kontrol vermez.',
    },
    {
      q: 'Web sitem yoksa ChatGPT’de işletme profili alabilir miyim?',
      a: 'Şimdilik hayır. OpenAI sahiplenmeyi ilk aşamada web sitesi olan uygun işletmelere açtı.',
    },
    {
      q: 'Kimlik doğrulaması yapmadan profili kullanabilir miyim?',
      a: 'Başvurabilirsin ama bilgilerde değişiklik yayımlayamaz ve rakamları göremezsin. OpenAI bu adımlar için Persona üzerinden kimlik doğrulaması istiyor.',
    },
    {
      q: 'İşletme asistanını (Business Agent) Türkiye’den kullanabilir miyim?',
      a: 'Şimdilik hayır. OpenAI bu özelliği ilk aşamada yalnız ABD’deki uygun e-ticaret ve çevrimiçi hizmet işletmelerine açtı.',
    },
    {
      q: 'Business Hub’daki rakamlar ile ölçüm sonuçlarım neden farklı çıkar?',
      a: 'İkisi farklı şeyi sayar. Business Hub, gerçek kullanıcı sohbetlerinde sitene yapılan atıfları toplu olarak verir. Soru bazlı ölçüm ise seçtiğin soruları asistanlara sorar ve cevabı kaydeder.',
    },
  ],
  sources: [SRC.openaiBusinessHelp, SRC.openaiBusinessAnnounce, SRC.venturebeatBusinessHub, SRC.itbriefBusinessHub, SRC.llmpulseBusinessHub],
  related: ['chatgpt-markam-gorunuyor-mu', 'yapay-zeka-gorunurlugu', 'yapay-zeka-botlari-robots-txt'],
  published: '2026-11-14',
  schemaType: 'Article',
};
