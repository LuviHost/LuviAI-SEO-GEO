import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  COST_PER_PROBE_USD, COST_PER_PROBE_USD_STANDARD, DAILY_BUDGET_DEFAULT_USD, PER_USER_BUDGET_SHARE, POOL_ENV_KEY,
  costPerProbe, isUnconfiguredProvider,
} from './citation-providers.js';
import { CITATION_TEKRAR_VARSAYILAN } from './citation-repeat.js';
import { FANOUT_DEFAULT_PROVIDERS, MAX_RUN_ALL } from './prompt-lab.service.js';
import { PURCHASABLE_PLAN_IDS, findPlan, planEngines, planModelTier, type PlanId } from '../billing/plans.js';
import type { Provider } from './ai-citation.service.js';

/**
 * Saglayici kurallari tek yerde: runPublicProbes (olcum oncesi), App Prompt Lab
 * (olcum sonrasi) ve karne CLI'i ayni fonksiyonu kullanir. Meta AI Kasim
 * 2026'dan beri Muse (Meta Model API); Llama/Groq'taki ek model kosulu yok —
 * tek kosul havuz anahtari.
 */
describe('isUnconfiguredProvider — olcum oncesi (saglayici adi)', () => {
  it('anahtar yoksa yapilandirilmamis; anahtar varsa yapilandirilmis', () => {
    expect(isUnconfiguredProvider('openai', {})).toBe(true);
    expect(isUnconfiguredProvider('openai', { OPENAI_API_KEY: '' })).toBe(true);
    expect(isUnconfiguredProvider('openai', { OPENAI_API_KEY: 'sk-x' })).toBe(false);
  });

  it('Meta yalniz META_MODEL_API_KEY ile yapilandirilmis; eski Groq degiskenleri ise yaramaz', () => {
    expect(isUnconfiguredProvider('meta', {})).toBe(true);
    expect(isUnconfiguredProvider('meta', { GROQ_API_KEY: 'gsk-x', GROQ_LLAMA_MODEL: 'yeni-llama' })).toBe(true);
    // Reklam entegrasyonunun META_APP_* degiskenleri olcum anahtari degildir
    expect(isUnconfiguredProvider('meta', { META_APP_ID: '1', META_APP_SECRET: 's' })).toBe(true);
    expect(isUnconfiguredProvider('meta', { META_MODEL_API_KEY: 'mm-x' })).toBe(false);
  });

  it('bilinmeyen saglayici adi yapilandirilmamis sayilir', () => {
    expect(isUnconfiguredProvider('mistral', { OPENAI_API_KEY: 'sk-x' })).toBe(true);
  });
});

describe('isUnconfiguredProvider — olcum sonrasi (sonuc satiri)', () => {
  it("'NO_KEY' listeden duser; HATA veren (cagrilmis) saglayici kalir", () => {
    expect(isUnconfiguredProvider({ provider: 'perplexity', available: false, reason: 'NO_KEY' }, {})).toBe(true);
    expect(isUnconfiguredProvider({ provider: 'meta', available: false, reason: 'NO_KEY' }, {})).toBe(true);
    // Cagrilmis (HATA) saglayici: anahtari vardi — ortam bugun anahtarsiz gorunse de listede kalir
    expect(isUnconfiguredProvider({ provider: 'openai', available: false, reason: 'HATA: timeout' }, {})).toBe(false);
    expect(isUnconfiguredProvider({ provider: 'meta', available: false, reason: 'HATA: rate_limited' }, {})).toBe(false);
    expect(isUnconfiguredProvider({ provider: 'meta', available: true }, {})).toBe(false);
  });
});

describe('tablolar', () => {
  it('her saglayicinin anahtar adi ve sifirdan buyuk maliyet tavani var', () => {
    for (const p of Object.keys(POOL_ENV_KEY)) {
      expect(COST_PER_PROBE_USD[p as keyof typeof COST_PER_PROBE_USD], p).toBeGreaterThan(0);
    }
    expect(POOL_ENV_KEY.meta).toBe('META_MODEL_API_KEY');
  });

  it('Meta Muse tavani web aramali fiyattan dusuk degil (muse-spark-1.3, 3000 cikti tokeni)', () => {
    // 25K girdi x $1.25/1M + 3000 cikti x $4.25/1M + 4 arama x $0.0025
    const alt = 25_000 * 1.25e-6 + 3000 * 4.25e-6 + 4 * 0.0025;
    expect(COST_PER_PROBE_USD.meta).toBeGreaterThanOrEqual(alt);
  });
});

