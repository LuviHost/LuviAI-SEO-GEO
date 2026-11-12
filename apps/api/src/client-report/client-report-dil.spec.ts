import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditChecksService, type CheckResult } from '../audit/audit-checks.service.js';
import { computeRobotsCheck } from '../audit/robots-check.js';
import { buildClientReport, type RaporGirdisi } from './client-report-build.js';
import { bosGirdi, mukellefGirdisi } from './client-report.fixture.js';
import { BILGI_NOTLARI, BULGU_METINLERI } from './client-report-texts.js';
import type { MusteriRaporu, RaporSeo } from './client-report.types.js';

/**
 * Musteri raporunun DILI, ONCELIGI ve yanlis "gecti"leri.
 *
 * NEDEN VAR: labenko.com raporu (12.11.2026) musteriye gonderilecek halde
 * degildi — bulgulari dogruydu ama:
 *  - taramanin PANEL icin yazilmis metinleri rapora aynen basiliyordu: "sen"
 *    ile "siz" karisiyor ("crawler kontrolü yapamıyorsun" / "yayınlayın"),
 *    ic notlar gorunuyordu ("GEO ağırlığı 6", "mevcut skor 0/100",
 *    "duplicate content riski", "snippet üretici hazır");
 *  - iki sayfalik sitede robots.txt ve site haritasi "kritik" ilk iki isti;
 *  - iki dilli, hreflang'siz site "Hreflang: geçti" aliyordu;
 *  - "15 soru" yaziyordu (5 soru × 3 tekrar) ve asistan satiri "7 kaynak"
 *    derken soru tablosu yalniz ILK yanita bakip 2 isaret gosteriyordu;
 *  - skora girmeyen llms.txt "Uyarı · 30/100" satiri aliyordu.
 */

const NOW = new Date('2026-11-12T15:00:00.000Z');
const HAM = '§HAM§';

const sayfa = (url: string, over: Record<string, unknown> = {}) => ({
  url, title: 'Yeterince uzun bir sayfa basligi burada', metaDescription: 'x'.repeat(120), h1: `H1 ${url}`, h2s: [], textSample: '',
  ogTags: {}, twitterTags: {}, canonical: null, hreflangs: [], jsonLdBlocks: [], schemaTypes: [],
  lang: null, imageAltStats: { total: 0, withAlt: 0, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0 },
  images: [], imagesCapped: false, outboundLinks: [], ...over,
}) as any;

/** Taramanin uretebildigi sorunlarin cogunu birden tasiyan site */
const KIRLI_SAYFALAR = [
  sayfa('https://kirli.com', {
    title: '', metaDescription: '', h1: '', outboundLinks: ['https://kirli.com/EN', 'https://kirli.com/a'],
    imageAltStats: { total: 7, withAlt: 1, emptyAlt: 0, absent: 5, ariaDecorative: 0, suspicious: 1, excluded: 0 },
  }),
  sayfa('https://kirli.com/EN', { title: 'Kisa', metaDescription: 'kisa', h1: 'Ayni baslik' }),
  sayfa('https://kirli.com/a', { title: 'Bu baslik altmis karakterden uzun olsun diye bilerek uzatilmis bir sayfa basligidir', h1: 'Ayni baslik' }),
  sayfa('https://kirli.com/yetim', { jsShell: true }),
];

/** Gercek kontrol ciktisi; her sorunun metnine iz (HAM) eklenir — rapora dusen ham metin yakalansin */
async function kontroller(robotsTxt: string | null, over: Record<string, unknown> = {}): Promise<CheckResult[]> {
  const sonuc = await new AuditChecksService().runAllChecks({
    baseUrl: 'https://kirli.com', pages: KIRLI_SAYFALAR, sitemapUrl: null, robotsTxt, llmsTxt: null, totalPages: 4, tlsChainIncomplete: true, ...over,
  } as any);
  for (const c of sonuc) for (const i of c.issues) i.description = `${i.description} ${HAM}`;
  return sonuc;
}

