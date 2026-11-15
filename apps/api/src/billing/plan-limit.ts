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

/**
 * Sinir cumlesinin YOL kismi: "daha fazlasi icin ne yapabilirim". Dugmeyle AYNI karardan
 * (upgradeOfferFor) yazilir; metin "planını yükseltebilirsin" derken dugmenin "Teklif al" ya
 * da "Sınıra ulaştın" demesi boylece olmaz (sahip istegi 15.11.2026: en ust plandaki hesaba
 * yukseltme onerilmesin).
 *  - 'buy'   → "Daha fazlası için Profesyonel plana geçebilirsin."
 *  - 'quote' → "Daha fazlası için Kurumsal planı teklifle sunuluyor."
 *  - 'wait'  → '' (kaldiran plan yok: cumle yalniz yenilenmeyi soyler)
 */
export function upgradePathSentence(upgrade: UpgradeOffer, lead = 'Daha fazlası için'): string {
  if (upgrade.kind === 'wait' || !upgrade.planName) return '';
  return upgrade.kind === 'buy'
    ? `${lead} ${upgrade.planName} plana geçebilirsin.`
    : `${lead} ${upgrade.planName} planı teklifle sunuluyor.`;
}

/** `base` + yol cumlesi (yol yoksa yalniz `base`) */
export function withUpgradePath(base: string, upgrade: UpgradeOffer, lead?: string): string {
  const path = upgradePathSentence(upgrade, lead);
  return path ? `${base} ${path}` : base;
}

/**
 * Plani biten ESKI musteriye hitap (trial-policy 'lapsed'): hesap deneme DUZEYINE duser ama
 * bir deneme hesabi degildir. "Deneme hesabındaki ücretsiz hakkını kullandın" ona yanlis
 * hitapti; sinir cumleleri bu girisle baslar (web lib/article-allowance.ts `lapsed` ile ayni).
 */
export const LAPSED_LEAD = 'Planın sona erdi; hesabın deneme düzeyinde';

/** Plan siniri 403'u: metin + makine kodu + hangi planin kaldirdigi */
export function planLimitError(message: string, upgrade: UpgradeOffer): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, message, code: PLAN_LIMIT_CODE, upgrade });
}
