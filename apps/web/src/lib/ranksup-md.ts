/**
 * https://ranksup.ai/ranksup.md — sabit adreste, yapay zekâ asistanlari ve ajanlar icin tek
 * sayfalik urun ozeti (ne, kimin icin, planlar + sinirlar + deneme, olculen asistanlar, nasil
 * baslanir). app/ranksup.md/route.ts sunar.
 *
 * NEDEN URETILIYOR: llms.txt / llms-full.txt elle yazilan statik dosyalar; fiyat ya da plan
 * maddesi degisince public-docs.spec.ts kirilir ve elle duzeltilir. Bu ozet ise plan verisini
 * istek aninda /billing/plans'ten (tek kaynak apps/api/src/billing/plans.ts) alir — fiyat
 * sayfasi ve landing ile ayni yol (components/landing/landing-data.ts), elle sayi yazilmaz.
 * Plan verisi alinamazsa fiyat UYDURULMAZ: bolum /pricing'e yonlendirir.
 *
 * Next importu yok — ranksup-md.spec.mts plans.ts'ten kurdugu veriyle dogrudan calistirir.
 *
 * PAKET YAPISI (11.11.2026, api plans.ts): /billing/plans yalniz satistaki planlari doner
 * (Baslangic, Profesyonel, Kurumsal; Ajans satistan kalkti). Kurumsal teklifle satilir: liste
 * fiyati YAZILMAZ ("teklifle"). Baslangic makale uretmez (articlesPerMonth 0 → "yok"). Olculen
 * asistanlar plana baglidir; liste her planin `engines` alanindan (o an olculenler) okunur.
 */
import { CONTENT_AUTHOR, SITE_URL, formatPageDate, pageUpdated } from './page-updated';

/**
 * Bu ozetin KENDI metninin son anlamli degisikligi (YYYY-MM-DD). Ozet metni (ne yapar,
 * kimler icin, nasil baslanir) degisince guncellenir. Gorunur tarih bununla /pricing'in
 * tarihinden (plan maddeleri) hangisi yeniyse odur; plan verisinin alindigi an ayrica yazilir.
 */
export const RANKSUP_MD_UPDATED = '2026-11-11';

/** /billing/plans planinin bu ozette kullanilan alanlari (LandingPlan ile uyumlu) */
export interface SummaryPlan {
  id: string;
  name: string;
  monthly: number;
  annual: number;
  articlesPerMonth: number;
  sites: number | string;
  aiRunsPerMonth: number;
  aiProviders: number;
  support: string;
  features: string[];
  /**
   * Bu planin SU AN olctugu asistanlar (saglayici kimlikleri: plan kapsami ∩ kurulumda
   * olculenler; api billing.service toDefinition). Eski API yanitinda yok.
   */
  engines?: string[];
  inheritsLabel?: string;
  popular?: boolean;
  contactSales?: boolean;
}

/** 1490 → "1.490" (Turkce binlik ayirici; llms.txt ile ayni yazim) */
const tl = (n: number) => n.toLocaleString('tr-TR');

/**
 * Saglayici kimligi → asistan adi. api plans.ts ENGINE_LABELS ile AYNI olmak zorunda
 * (ranksup-md.spec.mts ikisini karsilastirir). Bilinmeyen kimlik oldugu gibi yazilir:
 * yeni bir asistan listeden sessizce dusmesin.
 */
export const ENGINE_NAMES: Readonly<Record<string, string>> = {
  openai: 'ChatGPT',
  gemini: 'Gemini',
  anthropic: 'Claude',
  perplexity: 'Perplexity',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  meta: 'Muse',
};

/**
 * Olculen asistanlar plana baglidir (11.11.2026: deneme ve Baslangic dort, Profesyonel ve
 * ustu alti; Muse yalniz olculuyorsa). Ayni listeyi olcen planlar tek satirda toplanir
 * ("Ücretsiz Deneme, Başlangıç: … (4 asistan)"). Liste her planin `engines` alanindan okunur;
 * ayri bir plan → asistan tablosu tutulmaz. Alan yoksa (eski API) satir yazilmaz.
 */
function assistantGroups(plans: readonly SummaryPlan[]): Array<{ planlar: string[]; adlar: string[] }> {
  const groups: Array<{ key: string; planlar: string[]; adlar: string[] }> = [];
  for (const p of plans) {
    if (!Array.isArray(p.engines) || p.engines.length === 0) continue;
    const key = p.engines.join('|');
    const g = groups.find((x) => x.key === key);
    if (g) g.planlar.push(p.name);
    else groups.push({ key, planlar: [p.name], adlar: p.engines.map((e) => ENGINE_NAMES[e] ?? e) });
  }
  return groups.map(({ planlar, adlar }) => ({ planlar, adlar }));
}

