import { describe, it, expect } from 'vitest';
import {
  aggregateCitedSources, compactCitedSources, LEGACY_NOTE, MAX_DOMAINS, MAX_EXAMPLE_URLS, PLACEMENT_ACTIONS,
  type AnswerRecord,
} from './cited-sources.js';
import { normalizeSources, SOURCES_VERSION } from './citation-sources.js';
import { buildCompetitorMatchers } from './source-domain-types.js';

/**
 * "Alintilanan dis kaynaklar" toplamasi — gercekci probe fiksturleri:
 * yeni (sourcesVersion=1) + eski (mentionedDomains) satirlar, aramasiz
 * saglayici (damga var, sources yok), Gemini yalniz-kok (originOnly) kaynaklari.
 * Kaynak listeleri ureticideki normalizeSources'tan gecer — kayitli bicimin aynisi.
 */

const ctx = { ownHost: 'ornek.com.tr', competitors: buildCompetitorMatchers(['https://rakip.com']) };

const src = (...raw: Parameters<typeof normalizeSources>[0]) => normalizeSources(raw);

function ans(p: Partial<AnswerRecord> & Pick<AnswerRecord, 'provider' | 'query' | 'date'>): AnswerRecord {
  return { origin: 'snapshot', sourcesVersion: SOURCES_VERSION, ...p };
}

const FIXTURE: AnswerRecord[] = [
  // ChatGPT: kendi site + reddit + g2 (utm_source=openai normalize ile atilir)
  ans({
    provider: 'openai', query: 'en iyi seo araci', date: '2026-10-24',
    sources: src(
      { url: 'https://www.ornek.com.tr/blog/seo?utm_source=openai', title: 'SEO rehberi' },
      { url: 'https://www.reddit.com/r/SEO/comments/abc/best_tools/?utm_source=openai', title: 'Best tools?' },
      { url: 'https://www.g2.com/categories/seo', title: 'Best SEO Software' },
    ),
  }),
  // Claude: reddit (iki farkli baslik — ayni cevapta tek sayilir) + rakip
  ans({
    provider: 'anthropic', query: 'en iyi seo araci', date: '2026-10-25',
    sources: src(
      { url: 'https://reddit.com/r/SEO/comments/abc/best_tools/' },
      { url: 'https://old.reddit.com/r/bigseo/comments/def/x/' },
      { url: 'https://rakip.com/fiyatlar', title: 'Rakip fiyat' },
    ),
  }),
  // Gemini: yonlendirme adresleri yalniz kok (originOnly) olarak kayitli
  ans({
    provider: 'gemini', query: 'seo araci fiyatlari', date: '2026-10-25',
    sources: src(
      { originOnly: true, domain: 'reddit.com', title: 'reddit.com' },
      { originOnly: true, domain: 'g2.com', title: 'g2.com' },
      { originOnly: true, domain: 'webrazzi.com', title: 'webrazzi.com' },
    ),
  }),
  // Perplexity: arama yapti, alinti yok
  ans({ provider: 'perplexity', query: 'seo araci fiyatlari', date: '2026-10-25', sources: [] }),
  // Grok: aramasiz saglayici — damga var, kaynak listesi yok
  ans({ provider: 'xai', query: 'en iyi seo araci', date: '2026-10-25', sources: null }),
  // Prompt Lab kosumu: wikipedia + youtube
  ans({
    origin: 'prompt', provider: 'openai', query: 'seo nedir', date: '2026-10-26',
    sources: src(
      { url: 'https://tr.wikipedia.org/wiki/Arama_motoru_optimizasyonu', title: 'Arama motoru optimizasyonu' },
      { url: 'https://www.youtube.com/watch?v=xyz' },
    ),
  }),
  // ESKI satirlar (sourcesVersion yok) — yalniz mentionedDomains
  { origin: 'snapshot', provider: 'openai', query: 'en iyi seo araci', date: '2026-10-10', mentionedDomains: ['semrush.com', 'ahrefs.com'] },
  { origin: 'snapshot', provider: 'anthropic', query: 'en iyi seo araci', date: '2026-10-11', mentionedDomains: ['semrush.com', 'semrush.com'] },
  { origin: 'prompt', provider: 'openai', query: 'seo nedir', date: '2026-10-11' },
];

const run = (answers = FIXTURE) => aggregateCitedSources({
  days: 30,
  answers,
  ctx,
  rowCounts: { snapshots: { total: 7, withSourcesVersion: 5 }, promptRuns: { total: 2, withSourcesVersion: 1 } },
});

