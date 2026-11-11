import { Check } from 'lucide-react';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { VITRIN_WRAP } from '@/lib/vitrin';

const SITE_URL = 'https://ranksup.ai';
const SUPPORT_EMAIL = 'destek@luvihost.com';

const aboutJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'AboutPage',
      '@id': `${SITE_URL}/about#aboutpage`,
      url: `${SITE_URL}/about`,
      name: 'RanksUp Hakkında',
      description: 'Türkiye merkezli GEO + SEO + ASO + Apple Search Ads platformu RanksUp hakkında bilgiler.',
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
          email: SUPPORT_EMAIL,
          availableLanguage: ['Turkish', 'English'],
        },
      ],
      slogan: 'AI ile büyü, tek panelden.',
      knowsAbout: [
        'Search Engine Optimization',
        'Generative Engine Optimization',
        'AI Search Optimization',
        'Content Marketing Automation',
        'App Store Optimization (ASO)',
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

/** Neden bize guvenebilirsin — metinler onceki surumle ayni (iddialar kodla dogrulanmisti) */
const TRUST: Array<[string, string]> = [
  ['Türkiye merkezli ve yerel', 'Sunucular LuviHost İstanbul veri merkezinde, yedekler Frankfurt bölgesinde. Bağlantı bilgileri AES-256-GCM ile şifrelenir.'],
  ['PayTR güvenli ödeme', "Türkiye'nin TCMB lisanslı ödeme sağlayıcısı. Aylık iptal hakkı, taahhüt yok."],
  ['Güçlü modeller', 'Makaleler Anthropic Claude ile yazılır, görseller Google Gemini ile üretilir; AI görünürlük ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’te ölçülür.'],
  ['Kalite kapısı', 'Her makale yayına çıkmadan AI editör ajanından ve kalite kapısından geçer: klişeler temizlenir, kaynaksız sayılar ve uydurma iç bağlantılar yakalanır. Yine de yayından önce gözden geçirmeni öneririz.'],
  ['14 gün ücretsiz deneme', 'Kart bilgisi gerekmez; siteni bağlar, markanın AI cevaplarındaki yerini ölçersin, beğenmezsen ödeme yapmazsın. Önce dene, sonra karar ver.'],
];

/** Ilkeler — metinler onceki surumle ayni */
const VALUES: Array<{ title: string; body: string }> = [
  { title: 'Türkçe öncelikli', body: 'Çoğu AI içerik aracı İngilizce için yapılır, sonra Türkçe\'ye uydurulur. Biz Türkçe ile başlayıp İngilizce\'yi ekliyoruz — gramer, ton ve sektör jargonu tutarlı.' },
  { title: 'KOBİ-dostu', body: 'Saatler süren manuel SEO denetimi, içerik briefi yazma ve AI görünürlük takibi gibi işleri dakikalara indirir. Ekibinde uzman olmasa bile işin büyük kısmını panelden yürütürsün.' },
  // Son adim content-pivot.service: Search Console verisi gerekir (bkz. faq/page.tsx madde 5 kaynaklari)
  { title: 'Otomatik akış', body: 'Marka beyni + Search Console + rakip ve persona analizi → konu önerileri → otomatik üretim ve yayın → Search Console verisinde zayıf kalan yazıyı yayından 30 gün sonra yeniden yazma.' },
  { title: 'AI search\'e hazır', body: 'ChatGPT, Claude, Gemini, Perplexity gibi AI asistanları cevap üretirken senin sitendeki içeriği kaynak göstersin diye GEO (Generative Engine Optimization) yapıyoruz.' },
];

/**
 * "Neden variz" bolumundeki ORNEK sorgular. Olcum ya da istatistik degil; arama
 * kutusuna yazilan kelimelerle asistana sorulan cumle arasindaki farki gosterir.
 * Asistan sorusunun ilki ana sayfadaki ornek cevap kartiyla ayni (land2.sheet.query).
 */
const SEARCH_EXAMPLES = ['ön muhasebe programı', 'ön muhasebe programı fiyatları', 'en iyi ön muhasebe programı'];
const ASSISTANT_EXAMPLES = [
  'Küçük bir işletme için hangi ön muhasebe programını önerirsin?',
  'E-fatura kesebildiğim, kurulumu kolay bir program var mı?',
  'Bu iki programı karşılaştırır mısın?',
];

const TEXT_LINK = 'border-b border-white/30 pb-0.5 text-foreground transition-colors duration-200 hover:border-brand-vivid hover:text-brand-vivid';

/**
 * Koyu vitrin (Kasim 2026): iki tonlu baslik + solda yapiskan bolum basligi,
 * sagda icerik. Kurucu / ekip bolumu BILINCLI olarak yok. Sayfa alti cagri
 * kaldirildi; kapanisi ortak VitrinCta yapar (marketing-shell).
 */
export default function AboutPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutJsonLd) }}
      />

      <section>
        <div className={`${VITRIN_WRAP} pb-16 pt-6 lg:pb-24 lg:pt-10`}>
          <Breadcrumbs items={[{ label: 'Hakkımızda' }]} />
          <p className="v-rail mb-10 mt-8 flex items-center gap-2.5 sm:mb-14 lg:mt-12">
            <span className="h-1.5 w-1.5 shrink-0 bg-brand-vivid" aria-hidden />
            Hakkımızda
          </p>
          <h1 className="text-vitrin-1">
            <span className="block">Türkiye için yapılmış</span>{' '}
            <span className="block text-dim">AI SaaS.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-[1.75] text-muted-foreground">
            RanksUp; KOBİ, e-ticaret ve dijital ajansların GEO, SEO, içerik üretimi, ASO ve Apple Search Ads denetimini
            tek panelden, otomatik olarak yönetebilmesi için kurulan Türkiye merkezli bir platformdur.
          </p>
        </div>
      </section>

      <Bolum title="Neden varız">
        <p className="max-w-2xl text-xl leading-snug tracking-[-0.02em] sm:text-2xl">
          Müşteriler artık Google'ın yanında ChatGPT, Gemini ve Claude'a da soruyor. Arama kutusuna yazılan
          birkaç kelimenin yerini, asistana sorulan tam cümleler alıyor.
        </p>
        <div className="mt-10 grid border-l border-t border-border sm:grid-cols-2">
          <div className="border-b border-r border-border p-6 sm:p-7">
            <p className="v-rail">Arama kutusuna yazılan</p>
            <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
              {SEARCH_EXAMPLES.map((q) => <li key={q}>“{q}”</li>)}
            </ul>
          </div>
          <div className="relative border-b border-r border-border bg-card p-6 sm:p-7">
            <span className="absolute inset-x-0 top-0 h-0.5 bg-brand-vivid" aria-hidden />
            <p className="font-mono text-vitrin-rail text-brand-vivid">Asistana sorulan</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {ASSISTANT_EXAMPLES.map((q) => <li key={q}>“{q}”</li>)}
            </ul>
          </div>
        </div>
        <p className="v-rail mt-4">Sorgular örnektir.</p>
        <p className="mt-8 max-w-2xl text-sm leading-[1.8] text-muted-foreground">
          Cevapta adın geçmiyorsa, soruyu soran seni o cevapta görmez. RanksUp bu cevaplarda adının geçip geçmediğini
          ölçer ve eksik kaldığın sorular için içerik hazırlar.
        </p>
      </Bolum>

      <Bolum title="Misyonumuz">
        <p className="max-w-2xl text-xl leading-snug tracking-[-0.02em] sm:text-2xl">
          Saatlerce uğraşan SEO uzmanı, içerik yazarı, ASO uzmanı ve Apple Search Ads danışmanına ihtiyaç
          duymadan; küçük işletmelerin ve dijital ajansların yapay zeka destekli, kalite ve marka tutarlılığı
          taviz vermeyen büyüme araçlarına erişebilmesini sağlamak.
        </p>
      </Bolum>

      <Bolum title="Hikayemiz">
        <div className="max-w-2xl space-y-5 text-base leading-[1.75] text-muted-foreground">
          <p>
            RanksUp, 2018'den beri Türkiye'de hosting ve domain hizmeti veren <a href="https://luvihost.com" className={TEXT_LINK}>LuviHost</a> grubunun bünyesinde 2026'da kuruldu. Müşterilerimizin "site açtım ama ne içerik üreteceğim?" sorusu bizi bu platformu inşa etmeye yönlendirdi.
          </p>
          <p>
            Yapay zekanın içerik üretiminde sıradan, klişe ve marka kimliği zayıf çıktılar verdiğini gördük.
            Bu sorunları çözmek için 5 ajanlı üretim hattını, yayın öncesi kalite kapısını ve her site için ayrı marka beynini kurduk.
          </p>
        </div>
      </Bolum>

      <Bolum title="Neden bize güvenebilirsin">
        <ul className="border-t border-border">
          {TRUST.map(([label, desc]) => (
            <li key={label} className="grid grid-cols-[1.5rem_1fr] gap-3 border-b border-border py-5">
              <Check className="mt-1 h-4 w-4 text-brand-vivid" aria-hidden />
              <div>
                <p className="text-base font-medium">{label}</p>
                <p className="mt-1.5 max-w-2xl text-sm leading-[1.8] text-muted-foreground">{desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </Bolum>

      <Bolum title="İlkelerimiz">
        <div className="grid border-l border-t border-border sm:grid-cols-2">
          {VALUES.map(({ title, body }) => (
            <div key={title} className="border-b border-r border-border p-6 sm:p-7">
              <h3 className="text-base font-medium">{title}</h3>
              <p className="mt-3 text-sm leading-[1.8] text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Bolum>

      <Bolum title="İletişim">
        <p className="text-xl tracking-[-0.02em] sm:text-2xl">
          <a href={`mailto:${SUPPORT_EMAIL}`} className={TEXT_LINK}>{SUPPORT_EMAIL}</a>
        </p>
        <p className="mt-5 max-w-2xl text-sm leading-[1.8] text-muted-foreground">
          Destek, fatura ve iş birliği soruları için yaz. Türkçe ve İngilizce yanıt veriyoruz.
        </p>
      </Bolum>
    </>
  );
}

/** Bolum: solda yapiskan baslik, sagda icerik — SSS sayfasindaki konu gruplariyla ayni duzen */
function Bolum({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border">
      <div className={`${VITRIN_WRAP} grid gap-8 py-14 lg:grid-cols-12 lg:gap-10 lg:py-20`}>
        <div className="lg:col-span-4">
          <h2 className="text-vitrin-3 lg:sticky lg:top-24">{title}</h2>
        </div>
        <div className="lg:col-span-8">{children}</div>
      </div>
    </section>
  );
}
