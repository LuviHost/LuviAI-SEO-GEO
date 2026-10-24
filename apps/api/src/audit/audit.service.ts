import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteCrawlerService } from '../sites/site-crawler.service.js';
import {
  clearCrawlAccess, CrawlAccessError, crawlAccessNewerThanAudit, readCrawlAccess, recordCrawlAccess,
} from '../sites/crawl-access.js';
import { WEEKLY_MEASUREMENT_LIMIT_CODE } from '../billing/measurement-allowance.js';
import { AuditChecksService, isUnverifiedCheck, OVERALL_SCORE_WEIGHTS } from './audit-checks.service.js';
import { PageSpeedService } from './pagespeed.service.js';
import { GeoRunnerService } from './geo-runner.service.js';
import { AiCitationService } from './ai-citation.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { groupIssues } from './issue-grouping.js';
import { annotateAuditFixRoutes, withFixRoutes } from './fix-routes.js';
import { ImageInventoryService } from './image-alt/image-inventory.service.js';
import { recordSiteNapFromCrawl } from './site-nap.js';
import { CITATION_MATCH_VERSION } from './host-match.js';
import { providersWithoutSources } from './citation-sources.js';

/**
 * Taramayi kim baslatti.
 *
 * 'user'   — kullanici panelden "Yeni tarama" dedi. RAPORDA SAYILAN TEK TUR.
 * 'system' — AUDIT_CRON haftalik otomatik tarama. Gercek bir tarama ama
 *            kullanicinin yaptigi bir is degil; "yapilan is" sayisina
 *            katilirsa cron acildigi gun sayi kendiliginden sisar.
 * 'test'   — uretimde dogrulama kosumu. Bu tur, tam olarak boyle bir kosumun
 *            kullanici taramalarindan ayirt edilemedigi fark edilince eklendi.
 */
export type AuditTrigger = 'user' | 'system' | 'test';

/** Bir taramanin karsilastirmada kullanilan ozet kimligi */
export interface AuditOzet {
  id: string;
  ranAt: Date;
  overallScore: number;
  geoScore: number | null;
}

/**
 * metodoloji_degisti: kontrolun olcum yontemi iki tarama arasinda degisti
 * (details.methodVersion). Skor farki sitenin degil OLCUNUN degisimidir →
 * delta 0, sorunlari cozulen/yeni sayilmaz.
 */
export type CheckDurum = 'iyilesti' | 'kotulesti' | 'ayni' | 'yeni' | 'kayboldu' | 'metodoloji_degisti';

export interface CheckDelta {
  id: string;
  oncekiScore: number | null;
  sonrakiScore: number | null;
  delta: number;
  durum: CheckDurum;
}

export interface AuditIssueKaydi {
  severity?: string;
  type?: string;
  page?: string;
  description?: string;
  fixable?: boolean;
  checkId?: string;
  [k: string]: unknown;
}

/**
 * Karsilastirma KISMI: taramalardan biri bazi seyleri olcemedi. Yalnizca
 * kismi oldugunda doner (alan yoksa iki tarama ayni kapsamla olculmustur).
 */
export interface KismiKarsilastirma {
  /**
   * Onceki taramada olculup son taramada OLCULEMEYEN kontroller (erisim
   * engeli, atlanan AI olcumu, PageSpeed hatasi). Bunlarin eski sorunlari
   * `issues.olculemedi`de — "cozuldu" denmez.
   */
  olculemeyenKontroller: string[];
  /**
   * Genel skora giren ve iki taramadan YALNIZ BIRINDE olculebilen kontroller.
   * Genel skor yalniz olculebilen kontrollerden hesaplandigi icin scoreDelta
   * bu kontrollerin dahil/haric olmasindan da etkilenir.
   */
  skorKapsamiFarkli: string[];
  /**
   * Son taramanin sayfa kapsami oncekinden dar: tarama bot korumasi yuzunden
   * erken durdu ya da yeni sayfalar engellendi. Sayfa kontrollerinin
   * kaybolan sorunlari `issues.olculemedi`de. Kapsam esitse null.
   */
  sayfaKapsami: { erkenDurdu: boolean; engellenenSayfa: number } | null;
}

export interface AuditKarsilastirma {
  from: AuditOzet | null;
  to: AuditOzet | null;
  scoreDelta: number;
  geoScoreDelta: number;
  checks: CheckDelta[];
  issues: {
    cozulen: AuditIssueKaydi[];
    yeniCikan: AuditIssueKaydi[];
    devamEden: AuditIssueKaydi[];
    /**
     * Onceki taramadaki sorun son taramada YENIDEN OLCULEMEDI (kontrol
     * dogrulanamadi, GEO engellendi, AI olcumu atlandi, sayfa taranamadi).
     * Sorunun listede olmamasi cozuldugu anlamina gelmez; cozulen sayilmaz.
     */
    olculemedi: AuditIssueKaydi[];
  };
  ozet: { cozulenSayisi: number; yeniSayisi: number; devamEdenSayisi: number; olculemeyenSayisi: number };
  yeterliVeriYok?: boolean;
  /** Olcum yontemi degisen kontroller — genel skor farkinin bir kismi buradan */
  metodolojiDegisen?: string[];
  /** Karsilastirma kismiysa nedenleri; tam karsilastirmada alan yok */
  kismi?: KismiKarsilastirma;
  /**
   * AI gorunurluk olcumunde iki taramanin OLCULEN asistan kumesi farkli
   * (biri 429/kota/anahtar yuzunden olculemedi). aiCitations farki yalniz
   * `ortak` asistanlar uzerinden hesaplandi; ortak yoksa satir uretilmedi.
   * Kume ayniysa alan yok.
   */
  aiSaglayiciKapsami?: { ortak: string[]; yalnizOnceki: string[]; yalnizSonraki: string[] };
}

/**
 * Taramanin AI gorunurluk bolumu atlandiysa nedeni (checks.aiCitations.skipped).
 *
 * NEDEN: hicbir asistan olculemediginde `score: 0` yaziliyordu. Haftalik olcum
 * hakki (measurement-allowance.ts) yuzunden hak kullanildiktan sonraki 7 gun
 * icinde baslatilan HER kullanici denetimi bu yola dusuyor; panel "0/100",
 * karsilastirma "20 → 0 (−20)" ve eski ai_citation_low icin "cozuldu"
 * gosteriyordu. Artik skor null + neden.
 */
export interface AiCitationSkip {
  /** WEEKLY_MEASUREMENT_LIMIT | CITATION_QUOTA | NOT_RUN | NO_PROVIDER | NO_SCORE | ERROR */
  code: string;
  /** Kullaniciya gosterilecek Turkce aciklama */
  message: string;
  /** Haftalik hak doluysa bir sonraki olcumun acilacagi an (ISO); yoksa null */
  nextAvailableAt: string | null;
}

