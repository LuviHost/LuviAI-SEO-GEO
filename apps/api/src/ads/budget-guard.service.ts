import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  budgetGuardKey,
  decideBudgetIncrease,
  ignoredBudgetGuardEnv,
  parseBudgetGuardState,
  readBudgetGuardConfig,
  recordIncrease,
  withBaseline,
  type BudgetGuardConfig,
  type BudgetIncreaseDecision,
} from './budget-guard.js';

/** Platforma gitmeden once kv_store'a yazilan artis kaydi; platform reddederse geri alinir */
export interface BudgetReservation {
  key: string;
  /** Rezervasyondan onceki ham kayit (geri alma icin); null = kayit yoktu */
  previousRaw: string | null;
  before: number;
  after: number;
  baseline: number;
  ceiling: number;
  clamped: boolean;
  increasesThisWeek: number;
}

export type ReserveResult =
  | { ok: true; reservation: BudgetReservation }
  | Extract<BudgetIncreaseDecision, { ok: false }>;

/**
 * Otopilotun her butce ARTISI buradan gecer (kurallar budget-guard.ts).
 *
 * Sira bilerek "once rezerve, sonra platform": artis kv_store'a platform
 * cagrisindan ONCE yazilir. Platform reddederse kayit geri alinir; geri alma
 * basarisiz olursa guard bir artisi fazla sayar — yani daha temkinli kalir.
 * Ters sira (once platform, sonra kayit) kayit yazilamadiginda bekleme ve
 * haftalik siniri sessizce delerdi.
 */
@Injectable()
export class AdsBudgetGuardService {
  private readonly log = new Logger(AdsBudgetGuardService.name);
  private envWarned = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Her cagrida env'den okunur (sahip degistirip yeniden baslatinca gecerli olur) */
  config(): BudgetGuardConfig {
    if (!this.envWarned) {
      this.envWarned = true;
      const ignored = ignoredBudgetGuardEnv();
      if (ignored.length > 0) {
        this.log.warn(`Gecersiz/aralik disi butce emniyeti ayari yok sayildi, varsayilan kullaniliyor: ${ignored.join(', ')}`);
      }
    }
    return readBudgetGuardConfig();
  }

  /**
   * Artisa izin varsa kv_store'a yazar ve rezervasyonu doner; yoksa gerekceyi.
   * kv okuma/yazma hatasi yukari firlar — cagiran o kampanyada degisiklik yapmaz.
   */
  async reserveIncrease(args: {
    siteId: string;
    campaignId: string;
    current: number;
    proposed: number;
    now?: Date;
  }): Promise<ReserveResult> {
    const now = args.now ?? new Date();
    const config = this.config();
    const key = budgetGuardKey(args.siteId, args.campaignId);
    const row = await this.prisma.kvStore.findUnique({ where: { key } });
    const previousRaw = row?.value ?? null;
    const state = parseBudgetGuardState(previousRaw);
    const decision = decideBudgetIncrease({ current: args.current, proposed: args.proposed, state, now, config });
    if (!decision.ok) return decision;

    const next = recordIncrease(state === 'corrupt' ? null : state, args.current, decision.newBudget, now, config);
    const value = JSON.stringify(next);
    await this.prisma.kvStore.upsert({ where: { key }, create: { key, value }, update: { value } });
    return {
      ok: true,
      reservation: {
        key,
        previousRaw,
        before: args.current,
        after: decision.newBudget,
        baseline: decision.baseline,
        ceiling: decision.ceiling,
        clamped: decision.clamped,
        increasesThisWeek: decision.increasesThisWeek,
      },
    };
  }

  /** Platform artisi onaylamadiysa rezervasyonu geri al (en iyi caba) */
  async release(r: BudgetReservation): Promise<void> {
    try {
      if (r.previousRaw === null) {
        await this.prisma.kvStore.deleteMany({ where: { key: r.key } });
      } else {
        await this.prisma.kvStore.upsert({ where: { key: r.key }, create: { key: r.key, value: r.previousRaw }, update: { value: r.previousRaw } });
      }
    } catch (err: any) {
      this.log.warn(`[${r.key}] rezervasyon geri alinamadi (guard bir artisi fazla sayar, daha temkinli kalir): ${err?.message ?? err}`);
    }
  }

  /**
   * Artis olmayan degisiklikte (kaydiricinin azalttigi kampanya) taban yoksa
   * yazilir: tavan "otopilotun ilk degistirdigi andaki butce"ye gore hesaplanir.
   */
  async noteBaseline(siteId: string, campaignId: string, current: number, now: Date = new Date()): Promise<void> {
    if (!Number.isFinite(current) || current <= 0) return;
    const key = budgetGuardKey(siteId, campaignId);
    try {
      const row = await this.prisma.kvStore.findUnique({ where: { key } });
      if (row) return; // taban zaten var (ya da kayit bozuk — dokunma)
      const value = JSON.stringify(withBaseline(null, current, now));
      await this.prisma.kvStore.upsert({ where: { key }, create: { key, value }, update: { value } });
    } catch (err: any) {
      this.log.warn(`[${key}] taban yazilamadi: ${err?.message ?? err}`);
    }
  }
}