/**
 * Model kademesi (11.11.2026, uc paket): Baslangic ve deneme Claude'u hizli modelle
 * (claude-haiku-5-5) olcer; butce guard'i ve maliyet defteri kademenin tavanini
 * kullanir (ai-citation.service isOverBudget / addCost → costPerProbe). Modeli
 * DEGISMEYEN saglayici iki kademede de ayni tavani alir.
 */
describe('costPerProbe — kademeye gore probe tavani', () => {
  const SAGLAYICILAR = Object.keys(POOL_ENV_KEY) as Array<keyof typeof COST_PER_PROBE_USD>;

  it('standard kademede Claude 0.13; gelismis tavanin (0.3) ustunde degil', () => {
    expect(costPerProbe('anthropic', 'standard')).toBe(0.13);
    expect(costPerProbe('anthropic', 'premium')).toBe(0.3);
    expect(costPerProbe('anthropic', 'premium')).toBe(COST_PER_PROBE_USD.anthropic);
    expect(costPerProbe('anthropic', 'standard')).toBeLessThanOrEqual(costPerProbe('anthropic', 'premium'));
    expect(costPerProbe('anthropic', 'standard')).toBeGreaterThan(0);
  });

  // Haiku 5.5'in iki fiyat karti var: istem 100K token ya da azsa $0.10 / $0.50, daha uzunsa
  // $0.50 / $2.50 per 1M. Tavan ortalama degil UST SINIR: pahali kartla 200K girdiye kadar tutmali.
  // (Ilk surum 0.05 idi; istem 100K'yi gecince gercek fatura tavani asiyordu — bagimsiz inceleme.)
  it('Claude standard tavani UST SINIR: beklenen kullanimi, ucuz kartin tamamini ve pahali karti 200K girdiye kadar kapsar', () => {
    const tavan = costPerProbe('anthropic', 'standard');
    const ARAMA = 2 * 0.01;
    const beklenen = 45_000 * 0.10e-6 + 3000 * 0.50e-6 + ARAMA;
    const ucuzKartSonu = 100_000 * 0.10e-6 + 3000 * 0.50e-6 + ARAMA;
    const pahaliKart = (girdi: number) => girdi * 0.50e-6 + 3000 * 2.50e-6 + ARAMA;
    expect(tavan).toBeGreaterThanOrEqual(beklenen);
    expect(tavan).toBeGreaterThanOrEqual(ucuzKartSonu);
    expect(tavan).toBeGreaterThanOrEqual(pahaliKart(100_001));
    expect(tavan).toBeGreaterThanOrEqual(pahaliKart(200_000));
  });

  it('modeli kademeye gore DEGISMEYEN her saglayici iki kademede de ayni tavani alir', () => {
    for (const p of SAGLAYICILAR) {
      if (p === 'anthropic' || p === 'openai') continue;
      expect(costPerProbe(p, 'standard'), p).toBe(COST_PER_PROBE_USD[p]);
      expect(costPerProbe(p, 'premium'), p).toBe(COST_PER_PROBE_USD[p]);
      expect(costPerProbe(p, 'standard'), p).toBeGreaterThan(0);
    }
    // Standard tablosunda yalniz modeli degisen saglayicilar var: Claude (Haiku) ve ChatGPT (gpt-6-luna)
    expect(Object.keys(COST_PER_PROBE_USD_STANDARD).sort()).toEqual(['anthropic', 'openai']);
  });

  // 11.11.2026 canli denemeler (kobipratik.com; ~/Desktop/model-denemesi-sonuc.txt ve -3-sonuc.txt):
  // soru basina olculen EN YUKSEK maliyetler. Tavan olculenin ALTINDA olamaz — eski Grok (0.10),
  // DeepSeek (0.05), Muse (0.08) ve Perplexity (0.0006) tavanlari olculen ORTALAMANIN bile altindaydi.
  it('tavanlar canli denemede olculen en yuksek maliyetin en az 1.25 kati (her asistan, iki kademe)', () => {
    const EN_YUKSEK: Array<[Parameters<typeof costPerProbe>[0], 'standard' | 'premium', number, string]> = [
      ['openai', 'premium', 0.1875, 'gpt-6-astra (15 cagri)'],
      ['openai', 'standard', 0.0321, 'gpt-6-luna'],
      ['anthropic', 'premium', 0.1690, 'claude-opus-5-5'],
      ['anthropic', 'standard', 0.0236, 'claude-haiku-5-5'],
      ['gemini', 'premium', 0.0293, 'gemini-3.5-flash-lite'],
      ['perplexity', 'premium', 0.0052, 'sonar'],
      ['xai', 'premium', 0.3177, 'grok-4.7 (132K girdi, 8 arama)'],
      ['deepseek', 'premium', 0.0844, 'deepseek-v4-pro'],
      ['meta', 'premium', 0.1412, 'muse-spark-1.3 (13 arama)'],
    ];
    for (const [p, kademe, olculen, model] of EN_YUKSEK) {
      expect(costPerProbe(p, kademe), `${model}: tavan ${costPerProbe(p, kademe)} / olculen ${olculen}`).toBeGreaterThanOrEqual(olculen * 1.25);
    }
    // ChatGPT amiral: 3 arama ve 40K girdi (10 / 50 USD per 1M, max_output_tokens 1500, arama 0.01)
    expect(costPerProbe('openai', 'premium')).toBeGreaterThanOrEqual(40_000 * 10e-6 + 1500 * 50e-6 + 3 * 0.01 - 0.01);
    // ChatGPT hizli: 3 arama ve tam 128K arama baglami (0.10 / 0.50 per 1M)
    expect(costPerProbe('openai', 'standard')).toBeGreaterThanOrEqual(128_000 * 0.10e-6 + 1500 * 0.50e-6 + 3 * 0.01);
    // Gemini 3 ve ustu: arama SORGUSU basina 0.014 USD — 5 sorguya kadar
    expect(costPerProbe('gemini')).toBeGreaterThanOrEqual(5 * 0.014);
    // Hizli kademe hicbir saglayicida gelismis kademeden pahali degil
    for (const p of SAGLAYICILAR) expect(costPerProbe(p, 'standard'), p).toBeLessThanOrEqual(costPerProbe(p, 'premium'));
  });

  it('kademe verilmezse gelismis (anonim test, karne, App Prompt Lab); hicbir kademe gelismis tavani asmaz; bilinmeyen saglayici 0', () => {
    for (const p of SAGLAYICILAR) {
      expect(costPerProbe(p), p).toBe(COST_PER_PROBE_USD[p]);
      expect(costPerProbe(p, 'standard'), p).toBeLessThanOrEqual(costPerProbe(p, 'premium'));
    }
    expect(costPerProbe('mistral' as never, 'standard')).toBe(0);
    expect(costPerProbe('mistral' as never)).toBe(0);
  });
});

