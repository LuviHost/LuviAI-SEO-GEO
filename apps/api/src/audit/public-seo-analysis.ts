import type { CheckResult, Severity } from './audit-checks.service.js';
import { CWV_ESIK, type PageSpeedField } from './pagespeed-field.js';

/**
 * Ucretsiz SEO analizi — saf kurallar (servis: public-seo-analysis.service.ts).
 *
 * NEDEN (25.11.2026): Google Keyword Planner (TR, Turkce) "seo analiz" 1.900, "seo analizi" 590,
 * "site analiz" 390, "ücretsiz seo analizi" 170 aylik arama (kume ~3.700). DataForSEO SERP'te ilk 10'un
 * neredeyse tamami ucretsiz analiz araci (arama niyeti: arac). KobiPratik'te son 3 ayda tiklamalarin
 * %83'u hesaplama araclarindan geldi (birinci taraf GSC). Site hizi ayri arac degil, bu analizin
 * bir bolumu: "site hızı testi" SERP'inde ilk 10 cogunlukla yazi/liste.
 *
 * Motor yeni degil: panelin site taramasi (SiteCrawlerService, en fazla 10 sayfa), 15 teknik kontrol
 * (AuditChecksService) ve mobil PageSpeed. Tarama API'de degil worker'da kosar (30.10.2026 olayi:
 * API icindeki tarama sureci 930 MB'a cikarip yeniden baslatti).
 *
 * KOTUYE KULLANIM: IP basina 24 saatte en fazla IP_GUNLUK farkli alan adi; butun ziyaretcilerden
 * 24 saatte en fazla GLOBAL_GUNLUK yeni analiz; ayni alan adi 24 saat onbellekten doner (onbellek
 * sinira sayilmaz). Ham IP saklanmaz.
 */

export const TARANACAK_SAYFA = 10;
export const IP_GUNLUK = 3;
export const GLOBAL_GUNLUK = 300;
export const ONBELLEK_MS = 24 * 60 * 60 * 1000;
/** Bu sureden eski "queued/running" kayit takilmis sayilir (worker yeniden baslatma vb.) */
export const TAKILMA_MS = 10 * 60 * 1000;

/** Kontrol adlari (panel kontrolleri Ingilizce ad tasiyor; ziyaretciye Turkce) */
export const KONTROL_ADI_TR: Readonly<Record<string, string>> = {
  sitemap_xml: 'Site haritası (sitemap.xml)',
  robots_txt: 'robots.txt',
  llms_txt: 'llms.txt (bilgi)',
  schema_markup: 'Yapısal veri (schema.org)',
  meta_title: 'Sayfa başlıkları (title)',
  meta_description: 'Meta açıklamalar',
  open_graph: 'Open Graph (sosyal paylaşım)',
  twitter_card: 'X (Twitter) kartı',
  canonical: 'Canonical etiketi',
  https: 'HTTPS ve yönlendirmeler',
  h1_uniqueness: 'H1 başlıkları',
  image_alt: 'Görseller (alt metni, boyut, yükleme)',
  internal_linking: 'İç bağlantılar',
  hreflang: 'Dil etiketleri (hreflang)',
  google_ai_eligibility: 'Google ve AI Bakışı uygunluğu',
};

export interface SeoBulgu {
  severity: Severity;
  kontrol: string;
  metin: string;
}

export interface SeoKontrolOzeti {
  id: string;
  ad: string;
  /** null: olculemedi (erisim engeli) ya da puansiz bilgi kontrolu */
  puan: number | null;
  bulgular: SeoBulgu[];
}

export interface SeoHiz {
  /** PageSpeed mobil laboratuvar puani (0-100) */
  puan: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  /** Gercek kullanici verisi (CrUX); dusuk trafikli sitede null */
  saha: PageSpeedField | null;
  /** Saha verisi Core Web Vitals esiklerini geciyor mu (veri yoksa null) */
  sahaGecti: boolean | null;
}

export interface SeoAnalizSonucu {
  domain: string;
  url: string;
  /** Panelin genel skor formulu (OVERALL_SCORE_WEIGHTS) */
  puan: number;
  taranan: number;
  kontroller: SeoKontrolOzeti[];
  /** Once kritik, sonra uyari; en fazla 12 */
  oncelikli: SeoBulgu[];
  hiz: SeoHiz | null;
  /** Ana sayfa okunamadiysa (engel, hata) neden */
  engel: string | null;
}

