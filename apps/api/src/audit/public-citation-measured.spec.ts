import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { HttpException } from '@nestjs/common';
import type { SafeTextResult } from '../common/safe-fetch.js';

/**
 * Ucretsiz kontrol — payda yalniz OLCULEN cevap (F11) ve IP basina gunluk hak (K1).
 *
 * NEDEN VAR:
 *  - Payda runPublicProbes'un dondurdugu TUM saglayicilardi: uretimde
 *    anahtari/modeli olmayan Meta Llama (available=false) ve HATA probe'u da
 *    "anilmadi" sayiliyordu. 6 asistanin hepsinde anilan marka 6/7 (skor 86)
 *    ve "Meta AI ✗" goruyordu, metin "6 AI motoru" derken.
 *  - checkRateLimit kayitlari ham IP ile ariyordu; kayitta IP hash'li.
 *    "IP basina gunde 3 alan adi" limiti hic devreye girmiyordu.
 */

const getirici = vi.hoisted(() => ({ html: '<html><head><meta property="og:site_name" content="Kobipratik"></head></html>' }));
vi.mock('../common/safe-fetch.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../common/safe-fetch.js')>();
  return {
    ...orig,
    safeFetchText: vi.fn(async (url: string): Promise<SafeTextResult> => ({
      status: 200, ok: true, url, redirected: false, contentType: 'text/html',
      headers: { 'content-type': 'text/html' }, text: getirici.html, truncated: false, binary: false,
    })),
  };
});

import { PUBLIC_BUDGET_MESSAGE, PublicCitationService, publicDailyBudgetUsd, withMeasuredCounts } from './public-citation.service.js';

const ALTI = [
  ['anthropic', 'Anthropic Claude'], ['gemini', 'Google Gemini'], ['openai', 'OpenAI ChatGPT'],
  ['perplexity', 'Perplexity'], ['xai', 'xAI Grok'], ['deepseek', 'DeepSeek'],
] as const;

type Probe = { query: string; cited: boolean; brandMentioned: boolean; brandInQuery?: boolean; excerpt?: string };

/** 6 calisan saglayici + anahtarsiz Meta. `probeFor` saglayici x soru icin probe uretir. */
function probeSonucu(queries: string[], probeFor: (provider: string, query: string) => Probe) {
  return [
    ...ALTI.map(([provider, label]) => ({
      provider, label, available: true, cost: 0,
      probes: queries.map((q) => probeFor(provider, q)),
    })),
    { provider: 'meta', label: 'Meta AI (Llama)', available: false, probes: [], reason: 'NO_KEY', cost: 0 },
  ];
}

const andi = (query: string): Probe => ({ query, cited: false, brandMentioned: true, brandInQuery: false, excerpt: 'Kobipratik öne çıkıyor.' });
const anmadi = (query: string): Probe => ({ query, cited: false, brandMentioned: false, brandInQuery: false, excerpt: 'Başka siteler öne çıkıyor.' });
const hata = (query: string): Probe => ({ query, cited: false, brandMentioned: false, excerpt: 'HATA: rate_limited' });

const SORULAR = [
  'Kredi karşılaştırma için en iyi siteler hangileri?',
  'İhtiyaç kredisi faizleri nereden karşılaştırılır?',
  'KOBİ kredisi için hangi platformlar var?',
  'Kredi kartı karşılaştırma siteleri hangileri?',
  'Konut kredisi hesaplama araçları nelerdir?',
].map((query) => ({ query, category: 'DISCOVERY' }));

function servis(o: { probeFor: (provider: string, query: string) => Probe; cached?: any[]; distinct?: any[]; history?: any[] }) {
  const prisma = {
    publicCitationCheck: {
      findMany: vi.fn(async (args: any) => {
        if (args?.distinct) return o.distinct ?? [];
        if (args?.select?.brand) return o.history ?? [];
        return o.cached ?? [];
      }),
      create: vi.fn(async () => ({ id: 'kontrol-1' })),
    },
  };
  const ai = {
    plannedPublicCost: vi.fn(() => 0.8),
    readPublicAnonSpent: vi.fn(async () => 0),
    addPublicAnonSpend: vi.fn(async () => undefined),
    runPublicProbes: vi.fn(async ({ queries }: { queries: string[] }) => probeSonucu(queries, o.probeFor)),
    publicAggregate: vi.fn(() => ({ shareOfVoice: [] })),
    classifyRealCompetitors: vi.fn(async () => new Set<string>()),
  };
  const niche = { detectFromUrl: vi.fn(async () => ({ niche: 'finans', queries: SORULAR })) };
  const svc = new PublicCitationService(prisma as never, ai as never, niche as never);
  svc.urlResolver = async () => undefined;
  return { svc, prisma, ai, niche };
}

