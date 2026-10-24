import type { CitationSource } from './citation-sources.js';
import { classifySource, SOURCE_TYPES, type SourceType, type SourceTypeContext } from './source-domain-types.js';

/**
 * "Alintilanan dis kaynaklar" raporu — saf toplama (GEO Faz 3).
 *
 * GIRDI: tek tek AI CEVAPLARI (AiCitationSnapshot.probes[] satirlari ve
 * GeoPromptRun satirlari; I/O cited-sources.service.ts'te). Her cevap bir
 * kez sayilir: ayni cevap ayni alandan 5 URL alintilasa da o alan icin 1 cevap.
 *
 * KAYNAK KAYDI DURUMLARI (citation-sources.ts SOURCES_VERSION notu):
 *   - sourcesVersion YOK                → eski satir; kaynaklar hic yakalanmadi
 *   - sourcesVersion VAR + sources YOK  → saglayici aramasiz (Grok/DeepSeek/Llama)
 *   - sourcesVersion VAR + sources []   → arama yapildi, alinti yok
 * MARKALI SORULAR (brandInQuery) toplamaya HIC girmez — sorunun kendisinde marka
 * gecince asistanin markanin sitesini kaynak gostermesi neredeyse totolojik;
 * ayni sayfadaki alinti skoru da yalniz markasiz cevaplardan hesaplanir
 * (citation-score.ts unbrandedOnly). Sayilari coverage.brandedAnswers'ta.
 * Ana tablo YALNIZ kaynak kaydi olan cevaplardan kurulur. Eski satirlarin
 * `mentionedDomains` alani (cevap METNINDE gecen alan adlari, Reddit/YouTube/
 * Wikipedia gurultu filtresiyle) ayri `legacyMentionedDomains` ozetine gider;
 * ana tabloya ASLA karismaz — farkli sey olcer (alinti degil, metinde gecis).
 */

export const CITED_SOURCES_DAYS = [30, 90] as const;
export const MAX_DOMAINS = 100;
export const MAX_TOP_QUERIES = 5;
export const MAX_EXAMPLE_URLS = 3;
export const MAX_PLACEMENTS = 10;
/** "Nerede yer almalisin" icin en az kac cevapta alintilanmis olmali */
export const PLACEMENT_MIN_ANSWERS = 2;
export const MAX_LEGACY_DOMAINS = 20;

export const LEGACY_NOTE =
  'Cevap metninde geçen alan adları (eski ölçümler, Reddit/YouTube/Wikipedia hariç). Alıntı listesi değildir; kaynak kaydı başlamadan önceki ölçümlerden.';

export interface AnswerRecord {
  origin: 'snapshot' | 'prompt';
  provider: string;
  query: string;
  /** YYYY-MM-DD */
  date: string;
  sourcesVersion?: number | null;
  sources?: CitationSource[] | null;
  /** Yalniz eski snapshot probe'larinda anlamli */
  mentionedDomains?: string[] | null;
  /** Soruda marka geciyor mu — true ise toplamaya girmez (unbrandedOnly) */
  brandInQuery?: boolean;
}

export interface CitedDomainRow {
  domain: string;
  type: SourceType;
  /** Bu alandan en az bir kaynak alintilayan cevap sayisi */
  answers: number;
  providers: string[];
  /** En cok gecen sorular (en fazla 5) */
  topQueries: string[];
  /** Ornek adresler (en fazla 3; gercek sayfa varken yalniz-kok adresler atlanir) */
  exampleUrls: Array<{ url: string; title?: string; originOnly?: true }>;
  firstSeen: string;
  lastSeen: string;
}

export interface PlacementRow {
  domain: string;
  type: SourceType;
  answers: number;
  providers: string[];
  topQueries: string[];
  action: string;
}

export interface CitedSourcesCoverage {
  /** Penceredeki olculen MARKASIZ cevaplar (HATA ve markali satirlar haric) */
  answers: number;
  /** Soruda marka gecen ve bu yuzden disarida birakilan cevaplar */
  brandedAnswers: number;
  /** Bunlardan kaynak kaydi olanlar — "kayit var ama hepsi markali" durumunu ayirir */
  brandedWithSourcesVersion: number;
  /** Kaynak kaydi olan ve en az bir kaynak alintilayan */
  answersWithSources: number;
  /** Arama yapildi, alinti yok (sources: []) */
  answersSearchedNoCitation: number;
  /** Saglayici aramasiz — kaynak listesi yok */
  answersWithoutSearch: number;
  /** Kaynak kaydindan once yazilmis cevaplar */
  legacyAnswers: number;
  snapshots: { total: number; withSourcesVersion: number; legacy: number };
  promptRuns: { total: number; withSourcesVersion: number; legacy: number };
  /**
   * PENCEREDEKI kaynak kayitli ilk olcumun gunu (YYYY-MM-DD). Kaydin sitede
   * ilk basladigi gun DEGIL — pencere sonradan basliyorsa pencere icindeki ilk gun.
   */
  firstRecordedAt: string | null;
}

