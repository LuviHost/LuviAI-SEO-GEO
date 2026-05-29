import { CreditCard } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'Faturalama — LuviAI Help' };

export default function Page() {
  return (
    <HelpArticle slug="billing"
      icon={CreditCard}
      badge="Faturalama"
      title="Plan, fatura, iptal, kotalar"
      intro="Tüm ödeme ve plan işlemlerini buradan yönetirsin. Otomatik fatura, kart değişikliği, plan upgrade/downgrade, iptal — hepsi self-service."
    >
      <h2>Planlar (Mayıs 2026 — Premium Pricing)</h2>
      <ul>
        <li><strong>Trial</strong> — ₺0, 2 makale + 5 post + 1 site (kart gerekmez)</li>
        <li><strong>Başlangıç</strong> — ₺1.499/ay ($37), 15 makale + 15 post + 1 site, video add-on'dan satın al</li>
        <li><strong>Profesyonel ⭐</strong> — ₺4.999/ay ($125), 40 makale + 30 post + 5 AI video + 3 site</li>
        <li><strong>Ajans</strong> — ₺14.999/ay ($375), 100 makale + 80 post + 20 video + 12 site</li>
        <li><strong>Kurumsal</strong> — ₺34.999+/ay ($875+), 350 makale + 200 post + 100 video + 50 site, özel hesap yöneticisi + SLA</li>
      </ul>
      <p>Yıllık planda <strong>%17 indirim</strong> (10 ay öder, 12 ay kullanırsın).</p>

      <h3>Video Credit Add-on (pay-as-you-go)</h3>
      <p>Plan kotanız dolunca ek video paketi satın alabilirsiniz. Süresiz geçerli, plan kotası önce tüketilir.</p>
      <ul>
        <li><strong>5 video paketi</strong> — ₺499 (≈ ₺100/video)</li>
        <li><strong>20 video paketi</strong> — ₺1.799 (≈ ₺90/video, %28 indirim)</li>
        <li><strong>50 video paketi</strong> — ₺3.999 (≈ ₺80/video, en avantajlı)</li>
      </ul>

      <h2>Plan değiştirme</h2>
      <Step n={1} title="Sağ üst → Ayarlar → Plan">
        Hesap menüsünden Ayarlar → Plan & Faturalama sekmesi.
      </Step>
      <Step n={2} title="Yeni planı seç">
        Upgrade veya downgrade. Upgrade anlık aktif, downgrade ay sonu efektif.
      </Step>
      <Step n={3} title="Ödeme onayı">
        Iyzico veya PayTR ile güvenli ödeme. 3D Secure aktif.
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
        Her ayın 1'inde kotalarn sıfırlanır (makale, sosyal post, video, AI bütçe).
        Sites kotası fix (mevcut site sayın limiti aşarsa fazla siteler suspend).
      </p>

      <h3>Aşımda ne olur?</h3>
      <ul>
        <li><strong>Makale</strong> — yeni makale üretemez, plan upgrade promosu çıkar</li>
        <li><strong>Video</strong> — yeni video üretemez (SLIDESHOW ücretsiz, kotadan düşmez)</li>
        <li><strong>AI bütçe %80</strong> — sarı uyarı banner</li>
        <li><strong>AI bütçe %100</strong> — hard block: yeni AI istekleri durdurulur</li>
      </ul>

      <Tip kind="warn">
        BYOK (kendi API key'inle) kullanırsan kota saymaz — sınırsız üretim. <a href="/help/api-keys">API Keys rehberi</a>.
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