/** Landing ozeti (checker-overlay summarize) ile ayni hesap: kilitsiz + markasiz sorularda pay/payda. */
function landingSkoru(r: { queries: Array<{ locked?: boolean; brandInQuery?: boolean; citedCount: number; totalProviders: number }> }) {
  const open = r.queries.filter((q) => !q.locked);
  const scored = open.filter((q) => !q.brandInQuery);
  const base = scored.length ? scored : open;
  const total = base.reduce((s, q) => s + q.totalProviders, 0);
  const cited = base.reduce((s, q) => s + q.citedCount, 0);
  return total > 0 ? Math.round((cited / total) * 100) : 0;
}

describe('taze sonuc — payda yalniz olculen saglayicilar', () => {
  it('Meta anahtarsiz, 6 asistanin hepsi andi: her soru 6/6, landing skoru 100 (eskiden 6/7, 86)', async () => {
    const t = servis({ probeFor: (_p, q) => andi(q) });
    const r = await t.svc.check('kobipratik.com', '1.2.3.4');

    const acik = r.queries.filter((q) => !q.locked);
    expect(acik).toHaveLength(3);
    for (const q of acik) {
      expect(q.providers.map((p) => p.provider)).toEqual(ALTI.map(([p]) => p));
      expect(q.providers.every((p) => p.measured)).toBe(true);
      expect(q).toMatchObject({ citedCount: 6, totalProviders: 6 });
    }
    // Kilitli satir: yer tutucu sayisi = calisan saglayici sayisi
    for (const q of r.queries.filter((x) => x.locked)) expect(q.totalProviders).toBe(6);
    expect(landingSkoru(r)).toBe(100);
    expect(JSON.stringify(r)).not.toContain('"meta"');
    // DB'ye de ayni bicim yazilir
    const yazilan = (t.prisma.publicCitationCheck.create.mock.calls[0] as any[])[0].data.result;
    expect(yazilan.queries[0]).toMatchObject({ citedCount: 6, totalProviders: 6 });
    expect(yazilan.totalLlmCalls).toBe(18);
  });

  it('HATA probe: satir kalir ama measured=false, pay ve paydaya girmez', async () => {
    const ilk = SORULAR[0].query;
    const t = servis({ probeFor: (p, q) => (p === 'perplexity' && q === ilk ? hata(q) : p === 'openai' ? andi(q) : anmadi(q)) });
    const r = await t.svc.check('kobipratik.com', '1.2.3.4');

    const q0 = r.queries[0];
    expect(q0.query).toBe(ilk);
    expect(q0).toMatchObject({ citedCount: 1, totalProviders: 5 });
    expect(q0.providers.find((p) => p.provider === 'perplexity')).toEqual({
      provider: 'perplexity', label: 'Perplexity', measured: false, cited: false, brandMentioned: false, excerpt: 'HATA: rate_limited',
    });
    expect(r.queries[1]).toMatchObject({ citedCount: 1, totalProviders: 6 });
  });

  it('markali soru damgasi HATA probe\'unda yok: damgali ilk probe okunur', async () => {
    const ilk = SORULAR[0].query;
    // Ilk saglayici (anthropic) bu soruda HATA verdi; digerleri soruyu markali damgaladi
    const t = servis({ probeFor: (p, q) => (q === ilk ? (p === 'anthropic' ? hata(q) : { ...andi(q), brandInQuery: true }) : anmadi(q)) });
    const r = await t.svc.check('kobipratik.com', '1.2.3.4');
    expect(r.queries[0].brandInQuery).toBe(true);
  });
});

