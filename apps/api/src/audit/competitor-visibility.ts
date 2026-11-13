/**
 * AI cevaplarinda rakip gorunurlugu — saf toplama (I/O: competitor-visibility.service.ts).
 *
 * NEDEN VAR (13.11.2026, ICM Turkey gorusmesi): musteri "AI'larda hangi rakiplerimiz gecti,
 * hangileri on planda" diye sordu. Veri zaten vardi ama daginikti: soru ayrintisinda cevap
 * basina "andigi rakipler", Genel Bakis'ta tek bir pay yuzdesi; Urun Radari ise musterinin
 * kendi sorulariyla degil sistemin urettigi uc kategori sorusuyla calisir (yalniz Kurumsal).
 * Bu modul musterinin KENDI Prompt Lab sorularinin SON olcumunu tek tabloda toplar.
 *
 * KAYNAK: GeoPromptRun satirlari (ana soru, markasiz). Yeni olcum YOK, ek maliyet YOK.
 *
 * IKI AYRI SINYAL — karistirilmaz:
 *  - "adi gecti": cevap metninde marka / rakip adi. Rakip icin olcum ANINDAKI listeden
 *    bulunur (GeoPromptRun.competitors). Listeye SONRADAN eklenen rakip gecmis olcumlerde
 *    sayilamaz: cevabin yalniz ilk ~220 karakteri saklanir (ai-citation.service buildProbe),
 *    o parcada aramak "gecmedi" yalanini uretirdi. Bu yuzden gecmise donuk yeniden esleme YOK.
 *  - "sitesi kaynak gosterildi": cevabin alintiladigi adresler (GeoPromptRun.sources). Liste
 *    gerekmez; rakibin adresi tanimliysa gecmis olcumlerde de sayilir.
 *
 * GUNCEL KUME: her (soru, asistan) cifti icin penceredeki EN YENI cevap. Onceki olcum:
 * ayni ciftin daha eski bir GUNE ait bir onceki cevabi. Degisim yalniz ikisi de olan
 * ciftlerde hesaplanir (karsilastirilabilir cevap) — yeni eklenen soru "artis" sayilmaz.
 */
import { foldForMatch } from '../common/text-normalize.js';
import { hostOf, hostWithin, isPlatformHost } from './source-domain-types.js';

export const COMPETITOR_VISIBILITY_DAYS = [30, 90] as const;
/** Onceki olcum bu kadar gun geriye kadar aranir (pencereden bagimsiz) */
export const PREVIOUS_LOOKBACK_DAYS = 180;
export const MAX_SUGGESTIONS = 8;
/** Oneri icin en az bu kadar cevapta kaynak gosterilmis olmali (tek cevap gurultu) */
export const SUGGESTION_MIN_ANSWERS = 2;

export interface VisibilityRun {
  promptId: string;
  promptText: string;
  provider: string;
  /** YYYY-MM-DD */
  date: string;
  /** Ayni gun icinde siralama icin (ms); yoksa 0 */
  createdAt?: number;
  brandMentioned: boolean;
  cited: boolean;
  /** Olcum anindaki rakip listesinden cevapta bulunan adlar */
  competitors: string[];
  /** Cevabin alintiladigi alan adlari (www'siz host) */
  sourceHosts: string[];
}

export interface ListedCompetitor {
  name: string;
  url?: string | null;
}

export interface VisibilityChange {
  /** Karsilastirilabilir (soru, asistan) cifti sayisi */
  pairs: number;
  /** O ciftlerde onceki olcumde kac cevapta gecti */
  before: number;
  /** O ciftlerde son olcumde kac cevapta geciyor */
  now: number;
}

