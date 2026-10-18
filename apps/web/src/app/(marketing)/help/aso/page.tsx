import { Search } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'ASO — Mobil App SEO — RanksUp Help' };

// Metin ürünün gerçek davranışını anlatır (sayılar koddan: AI önerisi en fazla 50,
// yorum çekimi mağaza başına en fazla 50, sıra ölçüm derinliği App Store ~100 /
// Google Play ~30). Eski sürümdeki "50+ öneri", "son 100 yorum", "her platform
// ayrı app" ve rakip araçlarla kıyas cümleleri doğru değildi.
export default function Page() {
  return (
    <HelpArticle slug="aso"
      icon={Search}
      badge="ASO"
      title="App Store + Play Store sıralama takibi"
      intro="Mobil uygulaman App Store ve Google Play'de hangi keyword'lerde kaçıncı sırada? RanksUp her gece sıra ölçümü, AI keyword araştırması, rakip metadata analizi ve optimizasyon önerileri sunar."
    >
      <h2>3 büyük modül</h2>

      <h3>Keywords — manuel + AI önerisi</h3>
      <p>
        Senin app&apos;ine uygun keyword&apos;leri ekle. Her keyword&apos;ün sırası her gece otomatik ölçülür; talep, zorluk ve trafik
        skorlarını görürsün. Ölçüm derinliği App Store&apos;da ilk ~100, Google Play&apos;de ilk ~30 sonuçtur.
      </p>
      <ul>
        <li>Tek tek ya da toplu ekleme</li>
        <li>AI önerisi — uygulamanın ve rakiplerinin metinlerinden en fazla 50 öneri; rakip uygulama adları ve fiyat/&ldquo;en iyi&rdquo; gibi mağaza kurallarına aykırı terimler ayıklanır</li>
        <li>Otomatik rakip keşfi (mağazanın benzer uygulamalar listesinden)</li>
      </ul>

      <h3>Metadata — AI metin önerisi</h3>
      <p>
        Mevcut mağaza metnine dayanan AI önerisi. App Store: ad (30), alt başlık (30), anahtar kelime alanı (100), açıklama (4000 karakter).
        Google Play: ad (30), kısa açıklama (80), açıklama (4000 karakter). Mağaza verisinde olmayan puan, kullanıcı sayısı ve ödül iddiaları
        ile fiyat ifadeleri öneriden çıkarılır; ne çıkarıldığı ekranda listelenir.
      </p>

      <h3>Reviews — yorum analizi</h3>
      <p>
        Her mağazadan en yeni 50&apos;ye kadar yorumu çek; duygu analizi ve konu etiketleri. Yorumlara yanıt taslağı için App Store Connect
        bağlantısı gerekir.
      </p>

      <h2>İlk kurulum</h2>
      <Step n={1} title="Site'e ASO modülü ekle">
        Site menüsünde <strong>Mobil Uygulama → ASO</strong>&apos;ya git. <strong>&ldquo;Uygulama ekle&rdquo;</strong> → uygulama adı, mağaza bağlantısı, App Store ID ya da Play Store package gir.
      </Step>
      <Step n={2} title="iOS ve Android tek uygulama">
        Aynı uygulamanın iki mağazası tek kayıtta birleşir. İkinci mağazayı uygulama sayfasındaki <strong>&ldquo;sürümünü bağla&rdquo;</strong> ile ekle;
        aynı adla yeniden eklersen de mevcut kayda bağlanır ve ayrı uygulama sayılmaz. iOS için App Store URL&apos;indeki `id1234567890`,
        Android için package adı (örn. `com.kobipratik.app`).
      </Step>
      <Step n={3} title="Manuel ya da AI ile keyword ekle">
        Kelimeleri tek tek ya da <strong>Toplu ekle</strong> ile gir, ya da <strong>AI önerisi al</strong>. Sıralar her gece ölçülür; hemen görmek
        için <strong>Tüm sıraları güncelle</strong>.
      </Step>
      <Step n={4} title="Yorumları çek">
        <strong>Yorumlar</strong> sekmesi → <strong>&ldquo;Yorumları çek ve analiz et&rdquo;</strong>. Mağaza başına en yeni 50&apos;ye kadar yorum,
        duygu analizi ve konu etiketleri.
      </Step>

      <Tip kind="info">
        AI önerilerinde her kelimenin kaynağı (rakip metni ya da AI) ve 1-10 uygunluk puanı görünür.
      </Tip>

      <h2>Sonraki adım: ASA + ASC</h2>
      <p>
        ASO sekmesi organik sıralamayı ölçer. Arama sonuçlarında reklamla görünmek istersen Apple Search Ads (ücretli) kullan.
        Yorumlara yanıt için App Store Connect API entegrasyonu gerekir.
      </p>
      <p><a href="/help/asa-asc">Apple Search Ads + ASC rehberini oku</a></p>

      <Tip kind="success">
        ASO + ASA + ASC: sıralama takibi, reklam yönetimi ve App Store Connect işlemleri tek panelde.
      </Tip>
    </HelpArticle>
  );
}