/** runForSite hatasindan atlama nedeni — HttpException govdesi (code, nextAvailableAt) okunur */
export function aiCitationSkipFromError(err: unknown): AiCitationSkip {
  const e = err as { getResponse?: () => unknown; response?: unknown; status?: unknown } | null;
  const body = (typeof e?.getResponse === 'function' ? e.getResponse() : e?.response) as
    | { code?: unknown; statusCode?: unknown; nextAvailableAt?: unknown }
    | string
    | null
    | undefined;
  const b = body && typeof body === 'object' ? body : null;
  if (b?.code === WEEKLY_MEASUREMENT_LIMIT_CODE) {
    return {
      code: WEEKLY_MEASUREMENT_LIMIT_CODE,
      message: 'Haftalık AI ölçüm hakkı kullanıldığı için bu taramada AI ölçümü yapılmadı.',
      nextAvailableAt: typeof b.nextAvailableAt === 'string' ? b.nextAvailableAt : null,
    };
  }
  // quota.service enforceCitationQuota → ForbiddenException (403). Ham mesaj
  // gecirilmez: kullaniciya yalniz ne oldugu soylenir.
  if (b?.statusCode === 403 || e?.status === 403) {
    return {
      code: 'CITATION_QUOTA',
      message: 'Aylık AI ölçüm kotası dolduğu için bu taramada AI ölçümü yapılmadı.',
      nextAvailableAt: null,
    };
  }
  return { code: 'ERROR', message: 'AI ölçümü bu taramada tamamlanamadı.', nextAvailableAt: null };
}

/** Hata olmadan bos/olcumsuz donen sonuctan atlama nedeni */
export function aiCitationSkipFromResults(
  results: Array<{ available?: boolean; score?: number | null }>,
): AiCitationSkip {
  if (results.length === 0) {
    return { code: 'NOT_RUN', message: 'Bu taramada AI ölçümü çalıştırılmadı.', nextAvailableAt: null };
  }
  if (!results.some((r) => r.available)) {
    return {
      code: 'NO_PROVIDER',
      message: 'Hiçbir AI asistanı ölçüm döndüremedi (anahtar, kota ya da servis hatası).',
      nextAvailableAt: null,
    };
  }
  // Skor yalniz markasiz VE olculebilen (HATA olmayan) sorulardan hesaplanir
  // (citation-score.ts); ikisi de kalmadiysa skor yoktur — 0 degil.
  return {
    code: 'NO_SCORE',
    message: 'Görünürlük skoru hesaplanamadı: sorulan soruların hepsi marka adını içeriyordu ya da AI asistanlarının yanıtları hata verdi.',
    nextAvailableAt: null,
  };
}

/**
 * checks.aiCitations GERCEK bir olcum mu?
 *
 * Okuma tarafi korumasi eski satirlar icin de gerekli: onceki surum hicbir
 * asistan olculemediginde `score: 0, providers: []` yaziyordu. Olcum = atlama
 * isareti yok, sayisal skor var ve (saglayici listesi varsa) en az bir
 * asistan sayisal skor dondurmus.
 */
export function aiCitationsOlculdu(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as { score?: unknown; providers?: unknown; skipped?: unknown };
  if (e.skipped) return false;
  if (typeof e.score !== 'number' || !Number.isFinite(e.score)) return false;
  if (!Array.isArray(e.providers)) return true;
  return e.providers.some(
    (p) => (p as { available?: unknown } | null)?.available === true && typeof (p as { score?: unknown }).score === 'number',
  );
}

/**
 * checks.aiCitations'ta sayisal skor donduren (olculen) asistanlar → skor.
 * Asistan listesi tasimayan eski/elle yazilmis kayitta null (kapsam bilinmiyor).
 */
function aiSaglayiciSkorlari(entry: unknown): Map<string, number> | null {
  const providers = (entry as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(providers)) return null;
  const out = new Map<string, number>();
  for (const p of providers) {
    const q = p as { provider?: unknown; available?: unknown; score?: unknown } | null;
    if (q?.available === true && typeof q.provider === 'string' && typeof q.score === 'number' && Number.isFinite(q.score)) {
      out.set(q.provider, q.score);
    }
  }
  return out;
}

/**
 * aiCitations skoru asistan ORTALAMASIDIR (runAudit aiCitationAvg). Iki
 * taramada olculen asistan kumesi farkliysa (429 alan asistan ortalamadan
 * duser) ham skorlarin farki sitenin degil bilesimin degisimidir: Claude
 * 100 + digerleri 0 iken Claude olculemeyince 17 → 0 "kotulesti" gorunuyordu.
 * Bu durumda iki tarafin skoru yalniz IKI taramada da olculen asistanlar
 * uzerinden yeniden ortalanir (citation-run-compare ile ayni kural).
 */
function aiCitationKapsami(fromEntry: unknown, toEntry: unknown):
  | { farkli: false }
  | { farkli: true; ortak: string[]; yalnizOnceki: string[]; yalnizSonraki: string[]; onceki: number | null; sonraki: number | null }
  | null {
  const a = aiSaglayiciSkorlari(fromEntry);
  const b = aiSaglayiciSkorlari(toEntry);
  if (!a || !b) return null;
  const ortak = [...a.keys()].filter((p) => b.has(p)).sort();
  const yalnizOnceki = [...a.keys()].filter((p) => !b.has(p)).sort();
  const yalnizSonraki = [...b.keys()].filter((p) => !a.has(p)).sort();
  if (yalnizOnceki.length === 0 && yalnizSonraki.length === 0) return { farkli: false };
  const ort = (m: Map<string, number>) =>
    ortak.length === 0 ? null : Math.round(ortak.reduce((s, p) => s + m.get(p)!, 0) / ortak.length);
  return { farkli: true, ortak, yalnizOnceki, yalnizSonraki, onceki: ort(a), sonraki: ort(b) };
}

/** checks girdisinin olcum yontemi surumu; alan yoksa 1 (v2 oncesi) */
export function checkMethodVersion(entry: unknown): number {
  const v = (entry as { details?: { methodVersion?: unknown } } | null)?.details?.methodVersion;
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}

/**
 * Issue eslestirme anahtari.
 *
 * Audit.issues opak bir Json dizisi; kayitlarin KALICI id'si yok, her tarama
 * listeyi sifirdan uretiyor. Iki tarama arasinda "ayni sorun mu" sorusunu
 * cevaplamak icin en kararli bilesim `type + page`: type kontrol uretecinden
 * sabit gelir (meta_title_missing gibi), page ise sorunun hangi URL'de
 * oldugunu ayirir — ayni type farkli sayfalarda ayri sorun sayilmali.
 * Ikisi de yoksa (ornek: PageSpeed/GEO gibi site geneli, type'siz kayitlar)
 * description'in ilk 80 karakterine duseriz; tam metin degil, cunku aciklama
 * icinde degisen sayilar (skor, saniye) var ve bunlar her taramada oynayip
 * ayni sorunu "cozuldu + yeni cikti" olarak ikiye bolerdi.
 */
export function issueKey(issue: AuditIssueKaydi): string {
  const type = typeof issue?.type === 'string' ? issue.type.trim() : '';
  const page = typeof issue?.page === 'string' ? issue.page.trim() : '';
  if (type || page) return `${type}|${page}`;
  const desc = typeof issue?.description === 'string' ? issue.description : '';
  return `desc:${desc.slice(0, 80)}`;
}

