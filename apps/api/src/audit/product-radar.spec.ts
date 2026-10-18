import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProductRadarService } from './product-radar.service.js';
import { AiCitationService } from './ai-citation.service.js';
import { brandMatcher } from './brand-in-query.js';
import { MeasurementAllowanceService } from '../billing/measurement-allowance.service.js';

const radar = new ProductRadarService({} as any, {} as any, {} as any);

describe('ProductRadarService.isBrandProduct', () => {
  const kobi = brandMatcher('Kobipratik', 'kobipratik.com');

  it('marka adi ve alan adi bicimleri marka sayilir', () => {
    expect(radar.isBrandProduct('Kobipratik', kobi)).toBe(true);
    expect(radar.isBrandProduct('Kobipratik.com', kobi)).toBe(true);
    expect(radar.isBrandProduct('Kobi Pratik', kobi)).toBe(true);
  });

  it('ters yon alt-dize ve bos ad marka sayilmaz (eski includes hatasi)', () => {
    expect(radar.isBrandProduct('Kobi', kobi)).toBe(false);
    expect(radar.isBrandProduct('—', kobi)).toBe(false);
    expect(radar.isBrandProduct('Kobipratikci Pro', kobi)).toBe(false);
  });

  it('jenerik turetilmis markada yalniz alan adi', () => {
    const emlak = brandMatcher('emlak', 'emlak.com');
    expect(radar.isBrandProduct('Hepsiemlak', emlak)).toBe(false);
    expect(radar.isBrandProduct('Emlak', emlak)).toBe(false);
    expect(radar.isBrandProduct('Emlak.com', emlak)).toBe(true);
  });
});

/**
 * Urunler cevabin TAMAMINDAN cikarilir. Eskiden extractor probe.excerpt'i
 * (ilk 220 karakter) okuyordu: listenin alt siralarindaki markalar — cogu
 * zaman rakipler — hic raporlanmiyordu. Gercek AiCitationService.buildProbe
 * kullanilir (runQueries yerine runPublicProbes; fetch taklit, ag yok).
 */
describe('Product Radar — cevabin tamami, kayitta yalniz urun listesi', () => {
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

  const ANSWER = [
    'KOBİ kredisi karşılaştırması için öne çıkan platformlar: 1. Hangikredi 2. Hesapkurdu.',
    'Faiz oranı, vade ve dosya masrafını birlikte değerlendirmek gerekir; tek bir kalem yanıltıcı olabilir. '.repeat(3),
    '3. Kobipratik — KOBİ odaklı karşılaştırma.',
    '4. Enpara — dijital başvuru, özel kampanya kodu XQ-91 ile masrafsız.',
  ].join('\n');
  const KNOWN = ['Hangikredi', 'Hesapkurdu', 'Kobipratik', 'Enpara'];

  function setup() {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }], citations: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    const citation = new AiCitationService({ $executeRawUnsafe: vi.fn(async () => 1) } as any, {} as any, {} as any, {} as any);
    // runQueries'in site/kota/butce katmani bu testin konusu degil: ayni buildProbe'dan gecen public yol
    vi.spyOn(citation, 'runQueries').mockImplementation(async (_siteId, queries) =>
      (await citation.runPublicProbes({ brand: 'Kobipratik', host: 'kobipratik.com', queries }))
        .map((r) => ({ ...r, score: null })));

    const extractInputs: string[] = [];
    const llm = {
      chat: vi.fn(async (req: any) => {
        if (req.context === 'product-radar-queries') return { output: '["KOBİ kredisi için en iyi karşılaştırma siteleri hangileri?"]' };
        // Sahte cikarici: verilen metinde GERCEKTEN gecen adlari gecis sirasiyla dondurur
        const content: string = req.messages[0].content;
        extractInputs.push(content);
        const found = KNOWN.filter((n) => content.includes(n))
          .sort((a, b) => content.indexOf(a) - content.indexOf(b))
          .map((name, i) => ({ name, rank: i + 1 }));
        return { output: JSON.stringify(found) };
      }),
    };
    const created: any[] = [];
    const prisma = {
      site: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: 's1', name: 'Kobipratik', url: 'https://kobipratik.com', niche: 'finans', customNiche: 'KOBİ kredi karşılaştırma',
          language: 'tr', brain: null,
        })),
      },
      productRadarSnapshot: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: any) => { created.push(data); return { id: `r${created.length}`, ...data }; }),
        update: vi.fn(),
      },
    };
    const svc = new ProductRadarService(prisma as any, citation, llm as any);
    return { svc, citation, llm, extractInputs, created };
  }

  it('220 karakterden sonra gecen urunler de bulunur', async () => {
    const t = setup();
    const res = await t.svc.run('s1');
    expect(res.snapshots).toBe(1);

    // Eski davranisin kaniti: alinti ilk 220 karakter, son siradaki urun orada yok
    expect(ANSWER.indexOf('Enpara')).toBeGreaterThan(220);
    expect(t.extractInputs[0]).toContain('Enpara');

    const products = t.created[0].products as Array<{ name: string; rank: number; isBrand: boolean }>;
    expect(products.map((p) => p.name)).toEqual(['Hangikredi', 'Hesapkurdu', 'Kobipratik', 'Enpara']);
    expect(products.find((p) => p.name === 'Kobipratik')).toMatchObject({ isBrand: true, rank: 3 });
    expect(t.created[0]).toMatchObject({ brandListed: true, brandRank: 3, provider: 'perplexity' });
  });

  it('tam cevap metni kayda gecmez (yalniz urun adlari)', async () => {
    const t = setup();
    await t.svc.run('s1');
    const persisted = JSON.stringify(t.created);
    expect(persisted).not.toContain('XQ-91');
    expect(persisted).not.toContain('dosya masrafını');
    expect(Object.keys(t.created[0]).sort()).toEqual(['brandListed', 'brandRank', 'category', 'date', 'products', 'provider', 'query', 'siteId']);
  });

  it('tam metin yoksa (kopyalanmis/eski probe) alintiya duser', async () => {
    const t = setup();
    vi.spyOn(t.citation, 'answerTextOf').mockReturnValue(undefined);
    await t.svc.run('s1');
    expect(t.extractInputs[0].length).toBeLessThanOrEqual(220);
    expect(t.extractInputs[0]).not.toContain('Enpara');
  });
});

