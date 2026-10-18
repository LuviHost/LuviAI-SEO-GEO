import { describe, it, expect, vi, afterEach } from 'vitest';
import { AsoPromptLabService } from './aso-prompt-lab.service.js';
import { isUnconfiguredProvider } from '../audit/citation-providers.js';

/**
 * App Prompt Lab sonuc listesi: olcmedigimiz (yapilandirilmamis) asistanin
 * "Meta AI — Kullanılamadı" karti gosterilmez; yapilandirilmis ama bu olcumde
 * hata veren asistan "ölçülemedi" olarak kalir ve toplama girmez.
 */

const APP = { id: 'a1', siteId: 's1', name: 'Bütçem', appStoreId: '123', playStoreId: null, category: 'Finance', country: 'tr' };
const PROMPT = { id: 'p1', siteId: 's1', trackedAppId: 'a1', text: 'en iyi bütçe uygulaması hangisi?' };

function make(results: unknown[]) {
  const createMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    trackedApp: { findFirst: vi.fn().mockResolvedValue(APP) },
    geoPrompt: { findFirst: vi.fn().mockResolvedValue(PROMPT), update: vi.fn().mockResolvedValue({}) },
    site: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 's1', url: 'https://butcem.app' }) },
    geoPromptRun: { createMany },
  };
  const citation = { runPublicProbes: vi.fn().mockResolvedValue(results) };
  const svc = new AsoPromptLabService(prisma as any, citation as any, {} as any);
  return { svc, createMany };
}

const probe = (over: Record<string, unknown> = {}) => ({
  query: PROMPT.text, cited: false, brandMentioned: true, excerpt: 'Bütçem öne çıkıyor', appStoreRefs: [], competitors: [], ...over,
});

const RESULTS = [
  { provider: 'anthropic', label: 'Claude', available: true, probes: [probe()], cost: 0 },
  { provider: 'gemini', label: 'Gemini', available: true, probes: [probe({ brandMentioned: false, excerpt: 'HATA: rate_limited' })], cost: 0 },
  { provider: 'openai', label: 'ChatGPT', available: false, probes: [], reason: 'HATA: upstream_unavailable', cost: 0 },
  { provider: 'perplexity', label: 'Perplexity', available: false, probes: [], reason: 'NO_KEY', cost: 0 },
  { provider: 'meta', label: 'Meta AI', available: false, probes: [], reason: 'HATA: model_unavailable', cost: 0 },
];

describe('AsoPromptLabService.run — sağlayıcı listesi', () => {
  const saved = process.env.GROQ_LLAMA_MODEL;
  afterEach(() => {
    if (saved === undefined) delete process.env.GROQ_LLAMA_MODEL;
    else process.env.GROQ_LLAMA_MODEL = saved;
  });

  it('anahtarı olmayan ve modeli tanımsız Llama listelenmez; hata veren sağlayıcı "ölçülemedi" kalır', async () => {
    delete process.env.GROQ_LLAMA_MODEL;
    const { svc, createMany } = make(RESULTS);
    const r = await svc.run('s1', 'a1', 'p1');
    expect(r.providers.map((p) => p.provider)).toEqual(['anthropic', 'gemini', 'openai']);
    expect(r.providers.find((p) => p.provider === 'gemini')).toMatchObject({ available: false, reason: 'HATA: rate_limited' });
    expect(r.providers.find((p) => p.provider === 'openai')).toMatchObject({ available: false, reason: 'HATA: upstream_unavailable' });
    expect(r.summary).toEqual({ mentioned: 1, storeLinked: 0, total: 1, unmeasured: 2 });
    // Yalnız ölçülen sağlayıcı kayda geçer
    expect(createMany.mock.calls[0][0].data.map((row: any) => row.provider)).toEqual(['anthropic']);
  });

  it('GROQ_LLAMA_MODEL tanımlıyken hata veren Llama yapılandırılmış sayılır ve "ölçülemedi" görünür', async () => {
    process.env.GROQ_LLAMA_MODEL = 'yeni-llama-modeli';
    const { svc } = make(RESULTS);
    const r = await svc.run('s1', 'a1', 'p1');
    expect(r.providers.map((p) => p.provider)).toEqual(['anthropic', 'gemini', 'openai', 'meta']);
    expect(r.summary).toMatchObject({ total: 1, unmeasured: 3 });
  });
});

describe('isUnconfiguredProvider (sonuç satırı — audit/citation-providers.ts ile ortak kural)', () => {
  it('yalnız anahtarsız ya da model tanımsız Llama yapılandırılmamış sayılır', () => {
    expect(isUnconfiguredProvider({ provider: 'perplexity', available: false, reason: 'NO_KEY' }, {})).toBe(true);
    expect(isUnconfiguredProvider({ provider: 'meta', available: false, reason: 'HATA: model_unavailable' }, {})).toBe(true);
    expect(isUnconfiguredProvider({ provider: 'meta', available: false, reason: 'HATA: rate_limited' }, { GROQ_LLAMA_MODEL: 'x' })).toBe(false);
    expect(isUnconfiguredProvider({ provider: 'openai', available: false, reason: 'HATA: timeout' }, {})).toBe(false);
    // Ölçüldüyse (model varsayılanı yine de çalıştıysa) gösterilir
    expect(isUnconfiguredProvider({ provider: 'meta', available: true }, {})).toBe(false);
  });
});
