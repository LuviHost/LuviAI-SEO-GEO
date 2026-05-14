import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Sparkles, Heart, Globe2, Users, Zap, Target, Award, ArrowRight, CheckCircle2 } from 'lucide-react';

const SITE_URL = 'https://ai.luvihost.com';

const aboutJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'AboutPage',
      '@id': `${SITE_URL}/about#aboutpage`,
      url: `${SITE_URL}/about`,
      name: 'LuviAI Hakkında',
      description: 'Türkiye merkezli AI içerik + SEO + sosyal medya otomasyon platformu LuviAI hakkında bilgiler.',
      isPartOf: { '@id': `${SITE_URL}/#website` },
      about: { '@id': `${SITE_URL}/#organization` },
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization-extended`,
      name: 'LuviAI',
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
      brand: { '@type': 'Brand', name: 'LuviAI' },
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
      <div className="relative">
        {/* gradient blobs */}
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
          <div className="absolute top-60 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Breadcrumbs items={[{ label: 'Hakkımızda' }]} />

          {/* Hero */}
          <header className="text-center mt-6 mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-600 text-xs font-semibold mb-5">
              <Sparkles className="h-3 w-3" /> Hakkımızda
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-5">
              Türkiye için yapılmış{' '}
              <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
                AI SaaS
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              LuviAI; KOBİ, e-ticaret ve dijital ajansların SEO, içerik üretimi, sosyal medya ve reklam denetimini
              tek panelden, otomatik olarak yönetebilmesi için kurulan Türkiye merkezli bir platformdur.
            </p>
          </header>

          {/* Misyon */}
          <div className="mb-6 p-8 rounded-2xl border bg-background hover:border-orange-500/30 transition-colors">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-orange-500/10 text-orange-600 grid place-items-center shrink-0">
                <Target className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold mb-3">Misyonumuz</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Saatlerce uğraşan SEO uzmanı, içerik yazarı, sosyal medya yöneticisi ve reklam danışmanına ihtiyaç
                  duymadan; küçük işletmelerin ve dijital ajansların yapay zeka destekli, kalite ve marka tutarlılığı
                  taviz vermeyen büyüme araçlarına erişebilmesini sağlamak. Site sahipleri içerik üretmek için saatler
                  harcamak yerine asıl işlerine odaklansın diye tasarladık.
                </p>
              </div>
            </div>
          </div>

          {/* Hikayemiz */}
          <div className="mb-6 p-8 rounded-2xl border bg-background hover:border-orange-500/30 transition-colors">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0">
                <Heart className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold mb-3">Hikayemiz</h2>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  LuviAI, 2018'den beri Türkiye'de hosting ve domain hizmeti veren <a href="https://luvihost.com" className="text-orange-600 hover:underline">LuviHost</a> grubunun
                  bünyesinde 2026'da kuruldu. Müşterilerimizin "site açtım ama ne içerik üreteceğim?" sorusuna verilecek cevap arayışı bizi
                  bu platformu inşa etmeye yönlendirdi.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Yapay zekanın içerik üretiminde sıradan, klişe ve marka kimliği zayıf çıktılar verdiğini gördük.
                  6 ajanlı yazım zinciri (anahtar kelime → taslak → yazar → editör → görsel → şema), kalite kapısı ve
                  marka beyni katmanı ile bu sorunları çözen ilk Türkçe platform haline geldik.
                </p>
              </div>
            </div>
          </div>

          {/* Neden güvenmeli */}
          <div className="mb-6 p-8 rounded-2xl border bg-background hover:border-orange-500/30 transition-colors">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 grid place-items-center shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold mb-4">Neden bize güvenebilirsin</h2>
                <ul className="space-y-3 text-sm">
                  {[
                    ['Türkiye merkezli ve yerel:', 'Veriler Türkiye lokasyonlu sunucularda, KVKK uyumlu, AES-256-GCM şifrelemeyle korunur.'],
                    ['PayTR güvenli ödeme:', "Türkiye'nin TCMB lisanslı ödeme sağlayıcısı. Aylık iptal hakkı, taahhüt yok."],
                    ['Açık kaynaklı pattern\'ler:', 'Anthropic Claude, Google Gemini, OpenAI ve LibreChat gibi açık ekosistemlerden ilham aldık.'],
                    ['Kalite kapısı:', 'Her makale yayına çıkmadan AI editör ajanından geçer. Klişe, yanlış bilgi, marka tutarsızlığı silinir.'],
                    ['İlk makale ücretsiz:', 'Beğenmezsen tek kuruş ödemen gerekmez. Önce dene, sonra karar ver.'],
                  ].map(([title, body], i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 text-emerald-600" />
                      <span><strong>{title}</strong> {body}</span>
                    </li>
                  ))}
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 text-emerald-600" />
                    <span><strong>Açık iletişim:</strong> Destek için <a href="mailto:destek@luvihost.com" className="text-orange-600 hover:underline">destek@luvihost.com</a> — gerçek insan yanıtlar.</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Değerler */}
          <div className="grid sm:grid-cols-2 gap-4 mb-12 mt-12">
            <div className="p-6 rounded-2xl border bg-background hover:border-orange-500/30 hover:shadow-lg hover:shadow-orange-500/5 transition-all group">
              <div className="w-12 h-12 rounded-xl bg-orange-500/10 text-orange-600 grid place-items-center mb-4 group-hover:scale-110 transition-transform">
                <Globe2 className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-lg mb-2">Türkçe öncelikli</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Çoğu AI içerik aracı İngilizce için yapılır, sonra Türkçe'ye uydurulur. Biz Türkçe ile başlayıp İngilizce'yi ekliyoruz —
                gramer, ton ve sektör jargonu tutarlı.
              </p>
            </div>
            <div className="p-6 rounded-2xl border bg-background hover:border-orange-500/30 hover:shadow-lg hover:shadow-orange-500/5 transition-all group">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid place-items-center mb-4 group-hover:scale-110 transition-transform">
                <Users className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-lg mb-2">KOBİ-dostu</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Saatler süren manuel SEO denetimi, içerik briefi yazma, sosyal medya planlama gibi işleri dakikalara indirir.
                Ekibinde uzman olmasa bile profesyonel sonuçlar alırsın.
              </p>
            </div>
            <div className="p-6 rounded-2xl border bg-background hover:border-orange-500/30 hover:shadow-lg hover:shadow-orange-500/5 transition-all group">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-600 grid place-items-center mb-4 group-hover:scale-110 transition-transform">
                <Zap className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-lg mb-2">Gerçek otopilot</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Plan + GSC + rakip + persona analizi → konu önerileri → otomatik üretim → otomatik yayın → 30 gün sonra performans takibi.
                Sen sadece onaylarsın.
              </p>
            </div>
            <div className="p-6 rounded-2xl border bg-background hover:border-orange-500/30 hover:shadow-lg hover:shadow-orange-500/5 transition-all group">
              <div className="w-12 h-12 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 grid place-items-center mb-4 group-hover:scale-110 transition-transform">
                <Award className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-lg mb-2">AI search'e hazır</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                ChatGPT, Claude, Gemini, Perplexity gibi AI asistanları cevap üretirken senin sitendeki içeriği kaynak göstersin diye
                GEO (Generative Engine Optimization) yapıyoruz.
              </p>
            </div>
          </div>

          {/* CTA */}
          <div className="rounded-2xl bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 text-white p-10 sm:p-12 text-center mt-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">İlk makaleni ücretsiz dene</h2>
            <p className="text-white/90 mb-6 max-w-lg mx-auto">
              5 dakikada hesap aç, 10 dakikada ilk makalen hazır. Beğenmezsen ödeme yok.
            </p>
            <Link href="/onboarding">
              <Button size="lg" className="bg-white text-orange-600 hover:bg-white/90 text-base px-8 h-12 shadow-xl">
                Hemen başla
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <p className="text-xs text-white/70 mt-4 inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3" /> Kart bilgisi gerekmez · Aylık iptal · PayTR güvenli ödeme
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