/**
 * Haftalik cron (weeklyRunAll) SISTEM kosumudur. Eskiden run() trigger
 * aktarmiyordu; runQueries 'user' varsayip oturum disinda sahibin haftalik
 * olcum hakkini ayiriyor, ikinci sorgu 429 WEEKLY_MEASUREMENT_LIMIT alip
 * taramayi kesiyordu (3 sorgudan 1'i kaydediliyordu) ve musteri o hafta hic
 * olcum yapmadan "Bu haftaki AI ölçüm hakkını kullandın" goruyordu.
 * Gercek MeasurementAllowanceService + bellek ici kv_store ile sinanir.
 */
describe('Product Radar — haftalik cron haftalik olcum hakkini tuketmez', () => {
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

  const QUERIES = [
    'KOBİ kredisi için en iyi karşılaştırma siteleri hangileri?',
    'Ticari kredi faizlerini nereden karşılaştırabilirim?',
    'POS cihazı tekliflerini karşılaştıran platformlar hangileri?',
  ];
  const ANSWER = 'Öne çıkan karşılaştırma platformları: 1. Hangikredi 2. Hesapkurdu 3. Kobipratik — KOBİ odaklı karşılaştırma sunar.';

  /** kv_store'un bellek ici esi (measurement-allowance.spec.ts ile ayni anlam) + maliyet defteri */
  function kv() {
    const rows = new Map<string, { key: string; value: string; expiresAt: Date | null }>();
    return {
      rows,
      async create({ data }: any) {
        if (rows.has(data.key)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        rows.set(data.key, { ...data });
        return data;
      },
      async findUnique({ where }: any) {
        const row = rows.get(where.key);
        return row ? { ...row } : null;
      },
      async updateMany({ where, data }: any) {
        const row = rows.get(where.key);
        if (!row) return { count: 0 };
        if (typeof where.value === 'string' && row.value !== where.value) return { count: 0 };
        if (where.value?.lt !== undefined && !(row.value < where.value.lt)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      async deleteMany({ where }: any) {
        const row = rows.get(where.key);
        if (!row || (where.value !== undefined && row.value !== where.value)) return { count: 0 };
        rows.delete(where.key);
        return { count: 1 };
      },
    };
  }

  function setup() {
    const kvStore = kv();
    const created: any[] = [];
    const site = {
      id: 's1', name: 'Kobipratik', url: 'https://kobipratik.com', niche: 'finans', customNiche: 'KOBİ kredi karşılaştırma',
      language: 'tr', brain: null, userId: 'u1', user: { id: 'u1', plan: 'AGENCY', role: 'USER' },
    };
    const prisma = {
      kvStore,
      appSetting: { findUnique: vi.fn(async () => null) },
      site: {
        findUnique: vi.fn(async () => site),
        findUniqueOrThrow: vi.fn(async () => site),
        findMany: vi.fn(async () => [{ id: 's1' }]),
      },
      siteAiProviderKey: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
      $queryRawUnsafe: vi.fn(async () => []),
      // addCost: ON DUPLICATE KEY UPDATE esi — maliyet defteri ayni kv'de birikir
      $executeRawUnsafe: vi.fn(async (_sql: string, key: string, value: string) => {
        const cur = kvStore.rows.get(key);
        kvStore.rows.set(key, { key, value: String((cur ? parseFloat(cur.value) : 0) + parseFloat(value)), expiresAt: null });
        return 1;
      }),
      productRadarSnapshot: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: any) => { created.push(data); return { id: `r${created.length}`, ...data }; }),
        update: vi.fn(),
      },
    };
    const quota = {
      getPlanPool: () => ['perplexity'],
      enforceCitationQuota: vi.fn(async () => undefined),
      incrementCitationUsage: vi.fn(async () => undefined),
    };
    const allowance = new MeasurementAllowanceService(prisma as any);
    const citation = new AiCitationService(prisma as any, quota as any, {} as any, allowance);
    const llm = {
      chat: vi.fn(async (req: any) => {
        if (req.context === 'product-radar-queries') return { output: JSON.stringify(QUERIES) };
        const content: string = req.messages[0].content;
        const found = ['Hangikredi', 'Hesapkurdu', 'Kobipratik'].filter((n) => content.includes(n))
          .map((name, i) => ({ name, rank: i + 1 }));
        return { output: JSON.stringify(found) };
      }),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }], citations: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    const radar = new ProductRadarService(prisma as any, citation, llm as any);
    return { radar, citation, allowance, kvStore, created, quota, fetchSpy };
  }

  it('cron: 3 sorgunun 3u kaydedilir, ai-olcum kaydi yazilmaz, kota ne kontrol edilir ne artar', async () => {
    const t = setup();
    const spy = vi.spyOn(t.citation, 'runQueries');
    await t.radar.weeklyRunAll();

    expect(spy).toHaveBeenCalledTimes(3);
    for (const call of spy.mock.calls) expect(call[2]).toMatchObject({ trigger: 'system' });
    expect(t.created.map((c) => c.query)).toEqual(QUERIES);
    expect(t.kvStore.rows.has('ai-olcum:u1')).toBe(false);
    expect(t.quota.enforceCitationQuota).not.toHaveBeenCalled();
    expect(t.quota.incrementCitationUsage).not.toHaveBeenCalled();
  });

  it('cron: sahip bu hafta olcum yaptiysa da tarama tamamlanir ve hak tarihi degismez', async () => {
    const t = setup();
    await t.allowance.reserve('u1'); // sahibin bu haftaki olcumu
    const before = t.kvStore.rows.get('ai-olcum:u1')!.value;
    await t.radar.weeklyRunAll();
    expect(t.created).toHaveLength(3);
    expect(t.kvStore.rows.get('ai-olcum:u1')!.value).toBe(before);
  });

  it('cron da saglayici gunluk havuz butcesine tabi: butce doluysa cagri yapilmaz, kayit olmaz', async () => {
    const t = setup();
    const today = new Date().toISOString().slice(0, 10);
    t.kvStore.rows.set(`ai-cost:perplexity:${today}`, { key: `ai-cost:perplexity:${today}`, value: '9999', expiresAt: null });
    await t.radar.weeklyRunAll();
    expect(t.fetchSpy).not.toHaveBeenCalled();
    expect(t.created).toHaveLength(0);
  });

  it('kullanici yolu (uc @MeasurementSession ile sarili): 3 sorgu TEK hak ayirir', async () => {
    const t = setup();
    const res = await t.allowance.run({ id: 'u1', role: 'USER' }, () => t.radar.run('s1'));
    expect(res.snapshots).toBe(3);
    expect(t.kvStore.rows.has('ai-olcum:u1')).toBe(true);
    // Ayni hafta ikinci kullanici taramasi 429 alir — hak gercekten tek
    const err: any = await t.allowance.run({ id: 'u1', role: 'USER' }, () => t.radar.run('s1')).catch((e) => e);
    expect(err.getStatus()).toBe(429);
  });
});
