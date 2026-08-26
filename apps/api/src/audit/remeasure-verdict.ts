/**
 * Yeniden olcum hukmu — tek formul, ayri dosya.
 *
 * ESKI DAVRANIS: remeasure() tek koşumun ~7 saglayici satirina bakip
 * afterRate >= 0.4 ise WON ilan ediyordu. AI cevaplari kosumdan kosuma
 * oynak (defter: ai-assistants-answer-inconsistently + ai-citations-unstable-
 * across-runs, 2 bagimsiz kaynak); tek gunun tek kosumu "kazandik" demek
 * buyuk oranda sans. derive()'daki MIN_RUNS_FOR_VERDICT satir sayiyordu ve
 * tek tik zaten 7 satir uretiyordu — kapi ilk tikta geciyordu.
 *
 * YENI KURAL — hukmun birimi ACIK: en az REMEASURE_MIN_DAYS FARKLI GUN ve
 * en az REMEASURE_MIN_ROWS gecerli satir. Saniyeler icinde 3 kosum ayni model
 * durumunu/onbellegi orneklerdi (pseudo-replication); gun-arasi kayma gercek
 * oynakliktir. Ilk tik "ON SONUC" verir (UX olmez), D+1 ve D+2'de sistem
 * kosumlari (kota tuketmeden) hukmu tamamlar.
 */

export interface RemeasureRow {
  /** YYYY-MM-DD (GeoPromptRun.date, UTC gun) */
  date: string;
  provider: string;
  cited: boolean;
}

export type RemeasureVerdictKind = 'PRELIMINARY' | 'WON' | 'WEAK' | 'LOST';

export interface RemeasureVerdict {
  verdict: RemeasureVerdictKind;
  total: number;
  cited: number;
  rate: number;
  dayCount: number;
  /** En az bir gecerli satirda atif alan saglayicilar */
  wonProviders: string[];
}

export const REMEASURE_MIN_DAYS = 2;
export const REMEASURE_MIN_ROWS = 6;
/** Ilk tik + bu kadar sistem kosumu = hukum icin hedef olcum sayisi */
export const REMEASURE_FOLLOW_UPS = 2;
export const REMEASURE_WINDOW_DAYS = 7;

export function remeasureVerdict(
  rows: RemeasureRow[],
  thresholds: { weak: number; lost: number },
): RemeasureVerdict {
  const total = rows.length;
  const cited = rows.filter((r) => r.cited).length;
  const rate = total > 0 ? cited / total : 0;
  const dayCount = new Set(rows.map((r) => r.date)).size;
  const wonProviders = [...new Set(rows.filter((r) => r.cited).map((r) => r.provider))];

  const final = dayCount >= REMEASURE_MIN_DAYS && total >= REMEASURE_MIN_ROWS;
  const verdict: RemeasureVerdictKind = !final
    ? 'PRELIMINARY'
    : rate >= thresholds.weak ? 'WON'
    : rate > thresholds.lost ? 'WEAK'
    : 'LOST';

  return { verdict, total, cited, rate, dayCount, wonProviders };
}

/**
 * "after" penceresinin alt siniri: son REMEASURE_WINDOW_DAYS gun, ama yayin
 * gununden erken degil — yayin oncesi satirlar "after"i kirletmesin. Gun
 * basina yuvarlanir: GeoPromptRun.date UTC gece yarisi, publishedAt saatli;
 * ayni gun 14:00'te yayin + 16:00'da kosum, yuvarlama olmadan haksiz dislanirdi.
 */
export function afterWindowStart(now: Date, publishedAt: Date | null | undefined): Date {
  const windowStart = new Date(now.getTime() - REMEASURE_WINDOW_DAYS * 86_400_000);
  const ws = Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth(), windowStart.getUTCDate());
  if (!publishedAt) return new Date(ws);
  const pd = Date.UTC(publishedAt.getUTCFullYear(), publishedAt.getUTCMonth(), publishedAt.getUTCDate());
  return new Date(Math.max(ws, pd));
}
