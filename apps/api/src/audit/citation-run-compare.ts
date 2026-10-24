/**
 * Iki AI gorunurluk testinin (AiCitationRun) karsilastirmasi — saf.
 *
 * NEDEN: "Yeniden Test" ayni gun ikinci kez kosuldugunda gunluk snapshot
 * (siteId+date+provider unique) uzerine yaziliyordu — musteri onceki sonucu
 * kaybediyordu ve iki testi yan yana koyamiyordu. Artik her kosum
 * AiCitationRun'a append-only yazilir; bu modul iki kosumu saglayici ve
 * soru bazinda kiyaslar. Gunluk snapshot (grafik) degismedi: gunun SON
 * kosumunu tutar.
 *
 * HATA SATIRLARI: saglayici hatasi ('HATA:' onekli probe) olcum degildir —
 * kural citation-score.ts isErrorProbe'da tek yerde. Kiyasin HER bolumu
 * (cift degisimi, soru bazli ozet, anilma/atif sayaclari) bu satirlari
 * paydadan cikarir; biri unutursa hata "gorunmedi" gibi okunur ve rapor
 * sahte dusus gosterir.
 *
 * AYNI KAPSAM: her fark yalniz IKI kosumda da olculen saglayici / soru×saglayici
 * cifti uzerinden hesaplanir. Eskiden manset, soru ozeti ve sayaclar her
 * kosumu KENDI olculen saglayicilariyla ortaliyordu: A'da Claude 100 + bes
 * asistan 0, B'de yalniz Claude 429 aldiginda hicbir sey degismedigi halde
 * rapor "17 → 0 −17", her soruda −17 ve "Anilma 3 → 0" diyordu (ayni raporda
 * "kazanilan 0 / kaybedilen 0" yazarken). citation-headline.ts buildHeadline
 * de deltayi saglayici bazinda kurar; ayni kural.
 *
 * YONTEM: iki kosumun matchVersion'i farkliysa (host-match.ts) hicbir fark
 * hesaplanmaz — fark sitenin degil olcunun degisimi olurdu (versionedHeadline
 * ile ayni kural). Degerler gosterilir, farklar null/0 ve methodChanged=true.
 */
import { isErrorProbe } from './citation-score.js';
import type { CitationSource } from './citation-sources.js';

export interface RunProbe {
  query: string;
  cited: boolean;
  brandMentioned: boolean;
  brandInQuery?: boolean;
  position?: number | null;
  sentiment?: string | null;
  excerpt?: string | null;
  citedPages?: string[];
  /** Alintilanan dis kaynaklar (citation-sources.ts); yoksa saglayici aramasiz ya da eski kosum */
  sources?: CitationSource[];
  /** Kaynak kaydi surumu; yoksa kosum kaynaklar yakalanmadan once yazildi */
  sourcesVersion?: number;
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
  /** Alinti eslestirme yontemi surumu (host-match.ts); yoksa 1 */
  matchVersion?: number | null;
}

export type QueryOutcome = 'cited' | 'mentioned' | 'none' | 'n/a';

export interface QueryDiff {
  provider: string;
  query: string;
  before: QueryOutcome;
  after: QueryOutcome;
  /** +1 iyilesti, -1 kotulesti, 0 ayni / kiyaslanamaz (bir tarafta yok ya da yontem degisti) */
  direction: 1 | -1 | 0;
}

/** Soru bazli ozet: bir sorunun saglayicilardaki durumu (rapor "soru bazli detay" bolumu) */
export interface QueryRollup {
  query: string;
  /**
   * 0-100: atif 2, anilma 1 puan / (2 × saglayici). Soru iki kosumda da en az
   * bir ORTAK saglayicida olculduyse iki taraf da YALNIZ bu ortak saglayicilardan
   * puanlanir (ayni saglayicilarla kiyas). Ortak saglayici yoksa her kosum kendi
   * olcen saglayicilariyla gosterilir ve fark hesaplanmaz (comparable=false).
   * O kosumda soru hic olculmediyse 0 — ayirt etmek icin beforeMeasured.
   */
  before: number;
  after: number;
  /** after - before; kiyaslanamiyorsa (comparable=false) 0 — kazanc/kayip degil */
  delta: number;
  /** Onceki kosumda bu soru en az bir saglayicida olculdu mu (HATA olmayan cevap) */
  beforeMeasured: boolean;
  /** Sonraki kosumda bu soru en az bir saglayicida olculdu mu */
  afterMeasured: boolean;
  /**
   * Fark ayni saglayicilar ve ayni yontemle mi hesaplandi. false: ortak
   * saglayici yok ya da yontem degisti — delta anlamsizdir (0). Alani
   * tasimayan eski cikti kiyaslanabilir sayilir.
   */
  comparable?: boolean;
  /** Sonraki kosumda bu soruda gorunen (anan/atif veren) saglayicilar */
  providers: string[];
}

