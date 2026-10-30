import { FEATURE_MIN_PLAN, PLAN_RANK, planHasFeature, type PlanFeature, type PlanId } from './plans.js';

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

/**
 * siteWhereForFeature + ADMIN sahipli siteler.
 *
 * NEDEN AYRI: ASA/ASC gibi musterinin KENDI hesabina dokunan cron'lar plan
 * dusunce durmali; ama platformun kendi uygulamasi yonetici hesabinda durur ve
 * yonetici rotalarda da kapidan muaftir (PlanFeatureGuard). Yalniz plana
 * bakan suzgec yoneticinin planina gore kendi uygulamasinin gunluk senkronunu
 * keserdi.
 */
export function siteWhereForFeatureOrAdmin(feature: PlanFeature) {
  return { OR: [siteWhereForFeature(feature), { user: { role: 'ADMIN' as const } }] };
}

/**
 * Sahibin (site sahibi / anahtar sahibi) planinda ozellik var mi — saf.
 *
 * NEDEN: kapilarin bir kismi rota disinda (cron, public ingest, olcum
 * motorunun anahtar secimi, API anahtari dogrulamasi) calisir; orada
 * PlanFeatureGuard yok. Kural rota kapisiyla AYNI olmali: ADMIN muaf,
 * bilinmeyen plan ozelliksiz sayilir (kapi kapali kalir, acik unutulmaz).
 */
export function ownerHasPlanFeature(
  owner: { plan?: string | null; role?: string | null } | null | undefined,
  feature: PlanFeature,
): boolean {
  if (!owner) return false;
  if (owner.role === 'ADMIN') return true;
  const planId = String(owner.plan ?? '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(PLAN_RANK, planId)) return false;
  return planHasFeature(planId as PlanId, feature);
}
