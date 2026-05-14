'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import {
  Sparkles, Globe, Calendar, Bot, FileText, BarChart3, CheckCircle2,
  ArrowRight, Send, Search, Layers, Clock, ShieldCheck, Repeat,
  Megaphone, Award, Network, MessageSquare, Star, TrendingUp, Mic, Map,
} from 'lucide-react';

export default function HomePage() {
  const { t } = useT();
  const { data: session, status } = useSession();
  const isAuthed = !!session?.user;
  const primaryHref = isAuthed ? '/dashboard' : '/signin?callbackUrl=/onboarding';
  const primaryLabel = isAuthed
    ? `Dashboard'a git`
    : status === 'loading'
      ? '...'
      : `Erken Erişime Katıl`;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Page-spesifik JSON-LD: Product (offers) + BreadcrumbList */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Product',
              '@id': 'https://ai.luvihost.com/#product',
              name: 'LuviAI',
              description: 'SEO, AI içerik üretimi, sosyal medya ve reklam denetimi tek panelden otomatikleştiren Türkiye merkezli SaaS.',
              brand: { '@type': 'Brand', name: 'LuviAI' },
              offers: [
                {
                  '@type': 'Offer',
                  name: 'Starter',
                  price: '499',
                  priceCurrency: 'TRY',
                  availability: 'https://schema.org/InStock',
                  url: 'https://ai.luvihost.com/pricing',
                  description: '1 site, ayda 10 makale',
                },
                {
                  '@type': 'Offer',
                  name: 'Pro',
                  price: '1299',
                  priceCurrency: 'TRY',
                  availability: 'https://schema.org/InStock',
                  url: 'https://ai.luvihost.com/pricing',
                  description: '3 site, ayda 50 makale',
                },
                {
                  '@type': 'Offer',
                  name: 'Agency',
                  price: '3299',
                  priceCurrency: 'TRY',
                  availability: 'https://schema.org/InStock',
                  url: 'https://ai.luvihost.com/pricing',
                  description: '10 site, ayda 250 makale',
                },
              ],
            },
            {
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: 'https://ai.luvihost.com/' },
              ],
            },
            {
              '@type': 'HowTo',
              '@id': 'https://ai.luvihost.com/#howto',
              name: 'LuviAI ile siteye AI içerik yayınlama',
              description: 'Sitenizin URL\'ini girip dakikalar içinde ilk AI makaleyi yayına almak için 3 adım.',
              estimatedCost: { '@type': 'MonetaryAmount', currency: 'TRY', value: '0' },
              totalTime: 'PT5M',
              step: [
                {
                  '@type': 'HowToStep',
                  position: 1,
                  name: 'Site adresini gir',
                  text: 'Sadece domain yaz. AI sitenin sektörünü, marka sesini ve eksikleri otomatik analiz eder.',
                  url: 'https://ai.luvihost.com/onboarding',
                },
                {
                  '@type': 'HowToStep',
                  position: 2,
                  name: 'AI sana konular önerir',
                  text: 'Sektörün, rekabetin ve Google\'da aranan sorulara göre yüksek potansiyelli konuları sıralar. Onaylarsın.',
                  url: 'https://ai.luvihost.com/onboarding',
                },
                {
                  '@type': 'HowToStep',
                  position: 3,
                  name: 'Üretir ve yayınlar',
                  text: 'Saatini söyle, AI yazsın, kontrol etsin, görselleri eklesin ve sitene + sosyal medyana otomatik göndersin.',
                  url: 'https://ai.luvihost.com/onboarding',
                },
              ],
            },
            {
              '@type': 'WebPage',
              '@id': 'https://ai.luvihost.com/#webpage',
              url: 'https://ai.luvihost.com/',
              name: 'LuviAI — Ana Sayfa',
              isPartOf: { '@id': 'https://ai.luvihost.com/#website' },
              speakable: {
                '@type': 'SpeakableSpecification',
                cssSelector: ['h1', '.hero-subtitle', '.value-card-title'],
              },
              inLanguage: 'tr-TR',
            },
          ],
        }) }}
      />

      {/* ─── HEADER ─── */}
      <header className="bg-gradient-to-br from-brand via-brand-light to-brand/30">
        <div className="container flex justify-between items-center py-4 sm:py-6 px-4">
          <Link href="/" className="text-xl sm:text-2xl font-bold text-white inline-flex items-center gap-2">
            <img src="/favicon.svg" alt="LuviAI" className="h-7 w-7" />
            LuviAI
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3 lg:gap-5">
            <Link href="/pricing" className="text-white/90 text-xs sm:text-sm hover:text-white hover:underline">
              {t('nav.pricing')}
            </Link>
            <Link href="/use-cases" className="text-white/90 text-xs sm:text-sm hover:text-white hover:underline hidden sm:inline">
              Kullanım Senaryoları
            </Link>
            <Link href="/compare" className="text-white/90 text-xs sm:text-sm hover:text-white hover:underline hidden md:inline">
              Karşılaştır
            </Link>
            <Link href="/about" className="text-white/90 text-xs sm:text-sm hover:text-white hover:underline hidden md:inline">
              Hakkımızda
            </Link>
            <Link href="/faq" className="text-white/90 text-xs sm:text-sm hover:text-white hover:underline hidden lg:inline">
              SSS
            </Link>
            <span className="hidden sm:inline w-px h-4 bg-white/30" />
            <LocaleSwitch />
            <ThemeToggle />
            {isAuthed ? (
              <Link href="/dashboard" className="text-white text-xs sm:text-sm font-medium px-3 py-1.5 rounded-md bg-white/15 hover:bg-white/25 transition-colors">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/signin" className="text-white/90 text-xs sm:text-sm hover:text-white hover:underline hidden sm:inline">
                  Giriş yap
                </Link>
                <Link href="/signin?callbackUrl=/onboarding" className="text-brand text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-md bg-white hover:bg-white/90 transition-colors">
                  Ücretsiz dene
                </Link>
              </>
            )}
          </nav>
        </div>

        {/* ─── HERO ─── */}
        <section className="container px-4 pt-6 sm:pt-12 pb-16 sm:pb-24">
          <div className="max-w-4xl mx-auto text-center text-white">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur px-3 py-1 rounded-full text-xs font-medium mb-6">
              <Sparkles className="h-3 w-3" />
              {t('hero.beta_note')}
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 tracking-tight leading-[1.1]">
              {t('hero.title')}
            </h1>

            <p className="text-base sm:text-lg md:text-xl mb-3 sm:mb-4 text-white/90 max-w-2xl mx-auto leading-relaxed">
              {t('hero.subtitle')}
            </p>

            <p className="text-sm sm:text-base mb-8 sm:mb-10 text-white/70 max-w-2xl mx-auto">
              SEO, içerik üretimi, sosyal medya ve reklamlar — tek panelden, otopilotla.
              <strong className="text-white"> Saatlerce uğraşacağın işi dakikalara indirir.</strong>
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
              <Button asChild size="lg" className="bg-white text-brand hover:bg-white/95 shadow-xl">
                <Link href={primaryHref}>{primaryLabel} →</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white text-white hover:bg-white/10">
                <Link href="/pricing">{t('hero.cta_secondary')}</Link>
              </Button>
            </div>

            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs sm:text-sm text-white/80">
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> İlk makale ücretsiz</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> PayTR güvenli ödeme</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Aylık iptal — taahhüt yok</span>
            </div>
          </div>
        </section>
      </header>

      {/* ─── DEĞER ÖNERMESİ — 4 SÜTUN ─── */}
      <section className="bg-background border-b">
        <div className="container px-4 py-16 sm:py-24">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              {t('value.title')}
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg">
              {t('value.subtitle')}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
            <ValueCard
              icon={<Search className="h-6 w-6" />}
              title={t('value.v1.title')}
              desc={t('value.v1.desc')}
              accent="from-blue-500/10 to-blue-500/5"
              iconColor="text-blue-500"
            />
            <ValueCard
              icon={<Bot className="h-6 w-6" />}
              title={t('value.v2.title')}
              desc={t('value.v2.desc')}
              accent="from-purple-500/10 to-purple-500/5"
              iconColor="text-purple-500"
            />
            <ValueCard
              icon={<Calendar className="h-6 w-6" />}
              title={t('value.v3.title')}
              desc={t('value.v3.desc')}
              accent="from-green-500/10 to-green-500/5"
              iconColor="text-green-500"
            />
            <ValueCard
              icon={<Send className="h-6 w-6" />}
              title={t('value.v4.title')}
              desc={t('value.v4.desc')}
              accent="from-orange-500/10 to-orange-500/5"
              iconColor="text-orange-500"
            />
          </div>
        </div>
      </section>

      {/* ─── SOSYAL TAKVİM MOCKUP ─── */}
      <section className="bg-muted/30 border-b">
        <div className="container px-4 py-16 sm:py-24">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-brand/10 text-brand text-xs font-semibold px-3 py-1 rounded-full mb-4">
                <Calendar className="h-3.5 w-3.5" /> {t('social.eyebrow')}
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                {t('social.title')}
              </h2>
              <p className="text-muted-foreground text-base sm:text-lg mb-6">
                {t('social.desc')}
              </p>
              <ul className="space-y-3 text-sm">
                <BenefitItem>{t('social.b1')}</BenefitItem>
                <BenefitItem>{t('social.b2')}</BenefitItem>
                <BenefitItem>{t('social.b3')}</BenefitItem>
                <BenefitItem>{t('social.b4')}</BenefitItem>
                <BenefitItem>{t('social.b5')}</BenefitItem>
              </ul>
            </div>

            <div>
              <CalendarMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ─── NASIL ÇALIŞIR — 4 ADIM ─── */}
      <section id="nasil" className="bg-background border-b">
        <div className="container px-4 py-16 sm:py-24">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              {t('how.title')}
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg">
              {t('how.eyebrow')}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
            <Step
              n={1}
              title="Siteni bağla"
              desc="URL ver, dil seç. AI 60 saniyede SEO + GEO + rakip + persona analizini çıkarır."
            />
            <Step
              n={2}
              title="Hesaplarını ekle"
              desc="GSC, Google Analytics, X, LinkedIn — her biri tek tıkla bağlanır."
            />
            <Step
              n={3}
              title="Konuyu seç ve onayla"
              desc="AI haftada 5–50 konu önerir. Sen seç, AI yazsın. Editör ajanı kalite kontrol eder."
            />
            <Step
              n={4}
              title="Takvimden gönder"
              desc="Saatini değiştir, önizle, kontrol et. Otomatik sitene ve sosyal kanallara akar."
            />
          </div>
        </div>
      </section>

      {/* ─── ÖZELLİKLER GRID ─── */}
      <section id="ozellikler" className="bg-muted/30 border-b">
        <div className="container px-4 py-16 sm:py-24">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              İşinin büyümesi için ihtiyacın olan her şey
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg">
              Tek panelde, otomatik, sen sadece onaylarsın.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-6xl mx-auto">
            <FeatureBox icon={<Search />} title="Site sağlık denetimi"
              desc="Sitenin Google ve AI motorlarındaki görünürlüğünü dakikalar içinde tarar. Sorunlu noktaları gösterir, çoğunu tek tıkla düzeltir." />
            <FeatureBox icon={<FileText />} title="Hazır makale, hazır görsel"
              desc="Marka tonuna uygun, 1800-2500 kelime kapsamlı yazılar. AI önce taslak çıkarır, kalite kontrolünden geçirir, görsellerini de hazır verir." />
            <FeatureBox icon={<Sparkles />} title="ChatGPT ve Gemini'da görün"
              desc="Yapay zeka asistanları cevap üretirken senin sitendeki içeriği kaynak göstersin. Görünürlük skoru gün gün takip edilir." />
            <FeatureBox icon={<Calendar />} title="Sosyal medya takvimi"
              desc="X ve LinkedIn için otomatik post taslağı. Saatini takvimden seç, beğen ya da düzenle, kanallarına otomatik gider." />
            <FeatureBox icon={<Globe />} title="Tek tıkla yayın"
              desc="WordPress, Webflow, Shopify, Ghost ve diğer popüler platformlar — kullandığın sisteme direkt gönderir. Manuel kopyala-yapıştır yok." />
            <FeatureBox icon={<BarChart3 />} title="Gerçek performans takibi"
              desc="Yayınlanan her makalenin Google'da kaç gösterim aldığını, kaç tıklama getirdiğini gör. Performansı düşük olanlara otomatik iyileştirme önerisi." />
            <FeatureBox icon={<Bot />} title="Türkçe + İngilizce"
              desc="Aynı siteyi iki dilde de yönet. Yurtdışı kullanıcına İngilizce makale, yerele Türkçe — tek panelden, ayar gerekmez." />
            <FeatureBox icon={<ShieldCheck />} title="Yayından önce kalite kontrolü"
              desc="Her makale yayına çıkmadan editör ajanı tarafından gözden geçirilir. Klişe, yanlış bilgi ve marka tonu uyumsuzluğu varsa düzeltilir." />
            <FeatureBox icon={<Repeat />} title="Otomatik iyileştirme"
              desc="Eski makalelerin performansını izler. Düşüş görünce başlık, açıklama veya içeriğe öneriler getirir — site büyümeye devam eder." />
          </div>
        </div>
      </section>

      {/* ─── AI SEARCH OPTIMIZATION (GEO STACK) ─── */}
      <section className="bg-background border-b">
        <div className="container px-4 py-16 sm:py-24">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <span className="inline-block bg-brand/10 text-brand text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full mb-3">
              Türkiye'de bir ilk
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              AI Search Optimization Stack
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg">
              ChatGPT, Claude, Gemini, Perplexity sizin için yazıyor mu? <strong>32 GEO özelliği</strong> sayesinde sitenizi AI'lara öğretin.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-6xl mx-auto">
            <GeoCard icon={<Sparkles />} title="AI Citation Test" desc="Claude · Gemini · ChatGPT · Perplexity'de günlük alıntılanma skoru. Drop tespit + email." />
            <GeoCard icon={<Network />} title="GEO Heatmap" desc="Sektör soruları × 4 AI = canlı matrix. Rakipler hangi sorularda kazanıyor görün." />
            <GeoCard icon={<Award />} title="GEO Score Card" desc="6 pillar (crawler, schema, citation, otorite, tazelik, multi-modal). Harf notu A+ → F." />
            <GeoCard icon={<Globe />} title="llms-full.txt" desc="Tüm site içeriği AI için tek dosyada. Anthropic, Stripe gibi firmalar kullanıyor." />
            <GeoCard icon={<FileText />} title="15+ Schema Tipi" desc="Article, FAQPage, HowTo, Product, Organization, sameAs, Speakable — otomatik." />
            <GeoCard icon={<Mic />} title="TTS + Podcast RSS" desc="Her makaleyi sesli okur, Spotify'a uygun feed. Siri/Alexa multi-modal alıntı." />
            <GeoCard icon={<MessageSquare />} title="Reddit + HARO" desc="Sektör sorularına AI taslak yanıt. Backlink + AI authority sinyali." />
            <GeoCard icon={<Zap />} title="Wikidata + Wikipedia" desc="Knowledge Graph stub'ı + AI bot Wikipedia draft'ı. Kalıcı GEO etkisi." />
          </div>

          <div className="text-center mt-10">
            <Link href="/pricing" className="text-brand hover:underline text-sm font-medium inline-flex items-center gap-1">
              Tam liste için fiyatlandırmayı görün <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── PAID ADS STACK (FAZ 11) ─── */}
      <section className="bg-gradient-to-b from-orange-500/5 to-transparent border-b">
        <div className="container px-4 py-16 sm:py-24">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <span className="inline-block bg-orange-500/10 text-orange-500 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full mb-3">
              Yeni
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Reklam Otopilot — Google + Meta + GA4
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg">
              AI hedef kitle önerir, reklam metni yazar, görsel hazırlar, bütçe ayarlar, yayınlar.
              <strong> 6 saatte 1 ROAS analiz, otomatik optimize.</strong>
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl mx-auto">
            <AdsCard icon={<Bot />} title="AI Reklam Üretici" desc="Google RSA (15 headline + 4 desc) + Meta (5 primaryText + CTA) tek seferde." />
            <AdsCard icon={<Layers />} title="Audience Builder" desc="Brain'den persona + niş → keyword + interest + lookalike önerileri." />
            <AdsCard icon={<TrendingUp />} title="Otopilot ROAS Optimize" desc="ROAS<1.5 → pause · CTR>3%+ROAS>5 → bütçe %20 artır. 6 saatte bir cron." />
            <AdsCard icon={<Award />} title="A/B Test Winner" desc="7+ gün eski ad varyantlarını AI karşılaştırır, kazananı seçer." />
            <AdsCard icon={<Search />} title="Negative Keyword AI" desc="Search terms'den alakasız kelime tespit + Google'a otomatik ekleme." />
            <AdsCard icon={<Network />} title="Cross-Platform Shift" desc="Meta iyi, Google kötü → bütçe otomatik kaydır. ROAS optimize." />
          </div>

          <div className="text-center mt-10 max-w-xl mx-auto">
            <p className="text-sm text-muted-foreground">
              <strong className="text-orange-500">Etki:</strong> Ortalama bir KOBİ Google + Meta'ya ayda 5-15k ₺ harcıyor.
              Kötü yönetilirse %30-50'si israf olur. <strong>LuviAI bunu otomatik kapatır → ayda 1.5-7.5k ₺ tasarruf.</strong>
            </p>
          </div>
        </div>
      </section>

      {/* ─── DEĞER KARŞILAŞTIRMA — TASARRUF TABLOSU ─── */}
      <section className="bg-muted/20 border-b">
        <div className="container px-4 py-16 sm:py-24">
          <div className="max-w-3xl mx-auto text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Klasik ekibe göre %93 tasarruf
            </h2>
            <p className="text-muted-foreground">
              Her şey Profesyonel pakete dahil — <strong>aylık 6.980 ₺</strong>.
            </p>
          </div>

          <div className="max-w-2xl mx-auto rounded-2xl border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 font-semibold">İhtiyaç</th>
                  <th className="text-right px-4 py-3 font-semibold">Klasik</th>
                  <th className="text-right px-4 py-3 font-semibold text-brand">LuviAI</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr><td className="px-4 py-2.5">SEO uzmanı</td><td className="text-right px-4 text-muted-foreground">35-60k ₺/ay</td><td className="text-right px-4 text-brand">✓</td></tr>
                <tr><td className="px-4 py-2.5">İçerik yazarı</td><td className="text-right px-4 text-muted-foreground">10-20k ₺/ay</td><td className="text-right px-4 text-brand">✓</td></tr>
                <tr><td className="px-4 py-2.5">Sosyal medya yöneticisi</td><td className="text-right px-4 text-muted-foreground">15-25k ₺/ay</td><td className="text-right px-4 text-brand">✓</td></tr>
                <tr><td className="px-4 py-2.5">Reklam uzmanı (Google + Meta)</td><td className="text-right px-4 text-muted-foreground">20-40k ₺/ay</td><td className="text-right px-4 text-brand">✓</td></tr>
                <tr><td className="px-4 py-2.5">A/B test analist</td><td className="text-right px-4 text-muted-foreground">3-5k ₺/ay</td><td className="text-right px-4 text-brand">✓</td></tr>
                <tr><td className="px-4 py-2.5">GA4 expert</td><td className="text-right px-4 text-muted-foreground">5-10k ₺/ay</td><td className="text-right px-4 text-brand">✓</td></tr>
                <tr><td className="px-4 py-2.5">AI Search optimizasyonu</td><td className="text-right px-4 text-muted-foreground">yok</td><td className="text-right px-4 text-brand">✓</td></tr>
                <tr className="bg-muted/20 font-bold">
                  <td className="px-4 py-3">TOPLAM</td>
                  <td className="text-right px-4">~100k ₺</td>
                  <td className="text-right px-4 text-brand text-base">6.980 ₺</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── FİNAL CTA ─── */}
      <section className="bg-gradient-to-br from-brand via-brand-light to-brand/40 text-white">
        <div className="container px-4 py-16 sm:py-24 text-center">
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4 max-w-3xl mx-auto leading-tight">
            {t('final.title')}
          </h2>
          <p className="text-white/90 text-base sm:text-lg mb-8 max-w-2xl mx-auto">
            {t('final.subtitle')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-white text-brand hover:bg-white/95 shadow-xl">
              <Link href={primaryHref}>{primaryLabel} <ArrowRight className="ml-1 h-4 w-4" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white text-white hover:bg-white/10">
              <Link href="/pricing">{t('final.cta_secondary')}</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="bg-background border-t">
        <div className="container px-4 py-8 grid sm:grid-cols-3 gap-6 text-sm">
          <div>
            <div className="font-bold text-lg mb-2">LuviAI</div>
            <p className="text-muted-foreground text-xs">
              {t('footer.tagline')}
            </p>
          </div>
          <div>
            <div className="font-semibold mb-2">{t('footer.product')}</div>
            <ul className="space-y-1 text-muted-foreground">
              <li><Link href="#nasil" className="hover:text-brand">{t('footer.product.how')}</Link></li>
              <li><Link href="#ozellikler" className="hover:text-brand">{t('footer.product.features')}</Link></li>
              <li><Link href="/pricing" className="hover:text-brand">{t('footer.product.pricing')}</Link></li>
              <li><Link href="/faq" className="hover:text-brand">{t('footer.product.faq')}</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-2">{t('footer.legal')}</div>
            <ul className="space-y-1 text-muted-foreground">
              <li><Link href="/terms" className="hover:text-brand">{t('footer.legal.terms')}</Link></li>
              <li><Link href="/privacy" className="hover:text-brand">{t('footer.legal.privacy')}</Link></li>
              <li><Link href="/kvkk" className="hover:text-brand">{t('footer.legal.kvkk')}</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t py-4 text-center text-xs text-muted-foreground">
          {t('footer.copyright')}
        </div>
      </footer>
    </div>
  );
}

