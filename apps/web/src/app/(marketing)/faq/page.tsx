'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

const FAQS_TR = [
  {
    q: 'RanksUp nasıl çalışır?',
    a: 'Sitenizin URL\'ini bağlarsınız. AI önce sitenizi crawl edip "marka beyni" oluşturur (ton, persona, rakipler). Sonra GSC verisi + AI analiziyle Tier 1/2/3 konu listesi çıkarır. Her makale 6-ajan zincirinden geçer (anahtar kelime → outline → yazar → editör → görsel → yayıncı) ve seçtiğiniz hedefe (WordPress, FTP, GitHub, vb.) yayınlanır.',
  },
  {
    q: 'Hangi dilleri destekliyor?',
    a: 'Türkçe ve İngilizce. Onboarding\'de seçersiniz, isterseniz "her ikisi" deyip her makale için ayrı ayrı seçebilirsiniz. Faz 3\'te 10 dil planlanıyor.',
  },
  {
    q: 'Ücretsiz olarak ne kadar kullanabilirim?',
    a: 'Kayıt olunca 2 makale tamamen ücretsiz üretilir (süre sınırı yok, kart bilgisi gerekmez). Markdown ZIP olarak indirebilir veya temel yayın hedeflerine gönderebilirsin. Quota bitince bir plan seçmen gerekir; plan seçince WordPress/FTP/SFTP gibi tüm yayın hedefleri + AI Video Studio açılır.',
  },
  {
    q: 'AI içeriği Google\'da cezalandırılır mı?',
    a: 'Hayır. Google AI içerik politikası "kalite" odaklıdır, yöntem odaklı değil. RanksUp editör katmanı AI klişelerini siler, marka sesi tutarlılığını sağlar ve tüm makaleler 1800-2500 kelime, FAQ + Schema markup ile gerçek değer yaratacak şekilde yapılandırılır.',
  },
  {
    q: 'GEO (AI search) optimizasyonu nedir?',
    a: 'ChatGPT, Perplexity, Claude gibi AI asistanlarının cevaplarında alıntılanma için içerik optimizasyonu. İki ayrı pist çalışır: (1) Google AI Overviews için klasik teknik SEO + benzersiz bakış açısı + E-E-A-T (Google\'ın resmi rehberi bunu söylüyor — özel "AI dosyası" gerekmiyor). (2) Perplexity / ChatGPT browse / Claude.ai gibi non-Google AI motorları için llms.txt + llms-full.txt + structured data + Q&A formatları kurulur. Auriti GEO Optimizer 47 metrik üzerinden tarama yapar, eksikleri tek tıkla düzeltir.',
  },
  {
    q: 'Kendi WordPress\'ime nasıl bağlarım?',
    a: 'WordPress yönetim panelinde Users → Profile → Application Passwords altından bir App Password oluşturursunuz. RanksUp onboarding 5. adımında WordPress REST seçer, site URL + kullanıcı adı + app password girersiniz. Sonra her üretilen makale otomatik yayına geçer.',
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
    q: 'AB Yapay Zekâ Yasası (AI Act) RanksUp içeriğini etkiler mi?',
    a: 'AI Act Madde 50, üretken AI çıktılarının makine-okunur biçimde işaretlenmesini şart koşuyor; yükümlülük öncelikle model sağlayıcılarında (Anthropic, Google, OpenAI). AB\'ye içerik yayınlayan müşteriler için RanksUp: makalelerde AI katkısını gizlemez, yazar/editör bilgisini şemada tutar (Person + author) ve sağlayıcıların işaretleme uygulamalarını istihbarat defterinde izler. Türkiye\'ye yayın için ek yükümlülük yok; bir zorunluluk doğduğunda ürün güncellenir, sizin bir şey yapmanız gerekmez.',
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
    a: 'Site brain\'inizdeki AEO/GEO sorgularını 7 AI asistanına sorar: ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek · Meta. Ölçümü siz tetiklersiniz ("Yeniden Test"); her test kalıcı kaydedilir, iki testi yan yana karşılaştırabilirsiniz. Marka adınızın geçtiği sorular skora girmez (o tanınırlık, görünürlük değil). Cevapta site URL\'iniz alıntılanırsa 100, sadece marka adı geçerse 50, hiç geçmezse 0 puan; manşet 7 günlük ortalama. %30+ düşüş tespit edilirse otomatik email gelir.',
  },
  {
    q: 'GEO Score nedir, nasıl hesaplanır?',
    a: '6 pillar üzerinden ağırlıklı ortalama: (1) Crawler Erişimi — robots.txt + llms.txt + llms-full.txt + sitemap (Perplexity, ChatGPT browse, Claude.ai gibi non-Google AI motorları için faydalı; Google AI Overviews\'da resmi olarak gerekli değil ama klasik teknik SEO altyapısı olarak puanlanır), (2) Yapısal Veri — schema kapsama + Speakable + FAQPage (rich result + non-Google AI için), (3) AI Citation — 7 sağlayıcı son 7 gün ortalama (gerçek AI cevaplarında alıntılanma — en kritik pillar), (4) Otorite — sameAs + competitive landscape + sosyal kanal + GSC (Google\'ın E-E-A-T sinyali), (5) Tazelik — son 7/30 gün yayın, (6) Multi-Modal — TTS audio + podcast + hero görseller. Sonuç: A+ → F harf notu.',
  },
  {
    q: 'Otopilot tam olarak ne yapıyor?',
    a: 'Site eklediğinizde varsayılan AÇIK gelir. Otopilot ON ise: (1) Site denetimi → otomatik düzeltme (sitemap/robots/llms cPanel\'e yazılır), (2) 8 makale takvime yerleşir, (3) İlk makale hemen üretilir, (4) Sonraki makaleler 15dk öncesinden üretime girer, yayın saatinde otomatik publish, (5) AI Citation günlük + içerik 30 gün sonra performansa göre revize, (6) Reklam autopilot 6 saatte ROAS optimize. Sen sadece raporu maille okursun.',
  },
  {
    q: 'Türkçe SEO uzmanı maaşına vermek yerine RanksUp almak gerçekten mantıklı mı?',
    a: 'Bir Türkçe SEO uzmanı 35-60k ₺/ay. Bir içerik yazarı 10-20k ₺/ay. ASO uzmanı 15-25k ₺/ay. Reklam uzmanı 20-40k ₺/ay. Toplam ~100k ₺/ay. RanksUp Profesyonel paket 6.980 ₺/ay ve hepsini yapıyor. Üstelik AI search optimizasyonu (Türkçe pazarda yok) + 7/24 çalışıyor + tatil yapmıyor + ayrılmıyor.',
  },
  {
    q: 'Google llms.txt\'i kullanıyor mu? Bu dosya gerçekten gerekli mi?',
    a: 'Google resmi rehberinde "AI Overviews ve generatif arama için yeni bir machine-readable dosya, AI text dosyası, markup veya Markdown oluşturmanıza gerek yok" diyor — yani Google için llms.txt zorunlu değil. Ancak Perplexity, ChatGPT browse modu, Claude.ai web erişimi gibi non-Google AI motorları llms.txt + llms-full.txt\'i okuyarak içeriği daha hızlı parse ediyor. RanksUp bu dosyaları "multi-engine GEO optimizasyonu" için üretiyor — Google\'a yarar yok zararı yok, diğer AI motorlarına net yarar. Google\'da AI Overviews için asıl odak: benzersiz bakış açısı, first-hand deneyim, E-E-A-T sinyalleri ve klasik teknik SEO (indekslenebilirlik + snippet uygunluğu). RanksUp\'nın Brain Generator + içerik pipeline\'ı bu sinyalleri zaten optimize ediyor.',
  },
  {
    q: 'Demo görmek istiyorum, nasıl?',
    a: 'Onboarding ekranında "Demo Aç" butonuna tıkla. 30 saniyede tam dolu örnek site açılır: 5 dummy makale (1 yayında, 1 üretiliyor, 3 takvimde) + audit raporu + AI Citation 14 günlük trend + GEO Score Card. Tek tıkla RanksUp\'ı keşfedebilirsin, kendi siteni bağlamadan.',
  },
];

