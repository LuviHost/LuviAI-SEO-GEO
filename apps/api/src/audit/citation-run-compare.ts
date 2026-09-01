/**
 * Iki AI gorunurluk testinin (AiCitationRun) karsilastirmasi — saf.
 *
 * NEDEN: "Yeniden Test" ayni gun ikinci kez kosuldugunda gunluk snapshot
 * (siteId+date+provider unique) uzerine yaziliyordu — musteri onceki sonucu
 * kaybediyordu ve iki testi yan yana koyamiyordu. Artik her kosum
 * AiCitationRun'a append-only yazilir; bu modul iki kosumu saglayici ve
 * soru bazinda kiyaslar. Gunluk snapshot (grafik) degismedi: gunun SON
 * kosumunu tutar.
 */

export interface RunProbe {
  query: string;
  cited: boolean;
  brandMentioned: boolean;
  brandInQuery?: boolean;
  position?: number | null;
  sentiment?: string | null;
  excerpt?: string | null;
}

export interface RunProvider {
  provider: string;
  label?: string;
  available: boolean;
  score: number | null;
  reason?: string | null;
  probes: RunProbe[];
}

export interface RunSummary {
  id: string;
  runAt: string;
  trigger: string;
  headlineScore: number | null;
  providers: RunProvider[];
}

export type QueryOutcome = 'cited' | 'mentioned' | 'none' | 'n/a';

export interface QueryDiff {
  provider: string;
  query: string;
  before: QueryOutcome;
  after: QueryOutcome;
  /** +1 iyilesti, -1 kotulesti, 0 ayni */
  direction: 1 | -1 | 0;
}

/** Soru bazli ozet: bir sorunun TUM saglayicilardaki durumu (rapor "soru bazli detay" bolumu) */
export interface QueryRollup {
  query: string;
  /** 0-100: o soruda kac saglayici anmis/atif vermis (atif 2, anilma 1 puan / 2*saglayici) */
  before: number;
  after: number;
  delta: number;
  /** Sonraki kosumda bu soruda gorunen saglayicilar */
  providers: string[];
}

/** Anilma / atif sayaclari — "mention & atif degisimi" bolumu */
export interface MentionCounts {
  /** Cevapta marka adi gecti */
  mentioned: number;
  /** Cevap alan adini kaynak/link olarak verdi */
  cited: number;
  /** Olculen (markasiz, hatasiz) probe sayisi — payda */
  measured: number;
}

export interface RunComparison {
  a: { id: string; runAt: string; headlineScore: number | null; trigger?: string };
  b: { id: string; runAt: string; headlineScore: number | null; trigger?: string };
  headlineDelta: number | null;
  providers: Array<{ provider: string; label?: string; before: number | null; after: number | null; delta: number | null }>;
  /** Yalniz DEGISEN soru/saglayici ciftleri (markasiz) */
  changed: QueryDiff[];
  gained: number;
  lost: number;
  unchanged: number;
  /** Soru bazli ozet (degisen + degismeyen hepsi) — rapor icin */
  queries: QueryRollup[];
  /** Anilma/atif sayaclari: once ve sonra */
  mentions: { before: MentionCounts; after: MentionCounts };
  /** Iki kosum arasindaki gun farki (rapor basligi: "25 gün ara") */
  daysBetween: number;
}

const RANK: Record<QueryOutcome, number> = { 'n/a': -1, none: 0, mentioned: 1, cited: 2 };

export function outcomeOf(p: RunProbe | undefined): QueryOutcome {
  if (!p) return 'n/a';
  if (p.cited) return 'cited';
  if (p.brandMentioned) return 'mentioned';
  return 'none';
}

