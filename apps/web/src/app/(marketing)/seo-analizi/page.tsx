import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { VitrinHero, VitrinSection, VITRIN_LINK } from '@/components/vitrin/vitrin-page';
import { SeoAnalizAraci } from '@/components/seo-analizi/seo-analiz-araci';

/**
 * Ucretsiz SEO analizi (25.11.2026). NEDEN: Google Keyword Planner (TR, Turkce) "seo analiz" 1.900,
 * "seo analizi" 590, "site analiz" 390, "ücretsiz seo analizi" 170 aylik; SERP'te ilk 10 neredeyse
 * tamamen ucretsiz analiz araci. Site hizi bu sayfanin bir bolumu ("site hızı testi" SERP'i yazi/liste).
 *
 * Her cumle koda dayanir: tarama en fazla 10 sayfa, 15 kontrol, genel puan agirliklari ve sinirlar
 * api audit/public-seo-analysis.ts + audit-checks.service.ts (OVERALL_SCORE_WEIGHTS) ile ayni.
 * Esikler web.dev (LCP 2,5 sn, INP 200 ms, CLS 0,1 — 75. yuzdelik; api pagespeed-field.ts CWV_ESIK).
 */

const BASLIK = 'Ücretsiz SEO Analizi: teknik SEO ve site hızı testi';
const ACIKLAMA = 'Sitenizin ücretsiz SEO analizini yapın: 15 teknik kontrol, mobil site hızı ve Core Web Vitals, öncelikli sorunlar. Üyelik gerekmez.';

export const metadata: Metadata = {
  title: BASLIK,
  description: ACIKLAMA,
  alternates: { canonical: 'https://ranksup.ai/seo-analizi' },
  robots: { index: true, follow: true },
  openGraph: { title: BASLIK, description: ACIKLAMA, url: 'https://ranksup.ai/seo-analizi', type: 'website' },
};

const GOVDE = 'max-w-2xl space-y-4 text-sm leading-[1.8] text-muted-foreground';

const KONTROLLER: Array<[string, string]> = [
  ['Sayfa başlıkları ve meta açıklamalar', 'Eksik, çok kısa ya da çok uzun başlık ve açıklamalar.'],
  ['H1 başlıkları', 'Başlığı olmayan ya da birden çok sayfada aynı başlığı taşıyan sayfalar.'],
  ['Canonical etiketi', 'Sayfanın asıl adresini bildiren etiket var mı, doğru mu.'],
  ['HTTPS ve yönlendirmeler', 'Güvenli bağlantı, sertifika zinciri ve alan adının yazılışlarından siteye kaç adımda ulaşıldığı.'],
  ['Site haritası ve robots.txt', 'Google’ın siteyi keşfetmesini kolaylaştıran dosyalar var mı, okunabiliyor mu.'],
  ['Google ve AI Bakışı uygunluğu', 'Sayfalar dizine eklenebiliyor ve arama sonucunda snippet ile gösterilebiliyor mu.'],
  ['Yapısal veri (schema.org)', 'Sayfalarda geçerli JSON-LD işaretlemesi var mı.'],
  ['Görseller', 'Alt metni eksik görseller, genişlik ve yüksekliği yazılmamış görseller, tembel yükleme.'],
  ['İç bağlantılar', 'Sayfalar birbirine bağlanıyor mu, hiçbir yerden bağlantı almayan sayfa var mı.'],
  ['Sosyal paylaşım', 'Open Graph ve X (Twitter) kartı etiketleri.'],
  ['Dil etiketleri', 'Birden çok dilde yayın yapan sitelerde hreflang.'],
  ['Mobil hız', 'Google PageSpeed ile mobil hız puanı, en büyük içeriğin yüklenme süresi (LCP) ve sayfa kayması (CLS); varsa gerçek ziyaretçi verisi.'],
];

const SSS: Array<{ q: string; a: string }> = [
  {
    q: 'SEO analizi ücretsiz mi?',
    a: 'Evet. Üyelik gerekmez; sonucu görmek için e-posta adresinizi yazmanız istenir. Aynı ağdan 24 saatte en fazla 3 farklı site analiz edilebilir; aynı site 24 saat içinde tekrar yazılırsa kayıtlı sonuç gösterilir.',
  },
  {
    q: 'Analiz sitemin kaç sayfasına bakıyor?',
    a: 'Ana sayfadan başlayarak en fazla 10 sayfa taranır. Sitenin tamamını taramak ve sorunları sayfa sayfa görmek için RanksUp hesabı gerekir.',
  },
  {
    q: 'Teknik SEO puanı nasıl hesaplanıyor?',
    a: 'Puan, 14 kontrolün ağırlıklı ortalamasıdır. En yüksek ağırlık HTTPS’tedir; site haritası, robots.txt, yapısal veri, başlık, açıklama ve Google uygunluğu onu izler. llms.txt puana girmez. Erişim engeli yüzünden ölçülemeyen kontrol 0 sayılmaz, ortalamadan çıkarılır.',
  },
  {
    q: 'Site hızı testi neyi ölçüyor?',
    a: 'Google PageSpeed ile mobil hız ölçülür. Siteniz yeterli trafik alıyorsa Chrome kullanıcılarının son 28 günlük gerçek verisi de gösterilir: en büyük içeriğin yüklenmesi (LCP) 2,5 saniye, etkileşim gecikmesi (INP) 200 milisaniye ve sayfa kayması (CLS) 0,1 altında olmalı. Laboratuvar puanı tek bir ölçümdür; gerçek ziyaretçi verisi daha güvenilirdir.',
  },
  {
    q: 'Analiz sitemi yavaşlatır mı?',
    a: 'Hayır. Tarayıcımız RanksUpBot olarak kendini tanıtır, robots.txt kurallarına uyar ve en fazla 10 sayfa okur.',
  },
  {
    q: 'Sonuçta görünen sorunları nasıl düzeltirim?',
    a: 'Her bulgunun yanında ne yapılması gerektiği yazar. RanksUp’ta site haritası, robots.txt ve llms.txt gibi dosyalar için otomatik düzeltme ve sorunların sayfa sayfa listesi vardır.',
  },
];

