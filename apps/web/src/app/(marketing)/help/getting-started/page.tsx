import { Rocket } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'Hızlı Başlangıç — RanksUp Help' };

// Kodla dogrulandi (Ekim 2026):
//  - Web'de kayit YALNIZ Google ile (apps/web/src/auth.ts tek saglayici);
//    mobil uygulamada Google ya da iPhone'da Apple (mobile/app/connect.tsx).
//    Eski metin "mail + şifre" formu vaat ediyordu.
//  - "Yeniden Test" (citation-snapshot) ve "AI önerisi al" (citation-roadmap)
//    AYNI haftalik olcum hakkini kullanir (@MeasurementSession). Rehber ikisini
//    arka arkaya yaptiriyordu; ikinci buton 7 gun kilitli kaliyordu.
//  - Onboarding'deki site taramasi AI testini de icerir ama haftalik hakki
//    KULLANMAZ: worker ONBOARDING_CHAIN audit.runAudit'i trigger 'system' ile
//    cagirir (5d418ac). Eski metin "bu haftanin olcum hakkini kullanmis
//    olabilir" diyordu; yeni kullanici "AI onerisi al" dugmesini kilitli sanip
//    beklemesin. Otomatik akis acikken alinan baslangic olcumu da 'system'.
export default function Page() {
  return (
    <HelpArticle slug="getting-started"
      icon={Rocket}
      badge="Başlangıç"
      title="5 dakikada başla"
      intro="RanksUp'ta hesap aç, ilk siteni ekle, ilk AI bulgularını gör."
      steps={[
        { name: 'Hesap aç', text: 'Landing\'de "Ücretsiz başla" ya da "Ücretsiz hesap aç" → "Google ile devam et". Web\'de kayıt Google hesabıyla yapılır; mobil uygulamada Google ya da iPhone\'da Apple ile giriş yapılır. Kart istenmez; ilk 2 makale ücretsiz.' },
        { name: 'Siteni ekle', text: 'Panelde "Site ekle" (sonradan sol menüde "Yeni site ekle") → alan adını yaz → "Analizi başlat". AI sitenin sektörünü tahmin eder; gerekirse site ayarlarından değiştirirsin.' },
        { name: 'İlk bulguları gör', text: 'Kurulum ekranında aşamalar bittikçe ilk bulgular görünür: platform, hedef persona, rakipler, site skoru, ilk düzeltilecek madde ve ilk yazılacak içerik.' },
        { name: 'AI görünürlük ölçümü ve yol haritası', text: 'Sol menü → AI Görünürlük → "AI önerisi al": ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek\'e en fazla 5 soru sorulur ve sonuca göre 5 uygulanabilir öneri üretilir. Hesap başına haftada bir AI ölçümü yapılabilir; kurulum sırasında alınan ilk ölçüm haftalık hakkından düşmez.' },
        { name: 'İlk makaleni üret', text: 'İçerikler → AI\'ın önerdiği bir konunun yanındaki "Üret" butonu. Makale 5 ajanlı üretim hattından ve yayın öncesi kalite kapısından geçer.' },
      ]}
    >
      <h2>Adım 1: Hesap aç</h2>
      <Step n={1} title="Ücretsiz başla">
        Landing&apos;deki <strong>&ldquo;Ücretsiz başla&rdquo;</strong> ya da <strong>&ldquo;Ücretsiz hesap aç&rdquo;</strong> butonuna bas, ardından
        <strong> &ldquo;Google ile devam et&rdquo;</strong>. Web&apos;de kayıt Google hesabınla tek tıkla yapılır; ayrı bir e-posta / şifre formu yoktur.
        Mobil uygulamada Google ya da iPhone&apos;da Apple ile giriş yapabilirsin.
      </Step>
      <Step n={2} title="Ücretsiz deneme otomatik açılır">
        Kart bilgisi istenmez. Denemede <strong>2 ücretsiz makale</strong>, 3 AI görünürlük çalıştırması (haftada en fazla 1 ölçüm) ve 1 site hakkın var; tüm modüller menüde görünür (plan gerektirenler kilitli gösterilir).
      </Step>

      <h2>Adım 2: İlk siteni ekle</h2>
      <Step n={1} title="Alan adını yaz">
        Panelde <strong>&ldquo;Site ekle&rdquo;</strong> butonuna bas (sonradan sol menüde <strong>&ldquo;Yeni site ekle&rdquo;</strong>). Yalnızca alan adını yaz: <code>siten.com</code> — https:// yazman gerekmez. <strong>&ldquo;Analizi başlat&rdquo;</strong>.
      </Step>
      <Step n={2} title="AI sektörünü tahmin eder">
        Kurulum sitenin sektörünü (niş) tahmin eder. Yanlışsa site <strong>Ayarlar</strong> sayfasından sektörü ve dili değiştirebilirsin.
      </Step>
      <Step n={3} title="İlk bulgular görünür">
        Kurulum ekranında her aşama bittikçe bulgular listelenir: platform, hedef persona, rakipler, site skoru, ilk düzeltilecek madde ve ilk yazılacak içerik.
      </Step>

      <Tip kind="info">
        Kurulum genelde birkaç dakikada biter. Uzun sürerse ekranda <strong>&ldquo;Kurulumu yeniden başlat&rdquo;</strong> ve <strong>&ldquo;Panele git&rdquo;</strong> seçenekleri çıkar;
        eksikleri panelde görürsün. Site, güvenlik duvarı ya da bot doğrulaması yüzünden okunamıyorsa nedeni ve çözüm yolu gösterilir.
      </Tip>

      <h2>Adım 3: İlk AI çıktısını al</h2>
      <Step n={1} title="AI Görünürlük sayfasına git">
        Sol menüde <strong>AI Görünürlük</strong> sayfasını aç. Kurulumdaki site taraması AI testini de içerir; otomatik akış açıksa bir başlangıç
        ölçümü de grafikte görünür. Kurulumdaki bu ölçümler haftalık hakkından düşmez. Hak kullanıldıysa butonların altında bir sonraki ölçümün açılacağı tarih yazar.
      </Step>
      <Step n={2} title={'Haftalık ölçüm: "AI önerisi al"'}>
        <strong>GEO yol haritası</strong> bölümündeki <strong>&ldquo;AI önerisi al&rdquo;</strong> butonuna bas: ChatGPT, Claude, Gemini, Perplexity, Grok ve
        DeepSeek&apos;e en fazla 5 soru sorulur, markanın anılıp anılmadığı ve sitenin kaynak gösterilip gösterilmediği ölçülür ve sonuca göre
        5 uygulanabilir öneri üretilir (örn. &ldquo;FAQ şeması ekle&rdquo;). Hesap başına haftada bir AI ölçümü yapılabilir: grafikteki
        <strong> &ldquo;Yeniden Test&rdquo;</strong> de aynı hakkı kullanır, sonucu ölçüm geçmişine kaydeder. Aynı hafta ikisinden birini seç.
      </Step>
      <Step n={3} title="İlk makaleni üret">
        <strong>İçerikler</strong> sayfasında AI&apos;ın önerdiği bir konunun yanındaki <strong>&ldquo;Üret&rdquo;</strong> butonuna bas. Makale 5 ajanlı
        üretim hattından ve yayın öncesi kalite kapısından geçer.
      </Step>

      <Tip kind="success">
        Bu noktada AI siteni taradı, eksikleri buldu, öneri çıkardı ve ilk içeriği yazdı. Denemede 2 ücretsiz makale hakkın var.
      </Tip>

      <h2>Sonraki adımlar</h2>
      <ul>
        <li><a href="/help/ai-visibility">AI Görünürlük rehberi</a> — duygu, ses payı, konum ve haftalık ölçüm</li>
        <li><a href="/help/aso">ASO rehberi</a> — App Store + Play Store anahtar kelime takibi</li>
        <li><a href="/help/asa-asc">Apple Search Ads</a> — iOS reklam kurulumu</li>
        {/* /help/studio yok (Studio modulu kaldirildi, 404 veriyordu) — var olan sozluk sayfasi */}
        <li><a href="/help/glossary">SEO &amp; GEO sözlüğü</a> — SEO, GEO, AEO, schema ve reklam terimleri</li>
        <li><a href="/help/auto-pilot">Otomatik akış ve Auto-Pilot</a> — neler otomatik, neleri sen başlatırsın</li>
      </ul>
    </HelpArticle>
  );
}