/** Anilma / atif sayaclari — "mention & atif degisimi" bolumu */
export interface MentionCounts {
  /** Cevapta marka adi gecti */
  mentioned: number;
  /** Cevap alan adini kaynak/link olarak verdi */
  cited: number;
  /** Atif var ama marka adi anilmadi (cited && !brandMentioned) */
  citedNotMentioned?: number;
  /** Sayilan (markasiz, iki kosumda da hatasiz olculen) soru×saglayici cifti — payda */
  measured: number;
}

/** Manset farkinin dayanagi — iki kosumda da sayisal skor donen saglayicilar */
export interface HeadlineBasis {
  providers: string[];
  /** Bu saglayicilarin A'daki skor ortalamasi; ortak saglayici yoksa null */
  before: number | null;
  /** Bu saglayicilarin B'deki skor ortalamasi */
  after: number | null;
  /** a.headlineScore'un ortalamaya kattigi (sayisal skorlu) saglayici sayisi */
  aProviders: number;
  /** b.headlineScore'un ortalamaya kattigi saglayici sayisi */
  bProviders: number;
}

export interface RunComparison {
  a: { id: string; runAt: string; headlineScore: number | null; trigger?: string };
  b: { id: string; runAt: string; headlineScore: number | null; trigger?: string };
  /**
   * headlineBasis.after - headlineBasis.before: YALNIZ iki kosumda da olculen
   * saglayicilar uzerinden. Ortak saglayici yoksa ya da yontem degistiyse null.
   */
  headlineDelta: number | null;
  /** Manset farkinin hangi saglayicilardan hesaplandigi (yeni alan; eski ciktida yok) */
  headlineBasis?: HeadlineBasis;
  /** delta: iki kosumda da sayisal skor varsa ve yontem ayniysa after-before, yoksa null */
  providers: Array<{ provider: string; label?: string; before: number | null; after: number | null; delta: number | null }>;
  /** Yalniz DEGISEN soru/saglayici ciftleri (markasiz) */
  changed: QueryDiff[];
  /** Yontem degistiyse 0: cift farki yontemden olabilir */
  gained: number;
  lost: number;
  unchanged: number;
  /**
   * Yalniz bir kosumda olculen soru/saglayici ciftleri. Eskiden 'n/a' → 'none'
   * "kazanc", 'none' → 'n/a' "kayip" sayiliyordu: prompt eklemek/silmek
   * gorunurluk degisimi gibi gorunuyordu.
   */
  added: number;
  removed: number;
  /** Iki kosumun alinti olcum yontemi farkli — farklar hesaplanmadi */
  methodChanged: boolean;
  /** Iki kosumun olcum yontemi surumleri (host-match.ts CITATION_MATCH_VERSION); yoksa 1 */
  matchVersions?: { a: number; b: number };
  /** Soru bazli ozet (degisen + degismeyen hepsi) — rapor icin */
  queries: QueryRollup[];
  /** Anilma/atif sayaclari: once ve sonra, AYNI cift kumesi uzerinden */
  mentions: { before: MentionCounts; after: MentionCounts };
  /** Iki kosum arasindaki gun farki (rapor basligi: "25 gün ara") */
  daysBetween: number;
}

const RANK: Record<QueryOutcome, number> = { 'n/a': -1, none: 0, mentioned: 1, cited: 2 };