const GEO_SORUNLARI = [
  ['faq_missing', 'geo_faq', 'Sayfalarda görünür soru-cevap bölümü yok ya da çok az (GEO ağırlığı 6). Soru-cevapları sayfaya görünür metin olarak ekle; snippet aracı taslak üretir, FAQPage işaretlemesi tek başına puanı artırmaz. (mevcut skor 0/100)'],
  ['definition_missing', 'geo_definition', 'Tanım yoğunluğu düşük ("X nedir?" tarzı içerik yok) — jsonld_defined_term snippet üretici hazır. (mevcut skor 5/100)'],
  ['citation_format_missing', 'geo_citation_format', 'Liste/tablo formatı eksik — AI motorları madde işaretli özetleri atıf olarak tercih eder. (mevcut skor 10/100)'],
  ['freshness_missing', 'geo_freshness', 'datePublished / dateModified sinyali eksik — Article schema basıldığında otomatik çözülür. (mevcut skor 0/100)'],
  ['evidence_missing', 'geo_evidence', 'İçerik sayfalarında kanıt blokları zayıf: kaynaklı rakam/istatistik, karşılaştırma tablosu ya da adım listesi yok. (mevcut skor 8/100)'],
  ['thin_content_geo', 'geo_depth', 'İçerik sayfaları ince: az kelime ve az alt başlık. (mevcut skor 12/100)'],
] as const;

function girdi(checks: CheckResult[], ekSorunlar: Array<Record<string, unknown>> = []): RaporGirdisi {
  const sorunlar = checks.flatMap((c) => c.issues.map((i) => ({ ...i, checkId: c.id })));
  return {
    ...bosGirdi(),
    site: { name: 'Kirli', url: 'https://kirli.com' },
    audit: {
      ranAt: '2026-11-12T14:00:00.000Z',
      overallScore: 21,
      geoScore: 9,
      checks: {
        ...Object.fromEntries(checks.map((c) => [c.id, c])),
        geo: {
          score: 9,
          methods: [
            { id: 'faq_qa', score: 0 }, { id: 'definition', score: 5 }, { id: 'citation_format', score: 10 },
            { id: 'freshness', score: 0 }, { id: 'evidence', score: 8 }, { id: 'depth', score: 12 },
          ],
        },
      },
      issues: [...sorunlar, ...ekSorunlar],
      accessBlocked: null,
    },
  };
}

const geoVeDiger = [
  ...GEO_SORUNLARI.map(([type, checkId, description]) => ({ severity: 'warning', type, checkId, description: `${description} ${HAM}`, fixable: true })),
  { severity: 'warning', type: 'pagespeed_unused-javascript', checkId: 'pagespeed', description: `Reduce unused JavaScript — 1.2s tasarruf ${HAM}`, fixable: false },
  { severity: 'warning', type: 'pagespeed_render-blocking-resources', checkId: 'pagespeed', description: `Eliminate render-blocking resources — 2.4s tasarruf ${HAM}`, fixable: false },
  { severity: 'warning', type: 'ai_citation_low', checkId: 'ai_citation', description: `AI arama görünürlüğü düşük (4/100): siten nadiren kaynak gösteriliyor; emin ol. ${HAM}`, fixable: true },
  { severity: 'info', type: 'crawl_pages_blocked', checkId: 'crawl_access', description: `2 sayfa erişim engeli nedeniyle taranamadı ${HAM}`, fixable: false },
];

const seoOf = (r: MusteriRaporu): RaporSeo => {
  if (r.seo.olculemedi) throw new Error('seo olculmeli');
  return r.seo;
};

/** Panel dili ve ic not parcalari — musteri raporunda gecemez */
const YASAK = [
  'yapamıyorsun', 'istersen', 'karar senin', 'gösterilemezsin', 'yayınlayabilirsin', 'siten ', 'emin ol.', 'emin ol;',
  'crawler', 'duplicate content', 'GEO ağırlığı', 'mevcut skor', 'snippet', 'orphan', 'rich result', 'Schema markup',
  'kapsama düşük', 'Article schema', 'jsonld_', 'title tag', '<title> tag', 'meta description', 'damgası vurar',
  'Reduce unused', 'Eliminate render', 'adresi kaydetmiyor',
];
/** Tekil ("sen") emir kipi: "ekle", "kaldır" … — rapor "ekleyin", "kaldırın" der */
const SEN_EMRI = /(?<!\p{L})(ekle|kaldır|ayarla|yayınla|yükle|kontrol et|emin ol)(?!\p{L})/u;

