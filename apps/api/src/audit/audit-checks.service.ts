import { Injectable } from '@nestjs/common';
import type { CrawlResourceStatus, CrawlResult } from '../sites/site-crawler.service.js';
import { computeImageAltCheck } from './image-alt-check.js';
import { computeRobotsCheck, ROBOTS_METHOD_VERSION } from './robots-check.js';
import { detectLanguageVersions } from './language-versions.js';

export type Severity = 'critical' | 'warning' | 'info';

export interface AuditIssue {
  severity: Severity;
  type: string;
  page?: string;
  description: string;
  fixable: boolean; // auto-fix mümkün mü
  fixCommand?: string;
}

export interface CheckResult {
  id: string;
  name: string;
  found: boolean;
  valid: boolean;
  score: number; // 0-100
  issues: AuditIssue[];
  details?: Record<string, any>;
}

/**
 * llms.txt kontrolunun olcum yontemi (details.methodVersion).
 * v2: tarayici /llms.txt'ten 200 + HTML donen govdeyi (ozel 404 / anasayfa)
 * artik "dosya var" saymiyor (site-crawler looksLikeHtmlDocument). Eskiden
 * boyle siteler 100 aliyordu; site degismeden 30'a iner — karsilastirma bunu
 * "kotulesti" diye siteye yazmasin.
 * v3 (08.11.2026 kanit denetimi): kontrol GENEL SKORA GIRMEZ, listede bilgi
 * olarak kalir (details.informational). Google Arama llms.txt'i yok sayiyor;
 * Sistrix ve SE Ranking olcumlerinde dosyanin gorunurluge etkisi cikmadi.
 * Eskiden dosyasi olmayan site 30 puanla genel skordan ceza aliyordu.
 */
export const LLMS_METHOD_VERSION = 3;

/**
 * Ic linkleme kontrolunun olcum yontemi (details.methodVersion).
 * v2: tarayici www'li / www'suz adresi ve yonlendirme sonrasi kokeni tek site
 * sayiyor. Eskiden kayitli adres "ornek.com", site "www.ornek.com" iken
 * www'li ic linkler dis link sayilip sayfalar orphan gorunuyordu; site
 * degismeden "+60 iyilesti" cikabilir.
 */
export const INTERNAL_LINKING_METHOD_VERSION = 2;

/**
 * Hreflang kontrolunun olcum yontemi (details.methodVersion).
 * v2 (12.11.2026): sitede dil surumu varsa (language-versions.ts) ve hicbir
 * sayfada hreflang yoksa kontrol BASARISIZ (0, uyari). v1 her siteye kosulsuz
 * 100 yaziyordu.
 */
export const HREFLANG_METHOD_VERSION = 2;

/**
 * HTTPS kontrolunun olcum yontemi (details.methodVersion).
 * v2 (12.11.2026): sunucu sertifika zincirini eksik gonderiyorsa (baglanti
 * ancak biz tamamlayinca kuruldu) uyari + HTTPS_CHAIN_INCOMPLETE_SCORE. v1
 * yalniz adresin https olup olmadigina bakiyordu.
 */
export const HTTPS_METHOD_VERSION = 2;

/**
 * HTTPS var ama sunucu sertifika zincirini eksik gonderiyor: puan. Site
 * tarayicilarda aciliyor (0 degil), ama zinciri tamamlamayan her program icin
 * kapali (100 degil).
 */
export const HTTPS_CHAIN_INCOMPLETE_SCORE = 70;

/**
 * Yontem surumu farkli iki olcum yine de AYNI HUKMU mu veriyor?
 *
 * hreflang ve HTTPS v2, v1'in hic bakmadigi TEK bir durumu olcer (dil surumu
 * var + etiket yok; zincir eksik). Yeni olcum o durumu bulmadiysa v1 de ayni
 * sonucu verirdi: karsilastirma "yontem degisti" DEMEZ, yoksa her sitenin bir
 * sonraki karsilastirmasi sebepsiz "kiyaslanamaz" olurdu. Yeni olcum o durumu
 * bulduysa eski tarafin "100"u bir olcum degildir: fark sitenin degil olcunun
 * ("kotulesti" denmez). Iki taraf da v2 ise bu fonksiyona gelinmez; fark
 * sitenindir (etiket eklendi → iyilesti).
 *
 * @param newer surumu BUYUK olan tarafin checks girdisi
 */