export interface CitedSourcesResult {
  days: number;
  coverage: CitedSourcesCoverage;
  totals: {
    domains: number;
    /** cevap x alan ciftleri */
    citations: number;
    /** Sitenin kendisini alintilayan cevaplar */
    answersCitingOwn: number;
    /** Alinti var ama site yok */
    answersCitingOthersOnly: number;
    /** answersCitingOwn / answersWithSources (0..1); kaynakli cevap yoksa null */
    ownShare: number | null;
    byType: Record<SourceType, { domains: number; answers: number }>;
  };
  domains: CitedDomainRow[];
  /** Tablo MAX_DOMAINS ile kesildiyse true */
  truncated: boolean;
  placements: PlacementRow[];
  /** placements hangi esikle kuruldu (2 = en az iki cevap; 1 = henuz hicbiri iki cevaba ulasmadi) */
  placementMinAnswers: number;
  legacyMentionedDomains: null | {
    note: string;
    answers: number;
    domains: Array<{ domain: string; answers: number }>;
  };
}

/**
 * Ture gore "orada nasil yer alirsin" eylemi. Dogrulayamadigimiz iddia yok:
 * markanin o sitede zaten olup olmadigini bilmiyoruz — "kontrol et" diye yazilir.
 */
export const PLACEMENT_ACTIONS: Readonly<Record<SourceType, string>> = {
  review: 'Bu sitede profilin olup olmadığını kontrol et; yoksa profil aç, varsa bilgilerini güncelle ve müşterilerinden yorum iste.',
  forum: 'Bu sorularla ilgili başlıkları kontrol et; uygun başlıkta kim olduğunu açıkça belirterek bağlantınla birlikte faydalı bir yanıt ver.',
  social: 'Marka hesabını kontrol et; profilini güncel tut ve bu sorularla ilgili konularda paylaşım yap.',
  news: 'Bu yayının konuyla ilgili haberlerini kontrol et; basın bülteni ya da haber önerisi gönder.',
  encyclopedia: 'Yalnız bağımsız kaynaklarla desteklenen, tarafsız bilgi eklenebilir. Kendi markan hakkında doğrudan düzenleme yapma; ilgili maddenin tartışma sayfasında kaynak öner.',
  video: 'Bu sorularla ilgili videoları kontrol et; konuyu anlatan bir video yayınla, başlıkta ve açıklamada soruyu karşıla.',
  marketplace: 'Mağaza ya da ürün sayfanı kontrol et; açıklama, görseller ve yorumların güncel olsun.',
  docs: 'Resmî dokümantasyona eklenemezsin; kendi sitende aynı konuyu bu belgeye atıf vererek anlatan bir rehber yayınla.',
  other: 'Alıntılanan sayfayı kontrol et; liste ya da karşılaştırma yazısıysa yazara ulaşıp listeye eklenmeyi öner.',
  own: '',
  competitor: '',
};

function emptyByType(): Record<SourceType, { domains: number; answers: number }> {
  return Object.fromEntries(SOURCE_TYPES.map((t) => [t, { domains: 0, answers: 0 }])) as Record<
    SourceType,
    { domains: number; answers: number }
  >;
}

interface DomainAcc {
  domain: string;
  type: SourceType;
  answers: number;
  providers: Set<string>;
  queries: Map<string, number>;
  urls: Map<string, { url: string; title?: string; originOnly?: true }>;
  firstSeen: string;
  lastSeen: string;
}

const hasVersion = (a: AnswerRecord) => typeof a.sourcesVersion === 'number' && a.sourcesVersion >= 1;

function topQueries(m: Map<string, number>, max: number): string[] {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr'))
    .slice(0, max)
    .map(([q]) => q);
}

function exampleUrls(acc: DomainAcc): CitedDomainRow['exampleUrls'] {
  const all = [...acc.urls.values()];
  const real = all.filter((u) => !u.originOnly);
  // Gercek sayfa varken "yalniz kok adres" ornegi tekrar sayilir — atlanir
  const list = real.length > 0 ? real : all.slice(0, 1);
  return list.slice(0, MAX_EXAMPLE_URLS);
}

