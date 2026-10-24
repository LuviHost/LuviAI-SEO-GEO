/**
 * "Alıntılanan dış kaynaklar" panel yardımcıları — tür adları sunucunun tür
 * listesiyle aynı, boş durum ayrımı, kapsam notu.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SOURCE_TYPE_LABELS, SOURCE_TYPE_ORDER, citedSourcesState, coverageNote, filterDomains, formatDay, shortUrl, typeChips,
  type CitedSourcesResponse, type CitedDomainRow, type SourceType,
} from './cited-sources';

type ByType = Record<SourceType, { domains: number; answers: number }>;
const emptyByType = (): ByType => Object.fromEntries(SOURCE_TYPE_ORDER.map((t) => [t, { domains: 0, answers: 0 }])) as ByType;

const coverage = (p: Partial<CitedSourcesResponse['coverage']> = {}): CitedSourcesResponse['coverage'] => ({
  answers: 10, brandedAnswers: 0, answersWithSources: 6, answersSearchedNoCitation: 1, answersWithoutSearch: 2, legacyAnswers: 1,
  snapshots: { total: 4, withSourcesVersion: 3, legacy: 1 }, promptRuns: { total: 0, withSourcesVersion: 0, legacy: 0 },
  firstRecordedAt: '2026-10-24', ...p,
});

const row = (domain: string, type: CitedDomainRow['type']): CitedDomainRow => ({
  domain, type, answers: 1, providers: ['openai'], topQueries: [], exampleUrls: [], firstSeen: '2026-10-24', lastSeen: '2026-10-24',
});

const resp = (p: Partial<CitedSourcesResponse> = {}): CitedSourcesResponse => ({
  days: 30, coverage: coverage(),
  totals: { domains: 0, citations: 0, answersCitingOwn: 0, answersCitingOthersOnly: 0, ownShare: null, byType: emptyByType() },
  domains: [], truncated: false, placements: [], placementMinAnswers: 2, legacyMentionedDomains: null, ...p,
});

describe('tür listesi sunucuyla aynı', () => {
  it('api SOURCE_TYPES sırası ve her türün Türkçe adı', () => {
    const api = readFileSync(new URL('../../../api/src/audit/source-domain-types.ts', import.meta.url), 'utf8');
    const m = api.match(/export const SOURCE_TYPES = \[([\s\S]*?)\] as const/);
    expect(m).toBeTruthy();
    const serverTypes = [...m![1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    expect([...SOURCE_TYPE_ORDER]).toEqual(serverTypes);
    for (const t of SOURCE_TYPE_ORDER) expect(SOURCE_TYPE_LABELS[t]).toBeTruthy();
  });
});

describe('citedSourcesState', () => {
  it('ölçüm yok / kayıt yok / alıntı yok / dolu', () => {
    expect(citedSourcesState(null)).toBe('no_measurement');
    expect(citedSourcesState(resp({ coverage: coverage({ answers: 0, firstRecordedAt: null }) }))).toBe('no_measurement');
    expect(citedSourcesState(resp({ coverage: coverage({ firstRecordedAt: null }) }))).toBe('no_records');
    expect(citedSourcesState(resp())).toBe('no_citations');
    expect(citedSourcesState(resp({ domains: [row('reddit.com', 'forum')] }))).toBe('ok');
  });
});

describe('coverageNote', () => {
  it('penceredeki ilk kayıt tarihle; eski, aramasız, kaynaksız, markalı cevaplar ve tavan', () => {
    const n = coverageNote(coverage({ brandedAnswers: 3 }), { promptRunsTruncated: true })!;
    expect(n).toContain('Bu dönemde kaynak kaydı olan ilk ölçüm 24 Ekim 2026 tarihli');
    expect(n).toContain('1 cevap kaynak kaydı tutulmaya başlamadan önce');
    expect(n).toContain('marka adın geçen 3 cevap sayılmadı');
    expect(n).toContain('en yeni 10.000');
    expect(n).toContain('2 cevap web araması yapmayan');
    expect(n).toContain('1 cevapta arama yapıldı ama kaynak gösterilmedi');
  });
  it('sıfır olan kalemler yazılmaz; kayıt yoksa not yok', () => {
    expect(coverageNote(coverage({ legacyAnswers: 0, answersWithoutSearch: 0, answersSearchedNoCitation: 0 }))).toBe('Bu dönemde kaynak kaydı olan ilk ölçüm 24 Ekim 2026 tarihli.');
    expect(coverageNote(coverage({ firstRecordedAt: null }))).toBeNull();
    expect(coverageNote(null)).toBeNull();
  });
});

describe('filtre ve çipler', () => {
  const rows = [row('ornek.com', 'own'), row('reddit.com', 'forum'), row('g2.com', 'review'), row('x.com', 'forum')];
  it('tek tür ya da tümü', () => {
    expect(filterDomains(rows, 'all')).toHaveLength(4);
    expect(filterDomains(rows, 'forum').map((r) => r.domain)).toEqual(['reddit.com', 'x.com']);
    expect(filterDomains(rows, 'news')).toEqual([]);
  });
  it('yalnız alanı olan türler, sabit sırada ve sayıyla', () => {
    const byType = emptyByType();
    byType.review = { domains: 1, answers: 3 };
    byType.own = { domains: 1, answers: 1 };
    byType.forum = { domains: 2, answers: 4 };
    expect(typeChips(byType)).toEqual([
      { type: 'own', label: 'Kendi siten', count: 1 },
      { type: 'forum', label: 'Forum', count: 2 },
      { type: 'review', label: 'İnceleme sitesi', count: 1 },
    ]);
    expect(typeChips(null)).toEqual([]);
  });
});

describe('biçim', () => {
  it('formatDay ve shortUrl', () => {
    expect(formatDay('2026-10-24')).toBe('24 Ekim 2026');
    expect(formatDay(null)).toBe('—');
    expect(shortUrl('https://reddit.com/r/SEO/')).toBe('reddit.com/r/SEO');
    expect(shortUrl('https://tr.wikipedia.org/wiki/Arama_motoru_optimizasyonu', 20)).toBe('tr.wikipedia.org/wi…');
    expect(shortUrl('https://ornek.com/%C3%A7ay')).toBe('ornek.com/çay');
  });
});
