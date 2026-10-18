/**
 * F19 — mobil görünürlük hesabı web summarize() ile aynı sonucu vermeli; kilitli
 * sorular, marka adı geçen sorular ve ölçülmeyen asistanlar skora girmemeli.
 *
 * Çalıştırma (mobil kendi test koşucusunu taşımaz):
 *   cd mobile && ../apps/api/node_modules/.bin/vitest run --root . src
 */
import { describe, expect, it } from 'vitest';
import type { AnalyzeResult, ProbeResult, ProviderKey, QueryResult } from './api';
import { deriveVisibility, isMeasuredProvider, measuredProviders, queryCounts, scoringQueries } from './visibility';

const SIX: ProviderKey[] = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek'];

function probe(provider: ProviderKey, extra: Partial<ProbeResult> = {}): ProbeResult {
  return { provider, label: provider, cited: false, brandMentioned: false, ...extra };
}

/** Sunucu tutarlı sorgu: citedCount = cited||brandMentioned sayısı, totalProviders = saglayici sayisi */
function query(text: string, providers: ProbeResult[], extra: Partial<QueryResult> = {}): QueryResult {
  return {
    query: text,
    providers,
    citedCount: providers.filter((p) => p.cited || p.brandMentioned).length,
    totalProviders: providers.length,
    locked: false,
    brandInQuery: false,
    ...extra,
  };
}

function locked(text: string, totalProviders = 7): QueryResult {
  return { query: text, providers: [], citedCount: 0, totalProviders, locked: true, brandInQuery: false };
}

function result(queries: QueryResult[]): AnalyzeResult {
  return { domain: 'ornek.com', brand: 'Ornek', queries, competitorRanking: [], totalLlmCalls: 0, fromCache: false };
}

/** apps/web/src/components/landing/checker-overlay.tsx summarize() — birebir kopya */
function webSummarizeScore(r: AnalyzeResult): number {
  const open = r.queries.filter((q) => !q.locked);
  const scored = open.filter((q) => !q.brandInQuery);
  const base = scored.length > 0 ? scored : open;
  const total = base.reduce((s, q) => s + q.totalProviders, 0);
  const cited = base.reduce((s, q) => s + q.citedCount, 0);
  return total > 0 ? Math.round((cited / total) * 100) : 0;
}

/** İnceleme senaryosu: 10 soru — 3 ölçülen (1 markalı) + 7 kilitli; Meta ölçülemedi */
function teaserPayload(meta: 'flagged' | 'omitted' | 'legacy-available'): AnalyzeResult {
  const metaProbe = (): ProbeResult[] =>
    meta === 'omitted' ? [] : meta === 'flagged' ? [probe('meta', { measured: false })] : [probe('meta', { available: false })];
  const q1 = query('Ornek güvenilir mi?', [
    ...SIX.map((p) => probe(p, p === 'openai' ? { cited: true } : p === 'anthropic' ? { brandMentioned: true } : {})),
    ...metaProbe(),
  ], { brandInQuery: true });
  const q2 = query('En iyi ön muhasebe programı hangisi?', [
    ...SIX.map((p) => probe(p, p === 'gemini' ? { cited: true } : p === 'perplexity' ? { brandMentioned: true } : {})),
    ...metaProbe(),
  ]);
  const q3 = query('KOBİ için fatura uygulaması önerir misin?', [...SIX.map((p) => probe(p)), ...metaProbe()]);
  return result([q1, q2, q3, ...Array.from({ length: 7 }, (_, i) => locked(`Kilitli soru ${i + 1}`))]);
}

