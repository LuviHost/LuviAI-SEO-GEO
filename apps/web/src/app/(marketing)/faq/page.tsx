'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { cn } from '@/lib/utils';

const FAQS = [
  {
    q: 'LuviAI nasıl çalışır?',
    a: 'Sitenizin URL\'ini bağlarsınız. AI önce sitenizi crawl edip "marka beyni" oluşturur (ton, persona, rakipler). Sonra GSC verisi + AI analiziyle Tier 1/2/3 konu listesi çıkarır. Her makale 6-ajan zincirinden geçer (anahtar kelime → outline → yazar → editör → görsel → yayıncı) ve seçtiğiniz hedefe (WordPress, FTP, GitHub, vb.) yayınlanır.',
  },
  {
    q: 'Hangi dilleri destekliyor?',
    a: 'Türkçe ve İngilizce. Onboarding\'de seçersiniz, isterseniz "her ikisi" deyip her makale için ayrı ayrı seçebilirsiniz. Faz 3\'te 10 dil planlanıyor.',
  },
  {
    q: 'Ücretsiz olarak ne kadar kullanabilirim?',
    a: 'Kayıt olunca 1 makale tamamen ücretsiz üretilir (süre sınırı yok). Markdown ZIP olarak indirebilirsin. İkinci makaleden itibaren bir plan seçmen gerekir; plan seçince WordPress/FTP/SFTP gibi tüm yayın hedefleri açılır.',
  },
  {
    q: 'AI içeriği Google\'da cezalandırılır mı?',
    a: 'Hayır. Google AI içerik politikası "kalite" odaklıdır, yöntem odaklı değil. LuviAI editör katmanı AI klişelerini siler, marka sesi tutarlılığını sağlar ve tüm makaleler 1800-2500 kelime, FAQ + Schema markup ile gerçek değer yaratacak şekilde yapılandırılır.',
  },
  {
    q: 'GEO (AI search) optimizasyonu nedir?',
    a: 'ChatGPT, Perplexity, Claude, Gemini gibi AI asistanlarının cevaplarında alıntılanma için içerik optimizasyonu. Auriti GEO Optimizer ile 47 metrik üzerinden tarama yapılır, llms.txt + structured data + Q&A formatları otomatik kurulur.',
  },
  {
    q: 'Kendi WordPress\'ime nasıl bağlarım?',
    a: 'WordPress yönetim panelinde Users → Profile → Application Passwords altından bir App Password oluşturursunuz. LuviAI onboarding 5. adımında WordPress REST seçer, site URL + kullanıcı adı + app password girersiniz. Sonra her üretilen makale otomatik yayına geçer.',
  },
  {
    q: 'Aboneliğimi istediğim zaman iptal edebilir miyim?',
    a: 'Evet. Dashboard → Abonelik → İptal Et. Aylık planda ay sonuna kadar erişiminiz devam eder. Yıllık planda ilk 30 gün full iade, sonrası kalan ay başına orantılı iade.',
  },
  {
    q: 'Verilerim güvende mi?',
    a: 'Tüm credentials (FTP/SFTP/WP/cPanel passwords, GSC OAuth tokens) AES-256-GCM ile şifrelenir. KVKK uyumlu. Hesabınızı silerseniz veriler 30 gün saklanır, sonra geri dönüşsüz silinir.',
  },
  {
    q: 'AI hangi modeli kullanıyor?',
    a: 'Default: Claude Sonnet 4.6 (yazar + editör). Kalite öncelikli müşteriler için Opus 4.7 opt-in. Görsel: Gemini 2.5 Flash Image. Tüm modeller maliyet/kalite dengesi için seçildi.',
  },
  {
    q: 'Aylık makale kotamı aşarsam ne olur?',
    a: 'Sistem makale üretmeyi durdurur ve plan yükseltme önerir. Ay sonunda kota otomatik sıfırlanır. Profesyonel → Kurumsal upgrade tek tık.',
  },
  {
    q: 'Affiliate programı nasıl çalışır?',
    a: 'Plan seçtikten sonra dashboard\'dan affiliate enroll yaparsınız. Size özel link verilir. Davet ettiğiniz kullanıcıların 3 ay boyunca yaptığı ödemelerin %30\'u komisyonunuz olur. Aylık otomatik PayTR transfer ile ödenir.',
  },
  {
    q: 'Kendi geliştirici takımım API kullanabilir mi?',
    a: 'Faz 3\'te (Q3 2026) public REST API + npm/pip SDK + Zapier/Make/n8n integration\'ları gelir. Şu an dashboard üzerinden manuel/otomatik kullanıyorsunuz.',
  },
  {
    q: 'Reklam (Google Ads + Meta) yönetimi nasıl çalışıyor?',
    a: 'Ryze AI MCP entegrasyonu ile Google Ads + Meta + GA4 bağlanır. AI hedef kitle önerir (interest + keyword + lookalike), reklam metni yazar (Google RSA + Meta primaryText), 3 format görsel hazırlar (square/portrait/landscape), bütçe ayarlar. Otopilot her 6 saatte ROAS analizi yapar — düşükse pause, yüksekse bütçe %20 artır, alakasız search term\'leri negative keyword olarak ekler.',
  },
  {
    q: 'AI Citation testi tam olarak ne ölçüyor?',
    a: 'Site brain\'inizdeki AEO/GEO sorgularını her gün 04:00 UTC\'de Claude · Gemini · ChatGPT · Perplexity\'e sorar. Cevapta site URL\'iniz alıntılanırsa 100, sadece marka adı geçerse 50, hiç geçmezse 0 puan. Trend grafiği 7/30/90/365 gün. %30+ düşüş tespit edilirse otomatik email gelir.',
  },
  {
    q: 'GEO Score nedir, nasıl hesaplanır?',
    a: '6 pillar üzerinden ağırlıklı ortalama: (1) Crawler Erişimi — robots.txt + llms.txt + llms-full.txt + sitemap, (2) Yapısal Veri — schema kapsama + Speakable + FAQPage, (3) AI Citation — 4 sağlayıcı son 7 gün ortalama, (4) Otorite — sameAs + competitive landscape + sosyal kanal + GSC, (5) Tazelik — son 7/30 gün yayın, (6) Multi-Modal — TTS audio + podcast + hero görseller. Sonuç: A+ → F harf notu.',
  },
  {
    q: 'Otopilot tam olarak ne yapıyor?',
    a: 'Site eklediğinizde varsayılan AÇIK gelir. Otopilot ON ise: (1) Site denetimi → otomatik düzeltme (sitemap/robots/llms cPanel\'e yazılır), (2) 8 makale takvime yerleşir, (3) İlk makale hemen üretilir, (4) Sonraki makaleler 15dk öncesinden üretime girer, yayın saatinde otomatik publish, (5) AI Citation günlük + içerik 30 gün sonra performansa göre revize, (6) Reklam autopilot 6 saatte ROAS optimize. Sen sadece raporu maille okursun.',
  },
  {
    q: 'Türkçe SEO uzmanı maaşına vermek yerine LuviAI almak gerçekten mantıklı mı?',
    a: 'Bir Türkçe SEO uzmanı 35-60k ₺/ay. Bir içerik yazarı 10-20k ₺/ay. Sosyal medya yöneticisi 15-25k ₺/ay. Reklam uzmanı 20-40k ₺/ay. Toplam ~100k ₺/ay. LuviAI Profesyonel paket 6.980 ₺/ay ve hepsini yapıyor. Üstelik AI search optimizasyonu (Türkçe pazarda yok) + 7/24 çalışıyor + tatil yapmıyor + ayrılmıyor.',
  },
  {
    q: 'Demo görmek istiyorum, nasıl?',
    a: 'Onboarding ekranında "Demo Aç" butonuna tıkla. 30 saniyede tam dolu örnek site açılır: 5 dummy makale (1 yayında, 1 üretiliyor, 3 takvimde) + audit raporu + AI Citation 14 günlük trend + GEO Score Card. Tek tıkla LuviAI\'ı keşfedebilirsin, kendi siteni bağlamadan.',
  },
];