export function methodVerdictUnchanged(id: string, olderVersion: number, newerVersion: number, newer: unknown): boolean {
  const e = newer as { found?: unknown; valid?: unknown; details?: { chainIncomplete?: unknown } } | null;
  if (id === 'hreflang' && olderVersion === 1 && newerVersion === HREFLANG_METHOD_VERSION) return e?.found === true && e?.valid === true;
  if (id === 'https' && olderVersion === 1 && newerVersion === HTTPS_METHOD_VERSION) return e?.details?.chainIncomplete !== true;
  return false;
}

/** llms_txt bilgi kontrolunun panel notu (details.note) */
export const LLMS_INFO_NOTE = 'Bilgi: llms.txt genel skora girmez. Google Arama dosyayı yok sayıyor; bağımsız ölçümlerde görünürlüğe etkisi görülmedi.';

/**
 * Genel skor agirliklari — computeOverallScore ve karsilastirmadaki "skor
 * kapsami" notu (audit.service compareAuditRows) AYNI listeyi kullanir.
 * Listede OLMAYAN kontrol genel skora girmez (bilgi kontrolu, ör. llms_txt).
 */
export const OVERALL_SCORE_WEIGHTS: Readonly<Record<string, number>> = {
  sitemap_xml: 1.5,
  robots_txt: 1.5,
  schema_markup: 1.5,
  meta_title: 1.5,
  meta_description: 1.5,
  open_graph: 1.0,
  twitter_card: 0.5,
  canonical: 1.0,
  https: 2.0,
  h1_uniqueness: 1.0,
  image_alt: 0.5,
  internal_linking: 1.0,
  hreflang: 0.5,
};

/**
 * Genel skordan CIKARILAN kontroller: kimlik → cikarildigi yontem surumu
 * (details.methodVersion). Bu surumden ONCEKI taramalarda kontrol genel skora
 * giriyordu; eski/yeni tarama ciftinde skor farkinin bir kismi bu yuzden
 * yontemden gelir (audit.service genelSkorKiyasi).
 * llms_txt: v3'te cikti (LLMS_METHOD_VERSION).
 */
export const OVERALL_SCORE_RETIRED: Readonly<Record<string, number>> = {
  llms_txt: 3,
};

/**
 * Kontrol, verilen yontem surumuyle olculdugunde genel skora giriyor muydu?
 * Surum alani yoksa 1 sayilir (audit.service checkMethodVersion ile ayni).
 */
export function feedsOverallScoreAt(id: string, methodVersion: number): boolean {
  if (Object.hasOwn(OVERALL_SCORE_WEIGHTS, id)) return true;
  const since = OVERALL_SCORE_RETIRED[id];
  return typeof since === 'number' && methodVersion < since;
}

/**
 * Kontrol olculemedi mi? (details.unverified) — dosyaya erisimimiz engellendi
 * ya da sunucu hata verdi. Bu durumda score bir olcum DEGILDIR: genel skora
 * girmez, karsilastirmada skor sayilmaz.
 */
export function isUnverifiedCheck(entry: unknown): boolean {
  return (entry as { details?: { unverified?: unknown } } | null)?.details?.unverified === true;
}

/**
 * Engelli / hatali kok dosya: "YOK" demek yalan olur — dosya var olabilir,
 * biz okuyamadik. Sorun (issue) URETILMEZ: robots_txt / llms_txt / sitemap_xml
 * kontrol id'li her sorun otomatik duzeltme rotasina duser (fix-routes.ts) ve
 * okuyamadigimiz bir dosyanin uzerine uretilmis dosya yazmak musterinin kendi
 * dosyasini silmek olurdu. Aciklama details'te; panel "DOGRULANAMADI" der.
 */
