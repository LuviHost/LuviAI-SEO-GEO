import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Olcum motoru plan KAPSAMINI ve MODEL KADEMESINI gercekten dayatiyor (11.11.2026, uc paket).
 *
 * NEDEN VAR: fiyat karti Baslangic'i (ve denemeyi) dort asistan — ChatGPT, Gemini, Claude,
 * Perplexity — ve hizli modellerle, Profesyonel ve ustunu Grok, DeepSeek ve (anahtari
 * tanimliysa) Muse eklenmis halde, gelismis modellerle satiyor. Kural yalniz kartta kalirsa
 * motor her planda butun asistanlari en pahali modelle olcmeye devam eder (alt paket
 * musterisi ust paketi bedavaya alir) ya da tersine ust paket musterisi parasini verdigi
 * asistani alamaz. Kural billing/plan-engines.ts'te; bu dosya motorun onu UYGULADIGINI
 * saglayici cagrilarindan okur.
 *
 * Gercek AiCitationService + gercek QuotaService. Ag yok: Claude ve DeepSeek (Anthropic
 * SDK'si, DeepSeek kendi baseURL'iyle), Gemini SDK'si ve fetch (ChatGPT, Perplexity, Grok,
 * Muse) taklit edilir; her cagri kaydedilir. YEDI saglayicinin da havuz anahtari tanimli:
 * bir asistan sorulmadiysa nedeni anahtar eksigi degil plan kapsamidir.
 */

const anthropicCreate = vi.fn();
const deepseekCreate = vi.fn();
const geminiGenerate = vi.fn();

// DeepSeek Anthropic SDK'sini kendi baseURL'iyle kullanir; cagrilar ayri izlenir
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages: { create: (...a: any[]) => any };
    constructor(opts: any = {}) {
      const ds = String(opts.baseURL ?? '').includes('deepseek');
      this.messages = { create: (...a: any[]) => (ds ? deepseekCreate : anthropicCreate)(...a) };
    }
  },
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent: geminiGenerate }; },
}));

const { AiCitationService } = await import('./ai-citation.service.js');
const { COST_PER_PROBE_USD, POOL_ENV_KEY, costPerProbe } = await import('./citation-providers.js');
const { QuotaService } = await import('../billing/quota.service.js');
const { ownerEngines, ownerModelTier } = await import('../billing/plan-engines.js');

type Saglayici = 'anthropic' | 'gemini' | 'openai' | 'perplexity' | 'xai' | 'deepseek' | 'meta';
const YEDI: Saglayici[] = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek', 'meta'];
const DORT: Saglayici[] = ['anthropic', 'gemini', 'openai', 'perplexity'];
const KAPSAM_DISI: Saglayici[] = ['xai', 'deepseek', 'meta'];

// Model env'leri de temizlenir: servis modeli kurulurken env'den okur, varsayilanlar sinanir
const ENV_KEYS = [...new Set([
  ...Object.values(POOL_ENV_KEY), 'GEMINI_API_KEY',
  'ANTHROPIC_CITATION_MODEL', 'ANTHROPIC_CITATION_MODEL_STANDARD', 'GEMINI_CITATION_MODEL', 'OPENAI_CITATION_MODEL',
  'XAI_CITATION_MODEL', 'DEEPSEEK_CITATION_MODEL', 'META_CITATION_MODEL', 'CITATION_TEKRAR',
])];
let backup: Record<string, string | undefined> = {};

const CEVAP = 'Bu konuda Kobipratik onerilir; ayrintilar kobipratik.com adresinde.';
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** fetch taklidi: Perplexity sohbet bicimi; ChatGPT, Grok ve Muse Responses API bicimi */
function taklitFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
    const u = String(url);
    if (u.includes('api.perplexity.ai')) return json({ choices: [{ message: { content: CEVAP }, finish_reason: 'stop' }], citations: [] });
    return json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: CEVAP, annotations: [] }] }] });
  });
}
let fetchSpy: ReturnType<typeof taklitFetch>;

