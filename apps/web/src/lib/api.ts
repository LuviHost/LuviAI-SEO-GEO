/**
 * LuviAI API client.
 * NextAuth session cookie otomatik include edilir (credentials: 'include').
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    /** Kullanıcıya gösterilebilir Türkçe mesaj */
    public readonly userMessage: string,
    /** Backend'in dönüş gövdesi (debug için) */
    public readonly rawBody?: unknown,
  ) {
    super(userMessage);
    this.name = 'ApiError';
  }
}

function toUserMessage(status: number, body: unknown): string {
  // Backend zaten anlamlı bir Türkçe mesaj dönmüşse onu kullan
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown };
    const msg =
      typeof b.message === 'string'
        ? b.message
        : Array.isArray(b.message) && b.message.length > 0 && typeof b.message[0] === 'string'
          ? b.message.join(', ')
          : null;

    if (msg && msg !== 'Internal server error' && msg !== 'Bad Request') {
      return msg;
    }
  }

  if (status === 0) return 'Bağlantı kurulamadı. İnternet bağlantını kontrol et.';
  if (status === 400) return 'Gönderdiğin bilgilerde bir sorun var, lütfen kontrol et.';
  if (status === 401) return 'Oturumun süresi dolmuş, lütfen tekrar giriş yap.';
  if (status === 403) return 'Bu işlem için yetkin yok.';
  if (status === 404) return 'İstenen kayıt bulunamadı.';
  if (status === 409) return 'Bu kayıt zaten mevcut.';
  if (status === 413) return 'Gönderilen dosya çok büyük.';
  if (status === 422) return 'Girilen değerler geçersiz.';
  if (status === 429) return 'Çok fazla istek attın. Birkaç saniye bekleyip tekrar dene.';
  if (status === 502 || status === 503 || status === 504) {
    return 'Sunucu şu an cevap vermiyor. Birkaç saniye sonra tekrar dene.';
  }
  if (status >= 500) return 'Sunucu tarafında beklenmeyen bir sorun oluştu. Tekrar dene.';
  return 'Beklenmeyen bir hata oluştu, lütfen tekrar dene.';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
      credentials: 'include',
    });
  } catch (err: unknown) {
    throw new ApiError(0, toUserMessage(0, null), (err as Error)?.message);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      try {
        body = await res.text();
      } catch {
        body = null;
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[API ${res.status}] ${path}`, body);
    }
    throw new ApiError(res.status, toUserMessage(res.status, body), body);
  }

  return res.json();
}

export const api = {
  // Generic raw request (custom endpoints icin)
  request: <T = any>(path: string, options?: RequestInit) => request<T>(path, options),

  // Sites
  createSite: (body: { url: string; name: string; niche?: string; language?: string }) =>
    request<any>('/sites', { method: 'POST', body: JSON.stringify(body) }),

  // Sprint Onboarding
  updateSite: (id: string, body: any) =>
    request<any>(`/sites/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  completeOnboarding: (siteId: string) =>
    request<any>(`/sites/${siteId}/complete-onboarding`, { method: 'POST' }),

  getUserQuota: (userId: string) =>
    request<{ articles: { allowed: boolean; remaining: number; limit: number }; sites: any }>(`/billing/users/${userId}/quota`),

  regenerateBrain: (siteId: string) =>
    request<any>(`/sites/${siteId}/brain/regenerate`, { method: 'POST' }),

  listSites: () => request<any[]>('/sites'),

  getSite: (id: string) => request<any>(`/sites/${id}`),

  getBrain: (siteId: string) => request<any>(`/sites/${siteId}/brain`),

  deleteSite: (id: string) =>
    request<{ id: string }>(`/sites/${id}`, { method: 'DELETE' }),

  // Audit
  getLatestAudit: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/latest`),

  runAuditNow: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/run-now`, { method: 'POST' }),

  previewStaticWrite: (siteId: string, pageUrl: string, snippets: any[]) =>
    request<any>(`/sites/${siteId}/audit/snippets/static-preview`, { method: 'POST', body: JSON.stringify({ pageUrl, snippets }) }),

  writeStatic: (siteId: string, pageUrl: string, snippets: any[]) =>
    request<any>(`/sites/${siteId}/audit/snippets/static-write`, { method: 'POST', body: JSON.stringify({ pageUrl, snippets }) }),

  applySnippets: (siteId: string, snippets: any[]) =>
    request<any>(`/sites/${siteId}/audit/snippets/apply`, { method: 'POST', body: JSON.stringify({ snippets }) }),

  // Toplu snippet tarama — root URL'den alt sayfaları tara, SEO durumlarını çıkar (AI çağrısı yok)
  bulkScanSnippets: (siteId: string, rootUrl?: string, maxPages = 30) =>
    request<{
      pages: Array<{
        url: string;
        title: string | null;
        titleLength: number;
        metaDescription: string | null;
        metaDescriptionLength: number;
        h1: string | null;
        hasCanonical: boolean;
        hasOG: boolean;
        hasTwitter: boolean;
        hasSchema: boolean;
        hasFAQ: boolean;
        score: number;
        issues: string[];
      }>;
      totalScanned: number;
      averageScore: number;
    }>(`/sites/${siteId}/audit/snippets/bulk-scan?${rootUrl ? `rootUrl=${encodeURIComponent(rootUrl)}&` : ''}maxPages=${maxPages}`),

  getSnippets: (siteId: string, pageUrl?: string) =>
    request<any>(`/sites/${siteId}/audit/snippets${pageUrl ? `?pageUrl=${encodeURIComponent(pageUrl)}` : ""}`),

  runCitationTest: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/citation-test`, { method: 'POST' }),

  // ── BYOK (Bring Your Own Key) — Sprint BYOK ──
  getAiKeysStatus: (siteId: string) =>
    request<any>(`/sites/${siteId}/ai-keys`),

  upsertAiKey: (siteId: string, provider: string, key: string) =>
    request<any>(`/sites/${siteId}/ai-keys`, {
      method: 'POST',
      body: JSON.stringify({ provider, key }),
    }),

  deleteAiKey: (siteId: string, provider: string) =>
    request<any>(`/sites/${siteId}/ai-keys/${provider}`, { method: 'DELETE' }),

  retestAiKey: (siteId: string, provider: string) =>
    request<any>(`/sites/${siteId}/ai-keys/${provider}/test`, { method: 'POST' }),

  applyAutoFix: (siteId: string, fixes: string[]) =>
    request<any>(`/sites/${siteId}/audit/auto-fix-now`, {
      method: 'POST',
      body: JSON.stringify({ fixes }),
    }),

  // Topics
  getTopicQueue: (siteId: string) =>
    request<any>(`/sites/${siteId}/topics/queue`),

  regenerateTopics: (siteId: string) =>
    request<any>(`/sites/${siteId}/topics/regenerate`, { method: 'POST' }),

  runTopicsNow: (siteId: string) =>
    request<any>(`/sites/${siteId}/topics/run-now`, { method: 'POST' }),

  runTopicEngineNow: (siteId: string) =>
    request<any>(`/sites/${siteId}/topics/run-now`, { method: 'POST' }),

  // Articles
  listArticles: (siteId: string, status?: string) =>
    request<any[]>(`/sites/${siteId}/articles${status ? `?status=${status}` : ''}`),

  listScheduledArticles: (siteId: string) =>
    request<any[]>(`/sites/${siteId}/articles/scheduled`),

  scheduleArticleBatch: (siteId: string, count = 5) =>
    request<any>(`/sites/${siteId}/articles/schedule-batch`, {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),

  scheduleTopicToCalendar: (siteId: string, payload: { topic: string; scheduledAt: string; slug?: string; pillar?: string }) =>
    request<any>(`/sites/${siteId}/articles/schedule-topic`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  setArticleSocialPrePlan: (siteId: string, articleId: string, channelIds: string[] | null) =>
    request<any>(`/sites/${siteId}/articles/${articleId}/social-pre-plan`, {
      method: 'PATCH', body: JSON.stringify({ channelIds }),
    }),

  rescheduleArticle: (siteId: string, articleId: string, scheduledAt: string) =>
    request<any>(`/sites/${siteId}/articles/${articleId}/reschedule`, {
      method: 'PUT',
      body: JSON.stringify({ scheduledAt }),
    }),

  unscheduleArticle: (siteId: string, articleId: string) =>
    request<any>(`/sites/${siteId}/articles/scheduled/${articleId}`, {
      method: 'DELETE',
    }),

  // Otopilot + platform
  setAutopilot: (siteId: string, enabled: boolean) =>
    request<any>(`/sites/${siteId}/autopilot`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),

  createDemoSite: () =>
    request<{ siteId: string; articles: number }>(`/sites/demo`, { method: 'POST' }),

  // Sprint B — Agency
  getAgencyOverview: () => request<any>(`/agency/overview`),
  inviteAgencyClient: (payload: { email: string; name?: string }) =>
    request<any>(`/agency/invite`, { method: 'POST', body: JSON.stringify(payload) }),
  updateWhitelabel: (payload: any) =>
    request<any>(`/agency/whitelabel`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // Sprint C — API Keys
  listApiKeys: () => request<any[]>(`/api-keys`),
  createApiKey: (payload: { name: string; scopes?: string[]; expiresInDays?: number; rateLimit?: number }) =>
    request<any>(`/api-keys`, { method: 'POST', body: JSON.stringify(payload) }),
  revokeApiKey: (id: string) => request<any>(`/api-keys/${id}`, { method: 'DELETE' }),

  detectPlatform: (siteId: string) =>
    request<any>(`/sites/${siteId}/detect-platform`, { method: 'POST' }),

  // GEO
  getCitationHistory: (siteId: string, days = 30) =>
    request<any>(`/sites/${siteId}/audit/citation-history?days=${days}`),

  triggerCitationSnapshot: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/citation-snapshot`, { method: 'POST' }),

  buildLlmsFull: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/llms-full/build`, { method: 'POST' }),

  getLlmsFullUrl: (siteId: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/sites/${siteId}/audit/llms-full.txt`;
  },

  pingIndex: (siteId: string, url: string) =>
    request<any>(`/sites/${siteId}/audit/index-ping`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  runGeoHeatmap: (siteId: string, maxQueries = 10) =>
    request<any>(`/sites/${siteId}/audit/geo-heatmap`, {
      method: 'POST',
      body: JSON.stringify({ maxQueries }),
    }),

  getWikidataDraft: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/knowledge/wikidata`),

  getWikipediaDraft: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/knowledge/wikipedia`),

  generateArticleAudio: (siteId: string, articleId: string) =>
    request<any>(`/sites/${siteId}/articles/${articleId}/audio`, { method: 'POST' }),

  submitKnowledge: (siteId: string, target: 'wikidata' | 'wikipedia', draft: any, lang?: 'tr' | 'en') =>
    request<any>(`/sites/${siteId}/audit/knowledge/submit`, {
      method: 'POST',
      body: JSON.stringify({ target, draft, lang }),
    }),

  findCommunity: (siteId: string, limit = 10) =>
    request<any[]>(`/sites/${siteId}/audit/community/find`, {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),

  suggestCrossLinks: (siteId: string, articleId: string, limit = 5) =>
    request<any[]>(`/sites/${siteId}/audit/cross-link/suggest`, {
      method: 'POST',
      body: JSON.stringify({ articleId, limit }),
    }),

  applyCrossLink: (siteId: string, suggestion: any) =>
    request<any>(`/sites/${siteId}/audit/cross-link/apply`, {
      method: 'POST',
      body: JSON.stringify({ suggestion }),
    }),

  getTrainingDataMetadata: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/training-data`),

  getTrainingDataDownloadUrl: (siteId: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/sites/${siteId}/audit/training-data.jsonl`;
  },

  ingestCrawlerLog: (siteId: string, logContent: string) =>
    request<any>(`/sites/${siteId}/audit/crawler/ingest`, {
      method: 'POST',
      body: JSON.stringify({ logContent }),
    }),

  getCrawlerHistory: (siteId: string, days = 30) =>
    request<any>(`/sites/${siteId}/audit/crawler/history?days=${days}`),

  getGeoScoreCard: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/score-card`),

  validateSchema: (siteId: string, url: string) =>
    request<any>(`/sites/${siteId}/audit/schema-validate`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  getTrackerEmbedUrl: (siteId: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/tracker.js?site=${siteId}`;
  },

  getAiSitemapUrl: (siteId: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/sites/${siteId}/audit/sitemap-ai.xml`;
  },

  getAuthorProfile: (siteId: string, persona: string) =>
    request<any>(`/sites/${siteId}/audit/author-profile?persona=${encodeURIComponent(persona)}`),

  parseHaroDigest: (siteId: string, emailContent: string) =>
    request<any[]>(`/sites/${siteId}/audit/haro/parse`, {
      method: 'POST',
      body: JSON.stringify({ emailContent }),
    }),

  generateProgrammaticCities: (siteId: string, payload: { template: string; cities?: string[]; spreadDays?: number; maxQuota?: number }) =>
    request<any>(`/sites/${siteId}/articles/programmatic/cities`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAiReferrerHistory: (siteId: string, days = 30) =>
    request<any>(`/sites/${siteId}/audit/ai-referrer/history?days=${days}`),

  getWidgetEmbedUrl: (siteId: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/widget.js?site=${siteId}`;
  },

  generateArticleVideo: (siteId: string, articleId: string, format: 'horizontal' | 'vertical' = 'vertical') =>
    request<any>(`/sites/${siteId}/articles/${articleId}/video`, {
      method: 'POST',
      body: JSON.stringify({ format }),
    }),

  uploadVideoToYouTube: (siteId: string, articleId: string, videoPath: string) =>
    request<any>(`/sites/${siteId}/articles/${articleId}/video/youtube`, {
      method: 'POST',
      body: JSON.stringify({ videoPath }),
    }),

  // Faz 11 — Ads Manager
  listAdCampaigns: (siteId: string, status?: string) =>
    request<any[]>(`/sites/${siteId}/ads/campaigns${status ? `?status=${status}` : ''}`),

  buildAudience: (siteId: string, payload: { objective: string; productOrService: string; budget: number }) =>
    request<any>(`/sites/${siteId}/ads/audience`, { method: 'POST', body: JSON.stringify(payload) }),

  buildAdCopy: (siteId: string, payload: any) =>
    request<any>(`/sites/${siteId}/ads/copy`, { method: 'POST', body: JSON.stringify(payload) }),

  buildAdImages: (siteId: string, payload: { prompt: string; brandColor?: string; formats?: any[] }) =>
    request<any[]>(`/sites/${siteId}/ads/images`, { method: 'POST', body: JSON.stringify(payload) }),

  buildCampaign: (siteId: string, payload: any) =>
    request<any>(`/sites/${siteId}/ads/build`, { method: 'POST', body: JSON.stringify(payload) }),

  launchCampaign: (siteId: string, campaignId: string) =>
    request<any>(`/sites/${siteId}/ads/${campaignId}/launch`, { method: 'POST' }),

  pauseCampaign: (siteId: string, campaignId: string) =>
    request<any>(`/sites/${siteId}/ads/${campaignId}/pause`, { method: 'POST' }),

  // Faz 11.2 — Direkt API entegrasyonu (Ryze AI MCP kaldırıldı)
  getAdsConnections: (siteId: string) =>
    request<{ google: boolean; meta: boolean }>(`/sites/${siteId}/ads/connections`),

  connectGoogleAds: (siteId: string, payload: { customerId?: string; refreshToken?: string }) =>
    request<any>(`/sites/${siteId}/ads/google-ads`, { method: 'PATCH', body: JSON.stringify(payload) }),

  connectMetaAds: (siteId: string, payload: { accountId?: string; accessToken?: string; pageId?: string; instagramActorId?: string }) =>
    request<any>(`/sites/${siteId}/ads/meta-ads`, { method: 'PATCH', body: JSON.stringify(payload) }),

  updateAdsSettings: (siteId: string, payload: { adsAutopilot?: boolean }) =>
    request<any>(`/sites/${siteId}/ads/settings`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // Faz 12 — Ads Audit (Kampanya Skoru, claude-ads port'u)
  runAdsAudit: (siteId: string, platform: 'google' | 'meta' = 'google', industry: string = 'saas') =>
    request<any>(`/sites/${siteId}/ads/audit/run-now?platform=${platform}&industry=${industry}`, { method: 'POST' }),

  getLatestAdsAudit: (siteId: string, platform: 'google' | 'meta' = 'google') =>
    request<any>(`/sites/${siteId}/ads/audit/latest?platform=${platform}`),

  // Faz 11.5 — OAuth popup flow
  getOAuthStartUrl: (provider: 'google-ads' | 'meta-ads', siteId: string) =>
    request<{ url: string }>(`/oauth/${provider}/start?siteId=${siteId}`),

  getOAuthOptions: (provider: 'google-ads' | 'meta-ads', siteId: string) =>
    request<any>(`/oauth/${provider}/options?siteId=${siteId}`),

  selectOAuthAccount: (provider: 'google-ads' | 'meta-ads', siteId: string, body: any) =>
    request<any>(`/oauth/${provider}/select?siteId=${siteId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Reports
  getReport: (siteId: string, range: 'week' | 'month' | 'year' = 'month') =>
    request<any>(`/sites/${siteId}/analytics/report?range=${range}`),

  getReportCsvUrl: (siteId: string, range: 'week' | 'month' | 'year' = 'month') => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/sites/${siteId}/analytics/report.csv?range=${range}`;
  },

  getArticle: (siteId: string, articleId: string) =>
    request<any>(`/sites/${siteId}/articles/${articleId}`),

  // Async queue (placeholder Article = GENERATING + worker job).
  // F5 yenilense bile Article DB'de inflight kalır → progress UI persist eder.
  generateArticle: (siteId: string, topic: string) =>
    request<any>(`/sites/${siteId}/articles/generate`, {
      method: 'POST',
      body: JSON.stringify({ topic }),
    }),

  publishArticle: (siteId: string, articleId: string, targetIds: string[]) =>
    request<any>(`/sites/${siteId}/articles/${articleId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ targetIds }),
    }),

  // SCHEDULED article'ı şimdi üretime al (cron'u bekleme).
  triggerArticleNow: (siteId: string, articleId: string) =>
    request<any>(`/sites/${siteId}/articles/${articleId}/trigger-now`, {
      method: 'POST',
    }),

  // Publish Targets
  getPublishTargetsCatalog: () => request<any[]>('/publish-targets/catalog'),
  listPublishTargets: (siteId: string) => request<any[]>(`/sites/${siteId}/publish-targets`),
  createPublishTarget: (siteId: string, body: any) =>
    request<any>(`/sites/${siteId}/publish-targets`, { method: 'POST', body: JSON.stringify(body) }),
  updatePublishTarget: (id: string, body: any) =>
    request<any>(`/publish-targets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePublishTarget: (id: string) =>
    request<any>(`/publish-targets/${id}`, { method: 'DELETE' }),
  testPublishTarget: (id: string) =>
    request<any>(`/publish-targets/${id}/test`, { method: 'POST' }),

  // Admin
  getAdminOverview: () => request<any>('/admin/overview'),
  getAdminUsers: () => request<any[]>('/admin/users'),
  getAdminInvoices: (status?: string) =>
    request<any[]>(`/admin/invoices${status ? `?status=${status}` : ''}`),
  getAdminSites: () => request<any[]>('/admin/sites'),
  getAdminFailedJobs: () => request<any[]>('/admin/jobs/failed'),

  // Faz 12 — LLM Spend (LibreChat tx pattern)
  getAdminSpend: (days = 30) =>
    request<{
      totalUsd: number;
      byProvider: Record<string, number>;
      byContext: Record<string, number>;
      byDate: Record<string, number>;
      requestCount: number;
    }>(`/admin/spend?days=${days}`),

  getSiteSpend: (siteId: string, days = 30) =>
    request<{
      totalUsd: number;
      byProvider: Record<string, number>;
      byContext: Record<string, number>;
      byDate: Record<string, number>;
      requestCount: number;
    }>(`/sites/${siteId}/spend?days=${days}`),

  // Admin Queue Monitor (BullMQ)
  adminQueueStats: () => request<{ counts: Record<string, number>; paused: boolean }>('/admin/queue/stats'),
  adminQueueJobs: (state: string, limit = 50) =>
    request<any[]>(`/admin/queue/jobs?state=${state}&limit=${limit}`),
  adminQueueRetryJob: (jobId: string) =>
    request<{ ok: boolean }>(`/admin/queue/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }),
  adminQueuePromoteJob: (jobId: string) =>
    request<{ ok: boolean }>(`/admin/queue/jobs/${encodeURIComponent(jobId)}/promote`, { method: 'POST' }),
  adminQueueRemoveJob: (jobId: string) =>
    request<{ ok: boolean }>(`/admin/queue/jobs/${encodeURIComponent(jobId)}/remove`, { method: 'POST' }),
  adminQueuePause: () => request<{ ok: boolean; paused: boolean }>('/admin/queue/pause', { method: 'POST' }),
  adminQueueResume: () => request<{ ok: boolean; paused: boolean }>('/admin/queue/resume', { method: 'POST' }),
  sendAdminEmailTest: (body: { to: string; template?: string; name?: string }) =>
    request<{ ok: boolean; resendId?: string; mode: string; template: string; to: string }>(
      '/admin/email-test',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // Admin -> Settings (runtime ayar yönetimi)
  getAdminSettings: () => request<any[]>('/admin/settings'),
  getAdminSettingsGrouped: () => request<Record<string, any[]>>('/admin/settings?grouped=1'),
  updateAdminSetting: (key: string, value: string | number | boolean) =>
    request<{ key: string; value: string; unchanged: boolean; oldValue?: string }>(
      `/admin/settings/${encodeURIComponent(key)}`,
      { method: 'PUT', body: JSON.stringify({ value }) },
    ),
  getAdminSettingsAudit: (limit = 100) =>
    request<any[]>(`/admin/settings/audit?limit=${limit}`),
  getAdminSettingAudit: (key: string) =>
    request<any[]>(`/admin/settings/${encodeURIComponent(key)}/audit`),

  // Me (login olmuş kullanıcı)
  getMe: () => request<any>('/me'),
  getMyDashboard: () => request<any>('/me/dashboard'),

  // Billing
  getPlans: (locale?: string) => request<any[]>(`/billing/plans${locale ? '?locale=' + locale : ''}`),
  enterpriseInquiry: (body: { name: string; email: string; company?: string; phone?: string; message?: string; source?: string }) =>
    request<{ ok: true }>('/billing/enterprise-inquiry', { method: 'POST', body: JSON.stringify(body) }),
  getCurrentFxRate: () => request<{ usdToTry: number; source: string; cachedFor: string }>('/billing/fx-rate'),

  // Analytics
  getAnalyticsOverview: (siteId: string, days = 30) =>
    request<any>(`/sites/${siteId}/analytics/overview?days=${days}`),

  getTopArticles: (siteId: string, limit = 10) =>
    request<any[]>(`/sites/${siteId}/analytics/top-articles?limit=${limit}`),

  getTrendingQueries: (siteId: string) =>
    request<any[]>(`/sites/${siteId}/analytics/trending`),

  getImprovementSuggestions: (siteId: string) =>
    request<any[]>(`/sites/${siteId}/analytics/suggestions`),

  triggerSnapshotNow: (siteId: string) =>
    request<any>(`/sites/${siteId}/analytics/snapshot-now`, { method: 'POST' }),

  getGaSummary: (siteId: string, days = 30) =>
    request<any>(`/sites/${siteId}/analytics/ga-summary?days=${days}`),

  // GSC OAuth
  getGscAuthUrl: (siteId: string) =>
    request<{ url: string }>(`/auth/gsc/start?siteId=${encodeURIComponent(siteId)}`),

  disconnectGsc: (siteId: string) =>
    request<{ ok: boolean }>(`/auth/gsc/disconnect`, {
      method: 'POST',
      body: JSON.stringify({ siteId }),
    }),

  listGscProperties: (siteId: string) =>
    request<Array<{ siteUrl: string; permissionLevel: string | null }>>(
      `/sites/${siteId}/gsc/properties`,
    ),

  setGscProperty: (siteId: string, propertyUrl: string) =>
    request<{ siteUrl: string }>(`/sites/${siteId}/gsc/property`, {
      method: 'PATCH',
      body: JSON.stringify({ propertyUrl }),
    }),

  // GA4 OAuth
  getGaAuthUrl: (siteId: string) =>
    request<{ url: string }>(`/auth/ga/start?siteId=${encodeURIComponent(siteId)}`),

  disconnectGa: (siteId: string) =>
    request<{ ok: boolean }>(`/auth/ga/disconnect`, {
      method: 'POST',
      body: JSON.stringify({ siteId }),
    }),

  listGaProperties: (siteId: string) =>
    request<Array<{ propertyId: string; displayName: string; accountName: string }>>(
      `/sites/${siteId}/ga/properties`,
    ),

  setGaProperty: (siteId: string, propertyId: string) =>
    request<{ propertyId: string; displayName: string; accountName: string }>(
      `/sites/${siteId}/ga/property`,
      {
        method: 'PATCH',
        body: JSON.stringify({ propertyId }),
      },
    ),

  // Competitors (brain)
  listCompetitors: (siteId: string) =>
    request<Array<{ name: string; url: string; strengths?: string[]; weaknesses?: string[] }>>(
      `/sites/${siteId}/competitors`,
    ),

  setCompetitors: (
    siteId: string,
    competitors: Array<{ name: string; url: string; strengths?: string[]; weaknesses?: string[] }>,
  ) =>
    request<typeof competitors>(`/sites/${siteId}/competitors`, {
      method: 'PUT',
      body: JSON.stringify({ competitors }),
    }),

  // Social — catalog
  getSocialCatalog: () =>
    request<Array<{ type: string; label: string; status: 'live' | 'soon' }>>('/social/catalog'),

  // Social — channels
  listSocialChannels: (siteId: string) =>
    request<Array<any>>(`/sites/${siteId}/social/channels`),

  updateSocialChannel: (channelId: string, body: { name?: string; isActive?: boolean; isDefault?: boolean; config?: any }) =>
    request<any>(`/social/channels/${channelId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteSocialChannel: (channelId: string) =>
    request<{ ok: boolean }>(`/social/channels/${channelId}`, { method: 'DELETE' }),

  startSocialOAuth: (siteId: string, type: string) =>
    request<{ url: string }>(`/sites/${siteId}/social/${type}/oauth/start`),

  listLinkedInPages: (channelId: string) =>
    request<Array<{ organizationUrn: string; organizationId: string; name: string; vanityName?: string; logoUrl?: string }>>(
      `/social/channels/${channelId}/linkedin/pages`,
    ),

  setLinkedInPage: (channelId: string, body: { organizationUrn: string; organizationName: string }) =>
    request<any>(`/social/channels/${channelId}/linkedin/page`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  // Social — posts
  listSocialPosts: (siteId: string, params?: { channelId?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.channelId) qs.set('channelId', params.channelId);
    if (params?.status) qs.set('status', params.status);
    const tail = qs.toString() ? `?${qs.toString()}` : '';
    return request<Array<any>>(`/sites/${siteId}/social/posts${tail}`);
  },

  createSocialPost: (body: {
    channelId: string;
    text: string;
    mediaUrls?: any[];
    metadata?: any;
    scheduledFor?: string | null;
    articleId?: string;
    status?: 'DRAFT' | 'QUEUED';
  }) =>
    request<any>('/social/posts', { method: 'POST', body: JSON.stringify(body) }),

  updateSocialPost: (postId: string, body: any) =>
    request<any>(`/social/posts/${postId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteSocialPost: (postId: string) =>
    request<{ ok: boolean }>(`/social/posts/${postId}`, { method: 'DELETE' }),

  publishSocialPostNow: (postId: string) =>
    request<any>(`/social/posts/${postId}/publish-now`, { method: 'POST' }),

  // Social — media generation + approval
  socialMediaPolicy: () =>
    request<Record<string, { default: 'text' | 'image' | 'video'; options: Array<'text' | 'image' | 'video'>; editable: boolean }>>(`/social/media-policy`),

  generateSocialPostMedia: (postId: string, mediaType?: 'text' | 'image' | 'video') =>
    request<{ ok: boolean; mediaType: string; mediaUrls: Array<{ url: string; type: 'image' | 'video'; altText?: string }>; error?: string }>(
      `/social/posts/${postId}/generate-media`,
      { method: 'POST', body: JSON.stringify({ mediaType }) },
    ),

  approveSocialPost: (postId: string, scheduledFor?: string) =>
    request<any>(`/social/posts/${postId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ scheduledFor }),
    }),

  backfillSocialDrafts: (siteId: string, daysAgo = 30) =>
    request<{ articleCount: number; created: number; skipped: number }>(
      `/sites/${siteId}/social/posts/backfill`,
      { method: 'POST', body: JSON.stringify({ daysAgo }) },
    ),

  // Social — calendar / plan / slots
  getSocialCalendar: (siteId: string, params?: { from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const tail = qs.toString() ? `?${qs.toString()}` : '';
    return request<{
      plan: string;
      postsPerWeek: number;
      timezone: string;
      channels: Array<any>;
      slots: Array<any>;
      defaultSlots: Array<{ dayOfWeek: number; hour: number; minute: number; label: string }>;
      stats: { draftCount: number; queuedCount: number; publishedCount: number; total: number };
      posts: Array<any>;
    }>(`/sites/${siteId}/social/calendar${tail}`);
  },

  getSocialPlanInfo: (siteId: string) =>
    request<{
      plan: string;
      postsPerWeek: number;
      timezone: string;
      defaultSlots: Array<{ dayOfWeek: number; hour: number; minute: number; label: string }>;
      tiers: Array<{ plan: string; postsPerWeek: number }>;
    }>(`/sites/${siteId}/social/plan`),

  listSocialSlots: (siteId: string) =>
    request<Array<any>>(`/sites/${siteId}/social/slots`),

  seedSocialSlots: (siteId: string, body: { replace?: boolean } = {}) =>
    request<{ created: number; channelId: string; total: number }>(
      `/sites/${siteId}/social/slots/seed`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  createSocialSlot: (
    channelId: string,
    body: { dayOfWeek: number; hour: number; minute: number; source?: 'QUEUE' | 'AUTO'; isActive?: boolean },
  ) =>
    request<any>(`/social/channels/${channelId}/slots`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateSocialSlot: (
    slotId: string,
    body: { dayOfWeek?: number; hour?: number; minute?: number; source?: 'QUEUE' | 'AUTO'; isActive?: boolean },
  ) =>
    request<any>(`/social/slots/${slotId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  deleteSocialSlot: (slotId: string) =>
    request<{ ok: boolean }>(`/social/slots/${slotId}`, { method: 'DELETE' }),

  // ──────────────────────────────────────────────────────────────────
  // Brightbean parity — Approval workflow + Inbox + Media Library + Ideas
  // ──────────────────────────────────────────────────────────────────

  submitPostForApproval: (postId: string) =>
    request<any>(`/social/posts/${postId}/submit-for-approval`, { method: 'POST' }),

  rejectPost: (postId: string, reason?: string) =>
    request<any>(`/social/posts/${postId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Inbox
  listInbox: (siteId: string, params: { status?: string; type?: string; channelId?: string; limit?: number; cursor?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.type) q.set('type', params.type);
    if (params.channelId) q.set('channelId', params.channelId);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', params.cursor);
    const tail = q.toString() ? `?${q.toString()}` : '';
    return request<Array<any>>(`/sites/${siteId}/social/inbox${tail}`);
  },
  inboxUnreadCount: (siteId: string) => request<number>(`/sites/${siteId}/social/inbox/unread-count`),
  inboxMarkRead: (messageId: string) => request<any>(`/social/inbox/${messageId}/read`, { method: 'PATCH' }),
  inboxReply: (messageId: string, reply: string) =>
    request<any>(`/social/inbox/${messageId}/reply`, { method: 'POST', body: JSON.stringify({ reply }) }),
  inboxArchive: (messageId: string) => request<any>(`/social/inbox/${messageId}/archive`, { method: 'POST' }),
  inboxResolve: (messageId: string) => request<any>(`/social/inbox/${messageId}/resolve`, { method: 'POST' }),

  // Media Library
  listMediaLibrary: (params: { siteId?: string; folder?: string; source?: string; limit?: number; cursor?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.siteId) q.set('siteId', params.siteId);
    if (params.folder) q.set('folder', params.folder);
    if (params.source) q.set('source', params.source);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', params.cursor);
    const tail = q.toString() ? `?${q.toString()}` : '';
    return request<Array<any>>(`/social/media-library${tail}`);
  },
  listMediaFolders: (siteId?: string) =>
    request<string[]>(`/social/media-library/folders${siteId ? `?siteId=${siteId}` : ''}`),
  createMediaAsset: (body: any) =>
    request<any>('/social/media-library', { method: 'POST', body: JSON.stringify(body) }),
  updateMediaAsset: (assetId: string, body: any) =>
    request<any>(`/social/media-library/${assetId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteMediaAsset: (assetId: string) =>
    request<{ ok: boolean }>(`/social/media-library/${assetId}`, { method: 'DELETE' }),

  // Idea Board (kanban)
  ideaBoard: (siteId?: string) =>
    request<Record<'UNASSIGNED' | 'TODO' | 'IN_PROGRESS' | 'DONE', any[]>>(`/social/ideas/board${siteId ? `?siteId=${siteId}` : ''}`),
  createIdea: (body: { title: string; notes?: string; siteId?: string; column?: 'UNASSIGNED' | 'TODO' | 'IN_PROGRESS' | 'DONE'; hashtags?: string[]; refUrls?: string[]; dueAt?: string }) =>
    request<any>('/social/ideas', { method: 'POST', body: JSON.stringify(body) }),
  updateIdea: (ideaId: string, body: any) =>
    request<any>(`/social/ideas/${ideaId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  moveIdea: (ideaId: string, column: 'UNASSIGNED' | 'TODO' | 'IN_PROGRESS' | 'DONE', position: number) =>
    request<any>(`/social/ideas/${ideaId}/move`, { method: 'POST', body: JSON.stringify({ column, position }) }),
  convertIdeaToPost: (ideaId: string, channelId: string) =>
    request<any>(`/social/ideas/${ideaId}/convert`, { method: 'POST', body: JSON.stringify({ channelId }) }),
  deleteIdea: (ideaId: string) =>
    request<{ ok: boolean }>(`/social/ideas/${ideaId}`, { method: 'DELETE' }),

  // Notifications
  listNotifications: (params: { unreadOnly?: boolean; type?: string; limit?: number; cursor?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.unreadOnly) q.set('unread', '1');
    if (params.type) q.set('type', params.type);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', params.cursor);
    const tail = q.toString() ? `?${q.toString()}` : '';
    return request<Array<any>>(`/notifications${tail}`);
  },
  notificationsUnreadCount: () => request<number>('/notifications/unread-count'),
  markNotificationRead: (id: string) => request<any>(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request<number>('/notifications/read-all', { method: 'POST' }),
  deleteNotification: (id: string) =>
    request<{ ok: boolean }>(`/notifications/${id}`, { method: 'DELETE' }),

  // ──────────────────────────────────────────────────────────────────
  // Video Factory (Faz 12)
  // ──────────────────────────────────────────────────────────────────

  listVideoProviders: () => request<Array<{
    key: 'SLIDESHOW' | 'VEO' | 'RUNWAY' | 'HEYGEN' | 'SORA';
    label: string;
    description: string;
    estTime: string;
    costBand: string;
    quality: number;
    requiredEnvKeys: string[];
    ready: boolean;
    note?: string;
    bestFor?: string[];
  }>>('/videos/providers'),

  listVideos: (siteId: string) => request<any[]>(`/sites/${siteId}/videos`),

  createVideo: (
    siteId: string,
    body: {
      title: string;
      scriptText: string;
      provider: 'SLIDESHOW' | 'VEO' | 'RUNWAY' | 'HEYGEN' | 'SORA';
      durationSec?: number;
      aspectRatio?: '9:16' | '16:9' | '1:1';
      voiceId?: string;
      language?: string;
      style?: string;
      imageUrls?: string[];
      articleId?: string;
    },
  ) =>
    request<any>(`/sites/${siteId}/videos`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getVideo: (id: string) => request<any>(`/videos/${id}`),

  deleteVideo: (id: string) =>
    request<{ id: string }>(`/videos/${id}`, { method: 'DELETE' }),

  // ──────────────────────────────────────────────────────────────────
  // ASO Health (claude-code-aso-skill port) — score gauge + competitors
  // ──────────────────────────────────────────────────────────────────

  asoCalculateScore: (
    siteId: string,
    appId: string,
    body: {
      targetKeywords?: string[];
      keywordPerformance?: { top_10?: number; top_50?: number; top_100?: number; improving_keywords?: number };
      conversion?: { impression_to_install?: number; downloads_last_30_days?: number; downloads_trend?: 'up' | 'stable' | 'down' };
    } = {},
  ) =>
    request<{
      appId: string;
      appName: string;
      computedAt: string;
      overall_score: number;
      grade: 'A' | 'B' | 'C' | 'D' | 'F';
      breakdown: Record<string, { score: number; weight: number; weighted_contribution: number }>;
      recommendations: Array<{ category: string; priority: 'high' | 'medium' | 'low'; action: string; details: string; expected_impact: string }>;
      strengths: string[];
      weaknesses: string[];
    }>(`/sites/${siteId}/aso/apps/${appId}/score`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  asoListCompetitors: (siteId: string, category: string, country = 'tr', limit = 10) =>
    request<{
      category: string;
      country: string;
      count: number;
      results: Array<{
        app_id?: number;
        app_name?: string;
        developer?: string;
        category?: string;
        rating: number;
        ratings_count: number;
        description: string;
        icon_url?: string;
        app_store_url?: string;
        price: string;
        screenshots: string[];
      }>;
    }>(`/sites/${siteId}/aso/competitors?category=${encodeURIComponent(category)}&country=${country}&limit=${limit}`),

  asoCompareCompetitors: (siteId: string, names: string[], country = 'tr') =>
    request<{
      country: string;
      count: number;
      results: Array<any>;
    }>(`/sites/${siteId}/aso/competitors/compare`, {
      method: 'POST',
      body: JSON.stringify({ names, country }),
    }),
};
