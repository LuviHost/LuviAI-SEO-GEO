import { describe, it, expect, vi } from 'vitest';
import { LookerController } from './looker.controller.js';

/**
 * Looker prompts tablosundaki brand_in_query, GeoPromptRun.brandInQuery
 * damgasiyla (buildProbe: marka + site host'u) ayni karari vermeli. Jenerik
 * turetilmis markada ("emlak" ← emlak.com) yalin kelime markali sayilmaz;
 * host verilmeseydi ajans panosu ile RanksUp paneli farkli sayi gosterirdi.
 * Vitest dekorator metadata'si uretmedigi icin denetleyici elle kurulur.
 */

function kur(site: { name: string | null; url: string }, prompts: string[]) {
  const prisma = {
    site: { findUnique: vi.fn(async () => ({ id: 's1', userId: 'u1', ...site })) },
    geoPrompt: {
      findMany: vi.fn(async () => prompts.map((text) => ({ text, intent: 'commercial', lastRunAt: null, lastCitedCount: 0, lastTotalCount: 0 }))),
    },
  };
  const ctrl = new LookerController(prisma as never);
  const req = { user: { id: 'u1', role: 'USER' } };
  return { ctrl, req };
}

describe('GET /looker/prompts — brand_in_query', () => {
  it('jenerik turetilmis marka: sektor sorusu markasiz, alan adi gecen soru markali', async () => {
    const { ctrl, req } = kur({ name: 'emlak', url: 'https://www.emlak.com' }, [
      'En iyi emlak siteleri hangileri?',
      'emlak.com güvenilir mi?',
    ]);
    const { rows } = await ctrl.prompts(req as never, 's1');
    expect(rows.map((r) => r.brand_in_query)).toEqual([false, true]);
  });

  it('jenerik olmayan marka eski kurala tabi: yalin ad markali', async () => {
    const { ctrl, req } = kur({ name: 'Kobipratik', url: 'https://kobipratik.com' }, [
      'Kobipratik nedir?',
      'KOBİ kredisi nasıl alınır?',
    ]);
    const { rows } = await ctrl.prompts(req as never, 's1');
    expect(rows.map((r) => r.brand_in_query)).toEqual([true, false]);
  });
});