beforeEach(() => {
  backup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  for (const p of YEDI) process.env[POOL_ENV_KEY[p]] = `anahtar-${p}`;
  for (const f of [anthropicCreate, deepseekCreate, geminiGenerate]) f.mockReset();
  anthropicCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: CEVAP }] });
  deepseekCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: CEVAP }] });
  geminiGenerate.mockResolvedValue({ text: CEVAP, candidates: [{ finishReason: 'STOP', groundingMetadata: { groundingChunks: [] } }] });
  fetchSpy = taklitFetch();
});
afterEach(() => {
  for (const [k, v] of Object.entries(backup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

const SORULAR = ['kobi kredisi nereden bakilir?', 'kredi karsilastirma sitesi hangisi?'];

function kur(plan: string, role = 'USER') {
  const user = { id: 'u1', plan, role, aiCitationTestsThisMonth: 0, aiCitationQuotaResetAt: new Date() };
  const maliyet: Array<{ key: string; cost: number }> = [];
  const prisma = {
    appSetting: { findUnique: vi.fn(async () => null) },
    site: {
      findUnique: vi.fn(async () => ({
        id: 's1', name: 'Kobipratik', url: 'https://kobipratik.com', userId: 'u1', niche: 'finans',
        brain: { seoStrategy: { aeoQueries: SORULAR } },
        user: { id: 'u1', plan, role },
      })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ ...user })),
      update: vi.fn(async ({ data }: any) => {
        if (data?.aiCitationTestsThisMonth?.increment) user.aiCitationTestsThisMonth += data.aiCitationTestsThisMonth.increment;
        return { ...user };
      }),
    },
    siteAiProviderKey: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    kvStore: { findUnique: vi.fn(async () => null) },
    $queryRawUnsafe: vi.fn(async () => []),
    // bumpCostKey: (sql, anahtar, String(tutar), tutar)
    $executeRawUnsafe: vi.fn(async (_sql: string, key: string, _v: string, cost: number) => { maliyet.push({ key, cost }); return 1; }),
  };
  const quota = new QuotaService(prisma as any);
  const allowance = { reserveOutsideSession: vi.fn(async () => null), release: vi.fn(async () => undefined) };
  const svc = new AiCitationService(prisma as any, quota, {} as any, allowance as any);
  return { svc, prisma, user, maliyet };
}

/** Hangi saglayiciya GERCEKTEN istek gitti (SDK cagrilari + fetch adresleri) */
function sorulanlar(): Saglayici[] {
  const adresler = fetchSpy.mock.calls.map((c: any[]) => String(c[0]));
  const out: Saglayici[] = [];
  if (anthropicCreate.mock.calls.length) out.push('anthropic');
  if (geminiGenerate.mock.calls.length) out.push('gemini');
  if (adresler.some((u: string) => u.includes('api.openai.com'))) out.push('openai');
  if (adresler.some((u: string) => u.includes('api.perplexity.ai'))) out.push('perplexity');
  if (adresler.some((u: string) => u.includes('api.x.ai'))) out.push('xai');
  if (deepseekCreate.mock.calls.length) out.push('deepseek');
  if (adresler.some((u: string) => u.includes('api.meta.ai'))) out.push('meta');
  return out;
}
/** fetch ile giden isteklerin govdeleri, adrese gore */
const govdeler = (parca: string) => fetchSpy.mock.calls
  .filter((c: any[]) => String(c[0]).includes(parca))
  .map((c: any[]) => JSON.parse(String((c[1] as RequestInit).body)));

describe('runForSite — plan kapsami: hangi asistana sorulur', () => {
  it('Baslangic ve deneme: yalniz dort asistan sorulur; Grok, DeepSeek ve Muse anahtari tanimli olsa da SORULMAZ, sonucta da yok', async () => {
    for (const plan of ['STARTER', 'TRIAL']) {
      for (const f of [anthropicCreate, deepseekCreate, geminiGenerate]) f.mockClear();
      fetchSpy.mockClear();
      const { svc } = kur(plan);
      const res = await svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });

      expect(sorulanlar(), plan).toEqual(DORT);
      expect(res.map((r) => r.provider).sort(), plan).toEqual([...DORT].sort());
      for (const r of res) expect(r, `${plan}/${r.provider}`).toMatchObject({ available: true, source: 'pool' });
      // Kapsam disi asistana tek istek bile gitmedi
      expect(deepseekCreate, plan).not.toHaveBeenCalled();
      expect(fetchSpy.mock.calls.map((c: any[]) => String(c[0])).filter((u: string) => /api\.x\.ai|api\.meta\.ai|deepseek/.test(u)), plan).toEqual([]);
      for (const p of KAPSAM_DISI) expect(res.find((r) => r.provider === p), `${plan}/${p}`).toBeUndefined();
      // Kapsamdaki dort asistana her soru bir kez soruldu
      expect(anthropicCreate, plan).toHaveBeenCalledTimes(SORULAR.length);
      expect(geminiGenerate, plan).toHaveBeenCalledTimes(SORULAR.length);
      expect(govdeler('api.openai.com'), plan).toHaveLength(SORULAR.length);
      expect(govdeler('api.perplexity.ai'), plan).toHaveLength(SORULAR.length);
    }
  });

  it('Profesyonel, Ajans (mevcut hesap) ve Kurumsal: alti asistan + anahtari tanimli Muse sorulur', async () => {
    for (const plan of ['PRO', 'AGENCY', 'ENTERPRISE']) {
      for (const f of [anthropicCreate, deepseekCreate, geminiGenerate]) f.mockClear();
      fetchSpy.mockClear();
      const { svc } = kur(plan);
      const res = await svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });

      expect(sorulanlar(), plan).toEqual(YEDI);
      expect(res.map((r) => r.provider).sort(), plan).toEqual([...YEDI].sort());
      for (const r of res) expect(r, `${plan}/${r.provider}`).toMatchObject({ available: true, source: 'pool' });
      expect(deepseekCreate, plan).toHaveBeenCalledTimes(SORULAR.length);
      expect(govdeler('api.x.ai'), plan).toHaveLength(SORULAR.length);
      expect(govdeler('api.meta.ai'), plan).toHaveLength(SORULAR.length);
    }
  });

  it('Profesyonel: Muse anahtari YOKSA Muse sorulmaz (kosullu asistan); Grok ve DeepSeek yine sorulur', async () => {
    delete process.env[POOL_ENV_KEY.meta];
    const { svc } = kur('PRO');
    const res = await svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });
    expect(sorulanlar()).toEqual(YEDI.filter((p) => p !== 'meta'));
    expect(govdeler('api.meta.ai')).toHaveLength(0);
    expect(res.find((r) => r.provider === 'meta')).toMatchObject({ available: false, probes: [] });
    for (const p of ['xai', 'deepseek']) expect(res.find((r) => r.provider === p), p).toMatchObject({ available: true });
  });

  it('ADMIN muaf: Baslangic / deneme planindaki yonetici hesabi butun asistanlarla, gelismis modelle olcer', async () => {
    for (const plan of ['STARTER', 'TRIAL']) {
      for (const f of [anthropicCreate, deepseekCreate, geminiGenerate]) f.mockClear();
      fetchSpy.mockClear();
      const { svc } = kur(plan, 'ADMIN');
      const res = await svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });
      expect(sorulanlar(), plan).toEqual(YEDI);
      expect(res).toHaveLength(7);
      for (const c of anthropicCreate.mock.calls) expect(c[0].model, plan).toBe('claude-opus-5-5');
    }
  });

  it('kullanici tetikli olcum (kota yolu) ayni kapsami uygular; calistirma sayaci bir kez artar', async () => {
    const baslangic = kur('STARTER');
    const res = await baslangic.svc.runForSite('s1', 5, { tekrar: 1 });
    expect(sorulanlar()).toEqual(DORT);
    expect(res.map((r) => r.provider).sort()).toEqual([...DORT].sort());
    expect(baslangic.user.aiCitationTestsThisMonth).toBe(1);
  });

  it('motorun sordugu kume her planda plan-engines kuraliyla (ownerEngines ∩ anahtari olanlar) birebir ayni', async () => {
    for (const [plan, role] of [['TRIAL', 'USER'], ['STARTER', 'USER'], ['PRO', 'USER'], ['AGENCY', 'USER'], ['ENTERPRISE', 'USER'], ['STARTER', 'ADMIN']] as const) {
      for (const f of [anthropicCreate, deepseekCreate, geminiGenerate]) f.mockClear();
      fetchSpy.mockClear();
      const { svc } = kur(plan, role);
      await svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });
      const kural = new Set<string>(ownerEngines({ plan, role }));
      expect(sorulanlar(), `${plan}/${role}`).toEqual(YEDI.filter((p) => kural.has(p)));
    }
  });
});

