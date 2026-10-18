/**
 * Reklam otopilotu butce emniyet rayi — saf kurallar (spec'lerde dogrudan test edilir).
 *
 * NEDEN: campaign-orchestrator, tiklama orani %3'un ve ROAS 5'in ustunde kalan
 * kampanyanin butcesini her ADS_AUTOPILOT turunda (6 saatte bir) x1,2
 * yapiyordu; tavan ya da bekleme yoktu. Kosul surdukce gunde ~x2,07 (1,2^4),
 * bir haftada ~x165 — musterinin reklam hesabinda onaysiz harcama artisi.
 * Butce kaydirici (budget-shifter) da kazanan kampanyaya her turda ekliyordu.
 *
 * Kural (varsayilan; sahip env ile gevsetebilir):
 *  - kampanya basina 24 saatte en fazla 1 artis  (ADS_BUDGET_INCREASE_COOLDOWN_HOURS)
 *  - kayan 7 gunde en fazla 2 artis              (ADS_BUDGET_MAX_INCREASES_PER_WEEK)
 *  - tavan: otopilotun o kampanyada ILK degisiklik yaptigi andaki butcenin
 *    2 kati (ADS_BUDGET_MAX_MULTIPLIER); son artis tavana kirpilir.
 * Gecersiz ya da aralik disi env degeri yok sayilir, varsayilan kullanilir
 * (yanlis yazilmis bir deger emniyeti kendiliginden gevsetmesin).
 *
 * Taban (baseline) ve artis zamanlari kv_store'da tutulur (sema degisikligi yok).
 * Anahtar site kimligini icerir: site silme (sites.service siteKvFilter) ve
 * hesap silme (account-purge.plan) planlarinin "anahtar kimligi icerir" adimi
 * satiri da siler (bkz. me/unscoped-kv-keys.ts gerekcesi).
 */

export const HOUR_MS = 3_600_000;
export const WEEK_MS = 7 * 24 * HOUR_MS;

/** Orchestrator'in tek adimdaki artis carpani (+%20) */
export const BUDGET_INCREASE_FACTOR = 1.2;
/** Butce kaydiricinin zayif kampanyadan aldigi pay (%20) */
export const BUDGET_SHIFT_FRACTION = 0.2;

export interface BudgetGuardConfig {
  /** Iki artis arasi en az bekleme (saat) */
  cooldownHours: number;
  /** Kayan 7 gunde en fazla artis sayisi (0 = artis yok) */
  maxIncreasesPerWeek: number;
  /** Tavan carpani: taban x bu deger (1 = ilk butcenin ustune cikilmaz) */
  maxMultiplier: number;
}

export const BUDGET_GUARD_DEFAULTS: Readonly<BudgetGuardConfig> = Object.freeze({
  cooldownHours: 24,
  maxIncreasesPerWeek: 2,
  maxMultiplier: 2,
});

/** env adi → [alt sinir, ust sinir, tamsayi mi] */
const ENV_SPEC = {
  ADS_BUDGET_INCREASE_COOLDOWN_HOURS: { key: 'cooldownHours', min: 1, max: 24 * 30, integer: false },
  ADS_BUDGET_MAX_INCREASES_PER_WEEK: { key: 'maxIncreasesPerWeek', min: 0, max: 28, integer: true },
  ADS_BUDGET_MAX_MULTIPLIER: { key: 'maxMultiplier', min: 1, max: 10, integer: false },
} as const;

type EnvName = keyof typeof ENV_SPEC;

function parseEnvValue(name: EnvName, raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const spec = ENV_SPEC[name];
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return null;
  if (spec.integer && !Number.isInteger(n)) return null;
  if (n < spec.min || n > spec.max) return null;
  return n;
}

export function readBudgetGuardConfig(env: NodeJS.ProcessEnv = process.env): BudgetGuardConfig {
  const cfg: BudgetGuardConfig = { ...BUDGET_GUARD_DEFAULTS };
  for (const name of Object.keys(ENV_SPEC) as EnvName[]) {
    const v = parseEnvValue(name, env[name]);
    if (v !== null) cfg[ENV_SPEC[name].key] = v;
  }
  return cfg;
}