// FAQPage + Speakable + BreadcrumbList JSON-LD — AI search ve Google rich result için
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'FAQPage',
      '@id': 'https://ai.luvihost.com/faq#faqpage',
      mainEntity: FAQS.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.a,
        },
      })),
      speakable: {
        '@type': 'SpeakableSpecification',
        cssSelector: ['.faq-question', '.faq-answer'],
      },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: 'https://ai.luvihost.com/' },
        { '@type': 'ListItem', position: 2, name: 'Sıkça Sorulan Sorular', item: 'https://ai.luvihost.com/faq' },
      ],
    },
  ],
};

export default function FaqPage() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="relative overflow-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="absolute inset-0 -z-10 bg-mesh-warm opacity-60 pointer-events-none" />
      <div className="absolute inset-0 -z-10 bg-noise opacity-[0.03] pointer-events-none" />

      <main className="container-apple section-padding max-w-[820px] stagger-reveal">
        <div className="text-center mb-16">
          <p className="eyebrow mb-4">SSS</p>
          <h1 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.5rem,6vw,5rem)] leading-[0.96]">
            Sık sorulan{' '}
            <span className="font-display italic text-[1.08em]">sorular.</span>
          </h1>
          <p className="text-pretty mt-7 max-w-[560px] mx-auto text-[15px] leading-[1.55] text-neutral-500 dark:text-neutral-400">
            Cevabını bulamadığın bir soru varsa{' '}
            <a href="mailto:destek@luvihost.com" className="text-foreground hover:text-brand-600 dark:hover:text-brand-400 transition-colors duration-300 ease-apple underline decoration-1 underline-offset-2">
              destek@luvihost.com
            </a>
          </p>
        </div>

        <div className="divide-y divide-border/60 border-y border-border/60">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="overflow-hidden">
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full py-6 flex items-center justify-between text-left group gap-6"
                >
                  <span className={cn('text-[16px] font-medium tracking-[-0.01em] transition-colors duration-300 ease-apple faq-question', isOpen ? 'text-foreground' : 'text-foreground group-hover:text-brand-600 dark:group-hover:text-brand-400')}>
                    {item.q}
                  </span>
                  <span className={cn('h-7 w-7 shrink-0 rounded-full border grid place-items-center transition-all duration-500 ease-apple', isOpen ? 'rotate-45 bg-foreground text-background border-foreground' : 'border-border/60 group-hover:border-foreground')}>
                    <ChevronDown className={cn('h-3 w-3 transition-transform duration-500 ease-apple', isOpen && '-rotate-45')} strokeWidth={2} />
                  </span>
                </button>
                <div className={cn('overflow-hidden transition-all duration-500 ease-apple', isOpen ? 'max-h-[600px] opacity-100 pb-6' : 'max-h-0 opacity-0')}>
                  <p className="text-[15px] leading-[1.6] text-neutral-600 dark:text-neutral-400 max-w-[680px] faq-answer">
                    {item.a}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-20 text-center">
          <p className="text-eyebrow mb-4 text-neutral-400">Hala ikna olmadın mı?</p>
          <h3 className="text-balance font-medium tracking-display text-[clamp(1.5rem,3vw,2.5rem)] leading-[1.1] mb-7">
            1 makale yaz,{' '}
            <span className="font-display italic text-[1.08em] text-brand-600 dark:text-brand-400">sonra karar ver.</span>
          </h3>
          <Link href="/onboarding" className="btn-apple-primary group">
            1 makale ücretsiz dene
          </Link>
        </div>
      </main>
    </div>
  );
}
