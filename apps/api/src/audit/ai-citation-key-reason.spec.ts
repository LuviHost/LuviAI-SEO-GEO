import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AiCitationService,
  LLAMA_NO_MODEL_REASON,
  LLAMA_NO_POOL_KEY_REASON,
  LLAMA_UNCONFIGURED_REASON,
  noPoolKeyReason,
  type Provider,
} from './ai-citation.service.js';
import { QuotaService } from '../billing/quota.service.js';

/**
 * Anahtari olmayan saglayicinin nedeni (resolveKey) musteriye gider: site
 * olcumu sonucundaki reason, panel ve olcum gecmisinde aynen gorunur.
 *
 * NEDEN VAR: neden "OPENAI_API_KEY env yok" gibi teknik bir env adi ya da
 * "kendi API anahtarini bagla (BYOK)" diyordu. BYOK yalniz Kurumsal planda ve
 * Meta AI (Llama) icin hic yok; 4. adima bugun yalniz Meta ulasiyor (Llama
 * modeli tanimli, Groq anahtari yok). Durust neden: RanksUp'in anahtari
 * tanimli degil, saglayici su an olculmuyor.
 *
 * Gercek QuotaService.getPlanPool kullanilir (her planda 6 asistan, Meta yok);
 * hicbir saglayicinin anahtari yok, fetch cagrilmamali. 'system' tetikleyici:
 * kota ve haftalik hak devre disi, yalniz anahtar cozumlemesi sinanir.
 */

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY',
  'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'GROQ_API_KEY', 'GROQ_LLAMA_MODEL',
];
const ALTI: Provider[] = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek'];
let backup: Record<string, string | undefined> = {};

beforeEach(() => {
  backup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(backup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

function kur(plan = 'PRO') {
  const prisma = {
    appSetting: { findUnique: vi.fn(async () => null) },
    site: {
      findUnique: vi.fn(async () => ({
        id: 's1', name: 'Kobipratik', url: 'https://kobipratik.com', userId: 'u1', niche: 'finans', brain: null,
        user: { id: 'u1', plan, role: 'USER' },
      })),
    },
    siteAiProviderKey: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    kvStore: { findUnique: vi.fn(async () => null) },
    $executeRawUnsafe: vi.fn(async () => 1),
  };
  const quota = new QuotaService(prisma as any);
  const allowance = { reserveOutsideSession: vi.fn(async () => null), release: vi.fn(async () => undefined) };
  const fetchSahte = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('anahtarsiz saglayici icin istek atilmamali');
  });
  return { svc: new AiCitationService(prisma as any, quota, {} as any, allowance as any), fetchSahte };
}

/** Musteriye gidecek metinde teknik env adi ya da BYOK onerisi olmamali */
function teknikDegil(reason: string | undefined) {
  expect(reason).toBeTruthy();
  expect(reason).not.toMatch(/_API_KEY|GROQ_LLAMA_MODEL|\benv\b|BYOK|kendi API anahtar/i);
}

describe('resolveKey nedenleri — durust ve teknik ad icermiyor', () => {
  it('6 asistanin anahtari yoksa: "<Sağlayıcı> şu an ölçülmüyor: RanksUp anahtarı tanımlı değil."', async () => {
    const { svc, fetchSahte } = kur();
    const sonuc = await svc.runQueries('s1', ['soru 1'], { providers: ALTI, trigger: 'system' });
    expect(sonuc).toHaveLength(6);
    for (const r of sonuc) {
      expect(r).toMatchObject({ available: false, score: null, probes: [] });
      expect(r.reason).toBe(noPoolKeyReason(r.provider as Provider));
      expect(r.reason).toMatch(/şu an ölçülmüyor: RanksUp anahtarı tanımlı değil\.$/);
      teknikDegil(r.reason);
    }
    expect(sonuc.find((r) => r.provider === 'openai')!.reason).toBe('OpenAI ChatGPT şu an ölçülmüyor: RanksUp anahtarı tanımlı değil.');
    expect(fetchSahte).not.toHaveBeenCalled();
  });

  it('Meta: Llama modeli tanimli, Groq anahtari yok → Groq anahtari nedeni (BYOK onerisi yok)', async () => {
    process.env.GROQ_LLAMA_MODEL = 'llama-ornek-model';
    const { svc, fetchSahte } = kur();
    const [pr] = await svc.runQueries('s1', ['soru 1'], { providers: ['meta'], trigger: 'system' });
    expect(pr.reason).toBe(LLAMA_NO_POOL_KEY_REASON);
    expect(pr.reason).toBe('Meta AI (Llama) şu an ölçülmüyor: RanksUp’ın Groq anahtarı tanımlı değil.');
    teknikDegil(pr.reason);
    expect(fetchSahte).not.toHaveBeenCalled();
  });

  it('Meta: model tanimsizken olcum yolu resolveKey\'e gelmeden ayni durust nedeni verir', async () => {
    process.env.GROQ_API_KEY = 'gsk-testkey';
    const { svc, fetchSahte } = kur();
    const [pr] = await svc.runQueries('s1', ['soru 1'], { providers: ['meta'], trigger: 'system' });
    expect(pr.reason).toBe(LLAMA_UNCONFIGURED_REASON);
    expect(fetchSahte).not.toHaveBeenCalled();
  });

  it('resolveKey baska bir yoldan model tanimsiz Meta icin cagrilirsa model nedenini soyler', async () => {
    const { svc } = kur();
    const r = await (svc as any).resolveKey('s1', 'meta', 'PRO');
    expect(r).toEqual({ key: null, source: 'none', reason: LLAMA_NO_MODEL_REASON });
    expect(r.reason).toBe('Meta AI (Llama) şu an ölçülmüyor: RanksUp’ın Groq modeli tanımlı değil.');
    teknikDegil(r.reason);
  });

  it('plan listesi bos (bilinmeyen plan) olsa da BYOK onerisi yok, ayni durust neden', async () => {
    const { svc } = kur('BILINMEYEN');
    const r = await (svc as any).resolveKey('s1', 'perplexity', 'BILINMEYEN');
    expect(r).toEqual({ key: null, source: 'none', reason: noPoolKeyReason('perplexity') });
    teknikDegil(r.reason);
  });

  it('anahtar varsa davranis degismedi: RanksUp anahtariyla (pool) olculur', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-deepseek-test';
    const { svc } = kur();
    const r = await (svc as any).resolveKey('s1', 'deepseek', 'PRO');
    expect(r).toEqual({ key: 'sk-deepseek-test', source: 'pool' });
  });
});
