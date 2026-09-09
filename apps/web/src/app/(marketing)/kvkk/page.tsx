import Link from 'next/link';

export default function KvkkPage() {
  return (
    <main className="relative">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
      </div>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Link href="/" className="text-sm text-muted-foreground hover:text-brand-600 transition-colors">← Ana sayfa</Link>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mt-8 mb-3">
          <span className="bg-gradient-to-r from-brand-500 via-brand-600 to-red-600 bg-clip-text text-transparent">
            KVKK
          </span>{' '}
          Aydınlatma Metni
        </h1>
        <p className="text-sm text-muted-foreground mb-8">Yürürlük: 27 Nisan 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-bold mb-2">Veri Sorumlusu</h2>
            <p className="text-muted-foreground">
              LuviHost (RanksUp işleten kuruluş). Veri sorumlu iletişim:{' '}
              <a href="mailto:kvkk@luvihost.com" className="text-brand-600">kvkk@luvihost.com</a>
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
              Anthropic (AI içerik), Google (Gemini, GSC API), PayTR (ödeme), Resend (email), Mailjet (kurumsal e-posta gönderimi), Cloudflare (CDN).
              Hiçbir veri pazarlama amaçlı 3. taraflara satılmaz.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">Veri Sahibinin Hakları</h2>
            <p className="text-muted-foreground">
              KVKK 11. madde kapsamında: bilgilendirilme, erişim, düzeltme, silme, işleme itiraz, taşınabilirlik
              hakları kullanılabilir. Talepler{' '}
              <a href="mailto:kvkk@luvihost.com" className="text-brand-600">kvkk@luvihost.com</a>{' '}
              adresine yapılır.
            </p>
          </section>

          {/* Kurumsal soğuk e-posta / araştırma daveti kampanyası için ayrı aydınlatma: alıcılar
              RanksUp kullanıcısı değil, kamuya açık kurumsal kaynaklardan derlenen yetkililer olduğu
              için yukarıdaki hesap-temelli bölümler bu işlemeyi kapsamıyor. Gönderilen e-postalar
              bu bölüme #kurumsal-iletisim çapasıyla bağlantı verir; id'yi değiştirme. */}
          <section id="kurumsal-iletisim" className="scroll-mt-24">
            <h2 className="text-xl font-bold mb-2">Kurumsal İletişim ve Araştırma Davetleri</h2>
            <p className="text-muted-foreground mb-3">
              RanksUp, kurumsal karar vericilere ürün tanıtımı ve araştırma/görüşme daveti amacıyla
              e-posta gönderebilir. Bu iletişim kapsamında işlenen veriler ve koşullar aşağıdadır.
            </p>
            <ul className="text-muted-foreground space-y-2">
              <li>
                <strong className="text-foreground">İşlenen veriler:</strong> ad, soyad, unvan ve kurumsal
                e-posta adresi.
              </li>
              <li>
                <strong className="text-foreground">Veri kaynağı:</strong> kamuya açık kurumsal kaynaklar
                (KAP bildirimleri, şirket web siteleri, basın ve atama haberleri). Veriler ilgili kişiden
                doğrudan toplanmamıştır; bu bölüm KVKK md. 10 kapsamındaki aydınlatma yükümlülüğünü
                yerine getirir.
              </li>
              <li>
                <strong className="text-foreground">Hukuki sebep:</strong> KVKK md. 5/2-f uyarınca veri
                sorumlusunun meşru menfaati ile 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında
                Kanun md. 6/2 uyarınca tacir ve esnafa yönelik ticari elektronik ileti istisnası.
              </li>
              <li>
                <strong className="text-foreground">Aktarım:</strong> e-postalar, e-posta gönderim hizmeti sağlayıcısı
                Mailjet üzerinden iletilir; veriler yalnızca gönderim amacıyla bu sağlayıcıya aktarılır.
              </li>
              <li>
                <strong className="text-foreground">Saklama:</strong> veriler, ilgili kişi ret veya itiraz
                bildirene kadar saklanır. Ret talepleri 3 iş günü içinde işlenir ve İleti Yönetim Sistemi
                (İYS) kaydına ret olarak işlenir; sonrasında ilgili adrese yeniden ticari ileti gönderilmez.
              </li>
              <li>
                <strong className="text-foreground">Haklar ve itiraz:</strong> KVKK md. 11 kapsamındaki
                haklarınızı kullanmak, işlemeye itiraz etmek veya ileti almayı reddetmek için{' '}
                <a href="mailto:kvkk@luvihost.com" className="text-brand-600">kvkk@luvihost.com</a>{' '}
                adresine yazabilir ya da e-postadaki ret bağlantısını kullanabilirsiniz.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
