/**
 * RanksUp API client.
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
  if (status >= 500) {
    // Backend'in döndüğü spesifik mesajı önce dene
    if (body && typeof body === 'object') {
      const b = body as { message?: unknown; error?: unknown };
      if (typeof b.message === 'string' && b.message.length > 0 && b.message.length < 500) return b.message;
      if (typeof b.error === 'string' && b.error.length > 0 && b.error.length < 500) return b.error;
    }
    return 'Sunucu tarafında beklenmeyen bir sorun oluştu. Tekrar dene.';
  }
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

  // NestJS handler null/undefined dondugunde govde BOS gelir (Content-Length: 0).
  // res.json() bos govdede "Unexpected end of JSON input" firlatiyordu — 200'lu
  // bos yanit hata degil, null'dir (ör. agent-readiness/latest ilk taramadan once).
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null as T;
  }
}

/** Audit delta raporu — GET /sites/:id/audit/compare cevabi */
export interface AuditComparison {
  from: { id: string; ranAt: string; overallScore: number; geoScore: number | null } | null;
  to: { id: string; ranAt: string; overallScore: number; geoScore: number | null } | null;
  scoreDelta: number;
  geoScoreDelta: number;
  checks: Array<{
    id: string;
    oncekiScore: number | null;
    sonrakiScore: number | null;
    delta: number;
    durum: 'iyilesti' | 'kotulesti' | 'ayni' | 'yeni' | 'kayboldu';
  }>;
  issues: {
    cozulen: AuditIssueRecord[];
    yeniCikan: AuditIssueRecord[];
    devamEden: AuditIssueRecord[];
  };
  ozet: { cozulenSayisi: number; yeniSayisi: number; devamEdenSayisi: number };
  /** Tek tarama varsa true — karsilastirilacak referans yok */
  yeterliVeriYok?: boolean;
}

export interface AuditIssueRecord {
  severity?: 'critical' | 'warning' | 'info' | string;
  type?: string;
  page?: string;
  description?: string;
  fixable?: boolean;
  checkId?: string;
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
    request<{
      articles: { allowed: boolean; remaining: number; limit: number };
      sites: { allowed: boolean; current: number; limit: number };
      /** AI gorunurluk calistirmasi (AI Citation + Prompt Lab ayni kovadan duser) */
      aiRuns: { allowed: boolean; used: number; limit: number; remaining: number };
      budget: { used: number; cap: number; pct: number; warn: boolean; hardBlock: boolean };
    }>(`/billing/users/${userId}/quota`),