/** Kimlik ve veri alanlari (sorun tipi, bot adi, adres, soru metni) — okura yazilmis metin degil */
const VERI_ALANLARI = new Set(['tur', 'id', 'anahtar', 'saglayici', 'url', 'host', 'soru', 'ornekler', 'egitimBotuEngelli', 'aramaBotlari', 'botlar']);

/** Raporda OKURA yazilmis butun metinler, tek dize */
function okurMetni(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(okurMetni).join('\n');
  if (v && typeof v === 'object') {
    return Object.entries(v).filter(([k]) => !VERI_ALANLARI.has(k)).map(([, x]) => okurMetni(x)).join('\n');
  }
  return '';
}

/** Rapor: ham tarama metni hicbir alanda yok; okur metninde panel dili / ic not / "sen" emri yok */
function dilTemiz(r: MusteriRaporu): void {
  expect(JSON.stringify(r)).not.toContain(HAM);
  const metin = okurMetni(r);
  for (const y of YASAK) expect(metin, `yasak parca: ${y}`).not.toContain(y);
  expect(metin).not.toMatch(SEN_EMRI);
}

describe('rapora ham tarama metni girmez', () => {
  it('taramanin uretebildigi HER sorun tipinin raporda kendi cumlesi var', () => {
    const kok = join(__dirname, '..', 'audit');
    const tipler = new Set<string>();
    for (const dosya of ['audit.service.ts', 'audit-checks.service.ts', 'robots-check.ts', 'image-alt-check.ts']) {
      const kaynak = readFileSync(join(kok, dosya), 'utf8');
      for (const m of kaynak.matchAll(/type: '([a-z0-9_]+)'/g)) tipler.add(m[1]);
    }
    // Kendi metin fonksiyonu olan (AI gorunurluk) ve kontrol satirina / aksiyona donusmeyen (kapsam notu) tipler
    const MUAF = new Set(['ai_citation_low', 'crawl_pages_blocked']);
    expect(tipler.size).toBeGreaterThanOrEqual(30);
    const eksik = [...tipler].filter((t) => !MUAF.has(t) && !Object.hasOwn(BULGU_METINLERI, t));
    // Yeni bir sorun tipi eklendiyse client-report-texts.ts BULGU_METINLERI'ne musteri diliyle cumlesi yazilmali
    expect(eksik).toEqual([]);
  });

  it('dosyasi olmayan, zinciri eksik, iki dilli site: raporda ham metin, panel dili ya da ic not yok', async () => {
    const r = buildClientReport(girdi(await kontroller(null), geoVeDiger), NOW);
    dilTemiz(r);
    // Metin sessizce kaybolmadi: sorunlu her kontrolun bulgusu, her aksiyonun aciklamasi var
    const seo = seoOf(r);
    for (const k of seo.kontroller.filter((x) => x.durum === 'kritik' || x.durum === 'uyari')) {
      expect(k.bulgu, k.id).toBeTruthy();
    }
    for (const a of r.aksiyonlar) expect(a.aciklama, a.baslik).toBeTruthy();
    for (const s of seo.sayfaSorunlari) expect(s.aciklama, s.tur).toBeTruthy();
  });

  it('robots.txt botlari engelliyorsa: ayni kural; bot adlari ve ne yapilacagi details alanindan kurulur', async () => {
    const robots = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /';
    const r = buildClientReport(girdi(await kontroller(robots)), NOW);
    dilTemiz(r);
    const k = seoOf(r).kontroller.find((x) => x.id === 'robots_txt')!;
    expect(k.durum).toBe('kritik');
    expect(k.bulgu).toContain('Googlebot');
    expect(k.bulgu).toContain('Bingbot');
    // Googlebot kendi grubunda engelli → o satir kaldirilir; Bingbot "*" ile engelli → ayri grup
    expect(k.oneri).toContain('Googlebot için ayrılmış "User-agent" grubundaki "Disallow: /" satırını kaldırın');
    expect(k.oneri).toContain('Bingbot adıyla anılmadığı için');
    // Bot engeli otomatik duzeltilmez: "RanksUp düzeltebilir" rozeti cikmaz
    expect(k.otomatik).toBe(false);
    expect(r.aksiyonlar.find((a) => a.baslik === 'Arama motoru botlarının robots.txt engelini kaldırın')).toMatchObject({ etki: 'yuksek' });
  });

  it('bilinmeyen (ileride eklenen) sorun tipi rapora METINSIZ girer — panel dili sizmaz', () => {
    const g = mukellefGirdisi();
    const yeni = { severity: 'warning', type: 'yeni_bir_tip', checkId: 'canonical', description: `bunu duzelt, siten zarar goruyor ${HAM}`, fixable: false };
    (g.audit!.checks as any).canonical.issues = [yeni];
    g.audit!.issues = [yeni];
    const r = buildClientReport(g, NOW);
    expect(JSON.stringify(r)).not.toContain(HAM);
    const k = seoOf(r).kontroller.find((x) => x.id === 'canonical')!;
    expect(k).toMatchObject({ durum: 'uyari', bulgu: null });
    expect(k.neden.length).toBeGreaterThan(20);
  });

  it('sayfa hizi aksiyonu Lighthouse basligini basmaz; firsat sayisi ve en buyuk kazanc yazar', async () => {
    const r = buildClientReport(girdi(await kontroller(null), geoVeDiger), NOW);
    const hiz = r.aksiyonlar.find((a) => a.baslik === 'Sayfa hızını iyileştirin');
    // 10 aksiyon sinirinda yer bulamayabilir; metin kurali ayrica denenir
    if (hiz) expect(hiz.aciklama).toBe('PageSpeed ölçümü, sayfaların yüklenmesini hızlandırabilecek 2 iyileştirme alanı buldu; en büyük tahmini kazanç 2,4 saniye.');
    const g = mukellefGirdisi();
    const r2 = buildClientReport(g, NOW);
    expect(r2.aksiyonlar.find((a) => a.baslik === 'Sayfa hızını iyileştirin')!.aciklama)
      .toBe('PageSpeed ölçümü, sayfaların yüklenmesini hızlandırabilecek 1 iyileştirme alanı buldu; en büyük tahmini kazanç 1,2 saniye.');
  });

  it('GEO sinyali bulgusu skoru taramanin sinyal listesinden alir', async () => {
    const g = girdi(await kontroller(null), geoVeDiger);
    // Yalniz GEO sorunlari kalsin ki 10 aksiyon sinirina takilmasin
    g.audit!.issues = geoVeDiger.slice(0, 6);
    const r = buildClientReport(g, NOW);
    const sss = r.aksiyonlar.find((a) => a.baslik.startsWith('Okurların sorduğu soruları'))!;
    expect(sss.aciklama).toBe('Sayfalarda görünür soru-cevap bölümü yok ya da çok az. Bu sinyalin skoru 0/100.');
    const tarih = r.aksiyonlar.find((a) => a.baslik === 'Sayfalara yayın ve güncelleme tarihi ekleyin')!;
    expect(tarih.aciklama).toBe('Sayfalarda yayın ya da güncelleme tarihi bilgisi bulunamadı. Bu sinyalin skoru 0/100.');
  });
});

