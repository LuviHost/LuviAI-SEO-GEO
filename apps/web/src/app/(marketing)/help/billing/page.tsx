import { CreditCard } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'Faturalama — RanksUp Help' };

// Kodla dogrulandi (Ekim 2026):
//  - Iade kurali Kullanim Sartlari md. 4 ile ayni (terms/page.tsx); eski
//    "ilk 7 gun kosulsuz iade" vaadi hicbir yerde gecmiyordu. Iade otomatik
//    degil (billing/page.tsx notu).
//  - Plan satin alininca hemen etkinlesir (paytr.service activateSubscription);
//    "downgrade ay sonu" diye bir zamanlama yok.
//  - Fatura gecmisi: tarih, aciklama, TL tutar, durum (billing/page.tsx). PDF
//    indirme ve TCKN/VKN alani yok — eski metin bunlari vaat ediyordu.
//  - Kota sayaclari takvim ayi basinda sifirlanir (quota.service
//    maybeReset*); deneme hesabinin 2 makalesi sifirlanmaz.
//  - Gunluk otomatik AI olcumu KAPALI; olcum kullanici tetikli, haftada bir.
//  - Haftalik hak hesap basina (measurement-allowance.service kv anahtari
//    ai-olcum:<userId>), tum siteler ortak. Plan listesindeki calistirma sayisi
//    bir olcum hakki degil aylik TAVAN (QuotaService citationTests): AI testi 1,
//    Prompt Lab'de her soru ve her dal 1. Panelin "Tumunu calistir" dugmesi tek
//    olcumde en fazla 25 soru calistirir (prompt-lab-panel runAllPrompts limit).
//    Eski liste "20 calistirma" diyordu ve ayda 20 olcum gibi okunuyordu.
export default function Page() {
  return (
    <HelpArticle slug="billing"
      icon={CreditCard}
      badge="Faturalama"
      title="Plan, fatura, iptal, kotalar"
      intro="Plan seçimi, ödeme geçmişi, iptal ve kotalar — hepsi panelindeki Abonelik sayfasından yönetilir."
    >
      {/* Fiyat YAZILMAZ — TL karsiligi gunun TCMB kuruyla hesaplandigi icin
          bu sayfada sabit tutmak kacinilmaz olarak bayatliyordu (₺1.499 /
          ₺4.999 ... gercegin bes'te biriydi). Kotalar plans.ts ile ayni.
          Ayrica "post" ve "video" kotalari urunden kaldirilmisti, burada
          hala satiliyordu. */}
      <h2>Planlar</h2>
      <p>
        Her planda AI görünürlük ölçümü hesap başına 7 günde 1&apos;dir; planlar ölçüm sıklığında değil, aylık çalıştırma tavanında ayrışır
        (ayrıntı aşağıda, <a href="#kotalar">Kotalar</a> bölümünde).
      </p>
      <ul>
        <li><strong>Ücretsiz Deneme</strong> — 2 makale + 3 AI görünürlük çalıştırması (haftada en fazla 1 ölçüm) + 1 site (kart gerekmez)</li>
        <li><strong>Büyüme</strong> — 15 makale + ayda en fazla 20 çalıştırma + 2 site</li>
        <li><strong>Profesyonel</strong> (en çok tercih edilen) — 40 makale + ayda en fazla 75 çalıştırma + 5 site, Apple Search Ads ve App Store Connect dahil</li>
        <li><strong>Ajans</strong> — 100 makale + ayda en fazla 300 çalıştırma + 15 site, Programmatic SEO ve Product Radar dahil</li>
        <li><strong>Kurumsal</strong> — 350 makale + ayda en fazla 1.000 çalıştırma + 50 site, BYOK, MCP, REST API, özel hesap yöneticisi + SLA</li>
      </ul>
      <p>
        Güncel fiyatlar için <a href="/pricing">fiyatlandırma sayfasına</a> bakın. Fiyatlar ABD doları
        üzerinden belirlenir; tahsilat Türk lirasıyla, ödeme anındaki TCMB kuruyla yapılır.
      </p>
      <p>Yıllık planda <strong>%17 indirim</strong> (10 ay öder, 12 ay kullanırsın).</p>

      <h2>Plan değiştirme</h2>
      <Step n={1} title="Abonelik sayfasını aç">
        Hesap menüsünden <strong>Abonelik</strong> sayfasına git ve <strong>&ldquo;Planları karşılaştır&rdquo;</strong> butonuna bas.
      </Step>
      <Step n={2} title="Yeni planı seç">
        Fiyatlandırma sayfasında Büyüme, Profesyonel ya da Ajans planını seç. Kurumsal plan satış ekibiyle, sözleşmeli kurulur.
      </Step>
      <Step n={3} title="Ödemeyi tamamla">
        Ödeme PayTR ile alınır. Ödeme onaylanınca yeni plan hemen etkinleşir.
      </Step>

      <h2>Ödeme geçmişi</h2>
      <p>
        Abonelik sayfasındaki <strong>Fatura geçmişi</strong> bölümünde her ödemenin tarihi, açıklaması, Türk lirası tutarı ve durumu listelenir.
        Sorular için <a href="mailto:destek@luvihost.com">destek@luvihost.com</a>.
      </p>

      <h2>İptal</h2>
      <Step n={1} title="Abonelik sayfası">
        <strong>&ldquo;Aboneliği iptal et&rdquo;</strong> butonuna bas.
      </Step>
      <Step n={2} title="Ödenen dönemin sonuna kadar kullanırsın">
        Ödeme döneminin sonuna kadar tüm özelliklerin açık kalır; sonra hesabın deneme düzeyine geçer.
        Sitelerin ve içeriklerin bu yüzden silinmez. Hesabını tamamen silmek istersen aynı sayfadaki hesap silme bölümünü kullanırsın.
      </Step>

      <Tip kind="info">
        <strong>İade (Kullanım Şartları md. 4):</strong> aylık plan istediğin zaman iptal edilir ve ödenen dönemin sonuna kadar erişim sürer.
        Yıllık planda ilk 30 gün tam iade, sonrasında kalan ay başına orantılı iade yapılır. İade otomatik değildir; talebini{' '}
        <a href="mailto:destek@luvihost.com">destek@luvihost.com</a> adresine yaz.
      </Tip>

      <Tip kind="success">
        <strong>Eski fiyat koruması:</strong> Mayıs 2026 fiyat güncellemesinden önce abone olanlar eski fiyatlarıyla 6 ay devam eder. Süre bitmeden 30 gün önce hatırlatma e-postası gönderilir.
      </Tip>

      <h2 id="kotalar" className="scroll-mt-20">Kotalar — aylık sıfırlama</h2>
      <p>
        Makale, AI görünürlük çalıştırması ve RanksUp Video sayaçları her takvim ayının başında sıfırlanır. Deneme hesabındaki 2 ücretsiz makale hakkı sıfırlanmaz.
        Site kotası sabittir — plan limitini aşan yeni site eklenemez.
      </p>
      <p>
        Aylık kotalardan ayrı olarak hesap başına 7 günde 1 AI ölçümü yapılabilir ve tüm sitelerin bu hakkı paylaşır. AI testi, yol haritası,
        Prompt Lab, panelden başlattığın site taramasındaki AI testi ve diğer ölçümler bu haftalık hakka sayılır; sonuç vermeyen ölçüm hakkı yakmaz.
      </p>
      <p>
        Plan listesindeki çalıştırma sayısı ölçümlerin aylık tavanıdır: AI testi 1, Prompt Lab&apos;de her soru ve her dal 1 çalıştırma sayılır. Bu yüzden tek bir haftalık
        ölçüm birden çok çalıştırma kullanabilir; örneğin Prompt Lab&apos;deki &ldquo;Tümünü çalıştır&rdquo; tek ölçümde en fazla 25 soruyu
        çalıştırır ve her soru bir çalıştırma sayılır.
      </p>

      <h3>Aşımda ne olur?</h3>
      <ul>
        <li><strong>Makale</strong> — kendi başlattığın yeni üretimler durur ve takvime yeni konu eklenemez; site eklenirken takvime yerleşen makaleler de bekler. Hakkın dolmadan takvime eklediğin konular zamanı gelince yine üretilir. Ay başını bekleyebilir ya da planını yükseltebilirsin</li>
        <li><strong>AI görünürlük çalıştırması</strong> — havuzdaki sağlayıcılarla yeni ölçüm başlatılamaz. Otomatik günlük ölçüm olmadığı için grafikler de yeni bir ölçüm yapılana kadar güncellenmez</li>
        <li><strong>RanksUp Video</strong> (Profesyonel ve üstü) — yeni video istenemez; ay başını bekleyebilir ya da planını yükseltebilirsin. Üretilemeyen videonun ve sırada beklerken sildiğin videonun hakkı iade edilir (<a href="/help/video">RanksUp Video rehberi</a>)</li>
        <li><strong>AI bütçesi %80</strong> — panelde uyarı görünür</li>
        <li><strong>AI bütçesi %100</strong> — görsel alt metni önerisi ve App Store yorum yanıtı taslağı gibi işlemler durur</li>
      </ul>

      <Tip kind="warn">
        BYOK (kendi sağlayıcı anahtarınla) kullanırsan aylık çalıştırma kotası dolsa bile o sağlayıcıyla ölçüm sürer; haftalık ölçüm hakkı yine geçerlidir. Kurumsal plana dahildir — <a href="/help/api-keys">BYOK rehberi</a>.
      </Tip>

      <h2>Ödeme + KVKK</h2>
      <p>
        Ödeme PayTR ile alınır; kart numaran RanksUp&apos;ta saklanmaz.
      </p>
      <p>
        Google bağlantı token&apos;ları ve yayın hedefi bilgileri AES-256-GCM ile şifreli saklanır. Sunucular LuviHost İstanbul veri merkezinde,
        yedekler Frankfurt bölgesindedir (<a href="/privacy">Gizlilik Politikası</a>).
      </p>
    </HelpArticle>
  );
}
