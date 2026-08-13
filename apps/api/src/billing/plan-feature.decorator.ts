import { SetMetadata } from '@nestjs/common';
import type { PlanFeature } from './plans.js';

export const PLAN_FEATURE_KEY = 'planFeature';

/**
 * Rotayi bir plan ozelligine baglar. PlanFeatureGuard bunu okur.
 *
 * NEDEN DEKORATOR: kapilar servis govdelerine tek tek `await
 * enforcePlanFeature(...)` diye serpildiginde bir ucu atlamak gorunmez oluyor
 * ve gozden kacan uc, fiyat kartindaki maddeyi sessizce yalana cevirir.
 * Dekorator kapiyi rotanin YANINDA gorunur kilar; hangi ucun neye bagli oldugu
 * dosyaya bakinca okunur.
 *
 * Kural: YALNIZCA eylem uclarina koyun (POST/PATCH/DELETE ve pahali GET'ler).
 * Duz listeleme uclari acik kalmali — plani dusen kullanici gecmis verisini
 * gorebilmeli ve baglantisini kesebilmeli.
 */
export const RequiresPlan = (feature: PlanFeature) => SetMetadata(PLAN_FEATURE_KEY, feature);
