import { isUnconfiguredProvider } from '../audit/citation-providers.js';

/**
 * Bu kurulumda SU AN olculen AI asistanlari — saf modul (Nest, Prisma, ag yok).
 *
 * NEDEN VAR: ana sayfadaki "N asistanda ölçülür" seridi sabit 6 logo
 * gosteriyordu. Meta'nin asistani Muse yalniz META_MODEL_API_KEY tanimliyken
 * olculur (citation-providers.ts); seride kosulsuz eklemek, anahtar yokken
 * olcmedigimiz bir asistani vaat etmek olurdu. Web bu listeyi GET /billing/plans
 * yanitindan okur ve Muse'u ancak listede varsa gosterir.
 *
 * Ilk alti HER kurulumda vaat edilen asistanlardir: plan kartlari ve pazarlama
 * metinleri "6 asistan" der (plans.ts aiProviders, plans-ai-providers.spec).
 * Sira web'deki seritle ayni (engine-logo.tsx MEASURED_ENGINES).
 */
export const BASE_ENGINES = ['openai', 'gemini', 'anthropic', 'perplexity', 'xai', 'deepseek'] as const;

export function measuredEngines(env: NodeJS.ProcessEnv = process.env): string[] {
  return isUnconfiguredProvider('meta', env) ? [...BASE_ENGINES] : [...BASE_ENGINES, 'meta'];
}
