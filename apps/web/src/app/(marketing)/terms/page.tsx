'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';

const CONTENT = {
  tr: {
    backHome: '← Ana sayfa',
    titleA: 'Kullanım',
    titleB: 'Koşulları',
    effective: 'Yürürlük: 27 Nisan 2026',
    // Icerik degisti (8. madde eklendi; 7. ve 9. madde kaldirilan sosyal paylasima gore
    // duzeltildi); yururluk tarihi korunur, okuyan degisikligi gorsun diye son guncelleme ve
    // not ayrica yazilir (gizlilik sayfasindaki duzen)
    updated: 'Son güncelleme: 22 Ekim 2026 — 2. madde: ücretsiz deneme artık 14 gün sürer; süre bitince bir plan seçilene kadar hesap salt okunur olur, veriler saklanır; denemede makaleler kullanıcının başlatmasıyla ve yayın hedefi bağlandıktan sonra üretilir. 21 Ekim 2026 — 8. madde (RanksUp Video ve marka öğeleri) eklendi; sonraki maddelerin numarası bir arttı. 7. madde, kaldırılan sosyal medya paylaşım özelliğini hâlâ varmış gibi anlatıyordu; yeniden yazıldı. 9. maddeye hesabınızı sildiğinizde bağlı hizmetlerin erişim bilgilerinin hemen silindiği eklendi. 8. maddeye site ve ürün tanıtım videoları eklendi: sayfa içeriği, ürün görselleri ve fiyat yalnız sizin sitenizden alınır.',
    sections: [
      {
        h: '1. Hizmet Tanımı',
        p: 'RanksUp, kullanıcı sitelerinin SEO + GEO + AEO performansını AI ile otomatikleştiren bir SaaS hizmetidir. Hizmet, Resend.com (email), Anthropic (Claude AI), Google AI (Gemini), PayTR (ödeme) ile entegre çalışır.',
      },
      {
        h: '2. Üyelik & Trial',
        p: 'Kayıt olan herkes 14 gün süren ücretsiz denemeden yararlanır; kart bilgisi gerekmez. Denemede yapay zekâ konu başlıklarını hazırlar; makale yalnızca kullanıcının başlatmasıyla ve sitesine bir yayın hedefi bağladıktan sonra üretilir, toplam 2 makaleyle sınırlıdır. Deneme süresi bittiğinde, bir plan seçilene kadar hesap salt okunur olur: mevcut veriler görüntülenebilir ve indirilebilir, hesap silinebilir; yapay zekâ ile yeni üretim, ölçüm ve analiz yapılmaz. Veriler bu sürede silinmez. Satın alma geçici olarak kapalıysa (örneğin ödeme altyapısı test aşamasındayken) hesap salt okunur yapılmaz, deneme haklarıyla kullanılmaya devam eder. Makale hakkı bittiğinde ya da deneme süresi dolduğunda devam etmek için ücretli bir plan seçilmesi gerekir. Güncel plan adları, kapsamları ve fiyatları için fiyatlandırma sayfasına bakınız; fiyatlar ABD doları üzerinden belirlenir ve Türk lirası karşılığı ödeme anındaki TCMB kuruyla hesaplanır.',
        strong: '14 gün süren ücretsiz denemeden',
      },
      {
        h: '3. Ücretler',
        p: 'Aylık veya yıllık ödeme. KDV dahil. Yıllık planda 12 ay yerine 10 ay ücreti alınır (yaklaşık %17 indirim). PayTR ile güvenli ödeme. İptal sonrası kalan ay sonuna kadar erişim devam eder.',
      },
      {
        h: '4. İptal & İade',
        p: 'Aylık planda istediğiniz zaman iptal. Yıllık planda ilk 30 gün full iade, sonrası kalan ay başına orantılı iade.',
      },
      {
        h: '5. Sorumluluk Reddi',
        p: 'AI tarafından üretilen içerik, kullanıcı tarafından gözden geçirilmelidir. RanksUp içerik doğruluğunu garanti etmez. SEO sonuçları (Google sıralaması, trafik artışı) garanti altında değildir.',
      },
      {
        h: '6. Yasak Kullanım',
        list: [
          'Spam içerik üretimi',
          'Telif haklarını ihlal eden içerik',
          'Yanıltıcı sağlık/finans tavsiyesi',
          'Yetkisiz kişilerin hesabını kullanma',
        ],
      },
      {
        // Sosyal paylasim 0db5a1c'de kaldirildi (api social/ modulu yok, SocialPost yazan kod yok,
        // yeni kanal baglama ucu yok). "Sosyal medya hesabina hic baglanmaz" DENMEZ: Meta Ads
        // baglantisi Facebook Login ile Sayfa izni istiyor (oauth/meta-permissions.ts).
        // Yayin modu: Site.publishApprovalMode varsayilani manual_approve (= Yari otomatik).
        h: '7. Sosyal Medya Paylaşımı ve Yayın Hedefleri',
        p: 'RanksUp’ın sosyal medya paylaşım özelliği (LinkedIn, X, Bluesky, TikTok, YouTube, Facebook, Instagram, Threads ve Pinterest hesaplarını bağlayıp gönderi yayımlama) kaldırıldı; RanksUp sizin adınıza sosyal medya hesaplarında paylaşım yapmaz ve panelden yeni bir sosyal medya hesabı bağlanamaz. Özellik kaldırılmadan önce bağlanan hesapların erişim bilgileri hiçbir işlemde kullanılmaz; bu kayıtların ne zaman silindiği Gizlilik Politikası’nın 5. bölümünde yazar. RanksUp’ın sizin adınıza içerik yayınladığı tek yer, panelden bağladığınız yayın hedefleridir (ör. WordPress, FTP/SFTP, GitHub, Ghost, Webflow). Yarı otomatik modda (varsayılan) her yazı yayınlanmadan önce onayınızı bekler; Tam otomatik modu seçerseniz takvimdeki yazılar editör ve kalite kontrollerinden geçtikten sonra varsayılan yayın hedefinize kendiliğinden yayınlanır. Yayınlanan içeriğin sorumluluğu ve yayın yaptığınız platformun kurallarına uyum size aittir. Reklam yönetimi için bağlanan Google Ads ve Meta (Facebook) reklam hesabı bağlantıları ayrı bir özelliktir; bu madde onları kapsamaz.',
      },
      {
        // Sahip karari 21.10.2026: musteri logo/marka kullanimina izin verir, yayindan kendisi sorumlu.
        // Iddialar kodla ayni: marka sitenin herkese acik sayfalarindan okunur (api videos/
        // article-video-brand.ts), metin makalenin kendi cumlelerinden + sayi koruyucusu
        // (apps/video copy.mjs validateScript), RanksUp hicbir platformda yayin yapmaz, dosya
        // tahmin edilmesi guc herkese acik adreste (nginx /videos/), silinince dosya gider.
        h: '8. RanksUp Video ve Marka Öğeleri',
        p: 'RanksUp Video, yayındaki makalenizden, sitenizin ana sayfasından ya da sitenizdeki bir ürün veya hizmet sayfasından kısa video üretmek için sitenizin herkese açık sayfalarından adınızı, logonuzu ve tema renginizi okur; bunları yalnızca sizin başlattığınız videoyu üretmek için kullanır. Site ve ürün tanıtım videolarında sayfa içeriği, ürün görselleri ve fiyat bilgisi de yalnızca sizin sitenizin kendi sayfalarından alınır; başka alan adlarındaki sayfalardan video üretilmez ve fiyat yalnızca sayfada açıkça yazıyor ve doğrulanabiliyorsa gösterilir. Video üretimini başlatarak sitenizin adı, logosu, renkleri, makale ve sayfa içeriği ile ürün görselleri üzerinde gerekli haklara sahip olduğunuzu ve RanksUp’ın bunları bu amaçla işlemesine izin verdiğinizi kabul edersiniz. Video metni makalenizin ya da sayfanızın kendi başlık, cümle ve sayılarından derlenir; yapay zekâ kullanıldığında da çıktı, makalede geçmeyen sayıları reddeden bir denetimden geçer (site ve ürün tanıtımında aynı denetim sitenizin kendi metnine uygulanır). Buna rağmen videoyu yayınlamadan önce kontrol etmek sizin sorumluluğunuzdadır. RanksUp videoları sizin adınıza hiçbir platformda yayınlamaz; videoyu nerede ve nasıl yayınlayacağınıza siz karar verirsiniz ve yayınlanan videonun içeriği ile ilgili platformların kurallarına uyum sizin sorumluluğunuzdadır. Videolarda küçük bir “ranksup.ai ile üretildi” ibaresi bulunur. Video dosyaları tahmin edilmesi güç bir bağlantıyla sunucularımızda saklanır; bağlantıyı bilen herkes videoyu açabilir. Videoyu panelden sildiğinizde dosya da silinir.',
      },
      {
        h: '9. Hesap Sonlandırma',
        // Dayanak: me/account-deletion.service.ts freezeAccountData (silme talebi aninda calisir)
        p: 'Yasak kullanım tespit edilirse hesap askıya alınabilir. Veriler 30 gün saklanır, sonra silinir. Hesabınızı sildiğinizde bağlı hizmetlerin erişim bilgileri (yayın hedefi girişleri, Google Search Console, Google Analytics, Google Ads ve Meta reklam bağlantıları, kendi AI sağlayıcı anahtarlarınız, App Store Connect ve Apple Search Ads anahtarları, kaldırılan sosyal medya özelliğinden kalan erişim bilgileri) 30 günü beklemeden hemen silinir.',
      },
      {
        h: '10. Yetkili Mahkeme',
        p: 'Türkiye Cumhuriyeti hukuku geçerlidir. İstanbul Mahkemeleri yetkilidir.',
      },
    ],
  },
  en: {
    backHome: '← Back to home',
    titleA: 'Terms of',
    titleB: 'Service',
    effective: 'Effective: April 27, 2026',
    updated: 'Last updated: October 22, 2026 — section 2: the free trial now lasts 14 days; when it ends the account becomes read-only until a plan is chosen and data is kept; on the trial articles are generated only when the user starts them, after connecting a publish target. October 21, 2026 — added section 8 (RanksUp Video and brand assets); the following sections were renumbered. Section 7 still described the removed social media posting feature as if it were available; it has been rewritten. Section 9 now states that the access credentials of connected services are deleted immediately when you delete your account. Section 8 now covers site and product intro videos: page content, product images and prices are taken only from your own site.',
    sections: [
      {
        h: '1. Service Definition',
        p: 'RanksUp is a SaaS that automates SEO + GEO + AEO performance of user websites with AI. The service integrates with Resend.com (email), Anthropic (Claude AI), Google AI (Gemini), and PayTR (payments).',
      },
      {
        h: '2. Membership & Trial',
        p: 'Every signup gets a free trial that lasts 14 days; no credit card required. On the trial the AI prepares topic titles; an article is generated only when the user starts it, after connecting a publish target to their site, and the trial is limited to 2 articles in total. When the trial period ends, the account becomes read-only until a plan is chosen: existing data can be viewed and downloaded and the account can be deleted; no new AI generation, measurement or analysis runs. Data is not deleted during this time. If purchasing is temporarily unavailable (for example while the payment system is in test mode), the account is not made read-only and can still be used within the trial allowances. Continuing after the article allowance is used or the trial period ends requires a paid plan. See the pricing page for current plan names, scope and prices; prices are set in US dollars and the Turkish lira amount is calculated at the central-bank rate at the time of payment.',
        strong: 'free trial that lasts 14 days',
      },
      {
        h: '3. Pricing',
        p: 'Monthly or yearly billing. VAT included. Yearly plans are billed for 10 months instead of 12 (about 17% off). Secure payment via PayTR. After cancellation, access continues until the end of the paid period.',
      },
      {
        h: '4. Cancellation & Refund',
        p: 'Monthly plans can be cancelled anytime. Yearly plans are fully refundable in the first 30 days; after that, pro-rata refund per remaining month.',
      },
      {
        h: '5. Disclaimer',
        p: 'AI-generated content must be reviewed by the user. RanksUp does not guarantee content accuracy. SEO outcomes (Google rankings, traffic growth) are not guaranteed.',
      },
      {
        h: '6. Prohibited Use',
        list: [
          'Spam content generation',
          'Content infringing copyright',
          'Misleading health/financial advice',
          "Using someone else's account without authorization",
        ],
      },
      {
        h: '7. Social Media Posting and Publish Targets',
        p: 'RanksUp’s social media posting feature (connecting LinkedIn, X, Bluesky, TikTok, YouTube, Facebook, Instagram, Threads and Pinterest accounts to publish posts) has been removed; RanksUp does not post to social media accounts on your behalf, and new social media accounts cannot be connected in the dashboard. The access credentials of accounts connected before the feature was removed are not used for anything; section 5 of the Privacy Policy explains when these records are deleted. The only places RanksUp publishes content on your behalf are the publish targets you connect in the dashboard (e.g. WordPress, FTP/SFTP, GitHub, Ghost, Webflow). In "Yarı otomatik" (semi-auto) mode, the default, every article waits for your approval before it is published; if you choose "Tam otomatik" (full auto) mode, scheduled articles are published to your default publish target on their own once they pass the editor and quality checks. You are responsible for published content and for complying with the rules of the platform you publish on. Google Ads and Meta (Facebook) ad account connections made for ad management are a separate feature and are not covered by this section.',
      },
      {
        h: '8. RanksUp Video and Brand Assets',
        p: 'To create a short video from your published article, your site’s home page or a product or service page on your site, RanksUp Video reads your name, logo and theme colour from the public pages of your site and uses them only to produce the video you started. For site and product promo videos the page content, product images and price information are likewise taken only from your own site’s pages; pages on other domains are not used, and a price is shown only when the page states it clearly and it can be verified. By starting a video you confirm that you hold the necessary rights to your site name, logo, colours, article and page content and product images and that you allow RanksUp to process them for this purpose. The video text is assembled from your article’s or page’s own headings, sentences and numbers; when AI is used, the output also passes a check that rejects numbers that do not appear in the article (for site and product promos the same check runs against your site’s own text). Even so, reviewing the video before you publish it is your responsibility. RanksUp does not publish videos on any platform on your behalf; you decide where and how to publish a video, and you are responsible for its content and for complying with each platform’s rules. Videos carry a small “ranksup.ai ile üretildi” (made with ranksup.ai) caption. Video files are stored on our servers under a hard-to-guess link; anyone who has the link can open the video. When you delete a video in the dashboard, the file is deleted too.',
      },
      {
        h: '9. Account Termination',
        p: 'Accounts may be suspended if prohibited use is detected. Data is retained for 30 days then deleted. When you delete your account, the access credentials of connected services (publish target logins, Google Search Console, Google Analytics, Google Ads and Meta ad connections, your own AI provider keys, App Store Connect and Apple Search Ads keys, and credentials left over from the removed social media feature) are deleted immediately, without waiting 30 days.',
      },
      {
        h: '10. Jurisdiction',
        p: 'Turkish Republic law applies. Istanbul Courts have jurisdiction.',
      },
    ],
  },
} as const;