export default function SeoAnaliziPage() {
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: SSS.map((s) => ({ '@type': 'Question', name: s.q, acceptedAnswer: { '@type': 'Answer', text: s.a } })),
  };
  const appJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'RanksUp Ücretsiz SEO Analizi',
    url: 'https://ranksup.ai/seo-analizi',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    inLanguage: 'tr-TR',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'TRY' },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }} />
      <VitrinHero
        before={<Breadcrumbs items={[{ label: 'Ücretsiz SEO analizi' }]} />}
        rail="Ücretsiz SEO analizi"
        a="Sitenizin SEO analizi"
        b="ve site hızı testi"
        lead={
          <p>
            Alan adınızı yazın: sitenizin ilk 10 sayfasını tarayıp 15 teknik SEO kontrolünü çalıştıralım, mobil hızını
            ölçelim ve önce neyi düzeltmeniz gerektiğini gösterelim. Ücretsiz, üyelik gerekmez; sonucu e-posta adresinizle açarsınız.
          </p>
        }
      >
        <div className="mt-10">
          <SeoAnalizAraci />
        </div>
      </VitrinHero>

      <VitrinSection id="neler-kontrol-ediliyor" title="Neler kontrol ediliyor?" note="Kapsam">
        <ul className="border-t border-border">
          {KONTROLLER.map(([ad, aciklama]) => (
            <li key={ad} className="border-b border-border py-4">
              <strong className="block text-base font-medium text-foreground">{ad}</strong>
              <span className="text-sm leading-[1.8] text-muted-foreground">{aciklama}</span>
            </li>
          ))}
        </ul>
      </VitrinSection>

      <VitrinSection id="site-hizi" title="Site hızı testi sonucu nasıl okunur?" note="Hız">
        <div className={GOVDE}>
          <p>
            Google, sayfa deneyimini gerçek kullanıcı verisiyle değerlendirir. Bu yüzden siteniz yeterli trafik alıyorsa
            Chrome kullanıcılarının son 28 günlük verisini öne alıyoruz: en büyük içeriğin yüklenme süresi (LCP) 2,5 saniyenin,
            etkileşim gecikmesi (INP) 200 milisaniyenin, sayfa kayması (CLS) 0,1’in altında olmalı.
          </p>
          <p>
            Gerçek ziyaretçi verisi yoksa yalnızca mobil laboratuvar ölçümünü gösteririz. Bu tek bir ölçümdür, yavaş bir mobil
            bağlantıyı taklit eder ve aynı site için ölçümden ölçüme değişebilir. Düşük laboratuvar puanı tek başına “site yavaş”
            demek değildir.
          </p>
        </div>
      </VitrinSection>

      <VitrinSection id="yapay-zeka" title="Arama artık yalnız Google sonuçları değil" note="AI görünürlüğü">
        <div className={GOVDE}>
          <p>
            Müşterileriniz sorularını ChatGPT, Gemini ve Google’ın AI Modu gibi asistanlara da soruyor. Teknik SEO’nun sağlam
            olması bu cevaplarda kaynak gösterilmenin ön şartı; ama yeterli değil. Markanızın bu cevaplarda geçip geçmediğini
            <Link href="/#test" className={VITRIN_LINK}> ücretsiz AI görünürlük testiyle</Link> ölçebilir,
            <Link href="/rehber/google-ai-modu" className={VITRIN_LINK}> Google AI Modu rehberinde</Link> nasıl çalıştığını okuyabilirsiniz.
          </p>
        </div>
      </VitrinSection>

      <VitrinSection id="sss" title="Sık sorulan sorular" note="SSS">
        <dl className="border-t border-border">
          {SSS.map((s) => (
            <div key={s.q} className="border-b border-border py-5">
              <dt className="text-base font-medium text-foreground">{s.q}</dt>
              <dd className="mt-2 text-sm leading-[1.8] text-muted-foreground">{s.a}</dd>
            </div>
          ))}
        </dl>
      </VitrinSection>
    </>
  );
}
