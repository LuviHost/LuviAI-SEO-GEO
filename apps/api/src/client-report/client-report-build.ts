/**
 * Musteri raporu derleyicisi — SAF fonksiyonlar (DB yok, saat parametre).
 *
 * NEDEN saf: rapor kurallari ("olculmeyen deger uydurulmaz", "ozet metni
 * sablondan, ayni veri ayni metin") birim testle kilitlenebilsin. Veri
 * toplama client-report.service.ts'te; burada yalniz donusum var.
 *
 * Yeniden kullanilan kurallar (kopyalanmadi):
 *  - kontrolun dogrulanamamasi: audit-checks.service isUnverifiedCheck
 *  - taramanin AI adimi gercek olcum mu: audit.service aiCitationsOlculdu
 *  - soru bazli sonuc (alinti/anilma/yok/hata): citation-run-compare outcomeOf
 *  - skora giren havuz: brand-in-query unbrandedOnly + citation-score isErrorProbe
 *  - duzeltme yolu (otomatik mi): fix-routes fixRouteFor / fixRouteForIssue
 *
 * DIL: taramanin `description` metinleri panel icin yazilmistir ("sen", ic
 * notlar). Rapora HIC basilmaz; her sorunun rapor cumlesi
 * client-report-texts.ts bulguMetni'nden gelir (yalniz sayilar taramadan).
 */
import { isUnverifiedCheck } from '../audit/audit-checks.service.js';
import { aiCitationsOlculdu } from '../audit/audit.service.js';
import { headlineOfProviders, outcomeOf, type RunProbe, type RunProvider } from '../audit/citation-run-compare.js';
import { isErrorProbe } from '../audit/citation-score.js';
import { unbrandedOnly } from '../audit/brand-in-query.js';
import { fixRouteFor, fixRouteForIssue } from '../audit/fix-routes.js';
import {
  AI_DUSUK_ESIGI, AI_SKOR_YONTEMI, AKSIYON_TIP_METINLERI, BILGI_NOTLARI, GEO_SINYAL_ADI, OLCULMEDI, RAPOR_DISI_TIPLER, RAPOR_ONEM_DUZELTMESI,
  SAYFA_SORUNU_METINLERI, TIP_NEDENI, TIP_ONCELIGI, TIP_ONERISI, aiGorunurlukAksiyonAciklamasi, aksiyonMetni, bulguMetni, hizAksiyonAciklamasi, kapsamCumlesi, kontrolMetni,
  type BulguBaglami,
} from './client-report-texts.js';
import {
  MUSTERI_RAPORU_SURUM,
  type AiSonuc, type Efor, type Etki, type KontrolDurumu, type MusteriRaporu, type Olculemedi, type Onem,
  type RaporAi, type RaporAiAsistan, type RaporAiSorgu, type RaporAksiyon, type RaporBilgiKontrolu, type RaporGeo,
  type RaporKontrol, type RaporKpi, type RaporSayfaSorunu, type RaporSeo,
} from './client-report.types.js';

// ─── Girdi ──────────────────────────────────────────────────────────

export interface RaporAuditGirdisi {
  ranAt: Date | string;
  overallScore: number | null;
  geoScore: number | null;
  checks: unknown;
  issues: unknown;
  /** AuditService.getLatest: bu skordan SONRAKI deneme engellendiyse dolu */
  accessBlocked?: { reason?: string | null; hint?: string | null; at?: string | null } | null;
}

export interface RaporAksiyonPlaniGirdisi {
  title: string;
  description: string | null;
  impact: string;
  effort: string;
  status: string;
  source: string;
  sourceRef: string | null;
}

export interface RaporGirdisi {
  site: { name: string; url: string };
  audit: RaporAuditGirdisi | null;
  /** Hic tarama yokken anasayfa okunamadiysa (crawl-access) nedeni */
  erisimEngeli: { reason: string; hint?: string | null } | null;
  /** AiCitationTrackerService.getHistory(headline) — panel mansetiyle ayni kaynak */
  aiManset: { score: number | null; method: 'rolling' | 'first-run' | null } | null;
  /** En son AiCitationRun (append-only kosum kaydi) */
  aiKosum: { runAt: Date | string; providers: unknown } | null;
  /** AiKpisService.getKpis — son 7 gun, markasiz sorular */
  kpi: { mentionRate: number | null; shareOfVoice: number | null; unbrandedCount: number } | null;
  /**
   * son7/son30/botlar: IP'si DOGRULANMIS bot ziyareti (bot-verification.ts).
   * dogrulanamayan30: kendini bot olarak tanitan ama IP'si saglayiciya ait olmayan istek (taklit olabilir).
   */
  botlar: { takipVar: boolean; son7: number; son30: number; dogrulanamayan30?: number; botlar: Array<{ ad: string; ziyaret: number }> };
  icerik: { yayinda: number; takvimde: number };
  aksiyonPlani: RaporAksiyonPlaniGirdisi[];
  rakipler: { tanimli: string[]; sesPayi: Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }> };
  /** SiteImage envanterinde sitede dogrulanan/uygulanan alt metin sayisi; envanter yoksa null */
  gorselDuzeltilen: number | null;
  /** latestReadinessKpi; hic tarama yoksa null */
  ajanHazirligi: { score: number | null; measured: boolean; reason: string | null; ranAt: string | null } | null;
}

// ─── Yardimcilar ────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** Turkiye 2016'dan beri sabit UTC+3 — Intl/ICU'ya bagli kalmadan ayni metin */
const TR_OFFSET_MS = 3 * 3_600_000;
const ORNEK_SINIRI = 10;

function olculemedi(neden: string): Olculemedi {
  return { olculemedi: true, neden };
}