  detectNiche: (url: string) =>
    request<{
      niche: string;
      customNiche?: string;
      confidence: number;
      reasoning: string;
      alternatives: Array<{ niche: string; confidence: number }>;
    }>('/sites/detect-niche', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

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

  /**
   * SENKRON tarama — istek tarama bitene kadar (1-3 dk) acik kalir.
   * Vekil sunucu (Cloudflare varsayilani ~100 sn) bunu keser; UI icin
   * queueAudit + getJob yoklamasi kullanin. Eski cagrilar bozulmasin diye
   * duruyor.
   */
  runAuditNow: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/run-now`, { method: 'POST' }),

  /** Taramayi KUYRUGA atar, hemen doner. Durum icin getJob ile yoklayin. */
  queueAudit: (siteId: string) =>
    request<{ id: string; status: string }>(`/sites/${siteId}/audit/run`, { method: 'POST' }),

  /** Is durumu — QUEUED | PROCESSING | COMPLETED | FAILED | CANCELED */
  getJob: (jobId: string) =>
    request<{
      id: string;
      status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
      error: string | null;
      result: unknown;
      finishedAt: string | null;
    }>(`/jobs/${jobId}`),

  // Tarama geçmişi + iki tarama arası fark
  getAuditHistory: (siteId: string, limit = 20) =>
    request<Array<{
      id: string;
      ranAt: string;
      overallScore: number;
      geoScore: number | null;
      issueCount: number;
      durationMs: number | null;
    }>>(`/sites/${siteId}/audit/history?limit=${limit}`),

  compareAudits: (siteId: string, opts: { fromId?: string; toId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.fromId) qs.set('fromId', opts.fromId);
    if (opts.toId) qs.set('toId', opts.toId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<AuditComparison>(`/sites/${siteId}/audit/compare${suffix}`);
  },

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

  // ── Prompt Lab — kullanıcının takip ettiği sorular ────────────
  listPrompts: (siteId: string, includeInactive = false) =>
    request<Array<{
      id: string; text: string; intent: string; locale: string; source: string;
      tags: unknown; isActive: boolean; fanoutCount: number;
      lastRunAt: string | null; lastCitedCount: number; lastTotalCount: number;
      lastScore: number | null; createdAt: string;
    }>>(`/sites/${siteId}/audit/prompts${includeInactive ? '?includeInactive=1' : ''}`),

  createPrompt: (siteId: string, body: { text: string; intent?: string; locale?: string; tags?: string[] }) =>
    request<any>(`/sites/${siteId}/audit/prompts`, { method: 'POST', body: JSON.stringify(body) }),

  updatePrompt: (siteId: string, promptId: string, body: { text?: string; intent?: string; isActive?: boolean }) =>
    request<any>(`/sites/${siteId}/audit/prompts/${promptId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deletePrompt: (siteId: string, promptId: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/audit/prompts/${promptId}`, { method: 'DELETE' }),

  importPromptsFromBrain: (siteId: string) =>
    request<{ imported: number; skipped: number }>(`/sites/${siteId}/audit/prompts/import-brain`, { method: 'POST' }),

  runPrompt: (siteId: string, promptId: string, body: { withFanout?: boolean } = {}) =>
    request<{
      promptId: string; text: string;
      main: { cited: number; mentioned: number; total: number; score: number };
      fanout: { cited: number; mentioned: number; total: number; score: number } | null;
      providers: Array<{ provider: string; label: string; available: boolean; reason?: string; probes: any[] }>;
      weakestBranches: Array<{ id: string; text: string; kind: string; citedCount: number; total: number }>;
      runAt: string;
    }>(`/sites/${siteId}/audit/prompts/${promptId}/run`, { method: 'POST', body: JSON.stringify(body) }),

  runAllPrompts: (siteId: string, body: { withFanout?: boolean; limit?: number } = {}) =>
    request<any>(`/sites/${siteId}/audit/prompts/run-all`, { method: 'POST', body: JSON.stringify(body) }),

  promptCoverage: (siteId: string, days = 30) =>
    request<{
      siteId: string; days: number;
      main: { cited: number; mentioned: number; total: number; score: number };
      fanout: { cited: number; mentioned: number; total: number; score: number };
      byKind: Array<{ kind: string; cited: number; mentioned: number; total: number; score: number }>;
      gap: number;
    }>(`/sites/${siteId}/audit/prompts/coverage?days=${days}`),

  promptHistory: (siteId: string, promptId: string, days = 30) =>
    request<Array<{ date: string; cited: number; mentioned: number; total: number; score: number }>>(
      `/sites/${siteId}/audit/prompts/${promptId}/history?days=${days}`,
    ),

  // ── Fan-out — modelin arka planda açtığı alt sorgu dalları ────
  listFanout: (siteId: string, promptId: string) =>
    request<Array<{
      id: string; text: string; kind: string; likelihood: number;
      rank: number; isActive: boolean; generatedBy: string;
    }>>(`/sites/${siteId}/audit/prompts/${promptId}/fanout`),

  generateFanout: (siteId: string, promptId: string, max = 8) =>
    request<{
      promptId: string;
      generated: number;
      /** Ayni metinle daha once uretilmis, gecmisi korunarak yeniden aktive edilen dal sayisi */
      reactivated: number;
      branches: Array<{ text: string; kind: string; likelihood: number }>;
    }>(
      `/sites/${siteId}/audit/prompts/${promptId}/fanout/generate`,
      { method: 'POST', body: JSON.stringify({ max }) },
    ),

  addFanout: (siteId: string, promptId: string, text: string, kind?: string) =>
    request<any>(`/sites/${siteId}/audit/prompts/${promptId}/fanout`, {
      method: 'POST', body: JSON.stringify({ text, kind }),
    }),

  toggleFanout: (siteId: string, fanoutId: string, isActive: boolean) =>
    request<any>(`/sites/${siteId}/audit/fanout/${fanoutId}`, {
      method: 'PATCH', body: JSON.stringify({ isActive }),
    }),

  deleteFanout: (siteId: string, fanoutId: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/audit/fanout/${fanoutId}`, { method: 'DELETE' }),

  /** App Store Connect (ASO Faz 2) */
  connectAsc: (siteId: string, body: { issuerId: string; keyId: string; privateKeyPem: string }) =>
    request<any>(`/sites/${siteId}/aso/asc/connect`, { method: 'POST', body: JSON.stringify(body) }),

  listAscAccounts: (siteId: string) =>
    request<Array<{
      id: string; issuerId: string; keyId: string;
      isActive: boolean; lastSyncAt: string | null; lastError: string | null; createdAt: string;
      apps: Array<{ id: string; appleAppId: string; bundleId: string; name: string; latestVersion: string | null; latestReleaseAt: string | null }>;
    }>>(`/sites/${siteId}/aso/asc/accounts`),

  disconnectAsc: (accountId: string) =>
    request<{ ok: boolean }>(`/aso/asc/accounts/${accountId}`, { method: 'DELETE' }),

  syncAscApps: (accountId: string) =>
    request<{ synced: number }>(`/aso/asc/accounts/${accountId}/sync`, { method: 'POST' }),

  syncAscReleases: (appId: string) =>
    request<{ synced: number }>(`/aso/asc/apps/${appId}/sync-releases`, { method: 'POST' }),

  fetchAscReviews: (appId: string) =>
    request<{
      appId: string;
      appName: string;
      avgRating: string | null;
      reviews: Array<{
        id: string; rating: number; title: string; body: string;
        reviewerNickname: string; territory: string; createdDate: string | null;
      }>;
    }>(`/aso/asc/apps/${appId}/reviews`),

  replyAscReview: (appId: string, reviewId: string, body: string) =>
    request<any>(`/aso/asc/apps/${appId}/reviews/${reviewId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  listAscAlerts: (siteId: string) =>
    request<Array<{
      id: string; severity: string; message: string; daysSinceUpdate: number;
      acknowledgedAt: string | null; createdAt: string;
      app: { name: string; appleAppId: string };
    }>>(`/sites/${siteId}/aso/asc/alerts`),

  acknowledgeAscAlert: (alertId: string) =>
    request<any>(`/aso/asc/alerts/${alertId}/acknowledge`, { method: 'POST' }),

  /** Testimonials */
  submitTestimonial: (body: { siteId?: string; rating: number; body: string; role?: string; company?: string; metric?: string }) =>
    request<{ id: string }>(`/testimonials`, { method: 'POST', body: JSON.stringify(body) }),

  listPublicTestimonials: (limit = 6) =>
    request<Array<{
      id: string; rating: number; body: string; role: string | null; company: string | null;
      metric: string | null; displayName: string; initials: string; createdAt: string;
    }>>(`/testimonials/public?limit=${limit}`),

  listAdminTestimonials: (filter: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') =>
    request<Array<any>>(`/testimonials/admin?filter=${filter}`),

  moderateTestimonial: (id: string, action: 'approve' | 'reject' | 'feature' | 'unfeature') =>
    request<any>(`/testimonials/${id}/moderate`, { method: 'POST', body: JSON.stringify({ action }) }),

  deleteTestimonial: (id: string) =>
    request<{ ok: boolean }>(`/testimonials/${id}`, { method: 'DELETE' }),

  /** Landing analytics admin summary */
  getLandingAnalytics: (days = 7) =>
    request<{
      window: { daysBack: number; since: string };
      totals: { sessions: number; events: number; pageviews: number; ctaClicks: number; signups: number };
      funnel: { sessionToCtaPct: number; sessionToSignupPct: number };
      byType: Record<string, number>;
      topCtas: Array<{ id: string; count: number }>;
      topSections: Array<{ id: string; count: number }>;
      timeline: Array<{ date: string; pageviews: number; signups: number }>;
    }>(`/analytics/landing/summary?days=${days}`),

  /** AI Citation + GEO Roadmap (Maya tarzı öneri) */
  runCitationRoadmap: (siteId: string) =>
    request<{
      results: any[];
      roadmap: {
        summary: string;
        actions: Array<{ title: string; why: string; effort: 'low' | 'medium' | 'high' }>;
      } | null;
      runAt: string;
    }>(`/sites/${siteId}/audit/citation-roadmap`, { method: 'POST' }),

  /** Per-page citations + grounding queries (Microsoft Clarity tarzı) */
  runCitationPerPage: (siteId: string) =>
    request<{
      breakdown: {
        pages: Array<{ url: string; cites: number; queries: Array<{ query: string; provider: string; cites: number }> }>;
        topPages: Array<{ url: string; cites: number }>;
        groundingQueries: Array<{ query: string; cites: number; pages: string[] }>;
        totalCites: number;
      };
      runAt: string;
    }>(`/sites/${siteId}/audit/citation-per-page`, { method: 'POST' }),

  // ── Stuck Pages (On-page.ai Recipe 1) ──
  listStuckPages: (siteId: string, status?: string) =>
    request<Array<{
      id: string;
      siteId: string;
      articleId: string | null;
      url: string;
      title: string | null;
      impressions: number;
      clicks: number;
      ctr: number;
      position: number;
      stuckScore: number;
      status: string;
      topQueries: string[] | null;
      detectedAt: string;
      recoveries: Array<{
        id: string;
        appliedAt: string;
        entitiesAdded: string[];
        edits: any[];
        revertedAt: string | null;
      }>;
    }>>(
      `/sites/${siteId}/audit/stuck-pages${status ? `?status=${status}` : ''}`,
    ),

  detectStuckPages: (siteId: string) =>
    request<{ found: number; created: number; updated: number; skipped: number }>(
      `/sites/${siteId}/audit/stuck-pages/detect`,
      { method: 'POST' },
    ),

  getStuckPage: (siteId: string, id: string) =>
    request<any>(`/sites/${siteId}/audit/stuck-pages/${id}`),

  recoverStuckPage: (siteId: string, id: string) =>
    request<{
      success: boolean;
      recoveryId?: string;
      editsCount?: number;
      reason?: string;
    }>(`/sites/${siteId}/audit/stuck-pages/${id}/recover`, {
      method: 'POST',
      body: JSON.stringify({ triggeredBy: 'manual' }),
    }),

  recoverStuckPagesBatch: (siteId: string, stuckPageIds: string[]) =>
    request<{ siteId: string; results: Array<{ id: string; ok: boolean; recoveryId?: string; error?: string }> }>(
      `/sites/${siteId}/audit/stuck-pages/recover-batch`,
      { method: 'POST', body: JSON.stringify({ stuckPageIds, triggeredBy: 'manual' }) },
    ),

  revertStuckPageRecovery: (siteId: string, recoveryId: string) =>
    request<{ ok: boolean }>(
      `/sites/${siteId}/audit/stuck-pages/recovery/${recoveryId}/revert`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  ignoreStuckPage: (siteId: string, id: string) =>
    request<{ ok: boolean }>(
      `/sites/${siteId}/audit/stuck-pages/${id}/ignore`,
      { method: 'POST' },
    ),

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

  publishArticle: (siteId: string, articleId: string, targetIds: string[], overrideQa?: boolean) =>
    request<any>(`/sites/${siteId}/articles/${articleId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ targetIds, overrideQa }),
    }),

