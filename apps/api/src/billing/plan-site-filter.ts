import { FEATURE_MIN_PLAN, PLAN_RANK, type PlanFeature, type PlanId } from './plans.js';

/**
 * Bir plan ozelligini otomatik uretim (cron) tarafinda dayatmak icin
 * Prisma `where` parcasi uretir.
 *
 * NEDEN GEREKLI: controller'a @RequiresPlan koymak ozelligi KISITLAMIYORDU,
 * cunku bu ozelliklerin verisini kullanici degil PLATFORMUN CRON'U uretiyor.
 * Product Radar, Agent Readiness ve icerik firsatlari cron'lari plan ayrimi
 * yapmadan tum aktif siteleri tariyordu; sonucta Buyume musterisi POST ucuna
 * hic dokunmadan, panelde ust plana ait veriyi hazir buluyordu. Yani fiyat
 * kartindaki "Ajans'a dahil" ifadesi fiilen dogru degildi.
 *
 * Ayrica bu bir MALIYET kalemi: her tarama LLM cagrisi demek.
 */
export function siteWhereForFeature(feature: PlanFeature) {
  const gerekenSira = PLAN_RANK[FEATURE_MIN_PLAN[feature]];
  const yeterliPlanlar = (Object.keys(PLAN_RANK) as PlanId[])
    .filter((p) => PLAN_RANK[p] >= gerekenSira)
    .map((p) => p.toUpperCase());
  return { user: { plan: { in: yeterliPlanlar as any } } };
}