describe('onbellekten donen eski kayit ayni kurala getirilir', () => {
  const eski = {
    domain: 'kobipratik.com', brand: 'Kobipratik', niche: 'finans',
    access: { tier: 'anon', unlockedQueries: 1, totalQueries: 2, lockedQueries: 1 },
    queries: [
      {
        query: 'soru', locked: false, citedCount: 2, totalProviders: 7, brandInQuery: false,
        providers: [
          ...ALTI.slice(0, 5).map(([provider, label], i) => ({ provider, label, cited: false, brandMentioned: i < 2, excerpt: 'cevap metni' })),
          { provider: 'deepseek', label: 'DeepSeek', cited: false, brandMentioned: false, excerpt: 'HATA: HTTP 429: {"org":"org-GIZLI"}' },
          // anahtarsiz saglayicinin eski satiri: alintisiz, sonucsuz
          { provider: 'meta', label: 'Meta AI (Llama)', cited: false, brandMentioned: false },
        ],
      },
      { query: 'kilitli', locked: true, providers: [], citedCount: 0, totalProviders: 7, brandInQuery: false },
    ],
    competitorRanking: [], totalLlmCalls: 7, fromCache: false,
  };

  it('calismayan satir duser, HATA notr, payda 5; pay degismez; kilitli satir 6', async () => {
    const t = servis({ probeFor: (_p, q) => andi(q), cached: [{ id: 'eski', createdAt: new Date(), result: eski }] });
    const r = await t.svc.check('kobipratik.com', '1.2.3.4');
    expect(r.fromCache).toBe(true);
    expect(t.ai.runPublicProbes).not.toHaveBeenCalled();
    const q = r.queries[0];
    expect(q.providers.map((p) => p.provider)).toEqual(['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek']);
    expect(q.providers.find((p) => p.provider === 'deepseek')).toMatchObject({ measured: false, excerpt: 'HATA: rate_limited' });
    expect(q).toMatchObject({ citedCount: 2, totalProviders: 5 });
    expect(r.queries[1]).toMatchObject({ locked: true, totalProviders: 6 });
    expect(JSON.stringify(r)).not.toContain('org-GIZLI');
  });

  it('withMeasuredCounts idempotent ve providers dizisi olmayan kayda dokunmaz', () => {
    const bir = withMeasuredCounts(eski);
    expect(withMeasuredCounts(bir)).toEqual(bir);
    const ozet = { queries: [{ query: 'q', citedCount: 3, totalProviders: 7 }] };
    expect(withMeasuredCounts(ozet)).toEqual(ozet);
    expect(withMeasuredCounts(null)).toBeNull();
  });

  it('getHistory: toplam skor ayni, payda olculen saglayici sayisi', async () => {
    const t = servis({
      probeFor: (_p, q) => andi(q),
      history: [{ id: 'h', createdAt: new Date('2026-08-01T00:00:00Z'), source: 'manual', brand: 'Kobipratik', result: eski }],
    });
    const [h] = await t.svc.getHistory('kobipratik.com');
    expect(h).toMatchObject({ totalCitedScore: 2, totalProviders: 5, queriesCount: 2 });
  });
});

