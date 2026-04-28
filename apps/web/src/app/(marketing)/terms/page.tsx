import Link from 'next/link';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container max-w-3xl py-12">
        <Link href="/" className="text-sm text-muted-foreground hover:text-brand">← Ana sayfa</Link>
        <h1 className="text-4xl font-bold mt-6 mb-2">Kullanım Koşulları</h1>
        <p className="text-sm text-muted-foreground mb-8">Yürürlük: 27 Nisan 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-bold mb-2">1. Hizmet Tanımı</h2>
            <p className="text-muted-foreground">
              LuviAI, kullanıcı sitelerinin SEO + GEO + AEO performansını AI ile otomatikleştiren bir SaaS hizmetidir.
              Hizmet, Resend.com (email), Anthropic (Claude AI), Google AI (Gemini), PayTR (ödeme) ile entegre çalışır.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">2. Üyelik & Trial</h2>
            <p className="text-muted-foreground">
              Kayıt olan herkes 1 makaleyi ücretsiz üretebilir. Süre sınırı yoktur, kart bilgisi gerekmez.
              İkinci ve sonraki makaleler için bir plan seçilmesi gerekir.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">3. Ücretler</h2>
            <p className="text-muted-foreground">
              Aylık veya yıllık ödeme. KDV dahil. Yıllık planda %20 indirim. PayTR ile güvenli ödeme. İptal sonrası
              kalan ay sonuna kadar erişim devam eder.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">4. İptal & İade</h2>
            <p className="text-muted-foreground">
              Aylık planda istediğiniz zaman iptal. Yıllık planda ilk 30 gün full iade, sonrası kalan ay başına
              orantılı iade.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">5. Sorumluluk Reddi</h2>
            <p className="text-muted-foreground">
              AI tarafından üretilen içerik, kullanıcı tarafından gözden geçirilmelidir. LuviAI içerik doğruluğunu
              garanti etmez. SEO sonuçları (Google sıralaması, trafik artışı) garanti altında değildir.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">6. Yasak Kullanım</h2>
            <ul className="text-muted-foreground space-y-1">
              <li>• Spam içerik üretimi</li>
              <li>• Telif haklarını ihlal eden içerik</li>
              <li>• Yanıltıcı sağlık/finans tavsiyesi</li>
              <li>• Yetkisiz kişilerin hesabını kullanma</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">7. Hesap Sonlandırma</h2>
            <p className="text-muted-foreground">
              Yasak kullanım tespit edilirse hesap askıya alınabilir. Veriler 30 gün saklanır, sonra silinir.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">8. Yetkili Mahkeme</h2>
            <p className="text-muted-foreground">
              Türkiye Cumhuriyeti hukuku geçerlidir. İstanbul Mahkemeleri yetkilidir.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