const FAQS_EN = [
  {
    q: 'How does RanksUp work?',
    a: 'You connect your site URL. The AI first crawls your site and builds a "brand brain" (tone, persona, competitors). It then uses GSC data + AI analysis to produce a Tier 1/2/3 topic list. Every article flows through a 6-agent chain (keyword → outline → writer → editor → image → publisher) and is published to your chosen target (WordPress, FTP, GitHub, etc.).',
  },
  {
    q: 'Which languages are supported?',
    a: 'Turkish and English. You pick during onboarding, or choose "both" and select per-article. 10 languages planned for Phase 3.',
  },
  {
    q: 'How much can I use for free?',
    a: 'On signup, 2 articles are generated completely free (no time limit, no credit card). You can download them as a Markdown ZIP or send to basic publish targets. When the quota is used, pick a plan; doing so unlocks all publish targets like WordPress/FTP/SFTP + AI Video Studio.',
  },
  {
    q: 'Will Google penalize AI content?',
    a: 'No. Google\'s AI content policy is quality-focused, not method-focused. RanksUp\'s editor layer removes AI clichés, enforces brand voice consistency, and every article is 1800-2500 words structured with FAQ + Schema markup to deliver real value.',
  },
  {
    q: 'What is GEO (AI search) optimization?',
    a: 'Content optimization to be cited in answers from AI assistants like ChatGPT, Perplexity, Claude. Two tracks run in parallel: (1) For Google AI Overviews — classic technical SEO + unique perspective + E-E-A-T (Google\'s official guide says this — no special "AI file" required). (2) For non-Google AI engines like Perplexity / ChatGPT browse / Claude.ai — llms.txt + llms-full.txt + structured data + Q&A formats are set up. The Auriti GEO Optimizer scans across 47 metrics and one-click fixes the gaps.',
  },
  {
    q: 'How do I connect my own WordPress?',
    a: 'In the WordPress admin under Users → Profile → Application Passwords, create an App Password. In RanksUp onboarding step 5, pick WordPress REST, enter site URL + username + app password. After that every generated article is auto-published.',
  },
  {
    q: 'Can I cancel my subscription anytime?',
    a: 'Yes. Dashboard → Subscription → Cancel. On monthly plans your access continues until end of period. On yearly plans full refund within first 30 days, then pro-rata refund per remaining month.',
  },
  {
    q: 'Is my data safe?',
    a: 'All credentials (FTP/SFTP/WP/cPanel passwords, GSC OAuth tokens) are AES-256-GCM encrypted. GDPR/KVKK compliant. If you delete your account, data is retained 30 days then permanently deleted.',
  },
  {
    q: 'Does the EU AI Act affect content made with RanksUp?',
    a: 'Article 50 of the AI Act requires generative-AI output to be marked in a machine-readable way; the obligation sits primarily with model providers (Anthropic, Google, OpenAI). For customers publishing into the EU, RanksUp does not hide AI involvement, keeps author/editor information in schema (Person + author) and tracks providers\' marking practices in its intelligence ledger. No extra obligation for Turkish publishing; if one arises the product is updated — nothing for you to do.',
  },
  {
    q: 'Which AI model do you use?',
    a: 'Default: Claude Sonnet 4.6 (writer + editor). Quality-first customers can opt in to Opus 4.7. Images: Gemini 2.5 Flash Image. All models chosen for cost/quality balance.',
  },
  {
    q: 'What happens if I exceed my monthly article quota?',
    a: 'The system stops generation and suggests a plan upgrade. The quota auto-resets at month end. Professional → Enterprise upgrade is one click.',
  },
  {
    q: 'How does the affiliate program work?',
    a: 'After selecting a plan, enroll in affiliate from the dashboard. You get a unique link. You earn 30% of all payments your invitees make for 3 months. Paid monthly via automatic PayTR transfer.',
  },
  {
    q: 'Can my developer team use the API?',
    a: 'In Phase 3 (Q3 2026), a public REST API + npm/pip SDK + Zapier/Make/n8n integrations will ship. For now you operate manually/automated through the dashboard.',
  },
  {
    q: 'How does ad management (Google Ads + Meta) work?',
    a: 'Via the Ryze AI MCP integration, Google Ads + Meta + GA4 connect. AI suggests audiences (interest + keyword + lookalike), writes ad copy (Google RSA + Meta primaryText), prepares 3 image formats (square/portrait/landscape), and sets budget. Autopilot analyzes ROAS every 6h — pause if low, boost budget 20% if high, add irrelevant search terms as negative keywords.',
  },
  {
    q: 'What exactly does the AI Citation test measure?',
    a: 'It asks your site brain\'s AEO/GEO queries to 7 AI assistants: ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek · Meta. You trigger the measurement ("Re-test"); every run is stored permanently and any two runs can be compared side by side. Questions that already contain your brand are excluded from the score (that is recognition, not visibility). URL cited = 100, brand name only = 50, absent = 0; the headline is a 7-day rolling average. A 30%+ drop triggers an automatic email alert.',
  },
  {
    q: 'What is GEO Score, how is it calculated?',
    a: 'Weighted average across 6 pillars: (1) Crawler Access — robots.txt + llms.txt + llms-full.txt + sitemap (helpful for non-Google AI engines like Perplexity, ChatGPT browse, Claude.ai; not officially required by Google AI Overviews but scored as classic technical SEO foundation), (2) Structured Data — schema coverage + Speakable + FAQPage (for rich results + non-Google AI), (3) AI Citation — 7-provider 7-day average (citation in real AI answers — the most critical pillar), (4) Authority — sameAs + competitive landscape + social channels + GSC (Google\'s E-E-A-T signal), (5) Freshness — last 7/30-day publishing, (6) Multi-Modal — TTS audio + podcast + hero images. Result: A+ → F letter grade.',
  },
  {
    q: 'What exactly does Autopilot do?',
    a: 'It\'s ON by default when you add a site. When ON: (1) Site audit → auto-fix (sitemap/robots/llms written to cPanel), (2) 8 articles scheduled, (3) First article generated immediately, (4) Subsequent articles enter generation 15min ahead, auto-publish at scheduled time, (5) AI Citation daily + content auto-revised after 30 days based on performance, (6) Ads autopilot optimizes ROAS every 6h. You just read the report via email.',
  },
  {
    q: 'Is RanksUp really cheaper than hiring a Turkish SEO specialist?',
    a: 'A Turkish SEO specialist costs ₺35-60k/mo. A content writer ₺10-20k/mo. An ASO specialist ₺1ger ₺15-25k/mo. An ads specialist ₺20-40k/mo. Total ~₺100k/mo. RanksUp Professional is ₺6,980/mo and does it all. Plus AI search optimization (rare in the Turkish market) + 24/7 + no vacation + no resignation.',
  },
  {
    q: 'Does Google use llms.txt? Is this file actually needed?',
    a: 'Google\'s official guide states: "You don\'t need to create a new machine-readable file, AI text file, markup or Markdown for AI Overviews and generative search" — so llms.txt is not required for Google. However Perplexity, ChatGPT browse mode, Claude.ai web access read llms.txt + llms-full.txt to parse content faster. RanksUp produces these files for "multi-engine GEO optimization" — neutral for Google, clear benefit for other AI engines. For Google AI Overviews the real focus is: unique perspective, first-hand experience, E-E-A-T signals and classic technical SEO (indexability + snippet eligibility). RanksUp\'s Brain Generator + content pipeline already optimizes these signals.',
  },
  {
    q: 'I want a demo, how?',
    a: 'In the onboarding screen, click "Open Demo". In 30 seconds a fully-loaded example site opens: 5 dummy articles (1 live, 1 generating, 3 scheduled) + audit report + AI Citation 14-day trend + GEO Score Card. One click to explore RanksUp without connecting your own site.',
  },
];