describe('oncelik: robots.txt ve site haritasi yoklugu "kritik" ilk is degil', () => {
  /** Eski tarama kaydi: iki tip hala "critical" */
  async function eskiTarama(): Promise<RaporGirdisi> {
    const checks = await kontroller(null);
    for (const c of checks) {
      for (const i of c.issues) if (i.type === 'robots_missing' || i.type === 'sitemap_missing') i.severity = 'critical';
    }
    return girdi(checks);
  }

  it('eski taramanin "critical" kaydi raporda uyari; bulgu sayaci ve aksiyon etkisi ayni listeden', async () => {
    const r = buildClientReport(await eskiTarama(), NOW);
    const seo = seoOf(r);
    const robots = seo.kontroller.find((k) => k.id === 'robots_txt')!;
    const harita = seo.kontroller.find((k) => k.id === 'sitemap_xml')!;
    expect(robots.durum).toBe('uyari');
    expect(harita.durum).toBe('uyari');
    // Dosya yokken botlar serbest: bulgu bunu soyler, oneri "duzenleyin" degil "yukleyin"
    expect(robots.bulgu).toContain('kısıtlama olmadan tarar');
    expect(robots.oneri).toBe('Site köküne, site haritasının adresini bildiren bir robots.txt dosyası yükleyin.');
    expect(robots.otomatik).toBe(true);
    // Kritik sayisi: basliksiz sayfa, meta aciklamasiz sayfa, H1'siz sayfa — robots ve site haritasi degil
    const kritikTipler = (r.seo.olculemedi ? [] : seo.kontroller.filter((k) => k.durum === 'kritik').map((k) => k.id)).sort();
    expect(kritikTipler).toEqual(['h1_uniqueness', 'meta_description', 'meta_title']);
    expect(seo.bulgu.kritik).toBe(3);
  });

  it('aksiyon sirasi: yuksek etkili icerik isleri once; robots.txt dusuk etki ve sonda', async () => {
    const g = await eskiTarama();
    // 10 aksiyon sinirina takilmasin: labenko raporundaki ilk isler
    const TIPLER = new Set(['robots_missing', 'sitemap_missing', 'meta_desc_missing', 'meta_title_missing', 'h1_missing', 'canonical_missing', 'schema_low_coverage']);
    g.audit!.issues = (g.audit!.issues as Array<{ type: string }>).filter((i) => TIPLER.has(i.type));
    const r = buildClientReport(g, NOW);
    const basliklar = r.aksiyonlar.map((a) => a.baslik);
    const robots = r.aksiyonlar.find((a) => a.baslik === 'robots.txt dosyası yayınlayın')!;
    const harita = r.aksiyonlar.find((a) => a.baslik === 'Site haritasını (sitemap.xml) yayınlayın')!;
    expect(robots).toMatchObject({ etki: 'dusuk', efor: 'kolay' });
    expect(harita).toMatchObject({ etki: 'orta', efor: 'kolay' });
    expect(basliklar).not.toContain('robots.txt dosyasını düzenleyin');
    expect(r.aksiyonlar.slice(0, 3).every((a) => a.etki === 'yuksek')).toBe(true);
    expect(basliklar.indexOf(robots.baslik)).toBeGreaterThan(basliklar.indexOf(harita.baslik));
    expect(r.ozet.metin.at(-1)).not.toContain('robots.txt');
    expect(r.ozet.metin.at(-1)).not.toContain('Site haritası');
  });
});

