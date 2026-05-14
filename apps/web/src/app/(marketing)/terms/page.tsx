import Link from 'next/link';

export default function TermsPage() {
  return (
    <main className="relative">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
      </div>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Link href="/" className="text-sm text-muted-foreground hover:text-orange-600 transition-colors">← Ana sayfa</Link>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mt-8 mb-3">
          <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
            Kullanım
          </span>{' '}
          Koşulları
        </h1>
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
            <h2 className="text-xl font-bold mb-2">7. Sosyal Medya Entegrasyonları</h2>
            <p className="text-muted-foreground">
              LuviAI; LinkedIn, X (Twitter), Bluesky, TikTok, YouTube, Facebook, Instagram, Threads ve Pinterest
              gibi platformlara OAuth 2.0 ile bağlanır. Her bağlantı kullanıcının açık rızasıyla yapılır;
              kullanıcı her zaman dashboard'dan bağlantıyı koparıp yetkiyi geri alabilir. LuviAI yalnızca
              kullanıcının onayladığı içerikleri kullanıcı adına yayınlar; otomatik yayın seçeneği bile
              kullanıcının önceden tanımladığı kurallar çerçevesinde çalışır. Yayınlanan tüm içeriğin sorumluluğu
              kullanıcıya aittir; ilgili platformların topluluk kurallarına uyum kullanıcının yükümlülüğüdür.
              Bir platformla yapılan entegrasyon, o platformun geliştirici politikalarına ve kullanım koşullarına
              tabidir.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">8. Hesap Sonlandırma</h2>
            <p className="text-muted-foreground">
              Yasak kullanım tespit edilirse hesap askıya alınabilir. Veriler 30 gün saklanır, sonra silinir.
              Sosyal medya OAuth token'ları hesap sonlandırılmasından sonra 30 gün içinde geri dönüşsüz silinir.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">9. Yetkili Mahkeme</h2>
            <p className="text-muted-foreground">
              Türkiye Cumhuriyeti hukuku geçerlidir. İstanbul Mahkemeleri yetkilidir.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
