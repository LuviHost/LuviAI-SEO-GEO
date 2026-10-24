import { describe, it, expect } from 'vitest';
import {
  aiSessionSourceRegex, aiTrafficDays, aiTrafficRange, buildAiTrafficRequests, gaDate, mapAiTraffic, mapTrackerHits,
  rangeDays, MAX_LANDING_PAGES,
} from './ai-traffic.js';
import { AI_SOURCES, analyticsSourceDomains, classifySessionSource } from '../audit/ai-source.js';

/**
 * "AI'dan gelen trafik" saf katmani: GA4 istek govdesi (regex TEK kaynaktan),
 * yanit eslemesi ve izleme kodu serisi.
 */

const row = (dims: string[], mets: number[]) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: mets.map((m) => ({ value: String(m) })),
});

describe('GA4 sessionSource alan listesi — ai-source.ts tek kaynak', () => {
  it('hosts + utmSources; bing.com haric (yol bilgisi yok)', () => {
    const d = analyticsSourceDomains();
    for (const s of AI_SOURCES) {
      for (const h of s.hosts) if (h !== 'bing.com') expect(d, h).toContain(h);
      for (const u of s.utmSources) expect(d, u).toContain(u);
    }
    expect(d).not.toContain('bing.com');
    expect(d).toEqual(expect.arrayContaining(['chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com', 'copilot.com', 'you.com', 'phind.com', 'poe.com']));
    expect(new Set(d).size).toBe(d.length);
  });

  it('classifySessionSource: alt alan ve www kabul, benzer alan ret', () => {
    expect(classifySessionSource('chatgpt.com')).toEqual({ key: 'chatgpt', label: 'ChatGPT' });
    expect(classifySessionSource('www.perplexity.ai')?.key).toBe('perplexity');
    expect(classifySessionSource('Copilot.com')?.key).toBe('bing-copilot');
    expect(classifySessionSource('notchatgpt.com')).toBeNull();
    expect(classifySessionSource('bing.com')).toBeNull();
    expect(classifySessionSource('google')).toBeNull();
    expect(classifySessionSource('')).toBeNull();
  });
});

describe('aiSessionSourceRegex', () => {
  const re = new RegExp(aiSessionSourceRegex(), 'i');

  it('listeden uretilir; noktalar kacisli, alt alan izinli, tam eslesme', () => {
    const src = aiSessionSourceRegex();
    for (const d of analyticsSourceDomains()) expect(src).toContain(d.replace(/\./g, '\\.'));
    expect(src.startsWith('^')).toBe(true);
    expect(src.endsWith('$')).toBe(true);
    expect(aiSessionSourceRegex(['a.com', 'b.ai'])).toBe('^(?:[a-z0-9-]+\\.)*(?:a\\.com|b\\.ai)$');
  });

  it.each([
    ['chatgpt.com', true], ['www.perplexity.ai', true], ['claude.ai', true], ['gemini.google.com', true],
    ['copilot.microsoft.com', true], ['chatgptXcom', false], ['notchatgpt.com', false], ['chatgpt.com.evil.net', false],
    ['google', false], ['bing.com', false], ['(direct)', false],
  ])('%s → %s', (v, ok) => {
    expect(re.test(v)).toBe(ok);
  });
});

describe('pencere', () => {
  it('28/90 disi deger 28; pencere dun dahil N tam gun (UTC)', () => {
    expect(aiTrafficDays('90')).toBe(90);
    expect(aiTrafficDays('30')).toBe(28);
    expect(aiTrafficDays(['90'])).toBe(28);
    const r = aiTrafficRange(new Date('2026-10-24T10:00:00Z'), 28);
    expect(r).toEqual({ startDate: '2026-09-26', endDate: '2026-10-23' });
    expect(rangeDays(r)).toHaveLength(28);
    expect(gaDate('20261024')).toBe('2026-10-24');
  });
});

describe('buildAiTrafficRequests', () => {
  const range = { startDate: '2026-09-26', endDate: '2026-10-23' };

  it('daily ve pages ayni regex filtresini tasir; total filtresiz', () => {
    const r = buildAiTrafficRequests(range, { withRevenue: true });
    const filter = { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'FULL_REGEXP', value: aiSessionSourceRegex(), caseSensitive: false } } };
    expect(r.daily.dimensionFilter).toEqual(filter);
    expect(r.pages.dimensionFilter).toEqual(filter);
    expect('dimensionFilter' in r.total).toBe(false);
    expect(r.daily.dimensions).toEqual([{ name: 'date' }, { name: 'sessionSource' }]);
    expect(r.pages.dimensions).toEqual([{ name: 'sessionSource' }, { name: 'landingPage' }]);
    expect(r.daily.metrics.map((m) => m.name)).toEqual(['sessions', 'engagedSessions', 'keyEvents', 'totalRevenue']);
    expect(r.total.metrics).toEqual([{ name: 'sessions' }]);
    for (const b of [r.daily, r.pages, r.total]) expect(b.dateRanges).toEqual([range]);
  });

  it('gelirsiz surum totalRevenue istemez', () => {
    expect(buildAiTrafficRequests(range, { withRevenue: false }).daily.metrics.map((m) => m.name)).toEqual(['sessions', 'engagedSessions', 'keyEvents']);
  });
});

