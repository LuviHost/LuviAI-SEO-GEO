/**
 * Landing verisi — SUNUCUDA, ISR ile cekilir (page.tsx). Eskiden plan ve yorumlar
 * istemcide cekiliyordu; ilk boyamada fiyat bolumu bos geliyordu.
 *
 * Basarisizlikta (API kapali, `next build` aninda API yok) bos dizi doner; fiyat
 * bolumu o durumda istemcide yeniden dener, yorum bolumu gizli kalir.
 */

export type LandingPlan = {
  id: string;
  name: string;
  /** Kanonik fiyat — USD */
  monthly: number;
  annual: number;
  currency: string;
  articlesPerMonth: number;
  sites: number | string;
  aiRunsPerMonth: number;
  aiProviders: number;
  publishTargets: string;
  support: string;
  /** Kart maddeleri — tek kaynak apps/api/src/billing/plans.ts */
  features: string[];
  /** "Buyume'deki her sey, arti:" — kok planda undefined */
  inheritsLabel?: string;
  popular?: boolean;
  contactSales?: boolean;
};

export type PublicTestimonial = {
  id: string;
  rating: number;
  body: string;
  role: string | null;
  company: string | null;
  metric: string | null;
  displayName: string;
  initials: string;
};

/** Fiyat/yorumlar 10 dakikada bir tazelenir */
export const LANDING_REVALIDATE = 600;

function apiBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase()}/api${path}`, {
      next: { revalidate: LANDING_REVALIDATE },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchPlans(locale: 'tr' | 'en'): Promise<LandingPlan[]> {
  const data = await getJson<{ plans?: LandingPlan[] }>(`/billing/plans?locale=${locale}`);
  return Array.isArray(data?.plans) ? data.plans : [];
}

export async function fetchTestimonials(limit = 6): Promise<PublicTestimonial[]> {
  const data = await getJson<PublicTestimonial[]>(`/testimonials/public?limit=${limit}`);
  return Array.isArray(data) ? data : [];
}