function unverifiedCheck(
  id: string,
  name: string,
  label: string,
  res: CrawlResourceStatus,
  extra: Record<string, unknown> = {},
): CheckResult {
  const reason = res.reason ?? 'Erişilemedi.';
  return {
    id,
    name,
    found: false,
    valid: false,
    score: 0,
    issues: [],
    details: {
      ...extra,
      unverified: true,
      unverifiedReason: res.state === 'disallowed' ? `${label} okunmadı: ${reason}` : `${label} doğrulanamadı: ${reason}`,
      unverifiedHint: res.access?.hint ?? null,
      accessState: res.state,
      httpStatus: res.status,
    },
  };
}

/** Bu durumlarda kaynak hakkinda hukum verilemez */
function isUnreadable(res: CrawlResourceStatus | undefined): res is CrawlResourceStatus {
  return !!res && (res.state === 'blocked' || res.state === 'error' || res.state === 'disallowed');
}

/**
 * 14 kontrol noktası — her biri ayrı method.
 * Sonuçlar audit.checks JSON alanına yazılır. Genel skora 13'ü girer
 * (OVERALL_SCORE_WEIGHTS); llms_txt yalnız bilgi.
 */
@Injectable()
export class AuditChecksService {
  /** Tüm 14 kontrolü sırayla çalıştırır */
  async runAllChecks(crawl: CrawlResult): Promise<CheckResult[]> {
    return [
      this.checkSitemap(crawl),
      this.checkRobotsTxt(crawl),
      this.checkLlmsTxt(crawl),
      this.checkSchemaMarkup(crawl),
      this.checkMetaTitle(crawl),
      this.checkMetaDescription(crawl),
      this.checkOpenGraph(crawl),
      this.checkTwitterCard(crawl),
      this.checkCanonical(crawl),
      this.checkHttps(crawl),
      this.checkH1Uniqueness(crawl),
      this.checkImageAltText(crawl),
      this.checkInternalLinking(crawl),
      this.checkHreflang(crawl),
    ];
  }

  // ───────────────────────────────────────────────────────────
  //  1. sitemap.xml
  // ───────────────────────────────────────────────────────────
  private checkSitemap(c: CrawlResult): CheckResult {
    const found = !!c.sitemapUrl;
    if (!found && isUnreadable(c.resources?.sitemap)) {
      return unverifiedCheck('sitemap_xml', 'Sitemap XML', 'sitemap.xml', c.resources!.sitemap, { url: null, totalPages: c.totalPages });
    }
    const issues: AuditIssue[] = [];
    if (!found) {
      issues.push({
        // UYARI, kritik degil (12.11.2026): site haritasi kesfi HIZLANDIRIR,
        // onkosul degildir. Google: ~500 sayfadan kucuk ve sayfalari birbirine
        // bagli sitede site haritasi gerekmeyebilir
        // (developers.google.com/search/docs/crawling-indexing/sitemaps/overview);
        // sitemaps.org: tarayicilar sayfalari cogunlukla baglantilardan bulur,
        // site haritasi bunu tamamlar. Iki sayfalik sitede "kritik" ve ilk
        // oncelik diye gostermek musteri raporunda abartiydi. Puan degismedi.
        severity: 'warning',
        type: 'sitemap_missing',
        description: 'sitemap.xml bulunamadı — Google\'ın siteni keşfetmesi yavaşlar',
        fixable: true,
        fixCommand: 'auto-fix: sitemap',
      });
    }
    return {
      id: 'sitemap_xml',
      name: 'Sitemap XML',
      found,
      valid: found,
      score: found ? 100 : 0,
      issues,
      details: { url: c.sitemapUrl, totalPages: c.totalPages },
    };
  }

