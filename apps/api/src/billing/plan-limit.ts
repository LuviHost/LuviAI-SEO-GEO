import { ForbiddenException } from '@nestjs/common';
import { PLAN_RANK, PURCHASABLE_PLAN_IDS, publicPlans, type BasePlan, type PlanId } from './plans.js';

/**
 * PLAN SINIRI — "bu duvari hangi plan kaldirir" bilgisi (sahip istegi 15.11.2026).
 *
 * NEDEN: hakki / plani yetmeyen musteri dugmeye basinca kirmizi bir hata bildirimi
 * goruyordu; sinir bir ariza gibi gorunuyor, musteri ne yapacagini metinden cikarmak
 * zorunda kaliyordu. Artik plan siniri 403'u makine kodu (PLAN_LIMIT) ve bir `upgrade`
 * alani tasir; panel hatayi bildirim yerine plan penceresiyle karsilar
 * (web lib/plan-limit.ts, components/upgrade-gate.tsx).
 *
 * DURUSTLUK KURALI: satis yalniz duvari GERCEKTEN kaldiran plan icin onerilir. Karar
 * burada, sunucuda verilir (web plan tablosu tutmaz; bkz. web lib/entitlements.ts):
 *  - 'buy'   : siniri kaldiran en dusuk plan panelden kartla alinabiliyor
 *  - 'quote' : siniri kaldiran plan yalniz teklifle satiliyor (Kurumsal)
 *  - 'wait'  : satistaki hicbir plan kaldirmiyor; musteri yenilenmeyi bekler
 * Haftalik olcum hakki (measurement-allowance.ts) bu yuzden burada YOK: her planda ayni,
 * paket almak kaldirmaz.
 */
export const PLAN_LIMIT_CODE = 'PLAN_LIMIT';

export type UpgradeKind = 'buy' | 'quote' | 'wait';

export interface UpgradeOffer {
  kind: UpgradeKind;
  /** Siniri kaldiran plan; 'wait' ise null */
  planId: PlanId | null;
  /** Musteriye gosterilen plan adi (plans.ts name_tr); 'wait' ise null */
  planName: string | null;
}

const WAIT: UpgradeOffer = Object.freeze({ kind: 'wait', planId: null, planName: null });

/**
 * `plan`daki hesap icin `lifts` kosulunu saglayan (siniri kaldiran) en dusuk SATISTAKI
 * ust plan. Satistan kalkan plan (Ajans) hic onerilmez; taninmayan plan deneme sayilir.
 *
 * purchasableOnly: yalniz kartla alinabilen planlar aday olur. AI butcesi ve Asistan
 * mesaji metinleri Profesyonel ve ustune yukseltme vaat etmiyor (quota.service
 * aiBudgetMessage / chatLimitMessage); dugme de metinle ayni seyi soylemeli.
 */
export function upgradeOfferFor(
  plan: string | null | undefined,
  lifts: (p: BasePlan) => boolean,
  opts: { purchasableOnly?: boolean } = {},
): UpgradeOffer {
  const rank = PLAN_RANK[String(plan ?? '').toLowerCase() as PlanId] ?? PLAN_RANK.trial;
  const next = publicPlans()
    .filter((p) => PLAN_RANK[p.id] > rank && lifts(p))
    .filter((p) => !opts.purchasableOnly || PURCHASABLE_PLAN_IDS.includes(p.id))
    .sort((a, b) => PLAN_RANK[a.id] - PLAN_RANK[b.id])[0];
  if (!next) return WAIT;
  return {
    kind: PURCHASABLE_PLAN_IDS.includes(next.id) ? 'buy' : 'quote',
    planId: next.id,
    planName: next.name_tr,
  };
}

/** Plan siniri 403'u: metin + makine kodu + hangi planin kaldirdigi */
export function planLimitError(message: string, upgrade: UpgradeOffer): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, message, code: PLAN_LIMIT_CODE, upgrade });
}