export default function TermsPage() {
  const { locale } = useT();
  const data = CONTENT[locale];

  return (
    <main className="relative">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
      </div>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Link href="/" className="text-sm text-muted-foreground hover:text-brand-600 transition-colors">{data.backHome}</Link>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mt-8 mb-3">
          <span className="bg-gradient-to-r from-brand-500 via-brand-600 to-red-600 bg-clip-text text-transparent">
            {data.titleA}
          </span>{' '}
          {data.titleB}
        </h1>
        <p className="text-sm text-muted-foreground mb-1">{data.effective}</p>
        <p className="text-sm text-muted-foreground mb-8">{data.updated}</p>

        <div className="space-y-6 text-sm leading-relaxed">
          {data.sections.map((s) => {
            const list = 'list' in s ? s.list : undefined;
            const paragraph = 'p' in s ? s.p : undefined;
            const strong = 'strong' in s ? s.strong : undefined;
            return (
              <section key={s.h}>
                <h2 className="text-xl font-bold mb-2">{s.h}</h2>
                {list ? (
                  <ul className="text-muted-foreground space-y-1">
                    {list.map((li) => (
                      <li key={li}>• {li}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    {strong && paragraph
                      ? (() => {
                          const parts = paragraph.split(strong);
                          return parts.flatMap((part, i) =>
                            i < parts.length - 1
                              ? [part, <strong key={i}>{strong}</strong>]
                              : [part]
                          );
                        })()
                      : paragraph}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
