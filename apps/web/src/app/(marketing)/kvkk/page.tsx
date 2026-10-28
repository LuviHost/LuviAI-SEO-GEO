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
            (28 Ekim 2026: aktarim listesi, ucretsiz test ve LinkedIn), gizlilik sayfasiyla ayni gun. */}
        <p className="text-sm text-muted-foreground mb-1">Yürürlük: 27 Nisan 2026</p>
        <p className="text-sm text-muted-foreground mb-1">Son güncelleme: 28 Ekim 2026</p>
        <p className="text-sm text-muted-foreground mb-8">
          Değişiklik: Aktarılan Taraflar bölümüne yalnız çerez onayınızla yüklenen Google ve Microsoft araçları ile sizi
          davet eden iş ortağının ortaklık panelinde gördüğü bilgiler eklendi. İşlenen Kişisel Veriler bölümüne RanksUp
          Video için sitenizden okunan marka bilgileri ve üretilen video dosyaları eklendi (21 Ekim 2026). Aktarılan
          Taraflar listesi kodda kullanılan tüm hizmet sağlayıcılarla tamamlandı (AI görünürlük ölçümü için OpenAI,
          Perplexity, xAI ve DeepSeek; görsel üreticileri; Sentry; Cloudflare Turnstile; IndexNow; bağladığınız Google,
          Meta ve Apple hizmetleri); ücretsiz AI görünürlük testi ve tekrar ölçüm e-postaları için yeni bölüm eklendi;
          Kurumsal İletişim bölümü LinkedIn kanalını da kapsayacak şekilde genişletildi (28 Ekim 2026).
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
            <p className="text-muted-foreground mt-2">
              Apple ile girişte Apple’ın ilettiği e-posta adresi, ad ve Apple kullanıcı kimliği; yalnız siz bağlarsanız
              Google Search Console, Google Analytics 4, Google Ads, Google İşletme Profili, Meta (Facebook) reklam hesabı,
              App Store Connect ve Apple Search Ads bağlantı anahtarları (şifreli) ile bu hesaplardan okunan veriler; ödeme
              sırasında PayTR’ye iletilen ad, e-posta ve IP adresi; sunucu hatalarında hata kaydına giren istek bilgileri
              (Gizlilik Politikası 1. ve 3. bölüm). Hesabı olmayan ziyaretçilerde ücretsiz testte girilen alan adı, IP
              adresinin özetlenmiş (hash) hâli ve tekrar ölçüm e-postası istenirse e-posta adresi (aşağıda ve Gizlilik
              Politikası 8. bölüm).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">İşleme Amaçları</h2>
            <ul className="text-muted-foreground space-y-1">
              <li>• Hizmet sunumu (AI içerik üretimi, SEO audit)</li>
              <li>• AI görünürlük ölçümü (hesap sahipleri ve ücretsiz testi kullanan ziyaretçiler için)</li>
              <li>• Bağladığınız hizmetlerden veri okunması ve sizin adınıza yayın ya da reklam yönetimi</li>
              <li>• Hizmet güvenliği, kötüye kullanımın önlenmesi ve hataların tespiti</li>
              <li>• Ücretsiz test sonrası, onay verdiğiniz tekrar ölçüm e-postalarının gönderilmesi</li>
              <li>• Kullanıcı destek hizmeti</li>
              <li>• Ödeme işlemleri</li>
              <li>• Yasal yükümlülüklerin yerine getirilmesi</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">Aktarılan Taraflar</h2>
            {/* Liste koddan dogrulandi (28.10.2026; ayrinti privacy/page.tsx baslik yorumu). Groq (Llama)
                uretimde cagrilmiyor (GROQ_LLAMA_MODEL tanimsiz) — listede yok. Ulke bilgisi yalniz AI
                olcum saglayicilari ve PayTR icin yazili; digerleri "yurt disi" olarak gecer. */}
            <ul className="text-muted-foreground space-y-1">
              <li>
                • AI görünürlük ölçümü ve içerik üretimi: Anthropic (Claude, ABD), Google (Gemini, ABD), OpenAI (ChatGPT,
                ABD), Perplexity (ABD), xAI (Grok, ABD) ve DeepSeek (Çin). Ölçümde marka adı, alan adı, sektör, varsa rakip
                adları ve ölçüm soruları; içerik üretiminde site ve marka bilgileri, anahtar kelimeler ve içerik taslakları
                gönderilir.
              </li>
              <li>
                • Makale görseli üretimi: seçili görsel üreticisi (Google, OpenAI, Black Forest Labs Flux ya da Ideogram);
                yalnız makale başlığını içeren görsel tarifi gönderilir.
              </li>
              <li>• Ödeme: PayTR (Türkiye).</li>
              <li>• E-posta: Resend (hesap, bildirim ve ücretsiz test e-postaları), Mailjet (kurumsal e-posta gönderimi).</li>
              <li>• Hata izleme: Sentry (sunucu hatalarının teknik kaydı; IP adresi eklenmez).</li>
              <li>• Altyapı ve güvenlik: Cloudflare (CDN, saldırı koruması ve ücretsiz araç formlarında Turnstile bot doğrulaması; doğrulamada IP adresi iletilir).</li>
              <li>
                • Arama motoru bildirimi ve sayfa hızı: IndexNow (yayınlanan yazı adresleri; Bing, Yandex gibi arama
                motorlarının ortak bildirim servisi), Google PageSpeed Insights (sayfa adresleri).
              </li>
              <li>
                • Bağladığınız hizmetler: Google (Search Console, Analytics, Ads, İşletme Profili, Places), Meta (Facebook)
                ve Apple (App Store Connect, Apple Search Ads, Apple ile giriş); yalnız bu hesapları bağladığınızda ya da
                Apple ile giriş yaptığınızda.
              </li>
            </ul>
            <p className="text-muted-foreground mt-2">
              PayTR dışındaki sağlayıcıların çoğu yurt dışında yerleşiktir; bu sağlayıcılara aktarılan veriler yurt dışına
              aktarılmış olur. Ayrıntılar{' '}
              <Link href="/privacy" className="text-brand-600">Gizlilik Politikası’nın 3. bölümünde</Link>.
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
              adresine yapılır. Verilerinizin bir kopyasını da bu adrese yazarak isteyebilirsiniz; panelde otomatik dışa
              aktarma bulunmadığından kopya elle hazırlanarak e-postayla iletilir.
            </p>
          </section>

          {/* Ucretsiz test ziyaretcileri hesap sahibi degil; yukaridaki hesap-temelli bolumler bu
              islemeyi tam kapsamiyor. Davranis: audit/public-citation*.ts (hash IP, cift onay,
              15/30/60/90 gun, iptal satiri silmez, otomatik silme yok). Hukuki sebep YAZILMADI:
              sahip/hukuk karari (onay kutusu var: checker-overlay.tsx). */}
          <section id="ucretsiz-test" className="scroll-mt-24">
            <h2 className="text-xl font-bold mb-2">Ücretsiz AI Görünürlük Testi ve Tekrar Ölçüm E-postaları</h2>
            <ul className="text-muted-foreground space-y-2">
              <li>
                <strong className="text-foreground">İşlenen veriler:</strong> test ettiğiniz alan adı, sitenizden tespit
                edilen marka adı ve sektör, ölçüm sonuçları ve IP adresinizin geri döndürülemez biçimde özetlenmiş (hash)
                hâli. Tekrar ölçüm e-postası isterseniz ayrıca e-posta adresiniz, dil tercihiniz, onay zamanınız ve size
                gönderilen e-postaların kaydı.
              </li>
              <li>
                <strong className="text-foreground">Amaç:</strong> markanızın yapay zekâ asistanlarındaki görünürlüğünü
                ölçmek, kötüye kullanımı önlemek ve test hakkını sınırlamak; onay verirseniz sitenizi 15, 30, 60 ve 90.
                günlerde yeniden ölçüp sonucu e-postayla göndermek. Onay e-postasındaki bağlantıyla aboneliği onaylamazsanız
                başka e-posta gönderilmez; dört ölçümden sonra e-postalar kendiliğinden durur.
              </li>
              <li>
                <strong className="text-foreground">Aktarım:</strong> marka adı, alan adı, sektör ve test soruları ölçüm için
                Aktarılan Taraflar bölümündeki yapay zekâ sağlayıcılarına; e-postalar Resend üzerinden gönderilir; bot
                doğrulamasında IP adresiniz Cloudflare’a iletilir.
              </li>
              <li>
                <strong className="text-foreground">Saklama:</strong> test kayıtları ve abonelik kaydı belirli bir süre sonunda
                ya da abonelikten çıktığınızda kendiliğinden silinmez; silinmesini aşağıdaki adresten isteyebilirsiniz. Aynı
                e-posta adresiyle açılan RanksUp hesabı silinirse abonelik kaydı da hesapla birlikte silinir.
              </li>
              <li>
                <strong className="text-foreground">Abonelikten çıkma ve haklar:</strong> her e-postadaki “Aboneliği iptal
                et” bağlantısıyla istediğiniz an çıkabilirsiniz. Silme ve diğer KVKK md. 11 talepleriniz için{' '}
                <a href="mailto:kvkk@luvihost.com" className="text-brand-600">kvkk@luvihost.com</a>{' '}
                adresine yazabilirsiniz. Ayrıntılar{' '}
                <Link href="/privacy#ucretsiz-araclar" className="text-brand-600">Gizlilik Politikası’nın 8. bölümünde</Link>.
              </li>
            </ul>
          </section>

          {/* Kurumsal soğuk e-posta / araştırma daveti kampanyası için ayrı aydınlatma: alıcılar
              RanksUp kullanıcısı değil, kamuya açık kurumsal kaynaklardan derlenen yetkililer olduğu
              için yukarıdaki hesap-temelli bölümler bu işlemeyi kapsamıyor. Gönderilen e-postalar
              bu bölüme #kurumsal-iletisim çapasıyla bağlantı verir; id'yi değiştirme.
              LinkedIn kanali (28.10.2026, intel/linkedin-outreach.service.ts + schema LinkedinProspect,
              ProspectKarne): ad, soyad, firma, unvan, sektor, profil URL'si, gonderilen not/mesaj metni,
              istek/kabul/mesaj/cevap tarihleri, adim ekran goruntuleri, insan satis notu; kurum karnesi
              runPublicProbes'a yalniz kurum adi + alan adi gonderir, karne linkinin acilma sayisi tutulur.
              Cevap gelince (REPLIED) bot yazmaz; ret → SKIPPED (elle). Otomatik silme yok.
              E-posta kanali: EpostaHedef firma, web, kaynak sayfa, Mailjet olaylari (acilma/tiklama dahil). */}
          <section id="kurumsal-iletisim" className="scroll-mt-24">
            <h2 className="text-xl font-bold mb-2">Kurumsal İletişim ve Araştırma Davetleri</h2>
            <p className="text-muted-foreground mb-3">
              RanksUp, kurumsal karar vericilere ürün tanıtımı ve araştırma/görüşme daveti amacıyla
              e-posta ve LinkedIn üzerinden ileti gönderebilir. Bu iletişim kapsamında işlenen veriler ve
              koşullar aşağıdadır.
            </p>
            <ul className="text-muted-foreground space-y-2">
              <li>
                <strong className="text-foreground">İşlenen veriler (e-posta):</strong> ad, soyad, unvan ve kurumsal
                e-posta adresi (çoğu durumda yalnızca info@ gibi kurumsal bir adres ile firma adı ve web sitesi);
                verinin alındığı kaynak sayfa; e-postanın teslim, açılma, tıklanma, ret ve geri dönme olayları.
              </li>
              <li>
                <strong className="text-foreground">İşlenen veriler (LinkedIn):</strong> ad, soyad, unvan, çalışılan kurum,
                sektör ve LinkedIn profil adresi; gönderilen bağlantı notu ve mesajların metni; bağlantı isteğinin,
                kabulün, mesajın ve cevabın tarihleri; işlemin doğru kişiye yapıldığını kanıtlamak için LinkedIn sayfasının
                o anki ekran görüntüsü; görüşme sürecine ilişkin iç notlar. Kurumunuz için ücretsiz AI görünürlük raporu
                hazırlanırsa raporun bağlantısının kaç kez ve en son ne zaman açıldığı da kaydedilir.
              </li>
              <li>
                <strong className="text-foreground">Veri kaynağı:</strong> kamuya açık kurumsal kaynaklar
                (KAP bildirimleri, şirket web siteleri, basın ve atama haberleri) ile LinkedIn’de görüntülenebilen
                profesyonel profil bilgileri (LinkedIn arama sonuçları ve profil sayfaları). Veriler ilgili kişiden
                doğrudan toplanmamıştır; bu bölüm KVKK md. 10 kapsamındaki aydınlatma yükümlülüğünü
                yerine getirir.
              </li>
              <li>
                <strong className="text-foreground">Hukuki sebep:</strong> KVKK md. 5/2-f uyarınca veri
                sorumlusunun meşru menfaati; e-posta iletileri için ayrıca 6563 sayılı Elektronik Ticaretin
                Düzenlenmesi Hakkında Kanun md. 6/2 uyarınca tacir ve esnafa yönelik ticari elektronik ileti istisnası.
              </li>
              <li>
                <strong className="text-foreground">Aktarım:</strong> e-postalar, e-posta gönderim hizmeti sağlayıcısı
                Mailjet üzerinden iletilir; veriler yalnızca gönderim amacıyla bu sağlayıcıya aktarılır. LinkedIn
                iletişimi LinkedIn platformu üzerinden yürütülür: bağlantı istekleri ve mesajlar, günlük ve haftalık
                gönderim sınırları olan bir otomasyon aracıyla RanksUp adına kullanılan bir LinkedIn hesabından
                gönderilir; cevap verdiğinizde yazışmayı bir kişi devralır ve otomatik ileti gönderilmez. Kurumunuz için
                AI görünürlük raporu hazırlanırsa yalnız kurumunuzun adı ve alan adı Aktarılan Taraflar bölümündeki yapay
                zekâ sağlayıcılarına gönderilir; adınız ve profil bilgileriniz gönderilmez.
              </li>
              <li>
                <strong className="text-foreground">Saklama:</strong> veriler, ilgili kişi ret veya itiraz
                bildirene kadar saklanır. Ret talepleri 3 iş günü içinde işlenir ve İleti Yönetim Sistemi
                (İYS) kaydına ret olarak işlenir; sonrasında ilgili adrese yeniden ticari ileti gönderilmez.
                LinkedIn üzerinden ret bildirirseniz kaydınız işaretlenir ve size LinkedIn üzerinden yeniden ileti
                gönderilmez; kayıtların silinmesini ayrıca isteyebilirsiniz.
              </li>
              <li>
                <strong className="text-foreground">Haklar ve itiraz:</strong> KVKK md. 11 kapsamındaki
                haklarınızı kullanmak, işlemeye itiraz etmek veya ileti almayı reddetmek için{' '}
                <a href="mailto:kvkk@luvihost.com" className="text-brand-600">kvkk@luvihost.com</a>{' '}
                adresine yazabilir, e-postadaki ret bağlantısını kullanabilir ya da LinkedIn mesajına
                cevap olarak ret bildirebilirsiniz.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
