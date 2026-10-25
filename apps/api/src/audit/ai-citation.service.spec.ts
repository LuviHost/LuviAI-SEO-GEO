import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AI_COST_KV_TTL_DAYS, AiCitationService, LLAMA_UNCONFIGURED_REASON } from './ai-citation.service.js';

/**
 * Olcum servisinin anonim uca da acilan yolu (runPublicProbes) uzerinden:
 *  - saglayici govdesi (org kimligi, istek kimligi, istem yankisi) probe'a ve
 *    reason'a SIZMAZ; yalniz 'HATA: <kod>'
 *  - jenerik + alan adindan turetilmis markada yalin kelime anilma sayilmaz
 * Yalniz Perplexity anahtari verilir; fetch taklit edilir (ag yok).
 */

const PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY',
  'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'GROQ_API_KEY',
];
let backup: Record<string, string | undefined> = {};

beforeEach(() => {
  backup = Object.fromEntries(PROVIDER_KEYS.map((k) => [k, process.env[k]]));
  for (const k of PROVIDER_KEYS) delete process.env[k];
  process.env.PERPLEXITY_API_KEY = 'pplx-testkey-1234567890';
});
afterEach(() => {
  for (const [k, v] of Object.entries(backup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

function service() {
  const prisma = { $executeRawUnsafe: vi.fn(async () => 1) };
  return new AiCitationService(prisma as any, {} as any, {} as any, {} as any);
}

function respond(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

const answer = (content: string, citations: string[] = [], finish = 'stop') => ({
  choices: [{ message: { content }, finish_reason: finish }],
  citations,
});

async function perplexity(svc: AiCitationService, opts: { brand: string; host: string; queries: string[] }) {
  const out = await svc.runPublicProbes(opts);
  return { out, pr: out.find((r) => r.provider === 'perplexity')! };
}

describe('saglayici hatasi musteriye kod olarak gider', () => {
  it('4xx govdesi probe satirina ve cevaba sizmaz', async () => {
    respond(400, { error: { message: 'Invalid request for org-SECRET42 (req_abc123): prompt echo "en iyi emlak"' } });
    const { out, pr } = await perplexity(service(), { brand: 'Kobipratik', host: 'kobipratik.com', queries: ['soru 1'] });
    expect(pr.available).toBe(true);
    expect(pr.probes[0].excerpt).toBe('HATA: bad_request');
    const json = JSON.stringify(out);
    expect(json).not.toContain('org-SECRET42');
    expect(json).not.toContain('req_abc123');
    // diger saglayicilarin anahtari yok
    expect(out.find((r) => r.provider === 'openai')).toMatchObject({ available: false, reason: 'NO_KEY' });
  });

  it('kalici hata (401) saglayiciyi kullanilamaz yapar; reason kod, anahtar parcasi yok', async () => {
    respond(401, { error: { message: 'Incorrect API key provided: pplx-test****7890. Org org-XYZ' } });
    const { pr } = await perplexity(service(), { brand: 'Kobipratik', host: 'kobipratik.com', queries: ['soru 1', 'soru 2'] });
    expect(pr.available).toBe(false);
    expect(pr.reason).toBe('HATA: auth_failed');
    expect(pr.probes).toHaveLength(0);
  });

  it('bos cevap olcum sayilmaz: HATA satiri, saglayici metni yok', async () => {
    respond(200, answer('   ', [], 'length'));
    const { pr } = await perplexity(service(), { brand: 'Kobipratik', host: 'kobipratik.com', queries: ['soru 1'] });
    expect(pr.probes[0].excerpt).toBe('HATA: bos cevap (finish_reason=length)');
    expect(pr.probes[0].brandMentioned).toBe(false);
  });
});

/**
 * Groq eski Llama modelini kaldirdi: GROQ_LLAMA_MODEL tanimsizken Llama
 * anahtar olsa da CAGRILMAZ ve 'NO_KEY' doner (karne-html yalniz bunu kapsam
 * disi sayar; panel karnesi eskiden "Meta AI (Llama) — ölçülemedi" yaziyordu).
 */
describe('runPublicProbes — yapilandirilmamis Llama', () => {
  const ORJ_MODEL = process.env.GROQ_LLAMA_MODEL;
  afterEach(() => {
    if (ORJ_MODEL === undefined) delete process.env.GROQ_LLAMA_MODEL;
    else process.env.GROQ_LLAMA_MODEL = ORJ_MODEL;
  });

  it("GROQ_API_KEY var, GROQ_LLAMA_MODEL yok: Groq'a istek gitmez, reason tam 'NO_KEY'", async () => {
    process.env.GROQ_API_KEY = 'gsk-testkey';
    delete process.env.GROQ_LLAMA_MODEL;
    const fetchSahte = respond(200, answer('Kobipratik iyi bir secenek.'));
    const out = await service().runPublicProbes({ brand: 'Kobipratik', host: 'kobipratik.com', queries: ['soru 1'] });
    expect(out.find((r) => r.provider === 'meta')).toEqual({
      provider: 'meta', label: 'Meta AI (Llama)', available: false, probes: [], reason: 'NO_KEY', cost: 0,
    });
    const urls = fetchSahte.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('api.groq.com'))).toBe(false);
    // Anahtari olan saglayici calismaya devam eder
    expect(out.find((r) => r.provider === 'perplexity')?.available).toBe(true);
  });

  it('GROQ_LLAMA_MODEL tanimliyken Llama verilen modelle olculur', async () => {
    process.env.GROQ_API_KEY = 'gsk-testkey';
    process.env.GROQ_LLAMA_MODEL = 'yeni-llama';
    const fetchSahte = respond(200, answer('Kobipratik iyi bir secenek.'));
    // MODELS tablosu kurulumda okunur — env servis kurulmadan once verilir
    const out = await service().runPublicProbes({ brand: 'Kobipratik', host: 'kobipratik.com', queries: ['soru 1'] });
    expect(out.find((r) => r.provider === 'meta')).toMatchObject({ available: true });
    const groq = fetchSahte.mock.calls.find((c) => String(c[0]).includes('api.groq.com'));
    expect(JSON.parse(String((groq?.[1] as RequestInit).body)).model).toBe('yeni-llama');
  });
});

/**
 * Gunluk maliyet sayaci (kv_store 'ai-cost:...') suresiz yaziliyordu ve
 * satirlar sonsuza dek birikiyordu. Artik expiresAt yazilir; KvSweepCron siler.
 */
describe('addCost — maliyet sayaci suresi', () => {
  it('INSERT ve ON DUPLICATE KEY UPDATE expiresAt yazar; sayac artisi ve anahtar bicimi ayni', async () => {
    respond(200, answer('Kobipratik iyi bir secenek.'));
    const prisma = { $executeRawUnsafe: vi.fn(async () => 1) };
    const svc = new AiCitationService(prisma as any, {} as any, {} as any, {} as any);
    await svc.runPublicProbes({ brand: 'Kobipratik', host: 'kobipratik.com', queries: ['soru 1', 'soru 2'] });

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, key, value, inc] = prisma.$executeRawUnsafe.mock.calls[0] as unknown as [string, string, string, number];
    expect(key).toBe(`ai-cost:perplexity:${new Date().toISOString().slice(0, 10)}`);
    // perplexity tavani 0.0006 x 2 probe
    expect(Number(value)).toBeCloseTo(0.0012, 10);
    expect(inc).toBeCloseTo(0.0012, 10);
    const [insert, update] = sql.split('ON DUPLICATE KEY UPDATE');
    expect(insert).toContain('`expiresAt`');
    expect(insert).toContain(`UTC_TIMESTAMP(3) + INTERVAL ${AI_COST_KV_TTL_DAYS} DAY`);
    expect(update).toContain('CAST(CAST(`value` AS DECIMAL(18,8)) + ? AS CHAR)');
    expect(update).toContain(`\`expiresAt\` = UTC_TIMESTAMP(3) + INTERVAL ${AI_COST_KV_TTL_DAYS} DAY`);
    expect(AI_COST_KV_TTL_DAYS).toBeGreaterThanOrEqual(2);
  });
});

/**
 * Site olcumu (runQueries → runProvider): butun sorulari hata alan saglayici
 * "olculemedi"dir (available false, skor null), "0 puan" degil. Kismi hatada
 * payda yalniz olculen sorular. 'system' tetikleyici: kota/haftalik hak devre
 * disi, yalniz olcum yolu sinanir. 400 yeniden denenmez — test beklemez.
 */
function siteService() {
  const prisma = {
    appSetting: { findUnique: vi.fn(async () => null) },
    site: {
      findUnique: vi.fn(async () => ({
        id: 's1', name: 'Kobipratik', url: 'https://kobipratik.com', userId: 'u1', niche: 'finans', brain: null,
        user: { id: 'u1', plan: 'PRO', role: 'USER' },
      })),
    },
    siteAiProviderKey: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    kvStore: { findUnique: vi.fn(async () => null) },
    $queryRawUnsafe: vi.fn(async () => []),
    $executeRawUnsafe: vi.fn(async () => 1),
  };
  const quota = {
    getPlanPool: () => ['perplexity'],
    enforceCitationQuota: vi.fn(async () => undefined),
    incrementCitationUsage: vi.fn(async () => undefined),
  };
  const allowance = { reserveOutsideSession: vi.fn(async () => null), release: vi.fn(async () => undefined) };
  return { svc: new AiCitationService(prisma as any, quota as any, {} as any, allowance as any), prisma };
}

describe('runProvider — model tanimsiz Llama site olcumunde de cagrilmaz', () => {
  const ORJ_MODEL = process.env.GROQ_LLAMA_MODEL;
  afterEach(() => {
    if (ORJ_MODEL === undefined) delete process.env.GROQ_LLAMA_MODEL;
    else process.env.GROQ_LLAMA_MODEL = ORJ_MODEL;
  });

  it('anahtar olsa da istek yok; neden durust ("ölçülmüyor"), BYOK onerisi yok', async () => {
    process.env.GROQ_API_KEY = 'gsk-testkey';
    delete process.env.GROQ_LLAMA_MODEL;
    const fetchSahte = respond(200, answer('Kobipratik iyi.'));
    const { svc, prisma } = siteService();
    const [pr] = await svc.runQueries('s1', ['soru 1'], { providers: ['meta'], trigger: 'system' });
    expect(pr).toMatchObject({ provider: 'meta', available: false, score: null, probes: [], reason: LLAMA_UNCONFIGURED_REASON });
    expect(pr.reason).not.toMatch(/BYOK|anahtar/i);
    expect(fetchSahte).not.toHaveBeenCalled();
    expect(prisma.siteAiProviderKey.findUnique).not.toHaveBeenCalled();
  });
});

describe('runProvider — HATA satirlari skor degildir', () => {
  const SORULAR = ['soru 1', 'soru 2', 'soru 3', 'soru 4', 'soru 5'];

  it('5 sorunun 5i hata: available false, skor null, neden hata kodu; probe\'lar gosterim icin kalir', async () => {
    respond(400, { error: { message: 'bad request' } });
    const { svc, prisma } = siteService();
    const [pr] = await svc.runQueries('s1', SORULAR, { providers: ['perplexity'], trigger: 'system' });
    expect(pr).toMatchObject({ provider: 'perplexity', available: false, score: null, reason: 'HATA: bad_request', source: 'pool' });
    expect(pr.probes).toHaveLength(5);
    expect(pr.probes.every((p) => p.excerpt === 'HATA: bad_request')).toBe(true);
    // olculemeyen soru icin havuz maliyeti yazilmaz
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('1 basarili alinti + 4 hata: skor 100 (20 degil); ton dagiliminda hata "absent" sayilmaz', async () => {
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      n++;
      return n === 1
        ? new Response(JSON.stringify(answer('Karsilastirma icin kobipratik.com en iyi secenek.')), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    });
    const { svc } = siteService();
    const [pr] = await svc.runQueries('s1', SORULAR, { providers: ['perplexity'], trigger: 'system' });
    expect(pr.available).toBe(true);
    expect(pr.score).toBe(100);
    expect(pr.probes.filter((p) => p.excerpt?.startsWith('HATA:'))).toHaveLength(4);
    const mix = pr.sentimentMix!;
    expect(mix.positive + mix.neutral + mix.negative + mix.absent).toBe(1);
  });
});

describe('jenerik marka korumasi (CITATION_MATCH_VERSION 4)', () => {
  it('alan adindan turetilmis "Emlak": yalin kelime anilma ve markali soru sayilmaz', async () => {
    respond(200, answer('Emlak sektöründe en çok kullanılan siteler sahibinden.com ve hepsiemlak.com.'));
    const { pr } = await perplexity(service(), { brand: 'Emlak', host: 'emlak.com', queries: ['En iyi emlak siteleri hangileri?'] });
    const p = pr.probes[0];
    expect(p.brandMentioned).toBe(false);
    expect(p.brandInQuery).toBe(false); // soru markasiz havuza girer
    expect(p.cited).toBe(false);
  });

  it('ayni markada alan adi gecince anilma + alinti sayilir', async () => {
    respond(200, answer('Ilanlar icin emlak.com ve sahibinden.com bakilabilir.'));
    const { pr } = await perplexity(service(), { brand: 'Emlak', host: 'emlak.com', queries: ['En iyi emlak siteleri hangileri?'] });
    expect(pr.probes[0]).toMatchObject({ brandMentioned: true, cited: true });
    expect(pr.probes[0].position).toBe(1);
  });

  it('jenerik olmayan marka eski kurala tabi: yalin ad anilma sayilir', async () => {
    respond(200, answer('Kobipratik, KOBI finansmani icin karsilastirma sunar.'));
    const { pr } = await perplexity(service(), { brand: 'Kobipratik', host: 'kobipratik.com', queries: ['Kobipratik nedir?'] });
    expect(pr.probes[0]).toMatchObject({ brandMentioned: true, brandInQuery: true, cited: false });
  });
});

describe('anonim test tavan maliyeti (plannedPublicCost)', () => {
  it('yalniz anahtari olan saglayicilar x soru sayisi; anahtarsiz saglayici sayilmaz', () => {
    // beforeEach yalniz Perplexity anahtarini birakir: 0.0006 USD x 3 soru
    expect(service().plannedPublicCost(3)).toBeCloseTo(0.0018, 6);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-1234567890';
    expect(service().plannedPublicCost(3)).toBeCloseTo(0.0018 + 0.6, 6);
  });

  it('anonim defter anahtari havuz anahtarlarindan ayri', () => {
    expect(service().publicAnonCostKey('2026-10-25')).toBe('ai-cost:public-anon:2026-10-25');
  });
});
