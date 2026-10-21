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
        {/* Icerik degisti (Aktarilan Taraflar: yalniz cerez onayiyla yuklenen Google ve Microsoft
            araclari) ama sayfada yalniz yururluk tarihi vardi; okuyan metnin degistigini goremezdi.
            Gizlilik sayfasindaki duzen: yururluk tarihi korunur, son guncelleme ve degisiklik notu
            ayrica yazilir (okuyan neyin degistigini de gorsun). Tarih bu icerigin yayin gunu
            (21 Ekim 2026: RanksUp Video eklendi), gizlilik sayfasiyla ayni gun. */}
        <p className="text-sm text-muted-foreground mb-1">Yürürlük: 27 Nisan 2026</p>
        <p className="text-sm text-muted-foreground mb-1">Son güncelleme: 21 Ekim 2026</p>
        <p className="text-sm text-muted-foreground mb-8">
          Değişiklik: Aktarılan Taraflar bölümüne yalnız çerez onayınızla yüklenen Google ve Microsoft araçları ile sizi
          davet eden iş ortağının ortaklık panelinde gördüğü bilgiler eklendi. İşlenen Kişisel Veriler bölümüne RanksUp
          Video için sitenizden okunan marka bilgileri ve üretilen video dosyaları eklendi (21 Ekim 2026).
        </p>

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
              credentials (şifreli), ödeme bilgileri (PayTR aracılığıyla, biz tutmayız). RanksUp Video kullanırsanız
              sitenizin herkese açık sayfalarından okunan ad, logo ve tema rengi, site ya da ürün tanıtım videosunda ayrıca
              ana sayfanızın ya da belirttiğiniz ürün/hizmet sayfasının metni ve ürün görseli ile üretilen video dosyaları;
              video metni için yalnızca makale metni ya da sitenizin kendi sayfasının metni Anthropic’e gönderilir, görseller
              gönderilmez (Gizlilik Politikası 1. ve 6. bölüm).
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
            {/* Analitik ve pazarlama araclari bu listede yoktu; layout bunlari yalniz cerez
                onayindan sonra yukler (lib/consent.ts). Ifade gizlilik sayfasinin cerez
                bolumuyle ayni. Yurt disina aktarimin hukuki dayanagi (KVKK m.9) icin bir iddia
                YAZILMAZ, yalniz olgu: dayanak sahip/hukuk karari. */}
            <p className="text-muted-foreground mt-2">
              Yalnız çerez bandında “Kabul et” derseniz: Google (Google Tag Manager ve Google Analytics 4 ile ziyaret
              istatistikleri, Google Ads ile dönüşüm ölçümü ve yeniden pazarlama) ve Microsoft (Microsoft Clarity ile
              oturum kaydı ve ısı haritası). “Reddet” derseniz ya da seçim yapmazsanız bu araçlar hiç yüklenmez. Bu
              araçların topladığı veriler yurt dışında yerleşik Google ve Microsoft’a aktarılır. Ayrıntılar ve onayı geri
              alma yolu{' '}
              <Link href="/privacy#cerezler" className="text-brand-600">Gizlilik Politikası’nın çerezler bölümünde</Link>.
            </p>
            {/* Ortaklik paneli de bir alicidir: ortak davetlisinin kisaltilmis etiketini ve davet
                olgularini gorur (affiliate.service getStats, referral-label.ts). Ifade gizlilik
                sayfasinin luvi_ref maddesiyle ayni; biri degisirse digeri ayni committe. */}
            <p className="text-muted-foreground mt-2">
              Bir iş ortağının davet bağlantısıyla kaydolduysanız: sizi davet eden ortak, ortaklık panelinde adınızı (14
              karakterden uzunsa yalnız ilk 12 karakterini; adınız kayıtlı değilse e-posta adresinizin @ işaretinden önceki
              kısmını aynı kuralla), kayıt ve ilk
              ödeme tarihinizi, ödeme durumunuzu, komisyon süresinin bitiş tarihini ve ödemelerinizden kazandığı komisyon
              tutarını görür; e-posta adresinizi görmez. Sizi davet eden kişi de başka bir ortağın davetlisiyse, o ortak da
              aynı adı, kayıt ve ilk ödeme tarihinizi ve ödeme durumunuzu görür; bu ikinci seviyeden komisyon ödenmez. Ayrıntılar{' '}
              <Link href="/privacy#cerezler" className="text-brand-600">Gizlilik Politikası’nın çerezler bölümünde</Link>{' '}
              (luvi_ref).
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
