import { Smartphone } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'Apple Search Ads + ASC — RanksUp Help' };

// Kodla dogrulandi (Ekim 2026):
//  - Private key tarayicida uretilir ama Baglan adiminda sunucuya gider ve
//    AES-256-GCM ile sifreli saklanir (asa-tab.tsx, asa.service encrypt).
//    Eski metin "private key sadece sende kalir" diyordu — dogru degildi.
//  - ASC gunluk cron yalniz uygulama + surum senkronu ve uyarilar yapar;
//    yorumlar elle cekilir (asc.service runDailySyncAll).
//  - "TR'de ASA CPI'i Facebook/Google'in 1/3'u", "bugun 1. siraya gecersin"
//    ve App Store algoritmasi hakkindaki iddialar kaynaksizdi; kaldirildi.
export default function Page() {
  return (
    <HelpArticle slug="asa-asc"
      icon={Smartphone}
      badge="Apple Search Ads + App Store Connect"
      title="iOS reklam kampanyası + yorum ve sürüm takibi"
      intro="Apple Search Ads ile App Store arama sonuçlarında reklamla görün. App Store Connect API ile yorumları ve sürümleri takip et. Auto-Pilot her gün düşük performanslı anahtar kelimeleri durdurur, yenilerini ekler. Profesyonel ve üstü planlarda."
      steps={[
        { name: 'Tarayıcıda anahtar üret', text: 'ASO → Apple Search Ads sekmesi → Bağla → "Otomatik Anahtar Üret". Web Crypto API ile ES256 anahtar çifti tarayıcında üretilir; public key panoya kopyalanır.' },
        { name: 'Apple\'a public key yapıştır', text: 'Apple Search Ads → hesap ayarları → API → Public Key kutusuna yapıştır → kaydet.' },
        { name: 'Apple\'ın verdiği bilgileri geri yapıştır', text: 'Apple clientId, teamId ve keyId verir. Bu satırları kopyalayıp sihirbazdaki kutuya yapıştır; alanlar otomatik ayrıştırılır.' },
        { name: 'Bağla + test et', text: 'Apple\'a kimlik doğrulama çağrısı yapılır. Private key bu adımda RanksUp\'a HTTPS ile iletilir ve AES-256-GCM ile şifrelenerek saklanır. Başarılıysa hesap aktif olur.' },
        { name: 'AI ile ilk kampanyayı kur', text: 'Yeni Kampanya → "AI ile Doldur": ASO\'daki anahtar kelimelerden teklif ve bütçe önerisi gelir, sen onaylarsın.' },
        { name: 'Auto-Pilot\'u aç', text: 'Her hesabın altında Auto-Pilot anahtarı var. Bütçe sınırını ayarla; Auto-Pilot her gün düşük performanslı anahtar kelimeleri durdurur, yenilerini ekler.' },
      ]}
    >
      <h2>Apple Search Ads (ASA)</h2>
      <p>
        App Store&apos;da kullanıcı arama yaptığında sonuçların üstünde gösterilen sponsorlu reklamlar.
        ASO ile organik sıralamayı yükseltmek zaman alır; ASA ile aynı aramalarda reklam olarak görünebilirsin. Reklam harcaması Apple
        hesabından ödenir.
      </p>

      <h3>ASA bağlantı — 3 adımda</h3>
      <p>Sihirbazla <strong>terminal ya da openssl gerekmez</strong>. Tarayıcıda ES256 anahtar çifti üretilir, public key&apos;i Apple&apos;a yapıştırırsın, Apple&apos;ın verdiği bilgileri RanksUp&apos;a yapıştırırsın.</p>

      <Step n={1} title="Anahtar üret (tarayıcıda)">
        ASO → <strong>Apple Search Ads</strong> sekmesi → <strong>&ldquo;Bağla&rdquo;</strong> → 1. adım <strong>&ldquo;Otomatik Anahtar Üret&rdquo;</strong>. Web Crypto API ile ES256 anahtar çifti tarayıcında üretilir.
        Apple&apos;a yalnızca public key yüklenir; <strong>private key Apple&apos;a gönderilmez</strong>. Bağla adımında RanksUp&apos;a HTTPS ile iletilir ve Apple Ads
        çağrılarını imzalamak için AES-256-GCM ile şifrelenerek saklanır.
      </Step>
      <Step n={2} title="Apple'a public key yapıştır">
        2. adımdaki &ldquo;Apple Search Ads&apos;i aç&rdquo; butonu yeni sekme açar ve public key&apos;i yeniden panoya kopyalar. Apple&apos;daki API ayarları sayfasına git
        (sihirbaz, adres çubuğundaki uygulama numarasından doğru sayfaya yönlendirebilir). Public Key kutusuna yapıştır ve kaydet.
      </Step>
      <Step n={3} title="Bilgileri geri yapıştır">
        Apple <strong>clientId</strong>, <strong>teamId</strong> ve <strong>keyId</strong> verir. Bu satırları kopyalayıp sihirbazdaki kutuya yapıştır; alanlar otomatik ayrıştırılır.
      </Step>
      <Step n={4} title="Bağla + test et">
        Apple&apos;a kimlik doğrulama çağrısı yapılır. Başarılıysa hesap aktif olur.
      </Step>

      <Tip kind="warn">
        Apple, hesapta ödeme yöntemi tanımlı değilse kampanya oluşturmaya izin vermez.
        Apple Search Ads hesap ayarlarındaki faturalama bölümünden ödeme yöntemi ekledikten sonra kampanya kurabilirsin.
      </Tip>

      <h3>Yeni kampanya — AI ile doldur</h3>
      <p>
        Yeni Kampanya penceresinin üstünde <strong>&ldquo;AI ile Doldur&rdquo;</strong> butonu var. ASO&apos;da takip ettiğin anahtar kelimelerden organik sırası 15&apos;in
        altında olan ya da hiç sıralanmayanları trafik puanına göre seçer, teklif ve bütçe önerir; kampanya adı ve uygulama kimliği otomatik dolar. Kampanyayı sen onaylarsın.
      </p>

      <h3>Auto-Pilot</h3>
      <p>Her hesap satırının altında <strong>&ldquo;Auto-Pilot&rdquo;</strong> paneli. Açtığında her gün:</p>
      <ul>
        <li>Son 7 günde 20 ya da daha fazla dokunma alıp hiç indirme getirmeyen anahtar kelime <strong>durdurulur</strong></li>
        <li>AI önerisinden, hesapta henüz olmayan en fazla 5 anahtar kelime <strong>eklenir</strong></li>
        <li>Bu ayki harcama bütçe sınırına ulaştıysa Auto-Pilot o gün <strong>hiçbir işlem yapmaz</strong> (mevcut kampanyalar Apple&apos;da çalışmaya devam eder)</li>
      </ul>

      <h2>App Store Connect (ASC) — yorumlar ve sürümler</h2>
      <p>App Store Connect API ile müşteri yorumları, sürüm geçmişi ve uzun süredir güncellenmeyen uygulamalar için uyarılar.</p>

      <Step n={1} title="ASC bağla">
        ASO sayfasında <strong>App Store Connect</strong> sekmesi. <strong>Bağla</strong> → Apple Developer&apos;dan üretilen Issuer ID + Key ID + .p8 dosyası.
      </Step>
      <Step n={2} title="Uygulamaları eşitle">
        Bağlantıdan sonra <strong>Eşitle</strong> butonuna bas. Apple hesabındaki uygulamaların RanksUp&apos;a gelir. Uygulamalar ve sürümler her gün otomatik olarak yeniden eşitlenir.
      </Step>
      <Step n={3} title="Yorumları çek">
        Her uygulamanın altındaki <strong>Yorumlar</strong> butonu en yeni 50&apos;ye kadar yorumu ve ortalama puanı getirir. Yorumlar otomatik çekilmez; bu butonla güncellersin.
      </Step>
      <Step n={4} title="Uyarıları takip et">
        60 günden uzun süredir yeni sürüm yoksa uyarı, 120 günü geçtiyse kritik uyarı oluşur — uygulamanın uzun süredir güncellenmediğini hatırlatır.
      </Step>

      <Tip kind="info">
        ASA + ASC birlikte: reklamla görünürlük (ASA) + organik sıralama (ASO) + yorum ve puan takibi (ASC) tek panelde.
      </Tip>
    </HelpArticle>
  );
}
