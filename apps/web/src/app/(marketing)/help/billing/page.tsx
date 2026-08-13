import { CreditCard } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'Faturalama — RanksUp Help' };

export default function Page() {
  return (
    <HelpArticle slug="billing"
      icon={CreditCard}
      badge="Faturalama"
      title="Plan, fatura, iptal, kotalar"
      intro="Tüm ödeme ve plan işlemlerini buradan yönetirsin. Otomatik fatura, kart değişikliği, plan upgrade/downgrade, iptal — hepsi self-service."
    >
      {/* Fiyat YAZILMAZ — TL karsiligi gunun TCMB kuruyla hesaplandigi icin
          bu sayfada sabit tutmak kacinilmaz olarak bayatliyordu (₺1.499 /
          ₺4.999 ... gercegin bes'te biriydi). Kotalar plans.ts ile ayni.
          Ayrica "post" ve "video" kotalari urunden kaldirilmisti, burada
          hala satiliyordu. */}
      <h2>Planlar</h2>
      <ul>
        <li><strong>Ücretsiz Deneme</strong> — 2 makale + 3 AI görünürlük çalıştırması + 1 site (kart gerekmez)</li>
        <li><strong>Büyüme</strong> — 15 makale + 20 çalıştırma + 2 site</li>
        <li><strong>Profesyonel ⭐</strong> — 40 makale + 75 çalıştırma + 5 site, Apple Search Ads ve App Store Connect dahil</li>
        <li><strong>Ajans</strong> — 100 makale + 300 çalıştırma + 15 site, Programmatic SEO ve Product Radar dahil</li>
        <li><strong>Kurumsal</strong> — 350 makale + 1.000 çalıştırma + 50 site, BYOK, MCP, REST API, özel hesap yöneticisi + SLA</li>
      </ul>
      <p>
        Güncel fiyatlar için <a href="/pricing">fiyatlandırma sayfasına</a> bakın. Fiyatlar ABD doları
        üzerinden belirlenir; Türk lirası karşılığı ödeme anındaki TCMB kuruyla hesaplanır.
      </p>
      <p>Yıllık planda <strong>%17 indirim</strong> (10 ay öder, 12 ay kullanırsın).</p>

      <h2>Plan değiştirme</h2>
      <Step n={1} title="Sağ üst → Ayarlar → Plan">
        Hesap menüsünden Ayarlar → Plan & Faturalama sekmesi.
      </Step>
      <Step n={2} title="Yeni planı seç">
        Upgrade veya downgrade. Upgrade anlık aktif, downgrade ay sonu efektif.
      </Step>
      <Step n={3} title="Ödeme onayı">
        PayTR ile güvenli ödeme. 3D Secure aktif.
      </Step>

      <h2>Fatura indirme</h2>
      <p>Settings → Faturalama → Faturalar tab. Her aylık fatura PDF olarak indirilebilir. KDV dahil + TCKN/VKN ile düzenlenir.</p>

      <h2>İptal</h2>
      <Step n={1} title="Settings → Plan & Faturalama">
        <strong>"Aboneliği İptal Et"</strong> butonu (kırmızı, en altta).
      </Step>
      <Step n={2} title="Ay sonuna kadar kullanırsın">
        Ödeme dönemi sonuna kadar tüm modüller açık kalır. Sonra Trial moduna düşer (veriler 90 gün korunur).
      </Step>

      <Tip kind="info">
        İlk 7 gün içinde iptal edersen <strong>koşulsuz iade</strong>. Mail at: <a href="mailto:destek@luvihost.com">destek@luvihost.com</a>
      </Tip>

      <Tip kind="success">
        <strong>Grandfathering:</strong> 2026-05 öncesi mevcut müşterilerimiz eski fiyatlarla 6 ay devam eder. 30 gün önce hatırlatma maili gönderilir.
      </Tip>

      <h2>Kotalar — aylık reset</h2>
      <p>
        Her ayın 1'inde kotalar sıfırlanır (makale ve AI görünürlük çalıştırması).
        Site kotası sabittir — plan limitini aşan yeni site eklenemez.
      </p>

      <h3>Aşımda ne olur?</h3>
      <ul>
        <li><strong>Makale</strong> — yeni makale üretemez, plan upgrade promosu çıkar</li>
        <li><strong>AI görünürlük çalıştırması</strong> — yeni ölçüm başlatılamaz; platformun günlük otomatik izlemesi kotadan düşmediği için grafiklerin akmaya devam eder</li>
        <li><strong>AI bütçe %80</strong> — sarı uyarı banner</li>
        <li><strong>AI bütçe %100</strong> — hard block: yeni AI istekleri durdurulur</li>
      </ul>

      <Tip kind="warn">
        BYOK (kendi sağlayıcı anahtarınla) kullanırsan havuz kotası dolsa bile ölçümün durmaz. Kurumsal plana dahildir — <a href="/help/api-keys">API Keys rehberi</a>.
      </Tip>

      <h2>Vergi + KVKK</h2>
      <p>
        Faturalar Türk vergi mevzuatına uygun. Şirket için VKN, bireysel için TCKN ile düzenlenir.
        Yurt dışı için USD faturalandırma mevcut (locale=en).
      </p>
      <p>
        KVKK uyumlu: anonim event tracking (IP yok), key'ler şifreli, veri merkezi Türkiye'de.
      </p>
    </HelpArticle>
  );
}
