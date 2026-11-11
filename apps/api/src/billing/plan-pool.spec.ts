import { describe, it, expect } from 'vitest';
import { BASE_ENGINES, BASE_PLANS, ENGINE_LABELS, STANDARD_ENGINES, enginesBullet, planEngines } from './plans.js';
import { PLAN_POOL_PROVIDERS, QuotaService } from './quota.service.js';
import { POOL_ENV_KEY } from '../audit/citation-providers.js';

/**
 * QuotaService.getPlanPool — plans.ts ile ayni asistanlar.
 *
 * NEDEN VAR: LIMITS[plan].pool plana gore 1-6 saglayici listeliyordu (TRIAL
 * yalniz gemini). Fiyat karti her planda "ChatGPT · Claude · Gemini ·
 * Perplexity · Grok · DeepSeek" satiyor ve olcum motoru env anahtari olan
 * saglayiciyi her planda olcuyor; bayat liste panel rozetini yaniltiyordu.
 * Temizlik kota SAYILARINA dokunmamali — asagidaki sabit tablo bunu kilitler.
 *
 * 11.11.2026 (uc paket): "her planda ayni 6 asistan" kurali kalkti. Havuz listesi
 * plan kapsamidir (plans.ts planEngines): Baslangic ve deneme DORT asistan (ChatGPT,
 * Gemini, Claude, Perplexity), Profesyonel ve ustu ALTI. Liste yine tek kaynaktan
 * gelir ve fiyat kartindaki asistan maddesiyle (enginesBullet) ayni adlari tasir.
 */

const quota = new QuotaService(null as never);
const LIMITS = Reflect.get(quota, 'LIMITS') as Record<string, Record<string, unknown>>;

/** Saglayici kimligi -> fiyat kartindaki ad */
const CARD_NAME: Record<string, string> = {
  openai: 'ChatGPT', anthropic: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity', xai: 'Grok', deepseek: 'DeepSeek',
};

describe('getPlanPool', () => {
  it('havuz = plan kapsami: Baslangic ve deneme 4 asistan, Profesyonel ve ustu 6; liste fiyat kartindaki adlarla birebir', () => {
    // Alti havuz asistani plans.ts'in her kurulumda olculen listesiyle ayni kume; kart adlari da ayni
    expect([...PLAN_POOL_PROVIDERS].sort()).toEqual([...BASE_ENGINES].sort());
    for (const p of PLAN_POOL_PROVIDERS) expect(ENGINE_LABELS[p as keyof typeof ENGINE_LABELS], p).toBe(CARD_NAME[p]);

    for (const p of BASE_PLANS) {
      const pool = quota.getPlanPool(p.id.toUpperCase());
      const kapsam = new Set<string>(planEngines(p.id));
      expect(pool, p.id).toEqual(PLAN_POOL_PROVIDERS.filter((x) => kapsam.has(x)));
      expect(pool.length, `${p.id} aiProviders`).toBe(p.aiProviders);
    }
    const dort = ['anthropic', 'gemini', 'openai', 'perplexity'];
    for (const plan of ['TRIAL', 'STARTER']) {
      expect(quota.getPlanPool(plan), plan).toEqual(dort);
      expect(quota.getPlanPool(plan), plan).not.toContain('xai');
      expect(quota.getPlanPool(plan), plan).not.toContain('deepseek');
    }
    for (const plan of ['PRO', 'AGENCY', 'ENTERPRISE']) expect(quota.getPlanPool(plan), plan).toEqual([...PLAN_POOL_PROVIDERS]);

    // Kart: Baslangic maddesi havuzundaki dort adi yazar; Profesyonel maddesi eklenen ikisini
    const kartAdlari = (madde: string) => Object.values(CARD_NAME).filter((ad) => madde.includes(ad)).sort();
    const olculen = [...BASE_ENGINES];
    expect(kartAdlari(enginesBullet('starter', 'tr', olculen))).toEqual(quota.getPlanPool('STARTER').map((x) => CARD_NAME[x]).sort());
    const eklenen = quota.getPlanPool('PRO').filter((x) => !quota.getPlanPool('STARTER').includes(x));
    expect(eklenen.sort()).toEqual(['deepseek', 'xai']);
    for (const x of eklenen) expect(enginesBullet('pro', 'tr', olculen), x).toContain(CARD_NAME[x]);
    expect([...STANDARD_ENGINES].sort()).toEqual([...dort].sort());
  });

  it('Meta AI (Muse) plan havuzunda yok — yalniz META_MODEL_API_KEY tanimliyken olculur; geri kalan her saglayicinin env adi var', () => {
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

  it('LIMITS kayitlarinda eski pool alani yok; kota sayilari plan tablosuyla ayni (Baslangic makale 0)', () => {
    for (const [plan, row] of Object.entries(LIMITS)) expect('pool' in row, plan).toBe(false);
    const counts = Object.fromEntries(
      Object.entries(LIMITS).map(([plan, r]) => [plan, [r.articles, r.sites, r.citationTests]]),
    );
    expect(counts).toEqual({
      TRIAL: [2, 1, 3],
      // 11.11.2026: Baslangic'ta makale uretimi yok (plans.ts articlesPerMonth 0); site ve calistirma ayni
      STARTER: [0, 2, 20],
      PRO: [40, 5, 75],
      AGENCY: [100, 15, 300],
      ENTERPRISE: [350, 50, 1000],
    });
    expect(LIMITS.TRIAL.publishTargets).toEqual(['MARKDOWN_ZIP', 'WORDPRESS_REST']);
  });
});
