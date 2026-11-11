/**
 * /compare ozet kartindaki RanksUp fiyati. Ayri dosya cunku hem sunucu (page.tsx) hem istemci
 * (compare-view.tsx yedek yolu) cagirir; 'use client' modulundeki bir fonksiyon sunucuda
 * cagrilamaz.
 *
 * HANGI PLAN (11.11.2026 paket yapisi, api billing/plans.ts): fiyat, kartin saydigi dort alanin
 * ("SEO içerik üretimi ve yayın", "AI görünürlük ölçümü (6 asistan)", reklam otopilotu, Agent
 * Readiness) HEPSINI iceren en dusuk planin fiyati olmali — Profesyonel. Eskiden Buyume ($149) ve
 * Profesyonel birlikte yaziliyordu; yeni giris plani Baslangic ($99) makale uretmez, 4 asistan
 * olcer ve Agent Readiness icermez: o fiyati bu listenin yanina yazmak, listeyi $99'a satmak
 * olurdu. public-docs.spec.ts kurali kodla denetler.
 */
export type ComparePlanPrice = { id: string; name: string; monthly: number };

export const COMPARE_PRICE_PLAN_IDS: readonly string[] = ['pro'];

export function pickComparePrices(plans: ReadonlyArray<{ id: string; name: string; monthly: number }>): ComparePlanPrice[] {
  return plans
    .filter((p) => COMPARE_PRICE_PLAN_IDS.includes(p.id))
    .map(({ id, name, monthly }) => ({ id, name, monthly }));
}
