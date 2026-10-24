import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { CitedSourcesService, citedSourcesDays, citedSourcesSince, competitorMatchersFrom } from './cited-sources.service.js';
import { PLAN_FEATURE_KEY } from '../billing/plan-feature.decorator.js';
import { McpToolsService } from '../mcp/mcp-tools.service.js';

/**
 * CitedSourcesService — Prisma kablolamasi: snapshot probe'lari + Prompt Lab
 * kosumlari tek cevap listesine iner; HATA satirlari sayilmaz; rakipler
 * Brain.competitors[].url'den; pencere yalniz 30/90.
 */

const D = (s: string) => new Date(`${s}T00:00:00Z`);

function prismaWith(opts: { snapshots?: any[]; runs?: any[]; site?: any } = {}) {
  return {
    site: { findUnique: vi.fn(async () => opts.site ?? { url: 'https://www.ornek.com.tr', brain: { competitors: [{ name: 'Rakip', url: 'https://rakip.com/' }, { name: 'Adsiz' }] } }) },
    aiCitationSnapshot: { findMany: vi.fn(async () => opts.snapshots ?? []) },
    geoPromptRun: { findMany: vi.fn(async () => opts.runs ?? []) },
  };
}

const SNAPSHOTS = [
  {
    provider: 'openai', date: D('2026-10-24'),
    probes: [
      { query: 'en iyi seo araci', cited: true, sourcesVersion: 1, sources: [{ url: 'https://ornek.com.tr/blog', domain: 'ornek.com.tr' }, { url: 'https://www.g2.com/x', domain: 'g2.com' }] },
      { query: 'seo fiyat', excerpt: 'HATA: timeout', sourcesVersion: 1, sources: [{ url: 'https://spam.com/', domain: 'spam.com' }] },
    ],
  },
  { provider: 'xai', date: D('2026-10-24'), probes: [{ query: 'en iyi seo araci', sourcesVersion: 1 }] },
  { provider: 'anthropic', date: D('2026-10-12'), probes: [{ query: 'en iyi seo araci', mentionedDomains: ['semrush.com'] }] },
];

const RUNS = [
  { provider: 'gemini', date: D('2026-10-25'), sourcesVersion: 1, sources: [{ url: 'https://rakip.com/', domain: 'rakip.com', originOnly: true }], prompt: { text: 'seo araci karsilastirma' }, fanout: null },
  { provider: 'openai', date: D('2026-10-25'), sourcesVersion: 1, sources: [{ url: 'https://www.g2.com/y', domain: 'g2.com' }], prompt: { text: 'ana soru' }, fanout: { text: 'dal sorusu' } },
  // HATA satirlari DB'de elenir (where) — sahte Prisma bunlari zaten dondurmez
  { provider: 'openai', date: D('2026-10-05'), sourcesVersion: null, sources: null, prompt: { text: 'x' }, fanout: null },
  { provider: 'openai', date: D('2026-10-25'), sourcesVersion: 1, brandInQuery: true, sources: [{ url: 'https://ornek.com.tr/', domain: 'ornek.com.tr' }], prompt: { text: 'ornek yorumlari' }, fanout: null },
];

describe('citedSourcesDays / citedSourcesSince / competitorMatchersFrom', () => {
  it('pencere bugun dahil tam N gun', () => {
    const now = new Date('2026-10-24T15:00:00Z');
    expect(citedSourcesSince(now, 30).toISOString()).toBe('2026-09-25T00:00:00.000Z');
    expect(citedSourcesSince(now, 90).toISOString()).toBe('2026-07-27T00:00:00.000Z');
  });

  it('yalniz 30 ya da 90; digerleri 30', () => {
    expect(citedSourcesDays('90')).toBe(90);
    expect(citedSourcesDays(30)).toBe(30);
    for (const v of ['7', '365', 'abc', undefined, ['90']]) expect(citedSourcesDays(v)).toBe(30);
  });

  it('rakip eslestiricileri url\'den; url\'siz/bozuk atlanir, www atilir, platformda yol oneki', () => {
    expect(competitorMatchersFrom([{ url: 'https://www.Rakip.com/a' }, { name: 'x' }, 'metin', { url: 'rakip2.com.tr' }, null, { url: 'https://trendyol.com/magaza/r-m-1' }]))
      .toEqual([
        { host: 'rakip.com', pathPrefix: null, key: 'rakip.com' },
        { host: 'rakip2.com.tr', pathPrefix: null, key: 'rakip2.com.tr' },
        { host: 'trendyol.com', pathPrefix: '/magaza/r-m-1', key: 'trendyol.com/magaza/r-m-1' },
      ]);
    expect(competitorMatchersFrom(null)).toEqual([]);
  });
});

