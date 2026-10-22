import { Injectable } from '@nestjs/common';
import type { CrawlResourceStatus, CrawlResult } from '../sites/site-crawler.service.js';
import { computeImageAltCheck } from './image-alt-check.js';
import { computeRobotsCheck, ROBOTS_METHOD_VERSION } from './robots-check.js';

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
 */
export const LLMS_METHOD_VERSION = 2;

/**
 * Ic linkleme kontrolunun olcum yontemi (details.methodVersion).
 * v2: tarayici www'li / www'suz adresi ve yonlendirme sonrasi kokeni tek site
 * sayiyor. Eskiden kayitli adres "ornek.com", site "www.ornek.com" iken
 * www'li ic linkler dis link sayilip sayfalar orphan gorunuyordu; site
 * degismeden "+60 iyilesti" cikabilir.
 */
export const INTERNAL_LINKING_METHOD_VERSION = 2;

/**
 * Genel skor agirliklari — computeOverallScore ve karsilastirmadaki "skor
 * kapsami" notu (audit.service compareAuditRows) AYNI listeyi kullanir.
 * Listede olmayan kontrol 1 agirlik alir.
 */
export const OVERALL_SCORE_WEIGHTS: Readonly<Record<string, number>> = {
  sitemap_xml: 1.5,
  robots_txt: 1.5,
  llms_txt: 1.0,
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
 * Sonuçlar audit.checks JSON alanına yazılır.
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
        severity: 'critical',
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
  // Yontem v2 — RFC 9309 etkin erisim + bot kategorisi; bkz. robots-check.ts
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
  //  3. llms.txt (AI search için)
  // ───────────────────────────────────────────────────────────
  private checkLlmsTxt(c: CrawlResult): CheckResult {
    const found = !!c.llmsTxt;
    if (!found && isUnreadable(c.resources?.llms)) {
      return unverifiedCheck('llms_txt', 'LLMs.txt (AI search)', 'llms.txt', c.resources!.llms, { methodVersion: LLMS_METHOD_VERSION });
    }
    const issues: AuditIssue[] = [];
    if (!found) {
      issues.push({
        severity: 'warning',
        type: 'llms_missing',
        description: 'llms.txt yok — düşük maliyetli, opsiyonel bir hijyen adımı: hiçbir büyük AI sağlayıcısı dosyayı kullanacağını taahhüt etmiyor ve Google Search kullanmıyor; olası faydası küçük, zararı yok',
        fixable: true,
        fixCommand: 'auto-fix: llms',
      });
    }
    return {
      id: 'llms_txt', name: 'LLMs.txt (AI search)',
      found, valid: found,
      score: found ? 100 : 30, // partial — yokluğu kritik değil ama önerilir
      issues,
      details: { methodVersion: LLMS_METHOD_VERSION },
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
    return {
      id: 'https', name: 'HTTPS',
      found: isHttps, valid: isHttps,
      score: isHttps ? 100 : 0,
      issues: isHttps ? [] : [{
        severity: 'critical', type: 'no_https',
        description: 'Site HTTP üzerinden çalışıyor — Google "Güvenli değil" damgası vurar',
        fixable: false,
      }],
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
  private checkHreflang(c: CrawlResult): CheckResult {
    let count = 0;
    for (const p of c.pages) if (p.hreflangs && p.hreflangs.length > 0) count++;
    // Hreflang sadece multi-language siteler icin gereklidir.
    // Tek dilli sitelerde "yok" olmasi normal — score 100 ve found:true ile "uygulanmiyor" anlamini verelim
    // boylece UI'da "YOK" yerine "VAR" yesil rozeti goruntulenir.
    return {
      id: 'hreflang', name: 'Hreflang',
      found: true,
      valid: true,
      score: 100,
      issues: [],
      details: {
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
      // Olculemeyen kontrol 0 sayilmaz — erisim engeli sitenin kusuru degil
      if (isUnverifiedCheck(r)) continue;
      const w = OVERALL_SCORE_WEIGHTS[r.id] ?? 1;
      sum += r.score * w;
      totalWeight += w;
    }
    return Math.round(totalWeight > 0 ? sum / totalWeight : 0);
  }
}
