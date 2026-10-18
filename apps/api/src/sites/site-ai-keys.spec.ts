import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { POOL_ENV_KEY } from '../audit/citation-providers.js';
import { PLAN_POOL_PROVIDERS, QuotaService } from '../billing/quota.service.js';
import { SiteAiKeysService, LLAMA_BYOK_UNSUPPORTED } from './site-ai-keys.service.js';

/**
 * BYOK paneli rozeti olcum motoruyla ayni seyi soylemeli.
 *
 * NEDEN VAR: getStatus `poolKeyAvailable = inPool && env` hesapliyordu; inPool
 * QuotaService'in eski plan listesinden geliyordu (TRIAL yalniz gemini).
 * Olcum motoru ise (ai-citation.service resolveKey) once BYOK'a, sonra env
 * anahtarina bakar ve env anahtari olan saglayiciyi HER planda olcer. Sonuc:
 * deneme hesabinda ChatGPT olculurken panel "anahtar yok" diyordu.
 */

const SIX = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek'] as const;
const ENV_NAMES = SIX.map((p) => POOL_ENV_KEY[p]);
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_NAMES) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_NAMES) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setup(plan: string, byokRows: Array<{ provider: string; verified?: boolean }> = []) {
  const prisma = {
    site: { findUnique: vi.fn(async () => ({ id: 's1', userId: 'u1', user: { plan } })) },
    siteAiProviderKey: {
      findMany: vi.fn(async () => byokRows.map((r) => ({ ...r, prefix: 'sk-test1', verified: r.verified ?? true, lastError: null }))),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  // Gercek QuotaService: getPlanPool'u oldugu gibi kullan, yalniz kota sorgusu sahte
  const quota = new QuotaService(null as never);
  quota.checkCitationQuota = vi.fn(async () => ({ allowed: true, remaining: 3, limit: 3, used: 0 }));
  quota.enforcePlanFeature = vi.fn(async () => undefined);
  return { svc: new SiteAiKeysService(prisma as never, quota), prisma, quota };
}

/** ai-citation.service resolveKey'in kurali: BYOK > env anahtari > yok */
const engineSource = (byok: boolean, provider: (typeof SIX)[number]) =>
  byok ? 'byok' : process.env[POOL_ENV_KEY[provider]] ? 'pool' : 'none';

describe('SiteAiKeysService.getStatus — rozet olcum motoruyla ayni kural', () => {
  it('deneme planinda env anahtari olan saglayici "pool" (eski liste yalniz gemini derdi)', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-openai';
    process.env.DEEPSEEK_API_KEY = 'sk-env-deepseek';
    const { svc } = setup('TRIAL');
    const st = await svc.getStatus('s1');
    const by = Object.fromEntries(st.providers.map((p) => [p.provider, p]));
    expect(by.openai).toMatchObject({ poolKeyAvailable: true, effectiveSource: 'pool' });
    expect(by.deepseek).toMatchObject({ poolKeyAvailable: true, effectiveSource: 'pool' });
    // Plan listesinde olsa bile env anahtari yoksa olculmez — "Planina dahil" denmez
    expect(by.gemini).toMatchObject({ poolKeyAvailable: false, effectiveSource: 'none' });
  });

  it('her planda her saglayici icin effectiveSource === olcum motorunun kaynagi', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
    process.env.XAI_API_KEY = 'xai-env';
    for (const plan of ['TRIAL', 'STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']) {
      const { svc } = setup(plan, [{ provider: 'perplexity' }]);
      const st = await svc.getStatus('s1');
      for (const p of st.providers) {
        const provider = p.provider as (typeof SIX)[number];
        expect(p.effectiveSource, `${plan}/${provider}`).toBe(engineSource(provider === 'perplexity', provider));
        expect(p.poolKeyAvailable, `${plan}/${provider}`).toBe(!!process.env[POOL_ENV_KEY[provider]]);
      }
    }
  });

  it('inPool yalniz bilgi: her planda 6 asistanin hepsi; pool alani plans.ts listesi', async () => {
    const { svc } = setup('TRIAL');
    const st = await svc.getStatus('s1');
    expect(st.pool).toEqual([...PLAN_POOL_PROVIDERS]);
    expect(st.providers.map((p) => p.provider)).toEqual([...SIX]);
    expect(st.providers.every((p) => p.inPool)).toBe(true);
  });

  it('BYOK paneli Meta AI (Llama) sunmaz', async () => {
    const { svc } = setup('ENTERPRISE');
    const st = await svc.getStatus('s1');
    expect(st.providers.map((p) => p.provider)).not.toContain('meta');
  });

  it('yanit alanlari geriye donuk uyumlu', async () => {
    const { svc } = setup('PRO', [{ provider: 'anthropic', verified: false }]);
    const st = await svc.getStatus('s1');
    expect(Object.keys(st).sort()).toEqual(['plan', 'pool', 'providers', 'quota']);
    expect(Object.keys(st.providers[0]).sort()).toEqual(
      ['byokError', 'byokPrefix', 'byokVerified', 'effectiveSource', 'hasByok', 'inPool', 'label', 'poolKeyAvailable', 'provider'].sort(),
    );
    expect(st.providers.find((p) => p.provider === 'anthropic')).toMatchObject({ hasByok: true, byokVerified: false, effectiveSource: 'byok' });
  });
});

describe('SiteAiKeysService.upsertKey — Meta ve govde tipi', () => {
  it("'meta' icin durust gerekce: Groq anahtari GROQ_LLAMA_MODEL olmadan ise yaramaz", async () => {
    const { svc, prisma, quota } = setup('ENTERPRISE');
    const err = await svc.upsertKey('s1', 'meta', 'gsk_0123456789abcdef').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(LLAMA_BYOK_UNSUPPORTED);
    expect(err.message).toContain('GROQ_LLAMA_MODEL');
    expect(prisma.site.findUnique).not.toHaveBeenCalled();
    expect(quota.enforcePlanFeature).not.toHaveBeenCalled();
  });

  it('dize olmayan anahtar 500 degil 400', async () => {
    const { svc } = setup('ENTERPRISE');
    await expect(svc.upsertKey('s1', 'openai', { trim: 1 } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsertKey('s1', 'openai', 12345678901 as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bilinmeyen saglayici yine 400', async () => {
    const { svc } = setup('ENTERPRISE');
    await expect(svc.upsertKey('s1', 'mistral', 'k'.repeat(20))).rejects.toThrow('Gecersiz saglayici');
  });
});