function iso(d: Date | string): string {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

/** "22 Ekim 2026" — Istanbul saatine gore, ICU'suz (deterministik) */
export function trTarih(isoTarih: string): string {
  const d = new Date(Date.parse(isoTarih) + TR_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${AYLAR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Yuzde metni: "%33,3" (Turkce ondalik virgul, yuzde isareti onde) */
export function trYuzde(n: number): string {
  const yuvarli = Math.round(n * 10) / 10;
  return `%${String(yuvarli).replace('.', ',')}`;
}

function sayi(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function dizgeler(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/** Tarama aciklamasinin basindaki sayi ("12 orphan sayfa ...") — details sayiyi tutmuyorsa */
function ilkSayi(metin: unknown): number | null {
  const m = typeof metin === 'string' ? /^(\d+)\s/.exec(metin.trim()) : null;
  return m ? Number(m[1]) : null;
}

function metinOf(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function nesne(v: unknown): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

type Issue = { severity?: string; type?: string; description?: string; checkId?: string; fixRoute?: string };

/**
 * Kayitli sorunlar — rapor onemiyle. Eski taramalarin "critical" yazdigi
 * robots.txt / site haritasi yoklugu burada "uyari"ya cekilir
 * (RAPOR_ONEM_DUZELTMESI); kontrol durumu, bulgu sayaci, sayfa sorunlari ve
 * aksiyonlar AYNI listeyi okur ki raporun bir bolumu "kritik" derken digeri
 * "uyari" demesin.
 */
function issuesOf(v: unknown): Issue[] {
  if (!Array.isArray(v)) return [];
  return (v.filter((i) => i && typeof i === 'object') as Issue[])
    // Bugunku olcuyle bulgu olmayan eski tipler rapora hic girmez (RAPOR_DISI_TIPLER)
    .filter((i) => !(typeof i.type === 'string' && RAPOR_DISI_TIPLER.has(i.type)))
    .map((i) => {
      const duzeltme = typeof i.type === 'string' ? RAPOR_ONEM_DUZELTMESI[i.type] : undefined;
      return duzeltme && i.severity === 'critical' ? { ...i, severity: duzeltme } : i;
    });
}

const SEVERITY_SIRA: Record<string, number> = { critical: 0, warning: 1 };
const TIP_SIRA_VARSAYILAN = 50;

/**
 * En agir sorun once; ayni onemde tipin onceligi (TIP_ONCELIGI — ör. bot engeli,
 * eksik site haritasi satirindan once), sonra tarama sirasi (stabil).
 */
function onemSirali(issues: Issue[]): Issue[] {
  const onem = (i: Issue) => SEVERITY_SIRA[String(i.severity)] ?? 2;
  const tipSirasi = (i: Issue) => TIP_ONCELIGI[String(i.type)] ?? TIP_SIRA_VARSAYILAN;
  // Tip onceligi yalniz AYNI kontrolun sorunlari arasinda gecerlidir: kontroller
  // kendi aralarinda tarama sirasini korur (ayni onemde ilk gorulen kontrol once).
  const grup = (i: Issue) => `${onem(i)}|${String(i.checkId ?? '')}`;
  const grupSirasi = new Map<string, number>();
  issues.forEach((i, idx) => { if (!grupSirasi.has(grup(i))) grupSirasi.set(grup(i), idx); });
  return issues
    .map((i, idx) => ({ i, idx }))
    .sort((a, b) =>
      onem(a.i) - onem(b.i)
      || grupSirasi.get(grup(a.i))! - grupSirasi.get(grup(b.i))!
      || tipSirasi(a.i) - tipSirasi(b.i)
      || a.idx - b.idx)
    .map(({ i }) => i);
}

/** Kritik ya da uyari duzeyinde sorun mu (bilgi duzeyi sorun durum ve aksiyon uretmez) */
function ciddi(i: Issue): boolean {
  return i.severity === 'critical' || i.severity === 'warning';
}

function onemOf(severity: unknown): Onem {
  return severity === 'critical' ? 'kritik' : severity === 'warning' ? 'uyari' : 'bilgi';
}

const ONEM_SIRA: Record<Onem, number> = { kritik: 0, uyari: 1, bilgi: 2 };
const DURUM_SIRA: Record<KontrolDurumu, number> = { kritik: 0, uyari: 1, dogrulanamadi: 2, gecti: 3 };

// ─── SEO ────────────────────────────────────────────────────────────

/**
 * Kontrol satirinin durumu. Panel (site-flow-stepper) kuralinin bir fazlasi:
 * dogrulanamayan → dogrulanamadi; found && valid VE kritik/uyari sorunu yok →
 * gecti; aksi halde en agir sorunun onemi (yalniz bilgi duzeyi sorunu olan
 * basarisiz kontrol uyari).
 *
 * "Sorunu varken gecti olmaz": robots.txt iki AI arama botunu engellerken 70
 * puanla gecerli sayilir; panel bunu yesil gosterir, ama musteri raporunda
 * "Geçen kontroller" arasinda durup aksiyon listesinde "bot engelini gozden
 * gecirin" yazmasi celiskiydi.
 */
export function kontrolDurumu(entry: Record<string, any>): KontrolDurumu {
  if (isUnverifiedCheck(entry)) return 'dogrulanamadi';
  const sorunlar = issuesOf(entry.issues);
  if (entry.found && entry.valid && !sorunlar.some(ciddi)) return 'gecti';
  if (sorunlar.some((i) => i.severity === 'critical')) return 'kritik';
  return 'uyari';
}

/** checks Json'undaki 14 kontrol satiri (pagespeed/geo/aiCitations/crawlCoverage disarida — panel gibi) */
function kontrolSatirlari(checks: unknown): Array<[string, Record<string, any>]> {
  return Object.entries(nesne(checks)).filter(
    ([, v]) => v && typeof v === 'object' && typeof (v as any).name === 'string' && (v as any).id !== 'ai_citations',
  ) as Array<[string, Record<string, any>]>;
}

/**
 * Bilgi amacli kontrol mu? Boyle bir satir "gecti" ya da "sorunlu" sayilmaz;
 * raporda ayri listelenir (RaporSeo.bilgiKontrolleri), sayaca girmez.
 *
 *  - llms.txt: istege bagli dosya. Yontem v3'te (details.informational) genel
 *    skora girmez; eskiden dosyasi olmayan site raporda "Uyarı · 30/100"
 *    satiri aliyordu. v3 ONCESI taramada dosya o taramanin skoruna girmisti:
 *    not "skora girmez" DEMEZ (BILGI_NOTLARI.llmsEski*).
 *  - hreflang, sitede hic etiket yokken: kontrol bir sey OLCMEDI. Yeni tarama
 *    dil surumu arar (details.applicable === false: gorulmedi); eski tarama hic
 *    aramadi (alan yok) ve iki dilli siteye de "gecti" yazdi. Ikisinde de
 *    "Hreflang: geçti" denmez.
 */
function bilgiKontrolu(id: string, v: Record<string, any>): RaporBilgiKontrolu | null {
  const d = nesne(v.details);
  if (id === 'llms_txt') {
    const durum = isUnverifiedCheck(v) ? 'Dogrulanamadi' : v.found ? 'Var' : 'Yok';
    const not = BILGI_NOTLARI[`${d.informational === true ? 'llms' : 'llmsEski'}${durum}` as keyof typeof BILGI_NOTLARI];
    return { id, ad: kontrolMetni(id, v.name).ad, not };
  }
  if (id === 'hreflang' && v.found && v.valid && !isUnverifiedCheck(v)) {
    const etiketli = sayi(d.pagesWithHreflang) ?? 0;
    if (d.applicable === false) return { id, ad: kontrolMetni(id, v.name).ad, not: BILGI_NOTLARI.hreflangTekDil };
    if (d.applicable === undefined && etiketli === 0) return { id, ad: kontrolMetni(id, v.name).ad, not: BILGI_NOTLARI.hreflangBilinmiyor };
  }
  return null;
}

/** Sorunu olmayan ama gecemeyen kontrol icin durum cumlesi (ör. yapisal veri kapsami %50-69) */
function sorunsuzBulgu(id: string, details: Record<string, any>): string | null {
  if (id === 'schema_markup') {
    const s = sayi(details.pagesWithSchema);
    const t = sayi(details.total);
    if (s !== null && t !== null) return kapsamCumlesi('Yapısal veri (JSON-LD)', s, t);
  }
  // Yalniz cok uzun aciklama: tarama bunun icin sorun yazmaz ama kontrol gecemez
  if (id === 'meta_description') {
    const uzun = sayi(details.tooLong);
    if (uzun !== null && uzun > 0) return `${uzun} sayfanın meta açıklaması 160 karakterden uzun; arama sonucunda kesilebilir.`;
  }
  return null;
}

function kontrolleriDerle(checks: unknown): { kontroller: RaporKontrol[]; bilgiKontrolleri: RaporBilgiKontrolu[] } {
  const bilgiKontrolleri: RaporBilgiKontrolu[] = [];
  const satirlar: RaporKontrol[] = [];
  for (const [id, v] of kontrolSatirlari(checks)) {
    const bilgi = bilgiKontrolu(id, v);
    if (bilgi) {
      bilgiKontrolleri.push(bilgi);
      continue;
    }
    const durum = kontrolDurumu(v);
    const metin = kontrolMetni(id, v.name);
    const sorunlar = onemSirali(issuesOf(v.issues));
    const baglam = (i: Issue): BulguBaglami => ({ details: nesne(v.details), description: metinOf(i.description) });
    const ilk = sorunlar[0];
    let bulgu: string | null;
    if (durum === 'dogrulanamadi') {
      bulgu = [v.details?.unverifiedReason, v.details?.unverifiedHint].filter((s) => typeof s === 'string' && s).join(' ') || null;
    } else if (durum === 'gecti') {
      bulgu = null;
    } else {
      // Rapor cumleleri (ham tarama metni DEGIL); kontrolun butun sorunlari, en agiri once
      const cumleler = sorunlar.map((i) => bulguMetni(i.type, baglam(i))).filter((c): c is string => !!c);
      bulgu = [...new Set(cumleler)].join(' ') || sorunsuzBulgu(id, nesne(v.details));
    }
    const sorunlu = durum === 'kritik' || durum === 'uyari';
    const tip = sorunlu ? String(ilk?.type ?? '') : '';
    // Oneri kontrolun BUTUN ciddi sorunlarindan: yalniz ilk sorunun onerisi yazilinca
    // bot engeli olan robots.txt'te satir yalniz "Sitemap satırı ekleyin" diyebiliyordu.
    const ciddiSorunlar = sorunlar.filter(ciddi);
    const oneriler = sorunlu
      ? [...new Set(ciddiSorunlar.map((i) => TIP_ONERISI[String(i.type)]?.(baglam(i))).filter((o): o is string => !!o))]
      : [];
    // "RanksUp düzeltebilir": ciddi sorunlarin HEPSI otomatik yolda olmali (rota sorun tipinden —
    // robots.txt'teki bot engeli elle duzeltilir). Sorunu olmayan basarisiz kontrolde kontrolun rotasi.
    const otomatik = sorunlu && (ciddiSorunlar.length > 0
      ? ciddiSorunlar.every((i) => fixRouteForIssue({ checkId: id, type: i.type }) === 'auto_fix')
      : fixRouteFor(id) === 'auto_fix');
    satirlar.push({
      id,
      ad: metin.ad,
      durum,
      skor: durum === 'dogrulanamadi' ? null : sayi(v.score),
      bulgu,
      neden: TIP_NEDENI[tip] ?? metin.neden,
      oneri: oneriler.length > 0 ? oneriler.join(' ') : metin.oneri,
      // Dogrulanamayan dosyaya otomatik duzeltme onerilmez (fix-routes / audit-checks gerekcesi)
      otomatik,
    });
  }
  // Stabil siralama: kritik → uyari → dogrulanamadi → gecti; ayni durumda tarama sirasi
  const kontroller = satirlar
    .map((k, i) => ({ k, i }))
    .sort((a, b) => DURUM_SIRA[a.k.durum] - DURUM_SIRA[b.k.durum] || a.i - b.i)
    .map(({ k }) => k);
  return { kontroller, bilgiKontrolleri };
}

/** Sayfa sorunu tipi → details'ten sayi ve ornek adres alanlari */
const SAYFA_SORUNU_ALANI: Record<string, { sayi?: string; ornek?: string; not?: string }> = {
  meta_desc_missing: { sayi: 'missing', ornek: 'missingPages' },
  meta_desc_short: { sayi: 'tooShort' },
  meta_title_missing: { sayi: 'missing', ornek: 'missingPages' },
  meta_title_short: { sayi: 'tooShort' },
  meta_title_long: { sayi: 'tooLong' },
  // missingH1Pages taramaya 22.10.2026'da eklendi; eski taramada yok (asagidaki not)
  h1_missing: { sayi: 'missing', ornek: 'missingH1Pages' },
  h1_duplicate: { sayi: 'duplicates' },
  js_shell_pages: { sayi: 'jsShellCount', ornek: 'jsShellPages' },
  image_alt_missing: { sayi: 'absent', ornek: 'missingAltPages', not: 'Örnekler, alt metni eksik görsellerin bulunduğu sayfalardır.' },
  image_alt_suspicious: { sayi: 'suspicious', ornek: 'suspiciousPages', not: 'Örnekler, bu görsellerin bulunduğu sayfalardır.' },
  orphan_pages: { ornek: 'orphans' },
};

function sayfaSorunlariniDerle(checks: unknown, issues: Issue[]): RaporSayfaSorunu[] {
  const c = nesne(checks);
  const out: RaporSayfaSorunu[] = [];
  const gorulen = new Set<string>();
  for (const issue of issues) {
    const tur = String(issue.type ?? '');
    const metin = SAYFA_SORUNU_METINLERI[tur];
    if (!metin || gorulen.has(tur)) continue;
    gorulen.add(tur);
    const alan = SAYFA_SORUNU_ALANI[tur] ?? {};
    const details = nesne(nesne(c[String(issue.checkId ?? '')]).details);
    const sayiDetay = alan.sayi ? sayi(details[alan.sayi]) : null;
    const adet = sayiDetay ?? ilkSayi(issue.description);
    const tumOrnekler = [...new Set(alan.ornek ? dizgeler(details[alan.ornek]) : [])];
    const ornekler = tumOrnekler.slice(0, ORNEK_SINIRI);
    // Ornek adres tutulmayan tipte (kisa/uzun baslik, tekrarlanan H1) not YOK:
    // "tarama adres kaydetmiyor" bir ic nottu, musteriye bir sey soylemiyordu.
    let ornekNotu: string | null = alan.ornek ? alan.not ?? null : null;
    if (alan.ornek && ornekler.length === 0) {
      ornekNotu = tur === 'h1_missing' ? 'Örnek sayfa adresleri bir sonraki taramadan sonra listelenir.' : null;
    }
    out.push({
      tur,
      baslik: metin.baslik,
      onem: onemOf(issue.severity),
      sayi: adet,
      birim: metin.birim,
      ornekler,
      ornekNotu,
      // Rapor cumlesi — ham tarama metni govdeye girmez (govde herkese acik baglantida da doner)
      aciklama: bulguMetni(tur, { details, description: metinOf(issue.description) }) ?? '',
    });
  }
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => ONEM_SIRA[a.s.onem] - ONEM_SIRA[b.s.onem] || (b.s.sayi ?? 0) - (a.s.sayi ?? 0) || a.i - b.i)
    .map(({ s }) => s);
}

function gorselleriDerle(checks: unknown, duzeltilen: number | null): RaporSeo['gorseller'] {
  const entry = nesne(nesne(checks).image_alt);
  if (!entry.id) return olculemedi('Bu taramada görsel alt metni ölçülmedi.');
  if (isUnverifiedCheck(entry)) return olculemedi('Görseller bu taramada doğrulanamadı.');
  const d = nesne(entry.details);
  const icerik = sayi(d.contentImages);
  const yok = sayi(d.absent);
  // Yontem v2 oncesi kayit (contentImages/absent yok): ayni anlamda sayi yok — uydurulmaz
  if (icerik === null || yok === null) return olculemedi('Bu tarama eski yöntemle yapıldı; görsel sayıları için yeniden tarama gerekiyor.');
  return {
    olculemedi: false,
    icerikGorseli: icerik,
    altMetniYok: yok,
    altMetniVar: sayi(d.withAlt) ?? 0,
    susGorseli: (sayi(d.emptyAlt) ?? 0) + (sayi(d.ariaDecorative) ?? 0),
    supheli: sayi(d.suspicious) ?? 0,
    sayfaSayisi: sayi(d.pagesScanned) ?? 0,
    duzeltilen,
  };
}

function seoDerle(g: RaporGirdisi): MusteriRaporu['seo'] {
  const a = g.audit;
  if (!a) {
    return olculemedi(g.erisimEngeli
      ? `Site taranamadı: ${[g.erisimEngeli.reason, g.erisimEngeli.hint].filter(Boolean).join(' ')}`
      : 'Site henüz taranmadı.');
  }
  const issues = issuesOf(a.issues);
  const { kontroller, bilgiKontrolleri } = kontrolleriDerle(a.checks);
  const engel = a.accessBlocked;
  const guncelDegil = engel
    ? `Bu skordan sonraki tarama denemesi siteye erişemedi${engel.at ? ` (${trTarih(engel.at)})` : ''}: ${[engel.reason, engel.hint].filter(Boolean).join(' ')}`.trim()
    : null;
  const sayac = { gecti: 0, kritik: 0, uyari: 0, dogrulanamadi: 0, toplam: kontroller.length };
  for (const k of kontroller) sayac[k.durum]++;
  return {
    olculemedi: false,
    taramaTarihi: iso(a.ranAt),
    // Son deneme engellendiyse eski skor GUNCEL diye verilmez (panel KpiRow ile ayni kural)
    siteSkoru: guncelDegil ? null : sayi(a.overallScore),
    guncelDegil,
    sayac,
    bulgu: {
      toplam: issues.length,
      kritik: issues.filter((i) => i.severity === 'critical').length,
      uyari: issues.filter((i) => i.severity === 'warning').length,
      bilgi: issues.filter((i) => i.severity !== 'critical' && i.severity !== 'warning').length,
    },
    kontroller,
    bilgiKontrolleri,
    sayfaSorunlari: sayfaSorunlariniDerle(a.checks, issues),
    gorseller: gorselleriDerle(a.checks, g.gorselDuzeltilen),
    taranamayanSayfa: sayi(nesne(nesne(a.checks).crawlCoverage).blockedCount) ?? 0,
  };
}

// ─── GEO ────────────────────────────────────────────────────────────

function dosyaDurumu(entry: Record<string, any>): 'var' | 'yok' | 'dogrulanamadi' {
  if (isUnverifiedCheck(entry)) return 'dogrulanamadi';
  return entry.found ? 'var' : 'yok';
}

function geoDerle(g: RaporGirdisi): MusteriRaporu['geo'] {
  const a = g.audit;
  if (!a) return olculemedi('Site henüz taranmadı.');
  const checks = nesne(a.checks);
  const geo = nesne(checks.geo);
  const robots = nesne(checks.robots_txt);
  const schema = nesne(checks.schema_markup);

  const geoSkoru = sayi(a.geoScore);
  let geoSkoruNotu: string | null = null;
  if (geoSkoru === null) {
    const b = nesne(geo.blocked);
    geoSkoruNotu = b.reason ? `Hesaplanamadı: ${[b.reason, b.hint].filter(Boolean).join(' ')}` : 'Bu taramada hesaplanmadı.';
  } else {
    const s = nesne(geo.sample);
    if ((sayi(s.blocked) ?? 0) > 0) {
      geoSkoruNotu = `${sayi(s.measured) ?? 0} sayfa ölçüldü; ${s.blocked} sayfa erişim engeli nedeniyle skora girmedi.`;
    }
  }

  let robotsBolumu: RaporGeo['robots'];
  if (!robots.id) robotsBolumu = olculemedi('Bu taramada robots.txt ölçülmedi.');
  else if (isUnverifiedCheck(robots)) robotsBolumu = olculemedi(String(robots.details?.unverifiedReason ?? 'robots.txt doğrulanamadı.'));
  else {
    const d = nesne(robots.details);
    const botlar = Array.isArray(d.searchBots) ? d.searchBots : [];
    robotsBolumu = {
      olculemedi: false,
      dosya: !!robots.found,
      sitemapSatiri: d.hasSitemap === true,
      aramaBotlari: botlar
        .filter((b: any) => typeof b?.name === 'string')
        .map((b: any) => ({ ad: b.name as string, erisim: b.effective === 'block' ? ('engelli' as const) : ('acik' as const) })),
      egitimBotuEngelli: dizgeler(d.trainingBlocked),
    };
  }

  const sd = nesne(schema.details);
  const sToplam = sayi(sd.total);
  const sSayfa = sayi(sd.pagesWithSchema);
  const schemaBolumu: RaporGeo['schema'] = sToplam !== null && sSayfa !== null && sToplam > 0
    ? { olculemedi: false, sayfa: sSayfa, toplam: sToplam, oran: Math.round((sSayfa / sToplam) * 100) }
    : olculemedi('Bu taramada yapısal veri ölçülmedi.');

  const sinyaller = (Array.isArray(geo.methods) ? geo.methods : [])
    .filter((m: any) => typeof m?.id === 'string' && sayi(m.score) !== null)
    .map((m: any) => ({ id: m.id as string, ad: GEO_SINYAL_ADI[m.id] ?? String(m.label ?? m.id), skor: m.score as number }));

  const ah = g.ajanHazirligi;
  const ajanHazirligi: RaporGeo['ajanHazirligi'] = !ah
    ? olculemedi(OLCULMEDI)
    : !ah.measured
      ? olculemedi(ah.reason ?? 'Son tarama siteye erişemedi; skor ölçülemedi.')
      : { olculemedi: false, skor: ah.score, tarih: ah.ranAt };

  return {
    olculemedi: false,
    taramaTarihi: iso(a.ranAt),
    geoSkoru,
    geoSkoruNotu,
    llmsTxt: checks.llms_txt ? dosyaDurumu(nesne(checks.llms_txt)) : 'yok',
    sitemap: checks.sitemap_xml ? dosyaDurumu(nesne(checks.sitemap_xml)) : 'yok',
    robots: robotsBolumu,
    schema: schemaBolumu,
    sinyaller,
    ajanHazirligi,
  };
}

// ─── AI ─────────────────────────────────────────────────────────────

function saglayicilar(v: unknown): RunProvider[] {
  return (Array.isArray(v) ? v : [])
    .filter((p) => p && typeof p === 'object' && typeof (p as any).provider === 'string')
    .map((p: any) => ({ ...p, probes: Array.isArray(p.probes) ? p.probes : [] })) as RunProvider[];
}

/**
 * Asistan ve soru matrisini kayitli kosumdan cikarir. Hic sorulmamis
 * (anahtar/model yapilandirilmamis) asistan listelenmez: musteriye
 * "olculemedi" diye yuzlerce bos satir gostermek bilgi degil gurultu.
 */
interface SoruOzeti { yanit: number; alinti: number; anilma: number }

/**
 * Bir asistanin bir soruya verdigi TUM yanitlarin ozeti. Site olcumu her
 * soruyu her asistana birden cok kez sorar (yontem v6, citation-repeat.ts);
 * hata veren yanit sayilmaz (outcomeOf 'n/a').
 */
function soruOzeti(probes: RunProbe[], soru: string): SoruOzeti {
  const o: SoruOzeti = { yanit: 0, alinti: 0, anilma: 0 };
  for (const pr of probes) {
    if (pr.query?.trim() !== soru) continue;
    const sonuc = outcomeOf(pr);
    if (sonuc === 'n/a') continue;
    o.yanit++;
    if (sonuc === 'cited') o.alinti++;
    else if (sonuc === 'mentioned') o.anilma++;
  }
  return o;
}

/** Hucre sonucu: yanitlardan en az birinde kaynak → alinti; yoksa en az birinde ad → anilma */
function ozetSonucu(o: SoruOzeti): AiSonuc {
  if (o.yanit === 0) return 'olculemedi';
  return o.alinti > 0 ? 'alinti' : o.anilma > 0 ? 'anilma' : 'yok';
}

function aiMatrisi(providers: RunProvider[]): { asistanlar: RaporAiAsistan[]; sorgular: RaporAiSorgu[]; tekrar: number } {
  const denenen = providers.filter((p) => p.available || p.probes.length > 0);
  let tekrar = 1;
  const asistanlar = denenen.map((p): RaporAiAsistan => {
    const havuz = unbrandedOnly(p.probes.filter((pr) => !isErrorProbe(pr)));
    const alinti = havuz.filter((pr) => pr.cited).length;
    const anilma = havuz.filter((pr) => pr.brandMentioned && !pr.cited).length;
    const olculemez = !p.available || havuz.length === 0;
    // Soru bazinda: "15 soru" degil "5 soru × 3 yanit". Eskiden yanit sayisi
    // "soru" diye yaziliyordu ve soru tablosundaki 5 satirla celisiyordu.
    const sorular = [...new Set(havuz.map((pr) => pr.query?.trim()).filter((q): q is string => !!q))];
    const ozetler = sorular.map((q) => soruOzeti(havuz, q));
    for (const o of ozetler) tekrar = Math.max(tekrar, o.yanit);
    return {
      saglayici: p.provider,
      ad: typeof p.label === 'string' && p.label ? p.label : p.provider,
      skor: p.available && typeof p.score === 'number' ? p.score : null,
      sonuc: olculemez ? 'olculemedi' : alinti > 0 ? 'alinti' : anilma > 0 ? 'anilma' : 'yok',
      alintiSayisi: alinti,
      anilmaSayisi: anilma,
      olculenSoru: havuz.length,
      soruSayisi: sorular.length,
      alintiSoru: ozetler.filter((o) => o.alinti > 0).length,
      anilmaSoru: ozetler.filter((o) => o.alinti === 0 && o.anilma > 0).length,
      // Ham saglayici hatasi (anahtar, kota metni) musteri raporuna yazilmaz
      neden: olculemez ? 'Bu ölçümde bu asistandan geçerli yanıt alınamadı.' : null,
    };
  });

  const sorular: string[] = [];
  const markali = new Map<string, boolean>();
  for (const p of denenen) {
    for (const pr of p.probes) {
      const q = typeof pr.query === 'string' ? pr.query.trim() : '';
      if (!q) continue;
      if (!markali.has(q)) sorular.push(q);
      markali.set(q, (markali.get(q) ?? false) || pr.brandInQuery === true);
    }
  }
  const sorgular = sorular.map((soru): RaporAiSorgu => {
    // Hucre TUM tekrarlarin ozeti. Eskiden yalniz ILK yanita bakiliyordu:
    // asistan satiri "7 kaynak" derken soru tablosunda 2 isaret gorunuyordu.
    const ayrinti = denenen.map((p) => soruOzeti(p.probes, soru));
    for (const o of ayrinti) tekrar = Math.max(tekrar, o.yanit);
    return {
      soru,
      markali: markali.get(soru) ?? false,
      sonuclar: ayrinti.map(ozetSonucu),
      ayrinti,
    };
  });
  return { asistanlar, sorgular, tekrar };
}

function aiDerle(g: RaporGirdisi): RaporAi {
  const auditAi = nesne(nesne(g.audit?.checks).aiCitations);
  const auditOlculdu = aiCitationsOlculdu(auditAi);

  // Kaynak: en son kosum kaydi; yoksa taramanin GERCEKTEN olculen AI adimi
  let kaynak: { tarih: string; providers: RunProvider[] } | null = null;
  if (g.aiKosum) kaynak = { tarih: iso(g.aiKosum.runAt), providers: saglayicilar(g.aiKosum.providers) };
  else if (auditOlculdu && g.audit) {
    kaynak = { tarih: typeof auditAi.ranAt === 'string' ? auditAi.ranAt : iso(g.audit.ranAt), providers: saglayicilar(auditAi.providers) };
  }

  let olcum: RaporAi['olcum'];
  if (!kaynak) {
    const atlama = nesne(auditAi.skipped);
    olcum = olculemedi(typeof atlama.message === 'string' && atlama.message ? `${OLCULMEDI}. ${atlama.message}` : OLCULMEDI);
  } else {
    const { asistanlar, sorgular, tekrar } = aiMatrisi(kaynak.providers);
    // Manset sayisi panelle AYNI kaynaktan (KpiRow: headline ?? olculen tarama skoru)
    let skor: number | null = null;
    let skorTuru: 'rolling' | 'first-run' | 'son-olcum' = 'son-olcum';
    if (g.aiManset && typeof g.aiManset.score === 'number' && g.aiManset.method) {
      skor = g.aiManset.score;
      skorTuru = g.aiManset.method;
    } else if (auditOlculdu && typeof auditAi.score === 'number' && !g.aiKosum) {
      skor = auditAi.score;
    } else {
      skor = headlineOfProviders(kaynak.providers);
    }
    olcum = { olculemedi: false, tarih: kaynak.tarih, skor, skorTuru, asistanlar, sorgular, tekrar };
  }

  const k = g.kpi;
  const markasizYok = 'Son 7 günde marka adı geçmeyen soru ölçümü yok.';
  return {
    olcum,
    anilmaOrani: k && typeof k.mentionRate === 'number'
      ? { olculemedi: false, deger: k.mentionRate, markasizOlcum: k.unbrandedCount }
      : olculemedi(`${OLCULMEDI}. ${markasizYok}`),
    sesPayi: k && typeof k.shareOfVoice === 'number'
      ? { olculemedi: false, deger: k.shareOfVoice }
      : olculemedi(`${OLCULMEDI}. Son 7 günde rakiplerle birlikte anılma ölçümü yok.`),
    rakipler: {
      tanimli: g.rakipler.tanimli,
      sesPayiListesi: g.rakipler.sesPayi.length > 0
        ? {
          olculemedi: false,
          liste: g.rakipler.sesPayi.map((e) => ({ ad: e.name, anilma: e.mentions, yuzde: e.pct, marka: e.isBrand === true })),
        }
        : olculemedi(OLCULMEDI),
    },
    yontemNotu: AI_SKOR_YONTEMI,
  };
}

// ─── Aksiyonlar ─────────────────────────────────────────────────────

const ETKI_SIRA: Record<Etki, number> = { yuksek: 0, orta: 1, dusuk: 2 };
const EFOR_SIRA: Record<string, number> = { kolay: 0, orta: 1, zor: 2, yok: 3 };

function etkiOf(v: string): Etki {
  return v === 'high' ? 'yuksek' : v === 'low' ? 'dusuk' : 'orta';
}

function eforOf(v: string): Efor | null {
  return v === 'easy' ? 'kolay' : v === 'hard' ? 'zor' : v === 'medium' ? 'orta' : null;
}

/** Sorunun ait oldugu aksiyon ailesi (kontrol): pagespeed_* tek "sayfa hizi" ailesinde toplanir */
function aksiyonAnahtari(issue: Issue): string | null {
  const id = String(issue.checkId ?? '');
  if (id === 'pagespeed' || String(issue.type ?? '').startsWith('pagespeed_')) return 'pagespeed';
  return aksiyonMetni(id, issue.type) ? id : null;
}

/**
 * Aksiyon satirinin tekillestirme anahtari. Kontrol basina TEK aksiyon; yalniz
 * "ayri is" diye isaretli tipler (AKSIYON_TIP_METINLERI.ayri — ör. robots.txt'te
 * bot engeli ile eksik site haritasi satiri) kendi satirini alir.
 */
function aksiyonSatiri(anahtar: string, issue: Issue): string {
  const tip = String(issue.type ?? '');
  return AKSIYON_TIP_METINLERI[tip]?.ayri ? `${anahtar}#${tip}` : anahtar;
}

export const AKSIYON_SINIRI = 10;

/** GEO sorununun checkId'si → checks.geo.methods kimligi (sinyal skoru icin) */
const GEO_SINYALI: Record<string, string> = {
  geo_faq: 'faq_qa',
  geo_definition: 'definition',
  geo_citation_format: 'citation_format',
  geo_freshness: 'freshness',
  geo_evidence: 'evidence',
  geo_depth: 'depth',
};

function aksiyonlariDerle(g: RaporGirdisi, ai: RaporAi): RaporAksiyon[] {
  const plan: RaporAksiyon[] = g.aksiyonPlani
    .filter((i) => i.status === 'todo' || i.status === 'in_progress')
    .map((i) => ({
      baslik: i.title,
      // Aciklama yalniz ELLE yazilan maddede basilir. Sistemin urettigi maddelerin
      // (ajan hazirligi, haftalik plan, sohbet…) aciklamasi panel dilindedir ("sen",
      // "ekle", "karar senin") ve musteri raporuna girmez; baslik kalir.
      aciklama: i.source === 'manual' ? i.description ?? null : null,
      etki: etkiOf(i.impact),
      efor: eforOf(i.effort),
      kaynak: 'plan' as const,
      durum: i.status as 'todo' | 'in_progress',
    }));
  // Plana zaten alinmis tarama bulgusu ikinci kez turetilmez
  const plandakiler = new Set(g.aksiyonPlani.filter((i) => i.source === 'audit' && i.sourceRef).map((i) => String(i.sourceRef)));

  const checks = nesne(g.audit?.checks);
  const geoSinyalleri = Array.isArray(nesne(checks.geo).methods) ? (nesne(checks.geo).methods as any[]) : [];
  const tumSorunlar = issuesOf(g.audit?.issues);
  const hizMetinleri = tumSorunlar.filter((i) => aksiyonAnahtari(i) === 'pagespeed').map((i) => metinOf(i.description));

  const turetilen: RaporAksiyon[] = [];
  const gorulen = new Set<string>();
  // Kritik once, sonra uyari; bilgi duzeyi bulgu aksiyona donusmez
  const sirali = onemSirali(tumSorunlar.filter(ciddi));
  for (const issue of sirali) {
    const anahtar = aksiyonAnahtari(issue);
    if (!anahtar || plandakiler.has(anahtar)) continue;
    const satir = aksiyonSatiri(anahtar, issue);
    if (gorulen.has(satir)) continue;
    gorulen.add(satir);
    // Aciklama rapor cumlesidir; ham tarama metni ("sen" dili, ic notlar) basilmaz
    let aciklama: string | null;
    if (anahtar === 'ai_citation') {
      // AI sayisi yalniz raporun AI olcumunden: bulgu metnindeki tarama skoru
      // mansetten farkli olabilir. Manset artik dusuk degilse bulgu eskimistir.
      const manset = ai.olcum.olculemedi ? null : ai.olcum.skor;
      if (typeof manset === 'number' && manset >= AI_DUSUK_ESIGI) continue;
      aciklama = aiGorunurlukAksiyonAciklamasi(manset);
    } else if (anahtar === 'pagespeed') {
      aciklama = hizAksiyonAciklamasi(hizMetinleri);
    } else {
      const sinyal = geoSinyalleri.find((m) => m?.id === GEO_SINYALI[anahtar]);
      aciklama = bulguMetni(issue.type, {
        details: nesne(nesne(checks[anahtar]).details),
        description: metinOf(issue.description),
        sinyalSkoru: sayi(sinyal?.score),
      });
    }
    const metin = aksiyonMetni(anahtar, issue.type)!;
    turetilen.push({
      baslik: metin.baslik,
      aciklama,
      etki: metin.etki ?? (issue.severity === 'critical' ? 'yuksek' : 'orta'),
      efor: metin.efor,
      kaynak: 'tarama',
      durum: 'todo',
    });
  }

  return [...plan, ...turetilen]
    .map((a, i) => ({ a, i }))
    .sort((x, y) =>
      ETKI_SIRA[x.a.etki] - ETKI_SIRA[y.a.etki]
      || EFOR_SIRA[x.a.efor ?? 'yok'] - EFOR_SIRA[y.a.efor ?? 'yok']
      || (x.a.kaynak === 'plan' ? 0 : 1) - (y.a.kaynak === 'plan' ? 0 : 1)
      || x.i - y.i)
    .slice(0, AKSIYON_SINIRI)
    .map(({ a }) => a);
}

// ─── Ozet (deterministik) ───────────────────────────────────────────

/** Sayfa sorununun cumle ici kisa ifadesi */
const KISA_IFADE: Record<string, (n: number) => string> = {
  meta_desc_missing: (n) => `${n} sayfada meta açıklama yok`,
  meta_desc_short: (n) => `${n} sayfada meta açıklama çok kısa`,
  meta_title_missing: (n) => `${n} sayfada başlık etiketi yok`,
  meta_title_short: (n) => `${n} sayfada başlık çok kısa`,
  meta_title_long: (n) => `${n} sayfada başlık 60 karakteri aşıyor`,
  h1_missing: (n) => `${n} sayfada H1 başlığı yok`,
  h1_duplicate: (n) => `${n} H1 başlığı birden çok sayfada tekrarlanıyor`,
  js_shell_pages: (n) => `${n} sayfanın içeriği yalnız JavaScript ile oluşuyor`,
  image_alt_missing: (n) => `${n} görselde alt metni yok`,
  image_alt_suspicious: (n) => `${n} görselin alt metni görseli anlatmıyor`,
  orphan_pages: (n) => `${n} sayfa hiçbir sayfadan bağlantı almıyor`,
};

function skorBandi(s: number): string {
  return s >= 80 ? 'iyi düzey' : s >= 50 ? 'geliştirilmeye açık' : 'zayıf düzey';
}

function noktasiz(s: string): string {
  return s.replace(/[.\s]+$/, '');
}

/**
 * Yonetici ozeti — 3-5 cumle, YALNIZ sablon. Ayni govde her zaman ayni metni
 * uretir (LLM yok, saat yok, rastgelelik yok); olculmeyen alan "olculmedi"
 * diye soylenir, tahmin edilmez.
 */
export function ozetMetni(r: Omit<MusteriRaporu, 'ozet'>): string[] {
  const out: string[] = [];
  const ad = r.site.ad || r.site.host;

  if (r.seo.olculemedi) {
    out.push(r.seo.neden === 'Site henüz taranmadı.'
      ? `${ad} henüz taranmadı; SEO bulguları ilk taramadan sonra rapora girer.`
      : `${ad} taranamadı: ${noktasiz(r.seo.neden.replace(/^Site taranamadı:\s*/, ''))}.`);
  } else if (r.seo.siteSkoru === null) {
    out.push(`${ad} için site skoru güncel değil. ${noktasiz(r.seo.guncelDegil ?? 'Son taramada skor üretilmedi')}.`);
  } else {
    const s = r.seo;
    out.push(
      `${ad} için ${trTarih(s.taramaTarihi)} tarihli taramada site skoru ${s.siteSkoru}/100 (${skorBandi(s.siteSkoru!)}). ` +
      `${s.sayac.toplam} kontrolün ${s.sayac.gecti} tanesi geçti; ${s.sayac.kritik} kontrolde kritik, ${s.sayac.uyari} kontrolde uyarı düzeyinde sorun var.`,
    );
  }

  if (!r.seo.olculemedi) {
    const ifadeler = r.seo.sayfaSorunlari
      .filter((p) => p.onem !== 'bilgi' && p.sayi !== null && p.sayi > 0 && KISA_IFADE[p.tur])
      .slice(0, 3)
      .map((p) => KISA_IFADE[p.tur](p.sayi!));
    if (ifadeler.length > 0) out.push(`Öne çıkan sayfa sorunları: ${ifadeler.join(', ')}.`);
    else if (r.seo.sayfaSorunlari.length === 0) out.push('Taramada sayfa düzeyinde sorun bulunmadı.');
  }

  if (!r.geo.olculemedi) {
    const g = r.geo;
    const parcalar: string[] = [];
    parcalar.push(g.llmsTxt === 'var' ? 'llms.txt mevcut' : g.llmsTxt === 'yok' ? 'llms.txt yok' : 'llms.txt doğrulanamadı');
    if (!g.robots.olculemedi) {
      const engelli = g.robots.aramaBotlari.filter((b) => b.erisim === 'engelli').map((b) => b.ad);
      parcalar.push(!g.robots.dosya
        ? 'robots.txt yok (botlar varsayılan olarak serbest)'
        : engelli.length > 0
          ? `robots.txt şu arama botlarını engelliyor: ${engelli.join(', ')}`
          : 'robots.txt arama botlarına açık');
    }
    if (!g.schema.olculemedi) parcalar.push(`yapısal veri kapsamı ${trYuzde(g.schema.oran)}`);
    out.push(`AI hazırlığı: ${parcalar.join('; ')}.`);
  }

  const ai = r.ai;
  if (ai.olcum.olculemedi) {
    out.push('AI asistanlarındaki görünürlük henüz ölçülmedi.');
  } else {
    const olculen = ai.olcum.asistanlar.filter((a) => a.sonuc !== 'olculemedi');
    const gorunen = olculen.filter((a) => a.sonuc === 'alinti' || a.sonuc === 'anilma');
    const tur = ai.olcum.skorTuru === 'rolling' ? 'son 7 ölçüm gününün ortalaması' : ai.olcum.skorTuru === 'first-run' ? 'ilk ölçüm' : 'son ölçüm';
    const skorMetni = ai.olcum.skor === null ? 'AI görünürlük skoru hesaplanamadı' : `AI görünürlük skoru ${ai.olcum.skor}/100 (${tur})`;
    let cumle = `${skorMetni}: ${trTarih(ai.olcum.tarih)} ölçümünde ${olculen.length} AI asistanının ${gorunen.length} tanesinde site kaynak gösterildi ya da marka adı geçti.`;
    const eksik = [ai.anilmaOrani.olculemedi ? 'anılma oranı' : null, ai.sesPayi.olculemedi ? 'ses payı' : null].filter(Boolean);
    if (eksik.length === 2) cumle += ' Anılma oranı ve ses payı henüz ölçülmedi.';
    else if (eksik.length === 1) cumle += ` ${eksik[0] === 'anılma oranı' ? 'Anılma oranı' : 'Ses payı'} henüz ölçülmedi.`;
    out.push(cumle);
  }

  // 3-5 cumle sozlesmesi: veri azsa (yeni site) icerik ve bot durumu eklenir;
  // fazlaysa aksiyon cumlesi yer bulsun diye ilk dort cekirdek cumle tutulur
  if (out.length < 3) {
    // "N içerik takvimde" tek basina, musterinin istemedigi bir plan varmis gibi
    // okunuyordu: takvimin RanksUp'in icerik takvimi oldugu acik yazilir.
    const takvim = r.icerik.takvimde > 0 ? `RanksUp içerik takviminde ${r.icerik.takvimde} planlı içerik var` : null;
    out.push(r.icerik.yayinda > 0
      ? `RanksUp ile ${r.icerik.yayinda} içerik yayınlandı${takvim ? `; ${takvim}` : ''}.`
      : takvim ? `RanksUp ile henüz içerik yayınlanmadı; ${takvim}.` : 'RanksUp ile henüz içerik yayınlanmadı.');
  }
  const cekirdek = out.slice(0, 4);
  if (r.aksiyonlar.length > 0) cekirdek.push(`Öncelikli ilk adım: ${noktasiz(r.aksiyonlar[0].baslik)}.`);
  return cekirdek.slice(0, 5);
}

// ─── KPI ────────────────────────────────────────────────────────────

function kpileriDerle(r: Omit<MusteriRaporu, 'ozet'>): RaporKpi[] {
  const seo = r.seo;
  const ai = r.ai;
  const aiSkor = ai.olcum.olculemedi ? null : ai.olcum.skor;
  const aiIpucu = ai.olcum.olculemedi || aiSkor === null
    ? OLCULMEDI
    : ai.olcum.skorTuru === 'rolling' ? '7 günlük ortalama' : ai.olcum.skorTuru === 'first-run' ? 'İlk ölçüm' : 'Son ölçüm';
  return [
    {
      anahtar: 'siteSkoru',
      etiket: 'Site skoru',
      deger: seo.olculemedi ? null : seo.siteSkoru,
      sonek: !seo.olculemedi && seo.siteSkoru !== null ? '/100' : null,
      ipucu: seo.olculemedi ? 'Tarama bekleniyor' : seo.siteSkoru === null ? 'Güncel değil' : `${seo.bulgu.toplam} sorun`,
    },
    { anahtar: 'aiGorunurluk', etiket: 'AI görünürlük', deger: aiSkor, sonek: aiSkor !== null ? '/100' : null, ipucu: aiIpucu },
    {
      anahtar: 'anilmaOrani',
      etiket: 'Anılma oranı (markasız)',
      deger: ai.anilmaOrani.olculemedi ? null : ai.anilmaOrani.deger,
      sonek: ai.anilmaOrani.olculemedi ? null : '%',
      ipucu: ai.anilmaOrani.olculemedi ? OLCULMEDI : 'Son 7 gün',
    },
    {
      anahtar: 'sesPayi',
      etiket: 'Ses payı',
      deger: ai.sesPayi.olculemedi ? null : ai.sesPayi.deger,
      sonek: ai.sesPayi.olculemedi ? null : '%',
      ipucu: ai.sesPayi.olculemedi ? OLCULMEDI : 'Rakiplere göre · son 7 gün',
    },
    {
      anahtar: 'aiBot',
      etiket: 'AI bot ziyareti',
      deger: r.botlar.olculemedi ? null : r.botlar.son7,
      sonek: null,
      ipucu: r.botlar.olculemedi ? 'Takip kurulmamış' : 'Son 7 gün',
    },
    {
      anahtar: 'yayinda',
      etiket: 'Yayınlanan içerik',
      deger: r.icerik.yayinda,
      sonek: null,
      // Takvim sayisi ozet seridinde yok (GEO bolumunde "RanksUp içerik takvimi" diye durur)
      ipucu: 'RanksUp ile',
    },
  ];
}

// ─── Ana derleyici ──────────────────────────────────────────────────

export function buildClientReport(g: RaporGirdisi, now: Date): MusteriRaporu {
  const seo = seoDerle(g);
  const geo = geoDerle(g);
  const ai = aiDerle(g);
  const botlar: MusteriRaporu['botlar'] = g.botlar.takipVar
    ? {
      olculemedi: false, son7: g.botlar.son7, son30: g.botlar.son30, botlar: g.botlar.botlar,
      ...(g.botlar.dogrulanamayan30 ? { dogrulanamayan30: g.botlar.dogrulanamayan30 } : {}),
    }
    : olculemedi('AI bot ziyaretleri ölçülmüyor: siteye RanksUp takip kodu kurulmamış.');
  const aksiyonlar = aksiyonlariDerle(g, ai);

  const yontem = [
    'Bu rapor RanksUp’ta kayıtlı en son ölçümlerden derlendi; rapor için yeni bir tarama ya da AI sorgusu çalıştırılmadı. Her bölümün dayandığı verinin tarihi bölüm başlığında yazar.',
    'Site taraması sunucunun gönderdiği HTML’i okur; JavaScript ile sonradan yüklenen içerik ve görseller görünmeyebilir.',
    AI_SKOR_YONTEMI,
    'AI asistanlarının yanıtları ölçümden ölçüme değişebilir; tek bir ölçüm kesin bir sıralama değildir.',
    'Anılma oranı ve ses payı, son 7 günde marka adı geçmeyen sorularla yapılan takip ölçümlerinden hesaplanır.',
    'Taramadan türetilen aksiyonların etki ve efor etiketleri kural tabanlıdır: etki çoğunlukla bulgunun önem düzeyinden gelir, görünürlüğe etkisi sınırlı adımlar (ör. robots.txt dosyasının yokluğu) “düşük etki” olarak işaretlenir; efor düzeltme yolundan gelir (RanksUp’ın otomatik düzeltebildiği dosyalar “kolay”).',
    '“Henüz ölçülmedi” yazan alanlarda veri yoktur; bu alanlar sıfır olarak yorumlanmamalıdır.',
  ];
  if (!ai.olcum.olculemedi && (ai.olcum.tekrar ?? 1) > 1) {
    // AI_SKOR_YONTEMI'nden hemen sonra: "15 yanıt" sayisinin nereden geldigi
    // "en fazla": gunluk butce payi dar kalan asistan daha az tekrarla sorulabilir (citation-repeat.ts)
    yontem.splice(3, 0, `AI görünürlük ölçümünde her soru bir asistana birden çok kez (en fazla ${ai.olcum.tekrar}) soruldu. AI yanıtları her seferinde değişebildiği için asistan skoru bütün yanıtların ortalamasıdır; soru tablosundaki sayılar, yanıtların kaçında sitenin kaynak gösterildiğini ya da marka adının geçtiğini gösterir.`);
  }
  if (!seo.olculemedi && seo.bilgiKontrolleri && seo.bilgiKontrolleri.length > 0) {
    yontem.push('Bilgi amaçlı kontroller “geçti” ya da “sorunlu” sayılmaz ve kontrol sayısına dahil edilmez.');
  }
  if (!seo.olculemedi && seo.taranamayanSayfa > 0) {
    yontem.push(`${seo.taranamayanSayfa} sayfa erişim engeli nedeniyle taranamadı ve skora dahil edilmedi.`);
  }

  const govde: Omit<MusteriRaporu, 'ozet'> = {
    surum: MUSTERI_RAPORU_SURUM,
    generatedAt: now.toISOString(),
    site: { ad: g.site.name, url: g.site.url, host: hostOf(g.site.url) },
    kaynaklar: {
      tarama: g.audit ? iso(g.audit.ranAt) : null,
      aiOlcum: ai.olcum.olculemedi ? null : ai.olcum.tarih,
      aiOranlari: { baslangic: new Date(now.getTime() - 7 * DAY_MS).toISOString(), bitis: now.toISOString() },
      botZiyaret: { baslangic: new Date(now.getTime() - 30 * DAY_MS).toISOString(), bitis: now.toISOString() },
      ajanHazirligi: g.ajanHazirligi?.ranAt ?? null,
    },
    seo,
    geo,
    ai,
    botlar,
    icerik: g.icerik,
    aksiyonlar,
    yontem,
  };
  return { ...govde, ozet: { kpiler: kpileriDerle(govde), metin: ozetMetni(govde) } };
}
