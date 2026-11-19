import { describe, expect, it, vi } from 'vitest';
import { AiCitationService } from './ai-citation.service.js';

/**
 * 18.11.2026 (sahip: "GEO Lab'e soru eklediyse olcum oradan kullansin"): runForSite once sitenin
 * GEO Lab'deki aktif takip sorularini alir — planin / hesabin site basina soru tavani kadar,
 * eklenme sirasiyla; yoksa (ya da okunamazsa) marka beynine duser.
 */
function servis(rows: Array<{ text: string }> | Error) {
  const findMany = vi.fn(async ({ take }: { take: number }) => {
    if (rows instanceof Error) throw rows;
    return rows.slice(0, take);
  });
  const svc = new AiCitationService({ geoPrompt: { findMany } } as any, {} as any, {} as any, {} as any);
  return { svc: svc as any, findMany };
}

describe('takip sorulari (runForSite soru secimi)', () => {
  const on = Array.from({ length: 12 }, (_, i) => ({ text: `Takip sorusu ${i}` }));

  it('Profesyonel: en cok 10 aktif soru, uygulama sorulari haric, eklenme sirasiyla', async () => {
    const { svc, findMany } = servis(on);
    const q = await svc.trackedQueries('s1', { plan: 'PRO', role: 'USER' });
    expect(q).toHaveLength(10);
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { siteId: 's1', isActive: true, trackedAppId: null }, orderBy: { createdAt: 'asc' }, take: 10 });
  });

  it('Baslangic 5; yoneticinin hesap tavani plan degerini ezer', async () => {
    expect(await servis(on).svc.trackedQueries('s1', { plan: 'STARTER', role: 'USER' })).toHaveLength(5);
    expect(await servis(on).svc.trackedQueries('s1', { plan: 'PRO', role: 'USER', promptsPerSiteOverride: 3 })).toHaveLength(3);
  });

  it('GEO Lab bos ya da okunamiyor: bos liste (olcum marka beynine duser)', async () => {
    expect(await servis([]).svc.trackedQueries('s1', { plan: 'PRO', role: 'USER' })).toEqual([]);
    expect(await servis(new Error('db')).svc.trackedQueries('s1', { plan: 'PRO', role: 'USER' })).toEqual([]);
  });
});

describe('GEO Lab sorulariyla site olcumu GEO Lab\'e de yazilir', () => {
  it('soru basina GeoPromptRun + son sonuc; hata probe\'u satir olmaz; marka beyni sorusu yazilmaz', async () => {
    const createMany = vi.fn(async () => ({ count: 0 }));
    const update = vi.fn(async () => ({}));
    const svc: any = new AiCitationService({ geoPromptRun: { createMany }, geoPrompt: { update } } as any, {} as any, {} as any, {} as any);
    await svc.recordTrackedRuns('s1', [{ id: 'p1', text: 'Izmir rulman bayisi' }], [
      { provider: 'openai', probes: [
        { query: 'izmir rulman bayisi ', cited: true, brandMentioned: true, brandInQuery: false, excerpt: 'Saygili...' },
        { query: 'Baska beyin sorusu', cited: false, brandMentioned: false, brandInQuery: false, excerpt: 'x' },
      ] },
      { provider: 'gemini', probes: [{ query: 'Izmir rulman bayisi', cited: false, brandMentioned: false, excerpt: 'HATA: zaman asimi' }] },
    ], 'premium');
    expect(createMany).toHaveBeenCalledTimes(1);
    const data = (createMany.mock.calls[0] as any)[0].data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ siteId: 's1', promptId: 'p1', fanoutId: null, provider: 'openai', cited: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1' }, data: expect.objectContaining({ lastCitedCount: 1, lastTotalCount: 1 }) }));
  });
});