/** Manset: saglayicilarin null-disi skor ortalamasi (citation-headline ile ayni ruh: olculemeyen saglayici paydaya girmez) */
export function headlineOfProviders(providers: RunProvider[]): number | null {
  const scores = providers.map((p) => p.score).filter((s): s is number => typeof s === 'number');
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export function compareCitationRuns(a: RunSummary, b: RunSummary): RunComparison {
  const providerNames = [...new Set([...a.providers.map((p) => p.provider), ...b.providers.map((p) => p.provider)])];
  const providers = providerNames.map((name) => {
    const pa = a.providers.find((p) => p.provider === name);
    const pb = b.providers.find((p) => p.provider === name);
    const before = pa?.score ?? null;
    const after = pb?.score ?? null;
    return { provider: name, label: pb?.label ?? pa?.label, before, after, delta: before !== null && after !== null ? after - before : null };
  });

  const changed: QueryDiff[] = [];
  let gained = 0, lost = 0, unchanged = 0;
  for (const name of providerNames) {
    const pa = a.providers.find((p) => p.provider === name);
    const pb = b.providers.find((p) => p.provider === name);
    const qa = new Map((pa?.probes ?? []).filter((p) => p.brandInQuery !== true).map((p) => [p.query.trim().toLowerCase(), p]));
    const qb = new Map((pb?.probes ?? []).filter((p) => p.brandInQuery !== true).map((p) => [p.query.trim().toLowerCase(), p]));
    const queries = [...new Set([...qa.keys(), ...qb.keys()])];
    for (const q of queries) {
      const before = outcomeOf(qa.get(q));
      const after = outcomeOf(qb.get(q));
      if (before === after) { unchanged++; continue; }
      const direction: 1 | -1 | 0 = RANK[after] > RANK[before] ? 1 : RANK[after] < RANK[before] ? -1 : 0;
      if (direction === 1) gained++; else if (direction === -1) lost++;
      changed.push({ provider: name, query: (qb.get(q) ?? qa.get(q))!.query, before, after, direction });
    }
  }

  return {
    a: { id: a.id, runAt: a.runAt, headlineScore: a.headlineScore, trigger: a.trigger },
    b: { id: b.id, runAt: b.runAt, headlineScore: b.headlineScore, trigger: b.trigger },
    headlineDelta: a.headlineScore !== null && b.headlineScore !== null ? b.headlineScore - a.headlineScore : null,
    providers,
    changed: changed.sort((x, y) => y.direction - x.direction || x.provider.localeCompare(y.provider)),
    gained,
    lost,
    unchanged,
    queries: soruOzeti(a, b),
    mentions: { before: anilmaSayaci(a), after: anilmaSayaci(b) },
    daysBetween: Math.max(0, Math.round((new Date(b.runAt).getTime() - new Date(a.runAt).getTime()) / 86_400_000)),
  };
}

/**
 * Soru bazli ozet: bir soru TUM saglayicilarda nasil gidiyor.
 * Skor = (atif*2 + anilma*1) / (2 * olculen saglayici) * 100 — rapor cubuklari icin 0-100.
 * NEDEN markali sorular disarida: sorunun icinde marka gecince anilmak totolojik (brand-in-query.ts).
 */
function soruOzeti(a: RunSummary, b: RunSummary): QueryRollup[] {
  const anahtar = (q: string) => q.trim().toLowerCase();
  const puanla = (run: RunSummary, q: string): { puan: number; saglayicilar: string[] } => {
    let toplam = 0;
    let olculen = 0;
    const saglayicilar: string[] = [];
    for (const p of run.providers) {
      const probe = p.probes.find((x) => x.brandInQuery !== true && anahtar(x.query) === q);
      if (!probe) continue;
      olculen++;
      const o = outcomeOf(probe);
      if (o === 'cited') { toplam += 2; saglayicilar.push(p.label ?? p.provider); }
      else if (o === 'mentioned') { toplam += 1; saglayicilar.push(p.label ?? p.provider); }
    }
    return { puan: olculen === 0 ? 0 : Math.round((toplam / (2 * olculen)) * 100), saglayicilar };
  };

  const sorular = new Map<string, string>();
  for (const run of [a, b]) {
    for (const p of run.providers) {
      for (const probe of p.probes) {
        if (probe.brandInQuery === true) continue;
        sorular.set(anahtar(probe.query), probe.query);
      }
    }
  }

  return [...sorular.entries()]
    .map(([k, metin]) => {
      const once = puanla(a, k);
      const sonra = puanla(b, k);
      return { query: metin, before: once.puan, after: sonra.puan, delta: sonra.puan - once.puan, providers: sonra.saglayicilar };
    })
    .sort((x, y) => y.delta - x.delta || y.after - x.after);
}

/** Bir kosumdaki anilma/atif sayilari (markasiz probe'lar) */
function anilmaSayaci(run: RunSummary): MentionCounts {
  let mentioned = 0;
  let cited = 0;
  let measured = 0;
  for (const p of run.providers) {
    for (const probe of p.probes) {
      if (probe.brandInQuery === true) continue;
      measured++;
      if (probe.cited) cited++;
      if (probe.brandMentioned) mentioned++;
    }
  }
  return { mentioned, cited, measured };
}
