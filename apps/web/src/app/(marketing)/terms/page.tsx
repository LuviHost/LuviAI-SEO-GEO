'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';

const CONTENT = {
  tr: {
    backHome: '← Ana sayfa',
    titleA: 'Kullanım',
    titleB: 'Koşulları',
    effective: 'Yürürlük: 27 Nisan 2026',
    // Icerik degisti (8. madde eklendi); yururluk tarihi korunur, okuyan degisikligi gorsun diye
    // son guncelleme ve not ayrica yazilir (gizlilik sayfasindaki duzen)
    updated: 'Son güncelleme: 21 Ekim 2026 — 8. madde (RanksUp Video ve marka öğeleri) eklendi; sonraki maddelerin numarası bir arttı.',
    sections: [
      {
        h: '1. Hizmet Tanımı',
        p: 'RanksUp, kullanıcı sitelerinin SEO + GEO + AEO performansını AI ile otomatikleştiren bir SaaS hizmetidir. Hizmet, Resend.com (email), Anthropic (Claude AI), Google AI (Gemini), PayTR (ödeme) ile entegre çalışır.',
      },
      {
        h: '2. Üyelik & Trial',
        p: 'Kayıt olan herkes 2 makaleyi ücretsiz üretebilir. Süre sınırı yoktur, kart bilgisi gerekmez. Kota bittiğinde devam etmek için ücretli bir plan seçilmesi gerekir. Güncel plan adları, kapsamları ve fiyatları için fiyatlandırma sayfasına bakınız; fiyatlar ABD doları üzerinden belirlenir ve Türk lirası karşılığı ödeme anındaki TCMB kuruyla hesaplanır.',
        strong: '2 makaleyi ücretsiz',
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
        h: '7. Sosyal Medya Entegrasyonları',
        p: "RanksUp; LinkedIn, X (Twitter), Bluesky, TikTok, YouTube, Facebook, Instagram, Threads ve Pinterest gibi platformlara OAuth 2.0 ile bağlanır. Her bağlantı kullanıcının açık rızasıyla yapılır; kullanıcı her zaman dashboard'dan bağlantıyı koparıp yetkiyi geri alabilir. RanksUp yalnızca kullanıcının onayladığı içerikleri kullanıcı adına yayınlar; otomatik yayın seçeneği bile kullanıcının önceden tanımladığı kurallar çerçevesinde çalışır. Yayınlanan tüm içeriğin sorumluluğu kullanıcıya aittir; ilgili platformların topluluk kurallarına uyum kullanıcının yükümlülüğüdür. Bir platformla yapılan entegrasyon, o platformun geliştirici politikalarına ve kullanım koşullarına tabidir.",
      },
      {
        // Sahip karari 21.10.2026: musteri logo/marka kullanimina izin verir, yayindan kendisi sorumlu.
        // Iddialar kodla ayni: marka sitenin herkese acik sayfalarindan okunur (api videos/
        // article-video-brand.ts), metin makalenin kendi cumlelerinden + sayi koruyucusu
        // (apps/video copy.mjs validateScript), RanksUp hicbir platformda yayin yapmaz, dosya
        // tahmin edilmesi guc herkese acik adreste (nginx /videos/), silinince dosya gider.
        h: '8. RanksUp Video ve Marka Öğeleri',
        p: 'RanksUp Video, yayındaki makalenizden kısa dikey video üretmek için sitenizin herkese açık sayfalarından adınızı, logonuzu ve tema renginizi okur; bunları yalnızca sizin başlattığınız videoyu üretmek için kullanır. Video üretimini başlatarak sitenizin adı, logosu, renkleri ve makale içeriği üzerinde gerekli haklara sahip olduğunuzu ve RanksUp’ın bunları bu amaçla işlemesine izin verdiğinizi kabul edersiniz. Video metni makalenizin kendi başlık, cümle ve sayılarından derlenir; yapay zekâ kullanıldığında da çıktı, makalede geçmeyen sayıları reddeden bir denetimden geçer. Buna rağmen videoyu yayınlamadan önce kontrol etmek sizin sorumluluğunuzdadır. RanksUp videoları sizin adınıza hiçbir platformda yayınlamaz; videoyu nerede ve nasıl yayınlayacağınıza siz karar verirsiniz ve yayınlanan videonun içeriği ile ilgili platformların kurallarına uyum sizin sorumluluğunuzdadır. Videolarda küçük bir “ranksup.ai ile üretildi” ibaresi bulunur. Video dosyaları tahmin edilmesi güç bir bağlantıyla sunucularımızda saklanır; bağlantıyı bilen herkes videoyu açabilir. Videoyu panelden sildiğinizde dosya da silinir.',
      },
      {
        h: '9. Hesap Sonlandırma',
        p: "Yasak kullanım tespit edilirse hesap askıya alınabilir. Veriler 30 gün saklanır, sonra silinir. Sosyal medya OAuth token'ları hesap sonlandırılmasından sonra 30 gün içinde geri dönüşsüz silinir.",
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
    updated: 'Last updated: October 21, 2026 — added section 8 (RanksUp Video and brand assets); the following sections were renumbered.',
    sections: [
      {
        h: '1. Service Definition',
        p: 'RanksUp is a SaaS that automates SEO + GEO + AEO performance of user websites with AI. The service integrates with Resend.com (email), Anthropic (Claude AI), Google AI (Gemini), and PayTR (payments).',
      },
      {
        h: '2. Membership & Trial',
        p: 'Every signup can generate 2 free articles. No time limit, no credit card required. Once the quota is used, continuing requires a paid plan. See the pricing page for current plan names, scope and prices; prices are set in US dollars and the Turkish lira amount is calculated at the central-bank rate at the time of payment.',
        strong: '2 free articles',
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
        h: '7. Social Media Integrations',
        p: "RanksUp connects to LinkedIn, X (Twitter), Bluesky, TikTok, YouTube, Facebook, Instagram, Threads and Pinterest via OAuth 2.0. Every connection requires the user's explicit consent; users can disconnect and revoke access at any time from the dashboard. RanksUp only publishes content the user approves on their behalf; even auto-publish operates within rules the user pre-defined. The user is responsible for all published content and for compliance with each platform's community guidelines. Each integration is subject to that platform's developer policies and terms of service.",
      },
      {
        h: '8. RanksUp Video and Brand Assets',
        p: 'To create a short vertical video from your published article, RanksUp Video reads your name, logo and theme colour from the public pages of your site and uses them only to produce the video you started. By starting a video you confirm that you hold the necessary rights to your site name, logo, colours and article content and that you allow RanksUp to process them for this purpose. The video text is assembled from your article’s own headings, sentences and numbers; when AI is used, the output also passes a check that rejects numbers that do not appear in the article. Even so, reviewing the video before you publish it is your responsibility. RanksUp does not publish videos on any platform on your behalf; you decide where and how to publish a video, and you are responsible for its content and for complying with each platform’s rules. Videos carry a small “ranksup.ai ile üretildi” (made with ranksup.ai) caption. Video files are stored on our servers under a hard-to-guess link; anyone who has the link can open the video. When you delete a video in the dashboard, the file is deleted too.',
      },
      {
        h: '9. Account Termination',
        p: 'Accounts may be suspended if prohibited use is detected. Data is retained for 30 days then deleted. Social media OAuth tokens are permanently deleted within 30 days of account termination.',
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
