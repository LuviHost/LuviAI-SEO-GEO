/**
 * Herkese acik sayfalarin "son anlamli icerik degisikligi" tarihleri — TEK KAYNAK.
 *
 * Kullananlar: app/sitemap.ts (lastModified), sayfalardaki "Son güncelleme" satiri
 * (components/page-updated-line.tsx) ve sayfa JSON-LD'sindeki dateModified.
 *
 * NEDEN: sitemap eskiden her URL'e `new Date()` basiyordu; her istekte "bugun
 * degisti" diyen bir sitemap arama motorlari ve AI tarayicilari icin sinyal
 * tasimaz (Google lastmod'u tutarli dogru olmadiginda yok sayar). Sayfalarda da
 * gorunur tarih yoktu (yalniz yasal sayfalarda vardi).
 *
 * NASIL GUNCELLENIR: sayfanin METNI ya da sundugu bilgi (fiyat, plan maddesi,
 * yonerge) degistiginde o sayfanin tarihini ayni committe degistir. Stil,
 * yeniden duzenleme, yorum ya da bu satiri eklemek gibi icerigi degistirmeyen
 * isler tarihi DEGISTIRMEZ. Ilk degerler origin/main'den alindi (24.10.2026):
 *   git log -1 --format=%cs origin/main -- <sayfa dizini> [icerigini besleyen dosyalar]
 * Icerigi besleyen dosyalar: "/" icin components/landing + lib/i18n.ts'teki
 * land.* metinleri + apps/api/src/billing/plans.ts; /pricing icin plans.ts;
 * /help/glossary icin lib/glossary.ts. Yasal sayfalarin tarihi metindeki
 * "Son güncelleme" ile ayni olmak zorunda (page-updated.spec.mts denetler).
 *
 * Next importu yok — spec'ler bu dosyayi dogrudan calistirir.
 */

export const SITE_URL = 'https://ranksup.ai';

/**
 * Gorunur yazar satiri. Sahip ileride adli bir kurucuya gecebilir — degisecek tek yer burasi.
 * EN karsiligi ayni kisiyi/ekibi anlatmali.
 */
export const CONTENT_AUTHOR = { tr: 'RanksUp Ekibi', en: 'RanksUp Team' } as const;

type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

export interface PublicPage {
  /** Kok-goreli yol, ornek '/help/aso' */
  path: string;
  /** Son anlamli icerik degisikligi, YYYY-MM-DD */
  updated: string;
  changeFrequency: ChangeFrequency;
  priority: number;
}

/**
 * Sitemap'teki sayfalar (sira = sitemap sirasi). Yalniz VAR OLAN rotalar: /help/studio ve
 * /help/social (modulleri kalkti) 404 veriyordu; /status uydurma uptime gosteriyordu ve
 * kaldirildi (saglik ucu yok).
 */
export const PUBLIC_PAGES: readonly PublicPage[] = [
  { path: '/',                      updated: '2026-10-22', changeFrequency: 'weekly',  priority: 1.0 },
  { path: '/pricing',               updated: '2026-10-22', changeFrequency: 'weekly',  priority: 0.9 },
  { path: '/faq',                   updated: '2026-10-22', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/use-cases',             updated: '2026-10-18', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/compare',               updated: '2026-10-24', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/about',                 updated: '2026-10-22', changeFrequency: 'monthly', priority: 0.7 },
  // Rehber (GEO icerik merkezi) — icerik content/rehber/*.ts; kaynaklar yeniden kontrol
  // edilince ya da metin degisince ilgili satirin tarihi ayni committe guncellenir.
  { path: '/rehber',                                  updated: '2026-10-24', changeFrequency: 'weekly',  priority: 0.8 },
  { path: '/rehber/chatgpt-markam-gorunuyor-mu',      updated: '2026-10-24', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/rehber/geo-nedir',                        updated: '2026-10-24', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/rehber/yapay-zeka-botlari-robots-txt',    updated: '2026-10-24', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/rehber/llms-txt-nedir',                   updated: '2026-10-24', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/rehber/ai-bakisi-gorunurluk',             updated: '2026-10-24', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/rehber/mobil-uygulama-geo',               updated: '2026-10-24', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/rehber/yapay-zeka-gorunurluk-araclari',   updated: '2026-10-24', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/help',                  updated: '2026-10-21', changeFrequency: 'monthly', priority: 0.5 },
  // Help center alt sayfalari — SEO + AI alintisi icin kritik (her biri modul rehberi)
  { path: '/help/getting-started',  updated: '2026-10-22', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/help/ai-visibility',    updated: '2026-10-20', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/help/aso',              updated: '2026-10-18', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/help/asa-asc',          updated: '2026-10-18', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/help/auto-pilot',       updated: '2026-10-22', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/help/api-keys',         updated: '2026-10-18', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/help/billing',          updated: '2026-10-21', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/help/video',            updated: '2026-10-23', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/help/glossary',         updated: '2026-10-22', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/privacy',               updated: '2026-10-21', changeFrequency: 'yearly',  priority: 0.3 },
  { path: '/terms',                 updated: '2026-10-22', changeFrequency: 'yearly',  priority: 0.3 },
  { path: '/kvkk',                  updated: '2026-10-21', changeFrequency: 'yearly',  priority: 0.3 },
  { path: '/bot',                   updated: '2026-10-18', changeFrequency: 'yearly',  priority: 0.3 },
];

/** Sayfanin son guncelleme tarihi (YYYY-MM-DD). Listede olmayan yol programci hatasidir. */
export function pageUpdated(path: string): string {
  const page = PUBLIC_PAGES.find((p) => p.path === path);
  if (!page) throw new Error(`PUBLIC_PAGES'te yok: ${path}`);
  return page.updated;
}

const AYLAR_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const AYLAR_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * '2026-10-22' → '22 Ekim 2026' / 'October 22, 2026'. Intl yerine sabit ay adlari:
 * sunucu ve tarayicinin ICU verisi farkli olsa da hidrasyon ayni metni uretir,
 * saat dilimi kaymasi da olmaz (tarih metinden parcalanir).
 */
export function formatPageDate(iso: string, locale: 'tr' | 'en'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Gecersiz tarih: ${iso}`);
  const [, y, mo, d] = m;
  const gun = Number(d);
  const ay = Number(mo) - 1;
  return locale === 'en' ? `${AYLAR_EN[ay]} ${gun}, ${y}` : `${gun} ${AYLAR_TR[ay]} ${y}`;
}

/** Gorunur satir metni: "Son güncelleme: 22 Ekim 2026 · RanksUp Ekibi" */
export function pageUpdatedText(iso: string, locale: 'tr' | 'en'): string {
  const label = locale === 'en' ? 'Last updated' : 'Son güncelleme';
  return `${label}: ${formatPageDate(iso, locale)} · ${CONTENT_AUTHOR[locale]}`;
}
