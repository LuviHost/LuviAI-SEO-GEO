import {
  BASE_ENGINES, CONDITIONAL_ENGINES, PLAN_RANK, STANDARD_ENGINES, planEngines, planModelTier,
  type MeasurementEngine, type ModelTier, type PlanId,
} from './plans.js';

/**
 * Site SAHIBININ planina gore olcum kapsami — saf modul (Nest, Prisma, ag yok).
 *
 * NEDEN: 11.11.2026 paket yapisi Baslangic'i (ve denemeyi) dort asistanla ve
 * hizli modellerle sinirliyor; fiyat karti bunu satiyor. Kural yalniz kartta
 * kalirsa olcum motoru her planda butun asistanlari en pahali modelle olcmeye
 * devam eder: alt paket musterisi ust paketi bedavaya alir, maliyet de duser
 * gibi gorunup dusmez. Olcum motoru (audit/ai-citation.service) kapsami ve
 * model kademesini BURADAN okur.
 *
 * Kurallar rota kapisiyla (plan-site-filter ownerHasPlanFeature) ayni:
 *  - ADMIN muaf: butun asistanlar, gelismis modeller.
 *  - Bilinmeyen plan EN DAR kapsami alir (kapi acik unutulmaz).
 */
type Owner = { plan?: string | null; role?: string | null } | null | undefined;

function planIdOf(owner: Owner): PlanId | null {
  const id = String(owner?.plan ?? '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(PLAN_RANK, id) ? (id as PlanId) : null;
}

/** Bu sahibin olcumlerinde SORULABILECEK asistanlar (kosullu olanlar dahil; anahtari yoksa yine olculmez) */
export function ownerEngines(owner: Owner): MeasurementEngine[] {
  if (owner?.role === 'ADMIN') return [...BASE_ENGINES, ...CONDITIONAL_ENGINES];
  const plan = planIdOf(owner);
  return plan ? planEngines(plan) : [...STANDARD_ENGINES];
}

/** Bu sahibin olcumlerinde kullanilan model kademesi */
export function ownerModelTier(owner: Owner): ModelTier {
  if (owner?.role === 'ADMIN') return 'premium';
  const plan = planIdOf(owner);
  return plan ? planModelTier(plan) : 'standard';
}