describe('IP basina haftalik hak (7 gunde 1 taze test) — kayittaki hash ile sorgulanir', () => {
  const ORJ_LIMIT = process.env.PUBLIC_CITATION_IP_WEEKLY_LIMIT;
  const ORJ_ESKI = process.env.PUBLIC_CITATION_IP_DAILY_LIMIT;
  const ORJ_TUZ = process.env.IP_HASH_SALT;
  beforeEach(() => {
    delete process.env.PUBLIC_CITATION_IP_WEEKLY_LIMIT;
    delete process.env.PUBLIC_CITATION_IP_DAILY_LIMIT;
    process.env.IP_HASH_SALT = 'test-tuzu';
  });
  afterEach(() => {
    if (ORJ_LIMIT === undefined) delete process.env.PUBLIC_CITATION_IP_WEEKLY_LIMIT;
    else process.env.PUBLIC_CITATION_IP_WEEKLY_LIMIT = ORJ_LIMIT;
    if (ORJ_ESKI === undefined) delete process.env.PUBLIC_CITATION_IP_DAILY_LIMIT;
    else process.env.PUBLIC_CITATION_IP_DAILY_LIMIT = ORJ_ESKI;
    if (ORJ_TUZ === undefined) delete process.env.IP_HASH_SALT;
    else process.env.IP_HASH_SALT = ORJ_TUZ;
  });
  const hashli = (ip: string) => createHash('sha256').update(`test-tuzu:${ip}`).digest('hex').slice(0, 32);
  const gunOnce = (g: number) => new Date(Date.now() - g * 86400_000);

  it('sorgu hash ile, yalniz manual kayitlar, son 7 gun; alan adi basina en son satir', async () => {
    const t = servis({ probeFor: (_p, q) => andi(q), distinct: [] });
    const rl = await t.svc.checkRateLimit('5.6.7.8');
    const args = t.prisma.publicCitationCheck.findMany.mock.calls[0][0] as any;
    expect(args.where).toMatchObject({ ip: hashli('5.6.7.8'), source: 'manual' });
    expect(args.where.ip).not.toBe('5.6.7.8');
    expect(args.distinct).toEqual(['domain']);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    const pencereGun = (Date.now() - (args.where.createdAt.gte as Date).getTime()) / 86400_000;
    expect(pencereGun).toBeGreaterThan(6.99);
    expect(pencereGun).toBeLessThan(7.01);
    expect(rl).toEqual({ ok: true, remaining: 1, resetIn: undefined });
    await t.svc.check('kobipratik.com', '5.6.7.8');
    expect((t.prisma.publicCitationCheck.create.mock.calls[0] as any[])[0].data.ip).toBe(hashli('5.6.7.8'));
  });

  it('7 gun icinde 1 taze test yapildiysa yeni test 429 alir, probe calismaz, mesaj yenilenme gununu soyler', async () => {
    const t = servis({ probeFor: (_p, q) => andi(q), distinct: [{ domain: 'a.com', createdAt: gunOnce(2) }] });
    const err = await t.svc.check('kobipratik.com', '5.6.7.8').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    const msg = (err as HttpException).message;
    expect(msg).toContain('Haftalık ücretsiz test hakkınız doldu');
    expect(msg).toContain('7 günde 1 alan adı');
    expect(msg).toContain('itibarıyla yenilenir');
    expect(msg).toContain('14 gün ücretsiz deneme');
    expect(t.ai.runPublicProbes).not.toHaveBeenCalled();
    expect(t.niche.detectFromUrl).not.toHaveBeenCalled();
  });

  it('yenilenme gunu: en son testten 7 gun sonra (Istanbul saatiyle gun adi)', async () => {
    const son = gunOnce(2);
    const t = servis({ probeFor: (_p, q) => andi(q), distinct: [{ domain: 'a.com', createdAt: son }] });
    const rl = await t.svc.checkRateLimit('5.6.7.8');
    const beklenen = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long' })
      .format(new Date(son.getTime() + 7 * 86400_000));
    expect(rl).toEqual({ ok: false, remaining: 0, resetIn: `${beklenen} itibarıyla yenilenir` });
  });

  it('ayni alan adini tekrar (onbellek disi) test etmek de haktan duser', async () => {
    const t = servis({ probeFor: (_p, q) => andi(q), distinct: [{ domain: 'kobipratik.com', createdAt: gunOnce(3) }] });
    const err = await t.svc.check('kobipratik.com', '5.6.7.8').catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(t.ai.runPublicProbes).not.toHaveBeenCalled();
  });

  it('token siz mobil kademe (ipDailyLimit 2) genel siniri (1) asamaz', async () => {
    const t = servis({ probeFor: (_p, q) => andi(q), distinct: [{ domain: 'a.com', createdAt: gunOnce(1) }] });
    const err = await t.svc.check('kobipratik.com', '5.6.7.8', 'manual', { ipDailyLimit: 2 }).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(t.ai.runPublicProbes).not.toHaveBeenCalled();
    await expect(t.svc.checkRateLimit('5.6.7.8', 2)).resolves.toMatchObject({ ok: false, remaining: 0 });
    await expect(t.svc.checkRateLimit('5.6.7.8', Number.NaN)).resolves.toMatchObject({ remaining: 0 });
  });

  it('env ile genisletilebilir; birden fazla hakta mesaj gercek siniri soyler', async () => {
    process.env.PUBLIC_CITATION_IP_WEEKLY_LIMIT = '3';
    const t = servis({ probeFor: (_p, q) => andi(q), distinct: [{ domain: 'a.com' }, { domain: 'b.com' }, { domain: 'c.com' }] });
    const err = await t.svc.check('kobipratik.com', '5.6.7.8').catch((e: unknown) => e);
    expect((err as HttpException).message).toContain('en fazla 3 farklı alan adı');
  });

  it('eski gunluk env (PUBLIC_CITATION_IP_DAILY_LIMIT) haftalik siniri genisletmez', async () => {
    process.env.PUBLIC_CITATION_IP_DAILY_LIMIT = '3';
    const t = servis({ probeFor: (_p, q) => andi(q), distinct: [] });
    await expect(t.svc.checkRateLimit('5.6.7.8')).resolves.toMatchObject({ ok: true, remaining: 1 });
  });

  it('gecersiz env limiti her istegi reddetmez, varsayilan 1 kullanilir', async () => {
    process.env.PUBLIC_CITATION_IP_WEEKLY_LIMIT = 'abc';
    const t = servis({ probeFor: (_p, q) => andi(q), distinct: [] });
    await expect(t.svc.checkRateLimit('5.6.7.8')).resolves.toMatchObject({ ok: true, remaining: 1 });
  });

  it('IP okunamazsa hak yok (Turkce neden)', async () => {
    const t = servis({ probeFor: (_p, q) => andi(q) });
    await expect(t.svc.checkRateLimit('')).resolves.toEqual({ ok: false, remaining: 0, resetIn: 'IP adresi okunamadı' });
  });
});