  runArticleQaCheck: (siteId: string, articleId: string) =>
    request<{
      status: 'PASS' | 'WARN' | 'BLOCKED';
      blockers: Array<{ type: string; detail: string; excerpt?: string }>;
      warnings: Array<{ type: string; detail: string; excerpt?: string }>;
      stats: { wordCount: number; llmUsed: boolean };
      checkedAt: string;
    }>(`/sites/${siteId}/articles/${articleId}/qa-check`, { method: 'POST' }),

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
  getAdminCitationLeads: (params: { limit?: number; offset?: number; search?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.search) qs.set('search', params.search);
    const q = qs.toString();
    return request<{
      items: Array<{
        id: string; domain: string; brand: string; niche: string | null;
        source: string; ip: string | null; totalCalls: number; costUsd: number;
        createdAt: string; citedScore: number; maxScore: number; queriesCount: number; totalProviders: number;
      }>;
      total: number; today: number; uniqueDomains: number;
    }>(`/admin/citation-leads${q ? `?${q}` : ''}`);
  },

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
  /**
   * Plan listesi + o an kullanilan kur.
   * Fiyat USD kanonik (`monthly`/`annual`); TL karsiligi gunun TCMB kuruyla
   * hesaplanip `monthlyTry`/`annualTry` alanlarinda gelir.
   */
  getPlans: (locale?: string) =>
    request<{
      plans: Array<{
        id: string; name: string;
        monthly: number; annual: number; currency: 'USD';
        monthlyTry: number; annualTry: number;
        articlesPerMonth: number;
        sites: number; aiRunsPerMonth: number; aiProviders: number;
        publishTargets: string; support: string;
        /** Kart maddeleri — tek kaynak apps/api/src/billing/plans.ts */
        features: string[];
        /** "Buyume'deki her sey, arti:" — kok planda undefined */
        inheritsLabel?: string;
        popular?: boolean; contactSales?: boolean;
      }>;
      fx: { rate: number; fetchedAt: string; source: 'TCMB' | 'fallback'; stale: boolean };
    }>(`/billing/plans${locale ? '?locale=' + locale : ''}`),
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