const COPY = {
  tr: {
    eyebrow: '❓ SSS',
    titleA: 'Sıkça',
    titleB: 'sorulan',
    titleC: 'sorular',
    helpA: 'Cevabını bulamadığın bir soru varsa ',
    helpEmail: 'destek@luvihost.com',
    ctaTitle: 'Sorunu çözemedik mi?',
    ctaSub: 'Hemen dene, sonra karar ver. İlk 2 makale ücretsiz.',
    ctaBtn: '2 Makale Ücretsiz Dene →',
    breadcrumbHome: 'Ana Sayfa',
    breadcrumbFaq: 'Sıkça Sorulan Sorular',
  },
  en: {
    eyebrow: '❓ FAQ',
    titleA: 'Frequently',
    titleB: 'asked',
    titleC: 'questions',
    helpA: 'Can\'t find your answer? ',
    helpEmail: 'destek@luvihost.com',
    ctaTitle: 'Still have questions?',
    ctaSub: 'Try it now, decide later. First 2 articles free.',
    ctaBtn: 'Try 2 Articles Free →',
    breadcrumbHome: 'Home',
    breadcrumbFaq: 'Frequently Asked Questions',
  },
} as const;

function buildJsonLd(items: { q: string; a: string }[], breadcrumbHome: string, breadcrumbFaq: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        '@id': 'https://ranksup.ai/faq#faqpage',
        mainEntity: items.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['.faq-question', '.faq-answer'],
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: breadcrumbHome, item: 'https://ranksup.ai/' },
          { '@type': 'ListItem', position: 2, name: breadcrumbFaq, item: 'https://ranksup.ai/faq' },
        ],
      },
    ],
  };
}

