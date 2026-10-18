import { describe, it, expect } from 'vitest';
import { BASE_PLANS } from './plans.js';
import { PLAN_POOL_PROVIDERS, QuotaService } from './quota.service.js';
import { POOL_ENV_KEY } from '../audit/citation-providers.js';

/**
 * QuotaService.getPlanPool — plans.ts ile ayni "her planda 6 asistan".
 *
 * NEDEN VAR: LIMITS[plan].pool plana gore 1-6 saglayici listeliyordu (TRIAL
 * yalniz gemini). Fiyat karti her planda "ChatGPT · Claude · Gemini ·
 * Perplexity · Grok · DeepSeek" satiyor ve olcum motoru env anahtari olan
 * saglayiciyi her planda olcuyor; bayat liste panel rozetini yaniltiyordu.
 * Temizlik kota SAYILARINA dokunmamali — asagidaki sabit tablo bunu kilitler.
 */

const quota = new QuotaService(null as never);
const LIMITS = Reflect.get(quota, 'LIMITS') as Record<string, Record<string, unknown>>;

/** Saglayici kimligi -> fiyat kartindaki ad */
const CARD_NAME: Record<string, string> = {
  openai: 'ChatGPT', anthropic: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity', xai: 'Grok', deepseek: 'DeepSeek',
};

describe('getPlanPool', () => {
  it('her bilinen planda ayni 6 asistan; liste fiyat kartindaki adlarla birebir', () => {
    const card = BASE_PLANS.flatMap((p) => p.features_tr).find((m) => m.startsWith('ChatGPT · '))!.split(' · ');
    expect(PLAN_POOL_PROVIDERS.map((p) => CARD_NAME[p]).sort()).toEqual([...card].sort());
    for (const p of BASE_PLANS) {
      const pool = quota.getPlanPool(p.id.toUpperCase());
      expect(pool, p.id).toEqual([...PLAN_POOL_PROVIDERS]);
      expect(pool.length, `${p.id} aiProviders`).toBe(p.aiProviders);
    }
  });

  it('Llama (meta) havuzda yok — yalniz GROQ_LLAMA_MODEL ile olculur; geri kalan her saglayicinin env adi var', () => {
    expect(PLAN_POOL_PROVIDERS).not.toContain('meta');
    const envProviders = Object.keys(POOL_ENV_KEY).filter((p) => p !== 'meta').sort();
    expect([...PLAN_POOL_PROVIDERS].sort()).toEqual(envProviders);
  });

  it('bilinmeyen plan bos liste; donen dizi sabiti degistiremez', () => {
    expect(quota.getPlanPool('YOK')).toEqual([]);
    expect(quota.getPlanPool('toString')).toEqual([]);
    const pool = quota.getPlanPool('TRIAL');
    pool.push('meta');
    expect(quota.getPlanPool('TRIAL')).not.toContain('meta');
    expect(Object.isFrozen(PLAN_POOL_PROVIDERS)).toBe(true);
  });

  it('LIMITS kayitlarinda eski pool alani yok, kota sayilari aynen duruyor', () => {
    for (const [plan, row] of Object.entries(LIMITS)) expect('pool' in row, plan).toBe(false);
    const counts = Object.fromEntries(
      Object.entries(LIMITS).map(([plan, r]) => [plan, [r.articles, r.sites, r.citationTests]]),
    );
    expect(counts).toEqual({
      TRIAL: [2, 1, 3],
      STARTER: [15, 2, 20],
      PRO: [40, 5, 75],
      AGENCY: [100, 15, 300],
      ENTERPRISE: [350, 50, 1000],
    });
    expect(LIMITS.TRIAL.publishTargets).toEqual(['MARKDOWN_ZIP', 'WORDPRESS_REST']);
  });
});
