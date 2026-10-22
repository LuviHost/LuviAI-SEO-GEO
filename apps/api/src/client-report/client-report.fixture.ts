/**
 * Test ve gorsel kontrol fiksturu: bir musteri panelinin (Genel Bakis) bicimini
 * tasir — site skoru 76, 15 bulgu (9 sayfada meta aciklama yok, 24 sayfada H1
 * yok, llms.txt yok, 772 gorselde alt metni yok), AI gorunurluk 17 (ilk olcum),
 * anilma orani / ses payi olculmedi, AI bot 0, yayinda 0, 5 takvimde.
 *
 * Panelden bilinen sayilar disindaki AYRINTILAR (soru metinleri, asistan bazli
 * sonuclar, ornek adresler) ORNEKTIR — gercek olcum degildir. Uretimde
 * kullanilmaz; yalniz spec'ler ve PDF onizleme betigi okur.
 */
import type { RaporGirdisi } from './client-report-build.js';

const URL = 'https://mukellef.co';
const sayfa = (yol: string) => `${URL}${yol}`;

const META_EKSIK = [
  '/hizmetler/sirket-kurulusu', '/hizmetler/e-ticaret-muhasebesi', '/hizmetler/serbest-meslek', '/fiyatlar',
  '/blog/vergi-takvimi-2026', '/blog/kdv-beyannamesi-nasil-verilir', '/blog/sahis-sirketi-mi-limited-mi',
  '/iletisim', '/sss',
].map(sayfa);

const ALT_EKSIK_SAYFALAR = Array.from({ length: 38 }, (_, i) => sayfa(i === 0 ? '/' : `/blog/yazi-${i}`));

function probe(query: string, cited: boolean, brandMentioned: boolean, brandInQuery = false) {
  return { query, cited, brandMentioned, brandInQuery, position: brandMentioned ? 2 : null, sentiment: null, excerpt: 'Yanıt özeti' };
}

const S1 = 'Online muhasebe hizmeti veren firmalar hangileri?';
const S2 = 'Şahıs şirketi kurmak için ne gerekir?';
const S3 = 'E-ticaret yapanlar için muhasebeci önerisi';
const SM = 'Mükellef yorumları nasıl?';

export const MUKELLEF_PROVIDERS = [
  { provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 50, reason: null, probes: [probe(S1, true, true), probe(S2, false, false), probe(S3, false, true), probe(SM, false, true, true)] },
  { provider: 'gemini', label: 'Google Gemini', available: true, score: 50, reason: null, probes: [probe(S1, false, true), probe(S2, false, true), probe(S3, false, true), probe(SM, false, true, true)] },
  { provider: 'anthropic', label: 'Anthropic Claude', available: true, score: 0, reason: null, probes: [probe(S1, false, false), probe(S2, false, false), probe(S3, false, false), probe(SM, false, true, true)] },
  { provider: 'perplexity', label: 'Perplexity', available: true, score: 0, reason: null, probes: [probe(S1, false, false), probe(S2, false, false), probe(S3, false, false), probe(SM, false, false, true)] },
  { provider: 'xai', label: 'xAI Grok', available: true, score: 0, reason: null, probes: [probe(S1, false, false), probe(S2, false, false), probe(S3, false, false), probe(SM, false, false, true)] },
  { provider: 'deepseek', label: 'DeepSeek', available: true, score: 0, reason: null, probes: [probe(S1, false, false), probe(S2, false, false), probe(S3, false, false), probe(SM, false, true, true)] },
  // Yapilandirilmamis asistan: hic sorulmadi — raporda listelenmemeli
  { provider: 'meta', label: 'Meta Llama', available: false, score: null, reason: 'Model yapılandırılmamış', probes: [] },
];

