import {
  FEATURE_MIN_PLAN, PLAN_FEATURE_LABELS, planHasFeature, findPlan,
  type PlanFeature, type PlanId,
} from './plans.js';

export interface Entitlements {
  plan: PlanId;
  /** Ozellik -> bu planda acik mi */
  features: Record<PlanFeature, boolean>;
  /** Kapali ozellik icin kullaniciya ne soylenecegi — hepsi plans.ts'ten turer */
  required: Record<PlanFeature, { plan: PlanId; planName: string; label: string }>;
}

/**
 * Kullanicinin ozellik haklari — WEB ICIN TEK KAYNAK.
 *
 * NEDEN BOYLE: web'de hicbir plan kapisi yoktu; sol menu Product Radar /
 * Agent Readiness / Icerik Firsatlari'ni herkese gosteriyordu. En kolay cozum
 * FEATURE_MIN_PLAN tablosunu web'e kopyalamakti — ama bu oturumda tekrar
 * tekrar duzelttigimiz hata sinifi tam olarak bu: iki tablo bagimsiz kayiyor.
 * (Fiyat kartlari, SEO metadata'si, /compare, /terms, quota.service — hepsi
 * ayni sekilde kaymisti.) Bu yuzden haklar SUNUCUDA hesaplanip hazir
 * gonderiliyor; web yalnizca okuyor, kural bilmiyor.
 *
 * `required` alani da bilerek burada uretiliyor: "Ajans planina dahildir"
 * cumlesindeki plan adi da plans.ts'ten gelsin ki plan yeniden adlandirilinca
 * (Baslangic -> Buyume ornegindeki gibi) arayuz kendiliginde duzelsin.
 */
export function entitlementsFor(rawPlan: string): Entitlements {
  const plan = (rawPlan ?? 'trial').toLowerCase() as PlanId;
  const features = {} as Record<PlanFeature, boolean>;
  const required = {} as Entitlements['required'];

  for (const key of Object.keys(FEATURE_MIN_PLAN) as PlanFeature[]) {
    features[key] = planHasFeature(plan, key);
    const min = FEATURE_MIN_PLAN[key];
    required[key] = {
      plan: min,
      planName: findPlan(min)?.name_tr ?? min,
      label: PLAN_FEATURE_LABELS[key],
    };
  }

  return { plan, features, required };
}
