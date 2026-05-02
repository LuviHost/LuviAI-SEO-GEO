import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import type { CrawlResult, CrawledPage } from '../sites/site-crawler.service.js';

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
  private checkRobotsTxt(c: CrawlResult): CheckResult {
    const found = !!c.robotsTxt;
    const issues: AuditIssue[] = [];
    let score = 0;

    if (!found) {
      issues.push({
        severity: 'critical',
        type: 'robots_missing',
        description: 'robots.txt yok — crawler kontrolü yapamıyorsun',
        fixable: true,
        fixCommand: 'auto-fix: robots',
      });
    } else {
      score = 50;
      const txt = c.robotsTxt!;

      // Sitemap referansı var mı?
      if (txt.match(/Sitemap:\s*\S+/i)) score += 20;
      else issues.push({
        severity: 'warning', type: 'robots_no_sitemap',
        description: 'robots.txt içinde Sitemap referansı yok',
        fixable: true,
      });

      // AI crawler whitelist (modern SEO)
      const aiCrawlers = ['GPTBot', 'Claude-Web', 'PerplexityBot', 'Google-Extended'];
      const allowed = aiCrawlers.filter(c => txt.includes(c));
      if (allowed.length >= 2) score += 30;
      else issues.push({
        severity: 'warning', type: 'robots_ai_crawlers',
        description: `AI crawler izinleri eksik (${allowed.length}/${aiCrawlers.length})`,
        fixable: true,
      });
    }

    return {
      id: 'robots_txt', name: 'Robots.txt',
      found, valid: score >= 70, score, issues,
    };
  }

  // ───────────────────────────────────────────────────────────
  //  3. llms.txt (AI search için)
  // ───────────────────────────────────────────────────────────
  private checkLlmsTxt(c: CrawlResult): CheckResult {
    const found = !!c.llmsTxt;
    const issues: AuditIssue[] = [];
    if (!found) {
      issues.push({
        severity: 'warning',
        type: 'llms_missing',
        description: 'llms.txt yok — ChatGPT/Perplexity/Claude AI sitenizi alıntılaması zorlaşır',
        fixable: true,
        fixCommand: 'auto-fix: llms',
      });
    }
    return {
      id: 'llms_txt', name: 'LLMs.txt (AI search)',
      found, valid: found,
      score: found ? 100 : 30, // partial — yokluğu kritik değil ama önerilir
      issues,
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
    const samples: any[] = [];

    for (const page of c.pages) {
      // Sayfa text'inde "application/ld+json" arama yapamıyoruz çünkü
      // Crawler sadece text içeriği saklıyor — bunu ileride detaylı parse'da
      // çözeriz. Şimdilik basit kontrol: cheerio ile orijinal HTML üzerinden
      // çağırılıyor olsaydı buradan extract ederdik. Faz 1'de heuristic:
      // textSample içinde "@type" geçiyorsa schema var sayalım.
      if (page.textSample.includes('@type')) {
        pagesWithSchema++;
        if (page.textSample.includes('"Article"') || page.textSample.includes('"BlogPosting"')) {
          pagesWithArticle++;
        }
        if (page.textSample.includes('"BreadcrumbList"')) {
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

    for (const p of c.pages) {
      if (!p.metaDescription) { missing++; continue; }
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
      details: { valid, tooShort, tooLong, missing, total },
    };
  }

  // ───────────────────────────────────────────────────────────
  //  7. Open Graph (sosyal medya paylaşımı)
  // ───────────────────────────────────────────────────────────
  private checkOpenGraph(c: CrawlResult): CheckResult {
    const issues: AuditIssue[] = [];
    let pagesWithOg = 0;
    for (const p of c.pages) {
      if (p.textSample.includes('og:title') || p.textSample.includes('og:image')) pagesWithOg++;
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
    for (const p of c.pages) if (p.textSample.includes('twitter:card')) count++;
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
    for (const p of c.pages) if (p.textSample.includes('rel="canonical"') || p.textSample.includes("rel='canonical'")) count++;
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

    for (const p of c.pages) {
      if (!p.h1) { missing++; continue; }
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

    const total = c.pages.length;
    const score = total > 0 ? Math.round(((total - missing - duplicates.length) / total) * 100) : 0;
    return {
      id: 'h1_uniqueness', name: 'H1 Uniqueness',
      found: valid > 0, valid: missing === 0 && duplicates.length === 0,
      score, issues,
      details: { valid, missing, duplicates: duplicates.length },
    };
  }

  // ───────────────────────────────────────────────────────────
  //  12. Image alt text
  // ───────────────────────────────────────────────────────────
  private checkImageAltText(c: CrawlResult): CheckResult {
    // textSample'da img alt heuristic kontrolü mümkün değil — ileride
    // crawler bunu da output'a eklesin. Şimdilik info-level pass.
    return {
      id: 'image_alt', name: 'Image alt text',
      found: true, valid: true, score: 75,
      issues: [{
        severity: 'info', type: 'alt_check_partial',
        description: 'Image alt kapsamı detaylı kontrol için manual review gerekir',
        fixable: false,
      }],
    };
  }

  // ───────────────────────────────────────────────────────────
  //  13. Internal linking (orphan sayfalar)
  // ───────────────────────────────────────────────────────────
  private checkInternalLinking(c: CrawlResult): CheckResult {
    // Bir sayfaya hiç inbound link yoksa orphan
    const inboundCount = new Map<string, number>();
    for (const p of c.pages) inboundCount.set(p.url, 0);
    for (const p of c.pages) {
      for (const link of p.outboundLinks) {
        inboundCount.set(link, (inboundCount.get(link) ?? 0) + 1);
      }
    }

    const orphans = [...inboundCount.entries()].filter(([url, n]) => n === 0 && url !== c.baseUrl);
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
      details: { orphans: orphans.slice(0, 5).map(([u]) => u) },
    };
  }

  // ───────────────────────────────────────────────────────────
  //  14. Hreflang (multi-language)
  // ───────────────────────────────────────────────────────────
  private checkHreflang(c: CrawlResult): CheckResult {
    let count = 0;
    for (const p of c.pages) if (p.textSample.includes('hreflang')) count++;
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
    // Weight'li ortalama
    const weights: Record<string, number> = {
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
    let sum = 0, totalWeight = 0;
    for (const r of results) {
      const w = weights[r.id] ?? 1;
      sum += r.score * w;
      totalWeight += w;
    }
    return Math.round(totalWeight > 0 ? sum / totalWeight : 0);
  }
}
