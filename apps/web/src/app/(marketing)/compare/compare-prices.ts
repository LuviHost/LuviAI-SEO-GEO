/**
 * /compare ozet kartindaki RanksUp fiyatlari (Buyume ve Profesyonel). Ayri dosya cunku hem
 * sunucu (page.tsx) hem istemci (compare-view.tsx yedek yolu) cagirir; 'use client'
 * modulundeki bir fonksiyon sunucuda cagrilamaz.
 */
export type ComparePlanPrice = { id: string; name: string; monthly: number };

export const COMPARE_PRICE_PLAN_IDS: readonly string[] = ['starter', 'pro'];

export function pickComparePrices(plans: ReadonlyArray<{ id: string; name: string; monthly: number }>): ComparePlanPrice[] {
  return plans
    .filter((p) => COMPARE_PRICE_PLAN_IDS.includes(p.id))
    .map(({ id, name, monthly }) => ({ id, name, monthly }));
}