describe('runForSite — model kademesi: Claude hangi modelle ve hangi arama araciyla sorulur', () => {
  it('standard kademe (Baslangic, deneme): claude-haiku-5-5 + web_search_20250305', async () => {
    for (const plan of ['STARTER', 'TRIAL']) {
      anthropicCreate.mockClear();
      expect(ownerModelTier({ plan, role: 'USER' }), plan).toBe('standard');
      await kur(plan).svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });
      expect(anthropicCreate.mock.calls.length, plan).toBe(SORULAR.length);
      for (const c of anthropicCreate.mock.calls) {
        expect(c[0].model, plan).toBe('claude-haiku-5-5');
        expect(c[0].tools, plan).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]);
        expect(c[0].max_tokens, plan).toBe(3000);
      }
    }
  });

  it('sonuc, olcumun yapildigi kademeyi tasir (kaydi yazanlar yontem surumunu bundan damgalar)', async () => {
    for (const [plan, kademe] of [['TRIAL', 'standard'], ['STARTER', 'standard'], ['PRO', 'premium'], ['AGENCY', 'premium'], ['ENTERPRISE', 'premium']] as const) {
      const out = await kur(plan).svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });
      expect(out.length, plan).toBeGreaterThan(0);
      expect(out.every((r) => r.modelTier === kademe), plan).toBe(true);
    }
    const admin = await kur('STARTER', 'ADMIN').svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });
    expect(admin.every((r) => r.modelTier === 'premium')).toBe(true);
  });

  it('premium kademe (Profesyonel, Ajans, Kurumsal): claude-opus-5-5 + web_search_20260209', async () => {
    for (const plan of ['PRO', 'AGENCY', 'ENTERPRISE']) {
      anthropicCreate.mockClear();
      expect(ownerModelTier({ plan, role: 'USER' }), plan).toBe('premium');
      await kur(plan).svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });
      expect(anthropicCreate.mock.calls.length, plan).toBe(SORULAR.length);
      for (const c of anthropicCreate.mock.calls) {
        expect(c[0].model, plan).toBe('claude-opus-5-5');
        expect(c[0].tools, plan).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }]);
        expect(c[0].max_tokens, plan).toBe(3000);
      }
    }
  });

  it('ChatGPT kademeye gore: Baslangic gpt-6-luna, Profesyonel gpt-6-astra; Gemini ve Perplexity iki kademede de AYNI modelle', async () => {
    const modeller = async (plan: string) => {
      for (const f of [anthropicCreate, deepseekCreate, geminiGenerate]) f.mockClear();
      fetchSpy.mockClear();
      await kur(plan).svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });
      return {
        openai: [...new Set(govdeler('api.openai.com').map((b: any) => b.model))],
        perplexity: [...new Set(govdeler('api.perplexity.ai').map((b: any) => b.model))],
        gemini: [...new Set(geminiGenerate.mock.calls.map((c: any[]) => c[0].model))],
      };
    };
    const standard = await modeller('STARTER');
    const premium = await modeller('PRO');
    // 11.11.2026 (sahip: "Baslangic hesapli, premium kalite"): ChatGPT'de hizli ve amiral model
    expect(standard.openai).toEqual(['gpt-6-luna']);
    expect(premium.openai).toEqual(['gpt-6-astra']);
    // Gemini ve Perplexity'de olcume uygun ust model yok (canli deneme): iki kademe ayni
    expect(standard.gemini).toEqual(['gemini-3.5-flash-lite']);
    expect(premium.gemini).toEqual(standard.gemini);
    expect(standard.perplexity).toEqual(['sonar']);
    expect(premium.perplexity).toEqual(standard.perplexity);
    // Deneme hesabi Baslangic ile, Ajans ve Kurumsal Profesyonel ile ayni modelleri kullanir
    expect(await modeller('TRIAL')).toEqual(standard);
    for (const plan of ['AGENCY', 'ENTERPRISE']) expect(await modeller(plan), plan).toEqual(premium);
    // ChatGPT istegi iki kademede de ayni bicim: arama zorunlu, cikti tavani 1500 (maliyet tavani buna gore)
    for (const b of govdeler('api.openai.com')) {
      expect(b.tools).toEqual([{ type: 'web_search' }]);
      expect(b.tool_choice).toBe('required');
      expect(b.max_output_tokens).toBe(1500);
    }
  });

  it('havuz maliyeti kademenin tavaniyla yazilir: Claude 0.13 / 0.3, ChatGPT 0.05 / 0.50 (global + kiraci defteri); Gemini ve Perplexity ayni', async () => {
    const defter = async (plan: string) => {
      const t = kur(plan);
      await t.svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });
      const tutar = (p: string) => t.maliyet.filter((m) => m.key.startsWith(`ai-cost:${p}:`)).map((m) => m.cost);
      return { tutar, t };
    };
    const standard = await defter('STARTER');
    expect(costPerProbe('anthropic', 'standard')).toBe(0.13);
    for (const c of standard.tutar('anthropic')) expect(c).toBeCloseTo(SORULAR.length * 0.13, 10);
    expect(standard.tutar('anthropic')).toHaveLength(2);
    // Kapsam disi asistana maliyet de yazilmadi
    for (const p of KAPSAM_DISI) expect(standard.tutar(p), p).toEqual([]);

    const premium = await defter('PRO');
    for (const c of premium.tutar('anthropic')) expect(c).toBeCloseTo(SORULAR.length * COST_PER_PROBE_USD.anthropic, 10);
    expect(premium.tutar('anthropic')).toHaveLength(2);
    for (const p of ['gemini', 'perplexity'] as const) {
      expect(standard.tutar(p), p).toEqual(premium.tutar(p));
      for (const c of premium.tutar(p)) expect(c, p).toBeCloseTo(SORULAR.length * COST_PER_PROBE_USD[p], 10);
    }
    // ChatGPT: hizli model tavani 0.05, amiral model tavani 0.50 — defter kademenin tavaniyla
    expect(costPerProbe('openai', 'standard')).toBe(0.05);
    expect(costPerProbe('openai', 'premium')).toBe(0.5);
    for (const c of standard.tutar('openai')) expect(c).toBeCloseTo(SORULAR.length * 0.05, 10);
    for (const c of premium.tutar('openai')) expect(c).toBeCloseTo(SORULAR.length * 0.5, 10);
    expect(standard.tutar('openai')).toHaveLength(2);
    expect(premium.tutar('openai')).toHaveLength(2);
    for (const p of KAPSAM_DISI) expect(premium.tutar(p).length, p).toBe(2);
  });
});

