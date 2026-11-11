import { isUnconfiguredProvider } from '../audit/citation-providers.js';
import { BASE_ENGINES as PLAN_BASE_ENGINES, CONDITIONAL_ENGINES } from './plans.js';

/**
 * Bu kurulumda SU AN olculen AI asistanlari — saf modul (Nest, Prisma, ag yok).
 *
 * NEDEN VAR: ana sayfadaki "N asistanda ölçülür" seridi sabit 6 logo
 * gosteriyordu. Meta'nin asistani Muse yalniz META_MODEL_API_KEY tanimliyken
 * olculur (citation-providers.ts); seride kosulsuz eklemek, anahtar yokken
 * olcmedigimiz bir asistani vaat etmek olurdu. Web bu listeyi GET /billing/plans
 * yanitindan okur ve Muse'u ancak listede varsa gosterir. Fiyat kartlarindaki
 * asistan maddesi de ayni listeden uretilir (billing.service planFeatures).
 *
 * Liste urunun EN GENIS kapsamidir (Profesyonel ve ustu); bir planin bunlardan
 * hangilerini olctugu plans.ts planEngines'te. Asistan kimlikleri ve sirasi
 * plans.ts'ten gelir — ikinci bir liste tutulmaz.
 */
export const BASE_ENGINES = PLAN_BASE_ENGINES;

export function measuredEngines(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...BASE_ENGINES, ...CONDITIONAL_ENGINES.filter((e) => !isUnconfiguredProvider(e, env))];
}
