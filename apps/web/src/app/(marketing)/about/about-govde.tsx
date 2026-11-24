'use client';

import { Check } from 'lucide-react';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { VITRIN_WRAP } from '@/lib/vitrin';
import { useT } from '@/lib/i18n';

const SUPPORT_EMAIL = 'destek@luvihost.com';

/**
 * /about gorunur govdesi. TR metinler onceki surumle ayni (iddialar kodla dogrulanmisti);
 * EN 25.11.2026'da eklendi (sahip: "ingilizce sitede ceviriler eksik"). Sunucuda TR cizilir,
 * dil secimi EN ise tarayicida EN gosterilir (lib/i18n useT).
 * "Neden variz" bolumundeki ORNEK sorgular olcum ya da istatistik degil; arama kutusuna yazilan
 * kelimelerle asistana sorulan cumle arasindaki farki gosterir.
 */
const COPY = {
  tr: {
    breadcrumb: 'Hakkımızda', rail: 'Hakkımızda', h1a: 'Türkiye için yapılmış', h1b: 'AI SaaS.',
    lead: 'RanksUp; KOBİ, e-ticaret ve dijital ajansların GEO, SEO, içerik üretimi, ASO ve Apple Search Ads denetimini tek panelden, otomatik olarak yönetebilmesi için kurulan Türkiye merkezli bir platformdur.',
    nedenBaslik: 'Neden varız',
    nedenGiris: 'Müşteriler artık Google\'ın yanında ChatGPT, Gemini ve Claude\'a da soruyor. Arama kutusuna yazılan birkaç kelimenin yerini, asistana sorulan tam cümleler alıyor.',
    aramaEtiket: 'Arama kutusuna yazılan', asistanEtiket: 'Asistana sorulan',
    arama: ['ön muhasebe programı', 'ön muhasebe programı fiyatları', 'en iyi ön muhasebe programı'],
    asistan: ['Küçük bir işletme için hangi ön muhasebe programını önerirsin?', 'E-fatura kesebildiğim, kurulumu kolay bir program var mı?', 'Bu iki programı karşılaştırır mısın?'],
    ornek: 'Sorgular örnektir.',
    nedenSon: 'Cevapta adın geçmiyorsa, soruyu soran seni o cevapta görmez. RanksUp bu cevaplarda adının geçip geçmediğini ölçer ve eksik kaldığın sorular için içerik hazırlar.',
    misyonBaslik: 'Misyonumuz',
    misyon: 'Saatlerce uğraşan SEO uzmanı, içerik yazarı, ASO uzmanı ve Apple Search Ads danışmanına ihtiyaç duymadan; küçük işletmelerin ve dijital ajansların yapay zeka destekli, kalite ve marka tutarlılığı taviz vermeyen büyüme araçlarına erişebilmesini sağlamak.',
    hikayeBaslik: 'Hikayemiz',
    hikaye1: ['RanksUp, 2018\'den beri Türkiye\'de hosting ve domain hizmeti veren ', ' grubunun bünyesinde 2026\'da kuruldu. Müşterilerimizin "site açtım ama ne içerik üreteceğim?" sorusu bizi bu platformu inşa etmeye yönlendirdi.'],
    hikaye2: 'Yapay zekanın içerik üretiminde sıradan, klişe ve marka kimliği zayıf çıktılar verdiğini gördük. Bu sorunları çözmek için 5 ajanlı üretim hattını, yayın öncesi kalite kapısını ve her site için ayrı marka beynini kurduk.',
    guvenBaslik: 'Neden bize güvenebilirsin',
    guven: [
      ['Türkiye merkezli ve yerel', 'Sunucular LuviHost İstanbul veri merkezinde, yedekler Frankfurt bölgesinde. Bağlantı bilgileri AES-256-GCM ile şifrelenir.'],
      ['PayTR güvenli ödeme', "Türkiye'nin TCMB lisanslı ödeme sağlayıcısı. Aylık iptal hakkı, taahhüt yok."],
      ['Güçlü modeller', 'Makaleler Anthropic Claude ile yazılır, görseller Google Gemini ile üretilir; AI görünürlük ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’te ölçülür.'],
      ['Kalite kapısı', 'Her makale yayına çıkmadan AI editör ajanından ve kalite kapısından geçer: klişeler temizlenir, kaynaksız sayılar ve uydurma iç bağlantılar yakalanır. Yine de yayından önce gözden geçirmeni öneririz.'],
      ['14 gün ücretsiz deneme', 'Kart bilgisi gerekmez; siteni bağlar, markanın AI cevaplarındaki yerini ölçersin, beğenmezsen ödeme yapmazsın. Önce dene, sonra karar ver.'],
    ] as Array<[string, string]>,
    ilkeBaslik: 'İlkelerimiz',
    ilkeler: [
      { title: 'Türkçe öncelikli', body: 'Çoğu AI içerik aracı İngilizce için yapılır, sonra Türkçe\'ye uydurulur. Biz Türkçe ile başlayıp İngilizce\'yi ekliyoruz — gramer, ton ve sektör jargonu tutarlı.' },
      { title: 'KOBİ-dostu', body: 'Saatler süren manuel SEO denetimi, içerik briefi yazma ve AI görünürlük takibi gibi işleri dakikalara indirir. Ekibinde uzman olmasa bile işin büyük kısmını panelden yürütürsün.' },
      { title: 'Otomatik akış', body: 'Marka beyni + Search Console + rakip ve persona analizi → konu önerileri → otomatik üretim ve yayın → Search Console verisinde zayıf kalan yazıyı yayından ve son güncellemesinden en az 60 gün sonra yeniden yazma.' },
      { title: 'AI search\'e hazır', body: 'ChatGPT, Claude, Gemini, Perplexity gibi AI asistanları cevap üretirken senin sitendeki içeriği kaynak göstersin diye GEO (Generative Engine Optimization) yapıyoruz.' },
    ],
    iletisimBaslik: 'İletişim',
    iletisim: 'Destek, fatura ve iş birliği soruları için yaz. Türkçe ve İngilizce yanıt veriyoruz.',
  },
  en: {
    breadcrumb: 'About', rail: 'About', h1a: 'AI SaaS built', h1b: 'for Türkiye.',
    lead: 'RanksUp is a Türkiye-based platform that lets SMBs, e-commerce businesses and digital agencies run GEO, SEO, content production, ASO and Apple Search Ads from one panel, automatically.',
    nedenBaslik: 'Why we exist',
    nedenGiris: 'Customers now ask ChatGPT, Gemini and Claude as well as Google. Full sentences asked to an assistant are replacing the few words typed into a search box.',
    aramaEtiket: 'Typed into a search box', asistanEtiket: 'Asked to an assistant',
    arama: ['accounting software', 'accounting software prices', 'best accounting software'],
    asistan: ['Which accounting software would you recommend for a small business?', 'Is there an easy-to-set-up program that can issue e-invoices?', 'Can you compare these two programs?'],
    ornek: 'Example queries.',
    nedenSon: 'If your name is not in the answer, the person asking does not see you in it. RanksUp measures whether your name appears in these answers and prepares content for the questions where you are missing.',
    misyonBaslik: 'Our mission',
    misyon: 'To give small businesses and digital agencies access to AI-powered growth tools that do not compromise on quality or brand consistency, without needing an SEO specialist, content writer, ASO specialist and Apple Search Ads consultant working for hours.',
    hikayeBaslik: 'Our story',
    hikaye1: ['RanksUp was founded in 2026 within the ', ' group, which has provided hosting and domain services in Türkiye since 2018. Our customers’ question, "I launched a site, but what content should I produce?", led us to build this platform.'],
    hikaye2: 'We saw that AI produced ordinary, clichéd content with a weak brand identity. To solve this we built a 5-agent production pipeline, a pre-publish quality gate and a separate brand brain for every site.',
    guvenBaslik: 'Why you can trust us',
    guven: [
      ['Based and hosted in Türkiye', 'Servers are in the LuviHost Istanbul data centre, backups in the Frankfurt region. Connection credentials are encrypted with AES-256-GCM.'],
      ['Secure payment with PayTR', 'A payment provider licensed by the Central Bank of the Republic of Türkiye. Cancel monthly, no commitment.'],
      ['Strong models', 'Articles are written with Anthropic Claude and images are generated with Google Gemini; AI visibility is measured in ChatGPT, Claude, Gemini, Perplexity, Grok and DeepSeek.'],
      ['Quality gate', 'Every article passes an AI editor agent and a quality gate before publishing: clichés are removed, unsourced numbers and made-up internal links are caught. We still recommend reviewing before you publish.'],
      ['14-day free trial', 'No card needed; connect your site, measure where your brand stands in AI answers, and pay nothing if you don’t like it. Try first, decide later.'],
    ] as Array<[string, string]>,
    ilkeBaslik: 'Our principles',
    ilkeler: [
      { title: 'Turkish first', body: 'Most AI content tools are built for English and then adapted to Turkish. We start with Turkish and add English, so grammar, tone and industry jargon stay consistent.' },
      { title: 'SMB-friendly', body: 'Work such as hours of manual SEO audits, writing content briefs and tracking AI visibility shrinks to minutes. Even without a specialist on the team, you run most of it from the panel.' },
      { title: 'Automated flow', body: 'Brand brain + Search Console + competitor and persona analysis → topic suggestions → automatic production and publishing → rewriting posts that stay weak in Search Console data at least 60 days after publishing and their last update.' },
      { title: 'Ready for AI search', body: 'We do GEO (Generative Engine Optimization) so that AI assistants such as ChatGPT, Claude, Gemini and Perplexity cite the content on your site when they answer.' },
    ],
    iletisimBaslik: 'Contact',
    iletisim: 'Write to us about support, billing or partnerships. We reply in Turkish and English.',
  },
};