const SIRA: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** PageSpeedService.runAudit ciktisindan hiz ozeti; olcum yoksa null */
export function hizOzeti(psi: unknown): SeoHiz | null {
  if (!psi || typeof psi !== 'object') return null;
  const p = psi as Record<string, unknown>;
  const saha = (p.field ?? null) as PageSpeedField | null;
  return {
    puan: num(p.performanceScore),
    lcpMs: num(p.lcp) !== null ? Math.round(p.lcp as number) : null,
    cls: num(p.cls) !== null ? Math.round((p.cls as number) * 1000) / 1000 : null,
    tbtMs: num(p.tbt) !== null ? Math.round(p.tbt as number) : null,
    saha,
    sahaGecti: saha?.gecti ?? null,
  };
}

/** Kontrol sonuclarindan ziyaretci ozeti */
export function analizOzeti(input: {
  domain: string;
  url: string;
  checks: CheckResult[];
  puan: number;
  taranan: number;
  psi: unknown;
  engel?: string | null;
  puanliKontroller: ReadonlySet<string>;
}): SeoAnalizSonucu {
  const kontroller: SeoKontrolOzeti[] = input.checks.map((c) => {
    const olculemedi = (c.details as { unverified?: unknown } | undefined)?.unverified === true;
    return {
      id: c.id,
      ad: KONTROL_ADI_TR[c.id] ?? c.name,
      puan: olculemedi || !input.puanliKontroller.has(c.id) ? null : Math.round(c.score),
      bulgular: (c.issues ?? []).map((i) => ({ severity: i.severity, kontrol: KONTROL_ADI_TR[c.id] ?? c.name, metin: i.description })),
    };
  });
  const oncelikli = kontroller
    .flatMap((k) => k.bulgular)
    .filter((b) => b.severity !== 'info')
    .sort((a, b) => SIRA[a.severity] - SIRA[b.severity])
    .slice(0, 12);
  return {
    domain: input.domain,
    url: input.url,
    puan: Math.round(input.puan),
    taranan: input.taranan,
    kontroller,
    oncelikli,
    hiz: hizOzeti(input.psi),
    engel: input.engel ?? null,
  };
}

/** Ziyaretciye gosterilen hiz cumlesi (saha verisi varsa onu one alir; Google siralamada saha verisine bakar) */
export function hizCumlesi(h: SeoHiz | null): string | null {
  if (!h) return null;
  if (h.saha && h.sahaGecti !== null) {
    const lcp = h.saha.lcpMs !== null ? `${(h.saha.lcpMs / 1000).toFixed(1).replace('.', ',')} sn` : 'ölçülmedi';
    return h.sahaGecti
      ? `Gerçek ziyaretçiler Core Web Vitals eşiklerini geçiyor (son 28 gün, en büyük içerik ${lcp}).`
      : `Gerçek ziyaretçilerde Core Web Vitals eşiklerinden en az biri aşılıyor (son 28 gün, en büyük içerik ${lcp}; eşik ${CWV_ESIK.lcpMs / 1000} sn).`;
  }
  if (h.puan !== null) return `Gerçek ziyaretçi verisi yok; mobil laboratuvar ölçümünde hız puanı ${h.puan}/100.`;
  return null;
}

/** Yonetici listesi satiri (/admin/leads "SEO analizleri"): sonuc ozetinden yalniz gereken alanlar */
export interface SeoAnalizYoneticiSatiri {
  id: string;
  domain: string;
  status: string;
  createdAt: string;
  puan: number | null;
  taranan: number | null;
  hizPuani: number | null;
  sahaGecti: boolean | null;
  kritik: number;
  uyari: number;
  engel: string | null;
  /** IP ozetinin ilk 8 karakteri — ayni ziyaretciyi tanimak icin; ham IP yok */
  ip: string;
  email: string | null;
  pazarlamaIzni: boolean;
  onbellek: boolean;
}

export function yoneticiSatiri(row: {
  id: string; domain: string; status: string; createdAt: Date; ipHash: string; result: unknown;
  email?: string | null; pazarlamaIzni?: boolean; onbellek?: boolean;
}): SeoAnalizYoneticiSatiri {
  const r = (row.result && typeof row.result === 'object' ? row.result : null) as Partial<SeoAnalizSonucu> | null;
  const bulgular = (r?.kontroller ?? []).flatMap((k) => k.bulgular ?? []);
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    puan: typeof r?.puan === 'number' ? r.puan : null,
    taranan: typeof r?.taranan === 'number' ? r.taranan : null,
    hizPuani: r?.hiz?.puan ?? null,
    sahaGecti: r?.hiz?.sahaGecti ?? null,
    kritik: bulgular.filter((b) => b.severity === 'critical').length,
    uyari: bulgular.filter((b) => b.severity === 'warning').length,
    engel: r?.engel ?? null,
    ip: (row.ipHash ?? '').slice(0, 8),
    email: row.email ?? null,
    pazarlamaIzni: row.pazarlamaIzni === true,
    onbellek: row.onbellek === true,
  };
}
