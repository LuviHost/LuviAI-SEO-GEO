import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AiCitationService } from './ai-citation.service.js';
import { GeoHeatmapService } from './geo-heatmap.service.js';
import { POOL_ENV_KEY } from './citation-providers.js';
import { QuotaService } from '../billing/quota.service.js';
import { AsoPromptLabService } from '../aso/aso-prompt-lab.service.js';

/**
 * GEO heatmap ve App Prompt Lab aylik calistirma tavanina ve gunluk havuz
 * butcesine uyar — ana olcumle (runForSite/runQueries) AYNI kural.
 *
 * NEDEN VAR: iki yol da RanksUp havuz anahtariyla saglayicilara soruyordu ama
 * runForSite'tan gecmedigi icin ne QuotaService citation sayaci ne de
 * isOverBudget/addCost devredeydi: tek heatmap istegi 20 soru x 4 saglayici
 * kota dusmeden kosuyordu. Sayim fiyat kartindaki kural: heatmap'te soru
 * basina 1, App Prompt Lab'de sorulan soru basina 1 calistirma.
 *
 * Gercek AiCitationService + gercek QuotaService; yalniz Prisma ve saglayici
 * cagrilari sahte (ag yok).
 */

const ENV_KEYS = [...new Set([...Object.values(POOL_ENV_KEY), 'GEMINI_API_KEY', 'GROQ_LLAMA_MODEL'])];
let backup: Record<string, string | undefined> = {};
beforeEach(() => {
  backup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(backup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

const today = () => new Date().toISOString().slice(0, 10);

function db(opts: { plan?: string; used?: number; queries?: string[]; kv?: Record<string, string> } = {}) {
  const user = {
    id: 'u1', plan: opts.plan ?? 'AGENCY', role: 'USER',
    aiCitationTestsThisMonth: opts.used ?? 0, aiCitationQuotaResetAt: new Date(),
  };
  const kv = new Map<string, string>(Object.entries(opts.kv ?? {}));
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ ...user })),
      update: vi.fn(async ({ data }: any) => {
        if (data?.aiCitationTestsThisMonth?.increment) user.aiCitationTestsThisMonth += data.aiCitationTestsThisMonth.increment;
        return { ...user };
      }),
    },
    kvStore: { findUnique: vi.fn(async ({ where }: any) => (kv.has(where.key) ? { key: where.key, value: kv.get(where.key) } : null)) },
    $executeRawUnsafe: vi.fn(async (_sql: string, key: string, _v: string, cost: number) => {
      kv.set(key, String(parseFloat(kv.get(key) ?? '0') + cost));
      return 1;
    }),
    site: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: 's1', userId: 'u1', name: 'Ornekmarka', url: 'https://ornekmarka.com', niche: 'finans',
        brain: { seoStrategy: { aeoQueries: opts.queries ?? ['en iyi kredi sitesi', 'kobi kredisi nereden alinir'] }, competitors: [] },
      })),
    },
    trackedApp: { findFirst: vi.fn(async () => ({ id: 'a1', siteId: 's1', name: 'Ornek Uygulama', appStoreId: '123', playStoreId: null })) },
    geoPrompt: {
      findFirst: vi.fn(async () => ({ id: 'p1', text: 'en iyi butce uygulamasi hangisi?' })),
      update: vi.fn(async () => ({})),
    },
    geoPromptRun: { createMany: vi.fn(async () => ({ count: 1 })) },
  };
  const quota = new QuotaService(prisma as any);
  const citation = new AiCitationService(prisma as any, quota, {} as any, {} as any);
  return { prisma, quota, citation, user, kv };
}

function heatmap(d: ReturnType<typeof db>) {
  return new GeoHeatmapService(d.prisma as any, { assertAiEnabled: async () => undefined } as any, d.citation);
}

describe('GEO heatmap — aylik hak (soru basina 1 calistirma)', () => {
  it('hak yetmiyorsa saglayici cagrilmadan 403; gereken ve kalan sayi yazar', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const queries = ['s1 kredi', 's2 kredi', 's3 kredi', 's4 kredi', 's5 kredi'];
    const d = db({ plan: 'TRIAL', used: 1, queries }); // TRIAL: 3 hak, 2 kaldi
    const svc = heatmap(d);
    const ask = vi.fn(async () => 'cevap');
    (svc as any).askProvider = ask;
    const err = await svc.runForSite('s1', { maxQueries: 5 }).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toContain('5 AI görünürlük çalıştırması');
    expect(err.message).toContain('2 hakkın kaldı');
    expect(ask).not.toHaveBeenCalled();
    expect(d.user.aiCitationTestsThisMonth).toBe(1);
  });

  it('hak bittiyse "hakkın doldu" (BYOK vaadi yok — heatmap BYOK kullanmaz)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const d = db({ plan: 'TRIAL', used: 3 });
    const svc = heatmap(d);
    (svc as any).askProvider = vi.fn(async () => 'cevap');
    const err = await svc.runForSite('s1').catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toMatch(/hakkın doldu \(3\/3\)/);
    expect(err.message).not.toMatch(/BYOK/);
  });

  it('yalniz OLCULEN soru hak yer; maliyet kiraci defterine olculen hucre kadar yazilir', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    const d = db({ plan: 'AGENCY', used: 0, queries: ['olculen soru', 'hep hata soru'] });
    const svc = heatmap(d);
    (svc as any).askProvider = vi.fn(async (_p: string, q: string) => {
      if (q === 'hep hata soru') throw new Error('HTTP 503');
      return 'ornekmarka.com onerilir';
    });
    const r = await svc.runForSite('s1');
    expect(r.queries).toEqual(['olculen soru', 'hep hata soru']);
    // 2 soru istendi, 1'i olculdu → 1 hak
    expect(d.user.aiCitationTestsThisMonth).toBe(1);
    const unit = (d.citation as any).COST_PER_PROBE_USD;
    expect(parseFloat(d.kv.get(`ai-cost:anthropic:${today()}:u:u1`)!)).toBeCloseTo(unit.anthropic * 1);
    expect(parseFloat(d.kv.get(`ai-cost:openai:${today()}:u:u1`)!)).toBeCloseTo(unit.openai * 1);
    expect(parseFloat(d.kv.get(`ai-cost:anthropic:${today()}`)!)).toBeCloseTo(unit.anthropic * 1);
  });
});

