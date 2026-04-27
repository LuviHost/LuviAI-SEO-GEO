import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container max-w-3xl py-12 prose dark:prose-invert">
        <Link href="/" className="text-sm text-muted-foreground hover:text-brand">← Ana sayfa</Link>
        <h1 className="text-4xl font-bold mt-6 mb-2">Gizlilik Politikası</h1>
        <p className="text-sm text-muted-foreground mb-8">Yürürlük: 27 Nisan 2026</p>

        <h2 className="text-xl font-bold mt-8 mb-3">1. Toplanan Veriler</h2>
        <ul className="space-y-1 text-sm">
          <li>• Hesap bilgileri: email, ad, varsa profil fotoğrafı</li>
          <li>• Site bilgileri: URL, marka adı, niş</li>
          <li>• GSC OAuth tokens (AES-256-GCM şifreli)</li>
          <li>• Publish hedefi credentials (FTP/SFTP/WP, AES-256-GCM şifreli)</li>
          <li>• Ödeme bilgileri PayTR\'de saklanır, biz kart numarası tutmayız</li>
        </ul>

        <h2 className="text-xl font-bold mt-8 mb-3">2. Veri Kullanımı</h2>
        <p className="text-sm text-muted-foreground">
          Toplanan veriler sadece hizmet sunumu için kullanılır: AI içerik üretimi, SEO audit, GSC analizi, yayın
          otomasyonu. Üçüncü tarafa satılmaz veya pazarlama amaçlı paylaşılmaz.
        </p>

        <h2 className="text-xl font-bold mt-8 mb-3">3. Veri İşleme Konumu</h2>
        <p className="text-sm text-muted-foreground">
          Sunucularımız LuviHost İstanbul veri merkezinde bulunur. Yedeklemeler S3-compatible storage'da Frankfurt
          bölgesinde tutulur. AI çağrıları Anthropic (US) ve Google (multi-region) servislerine gider.
        </p>

        <h2 className="text-xl font-bold mt-8 mb-3">4. Çerezler</h2>
        <p className="text-sm text-muted-foreground">
          Oturum yönetimi için zorunlu çerezler kullanılır. Analytics için Plausible (cookie-free) tercih edilir.
        </p>

        <h2 className="text-xl font-bold mt-8 mb-3">5. Haklarınız (KVKK)</h2>
        <ul className="space-y-1 text-sm">
          <li>• Verilerinize erişim talep etme</li>
          <li>• Düzeltme talep etme</li>
          <li>• Silme talep etme (hesap silindiğinde 30 gün sonra geri dönüşsüz silinir)</li>
          <li>• Veri taşınabilirliği (JSON export)</li>
        </ul>

        <h2 className="text-xl font-bold mt-8 mb-3">6. İletişim</h2>
        <p className="text-sm text-muted-foreground">
          Veri sorumlu: LuviHost. Email: <a href="mailto:kvkk@luvihost.com" className="text-brand">kvkk@luvihost.com</a>
        </p>
      </div>
    </main>
  );
}