describe('CitedSourcesService.get', () => {
  it('snapshot + Prompt Lab kosumlarini toplar; HATA satirlari ne cevap ne kaynak sayilir', async () => {
    const prisma = prismaWith({ snapshots: SNAPSHOTS, runs: RUNS });
    const r = await new CitedSourcesService(prisma as any).get('s1', '90', new Date('2026-10-26T12:00:00Z'));
    expect(r.days).toBe(90);
    expect(r.coverage).toMatchObject({
      answers: 6, brandedAnswers: 1, answersWithSources: 3, answersWithoutSearch: 1, legacyAnswers: 2,
      snapshots: { total: 3, withSourcesVersion: 2, legacy: 1 },
      promptRuns: { total: 4, withSourcesVersion: 3, legacy: 1 },
      firstRecordedAt: '2026-10-24',
    });
    expect(r.domains.map((d) => [d.domain, d.type, d.answers])).toEqual([
      ['g2.com', 'review', 2], ['rakip.com', 'competitor', 1], ['ornek.com.tr', 'own', 1],
    ]);
    expect(r.domains.some((d) => d.domain === 'spam.com')).toBe(false);
    // Fan-out dalinin sorusu dal metniyle sayilir
    expect(r.domains[0].topQueries).toEqual(['dal sorusu', 'en iyi seo araci']);
    expect(r.legacyMentionedDomains?.domains).toEqual([{ domain: 'semrush.com', answers: 1 }]);
    expect(r.promptRunsTruncated).toBe(false);
  });

  it('pencere sorgusu: site + tam N gun; App Prompt Lab haric, HATA DB\'de elenir, excerpt okunmaz', async () => {
    const prisma = prismaWith();
    await new CitedSourcesService(prisma as any).get('s1', '30', new Date('2026-10-24T15:00:00Z'));
    const snapArgs = (prisma.aiCitationSnapshot.findMany.mock.calls as any[])[0][0];
    expect(snapArgs.where).toEqual({ siteId: 's1', date: { gte: new Date('2026-09-25T00:00:00Z') } });
    const runArgs = (prisma.geoPromptRun.findMany.mock.calls as any[])[0][0];
    expect(runArgs.where).toEqual({
      siteId: 's1',
      date: { gte: new Date('2026-09-25T00:00:00Z') },
      prompt: { trackedAppId: null },
      OR: [{ excerpt: null }, { NOT: { excerpt: { startsWith: 'HATA:' } } }],
    });
    expect(runArgs.select.excerpt).toBeUndefined();
    expect(runArgs.select.brandInQuery).toBe(true);
    expect(runArgs.orderBy).toEqual({ date: 'desc' });
    expect(runArgs.take).toBeGreaterThan(0);
  });

  it('veri yoksa bos ama gecerli yanit', async () => {
    const r = await new CitedSourcesService(prismaWith() as any).get('s1');
    expect(r.domains).toEqual([]);
    expect(r.coverage.answers).toBe(0);
    expect(r.legacyMentionedDomains).toBeNull();
  });
});

describe('plan kapisi — citation-history ile ayni (kapi yok)', () => {
  it('REST ucu ve MCP araci kendi olcum gecmisi okumasi: plan ozelligine bagli degil', async () => {
    const { AuditController } = await import('./audit.controller.js');
    const proto = AuditController.prototype as any;
    expect(Reflect.getMetadata(PLAN_FEATURE_KEY, proto.citedSourcesReport)).toBe(Reflect.getMetadata(PLAN_FEATURE_KEY, proto.citationHistory));
    expect(Reflect.getMetadata(PLAN_FEATURE_KEY, proto.citedSourcesReport)).toBeUndefined();
    const tools = new McpToolsService(...(Array(13).fill(null) as [any, any, any, any, any, any, any, any, any, any, any, any, any])).list();
    const tool = tools.find((t) => t.name === 'get_cited_sources')!;
    expect(tool.requiresFeature).toBeUndefined();
    expect(tool.mutating).toBeFalsy();
    expect(tool.scope).toBe('audit:read');
  });
});

describe('MCP get_cited_sources — kompakt cikti', () => {
  it('sahiplik dogrulanir, alan basina en fazla 3 adres doner', async () => {
    const big = Array.from({ length: 30 }, (_, i) => ({
      provider: 'openai', date: D('2026-10-24'),
      probes: [{ query: `q${i}`, sourcesVersion: 1, sources: Array.from({ length: 10 }, (__, j) => ({ url: `https://site${i}.com/p${j}`, domain: `site${i}.com`, title: 'Baslik' })) }],
    }));
    const citedPrisma = prismaWith({ snapshots: big });
    const cited = new CitedSourcesService(citedPrisma as any);
    const prisma = { site: { findUnique: vi.fn(async () => ({ id: 'cmsite000000000000000001', userId: 'u1' })) } };
    const n = null as never;
    const svc = new McpToolsService(prisma as never, n, n, n, n, n, n, n, n, n, n, n, cited);
    const out = await svc.call({ id: 'u1', role: 'USER' }, 'get_cited_sources', { site_id: 'cmsite000000000000000001', days: 90 });
    expect(out.days).toBe(90);
    expect(out.domains.length).toBe(20);
    for (const d of out.domains) expect(d.urls.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(out)).not.toContain('legacyMentionedDomains');

    await expect(svc.call({ id: 'baska', role: 'USER' }, 'get_cited_sources', { site_id: 'cmsite000000000000000001' })).rejects.toThrow(/sana ait değil/);
  });
});
