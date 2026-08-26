/**
 * Manset AI gorunurluk skoru — tek formul, ayri dosya (citation-score.ts deseni).
 *
 * NEDEN: Manset daha once her saglayicinin SON TEK snapshot'inin ortalamasiydi.
 * AI asistan cevaplari kosumdan kosuma oynak (iki bagimsiz kanit kumesi:
 * ai-assistants-answer-inconsistently, ai-citations-unstable-across-runs);
 * tek gunun tek kosumu "skor 61'den 38'e dustu" gibi sahte hareketler
 * uretiyordu. Manset artik son 7 olcum gununun ortalamasi.
 *
 * Pencere "bugun"e degil serinin SON NOKTASINA gore kurulur: cron 10 gun
 * durmussa manset bosalmak yerine eldeki son haftayi anlatir; UI bayatligi
 * latestRunAt ile ayrica gosterir.
 *
 * Kullanicilar: ai-citation-tracker.service.ts (getHistory), chart + overview.
 */

export interface SeriesPoint {
  date: string;          // YYYY-MM-DD
  score: number | null;  // null = o gun olculemedi (kota/hata)
}

export interface ProviderHeadline {
  /** Son `windowDays` gunun null-disi skor ortalamasi; olcum yoksa null */
  last7Avg: number | null;
  /** Penceredeki gecerli (null-disi) olcum sayisi */
  runCount: number;
  /** Onceki pencereye gore puan farki; iki pencereden biri bossa null */
  deltaVsPrev: number | null;
}

export interface Headline {
  score: number | null;
  /** 'rolling' = en az bir saglayici >=2 olcumle ortalandi; 'first-run' = hepsi tek olcum */
  method: 'rolling' | 'first-run' | null;
  /** Saglayicilar arasi en yuksek olcum gunu sayisi — "N olcum" etiketi */
  runCount: number;
  deltaVsPrev: number | null;
  /** Gunluk, saglayicilar-arasi ortalama seri — sparkline icin */
  daily: SeriesPoint[];
}

const DAY_MS = 86_400_000;

function dayIndex(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Serinin son noktasina gore [son-window+1, son] ve bir onceki pencere ortalamalari */
export function providerHeadline(series: SeriesPoint[], windowDays = 7): ProviderHeadline {
  const valid = series.filter((p) => typeof p.score === 'number');
  if (valid.length === 0) return { last7Avg: null, runCount: 0, deltaVsPrev: null };

  const lastDay = Math.max(...valid.map((p) => dayIndex(p.date)));
  const inWindow = (p: SeriesPoint, from: number, to: number) => {
    const d = dayIndex(p.date);
    return d >= from && d <= to;
  };

  const cur = valid.filter((p) => inWindow(p, lastDay - windowDays + 1, lastDay)).map((p) => p.score as number);
  const prev = valid
    .filter((p) => inWindow(p, lastDay - 2 * windowDays + 1, lastDay - windowDays))
    .map((p) => p.score as number);

  const last7Avg = mean(cur);
  const prevAvg = mean(prev);
  return {
    last7Avg,
    runCount: cur.length,
    deltaVsPrev: last7Avg !== null && prevAvg !== null ? last7Avg - prevAvg : null,
  };
}

/**
 * Saglayici serilerinden tek manset. Saglayici basina: >=2 olcum varsa 7g
 * ortalamasi, tek olcum varsa o olcum ("ilk olcum" — 7g etiketi yalan olmasin).
 */
export function buildHeadline(
  byProvider: Record<string, SeriesPoint[]>,
  windowDays = 7,
): Headline {
  const picks: number[] = [];
  const deltas: number[] = [];
  let anyRolling = false;
  let runCount = 0;

  for (const series of Object.values(byProvider)) {
    const h = providerHeadline(series, windowDays);
    if (h.last7Avg === null) continue;
    if (h.runCount >= 2) {
      anyRolling = true;
      picks.push(h.last7Avg);
      if (h.deltaVsPrev !== null) deltas.push(h.deltaVsPrev);
    } else {
      // Tek olcum: ortalama zaten o degerin kendisi
      picks.push(h.last7Avg);
    }
    runCount = Math.max(runCount, h.runCount);
  }

  // Gunluk saglayicilar-arasi ortalama (sparkline)
  const perDay = new Map<string, number[]>();
  for (const series of Object.values(byProvider)) {
    for (const p of series) {
      if (typeof p.score !== 'number') continue;
      const arr = perDay.get(p.date) ?? [];
      arr.push(p.score);
      perDay.set(p.date, arr);
    }
  }
  const daily = [...perDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, scores]) => ({ date, score: mean(scores) }));

  const score = mean(picks);
  return {
    score,
    method: score === null ? null : anyRolling ? 'rolling' : 'first-run',
    runCount,
    deltaVsPrev: deltas.length > 0 ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
    daily,
  };
}
