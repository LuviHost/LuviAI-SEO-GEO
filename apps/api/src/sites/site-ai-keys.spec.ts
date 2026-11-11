import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { POOL_ENV_KEY } from '../audit/citation-providers.js';
import { PLAN_POOL_PROVIDERS, QuotaService } from '../billing/quota.service.js';
import { ownerEngines } from '../billing/plan-engines.js';
import { findPlan, planEngines, publicPlans } from '../billing/plans.js';
import { AiCitationService } from '../audit/ai-citation.service.js';
import { SiteAiKeysService, META_BYOK_UNSUPPORTED } from './site-ai-keys.service.js';

/**
 * BYOK paneli rozeti olcum motoruyla ayni seyi soylemeli.
 *
 * NEDEN VAR: getStatus `poolKeyAvailable = inPool && env` hesapliyordu; inPool
 * QuotaService'in eski plan listesinden geliyordu (TRIAL yalniz gemini).
 * Olcum motoru ise (ai-citation.service resolveKey) once BYOK'a, sonra env
 * anahtarina bakar ve env anahtari olan saglayiciyi HER planda olcer. Sonuc:
 * deneme hesabinda ChatGPT olculurken panel "anahtar yok" diyordu.
 *
 * 11.11.2026 (uc paket): olcum motoru artik plan KAPSAMINI da dayatir
 * (billing/plan-engines.ts ownerEngines): Baslangic ve deneme Grok ile DeepSeek'i
 * sormaz. Rozet ayni kurali soyler: kapsam disi asistan `inPlan: false`,
 * `effectiveSource: 'none'` (env anahtari ya da kayitli BYOK olsa da) ve
 * `offerPlanName` = asistani olcen en dusuk satistaki plan. ADMIN muaf.
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

function setup(plan: string, byokRows: Array<{ provider: string; verified?: boolean }> = [], role = 'USER') {
  const prisma = {
    site: { findUnique: vi.fn(async () => ({ id: 's1', userId: 'u1', user: { plan, role } })) },
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

/** GERCEK olcum motorunun ayni site icin soyledigi (ai-citation.service getProviderStatus) */
async function engineStatus(plan: string, byokRows: Array<{ provider: string; verified?: boolean }> = [], role = 'USER') {
  const { prisma, quota } = setup(plan, byokRows, role);
  const engine = new AiCitationService(prisma as never, quota, {} as never, {} as never);
  return engine.getProviderStatus('s1', plan, role);
}

/**
 * ai-citation.service'in kurali: once plan KAPSAMI (ownerEngines — kapsam disi asistan
 * hic sorulmaz), sonra resolveKey: BYOK (yalniz planda 'byok' — Kurumsal ya da ADMIN) >
 * env anahtari > yok. Plani dusen hesabin kayitli anahtari etkin kaynak degildir.
 */
const engineSource = (byok: boolean, provider: (typeof SIX)[number], plan: string) =>
  !ownerEngines({ plan, role: 'USER' }).includes(provider) ? 'none'
    : byok && plan === 'ENTERPRISE' ? 'byok' : process.env[POOL_ENV_KEY[provider]] ? 'pool' : 'none';