describe('aggregateCitedSources — kapsam (coverage)', () => {
  it('kaynak kaydi durumlari ayri sayilir', () => {
    const r = run();
    expect(r.coverage).toEqual({
      answers: 9,
      brandedAnswers: 0,
      brandedWithSourcesVersion: 0,
      answersWithSources: 4,
      answersSearchedNoCitation: 1,
      answersWithoutSearch: 1,
      legacyAnswers: 3,
      snapshots: { total: 7, withSourcesVersion: 5, legacy: 2 },
      promptRuns: { total: 2, withSourcesVersion: 1, legacy: 1 },
      firstRecordedAt: '2026-10-24',
    });
  });

  it('hic kaynak kaydi yoksa firstRecordedAt null ve tablo bos', () => {
    const r = run(FIXTURE.filter((a) => typeof a.sourcesVersion !== 'number'));
    expect(r.coverage.firstRecordedAt).toBeNull();
    expect(r.domains).toEqual([]);
    expect(r.totals.ownShare).toBeNull();
    expect(r.placements).toEqual([]);
  });
});

describe('aggregateCitedSources — alan tablosu', () => {
  it('alan basina cevap sayisi (ayni cevapta tek), saglayicilar, sorular, ilk/son gorulme', () => {
    const r = run();
    const reddit = r.domains.find((d) => d.domain === 'reddit.com')!;
    expect(reddit).toMatchObject({
      type: 'forum', answers: 3, providers: ['anthropic', 'gemini', 'openai'],
      topQueries: ['en iyi seo araci', 'seo araci fiyatlari'], firstSeen: '2026-10-24', lastSeen: '2026-10-25',
    });
    // Gercek sayfa varken Gemini'nin kok adresi ornek olarak tekrar edilmez; utm atilmis
    expect(reddit.exampleUrls.map((u) => u.url)).toEqual([
      'https://reddit.com/r/SEO/comments/abc/best_tools/',
      'https://old.reddit.com/r/bigseo/comments/def/x/',
    ]);
    expect(reddit.exampleUrls[0].title).toBe('Best tools?');
  });

  it('yalniz kok adresi bilinen alan tek ornekle ve originOnly isaretiyle gelir', () => {
    const webrazzi = run().domains.find((d) => d.domain === 'webrazzi.com')!;
    expect(webrazzi.type).toBe('news');
    expect(webrazzi.exampleUrls).toEqual([{ url: 'https://webrazzi.com/', originOnly: true }]);
  });

  it('kendi site own, rakip competitor; tur etiketleri', () => {
    const types = Object.fromEntries(run().domains.map((d) => [d.domain, d.type]));
    expect(types).toEqual({
      'reddit.com': 'forum', 'g2.com': 'review', 'ornek.com.tr': 'own', 'rakip.com': 'competitor',
      'webrazzi.com': 'news', 'wikipedia.org': 'encyclopedia', 'youtube.com': 'video',
    });
  });

  it('siralama: cevap sayisi > saglayici cesitliligi > son gorulme > alan adi', () => {
    expect(run().domains.map((d) => d.domain)).toEqual([
      'reddit.com', 'g2.com', 'wikipedia.org', 'youtube.com', 'rakip.com', 'webrazzi.com', 'ornek.com.tr',
    ]);
  });

  it('pay ve tur toplamlari', () => {
    const t = run().totals;
    expect(t.answersCitingOwn).toBe(1);
    expect(t.answersCitingOthersOnly).toBe(3);
    expect(t.ownShare).toBeCloseTo(0.25);
    expect(t.domains).toBe(7);
    // ChatGPT 3 alan, Claude 2 (iki reddit adresi tek alan), Gemini 3, Prompt Lab 2
    expect(t.citations).toBe(3 + 2 + 3 + 2);
    expect(t.byType.forum).toEqual({ domains: 1, answers: 3 });
    expect(t.byType.review).toEqual({ domains: 1, answers: 2 });
    expect(t.byType.other).toEqual({ domains: 0, answers: 0 });
  });

  it('ornek adres en fazla 3; tablo MAX_DOMAINS ile kesilir ve truncated isaretlenir', () => {
    const many = Array.from({ length: MAX_DOMAINS + 5 }, (_, i) => ans({
      provider: 'openai', query: `soru ${i}`, date: '2026-10-25',
      sources: src(...Array.from({ length: 6 }, (__, j) => ({ url: `https://site${i}.com/sayfa-${j}` }))),
    }));
    const r = run(many);
    expect(r.domains).toHaveLength(MAX_DOMAINS);
    expect(r.truncated).toBe(true);
    expect(r.totals.domains).toBe(MAX_DOMAINS + 5);
    for (const d of r.domains) expect(d.exampleUrls.length).toBeLessThanOrEqual(MAX_EXAMPLE_URLS);
  });
});

