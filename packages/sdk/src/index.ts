/**
 * @luviai/sdk — Official Node.js SDK for LuviAI
 *
 * @example
 *   import { LuviAI } from '@luviai/sdk';
 *
 *   const luvi = new LuviAI({ apiKey: process.env.LUVIAI_API_KEY });
 *
 *   // Yeni makale uret
 *   const article = await luvi.articles.generate({
 *     siteId: 'site_123',
 *     topic: 'WordPress hosting nasıl seçilir',
 *   });
 *
 *   // Site GEO score
 *   const score = await luvi.audit.scoreCard('site_123');
 *
 *   // Reklam kampanyasi olustur
 *   const campaign = await luvi.ads.build('site_123', {
 *     platform: 'both',
 *     objective: 'leads',
 *     productOrService: 'Hosting paketleri',
 *     landingUrl: 'https://siteniz.com',
 *     budgetType: 'daily',
 *     budgetAmount: 100,
 *   });
 */

export interface LuviAIConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export class LuviAIError extends Error {
  constructor(public status: number, public body: any, message: string) {
    super(message);
    this.name = 'LuviAIError';
  }
}

export class LuviAI {
  public readonly sites: SitesAPI;
  public readonly articles: ArticlesAPI;
  public readonly audit: AuditAPI;
  public readonly ads: AdsAPI;
  public readonly analytics: AnalyticsAPI;
  public readonly social: SocialAPI;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(config: LuviAIConfig) {
    if (!config.apiKey?.startsWith('luvi_')) {
      throw new Error('apiKey must start with "luvi_". Get one at https://ai.luvihost.com/settings/api-keys');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://ai.luvihost.com/api';
    this.timeout = config.timeout ?? 60000;

    const requester = this.request.bind(this);
    this.sites = new SitesAPI(requester);
    this.articles = new ArticlesAPI(requester);
    this.audit = new AuditAPI(requester);
    this.ads = new AdsAPI(requester);
    this.analytics = new AnalyticsAPI(requester);
    this.social = new SocialAPI(requester);
  }

  async request<T = any>(path: string, options: RequestInit & { params?: Record<string, any> } = {}): Promise<T> {
    let url = this.baseUrl.replace(/\/+$/, '') + path;
    if (options.params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(options.params)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      }
      if (qs.toString()) url += '?' + qs.toString();
    }

    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': '@luviai/sdk-node/0.1',
        ...(options.headers as any),
      },
      body: options.body,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      let body: any;
      try { body = await res.json(); } catch { body = await res.text().catch(() => ''); }
      throw new LuviAIError(res.status, body, `LuviAI ${res.status}: ${typeof body === 'string' ? body.slice(0, 200) : body?.message ?? res.statusText}`);
    }

    if (res.headers.get('content-type')?.includes('application/json')) {
      return res.json();
    }
    return (await res.text()) as any;
  }
}

type Requester = LuviAI['request'];

// ──────────────────────────────────────────────────────────────────
// Resource APIs
// ──────────────────────────────────────────────────────────────────

class SitesAPI {
  constructor(private req: Requester) {}
  list() { return this.req('/sites'); }
  get(id: string) { return this.req(`/sites/${id}`); }
  create(data: { url: string; name: string; niche?: string; language?: string; autopilot?: boolean }) {
    return this.req('/sites', { method: 'POST', body: JSON.stringify(data) });
  }
  update(id: string, data: any) {
    return this.req(`/sites/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  delete(id: string) { return this.req(`/sites/${id}`, { method: 'DELETE' }); }
}

class ArticlesAPI {
  constructor(private req: Requester) {}
  list(siteId: string, status?: string) { return this.req(`/sites/${siteId}/articles`, { params: { status } }); }
  get(siteId: string, articleId: string) { return this.req(`/sites/${siteId}/articles/${articleId}`); }
  generate(args: { siteId: string; topic: string; targetIds?: string[] }) {
    return this.req(`/sites/${args.siteId}/articles/generate`, {
      method: 'POST',
      body: JSON.stringify({ topic: args.topic, targetIds: args.targetIds }),
    });
  }
  publish(siteId: string, articleId: string, targetIds: string[]) {
    return this.req(`/sites/${siteId}/articles/${articleId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ targetIds }),
    });
  }
  scheduled(siteId: string) { return this.req(`/sites/${siteId}/articles/scheduled`); }
  audio(siteId: string, articleId: string) {
    return this.req(`/sites/${siteId}/articles/${articleId}/audio`, { method: 'POST' });
  }
  video(siteId: string, articleId: string, format: 'horizontal' | 'vertical' = 'vertical') {
    return this.req(`/sites/${siteId}/articles/${articleId}/video`, {
      method: 'POST', body: JSON.stringify({ format }),
    });
  }
  translate(siteId: string, articleId: string, toLanguage: string) {
    return this.req(`/sites/${siteId}/articles/${articleId}/translate`, {
      method: 'POST', body: JSON.stringify({ toLanguage }),
    });
  }
}