/** Makale uretimi olmayan plan (Baslangic) "0 AI makale" degil "makale üretimi yok" yazar */
const makaleSiniri = (p: SummaryPlan) => (p.articlesPerMonth > 0 ? `${p.articlesPerMonth} AI makale/ay` : 'makale üretimi yok');

function planBlock(p: SummaryPlan): string {
  // Teklifle satilan planin (Kurumsal) liste fiyati musteriye gosterilmez
  const fiyat = p.contactSales
    ? 'teklifle (satış ekibiyle görüşülerek belirlenir)'
    : `$${tl(p.monthly)}/ay, yıllık $${tl(p.annual)}`;
  const sinir = `${makaleSiniri(p)} · ${p.sites} site · en fazla ${tl(p.aiRunsPerMonth)} görünürlük çalıştırması/ay · destek: ${p.support}`;
  const lines = [
    `### ${p.name}${p.popular ? ' (en çok tercih edilen)' : ''}`,
    '',
    `- **Fiyat**: ${fiyat}`,
    `- **Sınırlar**: ${sinir}`,
  ];
  // "Başlangıç'taki her şey, artı:" → "- **Özellikler** (Başlangıç'taki her şey, artı):"
  const miras = p.inheritsLabel ? ` (${p.inheritsLabel.replace(/:\s*$/, '')})` : '';
  lines.push(`- **Özellikler**${miras}:`);
  for (const f of p.features) lines.push(`  - ${f}`);
  return lines.join('\n');
}

