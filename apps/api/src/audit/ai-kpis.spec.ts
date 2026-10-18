import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { AiKpisService, latestReadinessKpi, isUnmeasuredReadinessStatus } = await import('./ai-kpis.service.js');

/**
 * AI KPI seridi — iki durustluk kurali:
 *  1. CITATION_MATCH_VERSION 4 ANILMAYI da degistirdi (jenerik turetilmis
 *     marka). v3 → v4 gecisinde anilma / markali anilma / ton deltasi
 *     "gorunurluk degisti" diye gosterilmez: method_changed, delta null.
 *  2. Engelli/ulasilamaz AXO taramasinin overallScore'u yalniz olculebilen
 *     kontrolleri yansitir — skor null, neden tasinir.
 */

const DAY = 86_400_000;
const now = Date.now();
const cur = new Date(now - 2 * DAY);
const prev = new Date(now - 10 * DAY);

const run = (date: Date, version: number, over: Partial<Record<string, unknown>> = {}) => ({
  date, cited: false, brandMentioned: false, sentiment: null, competitors: [], brandInQuery: false,
  promptId: 'p1', fanoutId: null, provider: 'openai', matchVersion: version, ...over,
});

function svcWith(runs: any[], scan: any = null, levels: any = null) {
  const prisma = {
    geoPromptRun: { findMany: vi.fn(async () => runs) },
    aiCrawlerHit: { findMany: vi.fn(async () => []) },
    aiReferrerHit: { findMany: vi.fn(async () => []) },
    crawlerHitEvent: { findMany: vi.fn(async () => []) },
    agentReadinessScan: {
      findFirst: vi.fn(async (args: any) => (args?.select?.levels ? (levels ? { levels } : null) : scan)),
    },
  };
  return { svc: new AiKpisService(prisma as any), prisma };
}

describe('AiKpisService — v3 → v4 anilma yontemi degisimi', () => {
  // Ayni hucreler, iki donem: onceki %0 anilma, guncel %100 — tek fark yontem surumu
  const mixed = [
    run(prev, 3), run(prev, 3, { promptId: 'p2' }),
    run(cur, 4, { brandMentioned: true, sentiment: 'positive' }), run(cur, 4, { promptId: 'p2', brandMentioned: true, sentiment: 'positive' }),
    run(prev, 3, { brandInQuery: true }), run(cur, 4, { brandInQuery: true, brandMentioned: true }),
  ];

  it('anilma, markali anilma ve ton deltasi yontem degisiminde null (method_changed)', async () => {
    const k = await svcWith(mixed).svc.getKpis('s1');
    expect(k.comparability.mentions).toBe('method_changed');
    expect(k.mentionRate.deltaPct).toBeNull();
    expect(k.brandedMentionRate.deltaPct).toBeNull();
    expect(k.sentiment.deltaPct).toBeNull();
    expect(k.citationRate.deltaPct).toBeNull();
    // SoV deltasi kapsam ayniyken hesaplanir — yontem degisince o da yok
    expect(k.shareOfVoice.deltaPct).toBeNull();
    // Manset deger yine gosterilir (yalniz kiyas yapilmaz)
    expect(k.mentionRate.value).toBe(100);
  });

  it('ayni surumde kiyas yapilir (delta gercek fark)', async () => {
    const same = mixed.map((r) => ({ ...r, matchVersion: 4 }));
    const k = await svcWith(same).svc.getKpis('s1');
    expect(k.comparability.mentions).toBe('comparable');
    expect(k.mentionRate.deltaPct).toBe(100);
    expect(k.brandedMentionRate.deltaPct).toBe(100);
  });
});

describe('AXO KPI — olculemeyen tarama skor degildir', () => {
  const blockedLevels = [{
    id: 'L1', applicable: true, earned: 3, max: 10,
    checks: [{
      id: 'homepage-access', name: 'Ana sayfa', blocked: {
        kind: 'waf', reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).',
        hint: '"RanksUpBot" için izin verin.', vendor: 'cloudflare', status: 403,
      },
    }],
  }];

  it('blocked taramada score null + neden ve cozum; seviyeler yalniz o zaman okunur', async () => {
    const { svc, prisma } = svcWith([], { id: 'scan1', overallScore: 30, status: 'blocked' }, blockedLevels);
    const k = await svc.getKpis('s1');
    expect(k.agentReadiness).toEqual({
      score: null,
      status: 'blocked',
      measured: false,
      reason: 'Ölçülemedi: Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403). "RanksUpBot" için izin verin.',
    });
    expect(prisma.agentReadinessScan.findFirst).toHaveBeenCalledTimes(2);
  });

  it('seviyeler okunamazsa genel neden; skor yine null', async () => {
    const r = await latestReadinessKpi(svcWith([], { id: 'scan1', overallScore: 12, status: 'unreachable' }).prisma as any, 's1');
    expect(r).toMatchObject({ score: null, status: 'unreachable', measured: false });
    expect(r!.reason).toContain('ulaşamadı');
  });

  it('olculebilen taramada skor aynen, ek sorgu yok', async () => {
    const { svc, prisma } = svcWith([], { id: 'scan1', overallScore: 72, status: 'mostly_ready' });
    const k = await svc.getKpis('s1');
    expect(k.agentReadiness).toEqual({ score: 72, status: 'mostly_ready', measured: true, reason: null });
    expect(prisma.agentReadinessScan.findFirst).toHaveBeenCalledTimes(1);
  });

  it('hic tarama yoksa veri yok (olculemedi degil)', async () => {
    const k = await svcWith([]).svc.getKpis('s1');
    expect(k.agentReadiness).toEqual({ score: null, status: null, measured: true, reason: null });
  });

  it('isUnmeasuredReadinessStatus', () => {
    expect(isUnmeasuredReadinessStatus('blocked')).toBe(true);
    expect(isUnmeasuredReadinessStatus('unreachable')).toBe(true);
    expect(isUnmeasuredReadinessStatus('not_ready')).toBe(false);
    expect(isUnmeasuredReadinessStatus(null)).toBe(false);
  });
});
