import { describe, it, expect, vi } from 'vitest';

/**
 * Abone retest'i — ayni sorular, ayni taban (K16).
 *
 * NEDEN VAR: retest check()'i bastan cagiriyordu: nis tespiti yeniden calisip
 * soru seti yeniden uretiliyordu; kiyas alan adinin en yeni kaydini zaman
 * penceresinden secilen baska bir kayitla (farkli sorular, belki uye kademesi)
 * yapiyordu. Abone e-postasi farkli soru setlerinin toplamini kiyasliyordu.
 * Artik retest tabanin soru setini aynen sorar; soru seti, kademe, yontem
 * surumu ya da ortak yanit orani tutmazsa kiyas yapilmaz.
 */

const getirici = vi.hoisted(() => ({ cagri: [] as string[] }));
vi.mock('../common/safe-fetch.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../common/safe-fetch.js')>();
  return {
    ...orig,
    safeFetchText: vi.fn(async (url: string) => {
      getirici.cagri.push(url);
      return {
        status: 200, ok: true, url, redirected: false, contentType: 'text/html',
        headers: { 'content-type': 'text/html' }, text: '<html><head><meta property="og:site_name" content="Yeni Marka"></head></html>',
        truncated: false, binary: false,
      };
    }),
  };
});

import {
  PublicCitationService,
  baselineQuestionSet,
  compareRetest,
  type FixedQuestionSet,
} from './public-citation.service.js';
import { PublicCitationRetestCron } from './public-citation-retest.cron.js';

const GUN = 24 * 60 * 60 * 1000;
const SAGLAYICILAR = ['openai', 'anthropic', 'gemini', 'perplexity', 'xai', 'deepseek'];
const SORULAR = ['Kredi karşılaştırma siteleri hangileri?', 'İhtiyaç kredisi nereden alınır?', 'KOBİ kredisi veren yerler?'];

function sonuc(anilan: number, o: { matchVersion?: number; tier?: 'anon' | 'member'; sorular?: string[]; hatali?: number[] } = {}) {
  const sorular = o.sorular ?? SORULAR;
  let i = 0;
  return {
    matchVersion: o.matchVersion ?? 4,
    brand: 'Kobipratik',
    access: { tier: o.tier ?? 'anon', unlockedQueries: sorular.length, totalQueries: sorular.length, lockedQueries: 0 },
    queries: sorular.map((query) => ({
      query, locked: false, brandInQuery: false,
      providers: SAGLAYICILAR.map((provider) => {
        const idx = i++;
        if (o.hatali?.includes(idx)) return { provider, label: provider, measured: false, cited: false, brandMentioned: false, excerpt: 'HATA: rate_limited' };
        return { provider, label: provider, measured: true, cited: false, brandMentioned: idx < anilan, excerpt: 'cevap' };
      }),
    })),
  };
}

const kayit = (result: unknown, gunOnce = 16) => ({ createdAt: new Date(Date.now() - gunOnce * GUN), brand: 'Kobipratik', result });
const simdi = (result: unknown) => ({ createdAt: new Date(), brand: 'Kobipratik', result });