/** '2026-10-24T18:30:12.000Z' → '2026-10-24 18:30 UTC' */
const utcDakika = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function buildRanksupMd(plans: readonly SummaryPlan[], fetchedAt: Date = new Date()): string {
  const fiyatTarihi = pageUpdated('/pricing');
  const guncel = RANKSUP_MD_UPDATED > fiyatTarihi ? RANKSUP_MD_UPDATED : fiyatTarihi;
  const trial = plans.find((p) => p.id === 'trial');
  const paid = plans.filter((p) => p.id !== 'trial');
  const asistanGruplari = assistantGroups(plans);
  // Makale uretimi olan en dusuk ucretli plan (liste API sirasiyla: alt plandan uste)
  const makalePlani = paid.find((p) => p.articlesPerMonth > 0);

  const out: string[] = [
    '# RanksUp — Ürün özeti',
    '',
    '> RanksUp; Türkiye\'deki KOBİ\'ler, e-ticaret siteleri, mobil uygulama sahipleri ve dijital ajanslar için SEO, GEO (ChatGPT, Claude, Gemini gibi yapay zekâ asistanlarında görünürlük) ve ASO (App Store / Google Play) platformudur. Site denetimi, AI görünürlük ölçümü, AI makale üretimi ve yayını, uygulama mağazası optimizasyonu ve Apple Search Ads tek panelde.',
    '',
    `Son güncelleme: ${formatPageDate(guncel, 'tr')} · ${CONTENT_AUTHOR.tr}`,
    '',
    `Plan, fiyat ve sınırlar ürünün plan tanımından otomatik üretilir ve en geç 10 dakikada bir yenilenir; ${SITE_URL}/pricing ile aynı kaynaktır. Ayrıntılı ürün bilgisi: ${SITE_URL}/llms-full.txt`,
    '',
    '## Ne yapar',
    '',
    '- **AI görünürlük (GEO)**: İzlediğin soruları yapay zekâ asistanlarına sorar; markan anılıyor mu, siten kaynak gösteriliyor mu, rakiplerin kimler, ölçer.',
    // Sayi yazilmaz (kontrol / ajan / yayin hedefi sayisi): kesin sayilar asagidaki plan
    // maddelerinde, tek kaynak plans.ts.
    '- **Site denetimi**: teknik SEO/GEO kontrolleri ve PageSpeed iyileştirme önerileri; GEO Lab\'de A+ ile F arası GEO notu.',
    '- **AI makale ve yayın**: çok ajanlı üretim hattı ve yayın öncesi QA kapısı; WordPress, FTP/SFTP, cPanel, GitHub, Ghost, Webflow, Sanity gibi yayın hedeflerine otomatik yayın. Makale üretimi her planda yoktur; hangi planlarda olduğu aşağıdaki plan tablosunda.',
    '- **ASO**: App Store ve Google Play için AI metadata önerileri ve günlük mağaza anahtar kelime sıra takibi; üst planlarda Apple Search Ads ve App Store Connect.',
    '',
    '## Kimler için',
    '',
    '- KOBİ\'ler ve küçük işletmeler',
    '- E-ticaret siteleri',
    '- SaaS ve mobil uygulama sahipleri',
    '- Dijital ajanslar, freelancer\'lar ve danışmanlar (çoklu site)',
    '- Blog ve içerik yayıncıları',
    '',
  ];

  if (asistanGruplari.length > 0) {
    out.push(
      '## Ölçülen AI asistanları',
      '',
      'Ölçülen asistanlar plana bağlıdır:',
      '',
      ...asistanGruplari.map((g) => `- ${g.planlar.join(', ')}: ${g.adlar.join(', ')} (${g.adlar.length} asistan)`),
      '',
      'Ölçümü kullanıcı başlatır: her planda hesap başına 7 günde 1 AI görünürlük ölçümü yapılır ve tüm siteler bu hakkı paylaşır. Planlar ölçüm sıklığında değil, aylık görünürlük çalıştırması tavanında ayrışır (AI testi 1, Prompt Lab\'de her soru ve her dal 1 çalıştırma).',
      '',
    );
  }

  out.push('## Planlar ve sınırlar', '');
  if (paid.length === 0) {
    // Plan verisi alinamadi — sayi uydurulmaz
    out.push(`Güncel plan ve fiyatlar: ${SITE_URL}/pricing`, '');
  } else {
    out.push(
      `Plan verisinin alındığı an: ${utcDakika(fetchedAt)}.`,
      '',
      'Fiyatlar USD bazlıdır; TL tutarı sabit değildir, ödeme anında günün TCMB USD/TRY kuruyla hesaplanır. Yıllık ödemede 10 ay fiyatına 12 ay (yaklaşık %17 indirim). Aylık plan istediğin zaman iptal edilir; ödenen dönemin sonuna kadar erişim sürer.',
      '',
      '| Plan | Aylık | Yıllık | AI makale / ay | Site | Görünürlük çalıştırması / ay (en fazla) |',
      '|---|---|---|---|---|---|',
      // Teklifle satilan plan (Kurumsal): fiyat yerine "teklifle"; makale uretimi olmayan plan: "yok"
      ...paid.map((p) => {
        const aylik = p.contactSales ? 'teklifle' : `$${tl(p.monthly)}`;
        const yillik = p.contactSales ? 'teklifle' : `$${tl(p.annual)}`;
        return `| ${p.name} | ${aylik} | ${yillik} | ${p.articlesPerMonth > 0 ? p.articlesPerMonth : 'yok'} | ${p.sites} | ${tl(p.aiRunsPerMonth)} |`;
      }),
      '',
      ...paid.map((p) => `${planBlock(p)}\n`),
    );
  }

  out.push('## Ücretsiz deneme', '');
  if (trial) {
    for (const f of trial.features) out.push(`- ${f}`);
    out.push('- Süre dolunca plan seçene kadar hesap salt okunur olur (satın alma geçici olarak kapalıyken hesap kilitlenmez); veriler silinmez.', '');
  } else {
    out.push(`Deneme koşulları: ${SITE_URL}/pricing`, '');
  }

  out.push(
    '## Nasıl başlanır',
    '',
    `1. ${SITE_URL}/signin?signup=1 adresinde "Google ile devam et" ile hesap aç (web'de kayıt Google hesabıyla; kart istenmez).`,
    '2. Panelde "Site ekle" ile alan adını yaz; kurulum taraması ilk bulguları (site skoru, rakipler, ilk düzeltilecek madde) çıkarır.',
    '3. AI Görünürlük ekranında ilk ölçümü ve önerileri gör; yayın hedefini (WordPress, FTP/SFTP, cPanel…) bağlayıp makale üret.',
    // 11.11.2026: "Devam etmek için plan seç" 3. adimdaki makale uretimine her planla devam
    // edilecegini dusundururdu; makale uretimi olan plan plan verisinden adiyla yazilir.
    makalePlani
      ? `4. Devam etmek için plan seç (makale üretimi ${makalePlani.name} ve üstü planlardadır): ${SITE_URL}/pricing`
      : `4. Devam etmek için plan seç; makale üretiminin hangi planlarda olduğu fiyatlandırma sayfasında: ${SITE_URL}/pricing`,
    '',
    '## Bağlantılar',
    '',
    `- [Fiyatlar](${SITE_URL}/pricing)`,
    `- [SSS](${SITE_URL}/faq)`,
    `- [Hızlı başlangıç](${SITE_URL}/help/getting-started)`,
    `- [Karşılaştırma](${SITE_URL}/compare)`,
    `- [llms.txt](${SITE_URL}/llms.txt) · [llms-full.txt](${SITE_URL}/llms-full.txt)`,
    `- [Ajan kurulum rehberi (MCP)](${SITE_URL}/agent-setup.txt)`,
    '- Destek: destek@luvihost.com',
    '- Profiller: [LinkedIn](https://www.linkedin.com/company/ranksup/) · [Instagram](https://www.instagram.com/ranksupai/)',
    '',
  );
  return out.join('\n');
}