describe('runQueries (Prompt Lab, fan-out, urun radari) — istenen liste plan kapsamiyla kesisir', () => {
  it('Baslangic: liste verilmezse dort asistan; Grok / DeepSeek / Muse acikca istenmis olsa da sorulmaz', async () => {
    const a = kur('STARTER');
    const hepsi = await a.svc.runQueries('s1', [SORULAR[0]], { trigger: 'system' });
    expect(sorulanlar()).toEqual(DORT);
    expect(hepsi.map((r) => r.provider).sort()).toEqual([...DORT].sort());
    for (const c of anthropicCreate.mock.calls) expect(c[0].model).toBe('claude-haiku-5-5');

    for (const f of [anthropicCreate, deepseekCreate, geminiGenerate]) f.mockClear();
    fetchSpy.mockClear();
    const dal = await kur('STARTER').svc.runQueries('s1', [SORULAR[0]], { providers: ['xai', 'openai', 'deepseek', 'meta'], trigger: 'system' });
    expect(sorulanlar()).toEqual(['openai']);
    expect(dal.map((r) => r.provider)).toEqual(['openai']);

    for (const f of [anthropicCreate, deepseekCreate, geminiGenerate]) f.mockClear();
    fetchSpy.mockClear();
    const yalnizDisi = await kur('TRIAL').svc.runQueries('s1', [SORULAR[0]], { providers: ['xai', 'deepseek', 'meta'], trigger: 'system' });
    expect(sorulanlar()).toEqual([]);
    expect(yalnizDisi).toEqual([]);
  });

  it('Profesyonel: istenen asistanlar oldugu gibi sorulur; liste verilmezse yedisi', async () => {
    const dal = await kur('PRO').svc.runQueries('s1', [SORULAR[0]], { providers: ['xai', 'openai', 'deepseek', 'meta'], trigger: 'system' });
    expect(sorulanlar()).toEqual(['openai', 'xai', 'deepseek', 'meta']);
    expect(dal.map((r) => r.provider).sort()).toEqual(['deepseek', 'meta', 'openai', 'xai']);

    for (const f of [anthropicCreate, deepseekCreate, geminiGenerate]) f.mockClear();
    fetchSpy.mockClear();
    await kur('PRO').svc.runQueries('s1', [SORULAR[0]], { trigger: 'system' });
    expect(sorulanlar()).toEqual(YEDI);
    for (const c of anthropicCreate.mock.calls) expect(c[0].model).toBe('claude-opus-5-5');
  });
});

