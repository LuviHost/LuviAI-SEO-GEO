import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { ShieldCheck, Sparkles, Heart, Globe2, Users, Zap, Target, Award } from 'lucide-react';

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
      <div className="container max-w-4xl py-10">
        <Breadcrumbs items={[{ label: 'Hakkımızda' }]} />

        {/* Hero */}
        <header className="text-center mt-4 mb-12">
          <div className="inline-flex items-center gap-2 bg-brand/10 text-brand text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4">
            <Sparkles className="h-3 w-3" /> Hakkımızda
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Türkiye için yapılmış AI SaaS
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            LuviAI; KOBİ, e-ticaret ve dijital ajansların SEO, içerik üretimi, sosyal medya ve reklam denetimini
            tek panelden, otomatik olarak yönetebilmesi için kurulan Türkiye merkezli bir platformdur.
          </p>
        </header>

        {/* Misyon */}
        <Card className="mb-6">
          <CardContent className="p-8">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
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
          </CardContent>
        </Card>

        {/* Hikayemiz */}
        <Card className="mb-6">
          <CardContent className="p-8">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0">
                <Heart className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold mb-3">Hikayemiz</h2>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  LuviAI, 2018'den beri Türkiye'de hosting ve domain hizmeti veren <a href="https://luvihost.com" className="text-brand hover:underline">LuviHost</a> grubunun
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
          </CardContent>
        </Card>

        {/* Neden güvenmeli */}
        <Card className="mb-6">
          <CardContent className="p-8">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 grid place-items-center shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold mb-4">Neden bize güvenebilirsin</h2>
                <ul className="space-y-3 text-sm">
                  <li className="flex gap-3">
                    <span className="h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0 text-xs font-bold">✓</span>
                    <span><strong>Türkiye merkezli ve yerel:</strong> Veriler Türkiye lokasyonlu sunucularda, KVKK uyumlu, AES-256-GCM şifrelemeyle korunur.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0 text-xs font-bold">✓</span>
                    <span><strong>PayTR güvenli ödeme:</strong> Türkiye'nin TCMB lisanslı ödeme sağlayıcısı. Aylık iptal hakkı, taahhüt yok.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0 text-xs font-bold">✓</span>
                    <span><strong>Açık kaynaklı pattern'ler:</strong> Anthropic Claude, Google Gemini, OpenAI ve LibreChat gibi açık ekosistemlerden ilham aldık.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0 text-xs font-bold">✓</span>
                    <span><strong>Kalite kapısı:</strong> Her makale yayına çıkmadan AI editör ajanından geçer. Klişe, yanlış bilgi, marka tutarsızlığı silinir.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0 text-xs font-bold">✓</span>
                    <span><strong>İlk makale ücretsiz:</strong> Beğenmezsen tek kuruş ödemen gerekmez. Önce dene, sonra karar ver.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0 text-xs font-bold">✓</span>
                    <span><strong>Açık iletişim:</strong> Destek için <a href="mailto:destek@luvihost.com" className="text-brand hover:underline">destek@luvihost.com</a> — gerçek insan yanıtlar.</span>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Değerler */}
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent className="p-6">
              <Globe2 className="h-6 w-6 text-brand mb-3" />
              <h3 className="font-bold text-lg mb-2">Türkçe öncelikli</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Çoğu AI içerik aracı İngilizce için yapılır, sonra Türkçe'ye uydurulur. Biz Türkçe ile başlayıp İngilizce'yi ekliyoruz —
                gramer, ton ve sektör jargonu tutarlı.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <Users className="h-6 w-6 text-emerald-500 mb-3" />
              <h3 className="font-bold text-lg mb-2">KOBİ-dostu</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Saatler süren manuel SEO denetimi, içerik briefi yazma, sosyal medya planlama gibi işleri dakikalara indirir.
                Ekibinde uzman olmasa bile profesyonel sonuçlar alırsın.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <Zap className="h-6 w-6 text-amber-500 mb-3" />
              <h3 className="font-bold text-lg mb-2">Gerçek otopilot</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Plan + GSC + rakip + persona analizi → konu önerileri → otomatik üretim → otomatik yayın → 30 gün sonra performans takibi.
                Sen sadece onaylarsın.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <Award className="h-6 w-6 text-violet-500 mb-3" />
              <h3 className="font-bold text-lg mb-2">AI search'e hazır</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                ChatGPT, Claude, Gemini, Perplexity gibi AI asistanları cevap üretirken senin sitendeki içeriği kaynak göstersin diye
                GEO (Generative Engine Optimization) yapıyoruz.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* CTA */}
        <div className="text-center mt-12 mb-4">
          <Link
            href="/onboarding"
            className="inline-block px-8 py-4 bg-brand text-white rounded-lg font-bold text-lg hover:bg-brand/90 transition-colors shadow-lg"
          >
            İlk makaleni ücretsiz dene →
          </Link>
          <p className="text-xs text-muted-foreground mt-3">
            Kart bilgisi gerekmez · Aylık iptal · PayTR güvenli ödeme
          </p>
        </div>
      </div>
    </>
  );
}
