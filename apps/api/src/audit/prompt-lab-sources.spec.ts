import { describe, it, expect, vi } from 'vitest';
import { PromptLabService } from './prompt-lab.service.js';

/**
 * Prompt Lab kalici kaydi (GeoPromptRun) — alintilanan kaynaklar (GEO Faz 2).
 * sources kolonu: aramali saglayicida dizi ([] dahil), aramasizda NULL;
 * sourcesVersion NULL = kaynaklar yakalanmadan once yazilmis satir.
 * Vitest dekorator metadata'si uretmedigi icin servis elle kurulur.
 */
describe('PromptLabService.persistRuns — sources', () => {
  it('kaynaklar ve surum satira yazilir; HATA satiri hic yazilmaz', async () => {
    const runs: any[] = [];
    const prisma = { geoPromptRun: { createMany: vi.fn(async ({ data }: any) => { runs.push(...data); return { count: data.length }; }) } };
    const svc = new PromptLabService(prisma as any, {} as any, {} as any);
    const sources = [{ url: 'https://youtube.com/watch?v=1', domain: 'youtube.com' }];
    await (svc as any).persistRuns('s1', 'p1', null, new Date('2026-10-24T00:00:00Z'), [
      { provider: 'perplexity', probe: { query: 'q', cited: false, brandMentioned: true, excerpt: 'a', sources, sourcesVersion: 1 } },
      { provider: 'openai', probe: { query: 'q', cited: false, brandMentioned: false, excerpt: 'b', sources: [], sourcesVersion: 1 } },
      { provider: 'xai', probe: { query: 'q', cited: false, brandMentioned: false, excerpt: 'c', sourcesVersion: 1 } },
      { provider: 'gemini', probe: { query: 'q', cited: false, brandMentioned: false, excerpt: 'HATA: rate_limited' } },
    ]);
    expect(runs).toHaveLength(3);
    const row = (p: string) => runs.find((r) => r.provider === p);
    expect(row('perplexity')).toMatchObject({ sources, sourcesVersion: 1 });
    expect(row('openai')).toMatchObject({ sources: [], sourcesVersion: 1 });
    expect(row('xai').sources).toBeUndefined();
    expect(row('xai').sourcesVersion).toBe(1);
  });
});