describe('getProviderStatus — plan disi asistan ne havuzda ne etkin kaynak', () => {
  it('Baslangic ve deneme: Grok, DeepSeek ve Muse anahtarlari tanimliyken de inPool false, effectiveSource none; dort asistan pool', async () => {
    for (const plan of ['STARTER', 'TRIAL']) {
      const st = await kur(plan).svc.getProviderStatus('s1', plan, 'USER');
      expect(st.map((s) => s.provider), plan).toEqual(YEDI);
      for (const p of KAPSAM_DISI) expect(st.find((s) => s.provider === p), `${plan}/${p}`).toMatchObject({ inPool: false, effectiveSource: 'none' });
      for (const p of DORT) expect(st.find((s) => s.provider === p), `${plan}/${p}`).toMatchObject({ inPool: true, effectiveSource: 'pool' });
    }
  });

  it('Profesyonel ve ustu: yedisi de havuzda (anahtari olan); Muse anahtari yoksa Muse none', async () => {
    for (const plan of ['PRO', 'AGENCY', 'ENTERPRISE']) {
      const st = await kur(plan).svc.getProviderStatus('s1', plan, 'USER');
      for (const p of YEDI) expect(st.find((s) => s.provider === p), `${plan}/${p}`).toMatchObject({ inPool: true, effectiveSource: 'pool' });
    }
    delete process.env[POOL_ENV_KEY.meta];
    const st = await kur('PRO').svc.getProviderStatus('s1', 'PRO', 'USER');
    expect(st.find((s) => s.provider === 'meta')).toMatchObject({ inPool: false, effectiveSource: 'none' });
    expect(st.find((s) => s.provider === 'xai')).toMatchObject({ inPool: true, effectiveSource: 'pool' });
  });

  it('ADMIN her planda kapsamda; rozet = motorun sordugu kume (her plan icin)', async () => {
    const admin = await kur('TRIAL', 'ADMIN').svc.getProviderStatus('s1', 'TRIAL', 'ADMIN');
    for (const p of YEDI) expect(admin.find((s) => s.provider === p), p).toMatchObject({ inPool: true, effectiveSource: 'pool' });

    for (const plan of ['TRIAL', 'STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']) {
      for (const f of [anthropicCreate, deepseekCreate, geminiGenerate]) f.mockClear();
      fetchSpy.mockClear();
      const { svc } = kur(plan);
      const havuzda = (await svc.getProviderStatus('s1', plan, 'USER')).filter((s) => s.effectiveSource === 'pool').map((s) => s.provider);
      await svc.runForSite('s1', 5, { trigger: 'system', tekrar: 1 });
      expect(sorulanlar(), plan).toEqual(havuzda);
    }
  });
});