  // ───────────────────────────────────────────────────────────
  //  2. robots.txt
  // ───────────────────────────────────────────────────────────
  // Yontem v3 — alti kritik botun RFC 9309 etkin erisimi; bkz. robots-check.ts
  private checkRobotsTxt(c: CrawlResult): CheckResult {
    const res = c.resources?.robots;
    if (!c.robotsTxt && isUnreadable(res)) {
      const r = unverifiedCheck('robots_txt', 'Robots.txt', 'robots.txt', res, { methodVersion: ROBOTS_METHOD_VERSION });
      // 5xx kalici ise yalnizca bizi degil arama motorlarini da etkiler:
      // RFC 9309 2.3.1.4 ulasilamayan robots.txt'te "tam yasak" varsayar;
      // Google ilk 12 saat taramayi durdurur
      // (https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt).
      if (res.state === 'error' && typeof res.status === 'number' && res.status >= 500) {
        r.details!.unverifiedReason += ' Hata kalıcıysa arama motorları da etkilenir: Google, robots.txt sunucu hatası verdiğinde siteyi taramayı geçici olarak durdurur.';
      }
      return r;
    }
    return computeRobotsCheck(c.robotsTxt);
  }

  // ───────────────────────────────────────────────────────────
  //  3. llms.txt — BILGI (v3): genel skora girmez
  // ───────────────────────────────────────────────────────────
  private checkLlmsTxt(c: CrawlResult): CheckResult {
    const found = !!c.llmsTxt;
    const details = { methodVersion: LLMS_METHOD_VERSION, informational: true, note: LLMS_INFO_NOTE };
    if (!found && isUnreadable(c.resources?.llms)) {
      return unverifiedCheck('llms_txt', 'LLMs.txt (AI search)', 'llms.txt', c.resources!.llms, details);
    }
    const issues: AuditIssue[] = [];
    if (!found) {
      issues.push({
        severity: 'info',
        type: 'llms_missing',
        description: 'llms.txt yok — bilgi: genel skora girmez. Google Arama bu dosyayı yok sayıyor; Sistrix ve SE Ranking ölçümlerinde görünürlüğe etkisi görülmedi. İstersen düşük maliyetli bir ek olarak yayınlayabilirsin.',
        fixable: true,
        fixCommand: 'auto-fix: llms',
      });
    }
    return {
      id: 'llms_txt', name: 'LLMs.txt (AI search)',
      found, valid: found,
      // Genel skora girmez (OVERALL_SCORE_WEIGHTS'te yok); skor yalniz
      // karsilastirma satiri icin, panel bilgi kontrolunde gostermez
      score: found ? 100 : 30,
      issues,
      details,
    };
  }

  // ───────────────────────────────────────────────────────────
  //  4. Schema markup (JSON-LD)
  // ───────────────────────────────────────────────────────────
  private checkSchemaMarkup(c: CrawlResult): CheckResult {
    const issues: AuditIssue[] = [];
    let pagesWithSchema = 0;
    let pagesWithArticle = 0;
    let pagesWithBreadcrumb = 0;

    for (const page of c.pages) {
      // Crawler her sayfa için JSON-LD bloklarını parse edip schemaTypes[] olarak saklıyor
      const types = page.schemaTypes ?? [];
      if (types.length > 0) {
        pagesWithSchema++;
        if (types.some(t => t === 'Article' || t === 'BlogPosting' || t === 'NewsArticle')) {
          pagesWithArticle++;
        }
        if (types.includes('BreadcrumbList')) {
          pagesWithBreadcrumb++;
        }
      }
    }

    const total = c.pages.length;
    const coverage = total > 0 ? (pagesWithSchema / total) * 100 : 0;

    if (coverage < 50) {
      issues.push({
        severity: 'warning',
        type: 'schema_low_coverage',
        description: `Schema markup ${pagesWithSchema}/${total} sayfada — kapsama düşük`,
        fixable: true,
      });
    }
    if (pagesWithBreadcrumb < total / 2) {
      issues.push({
        severity: 'info',
        type: 'breadcrumb_missing',
        description: 'BreadcrumbList schema eksik — Google rich result vermiyor',
        fixable: true,
      });
    }

    return {
      id: 'schema_markup',
      name: 'Schema.org markup',
      found: pagesWithSchema > 0,
      valid: coverage >= 70,
      score: Math.round(coverage),
      issues,
      details: { pagesWithSchema, pagesWithArticle, pagesWithBreadcrumb, total },
    };
  }

