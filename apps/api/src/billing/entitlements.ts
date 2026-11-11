import {
  FEATURE_MIN_PLAN, PLAN_FEATURE_LABELS, planHasFeature, featureOfferPlan,
  type PlanFeature, type PlanId,
} from './plans.js';
import { ownerEngines } from './plan-engines.js';
import { measuredEngines } from './measured-engines.js';

export interface Entitlements {
  plan: PlanId;
  /** Ozellik -> bu planda acik mi */
  features: Record<PlanFeature, boolean>;
  /**
   * Bu hesabin olcumlerinde SU AN sorulan asistanlar (saglayici kimlikleri): plan kapsami
   * (plan-engines ownerEngines; ADMIN muaf) ∩ bu kurulumda olculenler (measured-engines).
   * Panel "N AI asistaninda" sayisini ve logo seridini BURADAN yazar — Baslangic ve
   * denemede dort, Profesyonel ve ustunde alti (+ anahtari tanimliysa Muse).
   */
  engines: string[];
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
 *
 * ADMIN: sunucu kapilari (PlanFeatureGuard, ownerHasPlanFeature) ADMIN'i muaf
 * tutuyor; haklar yalniz plana bakinca panel admin'e calisan ozelligi kilitli
 * gosteriyordu. Ayni kural burada: ADMIN'de her ozellik acik, `plan` gercek plan.
 */
export function entitlementsFor(rawPlan: string, role?: string | null): Entitlements {
  const plan = (rawPlan ?? 'trial').toLowerCase() as PlanId;
  const features = {} as Record<PlanFeature, boolean>;
  const required = {} as Entitlements['required'];

  for (const key of Object.keys(FEATURE_MIN_PLAN) as PlanFeature[]) {
    features[key] = role === 'ADMIN' || planHasFeature(plan, key);
    // Musteriye soylenen plan = ozelligi iceren en dusuk SATISTAKI plan (plans.ts
    // featureOfferPlan). Kapinin kendisi FEATURE_MIN_PLAN'da durur: Ajans satistan kalkti
    // (11.11.2026) ama o plandaki hesaplar hakkini korur; kilitli kart "Ajans planina
    // dahildir" derse musteri alamayacagi bir plana yollanir.
    const offer = featureOfferPlan(key);
    required[key] = {
      plan: offer.id,
      planName: offer.name_tr,
      label: PLAN_FEATURE_LABELS[key],
    };
  }

  const measured = measuredEngines();
  const engines = ownerEngines({ plan, role }).filter((e) => measured.includes(e));

  return { plan, features, engines, required };
}