const TEXT_LINK = 'border-b border-white/30 pb-0.5 text-foreground transition-colors duration-200 hover:border-brand-vivid hover:text-brand-vivid';

export function AboutGovde() {
  const { locale } = useT();
  const c = COPY[locale === 'en' ? 'en' : 'tr'];
  return (
    <>
      <section>
        <div className={`${VITRIN_WRAP} pb-16 pt-6 lg:pb-24 lg:pt-10`}>
          <Breadcrumbs items={[{ label: c.breadcrumb }]} />
          <p className="v-rail mb-10 mt-8 flex items-center gap-2.5 sm:mb-14 lg:mt-12">
            <span className="h-1.5 w-1.5 shrink-0 bg-brand-vivid" aria-hidden />
            {c.rail}
          </p>
          <h1 className="text-vitrin-1">
            <span className="block">{c.h1a}</span>{' '}
            <span className="block text-dim">{c.h1b}</span>
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-[1.75] text-muted-foreground">{c.lead}</p>
        </div>
      </section>

      <Bolum title={c.nedenBaslik}>
        <p className="max-w-2xl text-xl leading-snug tracking-[-0.02em] sm:text-2xl">{c.nedenGiris}</p>
        <div className="mt-10 grid border-l border-t border-border sm:grid-cols-2">
          <div className="border-b border-r border-border p-6 sm:p-7">
            <p className="v-rail">{c.aramaEtiket}</p>
            <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
              {c.arama.map((q) => <li key={q}>“{q}”</li>)}
            </ul>
          </div>
          <div className="relative border-b border-r border-border bg-card p-6 sm:p-7">
            <span className="absolute inset-x-0 top-0 h-0.5 bg-brand-vivid" aria-hidden />
            <p className="font-mono text-vitrin-rail text-brand-vivid">{c.asistanEtiket}</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {c.asistan.map((q) => <li key={q}>“{q}”</li>)}
            </ul>
          </div>
        </div>
        <p className="v-rail mt-4">{c.ornek}</p>
        <p className="mt-8 max-w-2xl text-sm leading-[1.8] text-muted-foreground">{c.nedenSon}</p>
      </Bolum>

      <Bolum title={c.misyonBaslik}>
        <p className="max-w-2xl text-xl leading-snug tracking-[-0.02em] sm:text-2xl">{c.misyon}</p>
      </Bolum>

      <Bolum title={c.hikayeBaslik}>
        <div className="max-w-2xl space-y-5 text-base leading-[1.75] text-muted-foreground">
          <p>
            {c.hikaye1[0]}<a href="https://luvihost.com" className={TEXT_LINK}>LuviHost</a>{c.hikaye1[1]}
          </p>
          <p>{c.hikaye2}</p>
        </div>
      </Bolum>

      <Bolum title={c.guvenBaslik}>
        <ul className="border-t border-border">
          {c.guven.map(([label, desc]) => (
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

      <Bolum title={c.ilkeBaslik}>
        <div className="grid border-l border-t border-border sm:grid-cols-2">
          {c.ilkeler.map(({ title, body }) => (
            <div key={title} className="border-b border-r border-border p-6 sm:p-7">
              <h3 className="text-base font-medium">{title}</h3>
              <p className="mt-3 text-sm leading-[1.8] text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Bolum>

      <Bolum title={c.iletisimBaslik}>
        <p className="text-xl tracking-[-0.02em] sm:text-2xl">
          <a href={`mailto:${SUPPORT_EMAIL}`} className={TEXT_LINK}>{SUPPORT_EMAIL}</a>
        </p>
        <p className="mt-5 max-w-2xl text-sm leading-[1.8] text-muted-foreground">{c.iletisim}</p>
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
