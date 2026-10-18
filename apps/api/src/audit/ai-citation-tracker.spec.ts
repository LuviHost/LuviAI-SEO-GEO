import { describe, it, expect, vi } from 'vitest';
import { AiCitationTrackerService } from './ai-citation-tracker.service.js';

/**
 * getHistory: CITATION_MATCH_VERSION farkli snapshot'lar ayni seride
 * kiyaslanmaz (manset farki, saglayici trendi, RanksUp Etkisi baslangici).
 * snapshotSite: HATA satirlari kosum havuzuna ve sayaclara girmez.
 * Servis elle kurulur (Vitest decorator metadata uretmez).
 */
type Snap = { provider: string; date: string; score: number | null; matchVersion: number; citedCount?: number; mentionedCount?: number };

function trackerWith(snaps: Snap[]) {
  const findMany = vi.fn(async (args: any) => snaps
    .map((s) => ({
      provider: s.provider,
      date: new Date(`${s.date}T00:00:00Z`),
      score: s.score,
      citedCount: s.citedCount ?? 0,
      mentionedCount: s.mentionedCount ?? 0,
      available: s.score !== null,
      createdAt: new Date(`${s.date}T09:00:00Z`),
      matchVersion: s.matchVersion,
      ...(args?.select?.probes ? { probes: [] } : {}),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime()));
  const prisma = {
    aiCitationSnapshot: { findMany },
    aiCitationRun: { findFirst: vi.fn(async () => null) },
  };
  return { svc: new AiCitationTrackerService(prisma as any, {} as any), findMany };
}

// Pencere bugune gore kurulur — tarihleri son gunlerden uret
const gunOnce = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe('AiCitationTrackerService.getHistory — yontem surumu', () => {
  it('v3 → v4 (emlak.com: 38 → 0): delta ve deltaVsPrev yok, methodChanged; noktalar surum tasir', async () => {
    const { svc, findMany } = trackerWith([
      { provider: 'openai', date: gunOnce(12), score: 38, matchVersion: 3 },
      { provider: 'openai', date: gunOnce(5), score: 38, matchVersion: 3 },
      { provider: 'openai', date: gunOnce(1), score: 0, matchVersion: 4 },
    ]);
    const h: any = await svc.getHistory('s1', 30);
    expect(findMany.mock.calls[0][0].select.matchVersion).toBe(true);

    const t = h.trends.find((x: any) => x.provider === 'openai');
    expect(t.delta).toBeNull();
    expect(t.first).toBe(0); // baslangic v3'un 38'i DEGIL
    expect(t.methodChanged).toBe(true);
    expect(t.methodChangedAt).toBe(gunOnce(1));

    expect(h.headline.deltaVsPrev).toBeNull();
    expect(h.headline.methodChanged).toBe(true);
    expect(h.headline.score).toBe(0);
    expect(h.byProvider.openai.map((p: any) => p.matchVersion)).toEqual([3, 3, 4]);
  });

  it('headline=1 (overview) ayni kurali uygular ve probe cekmez', async () => {
    const { svc, findMany } = trackerWith([
      { provider: 'gemini', date: gunOnce(10), score: 50, matchVersion: 3 },
      { provider: 'gemini', date: gunOnce(2), score: 20, matchVersion: 4 },
    ]);
    const h: any = await svc.getHistory('s1', 14, true);
    expect(findMany.mock.calls[0][0].select.probes).toBe(false);
    expect(h.headline).toMatchObject({ methodChanged: true, deltaVsPrev: null, score: 20 });
    expect(h.byProvider).toBeUndefined();
  });

  it('tek surum: delta ve methodChanged false', async () => {
    // manset farki icin pencere basina 2 olcum gerekir (citation-headline.ts)
    const { svc } = trackerWith([
      { provider: 'openai', date: gunOnce(12), score: 20, matchVersion: 4 },
      { provider: 'openai', date: gunOnce(9), score: 40, matchVersion: 4 },  // onceki hafta ort 30
      { provider: 'openai', date: gunOnce(4), score: 60, matchVersion: 4 },
      { provider: 'openai', date: gunOnce(1), score: 80, matchVersion: 4 },  // bu hafta ort 70
    ]);
    const h: any = await svc.getHistory('s1', 30);
    expect(h.trends[0]).toMatchObject({ first: 20, last: 80, delta: 60, methodChanged: false });
    expect(h.headline.methodChanged).toBe(false);
    expect(h.headline.deltaVsPrev).toBe(40);
  });
});

describe('AiCitationTrackerService.snapshotSite — HATA satirlari sayilmaz', () => {
  it('tamami HATA saglayici: available false/skor null yazilir; kosum havuzu yalniz olculen probe', async () => {
    const HATA = { query: 'q', cited: false, brandMentioned: false, excerpt: 'HATA: rate_limited' };
    const results = [
      { provider: 'gemini', label: 'Google Gemini', available: false, score: null, reason: 'HATA: rate_limited', probes: [HATA, HATA, HATA, HATA, HATA] },
      {
        provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 100,
        probes: [{ query: 'q1', cited: true, brandMentioned: true, brandInQuery: false, excerpt: 'kobipratik.com' }, HATA, HATA, HATA, HATA],
      },
    ];
    const upserts: any[] = [];
    let runData: any = null;
    const prisma = {
      aiCitationSnapshot: { upsert: vi.fn(async (a: any) => { upserts.push(a); return {}; }) },
      aiCitationRun: { create: vi.fn(async (a: any) => { runData = a.data; return { id: 'run1' }; }) },
    };
    const citation = { runForSite: vi.fn(async () => results) };
    const svc = new AiCitationTrackerService(prisma as any, citation as any);
    await svc.snapshotSite('s1', { trigger: 'system' });

    const gemini = upserts.find((u) => u.create.provider === 'gemini').create;
    expect(gemini).toMatchObject({ available: false, score: null, citedCount: 0, mentionedCount: 0 });
    const openai = upserts.find((u) => u.create.provider === 'openai').create;
    expect(openai).toMatchObject({ score: 100, citedCount: 1 });
    // 10 probe'dan yalniz 1'i olculdu — havuz 1, manset 100 (gemini paydaya girmez)
    expect(runData).toMatchObject({ poolSize: 1, citedCount: 1, headlineScore: 100 });
  });
});