/** Siralama: cevap sayisi, saglayici cesitliligi, son gorulme, alan adi */
function rank(a: CitedDomainRow, b: CitedDomainRow): number {
  return (
    b.answers - a.answers
    || b.providers.length - a.providers.length
    || b.lastSeen.localeCompare(a.lastSeen)
    || a.domain.localeCompare(b.domain)
  );
}

export interface AggregateInput {
  days: number;
  answers: readonly AnswerRecord[];
  ctx: SourceTypeContext;
  /** Satir duzeyi sayim (cevap degil): kac snapshot / prompt kosumu kaynak damgali */
  rowCounts?: { snapshots: { total: number; withSourcesVersion: number }; promptRuns: { total: number; withSourcesVersion: number } };
}

export function aggregateCitedSources(input: AggregateInput): CitedSourcesResult {
  const { ctx } = input;
  // Markali sorular toplamaya girmez (ust not)
  const answers = input.answers.filter((a) => a.brandInQuery !== true);
  const brandedAnswers = input.answers.length - answers.length;
  const brandedWithSourcesVersion = input.answers.filter((a) => a.brandInQuery === true && hasVersion(a)).length;
  const byDomain = new Map<string, DomainAcc>();
  const legacy = new Map<string, number>();
  let legacyAnswers = 0;
  let answersWithSources = 0;
  let searchedNoCitation = 0;
  let withoutSearch = 0;
  let citingOwn = 0;
  let citations = 0;
  let firstRecordedAt: string | null = null;

  for (const a of answers) {
    if (!hasVersion(a)) {
      legacyAnswers++;
      if (a.origin === 'snapshot' && Array.isArray(a.mentionedDomains)) {
        const seen = new Set<string>();
        for (const d of a.mentionedDomains) {
          const key = typeof d === 'string' ? d.trim().toLowerCase().replace(/^www\./, '') : '';
          if (!key || seen.has(key)) continue;
          seen.add(key);
          legacy.set(key, (legacy.get(key) ?? 0) + 1);
        }
      }
      continue;
    }
    if (!firstRecordedAt || a.date < firstRecordedAt) firstRecordedAt = a.date;
    if (!Array.isArray(a.sources)) {
      withoutSearch++;
      continue;
    }
    // Ayni cevap ayni alani bir kez sayar
    const perAnswer = new Map<string, { type: SourceType; srcs: CitationSource[] }>();
    for (const s of a.sources) {
      if (!s || typeof s !== 'object') continue;
      const cls = classifySource(s.url, ctx, s.domain);
      if (!cls) continue;
      const entry = perAnswer.get(cls.key) ?? { type: cls.type, srcs: [] };
      entry.srcs.push(s);
      perAnswer.set(cls.key, entry);
    }
    if (perAnswer.size === 0) {
      searchedNoCitation++;
      continue;
    }
    answersWithSources++;
    let ownHere = false;
    for (const [key, { type, srcs }] of perAnswer) {
      if (type === 'own') ownHere = true;
      citations++;
      let acc = byDomain.get(key);
      if (!acc) {
        acc = { domain: key, type, answers: 0, providers: new Set(), queries: new Map(), urls: new Map(), firstSeen: a.date, lastSeen: a.date };
        byDomain.set(key, acc);
      }
      acc.answers++;
      acc.providers.add(a.provider);
      if (a.query) acc.queries.set(a.query, (acc.queries.get(a.query) ?? 0) + 1);
      if (a.date < acc.firstSeen) acc.firstSeen = a.date;
      if (a.date > acc.lastSeen) acc.lastSeen = a.date;
      for (const s of srcs) {
        if (typeof s.url !== 'string') continue;
        const prev = acc.urls.get(s.url);
        if (prev) {
          if (!prev.title && s.title) prev.title = s.title;
          continue;
        }
        const u: { url: string; title?: string; originOnly?: true } = { url: s.url };
        if (s.title) u.title = s.title;
        if (s.originOnly) u.originOnly = true;
        acc.urls.set(s.url, u);
      }
    }
    if (ownHere) citingOwn++;
  }

  const rows: CitedDomainRow[] = [...byDomain.values()].map((acc) => ({
    domain: acc.domain,
    type: acc.type,
    answers: acc.answers,
    providers: [...acc.providers].sort(),
    topQueries: topQueries(acc.queries, MAX_TOP_QUERIES),
    exampleUrls: exampleUrls(acc),
    firstSeen: acc.firstSeen,
    lastSeen: acc.lastSeen,
  }));
  rows.sort(rank);

  const byType = emptyByType();
  for (const r of rows) {
    byType[r.type].domains++;
    byType[r.type].answers += r.answers;
  }

  // "Nerede yer almalisin": kendi site ve rakip disi, en az iki cevapta alintilanan
  const candidates = rows.filter((r) => r.type !== 'own' && r.type !== 'competitor');
  let placementMinAnswers = PLACEMENT_MIN_ANSWERS;
  let picked = candidates.filter((r) => r.answers >= PLACEMENT_MIN_ANSWERS);
  if (picked.length === 0 && candidates.length > 0) {
    placementMinAnswers = 1;
    picked = candidates;
  }
  const placements: PlacementRow[] = picked.slice(0, MAX_PLACEMENTS).map((r) => ({
    domain: r.domain,
    type: r.type,
    answers: r.answers,
    providers: r.providers,
    topQueries: r.topQueries.slice(0, 3),
    action: PLACEMENT_ACTIONS[r.type],
  }));

  const legacyDomains = [...legacy.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LEGACY_DOMAINS)
    .map(([domain, n]) => ({ domain, answers: n }));

  const rc = input.rowCounts;
  return {
    days: input.days,
    coverage: {
      answers: answers.length,
      brandedAnswers,
      brandedWithSourcesVersion,
      answersWithSources,
      answersSearchedNoCitation: searchedNoCitation,
      answersWithoutSearch: withoutSearch,
      legacyAnswers,
      snapshots: {
        total: rc?.snapshots.total ?? 0,
        withSourcesVersion: rc?.snapshots.withSourcesVersion ?? 0,
        legacy: (rc?.snapshots.total ?? 0) - (rc?.snapshots.withSourcesVersion ?? 0),
      },
      promptRuns: {
        total: rc?.promptRuns.total ?? 0,
        withSourcesVersion: rc?.promptRuns.withSourcesVersion ?? 0,
        legacy: (rc?.promptRuns.total ?? 0) - (rc?.promptRuns.withSourcesVersion ?? 0),
      },
      firstRecordedAt,
    },
    totals: {
      domains: rows.length,
      citations,
      answersCitingOwn: citingOwn,
      answersCitingOthersOnly: answersWithSources - citingOwn,
      ownShare: answersWithSources > 0 ? citingOwn / answersWithSources : null,
      byType,
    },
    domains: rows.slice(0, MAX_DOMAINS),
    truncated: rows.length > MAX_DOMAINS,
    placements,
    placementMinAnswers,
    legacyMentionedDomains: legacyDomains.length > 0
      ? { note: LEGACY_NOTE, answers: legacyAnswers, domains: legacyDomains }
      : null,
  };
}