/**
 * Tam rapor kilidi (public-citation.controller unlock → PublicCitationService.check →
 * runPublicProbes): uye raporu hesabin plan kapsamiyla olculur. Kapsam `only` + `tier` ile gelir;
 * anonim test bunlari vermez ve eskisi gibi her yapilandirilmis asistana gelismis modelle sorar.
 */
describe('runPublicProbes — tam rapor kilidinin plan kapsami', () => {
  const temizle = () => {
    for (const f of [anthropicCreate, deepseekCreate, geminiGenerate]) f.mockClear();
    fetchSpy.mockClear();
  };

  it('Baslangic kapsami (dort asistan, standard): Grok / DeepSeek / Muse sorulmaz; Claude Haiku + temel arama araci; maliyet 0.13', async () => {
    temizle();
    const t = kur('STARTER');
    const out = await t.svc.runPublicProbes({
      brand: 'Kobipratik', host: 'kobipratik.com', queries: SORULAR,
      only: ['openai', 'gemini', 'anthropic', 'perplexity'], tier: 'standard',
    });
    expect(sorulanlar().sort()).toEqual(['anthropic', 'gemini', 'openai', 'perplexity']);
    expect(out.map((r) => r.provider).sort()).toEqual(['anthropic', 'gemini', 'openai', 'perplexity']);
    for (const c of anthropicCreate.mock.calls) {
      expect(c[0].model).toBe('claude-haiku-5-5');
      expect(c[0].tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]);
    }
    const claude = out.find((r) => r.provider === 'anthropic')!;
    expect(claude.cost).toBeCloseTo(0.13 * SORULAR.length, 6);
  });

  it('kapsam verilmezse (anonim test, karne): yedi asistan, Claude Opus + 20260209, gelismis kademenin tavaniyla', async () => {
    temizle();
    const t = kur('TRIAL');
    const out = await t.svc.runPublicProbes({ brand: 'Kobipratik', host: 'kobipratik.com', queries: SORULAR });
    expect(sorulanlar().sort()).toEqual(['anthropic', 'deepseek', 'gemini', 'meta', 'openai', 'perplexity', 'xai']);
    for (const c of anthropicCreate.mock.calls) {
      expect(c[0].model).toBe('claude-opus-5-5');
      expect(c[0].tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }]);
    }
    expect(out.find((r) => r.provider === 'anthropic')!.cost).toBeCloseTo(COST_PER_PROBE_USD.anthropic * SORULAR.length, 6);
  });

  it('Profesyonel kapsami (yedi asistan, premium) anonim testle AYNI istegi atar', async () => {
    temizle();
    const t = kur('PRO');
    await t.svc.runPublicProbes({
      brand: 'Kobipratik', host: 'kobipratik.com', queries: SORULAR,
      only: ['openai', 'gemini', 'anthropic', 'perplexity', 'xai', 'deepseek', 'meta'], tier: 'premium',
    });
    expect(sorulanlar().sort()).toEqual(['anthropic', 'deepseek', 'gemini', 'meta', 'openai', 'perplexity', 'xai']);
    for (const c of anthropicCreate.mock.calls) expect(c[0].model).toBe('claude-opus-5-5');
  });
});