  listLinkedInPages: (channelId: string) =>
    request<Array<{ organizationUrn: string; organizationId: string; name: string; vanityName?: string; logoUrl?: string }>>(
      `/social/channels/${channelId}/linkedin/pages`,
    ),

  setLinkedInPage: (channelId: string, body: { organizationUrn: string; organizationName: string }) =>
    request<any>(`/social/channels/${channelId}/linkedin/page`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),








  // Social — media generation + approval
  socialMediaPolicy: () =>
    request<Record<string, { default: 'text' | 'image' | 'video'; options: Array<'text' | 'image' | 'video'>; editable: boolean }>>(`/social/media-policy`),











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

  // ──────────────────────────────────────────────────────────────────
  // Studio — multi-modal AI content (image / video / text) — DB-backed
  // ──────────────────────────────────────────────────────────────────







  // ─── ASO Faz 1 — Apple Search Ads ──────────────────────

  connectAsa: (siteId: string, body: { orgId: string; keyId: string; privateKeyPem: string; teamId?: string }) =>
    request<{ id: string; orgId: string; status: 'created' | 'updated' }>(
      `/sites/${siteId}/aso/asa/connect`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listAsaAccounts: (siteId: string) =>
    request<Array<{
      id: string; orgId: string; keyId: string; teamId: string | null;
      isActive: boolean; lastSyncAt: string | null; lastError: string | null; createdAt: string;
      _count: { campaigns: number };
    }>>(`/sites/${siteId}/aso/asa/accounts`),

  disconnectAsa: (accountId: string) =>
    request<{ ok: boolean }>(`/aso/asa/accounts/${accountId}`, { method: 'DELETE' }),

  syncAsaCampaigns: (accountId: string) =>
    request<{ synced: number; removed?: number }>(`/aso/asa/accounts/${accountId}/sync`, { method: 'POST' }),

  listAsaCampaigns: (siteId: string) =>
    request<Array<{
      id: string; asaCampaignId: string; name: string; budget: number; status: string;
      countriesOrRegions: string[]; supplySources: string[]; appAdamId: string | null;
      createdAt: string;
      account: { id: string; orgId: string };
      _count: { adGroups: number };
    }>>(`/sites/${siteId}/aso/asa/campaigns`),

  /** AI ile yeni kampanya önerisi (form pre-fill için) */
  suggestAsaCampaign: (siteId: string) =>
    request<{
      name: string;
      dailyBudgetUsd: number;
      countries: string[];
      appleAppId: number;
      bidUsd: number;
      keywords: string[];
      meta: { keywordCount: number; country: string; appName: string };
    }>(`/sites/${siteId}/aso/asa/suggest`),

  /** Auto-Pilot toggle + budget cap */
  setAsaAutoPilot: (accountId: string, body: { enabled: boolean; budgetCapUsd?: number | null }) =>
    request<{ id: string; autoPilotEnabled: boolean; autoPilotBudgetCap: number | null }>(
      `/aso/asa/accounts/${accountId}/autopilot`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  /** Auto-Pilot manual run */
  runAsaAutoPilot: (accountId: string) =>
    request<{ added: string[]; paused: string[]; skipped: string[]; reason?: string }>(
      `/aso/asa/accounts/${accountId}/autopilot/run`,
      { method: 'POST' },
    ),

  createAsaCampaign: (body: {
    accountId: string;
    name: string;
    dailyBudgetUsd: number;
    countries: string[];
    appleAppId: number;
    keywords?: Array<{ text: string; bidUsd: number; matchType?: 'EXACT' | 'BROAD' }>;
  }) =>
    request<{ campaignId: string; asaCampaignId: string }>(`/aso/asa/campaigns`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAsaKeywordBid: (keywordBidId: string, bidUsd: number) =>
    request<any>(`/aso/asa/keyword-bids/${keywordBidId}`, {
      method: 'PUT',
      body: JSON.stringify({ bidUsd }),
    }),

  getAsaPerformance: (siteId: string, daysBack = 30) =>
    request<{
      daysBack: number;
      totals: {
        impressions: number; taps: number; installs: number; spendUsd: number;
        avgCpt: number; avgCpa: number; ttr: number; conversionRate: number;
      };
      dailyRows: Array<{
        id: string; date: string; impressions: number; taps: number; installs: number;
        spendUsd: number; avgCpt: number | null; avgCpa: number | null;
        campaign: { name: string; asaCampaignId: string };
      }>;
    }>(`/sites/${siteId}/aso/asa/performance?daysBack=${daysBack}`),

  // ──────────────────────────────────────────────────────────
  //  AGENT READINESS (AXO)
  // ──────────────────────────────────────────────────────────
  getAgentReadiness: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/agent-readiness/latest`),

  runAgentReadiness: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/agent-readiness/run`, { method: 'POST' }),

  getAgentReadinessHistory: (siteId: string, days = 90) =>
    request<Array<{ date: string; score: number; agentsAllowed: number | null; agentsTotal: number | null }>>(
      `/sites/${siteId}/audit/agent-readiness/history?days=${days}`,
    ),

  // ──────────────────────────────────────────────────────────
  //  CONTENT OPPORTUNITIES (kapalı döngü)
  // ──────────────────────────────────────────────────────────
  listOpportunities: (siteId: string, opts: { status?: string; coverage?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.coverage) qs.set('coverage', opts.coverage);
    return request<any[]>(`/sites/${siteId}/audit/opportunities${qs.size ? `?${qs}` : ''}`);
  },

  deriveOpportunities: (siteId: string) =>
    request<{ created: number; updated: number; scanned: number }>(
      `/sites/${siteId}/audit/opportunities/derive`, { method: 'POST' },
    ),

  updateOpportunity: (siteId: string, id: string, status: string) =>
    request<any>(`/sites/${siteId}/audit/opportunities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  generateFromOpportunity: (siteId: string, id: string) =>
    request<{ opportunityId: string; articleId: string; jobId: string }>(
      `/sites/${siteId}/audit/opportunities/${id}/generate`, { method: 'POST' },
    ),

  remeasureOpportunity: (siteId: string, id: string) =>
    request<any>(`/sites/${siteId}/audit/opportunities/${id}/remeasure`, { method: 'POST' }),

  // ──────────────────────────────────────────────────────────
  //  AI KPI ŞERİDİ + PRODUCT RADAR + COMMUNITY
  // ──────────────────────────────────────────────────────────
  getAiKpis: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/ai-kpis`),

  getProductRadar: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/product-radar`),

  runProductRadar: (siteId: string) =>
    request<{ snapshots: number; queries: string[] }>(
      `/sites/${siteId}/audit/product-radar/run`, { method: 'POST' },
    ),

  listCommunityOpportunities: (siteId: string, status?: string) =>
    request<any[]>(`/sites/${siteId}/audit/community${status ? `?status=${status}` : ''}`),

  scanCommunity: (siteId: string, limit?: number) =>
    request<{ found: number; created: number }>(`/sites/${siteId}/audit/community/scan`, {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),

  updateCommunityOpportunity: (siteId: string, id: string, body: { status?: string; draftReply?: string }) =>
    request<any>(`/sites/${siteId}/audit/community/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteCommunityOpportunity: (siteId: string, id: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/audit/community/${id}`, { method: 'DELETE' }),

  // ──────────────────────────────────────────────────────────
  //  LIVE CRAWLER
  // ──────────────────────────────────────────────────────────
  getLiveCrawler: (siteId: string, minutes = 10, limit = 50) =>
    request<{
      windowMinutes: number;
      workerConnected: boolean;
      lastEventAt: string | null;
      lastEventSource: string | null;
      total: number;
      byBot: Array<{ bot: string; hits: number }>;
      events: Array<{ id: string; ts: string; bot: string; path: string; status: number; isCiteFetch: boolean; source: string }>;
      citeFetches24h: Array<{ ts: string; bot: string; path: string }>;
    }>(`/sites/${siteId}/audit/live-crawler?minutes=${minutes}&limit=${limit}`),

  // ingestSecret snippet'lerin icine gomulu gelir; ekranda "bu kod gizli" uyarisi
  // gosterebilmek icin tipte de acikca duruyor.
  getLiveCrawlerSnippets: (siteId: string) =>
    request<{ ingestUrl: string; ingestSecret: string; cloudflareWorker: string; wordpress: string; nginx: string }>(
      `/sites/${siteId}/audit/live-crawler/snippets`,
    ),

  // Sir yenilenince eski snippet'lerin imzasi aninda gecersiz olur; cagiran
  // taraf snippet'leri yeniden cekip kullaniciya kurulum uyarisini gostermeli.
  rotateIngestSecret: (siteId: string) =>
    request<{ secret: string; warning: string }>(
      `/sites/${siteId}/audit/live-crawler/rotate-secret`, { method: 'POST' },
    ),

  // ──────────────────────────────────────────────────────────
  //  ACTION PLAN
  // ──────────────────────────────────────────────────────────
  listActionPlan: (siteId: string, opts: { status?: string; source?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.source) qs.set('source', opts.source);
    return request<any[]>(`/sites/${siteId}/action-plan${qs.size ? `?${qs}` : ''}`);
  },

  getActionPlanCounts: (siteId: string) =>
    request<{ todo: number; inProgress: number; done: number }>(`/sites/${siteId}/action-plan/counts`),

  addActionPlanItem: (siteId: string, body: {
    title: string; description?: string; source?: string; sourceRef?: string;
    impact?: string; effort?: string; dueAt?: string;
  }) =>
    request<any>(`/sites/${siteId}/action-plan`, { method: 'POST', body: JSON.stringify(body) }),

  updateActionPlanItem: (siteId: string, id: string, body: any) =>
    request<any>(`/sites/${siteId}/action-plan/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteActionPlanItem: (siteId: string, id: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/action-plan/${id}`, { method: 'DELETE' }),

  // ──────────────────────────────────────────────────────────
  //  CHAT + SKILLS
  // ──────────────────────────────────────────────────────────
  listChatSkills: (siteId: string) =>
    request<Array<{
      key: string; name: string; tag: string; description: string;
      accesses: string[]; needsInput?: boolean; inputPlaceholder?: string;
    }>>(`/sites/${siteId}/chat/skills`),

  listChatConversations: (siteId: string) =>
    request<any[]>(`/sites/${siteId}/chat/conversations`),

  getChatConversation: (siteId: string, conversationId: string) =>
    request<any>(`/sites/${siteId}/chat/conversations/${conversationId}`),

  deleteChatConversation: (siteId: string, conversationId: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/chat/conversations/${conversationId}`, { method: 'DELETE' }),

  sendChatMessage: (siteId: string, body: { conversationId?: string; message?: string; skill?: string }) =>
    request<{
      conversationId: string;
      message: { id: string; role: string; content: string; toolCalls: any[]; createdAt: string };
      costUsd: number;
    }>(`/sites/${siteId}/chat/messages`, { method: 'POST', body: JSON.stringify(body) }),

  // ──────────────────────────────────────────────────────────
  //  APP PROMPT LAB (ASO ⨉ GEO)
  // ──────────────────────────────────────────────────────────
  listAppPrompts: (siteId: string, appId: string) =>
    request<any[]>(`/sites/${siteId}/aso/apps/${appId}/prompts`),

  addAppPrompt: (siteId: string, appId: string, text: string) =>
    request<any>(`/sites/${siteId}/aso/apps/${appId}/prompts`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  suggestAppPrompts: (siteId: string, appId: string) =>
    request<{ suggested: string[]; created: number }>(
      `/sites/${siteId}/aso/apps/${appId}/prompts/suggest`, { method: 'POST' },
    ),

  runAppPrompt: (siteId: string, appId: string, promptId: string) =>
    request<any>(`/sites/${siteId}/aso/apps/${appId}/prompts/${promptId}/run`, { method: 'POST' }),

  deleteAppPrompt: (siteId: string, appId: string, promptId: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/aso/apps/${appId}/prompts/${promptId}`, { method: 'DELETE' }),

  getAppPromptHistory: (siteId: string, appId: string, promptId: string, days = 30) =>
    request<any[]>(`/sites/${siteId}/aso/apps/${appId}/prompts/${promptId}/history?days=${days}`),

  buildReviewContentPack: (siteId: string, appId: string) =>
    request<{
      appId: string; appName: string;
      basedOn: { negativeCount: number; themes: Array<{ theme: string; count: number }> };
      whatsNew: string;
      faqs: Array<{ q: string; a: string }>;
      blogTopics: Array<{ title: string; opportunityId: string | null }>;
    }>(`/sites/${siteId}/aso/apps/${appId}/review-content-pack`, { method: 'POST' }),

  // ──────────────────────────────────────────────────────────
  //  PUBLIC — anonim landing checker (auth yok)
  // ──────────────────────────────────────────────────────────
  publicCitationCheck: (domain: string, turnstileToken?: string) =>
    request<{
      domain: string;
      brand: string;
      niche: string;
      customNiche?: string;
      queries: Array<{
        query: string;
        category?: string;
        /** true = soru listelendi ama olculmedi; providers BOS gelir. */
        locked?: boolean;
        providers: Array<{
          provider: string;
          label: string;
          cited: boolean;
          brandMentioned: boolean;
          excerpt?: string;
        }>;
        citedCount: number;
        totalProviders: number;
      }>;
      competitorRanking: Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }>;
      totalLlmCalls: number;
      fromCache: boolean;
      cachedAt?: string;
      access?: {
        tier: 'anon' | 'member';
        unlockedQueries: number;
        totalQueries: number;
        lockedQueries: number;
      };
    }>('/public/citation-check', {
      method: 'POST',
      body: JSON.stringify({ domain, turnstileToken }),
    }),

  /**
   * Teaser kilidini acar — GIRIS + ODENMIS PLAN gerekir. Odememis kullaniciya
   * 402 doner; cagiran taraf bunu satis ekranina cevirir.
   */
  publicCitationUnlock: (domain: string) =>
    request<Awaited<ReturnType<typeof api.publicCitationCheck>>>('/public/citation-check/unlock', {
      method: 'POST',
      body: JSON.stringify({ domain }),
    }),

  publicCitationRateLimit: () =>
    request<{ ok: boolean; remaining: number; resetIn?: string }>('/public/citation-check/rate-limit', {
      method: 'POST',
    }),
};