export interface VisibilityRow {
  name: string;
  isBrand: boolean;
  /** Bugun rakip listesinde tanimli mi (marka icin true) */
  listed: boolean;
  /** Adinin gectigi cevap sayisi (guncel kume) */
  answers: number;
  /** Adinin gectigi farkli soru sayisi */
  questions: number;
  /** Adini anan asistanlar */
  providers: string[];
  /** Sitesinin kaynak gosterildigi cevap sayisi; adres tanimli degilse null */
  citedAnswers: number | null;
  change: VisibilityChange | null;
  /** Adinin gectigi sorular (cevap sayisina gore azalan) */
  byQuestion: Array<{ promptId: string; text: string; providers: string[] }>;
}

export interface VisibilitySuggestion {
  domain: string;
  answers: number;
  questions: number;
  providers: string[];
}

export interface VisibilityResult {
  days: number;
  totals: {
    /** Guncel kumedeki cevap sayisi */
    answers: number;
    questions: number;
    providers: string[];
    /** Guncel kumenin en eski ve en yeni olcum gunu (YYYY-MM-DD) */
    firstMeasuredAt: string | null;
    lastMeasuredAt: string | null;
    /** Onceki olcumu de olan (soru, asistan) cifti sayisi */
    comparablePairs: number;
  };
  /** Marka + rakipler; cevap sayisina gore azalan */
  rows: VisibilityRow[];
  /** Rakip listesinde olmayan ama sik kaynak gosterilen siteler */
  suggestions: VisibilitySuggestion[];
}

export function competitorVisibilityDays(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return (COMPETITOR_VISIBILITY_DAYS as readonly number[]).includes(n) ? n : 30;
}

const key = (name: string) => foldForMatch(name).trim();
const pairKey = (r: Pick<VisibilityRun, 'promptId' | 'provider'>) => `${r.promptId}\u0000${r.provider}`;
const newerFirst = (a: VisibilityRun, b: VisibilityRun) =>
  a.date === b.date ? (b.createdAt ?? 0) - (a.createdAt ?? 0) : a.date < b.date ? 1 : -1;

interface Entity {
  name: string;
  isBrand: boolean;
  listed: boolean;
  /** Kaynak eslesmesi icin host (platformdaki rakip adresi host'la eslenmez) */
  host: string | null;
  mentioned: (r: VisibilityRun) => boolean;
}

export interface VisibilityInput {
  days: number;
  /** Pencerenin ilk gunu (YYYY-MM-DD, dahil): guncel cevap bu gunden eski olamaz */
  since: string;
  brand: string;
  ownHost: string | null;
  listed: ListedCompetitor[];
  /** PREVIOUS_LOOKBACK_DAYS icindeki satirlar (yalniz ana soru, markasiz, hatasiz) */
  runs: VisibilityRun[];
}