/** checks Json'undaki bir girdiden 0-100 skoru cikarir; olculmediyse null */
function checkScore(id: string, entry: unknown): number | null {
  if (!entry || typeof entry !== 'object') return null;
  // Dogrulanamayan kontrol (erisim engeli / sunucu hatasi) olcum degil:
  // 100 → 0 "kotulesti" diye gosterilmesin
  if (isUnverifiedCheck(entry)) return null;
  // Atlanan AI olcumu (haftalik hak, kota, saglayici yok) — eski satirlarin
  // `score: 0, providers: []` kaydi dahil — "20 → 0 (−20)" uretmesin
  if (id === 'aiCitations' && !aiCitationsOlculdu(entry)) return null;
  const s = (entry as { score?: unknown }).score;
  return typeof s === 'number' && Number.isFinite(s) ? s : null;
}

/**
 * Sorunun checkId'si → checks Json anahtari. runAudit GEO sorunlarini
 * 'geo_faq' gibi, AI sorununu 'ai_citation' diye damgalar; olcumleri ise
 * checks.geo ve checks.aiCitations altindadir.
 */
export function issueCheckKey(checkId: unknown): string | null {
  if (typeof checkId !== 'string' || !checkId) return null;
  if (checkId.startsWith('geo_')) return 'geo';
  if (checkId === 'ai_citation') return 'aiCitations';
  return checkId;
}

/**
 * Erisim / kapsam bilgi notlari (runAudit: '<kontrol>_unverified',
 * 'crawl_pages_blocked'). Sitenin sorunu degil, NEYIN olculemedigi —
 * cozulen / yeni / devam eden sayimlarina girmez.
 */
const KAPSAM_NOTU_CHECK_ID = 'crawl_access';

/**
 * Sonucu taranan sayfa kumesine bagli kontroller. Sayfalar engellendiyse ya
 * da tarama erken durduysa bu kontrollerin kaybolan sorunu "cozuldu"
 * sayilamaz: sorunlu sayfa bu kez hic taranmamis olabilir.
 */
const SAYFA_KONTROLLERI = new Set([
  'meta_title', 'meta_description', 'open_graph', 'twitter_card', 'canonical',
  'h1_uniqueness', 'image_alt', 'internal_linking', 'schema_markup',
]);

/** Kontrol bu taramada olculmedi mi? (sorunun yoklugu hukum degildir) */
function kontrolOlculmedi(checks: Record<string, unknown>, key: string): boolean {
  // PageSpeed skor alani tasimaz (performanceScore); API hatasinda girdi null
  if (key === 'pagespeed') return checks[key] == null;
  return checkScore(key, checks[key]) === null;
}

/**
 * Kontrol iki taramada da OLCULDU ama olcum yontemi (details.methodVersion)
 * farkli mi? compareAuditRows'un 'metodoloji_degisti' kurali; tarama gecmisi
 * (getHistory → genelSkorKiyasi) ayni fonksiyonu kullanir ki iki uc ayni iki
 * tarama icin farkli hukum vermesin. Bir tarafta olculmeyen kontrol yontem
 * degil kapsam farkidir (genelSkorKiyasi kapsamiFarkli).
 */
export function olcumYontemiDegisti(id: string, fromEntry: unknown, toEntry: unknown): boolean {
  return checkScore(id, fromEntry) !== null
    && checkScore(id, toEntry) !== null
    && checkMethodVersion(fromEntry) !== checkMethodVersion(toEntry);
}

/** Iki taramanin GENEL skoru ayni olcuyle mi hesaplandi — farklilastiran kontroller */
export interface GenelSkorKiyasi {
  /** Iki taramada da olculen ama yontemi degisen genel skor kontrolleri (compareAuditRows metodolojiDegisen'in genel skor kismi) */
  yontemiDegisen: string[];
  /** Iki taramadan yalniz birinde olculebilen genel skor kontrolleri (compareAuditRows kismi.skorKapsamiFarkli) */
  kapsamiFarkli: string[];
}

/**
 * Genel skor (overallScore) yalniz OVERALL_SCORE_WEIGHTS kontrollerinden ve
 * yalniz olculebilenlerden hesaplanir (computeOverallScore; GEO, AI
 * gorunurluk ve PageSpeed girmez). Iki taramanin skor farki ancak bu
 * kontrollerin hepsi iki tarafta ayni yontemle ve ayni kapsamla olculduyse
 * sitedeki degisimi gosterir. compareAuditRows (skorKapsamiFarkli) ve
 * getHistory (scoreComparableWithPrevious) bu tek fonksiyonu kullanir.
 */
export function genelSkorKiyasi(fromChecks: Record<string, unknown>, toChecks: Record<string, unknown>): GenelSkorKiyasi {
  const yontemiDegisen: string[] = [];
  const kapsamiFarkli: string[] = [];
  for (const id of Object.keys(OVERALL_SCORE_WEIGHTS)) {
    const oncekiOlculdu = !kontrolOlculmedi(fromChecks, id);
    const sonrakiOlculdu = !kontrolOlculmedi(toChecks, id);
    if (oncekiOlculdu !== sonrakiOlculdu) kapsamiFarkli.push(id);
    else if (olcumYontemiDegisti(id, fromChecks[id], toChecks[id])) yontemiDegisen.push(id);
  }
  return { yontemiDegisen: yontemiDegisen.sort(), kapsamiFarkli: kapsamiFarkli.sort() };
}

/**
 * Genel skor kontrollerinin okunur adlari — panel karsilastirma notlariyla
 * (apps/web audit-delta-panel KONTROL_ADI) ayni adlar. Bilinmeyen kimlik
 * oldugu gibi yazilir; spec her OVERALL_SCORE_WEIGHTS kimliginin adi
 * oldugunu denetler.
 */
export const GENEL_SKOR_KONTROL_ADI: Readonly<Record<string, string>> = {
  sitemap_xml: 'sitemap.xml',
  robots_txt: 'robots.txt',
  llms_txt: 'llms.txt',
  schema_markup: 'Schema',
  meta_title: 'Meta başlık',
  meta_description: 'Meta açıklama',
  open_graph: 'Open Graph',
  twitter_card: 'Twitter Card',
  canonical: 'Canonical',
  https: 'HTTPS',
  h1_uniqueness: 'H1',
  image_alt: 'Görsel alt metni',
  internal_linking: 'İç linkleme',
  hreflang: 'Hreflang',
};

/**
 * Tarama gecmisinde skor farkinin NEDEN dogrudan kiyaslanamadigi (Turkce);
 * kiyaslanabiliyorsa null. Panel bu metni oldugu gibi gosterir: neden yontem
 * degisimi, kapsam farki ya da ikisi birden olabilir.
 */
export function genelSkorKiyasNotu(k: GenelSkorKiyasi): string | null {
  const adlar = (ids: string[]) => ids.map((id) => GENEL_SKOR_KONTROL_ADI[id] ?? id).join(', ');
  const parcalar: string[] = [];
  if (k.yontemiDegisen.length > 0) {
    parcalar.push(
      `Bu tarama ile bir önceki tarama, genel skora giren şu kontrolleri farklı ölçüm yöntemleriyle ölçtü: ${adlar(k.yontemiDegisen)}. Skor farkının bir kısmı siteden değil yöntem değişikliğinden kaynaklanabilir.`,
    );
  }
  if (k.kapsamiFarkli.length > 0) {
    parcalar.push(
      `Genel skora giren şu kontroller iki taramadan yalnız birinde ölçülebildi: ${adlar(k.kapsamiFarkli)}. İki skor aynı kontrollerden hesaplanmadığı için fark doğrudan kıyaslanamaz.`,
    );
  }
  return parcalar.length > 0 ? parcalar.join(' ') : null;
}

