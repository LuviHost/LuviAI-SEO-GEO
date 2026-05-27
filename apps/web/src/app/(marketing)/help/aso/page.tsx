import { Search } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'ASO — Mobil App SEO — LuviAI Help' };

export default function Page() {
  return (
    <HelpArticle slug="aso"
      icon={Search}
      badge="ASO"
      title="App Store + Play Store sıralama takibi"
      intro="Mobil uygulaman App Store ve Google Play'de hangi keyword'lerde kaçıncı sırada? LuviAI günlük rank check, AI keyword araştırması, rakip metadata analizi ve optimizasyon önerileri sunar."
    >
      <h2>3 büyük modül</h2>

      <h3>Keywords — manuel + AI önerisi</h3>
      <p>Senin app'ine uygun keyword'leri ekle. Her keyword için günlük rank check (App Store'da 1. mi, 47. mi?), popularity, difficulty, traffic skorları.</p>
      <ul>
        <li>Manuel ekleme + bulk import</li>
        <li>AI Keyword Research — rakip analiziyle 50+ öneri</li>
        <li>Otomatik rakip keşfi (App Store top 100'den semantic match)</li>
      </ul>

      <h3>Optimize — AI metadata önerisi</h3>
      <p>Mevcut app title, subtitle, description, keywords (100 karakter) için AI önerisi. Hedef: arama sıralaması + organic install conversion artışı.</p>

      <h3>Reviews — yorum analizi + yanıt</h3>
      <p>Son 100 yorumu çek, sentiment analizi, tema gruplama, "yanıt taslağı" AI önerisi.</p>

      <h2>İlk kurulum</h2>
      <Step n={1} title="Site'e ASO modülü ekle">
        Site dashboard'ında <strong>ASO (Mobil App)</strong> sekmesine git. <strong>"App Ekle"</strong> → App Store ID veya Play Store package gir.
      </Step>
      <Step n={2} title="iOS + Android'i ayrı ekle">
        Her platform ayrı app. iOS için App Store URL'inden `id1234567890` çıkar. Android için package adı (örn. `com.kobipratik.app`).
      </Step>
      <Step n={3} title="Manuel ya da AI ile keyword ekle">
        <strong>Tek Keyword Ekle</strong> (manuel) veya <strong>AI Keyword Research</strong> (50+ öneri, 1 dakika). AI önerilerden ekleyince otomatik rank check başlar.
      </Step>
      <Step n={4} title="Reviews fetch">
        <strong>Reviews</strong> tab → "Yorumları Çek". Son 100 yorum + sentiment skor + ana temalar.
      </Step>

      <Tip kind="info">
        AI önerilerde rakiplerin keyword'lerini ve sıralamalarını da görürsün — gizli rekabet istihbaratı.
      </Tip>

      <h2>Sonraki adım: ASA + ASC</h2>
      <p>
        ASO tab'ı keyword sıralamalarını ölçer ama sıralama yükseltmek istersen Apple Search Ads (paid) kullan.
        Yorumlara cevap için App Store Connect API entegrasyonu lazım.
      </p>
      <p><a href="/help/asa-asc">Apple Search Ads + ASC rehberini oku</a></p>

      <Tip kind="success">
        ASO + ASA + ASC üçlüsü mobil app sahipleri için tam paket — Apptweak/SensorTower'ın yaptığının tamamı.
      </Tip>
    </HelpArticle>
  );
}
