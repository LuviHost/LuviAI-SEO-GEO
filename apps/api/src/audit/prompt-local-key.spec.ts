import { describe, it, expect, vi } from 'vitest';
import { PromptLabService } from './prompt-lab.service.js';
import { PROMPT_LOCAL_KEY_PREFIX, promptLocalKey } from './prompt-local-key.js';

/**
 * Silme planlari (hesap + site) Prompt Lab yerel sonucunu bu yardimciyla
 * uretilen anahtarla siler. Servis anahtari kendi icinde uretiyorsa ikisi
 * ayrisabilir; bu test servisin sildigi anahtarla yardimcininkini karsilastirir.
 */
describe('promptLocalKey — Prompt Lab servisiyle ayni anahtar', () => {
  it('bicim: prompt-local:<promptId>', () => {
    expect(PROMPT_LOCAL_KEY_PREFIX).toBe('prompt-local:');
    expect(promptLocalKey('cmpromptxxxxxxxxxxxxxxxx1')).toBe('prompt-local:cmpromptxxxxxxxxxxxxxxxx1');
  });

  it('servis prompt silerken ayni anahtari siler', async () => {
    const kvDeletes: any[] = [];
    const prisma: any = {
      geoPrompt: {
        findFirst: vi.fn(async () => ({ id: 'gp1', siteId: 's1', trackedAppId: null })),
        delete: vi.fn(async () => ({})),
      },
      kvStore: { deleteMany: vi.fn(async (a: any) => { kvDeletes.push(a); return { count: 1 }; }) },
    };
    const svc = new PromptLabService(prisma, {} as any, {} as any);
    await svc.remove('s1', 'gp1');
    expect(kvDeletes).toEqual([{ where: { key: promptLocalKey('gp1') } }]);
  });
});