interface SayfaKapsami {
  erkenDurdu: boolean;
  engellenenSayfa: number;
  /** Engellenen sayfa adresleri; liste kirpilmissa (en fazla 20 saklanir) null */
  adresler: Set<string> | null;
}

/** checks.crawlCoverage (runAudit) → kapsam; bu alani tasimayan eski satir tam kapsam sayilir */
function sayfaKapsamiOf(checks: Record<string, unknown>): SayfaKapsami {
  const c = checks.crawlCoverage as
    | { stoppedEarly?: unknown; blockedCount?: unknown; blockedPages?: unknown }
    | null
    | undefined;
  if (!c || typeof c !== 'object') return { erkenDurdu: false, engellenenSayfa: 0, adresler: new Set() };
  const sayi = Number(c.blockedCount) || 0;
  const liste = Array.isArray(c.blockedPages)
    ? c.blockedPages.map((b) => (b as { url?: unknown } | null)?.url).filter((u): u is string => typeof u === 'string')
    : [];
  return { erkenDurdu: !!c.stoppedEarly, engellenenSayfa: sayi, adresler: liste.length >= sayi ? new Set(liste) : null };
}

/**
 * `hedef` taramanin sayfa kapsami `referans`tan dar mi? Erken duran tarama
 * her zaman dardir. Ayni sayfalar iki taramada da engelliyse kapsam aynidir:
 * kalici bir engel (orn. hep 403 donen tek sayfa) sayfa kontrollerinin
 * "cozulen" listesini sonsuza dek susturmasin.
 */
function sayfaKapsamiDar(hedef: SayfaKapsami, referans: SayfaKapsami): boolean {
  if (hedef.erkenDurdu) return true;
  if (hedef.engellenenSayfa === 0) return false;
  if (!hedef.adresler || !referans.adresler) return true;
  for (const u of hedef.adresler) if (!referans.adresler.has(u)) return true;
  return false;
}

function ozetle(row: any): AuditOzet | null {
  if (!row) return null;
  return {
    id: row.id,
    ranAt: row.ranAt,
    overallScore: row.overallScore,
    geoScore: row.geoScore ?? null,
  };
}

function issueListesi(row: any): AuditIssueKaydi[] {
  const raw = row?.issues;
  return Array.isArray(raw) ? (raw as AuditIssueKaydi[]) : [];
}

/**
 * Iki audit satirini karsilastiran SAF cekirdek — DB'ye dokunmaz, testin
 * hedefi budur. Satirlardan biri (from) null olabilir: ilk tarama durumu.
 */
