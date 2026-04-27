import { Injectable, Logger } from '@nestjs/common';

/**
 * Google PageSpeed Insights API wrapper.
 * Free tier — API key opsiyonel (anonymous'da rate limit düşük).
 * https://developers.google.com/speed/docs/insights/v5/get-started
 */
@Injectable()
export class PageSpeedService {
  private readonly log = new Logger(PageSpeedService.name);
  private readonly apiKey = process.env.PAGESPEED_API_KEY;

  async runAudit(url: string, strategy: 'mobile' | 'desktop' = 'mobile') {
    const params = new URLSearchParams({
      url,
      strategy,
      category: 'performance',
    });
    if (this.apiKey) params.set('key', this.apiKey);

    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`;

    try {
      const res = await fetch(apiUrl, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        this.log.warn(`PageSpeed API ${res.status}: ${url}`);
        return null;
      }
      const data: any = await res.json();
      const lh = data.lighthouseResult;
      const audits = lh?.audits ?? {};

      // Core Web Vitals
      return {
        performanceScore: Math.round((lh?.categories?.performance?.score ?? 0) * 100),
        lcp: audits['largest-contentful-paint']?.numericValue,
        fcp: audits['first-contentful-paint']?.numericValue,
        cls: audits['cumulative-layout-shift']?.numericValue,
        tbt: audits['total-blocking-time']?.numericValue,
        ttfb: audits['server-response-time']?.numericValue,
        opportunities: this.extractOpportunities(audits),
      };
    } catch (err: any) {
      this.log.error(`PageSpeed hata: ${err.message}`);
      return null;
    }
  }

  private extractOpportunities(audits: Record<string, any>): Array<{ id: string; title: string; savings: number }> {
    const opps: any[] = [];
    for (const [id, audit] of Object.entries(audits)) {
      if (audit.details?.type === 'opportunity' && audit.numericValue > 100) {
        opps.push({
          id,
          title: audit.title,
          savings: Math.round(audit.numericValue),
        });
      }
    }
    return opps.slice(0, 5);
  }
}