export function mukellefGirdisi(): RaporGirdisi {
  const issue = (severity: string, type: string, checkId: string, description: string) => ({ severity, type, checkId, description, fixable: false });
  return {
    site: { name: 'Mükellef', url: URL },
    audit: {
      ranAt: '2026-10-21T09:12:00.000Z',
      overallScore: 76,
      geoScore: 58,
      checks: {
        sitemap_xml: { id: 'sitemap_xml', name: 'Sitemap XML', found: true, valid: true, score: 100, issues: [], details: { url: sayfa('/sitemap.xml'), totalPages: 48 } },
        robots_txt: {
          id: 'robots_txt', name: 'Robots.txt', found: true, valid: true, score: 100, issues: [],
          details: {
            methodVersion: 2, hasSitemap: true, trainingBlocked: [],
            searchBots: [
              { name: 'OAI-SearchBot', effective: 'allow' }, { name: 'ChatGPT-User', effective: 'allow' },
              { name: 'PerplexityBot', effective: 'allow' }, { name: 'Claude-SearchBot', effective: 'allow' },
            ],
          },
        },
        llms_txt: {
          id: 'llms_txt', name: 'LLMs.txt (AI search)', found: false, valid: false, score: 30,
          issues: [issue('warning', 'llms_missing', 'llms_txt', 'llms.txt yok — düşük maliyetli, opsiyonel bir hijyen adımı: hiçbir büyük AI sağlayıcısı dosyayı kullanacağını taahhüt etmiyor ve Google Search kullanmıyor; olası faydası küçük, zararı yok')],
          details: { methodVersion: 2 },
        },
        schema_markup: {
          id: 'schema_markup', name: 'Schema.org markup', found: true, valid: false, score: 25,
          issues: [issue('warning', 'schema_low_coverage', 'schema_markup', 'Schema markup 12/48 sayfada — kapsama düşük'), issue('info', 'breadcrumb_missing', 'schema_markup', 'BreadcrumbList schema eksik — Google rich result vermiyor')],
          details: { pagesWithSchema: 12, pagesWithArticle: 6, pagesWithBreadcrumb: 0, total: 48 },
        },
        meta_title: {
          id: 'meta_title', name: 'Meta Title', found: true, valid: false, score: 79,
          issues: [issue('warning', 'meta_title_short', 'meta_title', '6 sayfada title 30 karakterden kısa'), issue('info', 'meta_title_long', 'meta_title', '11 sayfada title 60 karakterden uzun (Google kesebilir)')],
          details: { valid: 31, tooShort: 6, tooLong: 11, missing: 0, total: 48, missingPages: [] },
        },
        meta_description: {
          id: 'meta_description', name: 'Meta Description', found: false, valid: false, score: 52,
          issues: [issue('critical', 'meta_desc_missing', 'meta_description', '9 sayfada meta description yok'), issue('warning', 'meta_desc_short', 'meta_description', '14 sayfada meta description 100 karakterden kısa')],
          details: { valid: 25, tooShort: 14, tooLong: 0, missing: 9, total: 48, missingPages: META_EKSIK },
        },
        open_graph: { id: 'open_graph', name: 'Open Graph', found: true, valid: false, score: 63, issues: [issue('warning', 'og_low_coverage', 'open_graph', 'Open Graph 30/48 sayfada — sosyal paylaşım görünümü zayıf')] },
        twitter_card: { id: 'twitter_card', name: 'Twitter Card', found: false, valid: false, score: 0, issues: [issue('info', 'twitter_low_coverage', 'twitter_card', 'Twitter Card 0/48 sayfada')] },
        canonical: { id: 'canonical', name: 'Canonical URL', found: true, valid: false, score: 73, issues: [issue('warning', 'canonical_missing', 'canonical', 'Canonical URL 35/48 sayfada — duplicate content riski')] },
        https: { id: 'https', name: 'HTTPS', found: true, valid: true, score: 100, issues: [] },
        h1_uniqueness: {
          id: 'h1_uniqueness', name: 'H1 Uniqueness', found: true, valid: false, score: 50,
          issues: [issue('critical', 'h1_missing', 'h1_uniqueness', '24 sayfada H1 yok')],
          // Bu tarama missingH1Pages alanindan ONCE yapildi: ornek adres yok
          details: { methodVersion: 2, valid: 24, missing: 24, duplicates: 0, jsShellCount: 0, jsShellPages: [] },
        },
        image_alt: {
          id: 'image_alt', name: 'Image alt text', found: true, valid: false, score: 26,
          issues: [issue('warning', 'image_alt_missing', 'image_alt', '772 görselde alt metni yok (38 sayfada). Google görselin konusunu alt metninden de anlar; görseli anlatan kısa, özgül bir açıklama ekle — anahtar kelime doldurma. Süs görselleri için alt="" doğrudur.')],
          details: {
            methodVersion: 2, totalImages: 1104, contentImages: 1040, withAlt: 241, emptyAlt: 19, absent: 772, ariaDecorative: 8,
            suspicious: 0, excluded: 64, pagesScanned: 48, missingAltPages: ALT_EKSIK_SAYFALAR, suspiciousPages: [], capped: false,
          },
        },
        internal_linking: {
          id: 'internal_linking', name: 'Internal Linking', found: true, valid: false, score: 85,
          issues: [issue('warning', 'orphan_pages', 'internal_linking', '7 orphan sayfa (hiçbir yerden link yok)')],
          details: { methodVersion: 2, orphans: ['/kvkk', '/cerez-politikasi', '/kariyer', '/basin', '/blog/eski-kampanya'].map(sayfa) },
        },
        hreflang: { id: 'hreflang', name: 'Hreflang', found: true, valid: true, score: 100, issues: [], details: { pagesWithHreflang: 0, note: 'Tek dilli site — hreflang gerekmiyor' } },
        pagespeed: { score: 71 },
        geo: {
          score: 58,
          details: { methodVersion: 2 },
          sample: { measured: 5, blocked: 0 },
          methods: [
            { id: 'llms_txt', label: 'llms.txt mevcudiyeti', weight: 15, score: 0 },
            { id: 'structured_data', label: 'JSON-LD schema kapsami', weight: 18, score: 40 },
            { id: 'faq_qa', label: 'FAQ / Soru-cevap formati', weight: 12, score: 12 },
            { id: 'definition', label: 'Tanim yogunlugu (X nedir?)', weight: 12, score: 55 },
            { id: 'heading', label: 'Heading hiyerarsisi (H1>H2>H3)', weight: 10, score: 70 },
            { id: 'og_canonical', label: 'Canonical + OG/Twitter meta', weight: 13, score: 66 },
            { id: 'freshness', label: 'Tarih sinyali (datePublished/Modified)', weight: 10, score: 60 },
            { id: 'citation_format', label: 'Liste/tablo/citation formati', weight: 10, score: 80 },
          ],
        },
        aiCitations: { id: 'ai_citations', name: 'AI arama görünürlüğü', score: 17, providers: MUKELLEF_PROVIDERS, ranAt: '2026-10-21T09:14:00.000Z' },
        crawlCoverage: { blockedPages: [], blockedCount: 0, robotsDisallowedCount: 0, ranksUpBotGroup: false, stoppedEarly: null },
      },
      issues: [
        issue('critical', 'meta_desc_missing', 'meta_description', '9 sayfada meta description yok'),
        issue('critical', 'h1_missing', 'h1_uniqueness', '24 sayfada H1 yok'),
        issue('warning', 'llms_missing', 'llms_txt', 'llms.txt yok — düşük maliyetli, opsiyonel bir hijyen adımı: hiçbir büyük AI sağlayıcısı dosyayı kullanacağını taahhüt etmiyor ve Google Search kullanmıyor; olası faydası küçük, zararı yok'),
        issue('warning', 'image_alt_missing', 'image_alt', '772 görselde alt metni yok (38 sayfada). Google görselin konusunu alt metninden de anlar; görseli anlatan kısa, özgül bir açıklama ekle — anahtar kelime doldurma. Süs görselleri için alt="" doğrudur.'),
        issue('warning', 'meta_desc_short', 'meta_description', '14 sayfada meta description 100 karakterden kısa'),
        issue('warning', 'meta_title_short', 'meta_title', '6 sayfada title 30 karakterden kısa'),
        issue('info', 'meta_title_long', 'meta_title', '11 sayfada title 60 karakterden uzun (Google kesebilir)'),
        issue('warning', 'schema_low_coverage', 'schema_markup', 'Schema markup 12/48 sayfada — kapsama düşük'),
        issue('info', 'breadcrumb_missing', 'schema_markup', 'BreadcrumbList schema eksik — Google rich result vermiyor'),
        issue('warning', 'og_low_coverage', 'open_graph', 'Open Graph 30/48 sayfada — sosyal paylaşım görünümü zayıf'),
        issue('warning', 'canonical_missing', 'canonical', 'Canonical URL 35/48 sayfada — duplicate content riski'),
        issue('info', 'twitter_low_coverage', 'twitter_card', 'Twitter Card 0/48 sayfada'),
        issue('warning', 'orphan_pages', 'internal_linking', '7 orphan sayfa (hiçbir yerden link yok)'),
        issue('warning', 'faq_missing', 'geo_faq', 'FAQ schema ve soru-cevap formatı eksik (GEO ağırlığı 12) — jsonld_faq snippet üretici hazır. (mevcut skor 12/100)'),
        issue('warning', 'pagespeed_render-blocking-resources', 'pagespeed', 'Oluşturmayı engelleyen kaynakları kaldırın — 1.2s tasarruf'),
      ],
      accessBlocked: null,
    },
    erisimEngeli: null,
    aiManset: { score: 17, method: 'first-run' },
    aiKosum: { runAt: '2026-10-21T09:14:00.000Z', providers: MUKELLEF_PROVIDERS },
    kpi: { mentionRate: null, shareOfVoice: null, unbrandedCount: 0 },
    botlar: { takipVar: true, son7: 0, son30: 0, botlar: [] },
    icerik: { yayinda: 0, takvimde: 5 },
    aksiyonPlani: [],
    rakipler: { tanimli: [], sesPayi: [] },
    gorselDuzeltilen: 0,
    ajanHazirligi: null,
  };
}

/** Hic veri olmayan yeni site — "uydurma yok" testleri icin */
export function bosGirdi(): RaporGirdisi {
  return {
    site: { name: 'Yeni Site', url: 'https://yeni-site.com.tr' },
    audit: null,
    erisimEngeli: null,
    aiManset: null,
    aiKosum: null,
    kpi: null,
    botlar: { takipVar: false, son7: 0, son30: 0, botlar: [] },
    icerik: { yayinda: 0, takvimde: 0 },
    aksiyonPlani: [],
    rakipler: { tanimli: [], sesPayi: [] },
    gorselDuzeltilen: null,
    ajanHazirligi: null,
  };
}