export function compareAuditRows(fromRow: any, toRow: any): AuditKarsilastirma {
  const from = ozetle(fromRow);
  const to = ozetle(toRow);

  const bos: AuditKarsilastirma = {
    from,
    to,
    scoreDelta: 0,
    geoScoreDelta: 0,
    checks: [],
    issues: { cozulen: [], yeniCikan: [], devamEden: [], olculemedi: [] },
    ozet: { cozulenSayisi: 0, yeniSayisi: 0, devamEdenSayisi: 0, olculemeyenSayisi: 0 },
  };

  // Tek tarama (veya hic tarama) — karsilastiracak referans yok.
  if (!from || !to) return { ...bos, yeterliVeriYok: true };

  // checks her taramada AYNI anahtarlarla yazilir (runAudit'teki create),
  // yani anahtar bazli eslesme guvenli. Yine de eski taramalar yeni eklenen
  // kontrolleri icermeyebilir; o yuzden iki tarafin anahtar birlesimi gezilir.
  const fromChecks = (fromRow?.checks ?? {}) as Record<string, unknown>;
  const toChecks = (toRow?.checks ?? {}) as Record<string, unknown>;
  const checkIds = Array.from(
    new Set([...Object.keys(fromChecks), ...Object.keys(toChecks)]),
  );
  const metodolojiDegisen = new Set<string>();
  // Olculen asistan kumesi degisen kontrol (yalniz aiCitations): yontem
  // degismedi ama bilesim degisti — sorunlari da cozulen/yeni sayilmaz.
  const kapsamiDegisen = new Set<string>();
  let aiSaglayiciKapsami: AuditKarsilastirma['aiSaglayiciKapsami'];

  // ── Skor deltalari ────────────────────────────────────────────
  const scoreDelta = (to.overallScore ?? 0) - (from.overallScore ?? 0);
  // GEO yontemi (GEO_METHOD_VERSION, checks.geo.details.methodVersion) iki
  // taramada farkliysa fark siteden degil olcuden: rozet gosterilmez.
  const geoIkiTaraftaVar = typeof to.geoScore === 'number' && typeof from.geoScore === 'number';
  const geoYontemiFarkli = checkMethodVersion(fromChecks.geo) !== checkMethodVersion(toChecks.geo);
  if (geoIkiTaraftaVar && geoYontemiFarkli) metodolojiDegisen.add('geo');
  const geoScoreDelta = geoIkiTaraftaVar && !geoYontemiFarkli ? to.geoScore! - from.geoScore! : 0;

  // ── Per-check delta ───────────────────────────────────────────
  const checks: CheckDelta[] = [];
  for (const id of checkIds) {
    let oncekiScore = checkScore(id, fromChecks[id]);
    let sonrakiScore = checkScore(id, toChecks[id]);
    // Iki tarafta da skor yoksa (ornek: pagespeed null dondu) satir uretme —
    // kullaniciya "0 -> 0, ayni" gurultusu gosterilmemeli.
    if (oncekiScore === null && sonrakiScore === null) continue;

    // AI gorunurluk: ayni yontemle olculmus ama olculen asistan kumesi farkli
    // iki tarama — fark yalniz ortak asistanlar uzerinden (aiCitationKapsami).
    if (
      id === 'aiCitations' && oncekiScore !== null && sonrakiScore !== null &&
      checkMethodVersion(fromChecks[id]) === checkMethodVersion(toChecks[id])
    ) {
      const kapsam = aiCitationKapsami(fromChecks[id], toChecks[id]);
      if (kapsam?.farkli) {
        kapsamiDegisen.add(id);
        aiSaglayiciKapsami = { ortak: kapsam.ortak, yalnizOnceki: kapsam.yalnizOnceki, yalnizSonraki: kapsam.yalnizSonraki };
        // Ortak asistan yoksa kiyaslanacak bir sey yok: satir uretilmez
        if (kapsam.onceki === null || kapsam.sonraki === null) continue;
        oncekiScore = kapsam.onceki;
        sonrakiScore = kapsam.sonraki;
      }
    }

    let durum: CheckDurum;
    let delta = 0;
    if (oncekiScore === null) {
      durum = 'yeni';
    } else if (sonrakiScore === null) {
      durum = 'kayboldu';
    } else if (olcumYontemiDegisti(id, fromChecks[id], toChecks[id])) {
      // Ornek: image_alt v2 alt=""'yi artik cezalandirmiyor → skor siteye
      // dokunulmadan yukselir. "iyilesti" demek yanlis olurdu. Kural tarama
      // gecmisiyle ortak (olcumYontemiDegisti); AI kapsam duzeltmesi yalniz
      // ayni yontemde yapildigi icin buradaki hukmu degistirmez.
      durum = 'metodoloji_degisti';
      metodolojiDegisen.add(id);
    } else {
      // delta yalnizca iki uc da olculebildiginde anlamli; yeni/kayboldu
      // durumlarinda 0 birakilir ki "+87 puan" gibi sahte sicramalar cikmasin.
      delta = sonrakiScore - oncekiScore;
      durum = delta > 0 ? 'iyilesti' : delta < 0 ? 'kotulesti' : 'ayni';
    }

    checks.push({ id, oncekiScore, sonrakiScore, delta, durum });
  }
  // Once en cok degisenler (mutlak delta), sonra alfabetik — kullanici paneli
  // acinca once "ne degisti" gorsun.
  checks.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.id.localeCompare(b.id));

  // ── Issue eslestirme ──────────────────────────────────────────
  // Yontemi degisen kontrolun sorunlari (ornek: image_alt_low → image_alt_missing)
  // "cozuldu + yeni cikti" diye ikiye bolunmesin: eski taraf hic sayilmaz,
  // yeni taraf mevcut durum olarak devam edende gorunur. GEO sorunlari
  // ('geo_faq'...) checks.geo'nun yontemine baglidir (issueCheckKey).
  // Olculen asistan kumesi degisen AI olcumu da ayni muameleyi gorur:
  // ai_citation_low her taramanin KENDI ortalamasindan (<30) uretilir; kume
  // degisince cikip kaybolmasi bilesimden olabilir, "cozuldu/yeni" denmez.
  const yontemi = (i: AuditIssueKaydi) => {
    const k = issueCheckKey(i?.checkId);
    return !!k && (metodolojiDegisen.has(k) || kapsamiDegisen.has(k));
  };
  const kapsamNotu = (i: AuditIssueKaydi) => i?.checkId === KAPSAM_NOTU_CHECK_ID;
  const oncekiIssues = issueListesi(fromRow).filter((i) => !kapsamNotu(i) && !yontemi(i));
  const sonrakiIssuesTum = issueListesi(toRow).filter((i) => !kapsamNotu(i));
  const sonrakiIssues = sonrakiIssuesTum.filter((i) => !yontemi(i));

  // Bir sorunun yoklugu ancak kontrolu GERCEKTEN olculduyse hukumdur.
  // Olculemeyen: dogrulanamayan kok dosya, engellenen GEO orneklemi, atlanan
  // AI olcumu, PageSpeed hatasi; sayfa kontrollerinde de dar sayfa kapsami.
  const fromKapsam = sayfaKapsamiOf(fromChecks);
  const toKapsam = sayfaKapsamiOf(toChecks);
  const toKapsamDar = sayfaKapsamiDar(toKapsam, fromKapsam);
  const fromKapsamDar = sayfaKapsamiDar(fromKapsam, toKapsam);
  const olculmedi = (i: AuditIssueKaydi, checksJson: Record<string, unknown>, kapsamDar: boolean): boolean => {
    const k = issueCheckKey(i?.checkId);
    if (!k) return false; // checkId tasimayan cok eski kayit: eski davranis
    if (kapsamDar && SAYFA_KONTROLLERI.has(k)) return true;
    return kontrolOlculmedi(checksJson, k);
  };

  const oncekiMap = new Map<string, AuditIssueKaydi>();
  for (const i of oncekiIssues) if (!oncekiMap.has(issueKey(i))) oncekiMap.set(issueKey(i), i);
  const sonrakiMap = new Map<string, AuditIssueKaydi>();
  for (const i of sonrakiIssues) if (!sonrakiMap.has(issueKey(i))) sonrakiMap.set(issueKey(i), i);

  const cozulen: AuditIssueKaydi[] = [];
  const devamEden: AuditIssueKaydi[] = [];
  const olculemedi: AuditIssueKaydi[] = [];
  for (const [key, issue] of oncekiMap) {
    if (sonrakiMap.has(key)) devamEden.push(sonrakiMap.get(key)!);
    else if (olculmedi(issue, toChecks, toKapsamDar)) olculemedi.push(issue);
    else cozulen.push(issue);
  }
  const yeniCikan: AuditIssueKaydi[] = [];
  for (const [key, issue] of sonrakiMap) {
    if (oncekiMap.has(key)) continue;
    // Onceki taramada olculemeyen kontrolun sorunu "yeni cikti" sayilamaz —
    // belki hep vardi. Yontem degisimindeki gibi mevcut durum olarak gorunur.
    if (olculmedi(issue, fromChecks, fromKapsamDar)) devamEden.push(issue);
    else yeniCikan.push(issue);
  }
  for (const i of sonrakiIssuesTum) if (yontemi(i)) devamEden.push(i);

  // ── Kismi karsilastirma ───────────────────────────────────────
  const olculemeyenKontroller = new Set<string>();
  for (const id of checkIds) {
    if (id === 'crawlCoverage') continue;
    const oncekiOlculdu = !kontrolOlculmedi(fromChecks, id);
    const sonrakiOlculdu = !kontrolOlculmedi(toChecks, id);
    if (oncekiOlculdu && !sonrakiOlculdu) olculemeyenKontroller.add(id);
  }
  // Genel skor yalniz olculebilen kontrollerden hesaplanir (computeOverallScore):
  // bir tarafta disarida kalan kontrol skor farkini kendisi oynatir. Kural
  // tarama gecmisiyle ortak (genelSkorKiyasi).
  const skorKapsamiFarkli = genelSkorKiyasi(fromChecks, toChecks).kapsamiFarkli;
  // "Olculemedi"ye dusen her sorunun nedeni listede gorunsun (son taramada hic
  // girdisi olmayan kontrol dahil); sayfa kapsami nedeni ayrica sayfaKapsami'nda.
  for (const i of olculemedi) {
    const k = issueCheckKey(i?.checkId);
    if (k && kontrolOlculmedi(toChecks, k)) olculemeyenKontroller.add(k);
  }
  const sayfaKapsami = toKapsamDar ? { erkenDurdu: toKapsam.erkenDurdu, engellenenSayfa: toKapsam.engellenenSayfa } : null;
  const kismi: KismiKarsilastirma | null =
    olculemeyenKontroller.size > 0 || skorKapsamiFarkli.length > 0 || sayfaKapsami || olculemedi.length > 0
      ? { olculemeyenKontroller: [...olculemeyenKontroller].sort(), skorKapsamiFarkli, sayfaKapsami }
      : null;

  return {
    from,
    to,
    scoreDelta,
    geoScoreDelta,
    checks,
    issues: { cozulen, yeniCikan, devamEden, olculemedi },
    ozet: {
      cozulenSayisi: cozulen.length,
      yeniSayisi: yeniCikan.length,
      devamEdenSayisi: devamEden.length,
      olculemeyenSayisi: olculemedi.length,
    },
    ...(metodolojiDegisen.size > 0 ? { metodolojiDegisen: [...metodolojiDegisen].sort() } : {}),
    ...(kismi ? { kismi } : {}),
    ...(aiSaglayiciKapsami ? { aiSaglayiciKapsami } : {}),
  };
}