describe('compareRetest — kiyas yalniz ayni kosulda', () => {
  it('ayni soru seti, ayni kademe, ayni yontem: delta ve yuzde', () => {
    const cmp = compareRetest(simdi(sonuc(6)), kayit(sonuc(3)));
    expect(cmp).toMatchObject({
      methodChanged: false, delta: 3, deltaPct: 100, comparedAnswers: 18, partialCoverage: false,
      current: { totalCited: 6, total: 18, matchVersion: 4 }, past: { totalCited: 3, total: 18, matchVersion: 4 },
    });
    expect(cmp.methodChangeReason).toBeUndefined();
  });

  it('soru sirasi farki kiyasi bozmaz (kume ayni)', () => {
    const ters = [...SORULAR].reverse();
    expect(compareRetest(simdi(sonuc(2, { sorular: ters })), kayit(sonuc(2))).methodChanged).toBe(false);
  });

  it('farkli soru seti → methodChanged (question_set), delta 0', () => {
    const cmp = compareRetest(simdi(sonuc(1, { sorular: ['Başka bir soru metni?', ...SORULAR.slice(1)] })), kayit(sonuc(5)));
    expect(cmp).toMatchObject({ methodChanged: true, methodChangeReason: 'question_set', delta: 0, deltaPct: 0 });
    // Bilgi icin bugunku sayi durur
    expect(cmp.current).toMatchObject({ totalCited: 1, total: 18 });
  });

  it('farkli kademe (uye 10 soru tabani) → tier', () => {
    expect(compareRetest(simdi(sonuc(2)), kayit(sonuc(2, { tier: 'member' })))).toMatchObject({ methodChanged: true, methodChangeReason: 'tier' });
  });

  it('farkli yontem surumu → match_version (alansiz eski kayit v3 sayilir)', () => {
    const eski = sonuc(5) as any;
    delete eski.matchVersion;
    expect(compareRetest(simdi(sonuc(1)), kayit(eski))).toMatchObject({ methodChanged: true, methodChangeReason: 'match_version', delta: 0 });
  });

  it('taban yok → no_baseline', () => {
    const cmp = compareRetest(simdi(sonuc(1)), null);
    expect(cmp).toMatchObject({ methodChanged: true, methodChangeReason: 'no_baseline', delta: 0 });
    expect(cmp.past).toBeUndefined();
  });

  it('tek hucre eksik: ortak hucrelerden sayilir, partialCoverage', () => {
    // Taban hucre 0'da anildi; retest'te hucre 0 HATA — ham toplam 5 → 4 sahte dusus olurdu
    const cmp = compareRetest(simdi(sonuc(5, { hatali: [0] })), kayit(sonuc(5)));
    expect(cmp).toMatchObject({ methodChanged: false, delta: 0, comparedAnswers: 17, partialCoverage: true });
  });

  it('ortak hucre orani esigin altinda → providers', () => {
    const cmp = compareRetest(simdi(sonuc(5, { hatali: [0, 6, 12] })), kayit(sonuc(5)));
    expect(cmp).toMatchObject({ methodChanged: true, methodChangeReason: 'providers' });
  });

  it('markali soru kiyasa girmez (getHistory manseti ile ayni)', () => {
    const marka = (r: any) => ({ ...r, queries: r.queries.map((q: any, i: number) => (i === 0 ? { ...q, brandInQuery: true } : q)) });
    // Ilk sorudaki 6 anilma markali soruda: iki tarafta da sayilmaz
    const cmp = compareRetest(simdi(marka(sonuc(6))), kayit(marka(sonuc(0))));
    expect(cmp).toMatchObject({ methodChanged: false, delta: 0, comparedAnswers: 12 });
  });
});

describe('baselineQuestionSet', () => {
  it('olculen + kilitli sorular aynen, marka ve nis kayittan', () => {
    const result = {
      brand: 'Kobipratik',
      queries: [
        { query: SORULAR[0], category: 'DISCOVERY', locked: false },
        { query: SORULAR[1], locked: false },
        { query: 'Kilitli soru?', category: 'BRAND', locked: true },
      ],
    };
    expect(baselineQuestionSet({ createdAt: new Date(), brand: 'Kobipratik', niche: 'finans', customNiche: 'kredi', result })).toEqual({
      brand: 'Kobipratik', niche: 'finans', customNiche: 'kredi',
      measured: [{ query: SORULAR[0], category: 'DISCOVERY' }, { query: SORULAR[1], category: undefined }],
      locked: [{ query: 'Kilitli soru?', category: 'BRAND' }],
    });
  });

  it('locked alani olmayan eski kayitta tum sorular olculmus sayilir; olculen soru yoksa null', () => {
    const eski = { queries: [{ query: SORULAR[0] }, { query: SORULAR[1] }] };
    expect(baselineQuestionSet({ createdAt: new Date(), brand: 'K', result: eski })?.measured).toHaveLength(2);
    expect(baselineQuestionSet({ createdAt: new Date(), brand: 'K', result: { queries: [{ query: 'x', locked: true }] } })).toBeNull();
    expect(baselineQuestionSet({ createdAt: new Date(), brand: '', result: eski })).toBeNull();
  });
});