describe('deriveVisibility — web summarize() ile aynı tanım (F19)', () => {
  it('kilitli ve markalı soruları, ölçülmeyen Meta’yı skora katmaz', () => {
    const v = deriveVisibility(teaserPayload('flagged'));
    // Yalnız q2 + q3 (markasız, kilitsiz) × 6 ölçülen asistan
    expect(v.totalPairs).toBe(12);
    expect(v.shownPairs).toBe(2); // gemini alıntı + perplexity ad
    expect(v.citedPairs).toBe(1);
    expect(v.score).toBe(17);
    expect(v.totalQueries).toBe(2);
    expect(v.answeredQueries).toBe(1);
    expect(v.measuredQueries).toBe(3);
    expect(v.lockedQueries).toBe(7);
    expect(v.brandedQueries).toBe(1);
    expect(v.basis).toBe('unbranded');
    expect(v.engines.map((e) => e.provider)).not.toContain('meta');
    expect(v.engines).toHaveLength(6);
  });

  it('Meta hiç gönderilmese de (yeni sunucu) ya da available:false ile gelse de aynı sonucu verir', () => {
    const flagged = deriveVisibility(teaserPayload('flagged'));
    expect(deriveVisibility(teaserPayload('omitted'))).toEqual(flagged);
    expect(deriveVisibility(teaserPayload('legacy-available'))).toEqual(flagged);
  });

  it('sunucu tutarlıyken (ölçülmeyen asistan gönderilmez) web summarize() ile birebir aynı skoru verir', () => {
    const r = teaserPayload('omitted');
    expect(deriveVisibility(r).score).toBe(webSummarizeScore(r));
  });

  it('eski önbellek kaydında (locked/brandInQuery alanı yok) tüm sorular ölçülmüş sayılır — web ile aynı', () => {
    const legacy: AnalyzeResult = result([
      { query: 'a', providers: SIX.map((p) => probe(p, { cited: p === 'openai' })), citedCount: 1, totalProviders: 6 },
      { query: 'b', providers: SIX.map((p) => probe(p)), citedCount: 0, totalProviders: 6 },
    ]);
    const v = deriveVisibility(legacy);
    expect(v.totalQueries).toBe(2);
    expect(v.lockedQueries).toBe(0);
    expect(v.score).toBe(webSummarizeScore(legacy));
    expect(v.score).toBe(8); // 1/12
  });

  it('ölçülen soruların hepsi markalıysa (yedek) hepsi kullanılır', () => {
    const r = result([
      query('Ornek nedir?', SIX.map((p) => probe(p, { brandMentioned: true })), { brandInQuery: true }),
      query('Ornek fiyatları', SIX.map((p) => probe(p)), { brandInQuery: true }),
      locked('x'),
    ]);
    const v = deriveVisibility(r);
    expect(v.basis).toBe('all');
    expect(v.totalQueries).toBe(2);
    expect(v.score).toBe(50);
    expect(v.score).toBe(webSummarizeScore(r));
  });

  it('yalnız marka adı geçen cevap da "gösterdi" sayılır (cited || brandMentioned)', () => {
    const r = result([query('soru', SIX.map((p) => probe(p, { brandMentioned: p === 'xai' })))]);
    const v = deriveVisibility(r);
    expect(v.shownPairs).toBe(1);
    expect(v.citedPairs).toBe(0);
    expect(v.score).toBe(17);
    const grok = v.engines.find((e) => e.provider === 'xai')!;
    expect(grok).toMatchObject({ cited: 0, mentioned: 1, shown: 1, total: 1, rate: 100 });
  });

  it('hiç ölçülmüş soru yoksa skor 0 ve çift sayısı 0 (ekran "skor yok" gösterir)', () => {
    const v = deriveVisibility(result([locked('a'), locked('b')]));
    expect(v.totalPairs).toBe(0);
    expect(v.score).toBe(0);
    expect(v.totalQueries).toBe(0);
    expect(v.lockedQueries).toBe(2);
  });

  it('tüm asistanları ölçülemeyen kilitsiz soru ölçülmüş soru sayılmaz', () => {
    const r = result([
      query('ölçüldü', SIX.map((p) => probe(p, { cited: p === 'gemini' }))),
      query('hepsi hata', SIX.map((p) => probe(p, { measured: false }))),
    ]);
    const v = deriveVisibility(r);
    expect(v.measuredQueries).toBe(1);
    expect(v.totalQueries).toBe(1);
    expect(v.totalPairs).toBe(6);
  });

  it('asistanlar gösterme sayısına, eşitlikte alıntıya göre sıralanır', () => {
    const r = result([
      query('a', [probe('openai', { brandMentioned: true }), probe('gemini', { cited: true }), probe('deepseek')]),
      query('b', [probe('openai', { brandMentioned: true }), probe('gemini'), probe('deepseek')]),
    ]);
    expect(deriveVisibility(r).engines.map((e) => e.provider)).toEqual(['openai', 'gemini', 'deepseek']);
  });
});

describe('soru kartı yardımcıları', () => {
  it('queryCounts yalnız ölçülen asistanları sayar; kilitli soruda 0/0', () => {
    const r = teaserPayload('flagged');
    expect(queryCounts(r.queries[1])).toEqual({ shown: 2, total: 6 });
    expect(queryCounts(r.queries[5])).toEqual({ shown: 0, total: 0 });
  });

  it('measuredProviders kilitli soruda boş, işaretsiz asistanı ölçülmüş sayar', () => {
    expect(measuredProviders(locked('x'))).toEqual([]);
    expect(isMeasuredProvider(probe('openai'))).toBe(true);
    expect(isMeasuredProvider(probe('meta', { measured: false }))).toBe(false);
    expect(isMeasuredProvider(probe('meta', { available: false }))).toBe(false);
  });

  it('scoringQueries kilitli soruları dışarıda bırakır', () => {
    const { measured, base } = scoringQueries(teaserPayload('flagged'));
    expect(measured).toHaveLength(3);
    expect(base.map((q) => q.query)).toEqual(['En iyi ön muhasebe programı hangisi?', 'KOBİ için fatura uygulaması önerir misin?']);
  });
});
