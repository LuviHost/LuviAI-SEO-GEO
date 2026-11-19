import { BadRequestException } from '@nestjs/common';
import { ENGINE_LABELS, PLAN_RANK, planEngines, promptsPerSiteFor, type MeasurementEngine, type PlanId } from '../billing/plans.js';
import { disabledEnginesOf } from '../billing/plan-engines.js';

/**
 * Yoneticinin hesap ayarlari (18.11.2026, sahip: "adminden kisiye hangi AI modelleri kullanabilir
 * tanimlayabilelim; mesela ICM icin Grok'u cikartabilelim" ve "bu limiti de adminden belirleyelim").
 *
 *  - Asistan yalniz KAPATILIR: liste planin kapsamiyla kesisir, plan disi bir asistan acilamaz
 *    (ownerEngines kapsamdan cikarir; kapsamda olmayani eklemez). Planin hepsi kapatilamaz.
 *  - Soru tavani: 1–200 ya da null (plan degeri). Aylik calistirma hakki degismez; tavan
 *    yukseltilirse hak erken dolabilir — yonetici bunu bilerek ayarlar.
 */
const MAX_PROMPTS = 200;

function planIdOf(plan: string | null | undefined): PlanId {
  const id = String(plan ?? '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(PLAN_RANK, id) ? (id as PlanId) : 'trial';
}

export function accountLimitsView(u: { plan: string; role?: string | null; disabledEngines?: unknown; promptsPerSiteOverride?: number | null }) {
  const plan = planIdOf(u.plan);
  const kapali = new Set<string>(disabledEnginesOf(u.disabledEngines));
  return {
    plan: u.plan,
    exempt: u.role === 'ADMIN',
    engines: planEngines(plan).map((id) => ({ id, label: ENGINE_LABELS[id], enabled: !kapali.has(id) })),
    promptsPerSite: {
      override: typeof u.promptsPerSiteOverride === 'number' ? u.promptsPerSiteOverride : null,
      planDefault: promptsPerSiteFor(u.plan),
    },
  };
}

export function normalizeAccountLimits(
  plan: string,
  input: { disabledEngines?: unknown; promptsPerSite?: unknown },
): { disabledEngines: MeasurementEngine[] | null; promptsPerSiteOverride: number | null } {
  const kapsam = planEngines(planIdOf(plan));
  const istenen = new Set<string>(disabledEnginesOf(input.disabledEngines));
  const kapali = kapsam.filter((e) => istenen.has(e));
  if (kapsam.length && kapali.length >= kapsam.length) {
    throw new BadRequestException('Planın bütün asistanları kapatılamaz; en az biri açık kalmalı.');
  }
  const p = input.promptsPerSite;
  let tavan: number | null = null;
  if (p !== null && p !== undefined) {
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > MAX_PROMPTS) {
      throw new BadRequestException(`Soru sınırı 1–${MAX_PROMPTS} arasında bir tam sayı olmalı.`);
    }
    tavan = p;
  }
  return { disabledEngines: kapali.length ? kapali : null, promptsPerSiteOverride: tavan };
}
