import { describe, it, expect } from 'vitest';
import { COST_PER_PROBE_USD, COST_PER_PROBE_USD_STANDARD, POOL_ENV_KEY, costPerProbe, isUnconfiguredProvider } from './citation-providers.js';

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

  it('standard kademede Claude 0.13; gelismis tavanin (0.2) ustunde degil', () => {
    expect(costPerProbe('anthropic', 'standard')).toBe(0.13);
    expect(costPerProbe('anthropic', 'premium')).toBe(0.2);
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

  it('diger her saglayici iki kademede de gelismis tavanini alir', () => {
    for (const p of SAGLAYICILAR) {
      if (p === 'anthropic') continue;
      expect(costPerProbe(p, 'standard'), p).toBe(COST_PER_PROBE_USD[p]);
      expect(costPerProbe(p, 'premium'), p).toBe(COST_PER_PROBE_USD[p]);
      expect(costPerProbe(p, 'standard'), p).toBeGreaterThan(0);
    }
    // Standard tablosunda yalniz modeli degisen saglayici var
    expect(Object.keys(COST_PER_PROBE_USD_STANDARD)).toEqual(['anthropic']);
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