describe('check() — sabit soru seti (retest)', () => {
  function servis() {
    const prisma = {
      publicCitationCheck: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: 'retest-1' })),
      },
    };
    const ai = {
      runPublicProbes: vi.fn(async ({ queries }: { queries: string[] }) => SAGLAYICILAR.map((provider) => ({
        provider, label: provider, available: true, cost: 0,
        probes: queries.map((query) => ({ query, cited: false, brandMentioned: true, brandInQuery: false, excerpt: 'Kobipratik öne çıkıyor.' })),
      }))),
      publicAggregate: vi.fn(() => ({ shareOfVoice: [] })),
      classifyRealCompetitors: vi.fn(async () => new Set<string>()),
    };
    const niche = { detectFromUrl: vi.fn(async () => ({ niche: 'diğer', queries: [] })) };
    const svc = new PublicCitationService(prisma as never, ai as never, niche as never);
    svc.urlResolver = async () => undefined;
    return { svc, prisma, ai, niche };
  }

  const fixed: FixedQuestionSet = {
    brand: 'Kobipratik', niche: 'finans', customNiche: 'kredi karşılaştırma',
    measured: SORULAR.map((query) => ({ query, category: 'DISCOVERY' })),
    locked: [{ query: 'Kilitli soru metni?', category: 'BRAND' }],
  };

  it('nis tespiti ve sayfa cekimi calismaz; tabanin sorulari ve markasiyla olculur', async () => {
    getirici.cagri = [];
    const t = servis();
    const r = await t.svc.check('kobipratik.com', '', 'retest_cron', { fixed });

    expect(t.niche.detectFromUrl).not.toHaveBeenCalled();
    expect(getirici.cagri).toHaveLength(0);
    expect(t.ai.runPublicProbes).toHaveBeenCalledWith({ brand: 'Kobipratik', host: 'kobipratik.com', queries: SORULAR, competitors: [] });
    expect(r).toMatchObject({
      brand: 'Kobipratik', niche: 'finans', customNiche: 'kredi karşılaştırma', checkId: 'retest-1',
      access: { tier: 'anon', unlockedQueries: 3, totalQueries: 4, lockedQueries: 1 },
    });
    expect(r.queries.map((q) => [q.query, !!q.locked])).toEqual([
      [SORULAR[0], false], [SORULAR[1], false], [SORULAR[2], false], ['Kilitli soru metni?', true],
    ]);
    // Taban ile ayni soru seti → kiyas yapilir
    const cmp = compareRetest(simdi(r), kayit(sonuc(9)));
    expect(cmp).toMatchObject({ methodChanged: false, delta: 18 - 9 });
    // Kayit retest kaynagiyla yazilir
    expect((t.prisma.publicCitationCheck.create.mock.calls[0] as any[])[0].data).toMatchObject({ source: 'retest_cron', brand: 'Kobipratik', niche: 'finans' });
  });

  it('sabit set onbellege bakmaz (onbellegi okuyan kaynakla cagrilsa bile)', async () => {
    const t = servis();
    await t.svc.check('kobipratik.com', '', 'signup_baseline', { fixed });
    expect(t.prisma.publicCitationCheck.findMany).not.toHaveBeenCalled();
    expect(t.ai.runPublicProbes).toHaveBeenCalledTimes(1);
  });
});

describe('findRetestBaseline — abonelik anina en yakin anonim kayit', () => {
  const satir = (id: string, gunOnce: number, tier: 'anon' | 'member' = 'anon') => ({
    id, createdAt: new Date(Date.now() - gunOnce * GUN), brand: 'Kobipratik', niche: 'finans', customNiche: null,
    result: { access: { tier }, queries: [] },
  });

  function servis(oncesi: any[], sonrasi: any[]) {
    const findMany = vi.fn(async (args: any) => (args.where.createdAt.lte ? oncesi : sonrasi));
    const svc = new PublicCitationService({ publicCitationCheck: { findMany } } as never, {} as never, {} as never);
    return { svc, findMany };
  }

  it('abonelikten onceki en yeni ANONIM kayit; uye kaydi atlanir', async () => {
    const t = servis([satir('uye', 15.1, 'member'), satir('anon', 15.5), satir('daha-eski', 20)], []);
    const subscribedAt = new Date(Date.now() - 15 * GUN);
    const b = await t.svc.findRetestBaseline('https://www.Kobipratik.com/', subscribedAt);
    expect(b?.id).toBe('anon');
    expect(t.findMany).toHaveBeenCalledTimes(1);
    expect(t.findMany.mock.calls[0][0]).toMatchObject({
      where: { domain: 'kobipratik.com', createdAt: { lte: subscribedAt } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('oncesinde anonim kayit yoksa sonraki ilk anonim kayit (ornek: ilk retest)', async () => {
    const t = servis([satir('uye', 16, 'member')], [satir('ilk-retest', 1)]);
    const b = await t.svc.findRetestBaseline('kobipratik.com', new Date(Date.now() - 15 * GUN));
    expect(b?.id).toBe('ilk-retest');
    expect(t.findMany.mock.calls[1][0]).toMatchObject({ orderBy: { createdAt: 'asc' } });
  });

  it('hic yoksa null', async () => {
    const t = servis([], []);
    expect(await t.svc.findRetestBaseline('kobipratik.com', new Date())).toBeNull();
  });
});

describe('retest cron — API ve worker ayni anda tetikler, yalniz biri calisir', () => {
  it('ayni gun ikinci surec kilidi alamaz, retest bir kez calisir', async () => {
    const anahtarlar = new Set<string>();
    const prisma = {
      kvStore: {
        create: vi.fn(async ({ data }: { data: { key: string } }) => {
          if (anahtarlar.has(data.key)) throw new Error('Unique constraint failed');
          anahtarlar.add(data.key);
          return data;
        }),
      },
    };
    const subscribers = { runScheduledRetests: vi.fn(async () => ({ processed: 1, sent: 1, failed: 0 })) };
    const api = new PublicCitationRetestCron(subscribers as never, prisma as never);
    const worker = new PublicCitationRetestCron(subscribers as never, prisma as never);
    await Promise.all([api.runDailyRetests(), worker.runDailyRetests()]);
    expect(subscribers.runScheduledRetests).toHaveBeenCalledTimes(1);
    expect([...anahtarlar][0]).toMatch(/^cron-lock:public-citation-retest:\d{4}-\d{2}-\d{2}$/);
  });
});