describe('yanlis "gecti" yok: hreflang, HTTPS, llms.txt', () => {
  it('iki dilli, hreflang\'siz site (yeni tarama): hreflang uyari; bulgu dilleri soyler', async () => {
    const r = buildClientReport(girdi(await kontroller(null)), NOW);
    const seo = seoOf(r);
    const k = seo.kontroller.find((x) => x.id === 'hreflang')!;
    expect(k).toMatchObject({ durum: 'uyari', skor: 0, otomatik: false });
    expect(k.bulgu).toBe('Sitede birden çok dil sürümü var (EN) ama sayfalarda hreflang etiketi yok.');
    expect(seo.bilgiKontrolleri!.map((b) => b.id)).not.toContain('hreflang');
    expect(r.aksiyonlar.map((a) => a.baslik).concat(seo.kontroller.map((x) => x.oneri)).join(' ')).toContain('hreflang');
  });

  it('tek dilli site (yeni tarama): hreflang bilgi kontrolu — "gecti" sayilmaz', async () => {
    const checks = await new AuditChecksService().runAllChecks({
      baseUrl: 'https://tek.com', pages: [sayfa('https://tek.com'), sayfa('https://tek.com/hakkimizda')],
      sitemapUrl: 'https://tek.com/sitemap.xml', robotsTxt: 'User-agent: *\nAllow: /\nSitemap: https://tek.com/sitemap.xml', llmsTxt: '# Tek', totalPages: 2,
    } as any);
    const seo = seoOf(buildClientReport(girdi(checks), NOW));
    expect(seo.kontroller.map((k) => k.id)).not.toContain('hreflang');
    expect(seo.bilgiKontrolleri).toContainEqual({ id: 'hreflang', ad: 'Hreflang', not: BILGI_NOTLARI.hreflangTekDil });
    // llms.txt (v3, skora girmez) de bilgi kontrolu: var
    expect(seo.bilgiKontrolleri).toContainEqual({ id: 'llms_txt', ad: 'llms.txt', not: BILGI_NOTLARI.llmsVar });
    expect(seo.sayac.toplam).toBe(12);
    expect(seo.sayac.gecti + seo.sayac.kritik + seo.sayac.uyari + seo.sayac.dogrulanamadi).toBe(12);
  });

  it('eski tarama (dil surumu hic aranmadi): "gecti" de "gerekmez" de denmez', () => {
    const seo = seoOf(buildClientReport(mukellefGirdisi(), NOW));
    expect(seo.bilgiKontrolleri).toEqual([{ id: 'hreflang', ad: 'Hreflang', not: BILGI_NOTLARI.hreflangBilinmiyor }]);
    expect(BILGI_NOTLARI.hreflangBilinmiyor).toContain('başka dil sürümü varsa eklenmesi önerilir');
  });

  it('hreflang etiketi olan site: kontrol gecer ve sayaca girer', () => {
    const g = mukellefGirdisi();
    (g.audit!.checks as any).hreflang.details = { pagesWithHreflang: 12, note: '12 sayfada hreflang tag bulundu' };
    const seo = seoOf(buildClientReport(g, NOW));
    expect(seo.kontroller.find((k) => k.id === 'hreflang')).toMatchObject({ durum: 'gecti' });
    expect(seo.bilgiKontrolleri).toEqual([]);
    expect(seo.sayac.toplam).toBe(14);
  });

  it('sertifika zinciri eksik: HTTPS "gecti" degil; neden ve oneri zincire ozel', async () => {
    const r = buildClientReport(girdi(await kontroller(null)), NOW);
    const k = seoOf(r).kontroller.find((x) => x.id === 'https')!;
    expect(k).toMatchObject({ durum: 'uyari', skor: 70 });
    expect(k.bulgu).toContain('sertifika zincirini eksik gönderiyor');
    expect(k.bulgu).toContain('bağlanamayabilir');
    expect(k.neden).toContain('güvenli bağlantı kuramaz');
    expect(k.oneri).toContain('fullchain.pem');
    expect(k.oneri).not.toContain('SSL sertifikası kurup');
  });

  it('llms.txt (v3, skora girmez) yoksa "Uyarı · 30/100" satiri cikmaz; bilgi kontroludur', async () => {
    const r = buildClientReport(girdi(await kontroller(null)), NOW);
    const seo = seoOf(r);
    expect(seo.kontroller.map((k) => k.id)).not.toContain('llms_txt');
    expect(seo.bilgiKontrolleri).toContainEqual({ id: 'llms_txt', ad: 'llms.txt', not: BILGI_NOTLARI.llmsYok });
    // GEO bolumundeki dosya durumu ayni kalir
    if (r.geo.olculemedi) throw new Error('geo');
    expect(r.geo.llmsTxt).toBe('yok');
    expect(r.yontem.join(' ')).toContain('Bilgi amaçlı kontroller');
  });
});