export function outcomeOf(p: RunProbe | undefined): QueryOutcome {
  if (!p) return 'n/a';
  // Saglayici hatasi olcum degildir — "gorunmedi" (none) sayilirsa hata kayip gibi okunur
  if (isErrorProbe(p)) return 'n/a';
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

const sorguAnahtari = (q: string) => q.trim().toLowerCase();

/**
 * Saglayicinin markasiz probe'lari, soru anahtarina gore. Ayni soru iki kez
 * gelirse ilki tutulur (eski soru ozetindeki .find ile ayni).
 */
function probeHaritasi(p: RunProvider | undefined): Map<string, RunProbe> {
  const m = new Map<string, RunProbe>();
  for (const probe of p?.probes ?? []) {
    if (probe.brandInQuery === true) continue;
    const k = sorguAnahtari(probe.query);
    if (!m.has(k)) m.set(k, probe);
  }
  return m;
}

function ortalama(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function compareCitationRuns(a: RunSummary, b: RunSummary): RunComparison {
  const matchVersions = { a: a.matchVersion ?? 1, b: b.matchVersion ?? 1 };
  const methodChanged = matchVersions.a !== matchVersions.b;

  const providerNames = [...new Set([...a.providers.map((p) => p.provider), ...b.providers.map((p) => p.provider)])];
  const skor = (p: RunProvider | undefined) => (typeof p?.score === 'number' && Number.isFinite(p.score) ? p.score : null);
  const providers = providerNames.map((name) => {
    const pa = a.providers.find((p) => p.provider === name);
    const pb = b.providers.find((p) => p.provider === name);
    const before = skor(pa);
    const after = skor(pb);
    const delta = !methodChanged && before !== null && after !== null ? after - before : null;
    return { provider: name, label: pb?.label ?? pa?.label, before, after, delta };
  });

  // Manset farki: yalniz iki kosumda da sayisal skoru olan saglayicilar.
  // Iki tarafin ortalamasi AYNI kume uzerinden alinir; fark = sonra - once
  // (rapordaki "once → sonra fark" aritmetigi tutarli kalir).
  const ortak = providers.filter((p) => p.before !== null && p.after !== null);
  const headlineBasis: HeadlineBasis = {
    providers: ortak.map((p) => p.provider),
    before: ortalama(ortak.map((p) => p.before as number)),
    after: ortalama(ortak.map((p) => p.after as number)),
    aProviders: a.providers.filter((p) => skor(p) !== null).length,
    bProviders: b.providers.filter((p) => skor(p) !== null).length,
  };
  const headlineDelta =
    !methodChanged && headlineBasis.before !== null && headlineBasis.after !== null
      ? headlineBasis.after - headlineBasis.before
      : null;

  const changed: QueryDiff[] = [];
  let gained = 0, lost = 0, unchanged = 0, added = 0, removed = 0;
  for (const name of providerNames) {
    const qa = probeHaritasi(a.providers.find((p) => p.provider === name));
    const qb = probeHaritasi(b.providers.find((p) => p.provider === name));
    const queries = [...new Set([...qa.keys(), ...qb.keys()])];
    for (const q of queries) {
      const before = outcomeOf(qa.get(q));
      const after = outcomeOf(qb.get(q));
      if (before === after) { unchanged++; continue; }
      // Bir tarafta olculmeyen cift kiyaslanamaz: kazanc/kayip DEGIL
      if (before === 'n/a' || after === 'n/a') {
        if (before === 'n/a') added++; else removed++;
        changed.push({ provider: name, query: (qb.get(q) ?? qa.get(q))!.query, before, after, direction: 0 });
        continue;
      }
      // Yontem degistiyse cift farki yontemden olabilir (v4: jenerik markada
      // yalin kelime artik anilma degil) — degisim listelenir, sayilmaz.
      const direction: 1 | -1 | 0 = methodChanged
        ? 0
        : RANK[after] > RANK[before] ? 1 : RANK[after] < RANK[before] ? -1 : 0;
      if (direction === 1) gained++; else if (direction === -1) lost++;
      changed.push({ provider: name, query: (qb.get(q) ?? qa.get(q))!.query, before, after, direction });
    }
  }

  return {
    a: { id: a.id, runAt: a.runAt, headlineScore: a.headlineScore, trigger: a.trigger },
    b: { id: b.id, runAt: b.runAt, headlineScore: b.headlineScore, trigger: b.trigger },
    headlineDelta,
    headlineBasis,
    providers,
    changed: changed.sort((x, y) => y.direction - x.direction || x.provider.localeCompare(y.provider)),
    gained,
    lost,
    unchanged,
    added,
    removed,
    methodChanged,
    matchVersions,
    queries: soruOzeti(a, b, methodChanged),
    mentions: anilmaSayaci(a, b),
    daysBetween: Math.max(0, Math.round((new Date(b.runAt).getTime() - new Date(a.runAt).getTime()) / 86_400_000)),
  };
}

/** Soru puani: atif 2, anilma 1 puan / (2 × sonuc sayisi) × 100 */
function soruPuani(sonuclar: QueryOutcome[]): number {
  if (sonuclar.length === 0) return 0;
  const toplam = sonuclar.reduce((s, o) => s + (o === 'cited' ? 2 : o === 'mentioned' ? 1 : 0), 0);
  return Math.round((toplam / (2 * sonuclar.length)) * 100);
}

/**
 * Soru bazli ozet: bir soru saglayicilarda nasil gidiyor.
 * NEDEN markali sorular disarida: sorunun icinde marka gecince anilmak totolojik (brand-in-query.ts).
 * NEDEN ortak saglayicilar: bir saglayici B'de 429 aldiginda soru puani
 * "o saglayici artik anmiyor" diye dusmesin (bkz. dosya basi, AYNI KAPSAM).
 */
function soruOzeti(a: RunSummary, b: RunSummary, methodChanged: boolean): QueryRollup[] {
  /** saglayici → (soru → sonuc); HATA satiri 'n/a' oldugu icin olculmus sayilmaz */
  const haritalar = (run: RunSummary) =>
    run.providers.map((p) => ({ provider: p.provider, label: p.label ?? p.provider, probes: probeHaritasi(p) }));
  const ha = haritalar(a);
  const hb = haritalar(b);

  // Soru metni: son yazilan kazanir (B, A'dan sonra gezilir → guncel metin)
  const sorular = new Map<string, string>();
  for (const run of [a, b]) {
    for (const p of run.providers) {
      for (const probe of p.probes ?? []) {
        if (probe.brandInQuery === true) continue;
        sorular.set(sorguAnahtari(probe.query), probe.query);
      }
    }
  }

  const olculen = (h: typeof ha, k: string) => {
    const m = new Map<string, QueryOutcome>();
    for (const p of h) {
      const o = outcomeOf(p.probes.get(k));
      if (o !== 'n/a') m.set(p.provider, o);
    }
    return m;
  };

  return [...sorular.entries()]
    .map(([k, metin]): QueryRollup => {
      const once = olculen(ha, k);
      const sonra = olculen(hb, k);
      const ortak = [...once.keys()].filter((p) => sonra.has(p));
      const kiyaslanir = ortak.length > 0 && !methodChanged;
      // Ortak saglayici varsa iki taraf da onlarla puanlanir; yoksa (ya da
      // yontem degistiyse) her kosum kendi olcen saglayicilariyla gosterilir.
      const before = ortak.length > 0 ? soruPuani(ortak.map((p) => once.get(p)!)) : soruPuani([...once.values()]);
      const after = ortak.length > 0 ? soruPuani(ortak.map((p) => sonra.get(p)!)) : soruPuani([...sonra.values()]);
      const anan = hb
        .filter((p) => {
          const o = sonra.get(p.provider);
          return o === 'cited' || o === 'mentioned';
        })
        .map((p) => p.label);
      return {
        query: metin,
        before,
        after,
        delta: kiyaslanir ? after - before : 0,
        beforeMeasured: once.size > 0,
        afterMeasured: sonra.size > 0,
        comparable: kiyaslanir,
        providers: anan,
      };
    })
    .sort((x, y) => y.delta - x.delta || y.after - x.after);
}

/**
 * Anilma/atif sayilari — YALNIZ iki kosumda da hatasiz olculen (markasiz)
 * soru×saglayici ciftleri. Eskiden her kosum kendi probe'larini sayiyordu:
 * B'de 429 alan saglayicinin anilmalari "kayboldu" gibi gorunuyordu.
 */
function anilmaSayaci(a: RunSummary, b: RunSummary): { before: MentionCounts; after: MentionCounts } {
  const bos = (): Required<MentionCounts> => ({ mentioned: 0, cited: 0, citedNotMentioned: 0, measured: 0 });
  const before = bos();
  const after = bos();
  const ekle = (c: Required<MentionCounts>, p: RunProbe) => {
    c.measured++;
    if (p.cited) c.cited++;
    if (p.brandMentioned) c.mentioned++;
    if (p.cited && !p.brandMentioned) c.citedNotMentioned++;
  };
  const adlar = [...new Set([...a.providers.map((p) => p.provider), ...b.providers.map((p) => p.provider)])];
  for (const name of adlar) {
    const qa = probeHaritasi(a.providers.find((p) => p.provider === name));
    const qb = probeHaritasi(b.providers.find((p) => p.provider === name));
    for (const [q, pa] of qa) {
      const pb = qb.get(q);
      // "Olculen" paydasi yalniz gercek cevaplar: HATA satiri sayilirsa ayni
      // gorunurluk, hata alan kosumda daha dusuk oranli gorunur.
      if (!pb || isErrorProbe(pa) || isErrorProbe(pb)) continue;
      ekle(before, pa);
      ekle(after, pb);
    }
  }
  return { before, after };
}