@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crawler: SiteCrawlerService,
    private readonly checks: AuditChecksService,
    private readonly pagespeed: PageSpeedService,
    private readonly geo: GeoRunnerService,
    private readonly aiCitation: AiCitationService,
    private readonly jobQueue: JobQueueService,
    @Optional() private readonly imageInventory?: ImageInventoryService,
  ) {}

  async getLatest(siteId: string) {
    const audit = await this.prisma.audit.findFirst({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
    });
    if (!audit) return audit;
    // Eski taramalar dahil: her sorun "nerede duzeltilir" rotasini tasisin
    // (UI artik auto-fix'e yalnizca gercekten uretilebilen anahtarlari yollar).
    const annotated = annotateAuditFixRoutes(audit);
    // Bu skordan SONRAKI tarama denemesi engellendiyse skor guncel degildir;
    // cevap bunu kendisi soylesin (accessBlocked). readCrawlAccess hata atmaz.
    // Kural tek yerde: crawl-access.ts crawlAccessNewerThanAudit.
    const blocked = crawlAccessNewerThanAudit(await readCrawlAccess(this.prisma, siteId), audit.ranAt);
    return blocked ? { ...annotated, accessBlocked: blocked } : annotated;
  }

  /**
   * Tarama gecmisi — en yeni once.
   *
   * Her satir bir onceki (daha eski) satirla genel skoru DOGRUDAN
   * kiyaslanabilir mi soyler (scoreComparableWithPrevious + scoreMethodNote).
   * NEDEN: panel ardisik taramalarin genel skor farkini yesil/kirmizi rozetle
   * gosteriyordu; arada genel skora giren bir kontrolun olcum yontemi
   * degistiyse (ya da kontrol yalniz bir taramada olculebildiyse) fark
   * sitenin degil olcunun degisimiydi. Hukum compareAudits'in kuralindan gelir
   * (genelSkorKiyasi). Listenin en eski satirinin onceki taramasi listede
   * yok: iki alan null.
   *
   * checks bu yuzden okunur ama cevaba KONMAZ. Olculen uretim taramasinda
   * checks ~31 KB, bunun ~%86'si aiCitations; 14 genel skor kontrolu ~3,5 KB.
   * Prisma Json'un alt yolunu secemez; satir basina tam checks okunur, panel
   * 12-20 satir ister (en fazla 100). reports.service de donem taramalarini
   * tam satirla okur. issues yalnizca sayisini uretmek icin okunur.
   */
  async getHistory(siteId: string, limit = 20) {
    const guvenliLimit = Math.min(100, Math.max(1, Math.floor(limit) || 20));
    const rows = await this.prisma.audit.findMany({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
      take: guvenliLimit,
      select: {
        id: true,
        ranAt: true,
        overallScore: true,
        geoScore: true,
        issues: true,
        durationMs: true,
        // Gecmis listesi taramanin kaynagini GOSTERIR ama gizlemez: tarama
        // gercekten calisti, kaydi durmali. Rapor "yapilan is" sayarken
        // yalnizca 'user' olanlari sayar; arayuz digerlerini rozetle ayirir.
        trigger: true,
        checks: true,
      },
    });

    const checksOf = (row: { checks: unknown } | undefined): Record<string, unknown> =>
      row?.checks && typeof row.checks === 'object' && !Array.isArray(row.checks) ? (row.checks as Record<string, unknown>) : {};

    return rows.map((a, i) => {
      // Liste yeni → eski: bir onceki tarama sonraki indekste
      const onceki = rows[i + 1];
      const kiyas = onceki ? genelSkorKiyasi(checksOf(onceki), checksOf(a)) : null;
      return {
        id: a.id,
        ranAt: a.ranAt,
        overallScore: a.overallScore,
        geoScore: a.geoScore,
        issueCount: Array.isArray(a.issues) ? a.issues.length : 0,
        durationMs: a.durationMs,
        // 'user' | 'system' | 'test' (AuditTrigger); secilip atiliyordu
        trigger: a.trigger,
        scoreComparableWithPrevious: kiyas ? kiyas.yontemiDegisen.length === 0 && kiyas.kapsamiFarkli.length === 0 : null,
        scoreMethodNote: kiyas ? genelSkorKiyasNotu(kiyas) : null,
      };
    });
  }

  /**
   * Iki tarama arasindaki farki cikarir. fromId/toId verilmezse son IKI tarama
   * karsilastirilir (from = bir onceki, to = en son).
   *
   * Tek tarama varsa HATA ATMAZ: yeterliVeriYok:true ile bos ama anlamli bir
   * sonuc doner — cagiran yuzey "en az iki tarama gerekli" durumunu bu bayrakla
   * gosterir, 404/500 ile karsilasmaz.
   */
  async compareAudits(
    siteId: string,
    opts: { fromId?: string; toId?: string } = {},
  ): Promise<AuditKarsilastirma> {
    let fromRow: any = null;
    let toRow: any = null;

    if (opts.fromId || opts.toId) {
      // siteId filtresi zorunlu: id'ler govdeden/query'den gelir, baska bir
      // musterinin audit id'si gecirilirse eslesme olmamalidir.
      const [f, t] = await Promise.all([
        opts.fromId
          ? this.prisma.audit.findFirst({ where: { id: opts.fromId, siteId } })
          : Promise.resolve(null),
        opts.toId
          ? this.prisma.audit.findFirst({ where: { id: opts.toId, siteId } })
          : Promise.resolve(null),
      ]);
      fromRow = f;
      toRow = t;
      // Yalnizca biri verilmisse eksik tarafi son taramayla tamamla
      if (!toRow) toRow = await this.getLatest(siteId);
      if (!fromRow && toRow) {
        fromRow = await this.prisma.audit.findFirst({
          where: { siteId, ranAt: { lt: toRow.ranAt } },
          orderBy: { ranAt: 'desc' },
        });
      }
    } else {
      const sonIki = await this.prisma.audit.findMany({
        where: { siteId },
        orderBy: { ranAt: 'desc' },
        take: 2,
      });
      toRow = sonIki[0] ?? null;
      fromRow = sonIki[1] ?? null;
    }

    return compareAuditRows(fromRow, toRow);
  }

  /**
   * Taramayi KUYRUGA atar ve is kaydini doner.
   *
   * ONCEDEN prisma.job.create ile yalnizca DB satiri yaziyordu — BullMQ'ya
   * hicbir sey eklenmiyordu. Worker BullMQ tuketicisi oldugu icin o is
   * sonsuza kadar QUEUED kaliyor, hicbir zaman calismiyordu. Yani bu uc
   * sessizce ise yaramiyordu. JobQueueService.enqueue hem DB satirini hem
   * BullMQ kaydini olusturur ve bullJobId'yi geri yazar.
   *
   * DONUS SEKLI BILEREK YENIDEN ADLANDIRILIYOR: enqueue `{ dbJobId, bullJobId }`
   * doner, ama bu ucun tuketicisi `{ id }` bekliyor — cunku bir sonraki adim
   * GET /jobs/:id yoklamasi. Ham sekli oldugu gibi gecirince istemci
   * `job.id` okuyup `undefined` aliyor ve yoklama ilk istekte patliyor.
   * (Tam olarak bu yasandi; tsc yakalamadi cunku web kendi donus tipini
   * bagimsiz beyan ediyor.) Uc, is kimligini HER ZAMAN `id` adiyla verir.
   */
  async queueAudit(siteId: string): Promise<{ id: string; status: 'QUEUED'; bullJobId: string }> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const { dbJobId, bullJobId } = await this.jobQueue.enqueue({
      type: 'SITE_AUDIT',
      userId: site.userId,
      siteId,
      payload: { siteId, url: site.url },
      priority: 5,
    });
    return { id: dbJobId, status: 'QUEUED', bullJobId: String(bullJobId) };
  }

  /**
   * Worker'dan çağrılan asıl iş — 14 kontrol + PageSpeed + GEO.
   */
  /**
   * @param opts.trigger 'user' (varsayilan) kullanicinin baslattigi tarama —
   *   citation kotasi dayatilir. 'system' zamanlanmis periyodik tarama —
   *   kotayi TUKETMEZ. Aksi halde haftalik otomatik tarama, kullanicinin
   *   kendi olcumleri icin ayirdigi hakki sessizce yer ve "kotam neden bitti"
   *   sorusu dogar.
   */
  async runAudit(siteId: string, opts: { trigger?: AuditTrigger } = {}) {
    const t0 = Date.now();
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });

    this.log.log(`[${siteId}] Audit başlıyor: ${site.url}`);

    // 1) Site crawl — orphan/internal-linking analizinin doğru olması için tüm
    // siteyi tara (30 ile yarım kalıyordu → link grafiği eksik → yanlış orphan).
    const crawl = await this.crawler.crawl(site.url, 100, { stopIfHomeUnreadable: true });

    // 1b) Anasayfa okunamadi → PUAN YOK, Audit satiri YOK.
    // ofsayt.com: Cloudflare 403 "Sorry, you have been blocked" sayfasi site
    // sanilip 44 puan yazilmisti. Olculen sey site degil bizim erisimimizdi.
    // overallScore zorunlu bir sayi ve 20'den fazla yer (rapor, trend, MCP,
    // ozet) onu gercek skor sayiyor; o yuzden satir hic yazilmaz, durum
    // kv_store'a gider ve panel "Erisim engellendi" + cozum yolunu gosterir.
    // PageSpeed/GEO/AI citation da calistirilmaz (bos maliyet).
    if (crawl.homeAccess) {
      await recordCrawlAccess(this.prisma, siteId, crawl.homeAccess, 'audit').catch((err) =>
        this.log.warn(`[${siteId}] Erisim durumu yazilamadi: ${err.message}`),
      );
      this.log.warn(`[${siteId}] Audit puanlanmadi — anasayfa okunamadi (${crawl.homeAccess.kind}): ${crawl.homeAccess.reason}`);
      throw new CrawlAccessError(crawl.homeAccess);
    }
    // Erisim duzeldiyse eski "engellendi" kaydi panelde kalmasin
    await clearCrawlAccess(this.prisma, siteId).catch((err) =>
      this.log.warn(`[${siteId}] Erisim durumu temizlenemedi: ${err.message}`),
    );
    // Yerel olcum icin sitenin kendi NAP'i (LocalBusiness JSON-LD + tel:
    // baglantilari) — tarama verisi baska yerde kalici degil. Denetimi dusurmez.
    await recordSiteNapFromCrawl(this.prisma, siteId, crawl.pages).catch((err) =>
      this.log.warn(`[${siteId}] Site NAP kaydedilemedi: ${err.message}`),
    );
    this.log.log(`[${siteId}] ${crawl.pages.length} sayfa crawl edildi`);

    // 2) 14 kontrol noktası
    const checkResults = await this.checks.runAllChecks(crawl);
    const overallScore = this.checks.computeOverallScore(checkResults);

    // 3) PageSpeed (asenkron — başarısızsa null)
    const pagespeedResult = await this.pagespeed.runAudit(site.url, 'mobile');

    // 4) GEO + AI Citation (olculen tum AI asistanlari) — paralel.
    // AI adimi atlanirsa (haftalik hak, kota, hata) nedeni burada tutulur;
    // degisken degil kutu: kapanis icindeki atamayi TS akis analizi izlemez.
    const aiAtlama: { neden: AiCitationSkip | null } = { neden: null };
    const [geoResult, citationResults] = await Promise.all([
      this.geo.runAudit(site.url),
      // KULLANICI tetikli (varsayilan) — audit'i kullanici baslatir, citation
      // kotasi gercekten dayatilir. Kota doluysa runForSite artik firlatir;
      // asagidaki catch audit'in geri kalanini ayakta tutar, yalnizca citation
      // bolumu bos doner.
      // Kota acisindan yalnizca GERCEK kullanici taramasi hak tuketir.
      // 'test' de 'system' gibi davranir: dogrulama kosumu musterinin aylik
      // gorunurluk hakkini yiyemez.
      this.aiCitation.runForSite(siteId, 5, {
        trigger: (opts.trigger ?? 'user') === 'user' ? 'user' : 'system',
      }).catch((err) => {
        aiAtlama.neden = aiCitationSkipFromError(err);
        this.log.warn(`[${siteId}] AI Citation testi atlandi (${aiAtlama.neden.code}): ${err.message}`);
        return [] as Awaited<ReturnType<AiCitationService['runForSite']>>;
      }),
    ]);

    // AI Citation ortalama skoru (sadece available + skor olanlar)
    const validCitationScores = citationResults
      .filter((r) => r.available && typeof r.score === 'number')
      .map((r) => r.score as number);
    const aiCitationAvg = validCitationScores.length > 0
      ? Math.round(validCitationScores.reduce((a, b) => a + b, 0) / validCitationScores.length)
      : null;
    // Hicbir asistan skor dondurmediyse olcum YOK: skor null + neden (0 degil)
    const aiSkip = aiCitationAvg === null ? (aiAtlama.neden ?? aiCitationSkipFromResults(citationResults)) : null;

    // 5) Issues consolidate
    const allIssues = checkResults.flatMap(r => r.issues.map(i => ({
      ...i,
      checkId: r.id,
    })));

    // Erisim kapsami: engellenen sayfalar ve dogrulanamayan kok dosyalar
    // "eksik" sayilmadi ve puana girmedi — kullanici neyin OLCULMEDIGINI
    // gorsun. checkId 'crawl_access' elle rotasina duser (fix-routes.ts):
    // erisemedigimiz bir dosya icin otomatik duzeltme onerilmez.
    const blockedPages = crawl.blockedPages ?? [];
    if (blockedPages.length > 0) {
      const first = blockedPages[0];
      allIssues.push({
        severity: 'info' as const,
        type: 'crawl_pages_blocked',
        description: `${blockedPages.length} sayfa erişim engeli nedeniyle taranamadı; bu sayfalar puana dahil edilmedi. ${first.reason} ${first.hint}`,
        fixable: false,
        checkId: 'crawl_access',
      });
    }
    for (const r of checkResults) {
      if (!isUnverifiedCheck(r)) continue;
      allIssues.push({
        severity: 'info' as const,
        type: `${r.id}_unverified`,
        description: String(r.details?.unverifiedReason ?? `${r.name} doğrulanamadı.`),
        fixable: false,
        checkId: 'crawl_access',
      });
    }
    const crawlCoverage = {
      // `name` ve `score` BILEREK yok: panel kontrol listesi name tasiyan
      // girdileri satir olarak cizer, karsilastirma score'u olani sayar.
      blockedPages: blockedPages.slice(0, 20).map((b) => ({ url: b.url, kind: b.kind, status: b.status, reason: b.reason, hint: b.hint })),
      blockedCount: blockedPages.length,
      robotsDisallowedCount: crawl.robotsDisallowed?.length ?? 0,
      ranksUpBotGroup: crawl.ranksUpBotGroup ?? false,
      stoppedEarly: crawl.stoppedEarly ?? null,
    };

    // AI Citation skor 0/dusuk ise issue olarak ekle (yalniz GERCEKTEN olculduyse)
    if (aiCitationAvg !== null && aiCitationAvg < 30) {
      allIssues.push({
        severity: 'warning' as const,
        type: 'ai_citation_low',
        description: `AI arama görünürlüğü düşük (${aiCitationAvg}/100): AI asistanlarının marka adı geçmeyen sorulara verdiği yanıtlarda siten nadiren kaynak gösteriliyor ya da anılıyor. Soru-cevap biçiminde GEO içeriği ve schema işaretlemesi önerilir; llms.txt düşük maliyetli, opsiyonel bir adımdır.`,
        fixable: true,
        checkId: 'ai_citation',
      } as any);
    }

    // GEO metod skorları düşükse fixable issue olarak çıkar — snippet generator'a yol açar
    const geoIssueMap: Record<string, { type: string; checkId: string; desc: string }> = {
      faq_qa: {
        type: 'faq_missing',
        checkId: 'geo_faq',
        desc: 'FAQ schema ve soru-cevap formatı eksik (GEO ağırlığı 12) — jsonld_faq snippet üretici hazır.',
      },
      definition: {
        type: 'definition_missing',
        checkId: 'geo_definition',
        desc: 'Tanım yoğunluğu düşük ("X nedir?" tarzı içerik yok) — jsonld_defined_term snippet üretici hazır.',
      },
      citation_format: {
        type: 'citation_format_missing',
        checkId: 'geo_citation_format',
        desc: 'Liste/tablo formatı eksik — AI motorları madde işaretli özetleri atıf olarak tercih eder.',
      },
      freshness: {
        type: 'freshness_missing',
        checkId: 'geo_freshness',
        desc: 'datePublished / dateModified sinyali eksik — Article schema basıldığında otomatik çözülür.',
      },
    };
    for (const m of geoResult.methods ?? []) {
      const map = geoIssueMap[m.id];
      if (!map) continue;
      if (typeof m.score === 'number' && m.score < 30) {
        allIssues.push({
          severity: 'warning' as const,
          type: map.type,
          description: `${map.desc} (mevcut skor ${m.score}/100)`,
          fixable: true,
          checkId: map.checkId,
        } as any);
      }
    }

    // PageSpeed opportunities → issue
    if (pagespeedResult?.opportunities) {
      for (const opp of pagespeedResult.opportunities) {
        allIssues.push({
          severity: 'warning' as const,
          type: `pagespeed_${opp.id}`,
          description: `${opp.title} — ${(opp.savings / 1000).toFixed(1)}s tasarruf`,
          fixable: false,
          checkId: 'pagespeed',
        });
      }
    }

    // 6) DB'ye yaz
    const audit = await this.prisma.audit.create({
      data: {
        siteId,
        overallScore,
        geoScore: geoResult.score ?? null,
        checks: {
          ...Object.fromEntries(checkResults.map(r => [r.id, r])),
          pagespeed: pagespeedResult,
          geo: geoResult as any,
          aiCitations: {
            id: 'ai_citations',
            // Saglayici listesi adda yok: olculen asistan sayisi ortama gore
            // degisir (Llama yalniz GROQ_LLAMA_MODEL ile); liste providers'ta.
            name: 'AI arama görünürlüğü',
            // null = olculmedi, nedeni skipped'ta. Eskiden `?? 0` yaziliyordu:
            // panel 0/100, karsilastirma sahte dusus gosteriyordu.
            score: aiCitationAvg,
            // Alintilanan kaynak listeleri audit'e yazilmaz (citation-sources.ts
            // providersWithoutSources): rapor snapshot + GeoPromptRun okur
            providers: providersWithoutSources(citationResults),
            ...(aiSkip ? { skipped: aiSkip } : {}),
            ranAt: new Date().toISOString(),
            // Olcum yontemi surumu (host-match.ts CITATION_MATCH_VERSION). Eskiden
            // yazilmiyordu; checkMethodVersion alan yoksa 1 okudugu icin v3 ile
            // v4 denetimi "ayni yontem" sayiliyor, v4'un anilma/HATA kurali
            // yuzunden degisen skor "kotulesti/iyilesti" ve ai_citation_low
            // "yeni/cozulen" gorunuyordu. Artik farkli surum = metodoloji_degisti.
            details: { methodVersion: CITATION_MATCH_VERSION },
          } as any,
          crawlCoverage: crawlCoverage as any,
        },
        // fixRoute: auto_fix | snippet | images | manual (fix-routes.ts)
        issues: withFixRoutes(allIssues as any[]) as any,
        // Sablon bazli ozet — "yuzlerce sayfa hatasi = tek bilesen duzeltmesi" (issue-grouping.ts)
        issueGroups: groupIssues(withFixRoutes(allIssues as any[]) as any, {
          ...Object.fromEntries(checkResults.map(r => [r.id, r])),
          // Yalnizca gruplama basligi icin — kayitli checks'e girmez
          crawl_access: { id: 'crawl_access', name: 'Tarama erişimi' },
        }) as any,
        durationMs: Date.now() - t0,
        // Taramayi kimin baslattigi KALICI olarak yaziliyor. Onceden bu deger
        // yalnizca kota kararinda kullanilip atiliyordu; sonuc olarak gecmiste
        // bir taramanin kullaniciya mi, cron'a mi, yoksa bir dogrulama
        // kosumuna mi ait oldugu anlasilamiyordu. Rapor "yapilan is" sayarken
        // yalnizca 'user' taramalarini sayacak.
        trigger: opts.trigger ?? 'user',
      },
    });

    // 7) Site status güncelle
    await this.prisma.site.update({
      where: { id: siteId },
      data: { status: 'AUDIT_COMPLETE' },
    });

    // 8) Gorsel alt metni envanteri — audit'i DUSURMEZ (yan urun; hata loglanir)
    if (this.imageInventory) {
      try {
        await this.imageInventory.syncFromCrawl(siteId, audit.id, crawl.pages);
      } catch (err: any) {
        this.log.warn(`[${siteId}] Gorsel envanteri guncellenemedi: ${err.message}`);
      }
    }

    this.log.log(`[${siteId}] Audit bitti — skor: ${overallScore}/100, GEO: ${geoResult.score ?? '-'}/100, AI citation: ${aiCitationAvg ?? '-'}/100, ${allIssues.length} issue, ${(Date.now() - t0) / 1000}s`);

    return audit;
  }
}