describe('AI: tekrarli olcumde soru ve yanit sayilari ayrisir', () => {
  const SORULAR = ['Soru 1', 'Soru 2', 'Soru 3', 'Soru 4', 'Soru 5'];
  /** kaynak[soru][tekrar]: 'k' kaynak, 'a' yalniz ad, '-' yok, 'h' hata */
  const asistan = (provider: string, desen: string[]) => ({
    provider, label: provider, available: true, score: 0, reason: null, tekrar: 3,
    probes: SORULAR.flatMap((query, s) => [...desen[s]].map((c, t) => ({
      query, tekrar: t + 1, cited: c === 'k', brandMentioned: c === 'k' || c === 'a', brandInQuery: false,
      excerpt: c === 'h' ? 'HATA: 500 upstream' : 'yanit',
    }))),
  });

  function rapor() {
    const g = mukellefGirdisi();
    g.aiKosum = {
      runAt: '2026-11-12T13:00:00.000Z',
      providers: [
        // 15 yanitin 7'sinde kaynak — ama ILK yanitlarda yalniz 2 soruda
        asistan('deepseek', ['kkk', 'k-k', '-kk', '---', '-a-']),
        asistan('openai', ['---', '---', '-h-', 'hhh', 'a--']),
      ],
    };
    const r = buildClientReport(g, NOW);
    if (r.ai.olcum.olculemedi) throw new Error('olculmeli');
    return { r, olcum: r.ai.olcum };
  }

  it('asistan satiri: 5 soru, 15 yanit; kac SORUDA ve kac YANITTA gorundugu ayri', () => {
    const { olcum } = rapor();
    expect(olcum.tekrar).toBe(3);
    expect(olcum.asistanlar[0]).toMatchObject({
      saglayici: 'deepseek', olculenSoru: 15, alintiSayisi: 7, anilmaSayisi: 1, soruSayisi: 5, alintiSoru: 3, anilmaSoru: 1, sonuc: 'alinti',
    });
    // Hata veren yanit sayilmaz: 15 − 4 hata = 11 yanit; tamami hata olan soru sayilmaz
    expect(olcum.asistanlar[1]).toMatchObject({ saglayici: 'openai', olculenSoru: 11, soruSayisi: 4, alintiSoru: 0, anilmaSoru: 1, sonuc: 'anilma' });
  });

  it('soru tablosu TUM yanitlarin ozetidir (ilk yanita degil): asistan satiriyla celismez', () => {
    const { olcum } = rapor();
    const hucre = (s: number, a: number) => ({ sonuc: olcum.sorgular[s].sonuclar[a], ...olcum.sorgular[s].ayrinti![a] });
    expect(olcum.sorgular).toHaveLength(5);
    expect(hucre(0, 0)).toEqual({ sonuc: 'alinti', yanit: 3, alinti: 3, anilma: 0 });
    expect(hucre(1, 0)).toEqual({ sonuc: 'alinti', yanit: 3, alinti: 2, anilma: 0 });
    // Ilk yanitta yok, sonraki ikisinde kaynak: eskiden "gorunmedi" cikiyordu
    expect(hucre(2, 0)).toEqual({ sonuc: 'alinti', yanit: 3, alinti: 2, anilma: 0 });
    expect(hucre(3, 0)).toEqual({ sonuc: 'yok', yanit: 3, alinti: 0, anilma: 0 });
    expect(hucre(4, 0)).toEqual({ sonuc: 'anilma', yanit: 3, alinti: 0, anilma: 1 });
    // Bir yaniti hata: 2 gecerli yanit; ucu de hata: olculemedi
    expect(hucre(2, 1)).toEqual({ sonuc: 'yok', yanit: 2, alinti: 0, anilma: 0 });
    expect(hucre(3, 1)).toEqual({ sonuc: 'olculemedi', yanit: 0, alinti: 0, anilma: 0 });
    // Tablodaki "kaynak" isaretli soru sayisi = asistan satirindaki alintiSoru; yanit toplami = alintiSayisi
    const isaretli = olcum.sorgular.filter((q) => q.sonuclar[0] === 'alinti').length;
    expect(isaretli).toBe(olcum.asistanlar[0].alintiSoru);
    expect(olcum.sorgular.reduce((t, q) => t + q.ayrinti![0].alinti, 0)).toBe(olcum.asistanlar[0].alintiSayisi);
  });

  it('yontem notu tekrar sayisini aciklar; tek turluk olcumde not yok', () => {
    const { r } = rapor();
    expect(r.yontem.find((y) => y.includes('birden çok kez'))).toContain('(en fazla 3)');
    expect(buildClientReport(mukellefGirdisi(), NOW).yontem.join(' ')).not.toContain('birden çok kez');
  });
});

describe('icerik takvimi: kimin takvimi oldugu acik', () => {
  it('ozet cumlesi "N içerik takvimde" demez; RanksUp içerik takvimi der', () => {
    const g = bosGirdi();
    g.icerik = { yayinda: 0, takvimde: 3 };
    const r = buildClientReport(g, NOW);
    const metin = r.ozet.metin.join(' ');
    expect(metin).toContain('RanksUp ile henüz içerik yayınlanmadı; RanksUp içerik takviminde 3 planlı içerik var.');
    expect(metin).not.toMatch(/\d+ içerik takvimde/);
    g.icerik = { yayinda: 2, takvimde: 0 };
    expect(buildClientReport(g, NOW).ozet.metin.join(' ')).toContain('RanksUp ile 2 içerik yayınlandı.');
    g.icerik = { yayinda: 0, takvimde: 0 };
    expect(buildClientReport(g, NOW).ozet.metin.join(' ')).toContain('RanksUp ile henüz içerik yayınlanmadı.');
  });
});