  // ───────────────────────────────────────────────────────────
  //  5. Meta title (50-60 karakter)
  // ───────────────────────────────────────────────────────────
  private checkMetaTitle(c: CrawlResult): CheckResult {
    const issues: AuditIssue[] = [];
    let valid = 0;
    let tooShort = 0;
    let tooLong = 0;
    let missing = 0;

    const missingPages: string[] = [];
    for (const p of c.pages) {
      if (!p.title) { missing++; missingPages.push(p.url); continue; }
      if (p.title.length < 30) tooShort++;
      else if (p.title.length > 60) tooLong++;
      else valid++;
    }

    const total = c.pages.length;
    const score = total > 0 ? Math.round(((valid + tooLong * 0.7) / total) * 100) : 0;

    if (missing > 0) issues.push({
      severity: 'critical', type: 'meta_title_missing',
      description: `${missing} sayfada <title> tag yok`,
      fixable: true,
      // İlk eksik sayfanın URL'ini page'e koy — auto-fix bunu hedefler
      page: missingPages[0],
    });
    if (tooShort > 0) issues.push({
      severity: 'warning', type: 'meta_title_short',
      description: `${tooShort} sayfada title 30 karakterden kısa`,
      fixable: false, // AI önerisi gerekir, manuel
    });
    if (tooLong > 0) issues.push({
      severity: 'info', type: 'meta_title_long',
      description: `${tooLong} sayfada title 60 karakterden uzun (Google kesebilir)`,
      fixable: false,
    });

    return {
      id: 'meta_title', name: 'Meta Title',
      found: missing === 0, valid: valid === total,
      score, issues,
      details: { valid, tooShort, tooLong, missing, total, missingPages },
    };
  }

  // ───────────────────────────────────────────────────────────
  //  6. Meta description (140-160 karakter)
  // ───────────────────────────────────────────────────────────
  private checkMetaDescription(c: CrawlResult): CheckResult {
    const issues: AuditIssue[] = [];
    let valid = 0, tooShort = 0, tooLong = 0, missing = 0;
    const missingPages: string[] = [];

    for (const p of c.pages) {
      if (!p.metaDescription) { missing++; missingPages.push(p.url); continue; }
      const len = p.metaDescription.length;
      if (len < 100) tooShort++;
      else if (len > 160) tooLong++;
      else valid++;
    }

    const total = c.pages.length;
    const score = total > 0 ? Math.round(((valid + tooLong * 0.7) / total) * 100) : 0;

    if (missing > 0) issues.push({
      severity: 'critical', type: 'meta_desc_missing',
      description: `${missing} sayfada meta description yok`,
      fixable: false,
    });
    if (tooShort > 0) issues.push({
      severity: 'warning', type: 'meta_desc_short',
      description: `${tooShort} sayfada meta description 100 karakterden kısa`,
      fixable: false,
    });

    return {
      id: 'meta_description', name: 'Meta Description',
      found: missing === 0, valid: valid === total,
      score, issues,
      details: { valid, tooShort, tooLong, missing, total, missingPages },
    };
  }

  // ───────────────────────────────────────────────────────────
  //  7. Open Graph (sosyal medya paylaşımı)
  // ───────────────────────────────────────────────────────────
  private checkOpenGraph(c: CrawlResult): CheckResult {
    const issues: AuditIssue[] = [];
    let pagesWithOg = 0;
    for (const p of c.pages) {
      const og = p.ogTags ?? {};
      // En az og:title VEYA og:image varsa "OG var" sayalım
      if (og['og:title'] || og['og:image']) pagesWithOg++;
    }
    const total = c.pages.length;
    const coverage = total > 0 ? (pagesWithOg / total) * 100 : 0;
    if (coverage < 80) {
      issues.push({
        severity: 'warning', type: 'og_low_coverage',
        description: `Open Graph ${pagesWithOg}/${total} sayfada — sosyal paylaşım görünümü zayıf`,
        fixable: false,
      });
    }
    return {
      id: 'open_graph', name: 'Open Graph',
      found: pagesWithOg > 0, valid: coverage >= 80,
      score: Math.round(coverage), issues,
    };
  }