describe('anonim test gunluk harcama tavani (varsayilan 10 USD, havuzdan ayri)', () => {
  const ORJ = process.env.PUBLIC_CITATION_DAILY_BUDGET_USD;
  beforeEach(() => { delete process.env.PUBLIC_CITATION_DAILY_BUDGET_USD; });
  afterEach(() => {
    if (ORJ === undefined) delete process.env.PUBLIC_CITATION_DAILY_BUDGET_USD;
    else process.env.PUBLIC_CITATION_DAILY_BUDGET_USD = ORJ;
  });

  it('varsayilan 10; gecersiz env varsayilana duser; env ile degisir', () => {
    expect(publicDailyBudgetUsd()).toBe(10);
    process.env.PUBLIC_CITATION_DAILY_BUDGET_USD = 'abc';
    expect(publicDailyBudgetUsd()).toBe(10);
    process.env.PUBLIC_CITATION_DAILY_BUDGET_USD = '0';
    expect(publicDailyBudgetUsd()).toBe(10);
    process.env.PUBLIC_CITATION_DAILY_BUDGET_USD = '25';
    expect(publicDailyBudgetUsd()).toBe(25);
  });

  it('harcanan + bu testin tavan maliyeti tavani asarsa 429, probe ve nis tespiti calismaz', async () => {
    const t = servis({ probeFor: (_p, q) => andi(q), distinct: [] });
    t.ai.readPublicAnonSpent.mockResolvedValue(9.5);
    const err = await t.svc.check('kobipratik.com', '5.6.7.8').catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).message).toBe(PUBLIC_BUDGET_MESSAGE);
    expect(t.ai.runPublicProbes).not.toHaveBeenCalled();
    expect(t.niche.detectFromUrl).not.toHaveBeenCalled();
    expect(t.ai.plannedPublicCost).toHaveBeenCalledWith(3);
  });

  it('tavanin altindaysa test calisir ve saglayici maliyetlerinin toplami deftere yazilir', async () => {
    const t = servis({ probeFor: (_p, q) => andi(q), distinct: [] });
    t.ai.readPublicAnonSpent.mockResolvedValue(9.0);
    t.ai.runPublicProbes.mockImplementation(async ({ queries }: { queries: string[] }) =>
      probeSonucu(queries, (_p, q) => andi(q)).map((r: any) => ({ ...r, cost: r.available ? 0.1 : 0 })));
    await t.svc.check('kobipratik.com', '5.6.7.8');
    expect(t.ai.runPublicProbes).toHaveBeenCalledTimes(1);
    const yazilan = (t.ai.addPublicAnonSpend.mock.calls as unknown as number[][])[0][0];
    expect(yazilan).toBeCloseTo(0.6, 5);
  });

  it('onbellekten donus tavana takilmaz ve deftere yazmaz', async () => {
    const t = servis({ probeFor: (_p, q) => andi(q), cached: [{ domain: 'kobipratik.com', createdAt: new Date(), result: { brand: 'Kobipratik', queries: [], access: { tier: 'anon' } } }] });
    t.ai.readPublicAnonSpent.mockResolvedValue(999);
    await t.svc.check('kobipratik.com', '5.6.7.8');
    expect(t.ai.runPublicProbes).not.toHaveBeenCalled();
    expect(t.ai.addPublicAnonSpend).not.toHaveBeenCalled();
  });
});
