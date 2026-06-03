import { MessageSquare } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'Sosyal Medya — RanksUp Help' };

export default function Page() {
  return (
    <HelpArticle slug="social"
      icon={MessageSquare}
      badge="Sosyal Medya"
      title="5 kanalda AI ile post + zamanlama"
      intro="LinkedIn, X (Twitter), Instagram, TikTok, Facebook — tek panel, AI ile post üretim, görsel/video ekleme, takvime ekleme. Studio'dan asset seç, hepsine paylaş."
    >
      <h2>Desteklenen kanallar</h2>
      <ul>
        <li><strong>LinkedIn</strong> — kişisel + şirket sayfası, metin + görsel + video</li>
        <li><strong>X (Twitter)</strong> — metin + görsel + video</li>
        <li><strong>Instagram</strong> — feed + story (görsel zorunlu)</li>
        <li><strong>TikTok</strong> — video zorunlu</li>
        <li><strong>Facebook</strong> — sayfa post, metin + görsel + video</li>
        <li><strong>YouTube</strong> — uzun video upload (yakında)</li>
      </ul>

      <h2>Bağlantı</h2>
      <Step n={1} title="Site dashboard → Yayın Hedefleri">
        Sol menü → <strong>Yayın Hedefleri</strong>. Her kanal için <strong>"Bağla"</strong> butonu.
      </Step>
      <Step n={2} title="OAuth onayı">
        Yeni sekme açılır, ilgili platformun OAuth ekranına gider. İzinleri kabul edersin. (LinkedIn için: posting + media.write scope'ları)
      </Step>
      <Step n={3} title="Geri dön → bağlandı">
        OAuth tamamlanınca otomatik geri yönlendirme. "Bağlandı ✓" rozeti.
      </Step>

      <h2>Post oluşturma — 3 yol</h2>

      <h3>1. Studio kütüphanesinden paylaş</h3>
      <p>Studio'da görsel/video ürettiysen <strong>Paylaş</strong> butonu ile direkt multi-channel post.</p>

      <h3>2. Yeni Post wizard (boş başla)</h3>
      <p><strong>Sosyal Yayın</strong> tab'ında <strong>"Yeni Post"</strong> → 4 adım: Medya → Metin → Platform → Tarih.</p>

      <h3>3. Makale paylaşımı</h3>
      <p>İçerikler sekmesinden bir makaleyi <strong>"Sosyalde Paylaş"</strong> ile multi-channel olarak yayınla.</p>

      <Step n={1} title="Medya tipi seç (görsel/video/metin)">
        Hangi kanallara uygun olduğu otomatik filtrelenir (örn. video → tüm kanallar, metin → TikTok/YouTube yok).
      </Step>
      <Step n={2} title="AI ile içerik öner">
        <strong>"AI ile yaz"</strong> — konu yaz, ton seç, AI 3 farklı varyant üretir.
      </Step>
      <Step n={3} title="Tarih seç + zamanla">
        Şimdi gönder veya tarih/saat ile takvime ekle. İçerik Takvimi'nde görürsün.
      </Step>

      <Tip kind="info">
        Çoklu kanal paylaşımında her kanal için ayrı metin uyarlanır (LinkedIn uzun, X kısa, Insta hashtag yoğun). AI otomatik uyarlar.
      </Tip>

      <h2>İçerik Takvimi</h2>
      <p>
        <strong>İçerik Takvimi</strong> sekmesinde aylık görünüm — hangi gün hangi platforma hangi içerik?
        Makale + sosyal post hepsi tek takvimde. Drag-drop ile gün değiştirebilir, sağ tık ile sil/düzenle.
      </p>

      <Tip kind="success">
        Auto-Pilot ON + Studio + Sosyal Yayın birlikte: haftada 1 saatlik içerik briefi → ay boyu 30 post otomatik yayınlanır.
      </Tip>
    </HelpArticle>
  );
}