export function aggregateCompetitorVisibility(input: VisibilityInput): VisibilityResult {
  // ── (soru, asistan) cifti basina guncel ve onceki cevap
  const byPair = new Map<string, VisibilityRun[]>();
  for (const r of input.runs) {
    const k = pairKey(r);
    const list = byPair.get(k);
    if (list) list.push(r); else byPair.set(k, [r]);
  }
  const current: VisibilityRun[] = [];
  const previousOf = new Map<string, VisibilityRun>();
  for (const [k, list] of byPair) {
    list.sort(newerFirst);
    const now = list[0];
    if (now.date < input.since) continue; // pencerede olculmemis soru guncel kumeye girmez
    current.push(now);
    const prev = list.find((r) => r.date < now.date);
    if (prev) previousOf.set(k, prev);
  }

  // ── Varliklar: marka + bugunku liste + gecmiste anilmis (listeden cikarilmis) adlar
  const entities = new Map<string, Entity>();
  const brandKey = key(input.brand);
  for (const c of input.listed) {
    const k = key(c.name ?? '');
    if (!k || k === brandKey || entities.has(k)) continue;
    const host = hostOf(c.url ?? null);
    entities.set(k, {
      name: c.name.trim(),
      isBrand: false,
      listed: true,
      host: host && !isPlatformHost(host) && host !== input.ownHost ? host : null,
      mentioned: (r) => r.competitors.some((n) => key(n) === k),
    });
  }
  for (const r of current) {
    for (const n of r.competitors) {
      const k = key(n);
      if (!k || k === brandKey || entities.has(k)) continue;
      entities.set(k, { name: n.trim(), isBrand: false, listed: false, host: null, mentioned: (x) => x.competitors.some((m) => key(m) === k) });
    }
  }
  const brand: Entity = {
    name: input.brand,
    isBrand: true,
    listed: true,
    host: input.ownHost,
    mentioned: (r) => r.brandMentioned,
  };

  const citedBy = (e: Entity, r: VisibilityRun): boolean =>
    e.isBrand ? r.cited : !!e.host && r.sourceHosts.some((h) => hostWithin(h, e.host!));

  const rowFor = (e: Entity): VisibilityRow => {
    const hits = current.filter((r) => e.mentioned(r));
    const questions = new Map<string, { promptId: string; text: string; providers: Set<string> }>();
    for (const r of hits) {
      const q = questions.get(r.promptId) ?? { promptId: r.promptId, text: r.promptText, providers: new Set<string>() };
      q.providers.add(r.provider);
      questions.set(r.promptId, q);
    }
    let pairs = 0, before = 0, now = 0;
    for (const r of current) {
      const prev = previousOf.get(pairKey(r));
      if (!prev) continue;
      pairs++;
      if (e.mentioned(prev)) before++;
      if (e.mentioned(r)) now++;
    }
    return {
      name: e.name,
      isBrand: e.isBrand,
      listed: e.listed,
      answers: hits.length,
      questions: questions.size,
      providers: [...new Set(hits.map((r) => r.provider))].sort(),
      citedAnswers: e.isBrand || e.host ? current.filter((r) => citedBy(e, r)).length : null,
      change: pairs > 0 ? { pairs, before, now } : null,
      byQuestion: [...questions.values()]
        .map((q) => ({ promptId: q.promptId, text: q.text, providers: [...q.providers].sort() }))
        .sort((a, b) => b.providers.length - a.providers.length || a.text.localeCompare(b.text, 'tr')),
    };
  };

  const rows = [brand, ...entities.values()].map(rowFor).sort((a, b) =>
    b.answers - a.answers
    || (b.citedAnswers ?? 0) - (a.citedAnswers ?? 0)
    || Number(b.isBrand) - Number(a.isBrand)
    || a.name.localeCompare(b.name, 'tr'));

  // ── Oneri: listede olmayan, platform olmayan, sik kaynak gosterilen siteler
  const knownHosts = [input.ownHost, ...[...entities.values()].map((e) => e.host)].filter((h): h is string => !!h);
  const tally = new Map<string, { answers: number; questions: Set<string>; providers: Set<string> }>();
  for (const r of current) {
    for (const h of new Set(r.sourceHosts)) {
      if (!h || isPlatformHost(h) || knownHosts.some((k) => hostWithin(h, k))) continue;
      const t = tally.get(h) ?? { answers: 0, questions: new Set<string>(), providers: new Set<string>() };
      t.answers++;
      t.questions.add(r.promptId);
      t.providers.add(r.provider);
      tally.set(h, t);
    }
  }
  const suggestions = [...tally.entries()]
    .filter(([, t]) => t.answers >= SUGGESTION_MIN_ANSWERS)
    .map(([domain, t]) => ({ domain, answers: t.answers, questions: t.questions.size, providers: [...t.providers].sort() }))
    .sort((a, b) => b.answers - a.answers || b.questions - a.questions || a.domain.localeCompare(b.domain))
    .slice(0, MAX_SUGGESTIONS);

  const dates = current.map((r) => r.date).sort();
  return {
    days: input.days,
    totals: {
      answers: current.length,
      questions: new Set(current.map((r) => r.promptId)).size,
      providers: [...new Set(current.map((r) => r.provider))].sort(),
      firstMeasuredAt: dates[0] ?? null,
      lastMeasuredAt: dates[dates.length - 1] ?? null,
      comparablePairs: current.filter((r) => previousOf.has(pairKey(r))).length,
    },
    rows,
    suggestions,
  };
}
