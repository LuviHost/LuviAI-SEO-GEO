/**
 * /seo-analizi sayfa metinleri (TR + EN). TR sunucuda cizilir ve FAQPage JSON-LD'si TR SSS'ten
 * uretilir (Google'in gordugu surum); EN, dil secimi EN olan ziyaretcinin tarayicisinda gosterilir.
 * Her cumle koda dayanir: api audit/public-seo-analysis.ts ve audit-checks.service.ts
 * (OVERALL_SCORE_WEIGHTS); esikler web.dev (api pagespeed-field.ts CWV_ESIK).
 */
export interface SeoAnaliziIcerik {
  breadcrumb: string;
  rail: string;
  a: string;
  b: string;
  lead: string;
  kontrolBaslik: string;
  kontrolNot: string;
  kontroller: Array<[string, string]>;
  hizBaslik: string;
  hizNot: string;
  hiz: [string, string];
  aiBaslik: string;
  aiNot: string;
  ai: { once: string; test: string; arada: string; rehber: string; son: string };
  sssBaslik: string;
  sssNot: string;
  sss: Array<{ q: string; a: string }>;
}

export const ICERIK: Record<'tr' | 'en', SeoAnaliziIcerik> = {
  tr: {
    breadcrumb: 'Ücretsiz SEO analizi',
    rail: 'Ücretsiz SEO analizi',
    a: 'Sitenizin SEO analizi',
    b: 've site hızı testi',
    lead: 'Alan adınızı yazın: sitenizin ilk 10 sayfasını tarayıp 15 teknik SEO kontrolünü çalıştıralım, mobil hızını ölçelim ve önce neyi düzeltmeniz gerektiğini gösterelim. Ücretsiz, üyelik gerekmez; sonucu e-posta adresinizle açarsınız.',
    kontrolBaslik: 'Neler kontrol ediliyor?',
    kontrolNot: 'Kapsam',
    kontroller: [
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
    ],
    hizBaslik: 'Site hızı testi sonucu nasıl okunur?',
    hizNot: 'Hız',
    hiz: [
      'Google, sayfa deneyimini gerçek kullanıcı verisiyle değerlendirir. Bu yüzden siteniz yeterli trafik alıyorsa Chrome kullanıcılarının son 28 günlük verisini öne alıyoruz: en büyük içeriğin yüklenme süresi (LCP) 2,5 saniyenin, etkileşim gecikmesi (INP) 200 milisaniyenin, sayfa kayması (CLS) 0,1’in altında olmalı.',
      'Gerçek ziyaretçi verisi yoksa yalnızca mobil laboratuvar ölçümünü gösteririz. Bu tek bir ölçümdür, yavaş bir mobil bağlantıyı taklit eder ve aynı site için ölçümden ölçüme değişebilir. Düşük laboratuvar puanı tek başına “site yavaş” demek değildir.',
    ],
    aiBaslik: 'Arama artık yalnız Google sonuçları değil',
    aiNot: 'AI görünürlüğü',
    ai: {
      once: 'Müşterileriniz sorularını ChatGPT, Gemini ve Google’ın AI Modu gibi asistanlara da soruyor. Teknik SEO’nun sağlam olması bu cevaplarda kaynak gösterilmenin ön şartı; ama yeterli değil. Markanızın bu cevaplarda geçip geçmediğini',
      test: ' ücretsiz AI görünürlük testiyle',
      arada: ' ölçebilir,',
      rehber: ' Google AI Modu rehberinde',
      son: ' nasıl çalıştığını okuyabilirsiniz.',
    },
    sssBaslik: 'Sık sorulan sorular',
    sssNot: 'SSS',
    sss: [
      { q: 'SEO analizi ücretsiz mi?', a: 'Evet. Üyelik gerekmez; sonucu görmek için e-posta adresinizi yazmanız istenir. Aynı ağdan 24 saatte en fazla 3 farklı site analiz edilebilir; aynı site 24 saat içinde tekrar yazılırsa kayıtlı sonuç gösterilir.' },
      { q: 'Analiz sitemin kaç sayfasına bakıyor?', a: 'Ana sayfadan başlayarak en fazla 10 sayfa taranır. Sitenin tamamını taramak ve sorunları sayfa sayfa görmek için RanksUp hesabı gerekir.' },
      { q: 'Teknik SEO puanı nasıl hesaplanıyor?', a: 'Puan, 14 kontrolün ağırlıklı ortalamasıdır. En yüksek ağırlık HTTPS’tedir; site haritası, robots.txt, yapısal veri, başlık, açıklama ve Google uygunluğu onu izler. llms.txt puana girmez. Erişim engeli yüzünden ölçülemeyen kontrol 0 sayılmaz, ortalamadan çıkarılır.' },
      { q: 'Site hızı testi neyi ölçüyor?', a: 'Google PageSpeed ile mobil hız ölçülür. Siteniz yeterli trafik alıyorsa Chrome kullanıcılarının son 28 günlük gerçek verisi de gösterilir: en büyük içeriğin yüklenmesi (LCP) 2,5 saniye, etkileşim gecikmesi (INP) 200 milisaniye ve sayfa kayması (CLS) 0,1 altında olmalı. Laboratuvar puanı tek bir ölçümdür; gerçek ziyaretçi verisi daha güvenilirdir.' },
      { q: 'Analiz sitemi yavaşlatır mı?', a: 'Hayır. Tarayıcımız RanksUpBot olarak kendini tanıtır, robots.txt kurallarına uyar ve en fazla 10 sayfa okur.' },
      { q: 'Sonuçta görünen sorunları nasıl düzeltirim?', a: 'Her bulgunun yanında ne yapılması gerektiği yazar. RanksUp’ta site haritası, robots.txt ve llms.txt gibi dosyalar için otomatik düzeltme ve sorunların sayfa sayfa listesi vardır.' },
    ],
  },
  en: {
    breadcrumb: 'Free SEO analysis',
    rail: 'Free SEO analysis',
    a: 'SEO analysis of your site',
    b: 'and site speed test',
    lead: 'Enter your domain: we crawl the first 10 pages of your site, run 15 technical SEO checks, measure its mobile speed and show what to fix first. Free, no sign-up; you open the result with your e-mail address.',
    kontrolBaslik: 'What is checked?',
    kontrolNot: 'Scope',
    kontroller: [
      ['Page titles and meta descriptions', 'Missing, too short or too long titles and descriptions.'],
      ['H1 headings', 'Pages without a heading or sharing the same heading with other pages.'],
      ['Canonical tag', 'Whether the tag that declares the page’s main address exists and is correct.'],
      ['HTTPS and redirects', 'Secure connection, certificate chain and how many hops each spelling of the domain takes to reach the site.'],
      ['Sitemap and robots.txt', 'Whether the files that help Google discover the site exist and can be read.'],
      ['Google and AI Overviews eligibility', 'Whether pages can be indexed and shown with a snippet in search results.'],
      ['Structured data (schema.org)', 'Whether pages carry valid JSON-LD markup.'],
      ['Images', 'Images without alt text, without width and height, and lazy loading.'],
      ['Internal links', 'Whether pages link to each other and whether any page gets no internal links.'],
      ['Social sharing', 'Open Graph and X (Twitter) card tags.'],
      ['Language tags', 'hreflang on sites published in more than one language.'],
      ['Mobile speed', 'Mobile speed score from Google PageSpeed, largest content load time (LCP) and layout shift (CLS); real-visitor data when available.'],
    ],
    hizBaslik: 'How to read the site speed result',
    hizNot: 'Speed',
    hiz: [
      'Google evaluates page experience with real-user data. So if your site gets enough traffic, we lead with the last 28 days of Chrome users’ data: the largest content should load in under 2.5 seconds (LCP), interaction delay should stay under 200 milliseconds (INP) and layout shift under 0.1 (CLS).',
      'Without real-visitor data we show only the mobile lab test. That is a single measurement that simulates a slow mobile connection and can vary from run to run for the same site. A low lab score alone does not mean “the site is slow”.',
    ],
    aiBaslik: 'Search is no longer just Google results',
    aiNot: 'AI visibility',
    ai: {
      once: 'Your customers also ask assistants such as ChatGPT, Gemini and Google’s AI Mode. Solid technical SEO is a precondition for being cited in these answers, but not enough. You can check whether your brand appears with the',
      test: ' free AI visibility test',
      arada: ', and read how it works in the',
      rehber: ' Google AI Mode guide (Turkish)',
      son: '.',
    },
    sssBaslik: 'Frequently asked questions',
    sssNot: 'FAQ',
    sss: [
      { q: 'Is the SEO analysis free?', a: 'Yes. No sign-up is needed; you are asked for your e-mail address to see the result. Up to 3 different sites can be analysed from the same network in 24 hours; if the same site is entered again within 24 hours, the saved result is shown.' },
      { q: 'How many pages of my site does it check?', a: 'Up to 10 pages, starting from the home page. To crawl the whole site and see issues page by page you need a RanksUp account.' },
      { q: 'How is the technical SEO score calculated?', a: 'The score is the weighted average of 14 checks. HTTPS carries the highest weight, followed by sitemap, robots.txt, structured data, title, description and Google eligibility. llms.txt is not scored. A check that cannot be measured because access was blocked does not count as 0; it is left out of the average.' },
      { q: 'What does the site speed test measure?', a: 'Mobile speed is measured with Google PageSpeed. If your site gets enough traffic, the last 28 days of real Chrome-user data are also shown: the largest content should load within 2.5 seconds (LCP), interaction delay should stay under 200 milliseconds (INP) and layout shift under 0.1 (CLS). The lab score is a single measurement; real-visitor data is more reliable.' },
      { q: 'Will the analysis slow my site down?', a: 'No. Our crawler identifies itself as RanksUpBot, follows robots.txt rules and reads at most 10 pages.' },
      { q: 'How do I fix the issues in the result?', a: 'Each finding says what to do. RanksUp offers automatic fixes for files such as sitemap, robots.txt and llms.txt and lists issues page by page.' },
    ],
  },
};
