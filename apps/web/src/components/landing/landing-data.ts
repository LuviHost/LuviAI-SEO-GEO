import { requireForCache } from '@/lib/isr-guard';

/**
 * Landing verisi — SUNUCUDA, ISR ile cekilir (page.tsx; /pricing ve /compare de ayni
 * yolu kullanir). Eskiden plan ve yorumlar istemcide cekiliyordu; ilk boyamada fiyat
 * bolumu bos geliyordu.
 *
 * Basarisizlikta (API kapali, `next build` aninda API yok): build ve gelistirmede plan
 * listesi bos doner, fiyat bolumu istemcide yeniden dener. Uretim sunucusunda plan istegi
 * FIRLATIR — ISR son basarili (fiyatli) sayfayi sunmaya devam eder (lib/isr-guard.ts).
 * Yorumlar her durumda bos dizi (bolum gizli kalir).
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

export function apiBase() {
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

/**
 * Plan listesi. Uretimde (build disinda) bos gelirse FIRLATIR: ISR son basarili sayfayi
 * korur, fiyatsiz sayfa onbellege girmez (lib/isr-guard.ts). Build ve gelistirmede bos dizi.
 */
export async function fetchPlans(locale: 'tr' | 'en'): Promise<LandingPlan[]> {
  const data = await getJson<{ plans?: LandingPlan[] }>(`/billing/plans?locale=${locale}`);
  return requireForCache(Array.isArray(data?.plans) ? data.plans : [], `/billing/plans?locale=${locale}`);
}

/**
 * /billing/plans TAM yaniti (plan + gunun kuru + satin alma durumu) — /pricing sunucuda
 * ceker. Plan listesi bos ya da istek basarisizsa: uretimde FIRLATIR (ISR son basarili
 * sayfayi korur); build ve gelistirmede null, sayfa istemcide yeniden dener.
 */
export async function fetchPlansResponse<T extends { plans: unknown[] }>(locale: 'tr' | 'en'): Promise<T | null> {
  const data = await getJson<T>(`/billing/plans?locale=${locale}`);
  return requireForCache(Array.isArray(data?.plans) && data.plans.length > 0 ? data : null, `/billing/plans?locale=${locale}`);
}

export async function fetchTestimonials(limit = 6): Promise<PublicTestimonial[]> {
  const data = await getJson<PublicTestimonial[]>(`/testimonials/public?limit=${limit}`);
  return Array.isArray(data) ? data : [];
}
