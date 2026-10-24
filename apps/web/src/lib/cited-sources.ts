/**
 * "Alıntılanan dış kaynaklar" raporu — panel tarafı saf yardımcılar
 * (test: cited-sources.spec.mts). Toplama ve tür etiketi SUNUCUDA
 * (api audit/cited-sources.ts, audit/source-domain-types.ts); panel yalnız
 * gösterir. Tür adları burada çünkü yalnız Türkçe görünen metin.
 */

export type SourceType =
  | 'own' | 'competitor' | 'forum' | 'review' | 'social' | 'video' | 'encyclopedia' | 'news' | 'marketplace' | 'docs' | 'other';

export interface CitedDomainRow {
  domain: string;
  type: SourceType;
  answers: number;
  providers: string[];
  topQueries: string[];
  exampleUrls: Array<{ url: string; title?: string; originOnly?: true }>;
  firstSeen: string;
  lastSeen: string;
}

export interface CitedSourcesCoverage {
  /** Markasız ölçülen cevaplar */
  answers: number;
  /** Soruda marka geçtiği için dışarıda bırakılan cevaplar */
  brandedAnswers: number;
  answersWithSources: number;
  answersSearchedNoCitation: number;
  answersWithoutSearch: number;
  legacyAnswers: number;
  snapshots: { total: number; withSourcesVersion: number; legacy: number };
  promptRuns: { total: number; withSourcesVersion: number; legacy: number };
  firstRecordedAt: string | null;
}

export interface CitedSourcesResponse {
  days: number;
  coverage: CitedSourcesCoverage;
  totals: {
    domains: number;
    citations: number;
    answersCitingOwn: number;
    answersCitingOthersOnly: number;
    ownShare: number | null;
    byType: Record<SourceType, { domains: number; answers: number }>;
  };
  domains: CitedDomainRow[];
  truncated: boolean;
  placements: Array<{ domain: string; type: SourceType; answers: number; providers: string[]; topQueries: string[]; action: string }>;
  placementMinAnswers: number;
  legacyMentionedDomains: null | { note: string; answers: number; domains: Array<{ domain: string; answers: number }> };
  promptRunsTruncated?: boolean;
}

/** Filtre çipi ve rozet sırası — sunucudaki SOURCE_TYPES ile aynı */
export const SOURCE_TYPE_ORDER: readonly SourceType[] = [
  'own', 'competitor', 'forum', 'review', 'social', 'video', 'encyclopedia', 'news', 'marketplace', 'docs', 'other',
];

export const SOURCE_TYPE_LABELS: Readonly<Record<SourceType, string>> = {
  own: 'Kendi siten',
  competitor: 'Rakip',
  forum: 'Forum',
  review: 'İnceleme sitesi',
  social: 'Sosyal ağ',
  video: 'Video',
  encyclopedia: 'Ansiklopedi',
  news: 'Haber',
  marketplace: 'Mağaza',
  docs: 'Dokümantasyon',
  other: 'Diğer',
};

/** Rozet tonu — yalnız kendi site ve rakip vurgulu, gerisi nötr */
export const SOURCE_TYPE_BADGE: Readonly<Record<SourceType, 'success' | 'warning' | 'secondary'>> = {
  own: 'success',
  competitor: 'warning',
  forum: 'secondary',
  review: 'secondary',
  social: 'secondary',
  video: 'secondary',
  encyclopedia: 'secondary',
  news: 'secondary',
  marketplace: 'secondary',
  docs: 'secondary',
  other: 'secondary',
};

export const HEURISTIC_NOTE =
  'Tür etiketi sezgiseldir: bilinen sitelerin listesine göre atanır. Listede olmayan siteler “Diğer” görünür; bir haber sitesi ya da forum da olabilir.';

export const PLACEMENT_NOTE =
  'Markanın bu sitelerde zaten yer alıp almadığını bilmiyoruz; her öneri bir kontrol adımıyla başlar.';

const dayFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "2026-10-24" → "24 Ekim 2026" */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? dayFmt.format(new Date(t)) : iso;
}

/** Filtre: 'all' ya da tek tür */
export function filterDomains(rows: readonly CitedDomainRow[], type: SourceType | 'all'): CitedDomainRow[] {
  return type === 'all' ? [...rows] : rows.filter((r) => r.type === type);
}

/** Çip listesi: en az bir alanı olan türler, sabit sırada */
export function typeChips(byType: CitedSourcesResponse['totals']['byType'] | null | undefined): Array<{ type: SourceType; label: string; count: number }> {
  if (!byType) return [];
  return SOURCE_TYPE_ORDER.filter((t) => (byType[t]?.domains ?? 0) > 0).map((t) => ({ type: t, label: SOURCE_TYPE_LABELS[t], count: byType[t].domains }));
}

export type CitedSourcesState = 'no_measurement' | 'no_records' | 'no_citations' | 'ok';

/**
 * Boş durum ayrımı:
 *  - no_measurement: pencerede hiç ölçülmüş cevap yok
 *  - no_records: ölçüm var ama hepsi kaynak kaydından önce
 *  - no_citations: kaynak kaydı var ama hiçbir cevap kaynak göstermedi
 */
export function citedSourcesState(r: CitedSourcesResponse | null | undefined): CitedSourcesState {
  if (!r || r.coverage.answers === 0) return 'no_measurement';
  if (!r.coverage.firstRecordedAt) return 'no_records';
  if (r.domains.length === 0) return 'no_citations';
  return 'ok';
}

/**
 * Kapsam notu. firstRecordedAt sunucuda PENCEREDEKİ ilk kaynak kayıtlı ölçümün
 * günüdür (kaydın sitede ilk başladığı gün değil) — metin buna göre yazılır.
 */
export function coverageNote(
  c: CitedSourcesCoverage | null | undefined,
  opts: { promptRunsTruncated?: boolean } = {},
): string | null {
  if (!c || !c.firstRecordedAt) return null;
  const parts = [`Bu dönemde kaynak kaydı olan ilk ölçüm ${formatDay(c.firstRecordedAt)} tarihli.`];
  if (c.legacyAnswers > 0) parts.push(`${c.legacyAnswers} cevap kaynak kaydı tutulmaya başlamadan önce ölçüldü; onların kaynak listesi yok.`);
  if (c.answersWithoutSearch > 0) parts.push(`${c.answersWithoutSearch} cevap web araması yapmayan asistanlardan geldi; bu asistanlar kaynak listesi döndürmez.`);
  if (c.answersSearchedNoCitation > 0) parts.push(`${c.answersSearchedNoCitation} cevapta arama yapıldı ama kaynak gösterilmedi.`);
  if (c.brandedAnswers > 0) parts.push(`Sorusunda marka adın geçen ${c.brandedAnswers} cevap sayılmadı (alıntı skoruyla aynı kural).`);
  if (opts.promptRunsTruncated) parts.push('Soru laboratuvarı ölçümleri çok fazla; en yeni 10.000 ölçüm sayıldı.');
  return parts.join(' ');
}

/** Örnek adresin kısa gösterimi: "reddit.com/r/SEO/…" */
export function shortUrl(url: string, max = 60): string {
  let s = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  try {
    s = decodeURI(s);
  } catch {
    /* bozuk yüzde kodlaması — olduğu gibi */
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