/** Ayarlanmis ama gecersiz oldugu icin yok sayilan env adlari (servis bir kez uyari loglar) */
export function ignoredBudgetGuardEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (Object.keys(ENV_SPEC) as EnvName[]).filter((name) => {
    const raw = env[name];
    return raw !== undefined && raw.trim() !== '' && parseEnvValue(name, raw) === null;
  });
}

/** Panelde gosterilen kural ozeti — metin env'den bagimsiz yazilmasin diye API'den gelir */
export interface AdsAutopilotRules {
  increasePercent: number;
  shiftPercent: number;
  cooldownHours: number;
  maxIncreasesPerWeek: number;
  maxMultiplier: number;
}

export function adsAutopilotRules(config: BudgetGuardConfig = readBudgetGuardConfig()): AdsAutopilotRules {
  return {
    increasePercent: Math.round((BUDGET_INCREASE_FACTOR - 1) * 100),
    shiftPercent: Math.round(BUDGET_SHIFT_FRACTION * 100),
    cooldownHours: config.cooldownHours,
    maxIncreasesPerWeek: config.maxIncreasesPerWeek,
    maxMultiplier: config.maxMultiplier,
  };
}

export interface BudgetIncreaseRecord {
  at: string; // ISO
  from: number;
  to: number;
}

export interface BudgetGuardState {
  v: 1;
  /** Otopilotun bu kampanyada ilk degisiklik yaptigi andaki butce */
  baseline: number;
  baselineAt: string;
  increases: BudgetIncreaseRecord[];
}

export function budgetGuardKey(siteId: string, campaignId: string): string {
  return `ads:budget-guard:${siteId}:${campaignId}`;
}

/** Kurus hassasiyeti: platformlar butceyi en kucuk birimde ister (Meta kurus/sent, Google mikro) */
export function roundBudget(n: number): number {
  return Math.round(n * 100) / 100;
}

const EPS = 0.005;

function validRecord(r: any): r is BudgetIncreaseRecord {
  return !!r && typeof r.at === 'string' && Number.isFinite(Date.parse(r.at))
    && Number.isFinite(Number(r.from)) && Number.isFinite(Number(r.to));
}

/**
 * null: kayit yok (ilk degisiklik). 'corrupt': kayit var ama okunamiyor — artis
 * ENGELLENIR. Bozuk kaydi "yok" saymak tabani o anki (belki zaten iki katina
 * cikmis) butceye tasir ve tavani sessizce iki katina cikarirdi.
 */
export function parseBudgetGuardState(raw: string | null | undefined): BudgetGuardState | null | 'corrupt' {
  if (raw === null || raw === undefined) return null;
  let o: any;
  try {
    o = JSON.parse(raw);
  } catch {
    return 'corrupt';
  }
  const baseline = Number(o?.baseline);
  if (!o || typeof o !== 'object' || !Number.isFinite(baseline) || baseline <= 0) return 'corrupt';
  const list = o.increases ?? [];
  if (!Array.isArray(list) || !list.every(validRecord)) return 'corrupt';
  return {
    v: 1,
    baseline,
    baselineAt: typeof o.baselineAt === 'string' ? o.baselineAt : '',
    increases: list.map((r: BudgetIncreaseRecord) => ({ at: r.at, from: Number(r.from), to: Number(r.to) })),
  };
}

export type IncreaseRejection = 'invalid-budget' | 'cooldown' | 'weekly-cap' | 'ceiling' | 'state-unreadable';

export type BudgetIncreaseDecision =
  | {
      ok: true;
      newBudget: number;
      baseline: number;
      ceiling: number;
      /** Onerilen artis tavana kirpildi mi */
      clamped: boolean;
      /** Bu artis dahil kayan 7 gundeki artis sayisi */
      increasesThisWeek: number;
    }
  | {
      ok: false;
      reason: IncreaseRejection;
      baseline?: number;
      ceiling?: number;
      /** Bekleme / haftalik sinir icin bir sonraki uygun an */
      nextAllowedAt?: Date;
    };