describe('aggregateCitedSources — markali sorular disarida (unbrandedOnly)', () => {
  it('soruda marka gecen cevap ne paya ne tabloya girer; sayisi kapsamda', () => {
    const branded = ans({
      provider: 'openai', query: 'ornek yorumlari', date: '2026-10-26', brandInQuery: true,
      sources: src({ url: 'https://ornek.com.tr/' }, { url: 'https://www.sikayetvar.com/ornek' }),
    });
    const base = run();
    const r = run([...FIXTURE, branded]);
    expect(r.coverage.brandedAnswers).toBe(1);
    expect(r.coverage.brandedWithSourcesVersion).toBe(1);
    expect(r.coverage.answers).toBe(base.coverage.answers);
    expect(r.totals.answersCitingOwn).toBe(base.totals.answersCitingOwn);
    expect(r.totals.ownShare).toBe(base.totals.ownShare);
    expect(r.domains.some((d) => d.domain === 'sikayetvar.com')).toBe(false);
    expect(r.domains.find((d) => d.domain === 'ornek.com.tr')!.answers).toBe(1);
  });
});

describe('aggregateCitedSources — eski satirlar ayri', () => {
  it('mentionedDomains ana tabloya KARISMAZ; ayri, notlu ozet', () => {
    const r = run();
    expect(r.domains.some((d) => d.domain === 'semrush.com' || d.domain === 'ahrefs.com')).toBe(false);
    expect(r.legacyMentionedDomains).toEqual({
      note: LEGACY_NOTE,
      answers: 3,
      domains: [{ domain: 'semrush.com', answers: 2 }, { domain: 'ahrefs.com', answers: 1 }],
    });
    expect(LEGACY_NOTE).toContain('Reddit/YouTube/Wikipedia hariç');
  });

  it('eski satir yoksa ozet null', () => {
    expect(run(FIXTURE.filter((a) => typeof a.sourcesVersion === 'number')).legacyMentionedDomains).toBeNull();
  });
});

describe('aggregateCitedSources — nerede yer almalisin', () => {
  it('kendi site ve rakip disi, en az iki cevapta alintilananlar; ture gore eylem', () => {
    const r = run();
    expect(r.placementMinAnswers).toBe(2);
    expect(r.placements.map((p) => [p.domain, p.type])).toEqual([['reddit.com', 'forum'], ['g2.com', 'review']]);
    expect(r.placements[0].action).toBe(PLACEMENT_ACTIONS.forum);
    expect(r.placements[1].action).toBe(PLACEMENT_ACTIONS.review);
  });

  it('hicbiri iki cevaba ulasmadiysa tek cevaplik adaylar esik 1 ile listelenir (kendi site/rakip yine yok)', () => {
    const one = [ans({
      provider: 'openai', query: 'q', date: '2026-10-25',
      sources: src({ url: 'https://ornek.com.tr/' }, { url: 'https://rakip.com/' }, { url: 'https://tr.wikipedia.org/wiki/X' }),
    })];
    const r = run(one);
    expect(r.placementMinAnswers).toBe(1);
    expect(r.placements.map((p) => p.domain)).toEqual(['wikipedia.org']);
  });

  it('eylem metinleri dogrulanamayan iddia icermez (kontrol et) ve ansiklopedide dogrudan duzenleme onermez', () => {
    for (const t of ['review', 'forum', 'social', 'news', 'video', 'marketplace', 'other'] as const) {
      expect(PLACEMENT_ACTIONS[t], t).toMatch(/kontrol et/);
    }
    expect(PLACEMENT_ACTIONS.encyclopedia).toMatch(/doğrudan düzenleme yapma/);
    expect(PLACEMENT_ACTIONS.review).toMatch(/yorum iste/);
    expect(PLACEMENT_ACTIONS.news).toMatch(/basın bülteni/);
  });
});

describe('compactCitedSources — MCP/sohbet ozeti', () => {
  it('en fazla 20 alan, alan basina en fazla 3 adres (yalniz URL), eski ozet yok', () => {
    const many = Array.from({ length: 40 }, (_, i) => ans({
      provider: 'openai', query: `soru ${i}`, date: '2026-10-25',
      sources: src(...Array.from({ length: 8 }, (__, j) => ({ url: `https://site${i}.com/sayfa-${j}`, title: 'Uzun bir baslik '.repeat(5) }))),
    }));
    const c = compactCitedSources(run([...many, ...FIXTURE]));
    expect(c.domains).toHaveLength(20);
    for (const d of c.domains) {
      expect(d.urls.length).toBeLessThanOrEqual(3);
      expect(d.urls.every((u) => typeof u === 'string')).toBe(true);
      expect(d.topQueries.length).toBeLessThanOrEqual(3);
    }
    expect('legacyMentionedDomains' in c).toBe(false);
    expect(c.typeNote).toMatch(/sezgisel/);
    // 40 alan x 8 adres + basliklar ham halde ~30 KB; ozet bunun cok altinda
    expect(JSON.stringify(c).length).toBeLessThan(8_000);
  });
});