  // ───────────────────────────────────────────────────────────
  //  8. Twitter Card
  // ───────────────────────────────────────────────────────────
  private checkTwitterCard(c: CrawlResult): CheckResult {
    let count = 0;
    for (const p of c.pages) {
      const tw = p.twitterTags ?? {};
      if (tw['twitter:card']) count++;
    }
    const total = c.pages.length;
    const coverage = total > 0 ? (count / total) * 100 : 0;
    return {
      id: 'twitter_card', name: 'Twitter Card',
      found: count > 0, valid: coverage >= 70,
      score: Math.round(coverage),
      issues: coverage < 70 ? [{
        severity: 'info', type: 'twitter_low_coverage',
        description: `Twitter Card ${count}/${total} sayfada`,
        fixable: false,
      }] : [],
    };
  }

  // ───────────────────────────────────────────────────────────
  //  9. Canonical URL
  // ───────────────────────────────────────────────────────────
  private checkCanonical(c: CrawlResult): CheckResult {
    let count = 0;
    for (const p of c.pages) {
      if (p.canonical) count++;
    }
    const total = c.pages.length;
    const coverage = total > 0 ? (count / total) * 100 : 0;
    return {
      id: 'canonical', name: 'Canonical URL',
      found: count > 0, valid: coverage >= 80,
      score: Math.round(coverage),
      issues: coverage < 80 ? [{
        severity: 'warning', type: 'canonical_missing',
        description: `Canonical URL ${count}/${total} sayfada — duplicate content riski`,
        fixable: false,
      }] : [],
    };
  }

  // ───────────────────────────────────────────────────────────
  //  10. HTTPS
  // ───────────────────────────────────────────────────────────
  private checkHttps(c: CrawlResult): CheckResult {
    const isHttps = c.baseUrl.startsWith('https://');
    // Sunucu sertifika zincirini eksik gonderiyor (ara sertifikalar yok): biz
    // tamamlayarak baglandik (common/tls-chain.ts), tarayicilar da cogunlukla
    // tamamlar; tamamlamayan programlar baglanamaz. Eskiden boyle bir site
    // "HTTPS: gecti / 100" aliyordu ve bulgu hicbir yerde gorunmuyordu
    // (labenko.com, 12.11.2026). Hangi AI botlarinin bu yuzden baglanamadigi
    // OLCULMEDI — metin "baglanamayabilir" der, kesin konusmaz. Yontem v2
    // (HTTPS_METHOD_VERSION): zincir tamamlama ile bu bulgu arasinda taranan
    // sitede eski "100" bir olcum degildi; karsilastirma "kotulesti" demez.
    const chainIncomplete = isHttps && c.tlsChainIncomplete === true;
    const issues: AuditIssue[] = [];
    if (!isHttps) {
      issues.push({
        severity: 'critical', type: 'no_https',
        description: 'Site HTTP üzerinden çalışıyor — Google "Güvenli değil" damgası vurar',
        fixable: false,
      });
    } else if (chainIncomplete) {
      issues.push({
        severity: 'warning', type: 'tls_chain_incomplete',
        description: 'Sunucu HTTPS sertifika zincirini eksik gönderiyor: sertifikayı imzalayan ara sertifikalar yanıtta yok. Tarayıcılar eksik sertifikayı çoğunlukla kendisi tamamlar; tamamlamayan programlar ve botlar siteye bağlanamayabilir. Sunucuyu tam zinciri gönderecek şekilde ayarla (Let’s Encrypt kullanıyorsan cert.pem yerine fullchain.pem).',
        fixable: false,
      });
    }
    return {
      id: 'https', name: 'HTTPS',
      found: isHttps, valid: isHttps && !chainIncomplete,
      score: !isHttps ? 0 : chainIncomplete ? HTTPS_CHAIN_INCOMPLETE_SCORE : 100,
      issues,
      details: { methodVersion: HTTPS_METHOD_VERSION, ...(chainIncomplete ? { chainIncomplete: true } : {}) },
    };
  }