export function decideBudgetIncrease(args: {
  current: number;
  proposed: number;
  state: BudgetGuardState | null | 'corrupt';
  now: Date;
  config: BudgetGuardConfig;
}): BudgetIncreaseDecision {
  const { current, proposed, state, now, config } = args;
  if (state === 'corrupt') return { ok: false, reason: 'state-unreadable' };
  if (!Number.isFinite(current) || current <= 0) return { ok: false, reason: 'invalid-budget' };
  if (!Number.isFinite(proposed) || proposed <= current + EPS) return { ok: false, reason: 'invalid-budget' };

  const baseline = state?.baseline ?? current;
  const ceiling = roundBudget(baseline * config.maxMultiplier);
  const nowMs = now.getTime();
  const times = (state?.increases ?? [])
    .map((r) => Date.parse(r.at))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  const last = times.length > 0 ? times[times.length - 1] : null;
  const cooldownMs = config.cooldownHours * HOUR_MS;
  if (last !== null && nowMs - last < cooldownMs) {
    return { ok: false, reason: 'cooldown', baseline, ceiling, nextAllowedAt: new Date(last + cooldownMs) };
  }

  const recent = times.filter((t) => nowMs - t < WEEK_MS);
  if (recent.length >= config.maxIncreasesPerWeek) {
    // En eski artis pencereden cikinca yer acilir (0 ise hic acilmaz)
    const nextAllowedAt = recent.length > 0 && config.maxIncreasesPerWeek > 0
      ? new Date(recent[recent.length - config.maxIncreasesPerWeek] + WEEK_MS)
      : undefined;
    return { ok: false, reason: 'weekly-cap', baseline, ceiling, nextAllowedAt };
  }

  if (current >= ceiling - EPS) return { ok: false, reason: 'ceiling', baseline, ceiling };
  const newBudget = roundBudget(Math.min(proposed, ceiling));
  if (newBudget <= current + EPS) return { ok: false, reason: 'ceiling', baseline, ceiling };

  return {
    ok: true,
    newBudget,
    baseline,
    ceiling,
    clamped: proposed > ceiling + EPS,
    increasesThisWeek: recent.length + 1,
  };
}

/** Basarili (ya da rezerve edilen) artisi duruma ekler; taban ilk degisiklikte sabitlenir */
export function recordIncrease(
  state: BudgetGuardState | null,
  from: number,
  to: number,
  now: Date,
  config: BudgetGuardConfig,
): BudgetGuardState {
  const base = withBaseline(state, from, now);
  // Bekleme 7 gunden uzun ayarlanirsa son artis yine de unutulmasin
  const keepMs = Math.max(WEEK_MS, config.cooldownHours * HOUR_MS);
  const kept = base.increases.filter((r) => now.getTime() - Date.parse(r.at) < keepMs);
  return { ...base, increases: [...kept, { at: now.toISOString(), from, to }].slice(-50) };
}

/** Azaltma gibi artis disi ilk degisiklikte de taban yazilir (tavan "ilk degisiklik" anina gore) */
export function withBaseline(state: BudgetGuardState | null, current: number, now: Date): BudgetGuardState {
  return state ?? { v: 1, baseline: current, baselineAt: now.toISOString(), increases: [] };
}

/** Log ve panel icin kisa Turkce gerekce */
export function describeRejection(d: Extract<BudgetIncreaseDecision, { ok: false }>, config: BudgetGuardConfig): string {
  const when = d.nextAllowedAt ? `; sonraki uygun zaman ${d.nextAllowedAt.toISOString()}` : '';
  switch (d.reason) {
    case 'cooldown':
      return `son artistan bu yana ${config.cooldownHours} saat dolmadi${when}`;
    case 'weekly-cap':
      return `7 gunde en fazla ${config.maxIncreasesPerWeek} artis sinirina ulasildi${when}`;
    case 'ceiling':
      return `tavana ulasildi (taban ${d.baseline} x ${config.maxMultiplier} = ${d.ceiling})`;
    case 'state-unreadable':
      return 'emniyet kaydi okunamadi; artis guvenli tarafta kalmak icin yapilmadi';
    default:
      return 'butce kaydi gecersiz';
  }
}