// ─── Bileşenler ─────────────────────────────────────────────────────

function ValueCard({
  icon, title, desc, accent, iconColor,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  accent: string;
  iconColor: string;
}) {
  return (
    <div className={`relative rounded-2xl border bg-gradient-to-br ${accent} p-6 hover:shadow-lg hover:-translate-y-0.5 transition-all`}>
      <div className={`h-12 w-12 rounded-xl bg-background border grid place-items-center mb-4 ${iconColor}`}>
        {icon}
      </div>
      <h3 className="font-bold text-lg mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function BenefitItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckCircle2 className="h-5 w-5 text-brand shrink-0 mt-0.5" />
      <span>{children}</span>
    </li>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="relative">
      <div className="rounded-2xl border bg-card p-6 h-full hover:border-brand/40 hover:shadow-md transition-all">
        <div className="h-10 w-10 rounded-full bg-brand text-white font-bold grid place-items-center mb-4 shadow-md">
          {n}
        </div>
        <h3 className="font-bold text-base mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function FeatureBox({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl border bg-card p-5 hover:border-brand/40 hover:shadow-md transition-all">
      <div className="h-10 w-10 rounded-lg bg-brand/10 text-brand grid place-items-center mb-3">
        {icon}
      </div>
      <h3 className="font-semibold text-base mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function GeoCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl border-2 border-brand/20 bg-gradient-to-br from-brand/5 to-transparent p-4 hover:border-brand/50 transition-all">
      <div className="h-9 w-9 rounded-lg bg-brand/15 text-brand grid place-items-center mb-3">
        {icon}
      </div>
      <h3 className="font-semibold text-sm mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function AdsCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl border-2 border-orange-500/20 bg-gradient-to-br from-orange-500/5 to-transparent p-4 hover:border-orange-500/50 transition-all">
      <div className="h-9 w-9 rounded-lg bg-orange-500/15 text-orange-500 grid place-items-center mb-3">
        {icon}
      </div>
      <h3 className="font-semibold text-sm mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

// ─── Sosyal takvim mockup ───────────────────────────────────────────

function CalendarMockup() {
  const days = ['PZT', 'SAL', 'ÇAR', 'PER', 'CUM', 'CTS', 'PAZ'];
  // Plana göre 3 post: PZT 10:00, ÇAR 14:00, CUM 11:00
  const slots: Record<string, string[]> = {
    PZT: ['10:00'],
    ÇAR: ['14:00'],
    CUM: ['11:00'],
  };

  return (
    <div className="rounded-2xl border bg-card shadow-2xl p-5 sm:p-6">
      {/* Üst bilgi */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-brand/10 grid place-items-center">
            <Calendar className="h-4 w-4 text-brand" />
          </div>
          <div>
            <div className="font-semibold text-sm">Sosyal Takvim</div>
            <div className="text-[11px] text-muted-foreground">Profesyonel planı · 18 post/ay</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-full px-2 py-0.5 font-semibold">
            Taslak: 2
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] bg-green-500/10 text-green-700 dark:text-green-400 rounded-full px-2 py-0.5 font-semibold">
            Yayında: 5
          </span>
        </div>
      </div>

      {/* Hafta gridi */}
      <div className="grid grid-cols-7 gap-1.5 mb-5">
        {days.map((d) => {
          const daySlots = slots[d] ?? [];
          const isActive = daySlots.length > 0;
          return (
            <div
              key={d}
              className={`rounded-lg border p-2 text-center min-h-[64px] ${
                isActive ? 'bg-brand/5 border-brand/30' : 'bg-muted/30'
              }`}
            >
              <div className="text-[10px] font-bold text-muted-foreground tracking-wide">{d}</div>
              <div className="mt-1.5 space-y-1">
                {daySlots.length > 0 ? (
                  daySlots.map((t) => (
                    <div
                      key={t}
                      className="text-[10px] sm:text-xs font-mono bg-brand/10 text-brand rounded px-1 py-0.5 border border-brand/20"
                    >
                      {t}
                    </div>
                  ))
                ) : (
                  <div className="text-[10px] text-muted-foreground/40">—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sahte X (Twitter) preview */}
      <div className="rounded-xl border bg-muted/20 p-4">
        <div className="text-[10px] font-bold text-muted-foreground tracking-wide mb-2">
          ÖNİZLEME · X / TWITTER
        </div>
        <div className="bg-background rounded-lg border p-3 flex gap-2.5">
          <div className="h-9 w-9 rounded-full bg-brand/10 grid place-items-center shrink-0">
            <span className="text-xs font-bold text-brand">L</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 text-xs">
              <span className="font-bold">LuviHost</span>
              <span className="text-muted-foreground">@luvihost · şimdi</span>
            </div>
            <div className="text-[13px] mt-0.5 leading-snug">
              Shared hosting nedir, kim için doğru tercih? 2026'da Türkiye'de en iyi hosting paketi
              hangisi?{' '}
              <span className="text-[#1d9bf0]">#hosting</span>{' '}
              <span className="text-[#1d9bf0]">#seo</span>{' '}
              <span className="text-[#1d9bf0]">https://luvihost.com.tr/blog/...</span>
            </div>
            <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Pazartesi 10:00</span>
              <span>187/280</span>
            </div>
          </div>
        </div>
      </div>

      {/* Alt bar */}
      <div className="flex items-center gap-2 mt-4 text-[11px] text-muted-foreground">
        <Layers className="h-3.5 w-3.5" />
        <span>Yayınlanan her makaleden otomatik post taslağı oluşur</span>
      </div>
    </div>
  );
}