  // ───────────────────────────────────────────────────────────
  //  11. H1 uniqueness
  // ───────────────────────────────────────────────────────────
  private checkH1Uniqueness(c: CrawlResult): CheckResult {
    const issues: AuditIssue[] = [];
    let valid = 0, missing = 0;
    const seen = new Map<string, number>();

    // JS kabugu sayfalar (sites/js-shell.ts) H1'i JS ile basar; ham HTML'de H1
    // aramak her birine sahte KRITIK yaziyordu. Onlar ayri, durust bir uyari
    // olarak raporlanir. (methodVersion 2)
    const shells = c.pages.filter((p) => p.jsShell);
    const pages = c.pages.filter((p) => !p.jsShell);

    // Eksik H1'li sayfa adresleri (en fazla 50) — musteri raporu ornek adres
    // gosterir; eskiden yalniz sayi tutuluyordu. Alan adi bilerek
    // `missingPages` DEGIL: issue-grouping.ts pagesFromDetails o adi okur ve
    // kontrolun TUM sorunlarini (h1_duplicate dahil) bu sayfalara yazardi.
    const missingH1Pages: string[] = [];
    for (const p of pages) {
      if (!p.h1) {
        missing++;
        if (missingH1Pages.length < 50) missingH1Pages.push(p.url);
        continue;
      }
      seen.set(p.h1, (seen.get(p.h1) ?? 0) + 1);
      valid++;
    }

    const duplicates = [...seen.entries()].filter(([, n]) => n > 1);
    if (duplicates.length > 0) {
      issues.push({
        severity: 'warning', type: 'h1_duplicate',
        description: `${duplicates.length} farklı H1 başlığı birden fazla sayfada tekrar ediyor`,
        fixable: false,
      });
    }
    if (missing > 0) {
      issues.push({
        severity: 'critical', type: 'h1_missing',
        description: `${missing} sayfada H1 yok`,
        fixable: false,
      });
    }
    if (shells.length > 0) {
      issues.push({
        severity: 'warning', type: 'js_shell_pages',
        description: `${shells.length} sayfa sunucudan boş bir JavaScript iskeleti olarak geliyor (başlık, metin ve linkler JS ile oluşuyor). Google JavaScript çalıştırır, ancak ChatGPT, Claude ve Perplexity'nin tarayıcıları çalıştırmaz — bu sayfaların içeriğini göremezler. Sunucu tarafı render (SSR/SSG) önerilir.`,
        fixable: false,
      });
    }

    const total = pages.length;
    const score = total > 0 ? Math.round(((total - missing - duplicates.length) / total) * 100) : (shells.length > 0 ? 100 : 0);
    return {
      id: 'h1_uniqueness', name: 'H1 Uniqueness',
      found: valid > 0, valid: missing === 0 && duplicates.length === 0,
      score, issues,
      details: {
        methodVersion: 2,
        valid, missing, duplicates: duplicates.length,
        missingH1Pages,
        jsShellCount: shells.length,
        jsShellPages: shells.slice(0, 50).map((p) => p.url),
      },
    };
  }

  // ───────────────────────────────────────────────────────────
  //  12. Image alt text
  // ───────────────────────────────────────────────────────────
  // Yontem v2 — alt="" (suslemeye ait) artik puan kirmaz; bkz. image-alt-check.ts
  private checkImageAltText(c: CrawlResult): CheckResult {
    return computeImageAltCheck(c.pages);
  }

  // ───────────────────────────────────────────────────────────
  //  13. Internal linking (orphan sayfalar)
  // ───────────────────────────────────────────────────────────
  private checkInternalLinking(c: CrawlResult): CheckResult {
    // Bir sayfaya hiç inbound link yoksa orphan.
    // URL'leri normalize et: trailing slash / query / hash / büyük-küçük harf farkı
    // olmasın — yoksa "/post/" linki "/post" sayfasına eşleşmeyip yanlış orphan üretir.
    const norm = (u: string) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
    const inboundCount = new Map<string, number>();
    for (const p of c.pages) inboundCount.set(norm(p.url), 0);
    for (const p of c.pages) {
      for (const link of p.outboundLinks) {
        const k = norm(link);
        if (inboundCount.has(k)) inboundCount.set(k, (inboundCount.get(k) ?? 0) + 1);
      }
    }

    const base = norm(c.baseUrl);
    const orphans = [...inboundCount.entries()].filter(([url, n]) => n === 0 && url !== base);
    const total = c.pages.length;
    const score = total > 0 ? Math.round(((total - orphans.length) / total) * 100) : 0;
    return {
      id: 'internal_linking', name: 'Internal Linking',
      found: true, valid: orphans.length === 0,
      score,
      issues: orphans.length > 0 ? [{
        severity: 'warning', type: 'orphan_pages',
        description: `${orphans.length} orphan sayfa (hiçbir yerden link yok)`,
        fixable: false,
      }] : [],
      details: { methodVersion: INTERNAL_LINKING_METHOD_VERSION, orphans: orphans.slice(0, 5).map(([u]) => u) },
    };
  }

