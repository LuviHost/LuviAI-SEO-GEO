import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { ShieldCheck, Sparkles, Heart, Globe2, Users, Zap, Target, Award } from 'lucide-react';

const SITE_URL = 'https://ranksup.ai';

const aboutJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'AboutPage',
      '@id': `${SITE_URL}/about#aboutpage`,
      url: `${SITE_URL}/about`,
      name: 'RanksUp Hakkında',
      description: 'Türkiye merkezli AI içerik + SEO + sosyal medya otomasyon platformu RanksUp hakkında bilgiler.',
      isPartOf: { '@id': `${SITE_URL}/#website` },
      about: { '@id': `${SITE_URL}/#organization` },
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization-extended`,
      name: 'RanksUp',
      legalName: 'LuviHost Bilişim Hizmetleri',
      url: SITE_URL,
      foundingDate: '2026',
      foundingLocation: { '@type': 'Place', name: 'Türkiye' },
      areaServed: { '@type': 'Country', name: 'Turkey' },
      knowsLanguage: ['Turkish', 'English'],
      contactPoint: [
        {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          email: 'destek@luvihost.com',
          availableLanguage: ['Turkish', 'English'],
        },
      ],
      slogan: 'AI ile büyü, tek panelden.',
      knowsAbout: [
        'Search Engine Optimization',
        'Generative Engine Optimization',
        'AI Search Optimization',
        'Content Marketing Automation',
        'Social Media Management',
        'WordPress Publishing',
        'Google Ads Optimization',
        'Meta Ads Optimization',
      ],
      brand: { '@type': 'Brand', name: 'RanksUp' },
      parentOrganization: {
        '@type': 'Organization',
        name: 'LuviHost',
        url: 'https://luvihost.com',
      },
    },
  ],
};

export default function AboutPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutJsonLd) }}
      />
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-noise opacity-[0.03] pointer-events-none" />

        <div className="container-apple section-padding max-w-[920px] stagger-reveal">
          <Breadcrumbs items={[{ label: 'Hakkımızda' }]} />

          {/* Hero — Apple grade */}
          <header className="text-center mt-8 mb-20">
            <p className="eyebrow mb-4">Hakkımızda</p>
            <h1 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.5rem,6vw,5rem)] leading-[0.96]">
              Türkiye için yapılmış{' '}
              <span className="font-brandDisplay font-bold text-brand dark:text-brand-400">AI SaaS.</span>
            </h1>
            <p className="text-pretty mt-7 max-w-[640px] mx-auto text-[clamp(1rem,1.4vw,1.25rem)] leading-[1.5] text-neutral-600 dark:text-neutral-400">
              RanksUp; KOBİ, e-ticaret ve dijital ajansların SEO, içerik üretimi, sosyal medya ve reklam denetimini
              tek panelden, otomatik olarak yönetebilmesi için kurulan Türkiye merkezli bir platformdur.
            </p>
          </header>

          {/* Misyon + Hikayemiz — alternating layout */}
          <div className="space-y-4 lg:space-y-6 mb-6">
            <div className="card-brand p-8 lg:p-10">
              <div className="flex items-start gap-5">
                <div className="h-10 w-10 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-600 dark:text-brand-400 grid place-items-center shrink-0">
                  <Target className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <p className="eyebrow mb-2">01 · Misyon</p>
                  <h2 className="text-h4 font-medium mb-4 tracking-[-0.025em]">Misyonumuz</h2>
                  <p className="text-[15px] text-neutral-600 dark:text-neutral-400 leading-[1.6]">
                    Saatlerce uğraşan SEO uzmanı, içerik yazarı, sosyal medya yöneticisi ve reklam danışmanına ihtiyaç
                    duymadan; küçük işletmelerin ve dijital ajansların yapay zeka destekli, kalite ve marka tutarlılığı
                    taviz vermeyen büyüme araçlarına erişebilmesini sağlamak.
                  </p>
                </div>
              </div>
            </div>

            <div className="card-brand p-8 lg:p-10">
              <div className="flex items-start gap-5">
                <div className="h-10 w-10 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 grid place-items-center shrink-0">
                  <Heart className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <p className="eyebrow mb-2">02 · Hikaye</p>
                  <h2 className="text-h4 font-medium mb-4 tracking-[-0.025em]">Hikayemiz</h2>
                  <p className="text-[15px] text-neutral-600 dark:text-neutral-400 leading-[1.6] mb-4">
                    RanksUp, 2018'den beri Türkiye'de hosting ve domain hizmeti veren <a href="https://luvihost.com" className="text-foreground hover:text-brand-600 dark:hover:text-brand-400 transition-colors duration-300 ease-apple underline decoration-1 underline-offset-2">LuviHost</a> grubunun bünyesinde 2026'da kuruldu. Müşterilerimizin "site açtım ama ne içerik üreteceğim?" sorusu bizi bu platformu inşa etmeye yönlendirdi.
                  </p>
                  <p className="text-[15px] text-neutral-600 dark:text-neutral-400 leading-[1.6]">
                    Yapay zekanın içerik üretiminde sıradan, klişe ve marka kimliği zayıf çıktılar verdiğini gördük.
                    6 ajanlı yazım zinciri, kalite kapısı ve marka beyni katmanı ile bu sorunları çözen ilk Türkçe platform haline geldik.
                  </p>
                </div>
              </div>
            </div>

            <div className="card-brand p-8 lg:p-10">
              <div className="flex items-start gap-5">
                <div className="h-10 w-10 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-500 grid place-items-center shrink-0">
                  <ShieldCheck className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <p className="eyebrow mb-2">03 · Güven</p>
                  <h2 className="text-h4 font-medium mb-5 tracking-[-0.025em]">Neden bize güvenebilirsin</h2>
                  <ul className="space-y-3 text-[14px] text-neutral-600 dark:text-neutral-400">
                    {[
                      ['Türkiye merkezli ve yerel', 'Veriler Türkiye lokasyonlu sunucularda, KVKK uyumlu, AES-256-GCM şifrelemeyle korunur.'],
                      ['PayTR güvenli ödeme', "Türkiye'nin TCMB lisanslı ödeme sağlayıcısı. Aylık iptal hakkı, taahhüt yok."],
                      ['Açık kaynaklı pattern\'ler', 'Anthropic Claude, Google Gemini, OpenAI ve LibreChat gibi açık ekosistemlerden ilham aldık.'],
                      ['Kalite kapısı', 'Her makale yayına çıkmadan AI editör ajanından geçer. Klişe, yanlış bilgi, marka tutarsızlığı silinir.'],
                      ['İlk makale ücretsiz', 'Beğenmezsen tek kuruş ödemen gerekmez. Önce dene, sonra karar ver.'],
                    ].map(([label, desc]) => (
                      <li key={label} className="flex gap-3">
                        <Sparkles className="h-3.5 w-3.5 text-brand-500 shrink-0 mt-1" strokeWidth={1.5} />
                        <span><strong className="text-foreground font-medium">{label}:</strong> {desc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Değerler — Apple-grade 2x2 grid */}
          <div className="grid sm:grid-cols-2 gap-4 lg:gap-6 mb-20 mt-6">
            {[
              { icon: Globe2, color: 'text-brand-500', title: 'Türkçe öncelikli', body: 'Çoğu AI içerik aracı İngilizce için yapılır, sonra Türkçe\'ye uydurulur. Biz Türkçe ile başlayıp İngilizce\'yi ekliyoruz — gramer, ton ve sektör jargonu tutarlı.' },
              { icon: Users, color: 'text-emerald-500', title: 'KOBİ-dostu', body: 'Saatler süren manuel SEO denetimi, içerik briefi yazma, sosyal medya planlama gibi işleri dakikalara indirir. Ekibinde uzman olmasa bile profesyonel sonuçlar alırsın.' },
              { icon: Zap, color: 'text-amber-500', title: 'Gerçek otopilot', body: 'Plan + GSC + rakip + persona analizi → konu önerileri → otomatik üretim → otomatik yayın → 30 gün sonra performans takibi. Sen sadece onaylarsın.' },
              { icon: Award, color: 'text-violet-500', title: 'AI search\'e hazır', body: 'ChatGPT, Claude, Gemini, Perplexity gibi AI asistanları cevap üretirken senin sitendeki içeriği kaynak göstersin diye GEO (Generative Engine Optimization) yapıyoruz.' },
            ].map(({ icon: Icon, color, title, body }) => (
              <div key={title} className="card-brand p-7 lg:p-8">
                <Icon className={`h-6 w-6 ${color} mb-5`} strokeWidth={1.5} />
                <h3 className="text-h5 font-medium mb-3 tracking-[-0.02em]">{title}</h3>
                <p className="text-[14px] text-neutral-600 dark:text-neutral-400 leading-[1.55]">{body}</p>
              </div>
            ))}
          </div>

          {/* Final CTA */}
          <div className="text-center">
            <h3 className="text-balance font-medium tracking-display text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.05] mb-7">
              İlk makaleni{' '}
              <span className="font-brandDisplay font-bold text-brand dark:text-brand-400">ücretsiz dene.</span>
            </h3>
            <Link href="/onboarding" className="btn-brand group inline-flex">
              Hemen başla
            </Link>
            <p className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-5">
              Kart bilgisi gerekmez · Aylık iptal · PayTR güvenli ödeme
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