class AuditAPI {
  constructor(private req: Requester) {}
  latest(siteId: string) { return this.req(`/sites/${siteId}/audit/latest`); }
  runNow(siteId: string) { return this.req(`/sites/${siteId}/audit/run-now`, { method: 'POST' }); }
  scoreCard(siteId: string) { return this.req(`/sites/${siteId}/audit/score-card`); }
  citationHistory(siteId: string, days = 30) { return this.req(`/sites/${siteId}/audit/citation-history`, { params: { days } }); }
  citationSnapshot(siteId: string) { return this.req(`/sites/${siteId}/audit/citation-snapshot`, { method: 'POST' }); }
  geoHeatmap(siteId: string, maxQueries = 10) {
    return this.req(`/sites/${siteId}/audit/geo-heatmap`, {
      method: 'POST', body: JSON.stringify({ maxQueries }),
    });
  }
  validateSchema(siteId: string, url: string) {
    return this.req(`/sites/${siteId}/audit/schema-validate`, {
      method: 'POST', body: JSON.stringify({ url }),
    });
  }
  autoFix(siteId: string, fixes: string[]) {
    return this.req(`/sites/${siteId}/audit/auto-fix-now`, {
      method: 'POST', body: JSON.stringify({ fixes }),
    });
  }
}

class AdsAPI {
  constructor(private req: Requester) {}
  campaigns(siteId: string, status?: string) { return this.req(`/sites/${siteId}/ads/campaigns`, { params: { status } }); }
  buildAudience(siteId: string, payload: { objective: string; productOrService: string; budget: number }) {
    return this.req(`/sites/${siteId}/ads/audience`, { method: 'POST', body: JSON.stringify(payload) });
  }
  buildCopy(siteId: string, payload: any) {
    return this.req(`/sites/${siteId}/ads/copy`, { method: 'POST', body: JSON.stringify(payload) });
  }
  buildImages(siteId: string, payload: { prompt: string; brandColor?: string; formats?: any[] }) {
    return this.req(`/sites/${siteId}/ads/images`, { method: 'POST', body: JSON.stringify(payload) });
  }
  build(siteId: string, payload: {
    platform: 'google_ads' | 'meta_ads' | 'both';
    objective: 'traffic' | 'leads' | 'conversions' | 'brand_awareness' | 'sales';
    productOrService: string;
    keyBenefit?: string;
    landingUrl: string;
    budgetType: 'daily' | 'lifetime';
    budgetAmount: number;
    autoLaunch?: boolean;
  }) {
    return this.req(`/sites/${siteId}/ads/build`, { method: 'POST', body: JSON.stringify(payload) });
  }
  launch(siteId: string, campaignId: string) {
    return this.req(`/sites/${siteId}/ads/${campaignId}/launch`, { method: 'POST' });
  }
  pause(siteId: string, campaignId: string) {
    return this.req(`/sites/${siteId}/ads/${campaignId}/pause`, { method: 'POST' });
  }
}

class AnalyticsAPI {
  constructor(private req: Requester) {}
  overview(siteId: string, days = 30) { return this.req(`/sites/${siteId}/analytics/overview`, { params: { days } }); }
  topArticles(siteId: string, limit = 10) { return this.req(`/sites/${siteId}/analytics/top-articles`, { params: { limit } }); }
  trending(siteId: string) { return this.req(`/sites/${siteId}/analytics/trending`); }
  report(siteId: string, range: 'week' | 'month' | 'year' = 'month') {
    return this.req(`/sites/${siteId}/analytics/report`, { params: { range } });
  }
}

class SocialAPI {
  constructor(private req: Requester) {}
  channels(siteId: string) { return this.req(`/sites/${siteId}/social/channels`); }
  publishNow(postId: string) {
    return this.req(`/social/posts/${postId}/publish-now`, { method: 'POST' });
  }
}

export default LuviAI;
