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
/**
 * Ana sayfadaki UCRETSIZ (anonim) testin, mobil uygulamadaki testin ve e-posta abonesi
 * retest'inin sordugu asistanlar: deneme ve Baslangic ile ayni dort asistan, hesapli modeller.
 *
 * NEDEN (11.11.2026, canli olcum — ~/Desktop/model-denemesi-3-sonuc.txt): anonim test yedi
 * asistana soruyordu. Soru basina gercek maliyet yedi asistanla ~0.45 USD (Grok tek basina
 * ~0.23: soru basina 6–8 arama; Muse ~0.09; DeepSeek ~0.05), dort asistanla ~0.07 USD. Uc
 * soruluk bir ucretsiz test ~1.34 USD yerine ~0.21 USD. Sahip yonergesi: "Baslangic hesapli is,
 * premium kalite isi; zarar etmeyelim" — Grok, DeepSeek ve Muse Profesyonel ozelligi.
 * Web bu listeyi GET /billing/plans → freeTestEngines'ten okur ("N AI asistaninda test edelim").
 */
export const FREE_TEST_ENGINES: readonly MeasurementEngine[] = STANDARD_ENGINES;

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