  // ───────────────────────────────────────────────────────────
  //  14. Hreflang (multi-language)
  // ───────────────────────────────────────────────────────────
  // Yontem v2 — dil surumu olan sitede hreflang yoklugu artik "gecti" degil;
  // bkz. language-versions.ts ve HREFLANG_METHOD_VERSION.
  private checkHreflang(c: CrawlResult): CheckResult {
    let count = 0;
    for (const p of c.pages) if (p.hreflangs && p.hreflangs.length > 0) count++;
    const versions = detectLanguageVersions(c.pages);

    if (versions.multilingual && count === 0) {
      const diller = versions.languages.map((l) => l.toUpperCase()).join(', ');
      return {
        id: 'hreflang', name: 'Hreflang',
        found: false,
        valid: false,
        score: 0,
        issues: [{
          severity: 'warning', type: 'hreflang_missing',
          description: `Taramada sitenin farklı dil sürümleri görüldü (${diller}) ama sayfaların HTML'inde hreflang etiketi yok. hreflang, Google'ın her kullanıcıya doğru dil sürümünü göstermesine yardım eder. (Etiketler site haritasında ya da HTTP başlığında tanımlıysa bu kontrol onları görmez.)`,
          fixable: false,
        }],
        details: {
          methodVersion: HREFLANG_METHOD_VERSION,
          applicable: true,
          pagesWithHreflang: 0,
          languages: versions.languages,
          evidence: versions.evidence,
          samples: versions.samples,
        },
      };
    }

    // Dil surumu gorulmedi (ya da hreflang var): eski hukumle AYNI — 100.
    // "applicable: false" musteri raporunun bunu "gecti" diye saymamasi icin
    // (kontrol bu sitede bir sey olcmedi).
    const applicable = versions.multilingual || count > 0;
    return {
      id: 'hreflang', name: 'Hreflang',
      found: true,
      valid: true,
      score: 100,
      issues: [],
      details: {
        // Gecen sonuc v1 ile ayni hukumdur: karsilastirma bunu "yontem degisti"
        // saymaz (methodVerdictUnchanged).
        methodVersion: HREFLANG_METHOD_VERSION,
        ...(versions.multilingual ? { languages: versions.languages, evidence: versions.evidence } : {}),
        applicable,
        pagesWithHreflang: count,
        note: count > 0
          ? `${count} sayfada hreflang tag bulundu`
          : 'Tek dilli site — hreflang gerekmiyor',
      },
    };
  }

  // ───────────────────────────────────────────────────────────
  //  Genel skor hesaplama
  // ───────────────────────────────────────────────────────────
  computeOverallScore(results: CheckResult[]): number {
    // Weight'li ortalama (OVERALL_SCORE_WEIGHTS)
    let sum = 0, totalWeight = 0;
    for (const r of results) {
      // Bilgi kontrolu (ör. llms_txt v3) genel skora girmez
      if (!Object.hasOwn(OVERALL_SCORE_WEIGHTS, r.id)) continue;
      // Olculemeyen kontrol 0 sayilmaz — erisim engeli sitenin kusuru degil
      if (isUnverifiedCheck(r)) continue;
      const w = OVERALL_SCORE_WEIGHTS[r.id];
      sum += r.score * w;
      totalWeight += w;
    }
    return Math.round(totalWeight > 0 ? sum / totalWeight : 0);
  }
}
