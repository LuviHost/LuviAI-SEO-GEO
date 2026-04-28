import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteCrawlerService } from '../sites/site-crawler.service.js';
import { AuditChecksService } from './audit-checks.service.js';
import { PageSpeedService } from './pagespeed.service.js';
import { GeoRunnerService } from './geo-runner.service.js';
import { AiCitationService } from './ai-citation.service.js';
import type { CheckResult } from './audit-checks.service.js';

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
  ) {}

  async getLatest(siteId: string) {
    return this.prisma.audit.findFirst({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
    });
  }

  async queueAudit(siteId: string) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    return this.prisma.job.create({
      data: {
        userId: site.userId,
        siteId,
        type: 'SITE_AUDIT',
        payload: { siteId, url: site.url },
      },
    });
  }

  /**
   * Worker'dan çağrılan asıl iş — 14 kontrol + PageSpeed + GEO.
   */
  async runAudit(siteId: string) {
    const t0 = Date.now();
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });

    this.log.log(`[${siteId}] Audit başlıyor: ${site.url}`);

    // 1) Site crawl
    const crawl = await this.crawler.crawl(site.url, 30);
    this.log.log(`[${siteId}] ${crawl.pages.length} sayfa crawl edildi`);

    // 2) 14 kontrol noktası
    const checkResults = await this.checks.runAllChecks(crawl);
    const overallScore = this.checks.computeOverallScore(checkResults);

    // 3) PageSpeed (asenkron — başarısızsa null)
    const pagespeedResult = await this.pagespeed.runAudit(site.url, 'mobile');

    // 4) Auriti GEO + AI Citation (Claude/Gemini/OpenAI/Perplexity) — paralel
    const [geoResult, citationResults] = await Promise.all([
      this.geo.runAudit(site.url),
      this.aiCitation.runForSite(siteId, 5).catch((err) => {
        this.log.warn(`[${siteId}] AI Citation testi basarisiz: ${err.message}`);
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

    // 5) Issues consolidate
    const allIssues = checkResults.flatMap(r => r.issues.map(i => ({
      ...i,
      checkId: r.id,
    })));

    // AI Citation skor 0/dusuk ise issue olarak ekle
    if (aiCitationAvg !== null && aiCitationAvg < 30) {
      allIssues.push({
        severity: 'warning' as const,
        type: 'ai_citation_low',
        description: `AI arama görünürlüğü düşük (${aiCitationAvg}/100) — ChatGPT/Claude/Gemini sorgularinda site URL'in nadiren geçiyor. llms.txt + schema markup + GEO içerik üretimi öner.`,
        fixable: true,
        checkId: 'ai_citation',
      } as any);
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
            name: 'AI arama gorunurlugu (Claude · Gemini · ChatGPT · Perplexity)',
            score: aiCitationAvg ?? 0,
            providers: citationResults,
            ranAt: new Date().toISOString(),
          } as any,
        },
        issues: allIssues,
        durationMs: Date.now() - t0,
      },
    });

    // 7) Site status güncelle
    await this.prisma.site.update({
      where: { id: siteId },
      data: { status: 'AUDIT_COMPLETE' },
    });

    this.log.log(`[${siteId}] Audit bitti — skor: ${overallScore}/100, GEO: ${geoResult.score ?? '-'}/100, AI citation: ${aiCitationAvg ?? '-'}/100, ${allIssues.length} issue, ${(Date.now() - t0) / 1000}s`);

    return audit;
  }
}
