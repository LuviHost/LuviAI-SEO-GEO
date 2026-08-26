/**
 * Gorunurluk oynakligi — tek formul, ayri dosya (citation-score.ts deseni).
 *
 * NEDEN ORAN, SABIT ESIK DEGIL: gunluk skor n probe'dan turetilen bir oran.
 * Gercek oran p SABIT olsa bile gunluk olcum binom gurultusuyle dalgalanir:
 * beklenen sd = sqrt(p(1-p)/n). n=35 (7 saglayici x 5 probe), p=0.3 icin
 * ~%7.7; n=7 icin ~%17. Sabit "sd <= 0.10 istikrarli" esigi az probe'lu
 * siteyi hic degismemisken "dalgali" damgalardi (kirmizi-takim bulgusu).
 * Bu yuzden gozlenen sd, beklenen orneklem sd'sine ORANLANIR:
 *   oran <= 1.5  istikrarli  (gurultu sinirinda)
 *   oran <= 2.5  dalgali
 *   ustu         oynak       (gercek degisim veya saglayici drift'i)
 *
 * Yaklasim notu: skor 0-100 bilesik (cited 100 / mentioned 50); /100'u
 * Bernoulli p gibi ele almak bir yaklasimdir — amac mutlak dogruluk degil,
 * "bu hareket gurultu mu" sorusuna olcekli bir cevap.
 *
 * Girdi: AiCitationSnapshot gunluk serisi (cron'lu, her gun ayni brain
 * sorulari — kompozisyon sabit). GeoPromptRun kullanilmaz: cron'suz ve
 * gunden gune farkli prompt alt-kumeleriyle kosuluyor; sd kompozisyon
 * farkini "oynaklik" diye okur.
 */

export interface StabilityDay {
  /** Gunun saglayicilar-arasi ortalama skoru (0-100); olculemediyse null */
  score: number | null;
  /** O gun skora giren probe sayisi (saglayici x probe) */
  n: number;
}

export type StabilityLabel = 'istikrarli' | 'dalgali' | 'oynak' | 'yetersiz-veri';

export interface Stability {
  label: StabilityLabel;
  dayCount: number;
  /** Gozlenen gunluk sd (0-1 olceginde) */
  observedSd: number | null;
  /** Ayni p ve ortalama n icin beklenen orneklem sd'si */
  expectedSd: number | null;
  ratio: number | null;
}

export const STABILITY_MIN_DAYS = 4;       // ai-mention-alarm.service.ts:102 ile ayni esik
export const STABILITY_RATIO_STABLE = 1.5;
export const STABILITY_RATIO_WAVY = 2.5;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function assessStability(days: StabilityDay[]): Stability {
  const valid = days.filter((d): d is { score: number; n: number } => typeof d.score === 'number' && d.n > 0);
  if (valid.length < STABILITY_MIN_DAYS) {
    return { label: 'yetersiz-veri', dayCount: valid.length, observedSd: null, expectedSd: null, ratio: null };
  }

  const ps = valid.map((d) => Math.min(1, Math.max(0, d.score / 100)));
  const p = mean(ps);
  const observedSd = Math.sqrt(mean(ps.map((x) => (x - p) ** 2)));
  const nAvg = mean(valid.map((d) => d.n));
  const expectedSd = Math.sqrt((p * (1 - p)) / nAvg);

  let ratio: number;
  if (expectedSd < 1e-9) {
    // p tam 0 veya 1: beklenen gurultu sifir — gozlenen de sifirsa istikrarli
    ratio = observedSd < 1e-9 ? 0 : Number.POSITIVE_INFINITY;
  } else {
    ratio = observedSd / expectedSd;
  }

  const label: StabilityLabel =
    ratio <= STABILITY_RATIO_STABLE ? 'istikrarli' :
    ratio <= STABILITY_RATIO_WAVY ? 'dalgali' : 'oynak';

  return {
    label,
    dayCount: valid.length,
    observedSd: round4(observedSd),
    expectedSd: round4(expectedSd),
    ratio: Number.isFinite(ratio) ? round4(ratio) : null,
  };
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