describe('GEO heatmap — gunluk havuz butcesi', () => {
  it('butcesi asilan saglayici cagrilmaz, hucre olculemedi (skora girmez); digeri olculur', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    const probe = db();
    const cap = (probe.citation as any).DAILY_BUDGET_USD.anthropic as number;
    const d = db({ kv: { [`ai-cost:anthropic:${today()}`]: String(cap) } });
    const svc = heatmap(d);
    const ask = vi.fn(async (_p: string, _q: string) => 'ornekmarka.com');
    (svc as any).askProvider = ask;
    const r = await svc.runForSite('s1');
    expect(ask.mock.calls.every(([p]) => p !== 'anthropic')).toBe(true);
    const anth = r.cells.filter((c) => c.provider === 'anthropic');
    expect(anth.every((c) => c.status === 'error' && /Günlük havuz bütçesi/.test(c.excerpt))).toBe(true);
    expect(r.scoreByProvider.anthropic).toBeNull();
    expect(r.scoreByProvider.openai).toBe(100);
    // openai olculdu → 2 soru 2 hak
    expect(d.user.aiCitationTestsThisMonth).toBe(2);
  });
});

describe('App Prompt Lab — sorulan soru basina 1 calistirma + kiraci butcesi', () => {
  const okProbe = (query: string) => [{ query, cited: false, brandMentioned: true, excerpt: 'Ornek Uygulama iyi' }];

  it('hak bittiyse saglayici cagrilmadan 403', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const d = db({ plan: 'PRO', used: 75 });
    const spy = vi.fn(async (_k: string, _h: string, _b: string, qs: string[]) => okProbe(qs[0]!));
    (d.citation as any).probeAnthropic = spy;
    const svc = new AsoPromptLabService(d.prisma as any, d.citation, {} as any);
    await expect(svc.run('s1', 'a1', 'p1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(spy).not.toHaveBeenCalled();
    expect(d.prisma.geoPromptRun.createMany).not.toHaveBeenCalled();
  });

  it('olcum olursa tam 1 hak duser; maliyet kiracinin gunluk defterine de yazilir', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const d = db({ plan: 'PRO', used: 10 });
    (d.citation as any).probeAnthropic = vi.fn(async (_k: string, _h: string, _b: string, qs: string[]) => okProbe(qs[0]!));
    const svc = new AsoPromptLabService(d.prisma as any, d.citation, {} as any);
    const r = await svc.run('s1', 'a1', 'p1');
    expect(r.summary.total).toBe(1);
    expect(d.user.aiCitationTestsThisMonth).toBe(11);
    const unit = (d.citation as any).COST_PER_PROBE_USD.anthropic;
    expect(parseFloat(d.kv.get(`ai-cost:anthropic:${today()}:u:u1`)!)).toBeCloseTo(unit);
  });

  it('hicbir saglayici olcmediyse hak dusmez', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const d = db({ plan: 'PRO', used: 10 });
    (d.citation as any).probeAnthropic = vi.fn(async () => { throw new Error('HTTP 503'); });
    const svc = new AsoPromptLabService(d.prisma as any, d.citation, {} as any);
    await svc.run('s1', 'a1', 'p1');
    expect(d.user.aiCitationTestsThisMonth).toBe(10);
  });

  it('kiraci butce payi dolmussa saglayici cagrilmaz, "ölçülemedi" satiri olur', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const probe = db();
    const userCap = (probe.citation as any).DAILY_BUDGET_USD.anthropic * (probe.citation as any).PER_USER_BUDGET_SHARE;
    const d = db({ plan: 'PRO', used: 0, kv: { [`ai-cost:anthropic:${today()}:u:u1`]: String(userCap) } });
    const spy = vi.fn(async (_k: string, _h: string, _b: string, qs: string[]) => okProbe(qs[0]!));
    (d.citation as any).probeAnthropic = spy;
    const svc = new AsoPromptLabService(d.prisma as any, d.citation, {} as any);
    const r = await svc.run('s1', 'a1', 'p1');
    expect(spy).not.toHaveBeenCalled();
    const row = r.providers.find((p) => p.provider === 'anthropic');
    expect(row).toMatchObject({ available: false });
    expect(row?.reason).toMatch(/Günlük havuz bütçesi/);
    expect(d.user.aiCitationTestsThisMonth).toBe(0);
  });

  it('anonim cagiranlar (budgetUserId yok) eski davranista: kiraci defteri yazilmaz', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const d = db();
    (d.citation as any).probeAnthropic = vi.fn(async (_k: string, _h: string, _b: string, qs: string[]) => okProbe(qs[0]!));
    await d.citation.runPublicProbes({ brand: 'Ornek', host: 'ornekmarka.com', queries: ['soru'] });
    expect([...d.kv.keys()].some((k) => k.includes(':u:'))).toBe(false);
    expect(d.kv.has(`ai-cost:anthropic:${today()}`)).toBe(true);
  });
});