describe('SiteAiKeysService.getStatus — rozet olcum motoruyla ayni kural', () => {
  it('deneme planinda env anahtari olan KAPSAMDAKI saglayici "pool" (eski liste yalniz gemini derdi); kapsam disi olan degil', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-openai';
    process.env.DEEPSEEK_API_KEY = 'sk-env-deepseek';
    const { svc } = setup('TRIAL');
    const st = await svc.getStatus('s1');
    const by = Object.fromEntries(st.providers.map((p) => [p.provider, p]));
    expect(by.openai).toMatchObject({ poolKeyAvailable: true, effectiveSource: 'pool', inPlan: true });
    // Plan listesinde olsa bile env anahtari yoksa olculmez — "Planina dahil" denmez
    expect(by.gemini).toMatchObject({ poolKeyAvailable: false, effectiveSource: 'none', inPlan: true });
    // 11.11.2026: DeepSeek denemenin kapsaminda degil — anahtari olsa da olculmez, rozet de "pool" demez
    expect(by.deepseek).toMatchObject({ poolKeyAvailable: true, effectiveSource: 'none', inPlan: false });
    // Ayni anahtarla Profesyonel'de olculur
    const pro = await setup('PRO').svc.getStatus('s1');
    expect(pro.providers.find((p) => p.provider === 'deepseek')).toMatchObject({ poolKeyAvailable: true, effectiveSource: 'pool', inPlan: true });
  });

  it('her planda her saglayici icin effectiveSource === olcum motorunun kaynagi', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
    process.env.XAI_API_KEY = 'xai-env';
    for (const plan of ['TRIAL', 'STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']) {
      const { svc } = setup(plan, [{ provider: 'perplexity' }]);
      const st = await svc.getStatus('s1');
      // GERCEK motor (ai-citation.service getProviderStatus) ayni site icin ne diyor
      const motor = Object.fromEntries((await engineStatus(plan, [{ provider: 'perplexity' }])).map((p) => [p.provider, p]));
      for (const p of st.providers) {
        const provider = p.provider as (typeof SIX)[number];
        expect(p.effectiveSource, `${plan}/${provider}`).toBe(engineSource(provider === 'perplexity', provider, plan));
        expect(p.effectiveSource, `${plan}/${provider} motor`).toBe(motor[provider].effectiveSource);
        expect(p.hasByok, `${plan}/${provider}`).toBe(provider === 'perplexity');
        expect(p.poolKeyAvailable, `${plan}/${provider}`).toBe(!!process.env[POOL_ENV_KEY[provider]]);
        expect(p.inPlan, `${plan}/${provider}`).toBe(ownerEngines({ plan, role: 'USER' }).includes(provider));
      }
    }
    // Grok anahtari var: Baslangic'ta olculmez, Profesyonel'de olculur
    expect(engineSource(false, 'xai', 'STARTER')).toBe('none');
    expect(engineSource(false, 'xai', 'PRO')).toBe('pool');
  });

  it('plan kapsami: deneme ve Baslangic\'ta Grok ile DeepSeek kapsam disi — anahtar ya da kayitli BYOK olsa da; teklif Profesyonel', async () => {
    for (const k of ENV_NAMES) process.env[k] = 'env-anahtar';
    for (const plan of ['TRIAL', 'STARTER']) {
      const st = await setup(plan, [{ provider: 'xai' }]).svc.getStatus('s1');
      const by = Object.fromEntries(st.providers.map((p) => [p.provider, p]));
      for (const provider of ['xai', 'deepseek']) {
        expect(by[provider], `${plan}/${provider}`).toMatchObject({ inPlan: false, effectiveSource: 'none', offerPlanName: 'Profesyonel' });
      }
      expect(by.xai.hasByok, plan).toBe(true); // kayit gorunur kalir (silinebilsin), etkin kaynak degil
      for (const provider of ['openai', 'gemini', 'anthropic', 'perplexity']) {
        expect(by[provider], `${plan}/${provider}`).toMatchObject({ inPlan: true, effectiveSource: 'pool' });
        expect(by[provider].offerPlanName, `${plan}/${provider}`).toBeUndefined();
      }
      // Motor da ayni: kapsam disi asistan ne havuzda ne etkin kaynak
      const motor = await engineStatus(plan, [{ provider: 'xai' }]);
      for (const provider of ['xai', 'deepseek']) {
        expect(motor.find((p) => p.provider === provider), `${plan}/${provider} motor`).toMatchObject({ inPool: false, effectiveSource: 'none' });
      }
    }
    // Teklif edilen plan adi plans.ts'ten: asistani olcen en dusuk SATISTAKI plan
    const teklif = publicPlans().find((p) => planEngines(p.id).includes('xai'))!;
    expect(teklif.id).toBe('pro');
    expect(teklif.name_tr).toBe(findPlan('pro')!.name_tr);
    expect(teklif.legacy).toBeFalsy();
  });

  it('Profesyonel ve ustu: alti asistan da kapsamda, eski davranis (anahtar varsa pool, yoksa none); teklif adi yok', async () => {
    process.env.XAI_API_KEY = 'xai-env';
    for (const plan of ['PRO', 'AGENCY', 'ENTERPRISE']) {
      const st = await setup(plan).svc.getStatus('s1');
      for (const p of st.providers) {
        expect(p.inPlan, `${plan}/${p.provider}`).toBe(true);
        expect(p.offerPlanName, `${plan}/${p.provider}`).toBeUndefined();
        expect(p.effectiveSource, `${plan}/${p.provider}`).toBe(p.provider === 'xai' ? 'pool' : 'none');
      }
    }
  });

  it('ADMIN her planda kapsamda (motorla ayni muafiyet)', async () => {
    process.env.XAI_API_KEY = 'xai-env';
    process.env.DEEPSEEK_API_KEY = 'sk-env-deepseek';
    for (const plan of ['TRIAL', 'STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']) {
      const st = await setup(plan, [], 'ADMIN').svc.getStatus('s1');
      const motor = Object.fromEntries((await engineStatus(plan, [], 'ADMIN')).map((p) => [p.provider, p]));
      for (const p of st.providers) {
        expect(p.inPlan, `${plan}/${p.provider}`).toBe(true);
        expect(p.offerPlanName, `${plan}/${p.provider}`).toBeUndefined();
        expect(p.effectiveSource, `${plan}/${p.provider}`).toBe(motor[p.provider].effectiveSource);
      }
      const by = Object.fromEntries(st.providers.map((p) => [p.provider, p]));
      expect(by.xai.effectiveSource, plan).toBe('pool');
      expect(by.deepseek.effectiveSource, plan).toBe('pool');
    }
  });

  it('inPool yalniz bilgi: planin havuz listesi (deneme ve Baslangic 4, Profesyonel ve ustu 6); pool alani plans.ts kapsami', async () => {
    for (const plan of ['TRIAL', 'STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']) {
      const st = await setup(plan).svc.getStatus('s1');
      const kapsam = new Set<string>(planEngines(plan.toLowerCase() as never));
      expect(st.pool, plan).toEqual(PLAN_POOL_PROVIDERS.filter((p) => kapsam.has(p)));
      expect(st.providers.map((p) => p.provider), plan).toEqual([...SIX]);
      for (const p of st.providers) expect(p.inPool, `${plan}/${p.provider}`).toBe(st.pool.includes(p.provider));
    }
    const trial = await setup('TRIAL').svc.getStatus('s1');
    expect(trial.pool).toEqual(['anthropic', 'gemini', 'openai', 'perplexity']);
    expect(trial.providers.filter((p) => !p.inPool).map((p) => p.provider)).toEqual(['xai', 'deepseek']);
    const pro = await setup('PRO').svc.getStatus('s1');
    expect(pro.pool).toEqual([...PLAN_POOL_PROVIDERS]);
    expect(pro.providers.every((p) => p.inPool)).toBe(true);
  });

  it('BYOK paneli Meta AI (Muse) sunmaz', async () => {
    const { svc } = setup('ENTERPRISE');
    const st = await svc.getStatus('s1');
    expect(st.providers.map((p) => p.provider)).not.toContain('meta');
  });

  it('yanit alanlari geriye donuk uyumlu', async () => {
    const { svc } = setup('ENTERPRISE', [{ provider: 'anthropic', verified: false }]);
    const st = await svc.getStatus('s1');
    expect(Object.keys(st).sort()).toEqual(['plan', 'pool', 'providers', 'quota']);
    // Eski alanlarin hepsi yerinde; 11.11.2026'da yalniz EKLENDI: inPlan, offerPlanName
    expect(Object.keys(st.providers[0]).sort()).toEqual(
      ['byokError', 'byokPrefix', 'byokVerified', 'effectiveSource', 'hasByok', 'inPool', 'label', 'poolKeyAvailable', 'provider',
        'inPlan', 'offerPlanName'].sort(),
    );
    expect(st.providers.find((p) => p.provider === 'anthropic')).toMatchObject({ hasByok: true, byokVerified: false, effectiveSource: 'byok' });
  });

  it('plani dusen hesap: kayitli anahtar gorunur (hasByok) ama etkin kaynak degil; ADMIN muaf', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-openai';
    const dusen = await setup('AGENCY', [{ provider: 'openai' }]).svc.getStatus('s1');
    expect(dusen.providers.find((p) => p.provider === 'openai')).toMatchObject({ hasByok: true, effectiveSource: 'pool' });
    const admin = await setup('TRIAL', [{ provider: 'openai' }], 'ADMIN').svc.getStatus('s1');
    expect(admin.providers.find((p) => p.provider === 'openai')).toMatchObject({ hasByok: true, effectiveSource: 'byok' });
  });
});

describe('SiteAiKeysService.upsertKey — Meta ve govde tipi', () => {
  it("'meta' icin durust gerekce: Muse olcumu yalniz RanksUp anahtariyla", async () => {
    const { svc, prisma, quota } = setup('ENTERPRISE');
    const err = await svc.upsertKey('s1', 'meta', 'mm_0123456789abcdef').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(META_BYOK_UNSUPPORTED);
    expect(err.message).not.toMatch(/_API_KEY|Groq|Llama/);
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
