'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';

const CONTENT = {
  tr: {
    backHome: '← Ana sayfa',
    titleA: 'Kullanım',
    titleB: 'Koşulları',
    effective: 'Yürürlük: 27 Nisan 2026',
    sections: [
      {
        h: '1. Hizmet Tanımı',
        p: 'RanksUp, kullanıcı sitelerinin SEO + GEO + AEO performansını AI ile otomatikleştiren bir SaaS hizmetidir. Hizmet, Resend.com (email), Anthropic (Claude AI), Google AI (Gemini), PayTR (ödeme) ile entegre çalışır.',
      },
      {
        h: '2. Üyelik & Trial',
        p: 'Kayıt olan herkes 2 makaleyi ücretsiz üretebilir. Süre sınırı yoktur, kart bilgisi gerekmez. Quota bittiğinde devam etmek için bir plan (Başlangıç ₺1.499/ay, Profesyonel ₺4.999/ay, Ajans ₺14.999/ay, Kurumsal ₺34.999+/ay) seçilmesi gerekir.',
        strong: '2 makaleyi ücretsiz',
      },
      {
        h: '3. Ücretler',
        p: 'Aylık veya yıllık ödeme. KDV dahil. Yıllık planda %20 indirim. PayTR ile güvenli ödeme. İptal sonrası kalan ay sonuna kadar erişim devam eder.',
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
        h: '8. Hesap Sonlandırma',
        p: "Yasak kullanım tespit edilirse hesap askıya alınabilir. Veriler 30 gün saklanır, sonra silinir. Sosyal medya OAuth token'ları hesap sonlandırılmasından sonra 30 gün içinde geri dönüşsüz silinir.",
      },
      {
        h: '9. Yetkili Mahkeme',
        p: 'Türkiye Cumhuriyeti hukuku geçerlidir. İstanbul Mahkemeleri yetkilidir.',
      },
    ],
  },
  en: {
    backHome: '← Back to home',
    titleA: 'Terms of',
    titleB: 'Service',
    effective: 'Effective: April 27, 2026',
    sections: [
      {
        h: '1. Service Definition',
        p: 'RanksUp is a SaaS that automates SEO + GEO + AEO performance of user websites with AI. The service integrates with Resend.com (email), Anthropic (Claude AI), Google AI (Gemini), and PayTR (payments).',
      },
      {
        h: '2. Membership & Trial',
        p: 'Every signup can generate 2 free articles. No time limit, no credit card required. When the quota is used, continuing requires a plan (Starter ₺1,499/mo, Professional ₺4,999/mo, Agency ₺14,999/mo, Enterprise ₺34,999+/mo).',
        strong: '2 free articles',
      },
      {
        h: '3. Pricing',
        p: 'Monthly or yearly billing. VAT included. 20% discount on yearly plans. Secure payment via PayTR. After cancellation, access continues until the end of the paid period.',
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
        h: '8. Account Termination',
        p: 'Accounts may be suspended if prohibited use is detected. Data is retained for 30 days then deleted. Social media OAuth tokens are permanently deleted within 30 days of account termination.',
      },
      {
        h: '9. Jurisdiction',
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
        <div className="absolute top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
      </div>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Link href="/" className="text-sm text-muted-foreground hover:text-orange-600 transition-colors">{data.backHome}</Link>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mt-8 mb-3">
          <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
            {data.titleA}
          </span>{' '}
          {data.titleB}
        </h1>
        <p className="text-sm text-muted-foreground mb-8">{data.effective}</p>

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
