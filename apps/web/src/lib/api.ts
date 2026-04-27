/**
 * LuviAI API client.
 * Faz 1: basit fetch wrapper. Faz 2'de NextAuth session cookie auto-include.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API ${res.status}: ${error}`);
  }
  return res.json();
}

export const api = {
  // Sites
  createSite: (body: { userId: string; url: string; name: string; niche?: string; language?: string }) =>
    request<any>('/sites', { method: 'POST', body: JSON.stringify(body) }),

  listSites: () => request<any[]>('/sites'),

  getSite: (id: string) => request<any>(`/sites/${id}`),

  // Audit
  getLatestAudit: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/latest`),

  runAuditNow: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/run-now`, { method: 'POST' }),

  applyAutoFix: (siteId: string, fixes: string[]) =>
    request<any>(`/sites/${siteId}/audit/auto-fix-now`, {
      method: 'POST',
      body: JSON.stringify({ fixes }),
    }),

  // Topics
  getTopicQueue: (siteId: string) =>
    request<any>(`/sites/${siteId}/topics/queue`),

  runTopicEngineNow: (siteId: string) =>
    request<any>(`/sites/${siteId}/topics/run-now`, { method: 'POST' }),

  // Articles
  listArticles: (siteId: string, status?: string) =>
    request<any[]>(`/sites/${siteId}/articles${status ? `?status=${status}` : ''}`),

  generateArticle: (siteId: string, topic: string) =>
    request<any>(`/sites/${siteId}/articles/run-now`, {
      method: 'POST',
      body: JSON.stringify({ topic, skipImages: true }),
    }),

  // Admin
  getAdminOverview: () => request<any>('/admin/overview'),

  // Billing
  getPlans: () => request<any[]>('/billing/plans'),
};