// 11.11.2026 (bagimsiz inceleme): model atamasinda probe tavanlari buyudu (ChatGPT 0.03 → 0.50)
// ama gunluk havuz tavani yalniz TEK bir site olcumunu tasiyacak kadar buyutulmustu. Profesyonel
// musterinin hakki olan 50 soruluk "Tümünü çalıştır" yari yolda asistan kaybediyordu (Claude 25,
// ChatGPT ve Grok 30 soruda), kesilen sorular yine calistirma hakkindan dusuyordu. Kural artik
// sabit: SATISTAKI her planin bir gunde hakki olan en buyuk is kiraci payina sigar.
describe('gunluk havuz tavani — kiraci payi satistaki planin bir gunluk hakkini tasir', () => {
  const servis = readFileSync(new URL('./ai-citation.service.ts', import.meta.url), 'utf8');
  /** Site / kurulum olcumu: varsayilan soru sayisi x tekrar (runForSite maxProbes, citation-repeat) */
  const SITE_SORU = 5;
  const siteOlcumu = SITE_SORU * CITATION_TEKRAR_VARSAYILAN;

  it('varsayimlar koddan: site olcumu 5 soru x 3 tekrar, pay 0.5, servis tavanlari bu tablodan okur', () => {
    expect(servis).toContain('maxProbes = 5,');
    expect(CITATION_TEKRAR_VARSAYILAN).toBe(3);
    // 0.25 → 0.5 (sahip, 11.11.2026): tavan iki Profesyonel hesabin en agir gununu tasir; pay 0.25
    // olsaydi ayni hak icin global tavanin dort kati gerekirdi (ChatGPT 180 USD)
    expect(PER_USER_BUDGET_SHARE).toBe(0.5);
    expect(servis).toContain('private readonly PER_USER_BUDGET_SHARE = PER_USER_BUDGET_SHARE;');
    for (const [saglayici, env] of [['anthropic', 'ANTHROPIC'], ['gemini', 'GEMINI'], ['openai', 'OPENAI'], ['perplexity', 'PERPLEXITY'], ['xai', 'GROK'], ['deepseek', 'DEEPSEEK'], ['meta', 'META']] as const) {
      expect(servis, saglayici).toMatch(new RegExp(`${saglayici}:\\s+parseFloat\\(process\\.env\\.AI_BUDGET_${env}_USD\\s+\\?\\? String\\(DAILY_BUDGET_DEFAULT_USD\\.${saglayici}\\)\\)`));
    }
  });

  /**
   * Bir hesabin BIR GUNDE bir asistana sordurabilecegi en cok soru: kurulum / site olcumu
   * + Prompt Lab. Prompt Lab'de her soru ve her dal 1 calistirma; haftada tek istek oldugu
   * icin en kotu gun aylik hakkin tamaminin tek istekte kullanilmasidir. Dallar yalniz
   * FANOUT_DEFAULT_PROVIDERS'a sorulur; diger asistanlar en cok MAX_RUN_ALL ana soru gorur.
   */
  const gunlukSoru = (planId: PlanId, saglayici: Provider): number => {
    const plan = findPlan(planId)!;
    const promptLab = FANOUT_DEFAULT_PROVIDERS.includes(saglayici) ? plan.aiRunsPerMonth : Math.min(MAX_RUN_ALL, plan.aiRunsPerMonth);
    return siteOlcumu + promptLab;
  };

  it('satistaki her plan (ve deneme): en agir gun her asistanda kiraci payina sigar', () => {
    for (const planId of ['trial', ...PURCHASABLE_PLAN_IDS] as PlanId[]) {
      const kademe = planModelTier(planId);
      for (const saglayici of planEngines(planId) as Provider[]) {
        const ihtiyac = gunlukSoru(planId, saglayici) * costPerProbe(saglayici, kademe);
        const pay = DAILY_BUDGET_DEFAULT_USD[saglayici] * PER_USER_BUDGET_SHARE;
        expect(pay, `${planId} / ${saglayici}: ${gunlukSoru(planId, saglayici)} soru x ${costPerProbe(saglayici, kademe)} = ${ihtiyac.toFixed(2)} USD, pay ${pay.toFixed(2)}`)
          .toBeGreaterThanOrEqual(ihtiyac);
      }
    }
  });

  it('Profesyonel: ChatGPT / Claude / Gemini 90 soru, digerleri 65 soru; tavanlar bu hesabin ustunde ama bir bucuk katindan az', () => {
    expect(gunlukSoru('pro', 'openai')).toBe(90);
    expect(gunlukSoru('pro', 'xai')).toBe(65);
    // Gereksiz genis tavan kacak / dongu emniyetini bosa cikarir: her tavan ihtiyacin 1.5 katinin altinda
    // (Perplexity haric — probe tavani 0.008, 5 USD'lik taban zaten kucuk)
    for (const saglayici of (planEngines('pro') as Provider[]).filter((p) => p !== 'perplexity')) {
      const ihtiyacTavan = (gunlukSoru('pro', saglayici) * costPerProbe(saglayici, 'premium')) / PER_USER_BUDGET_SHARE;
      expect(DAILY_BUDGET_DEFAULT_USD[saglayici], saglayici).toBeLessThan(ihtiyacTavan * 1.5);
    }
    expect(DAILY_BUDGET_DEFAULT_USD).toEqual({ anthropic: 60, gemini: 20, openai: 100, perplexity: 5, xai: 70, deepseek: 25, meta: 40 });
    // Global tavan iki Profesyonel hesabin en agir gununu tasir (pay 0.5): ucuncusu icin env buyutulur
    for (const saglayici of planEngines('pro') as Provider[]) {
      expect(DAILY_BUDGET_DEFAULT_USD[saglayici], saglayici).toBeGreaterThanOrEqual(2 * gunlukSoru('pro', saglayici) * costPerProbe(saglayici, 'premium'));
    }
  });

  it('butce asimi metni tutar ve "BYOK" yazmaz (asilan cogu zaman kiraci payi; BYOK yalniz Kurumsal)', () => {
    const metin = servis.slice(servis.indexOf('poolBudgetReason(_provider: Provider): string {'));
    expect(metin.slice(0, 200)).toContain("return 'Bu asistan için bugünkü ölçüm sınırına ulaşıldı; yarın yeniden ölçülebilir.';");
    expect(servis).not.toMatch(/BYOK ekleyebilir/);
  });
});
