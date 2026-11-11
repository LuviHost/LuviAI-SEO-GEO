import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AiCitationService,
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
 * Meta AI icin hic yok. Durust neden: RanksUp'in anahtari tanimli degil,
 * saglayici su an olculmuyor. Meta (Kasim 2026'dan beri Muse) plan
 * listesinde olmasa da ayni nedeni alir; eski Llama/Groq nedenleri kalkti.
 *
 * Gercek QuotaService.getPlanPool kullanilir (her planda 6 asistan, Meta yok);
 * hicbir saglayicinin anahtari yok, fetch cagrilmamali. 'system' tetikleyici:
 * kota ve haftalik hak devre disi, yalniz anahtar cozumlemesi sinanir.
 */

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY',
  'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'META_MODEL_API_KEY', 'GROQ_API_KEY', 'GROQ_LLAMA_MODEL',
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
  expect(reason).not.toMatch(/_API_KEY|GROQ|\benv\b|BYOK|kendi API anahtar/i);
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

  it('Meta (Muse) anahtari yok: diger saglayicilarla ayni durust neden, istek yok', async () => {
    // Eski Groq degiskenleri artik Meta'yi acmaz
    process.env.GROQ_API_KEY = 'gsk-testkey';
    process.env.GROQ_LLAMA_MODEL = 'llama-ornek-model';
    const { svc, fetchSahte } = kur();
    const [pr] = await svc.runQueries('s1', ['soru 1'], { providers: ['meta'], trigger: 'system' });
    expect(pr.reason).toBe(noPoolKeyReason('meta'));
    expect(pr.reason).toBe('Meta AI (Muse) şu an ölçülmüyor: RanksUp anahtarı tanımlı değil.');
    teknikDegil(pr.reason);
    expect(fetchSahte).not.toHaveBeenCalled();
  });

  it('resolveKey: plan listesinde olmayan Meta da anahtar varsa havuzdan olculur', async () => {
    process.env.META_MODEL_API_KEY = 'mm-test';
    const { svc } = kur();
    const r = await (svc as any).resolveKey('s1', 'meta', 'PRO');
    expect(r).toEqual({ key: 'mm-test', source: 'pool' });
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