export default function FaqPage() {
  const { locale } = useT();
  const [open, setOpen] = useState<number | null>(0);
  const FAQS = locale === 'en' ? FAQS_EN : FAQS_TR;
  const c = COPY[locale];
  const faqJsonLd = buildJsonLd(FAQS, c.breadcrumbHome, c.breadcrumbFaq);

  return (
    <div className="relative">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      {/* gradient blob */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute top-40 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-600 text-xs font-semibold mb-5">
            {c.eyebrow}
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-4">
            {c.titleA}{' '}
            <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
              {c.titleB}
            </span>{' '}
            {c.titleC}
          </h1>
          <p className="text-lg text-muted-foreground">
            {c.helpA}
            <a href={`mailto:${c.helpEmail}`} className="text-orange-600 hover:underline">
              {c.helpEmail}
            </a>
          </p>
        </div>

        <div className="space-y-3">
          {FAQS.map((item, i) => (
            <div
              key={i}
              className={`rounded-2xl border bg-background transition-all ${
                open === i ? 'border-orange-500/30 shadow-md' : 'hover:border-orange-500/20'
              }`}
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full text-left p-5 flex items-center justify-between gap-4"
              >
                <span className="font-semibold faq-question">{item.q}</span>
                <ChevronDown className={cn('h-5 w-5 transition-transform shrink-0 text-muted-foreground', open === i && 'rotate-180 text-orange-600')} />
              </button>
              {open === i && (
                <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed faq-answer">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="rounded-2xl bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 text-white p-10 text-center mt-12">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-3">{c.ctaTitle}</h2>
          <p className="text-white/90 mb-6">{c.ctaSub}</p>
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-2 bg-white text-orange-600 hover:bg-white/90 px-8 py-3 rounded-lg font-bold shadow-xl"
          >
            {c.ctaBtn}
          </Link>
        </div>
      </main>
    </div>
  );
}