describe('mapAiTraffic', () => {
  const range = { startDate: '2026-10-21', endDate: '2026-10-23' };
  const dailyRows = [
    row(['20261021', 'chatgpt.com'], [10, 6, 1, 120.5]),
    row(['20261021', 'www.perplexity.ai'], [4, 2, 0, 0]),
    row(['20261023', 'chat.openai.com'], [2, 1, 0, 0]),
    row(['20261023', 'copilot.com'], [3, 3, 1, 0]),
    row(['20261023', 'bilinmeyen.ai'], [5, 0, 0, 0]),
  ];
  const pageRows = [
    row(['chatgpt.com', '/blog/seo'], [8, 5, 1]),
    row(['www.perplexity.ai', '/blog/seo'], [3, 1, 0]),
    row(['chatgpt.com', '/fiyatlar'], [4, 2, 0]),
    row(['copilot.com', ''], [3, 3, 1]),
  ];

  it('asistan toplamlari, pay, gunluk seri (bos gunler sifir), sayfalar', () => {
    const g = mapAiTraffic({ range, dailyRows, pageRows, pageRowCount: 4, totalRows: [row([], [400])], withRevenue: true });
    expect(g.byAssistant.map((a) => [a.key, a.sessions, a.engagedSessions, a.keyEvents])).toEqual([
      ['chatgpt', 12, 7, 1], ['perplexity', 4, 2, 0], ['bing-copilot', 3, 3, 1],
    ]);
    expect(g.byAssistant[0].label).toBe('ChatGPT');
    expect(g.byAssistant[0].revenue).toBeCloseTo(120.5);
    expect(g.totals).toMatchObject({ sessions: 19, engagedSessions: 12, keyEvents: 2 });
    expect(g.totals.engagementRate).toBeCloseTo(12 / 19);
    expect(g.siteSessions).toBe(400);
    expect(g.aiShare).toBeCloseTo(19 / 400);
    expect(g.unclassifiedSessions).toBe(5);
    expect(g.daily).toEqual([
      { date: '2026-10-21', total: 14, byAssistant: { chatgpt: 10, perplexity: 4 } },
      { date: '2026-10-22', total: 0, byAssistant: {} },
      { date: '2026-10-23', total: 5, byAssistant: { chatgpt: 2, 'bing-copilot': 3 } },
    ]);
    expect(g.landingPages[0]).toEqual({ page: '/blog/seo', sessions: 11, engagedSessions: 6, keyEvents: 1, byAssistant: { chatgpt: 8, perplexity: 3 } });
    expect(g.landingPages.map((p) => p.page)).toEqual(['/blog/seo', '/fiyatlar', '(not set)']);
    expect(g.revenueAvailable).toBe(true);
    expect(g.pagesTruncated).toBe(false);
  });

  it('gelir okunamadiysa revenue null; site oturumu yoksa pay null; satir siniri isaretlenir', () => {
    const g = mapAiTraffic({ range, dailyRows: [row(['20261021', 'claude.ai'], [1, 1, 0])], pageRows, pageRowCount: 5000, totalRows: [], withRevenue: false });
    expect(g.totals.revenue).toBeNull();
    expect(g.byAssistant[0].revenue).toBeNull();
    expect(g.revenueAvailable).toBe(false);
    expect(g.aiShare).toBeNull();
    expect(g.pagesTruncated).toBe(true);
  });

  it('en fazla 20 acilis sayfasi', () => {
    const many = Array.from({ length: 30 }, (_, i) => row(['chatgpt.com', `/s${i}`], [30 - i, 0, 0]));
    const g = mapAiTraffic({ range, dailyRows: [], pageRows: many, totalRows: [], withRevenue: false });
    expect(g.landingPages).toHaveLength(MAX_LANDING_PAGES);
    expect(g.landingPages[0].page).toBe('/s0');
  });
});

describe('mapTrackerHits — RanksUp izleme kodu', () => {
  it('pencere disi satirlar atlanir; asistan, gun ve adres toplamlari', () => {
    const range = { startDate: '2026-10-21', endDate: '2026-10-22' };
    const t = mapTrackerHits([
      { date: new Date('2026-10-20T00:00:00Z'), referrer: 'chatgpt', hits: 99, topUrls: [] },
      { date: new Date('2026-10-21T00:00:00Z'), referrer: 'chatgpt', hits: 5, topUrls: [{ url: 'https://o.com/a', count: 4 }, { url: 'https://o.com/b', count: 1 }] },
      { date: new Date('2026-10-22T00:00:00Z'), referrer: 'perplexity', hits: 2, topUrls: [{ url: 'https://o.com/a', count: 2 }] },
      { date: '2026-10-22', referrer: 'chatgpt', hits: 1, topUrls: 'bozuk' },
    ], range);
    expect(t.totalHits).toBe(8);
    expect(t.byAssistant).toEqual([{ key: 'chatgpt', label: 'ChatGPT', hits: 6 }, { key: 'perplexity', label: 'Perplexity', hits: 2 }]);
    expect(t.daily).toEqual([
      { date: '2026-10-21', total: 5, byAssistant: { chatgpt: 5 } },
      { date: '2026-10-22', total: 3, byAssistant: { perplexity: 2, chatgpt: 1 } },
    ]);
    expect(t.topPages).toEqual([{ url: 'https://o.com/a', count: 6 }, { url: 'https://o.com/b', count: 1 }]);
  });
});