/**
 * MCP / sohbet icin kisa ozet — ajan baglamini sisirmesin: en fazla 20 alan,
 * alan basina en fazla 3 adres (yalniz URL), 3 soru; eski metin-alanlari ozeti yok.
 */
export function compactCitedSources(r: CitedSourcesResult, maxDomains = 20) {
  return {
    days: r.days,
    coverage: {
      answers: r.coverage.answers,
      brandedAnswersExcluded: r.coverage.brandedAnswers,
      answersWithSources: r.coverage.answersWithSources,
      answersWithoutSearch: r.coverage.answersWithoutSearch,
      legacyAnswers: r.coverage.legacyAnswers,
      firstRecordedAt: r.coverage.firstRecordedAt,
    },
    totals: {
      domains: r.totals.domains,
      answersCitingOwn: r.totals.answersCitingOwn,
      answersCitingOthersOnly: r.totals.answersCitingOthersOnly,
      ownShare: r.totals.ownShare,
      byType: Object.fromEntries(
        Object.entries(r.totals.byType).filter(([, v]) => v.domains > 0).map(([k, v]) => [k, v.domains]),
      ),
    },
    typeNote: 'type alanı sezgiseldir (kürate listeler); listede olmayan site "other" olur.',
    domains: r.domains.slice(0, maxDomains).map((d) => ({
      domain: d.domain,
      type: d.type,
      answers: d.answers,
      providers: d.providers,
      topQueries: d.topQueries.slice(0, 3),
      urls: d.exampleUrls.slice(0, MAX_EXAMPLE_URLS).map((u) => u.url),
    })),
    placements: r.placements.map((p) => ({ domain: p.domain, type: p.type, answers: p.answers, action: p.action })),
  };
}
