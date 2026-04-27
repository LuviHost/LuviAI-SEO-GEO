import Link from 'next/link';

export default function KvkkPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container max-w-3xl py-12">
        <Link href="/" className="text-sm text-muted-foreground hover:text-brand">← Ana sayfa</Link>
        <h1 className="text-4xl font-bold mt-6 mb-2">KVKK Aydınlatma Metni</h1>
        <p className="text-sm text-muted-foreground mb-8">Yürürlük: 27 Nisan 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-bold mb-2">Veri Sorumlusu</h2>
            <p className="text-muted-foreground">
              LuviHost (LuviAI işleten kuruluş). Veri sorumlu iletişim:{' '}
              <a href="mailto:kvkk@luvihost.com" className="text-brand">kvkk@luvihost.com</a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">İşlenen Kişisel Veriler</h2>
            <p className="text-muted-foreground">
              Hesap bilgileri (email, ad), site bilgileri (URL, marka), GSC OAuth tokens (şifreli), publish
              credentials (şifreli), ödeme bilgileri (PayTR aracılığıyla, biz tutmayız).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">İşleme Amaçları</h2>
            <ul className="text-muted-foreground space-y-1">
              <li>• Hizmet sunumu (AI içerik üretimi, SEO audit)</li>
              <li>• Kullanıcı destek hizmeti</li>
              <li>• Ödeme işlemleri</li>
              <li>• Yasal yükümlülüklerin yerine getirilmesi</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">Aktarılan Taraflar</h2>
            <p className="text-muted-foreground">
              Anthropic (AI içerik), Google (Gemini, GSC API), PayTR (ödeme), Resend (email), Cloudflare (CDN).
              Hiçbir veri pazarlama amaçlı 3. taraflara satılmaz.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">Veri Sahibinin Hakları</h2>
            <p className="text-muted-foreground">
              KVKK 11. madde kapsamında: bilgilendirilme, erişim, düzeltme, silme, işleme itiraz, taşınabilirlik
              hakları kullanılabilir. Talepler{' '}
              <a href="mailto:kvkk@luvihost.com" className="text-brand">kvkk@luvihost.com</a>{' '}
              adresine yapılır.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
