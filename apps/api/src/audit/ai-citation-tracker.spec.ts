import { describe, it, expect, vi } from 'vitest';
import { AiCitationTrackerService } from './ai-citation-tracker.service.js';

/**
 * getHistory: CITATION_MATCH_VERSION farkli snapshot'lar ayni seride
 * kiyaslanmaz (manset farki, saglayici trendi, RanksUp Etkisi baslangici).
 * snapshotSite: HATA satirlari kosum havuzuna ve sayaclara girmez.
 * Servis elle kurulur (Vitest decorator metadata uretmez).
 */
type Snap = { provider: string; date: string; score: number | null; matchVersion: number; citedCount?: number; mentionedCount?: number; probes?: unknown[] };

function trackerWith(snaps: Snap[]) {
  const findMany = vi.fn(async (args: any) => snaps
    .map((s, i) => ({ s, id: `snap${i}` }))
    .filter(({ id }) => !args?.where?.id?.in || args.where.id.in.includes(id))
    .map(({ s, id }) => ({
      id,
      provider: s.provider,
      date: new Date(`${s.date}T00:00:00Z`),
      score: s.score,
      citedCount: s.citedCount ?? 0,
      mentionedCount: s.mentionedCount ?? 0,
      available: s.score !== null,
      createdAt: new Date(`${s.date}T09:00:00Z`),
      matchVersion: s.matchVersion,
      ...(args?.select?.probes ? { probes: s.probes ?? [] } : {}),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime()));
  const prisma = {
    aiCitationSnapshot: { findMany },
    aiCitationRun: { findFirst: vi.fn(async () => null) },
  };
  return { svc: new AiCitationTrackerService(prisma as any, {} as any), findMany };
}

// Pencere bugune gore kurulur — tarihleri son gunlerden uret
const gunOnce = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe('AiCitationTrackerService.getHistory — yontem surumu', () => {
  it('v3 → v4 (emlak.com: 38 → 0): delta ve deltaVsPrev yok, methodChanged; noktalar surum tasir', async () => {
    const { svc, findMany } = trackerWith([
      { provider: 'openai', date: gunOnce(12), score: 38, matchVersion: 3 },
      { provider: 'openai', date: gunOnce(5), score: 38, matchVersion: 3 },
      { provider: 'openai', date: gunOnce(1), score: 0, matchVersion: 4 },
    ]);
    const h: any = await svc.getHistory('s1', 30);
    expect(findMany.mock.calls[0][0].select.matchVersion).toBe(true);

    const t = h.trends.find((x: any) => x.provider === 'openai');
    expect(t.delta).toBeNull();
    expect(t.first).toBe(0); // baslangic v3'un 38'i DEGIL
    expect(t.methodChanged).toBe(true);
    expect(t.methodChangedAt).toBe(gunOnce(1));

    expect(h.headline.deltaVsPrev).toBeNull();
    expect(h.headline.methodChanged).toBe(true);
    expect(h.headline.score).toBe(0);
    expect(h.byProvider.openai.map((p: any) => p.matchVersion)).toEqual([3, 3, 4]);
  });

  it('headline=1 (overview) ayni kurali uygular ve probe cekmez', async () => {
    const { svc, findMany } = trackerWith([
      { provider: 'gemini', date: gunOnce(10), score: 50, matchVersion: 3 },
      { provider: 'gemini', date: gunOnce(2), score: 20, matchVersion: 4 },
    ]);
    const h: any = await svc.getHistory('s1', 14, true);
    expect(findMany.mock.calls[0][0].select.probes).toBeFalsy();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(h.headline).toMatchObject({ methodChanged: true, deltaVsPrev: null, score: 20 });
    expect(h.byProvider).toBeUndefined();
  });

  it('probe JSON yalniz saglayici basina son snapshot icin cekilir (kaynaklar satiri buyuttu)', async () => {
    const { svc, findMany } = trackerWith([
      { provider: 'openai', date: gunOnce(9), score: 40, matchVersion: 4, probes: [{ query: 'eski' }] },
      { provider: 'openai', date: gunOnce(1), score: 80, matchVersion: 4, probes: [{ query: 'son-openai' }] },
      { provider: 'gemini', date: gunOnce(2), score: 20, matchVersion: 4, probes: [{ query: 'son-gemini' }] },
    ]);
    const h: any = await svc.getHistory('s1', 30);
    expect(findMany.mock.calls[0][0].select.probes).toBeFalsy();
    expect(findMany.mock.calls[1][0]).toMatchObject({ where: { id: { in: ['snap1', 'snap2'] } }, select: { probes: true } });
    const latest = Object.fromEntries(h.latestResults.map((r: any) => [r.provider, r.probes[0].query]));
    expect(latest).toEqual({ openai: 'son-openai', gemini: 'son-gemini' });
  });

  it('iki okuma arasinda ayni gun yeniden test: skor ve probe\'lar ayni (ikinci) okumadan', async () => {
    const findMany = vi.fn(async (args: any) => (args?.where?.id
      ? [{ id: 'x1', available: true, score: 90, probes: [{ query: 'yeni-kosum' }] }]
      : [{ id: 'x1', provider: 'openai', date: new Date(`${gunOnce(0)}T00:00:00Z`), score: 10, citedCount: 0, mentionedCount: 0, available: true, createdAt: new Date(), matchVersion: 4 }]));
    const prisma = { aiCitationSnapshot: { findMany }, aiCitationRun: { findFirst: vi.fn(async () => null) } };
    const h: any = await new AiCitationTrackerService(prisma as any, {} as any).getHistory('s1', 30);
    expect(h.latestResults).toEqual([{ provider: 'openai', available: true, score: 90, probes: [{ query: 'yeni-kosum' }] }]);
  });

  it('tek surum: delta ve methodChanged false', async () => {
    // manset farki icin pencere basina 2 olcum gerekir (citation-headline.ts)
    const { svc } = trackerWith([
      { provider: 'openai', date: gunOnce(12), score: 20, matchVersion: 4 },
      { provider: 'openai', date: gunOnce(9), score: 40, matchVersion: 4 },  // onceki hafta ort 30
      { provider: 'openai', date: gunOnce(4), score: 60, matchVersion: 4 },
      { provider: 'openai', date: gunOnce(1), score: 80, matchVersion: 4 },  // bu hafta ort 70
    ]);
    const h: any = await svc.getHistory('s1', 30);
    expect(h.trends[0]).toMatchObject({ first: 20, last: 80, delta: 60, methodChanged: false });
    expect(h.headline.methodChanged).toBe(false);
    expect(h.headline.deltaVsPrev).toBe(40);
  });
});

describe('AiCitationTrackerService.snapshotSite — HATA satirlari sayilmaz', () => {
  it('tamami HATA saglayici: available false/skor null yazilir; kosum havuzu yalniz olculen probe', async () => {
    const HATA = { query: 'q', cited: false, brandMentioned: false, excerpt: 'HATA: rate_limited' };
    const results = [
      { provider: 'gemini', label: 'Google Gemini', available: false, score: null, reason: 'HATA: rate_limited', probes: [HATA, HATA, HATA, HATA, HATA] },
      {
        provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 100,
        probes: [{ query: 'q1', cited: true, brandMentioned: true, brandInQuery: false, excerpt: 'kobipratik.com' }, HATA, HATA, HATA, HATA],
      },
    ];
    const upserts: any[] = [];
    let runData: any = null;
    const prisma = {
      aiCitationSnapshot: { upsert: vi.fn(async (a: any) => { upserts.push(a); return {}; }) },
      aiCitationRun: { create: vi.fn(async (a: any) => { runData = a.data; return { id: 'run1' }; }) },
    };
    const citation = { runForSite: vi.fn(async () => results) };
    const svc = new AiCitationTrackerService(prisma as any, citation as any);
    await svc.snapshotSite('s1', { trigger: 'system' });

    const gemini = upserts.find((u) => u.create.provider === 'gemini').create;
    expect(gemini).toMatchObject({ available: false, score: null, citedCount: 0, mentionedCount: 0 });
    const openai = upserts.find((u) => u.create.provider === 'openai').create;
    expect(openai).toMatchObject({ score: 100, citedCount: 1 });
    // 10 probe'dan yalniz 1'i olculdu — havuz 1, manset 100 (gemini paydaya girmez)
    expect(runData).toMatchObject({ poolSize: 1, citedCount: 1, headlineScore: 100 });
  });
});

describe('AiCitationTrackerService.snapshotSite — alintilanan kaynaklar (GEO Faz 2)', () => {
  it('snapshot probes JSON\'u sources + sourcesVersion tasir; kosum probe\'u kaynak tasimaz', async () => {
    const sources = [
      { url: 'https://reddit.com/r/x/', domain: 'reddit.com', title: 'r/x' },
      { url: 'https://bankateklifi.com/', domain: 'bankateklifi.com', originOnly: true as const },
    ];
    const results = [
      {
        provider: 'gemini', label: 'Google Gemini', available: true, score: 0,
        probes: [{ query: 'q1', cited: false, brandMentioned: false, brandInQuery: false, excerpt: 'cevap', sources, sourcesVersion: 1 }],
      },
      {
        provider: 'xai', label: 'Grok', available: true, score: 0,
        probes: [{ query: 'q1', cited: false, brandMentioned: false, brandInQuery: false, excerpt: 'cevap', sourcesVersion: 1 }],
      },
      {
        provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 0,
        probes: [{ query: 'q1', cited: false, brandMentioned: false, brandInQuery: false, excerpt: 'eski bicim' }],
      },
    ];
    const upserts: any[] = [];
    let runData: any = null;
    const prisma = {
      aiCitationSnapshot: { upsert: vi.fn(async (a: any) => { upserts.push(a); return {}; }) },
      aiCitationRun: { create: vi.fn(async (a: any) => { runData = a.data; return { id: 'run1' }; }) },
    };
    const svc = new AiCitationTrackerService(prisma as any, { runForSite: vi.fn(async () => results) } as any);
    await svc.snapshotSite('s1', { trigger: 'system' });

    const snap = upserts.find((u) => u.create.provider === 'gemini');
    expect(snap.create.probes[0].sources).toEqual(sources);
    expect(snap.update.probes[0].sourcesVersion).toBe(1);

    // Kosum (AiCitationRun) kaynak tasimaz: rapor snapshot + GeoPromptRun okur
    const run = (p: string) => runData.providers.find((x: any) => x.provider === p).probes[0];
    for (const p of ['gemini', 'xai', 'openai']) {
      expect(run(p)).not.toHaveProperty('sources');
      expect(run(p)).not.toHaveProperty('sourcesVersion');
    }
    expect(JSON.stringify(runData.providers)).not.toContain('reddit.com');
  });
});

/**
 * Tekrarli site olcumu (SITE_MEASUREMENT_VERSION 6): kayitlar v6 damgasi,
 * kosum JSON'u asistan bazinda tekrar + gorunme araligi tasir (migration yok);
 * gecmis kosumlardan ±X, ön sonuç ve aralik kararlari uretir.
 */
describe('AiCitationTrackerService — tekrar ve aralik (v6)', () => {
  const p = (query: string, tekrar: number, cited: boolean, brandMentioned = cited) =>
    ({ query, cited, brandMentioned, brandInQuery: false, excerpt: cited ? 'kobipratik.com' : 'yok', tekrar });

  it('snapshotSite: v6 damgasi, kosumda tekrar/gorunme, probe tekrar damgasi; donuste genel aralik', async () => {
    const results = [
      {
        provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 50, tekrar: 3,
        gorunme: { gorunen: 3, olculen: 6, oran: 50, alt: 18.8, ust: 81.2, yariGenislik: 31.2 },
        probes: [p('q1', 1, true), p('q2', 1, false), p('q1', 2, true), p('q2', 2, false), p('q1', 3, true), p('q2', 3, false)],
      },
      // eski bicim sonuc (alanlar yok): kosuma probe'lardan hesaplanip yazilir
      { provider: 'gemini', label: 'Google Gemini', available: true, score: 0, probes: [p('q1', 1, false), p('q2', 1, false)].map(({ tekrar: _t, ...x }) => x) },
    ];
    const upserts: any[] = [];
    let runData: any = null;
    const prisma = {
      aiCitationSnapshot: { upsert: vi.fn(async (a: any) => { upserts.push(a); return {}; }) },
      aiCitationRun: { create: vi.fn(async (a: any) => { runData = a.data; return { id: 'run1' }; }) },
    };
    const svc = new AiCitationTrackerService(prisma as any, { runForSite: vi.fn(async () => results) } as any);
    const out = await svc.snapshotSite('s1', { trigger: 'user' });

    expect(upserts.every((u) => u.create.matchVersion === 6 && u.update.matchVersion === 6)).toBe(true);
    expect(upserts.find((u) => u.create.provider === 'openai').create.probes.map((x: any) => x.tekrar)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(runData.matchVersion).toBe(6);
    const openai = runData.providers.find((x: any) => x.provider === 'openai');
    expect(openai).toMatchObject({ tekrar: 3, gorunme: { gorunen: 3, olculen: 6 } });
    expect(openai.probes.map((x: any) => x.tekrar)).toEqual([1, 1, 2, 2, 3, 3]);
    const gemini = runData.providers.find((x: any) => x.provider === 'gemini');
    expect(gemini).toMatchObject({ tekrar: 1, gorunme: { gorunen: 0, olculen: 2 } });
    expect(gemini.probes[0]).not.toHaveProperty('tekrar');

    // Genel: 8 markasiz cevaptan 3'u gorundu (kosum sutunlariyla ayni havuz)
    expect(runData).toMatchObject({ poolSize: 8, citedCount: 3 });
    expect(out).toMatchObject({ tekrar: 3, soruSayisi: 2, gorunme: { gorunen: 3, olculen: 8 } });
  });

  // Pencere bugune gore kurulur
  const iso = (n: number, saat = '09:00') => `${gunOnce(n)}T${saat}:00.000Z`;
  const kosumProviders = (gorunen: number, olculen: number, tekrar = 3) => [{
    provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: null, tekrar,
    probes: Array.from({ length: olculen }, (_, i) => p(`q${i % 5}`, Math.floor(i / 5) + 1, i < gorunen)),
  }];

  function gecmisServisi(snaps: Snap[], runs: Array<{ id: string; runAt: string; matchVersion: number; providers: unknown }>) {
    const { svc: _s, findMany } = trackerWith(snaps);
    const runFindMany = vi.fn(async (args: any) => {
      if (args?.where?.id?.in) return runs.filter((r) => args.where.id.in.includes(r.id)).map((r) => ({ id: r.id, providers: r.providers }));
      const since: Date = args?.where?.runAt?.gte;
      return runs
        .filter((r) => !since || new Date(r.runAt) >= since)
        .sort((a, b) => a.runAt.localeCompare(b.runAt))
        .map((r) => ({ id: r.id, runAt: new Date(r.runAt), matchVersion: r.matchVersion }));
    });
    const sonKosum = [...runs].sort((a, b) => b.runAt.localeCompare(a.runAt))[0] ?? null;
    const prisma = {
      aiCitationSnapshot: { findMany },
      aiCitationRun: {
        findFirst: vi.fn(async () => (sonKosum ? { runAt: new Date(sonKosum.runAt), matchVersion: sonKosum.matchVersion } : null)),
        findMany: runFindMany,
        count: vi.fn(async ({ where }: any) => runs.filter((r) => r.matchVersion === where.matchVersion).length),
      },
    };
    return { svc: new AiCitationTrackerService(prisma as any, {} as any), runFindMany };
  }

  it('tek v6 olcum: ön sonuç, ±X ve "3 tekrar × 5 soru"; eski v5 kosum kiyasa girmez', async () => {
    const { svc } = gecmisServisi(
      [
        { provider: 'openai', date: gunOnce(20), score: 0, matchVersion: 5 },
        { provider: 'openai', date: gunOnce(1), score: 40, matchVersion: 6 },
      ],
      [
        { id: 'r5', runAt: iso(20), matchVersion: 5, providers: kosumProviders(0, 5, 1) },
        { id: 'r6', runAt: iso(1), matchVersion: 6, providers: kosumProviders(6, 15) },
      ],
    );
    const h: any = await svc.getHistory('s1', 30);
    expect(h.olcum.onSonuc).toBe(true);
    expect(h.olcum.son).toMatchObject({ tekrar: 3, soruSayisi: 5, gorunme: { gorunen: 6, olculen: 15 } });
    expect(h.olcum.manset.gorunme).toMatchObject({ gorunen: 6, olculen: 15 });
    expect(h.olcum.manset.gorunme.yariGenislik).toBeGreaterThan(0);
    // v5 → v6: trend kesiti yalniz v6 (tek nokta) → kiyas yok; haftalik da yok
    expect(h.olcum.etki.karar).toBeNull();
    expect(h.olcum.haftalik.karar).toBeNull();
  });

  it('iki v6 olcum: haftalik ve etki kararlari araliktan; gunun SON kosumu kullanilir; headline=1 de doner', async () => {
    const { svc, runFindMany } = gecmisServisi(
      [
        { provider: 'openai', date: gunOnce(9), score: 7, matchVersion: 6 },
        { provider: 'openai', date: gunOnce(2), score: 60, matchVersion: 6 },
      ],
      [
        // ayni gun iki kosum: snapshot gunun sonuncusunu tutar → kiyas 1/15 ile
        { id: 'a1', runAt: iso(9, '08:00'), matchVersion: 6, providers: kosumProviders(15, 15) },
        { id: 'a2', runAt: iso(9, '10:00'), matchVersion: 6, providers: kosumProviders(1, 15) },
        { id: 'b', runAt: iso(2), matchVersion: 6, providers: kosumProviders(12, 15) },
      ],
    );
    const h: any = await svc.getHistory('s1', 14, true);
    expect(h.olcum.onSonuc).toBe(false);
    expect(h.olcum.haftalik).toMatchObject({ karar: 'artti', once: { gorunen: 1, olculen: 15 }, sonra: { gorunen: 12, olculen: 15 } });
    expect(h.olcum.etki.karar).toBe('artti');
    expect(h.olcum.asistanlar.openai.karar).toBe('artti');
    // providers JSON yalniz gereken kosumlar icin (gunun son kosumu) okundu — a1 okunmadi
    const idCagrisi = runFindMany.mock.calls.find((c: any[]) => c[0]?.where?.id?.in)![0];
    expect([...idCagrisi.where.id.in].sort()).toEqual(['a2', 'b']);
    expect(idCagrisi.select).toEqual({ id: true, providers: true });
  });

  it('kosum okunamazsa gecmis dusmez: blok bos, kararlar null', async () => {
    const { svc } = trackerWith([{ provider: 'openai', date: gunOnce(1), score: 40, matchVersion: 6 }]);
    const h: any = await svc.getHistory('s1', 30);
    expect(h.olcum).toMatchObject({ son: null, onSonuc: false, etki: { karar: null }, haftalik: { karar: null } });
    expect(h.trends[0].last).toBe(40);
  });

  it('listRuns: kosum basina genel aralik (sutunlardan) ve tekrar', async () => {
    const prisma = {
      aiCitationRun: {
        findMany: vi.fn(async () => [
          { id: 'r6', runAt: new Date(iso(1)), trigger: 'user', headlineScore: 40, citedCount: 4, mentionedCount: 2, poolSize: 15, providers: kosumProviders(6, 15) },
          { id: 'r5', runAt: new Date(iso(9)), trigger: 'system', headlineScore: 0, citedCount: 0, mentionedCount: 0, poolSize: 5, providers: kosumProviders(0, 5, 1).map(({ tekrar: _t, ...x }) => x) },
        ]),
      },
    };
    const runs = await new AiCitationTrackerService(prisma as any, {} as any).listRuns('s1');
    expect(runs[0]).toMatchObject({ tekrar: 3, gorunme: { gorunen: 6, olculen: 15 } });
    expect(runs[0].providers[0]).not.toHaveProperty('probes');
    expect(runs[1]).toMatchObject({ tekrar: 1, gorunme: { gorunen: 0, olculen: 5 } });
  });
});

/**
 * 11.11.2026 (uc paket) — bagimsiz incelemenin iki bulgusu:
 *  1. Model kademesi yontem surumune damgalanir (host-match siteMeasurementVersion). Deneme /
 *     Baslangic hesabi Claude'u hizli modelle olcer; surum ayni kalsa Opus → Haiku gecisi trendde
 *     ve dusus alarminda "gorunurluk degisti" diye okunurdu.
 *  2. Gecmis, hesabin BUGUN olctugu asistanlarla okunur. Paketi daralan hesabin eski Grok /
 *     DeepSeek satirlari manset ortalamasinda ve "son sonuc" listesinde duruyordu.
 */
describe('AiCitationTrackerService — model kademesi ve plan kapsami', () => {
  const sonuc = (provider: string, score: number, modelTier?: string) => ({
    provider, label: provider, available: true, score, probes: [], ...(modelTier ? { modelTier } : {}),
  });
  async function kaydet(results: any[]) {
    const upserts: any[] = [];
    let runData: any = null;
    const prisma = {
      aiCitationSnapshot: { upsert: vi.fn(async (a: any) => { upserts.push(a); return {}; }) },
      aiCitationRun: { create: vi.fn(async (a: any) => { runData = a.data; return { id: 'run1' }; }) },
    };
    await new AiCitationTrackerService(prisma as any, { runForSite: vi.fn(async () => results) } as any).snapshotSite('s1', { trigger: 'system' });
    return { upserts, runData };
  }

  it('standard kademe (Baslangic, deneme): snapshot ve kosum 106 damgasi; premium ve damgasiz sonuc 6', async () => {
    const std = await kaydet([sonuc('openai', 40, 'standard'), sonuc('anthropic', 20, 'standard')]);
    expect(std.upserts.map((u) => [u.create.matchVersion, u.update.matchVersion])).toEqual([[106, 106], [106, 106]]);
    expect(std.runData.matchVersion).toBe(106);
    const pre = await kaydet([sonuc('openai', 40, 'premium'), sonuc('xai', 20, 'premium')]);
    expect(pre.upserts.every((u) => u.create.matchVersion === 6 && u.update.matchVersion === 6)).toBe(true);
    expect(pre.runData.matchVersion).toBe(6);
    // Kademe tasimayan sonuc (eski cagiran): eski surum
    expect((await kaydet([sonuc('openai', 40)])).runData.matchVersion).toBe(6);
  });

  it('getHistory: kademe degisimi (6 → 106) Claude serisinde "yontem degisti" okunur, fark hesaplanmaz', async () => {
    const { svc } = trackerWith([
      { provider: 'anthropic', date: gunOnce(9), score: 60, matchVersion: 6 },
      { provider: 'anthropic', date: gunOnce(2), score: 20, matchVersion: 106 },
    ]);
    const h: any = await svc.getHistory('s1', 30);
    const t = h.trends.find((x: any) => x.provider === 'anthropic');
    expect(t.methodChanged).toBe(true);
    expect(t.delta).toBeNull();
    expect(h.headline.methodChanged).toBe(true);
    expect(h.headline.deltaVsPrev).toBeNull();
  });

  function kapsamli(plan: string, role: string, snaps: Snap[]) {
    const t = trackerWith(snaps);
    ((t.svc as any).prisma as any).site = { findUnique: vi.fn(async () => ({ user: { plan, role } })) };
    return t.svc;
  }
  const ESKI_VE_YENI: Snap[] = [
    // Paket daralmadan once: alti asistan (v6)
    ...['openai', 'gemini', 'anthropic', 'perplexity'].map((provider) => ({ provider, date: gunOnce(9), score: 20, matchVersion: 6 })),
    { provider: 'xai', date: gunOnce(9), score: 80, matchVersion: 6 },
    { provider: 'deepseek', date: gunOnce(9), score: 80, matchVersion: 6 },
    // Sonra: dort asistan (standard kademe, v106)
    ...['openai', 'gemini', 'anthropic', 'perplexity'].map((provider) => ({ provider, date: gunOnce(2), score: 20, matchVersion: 106 })),
  ];

  it('Baslangic / deneme hesabi: eski Grok ve DeepSeek satirlari mansete, trende ve son sonuclara girmez', async () => {
    for (const plan of ['STARTER', 'TRIAL']) {
      const h: any = await kapsamli(plan, 'USER', ESKI_VE_YENI).getHistory('s1', 30);
      expect(Object.keys(h.byProvider).sort(), plan).toEqual(['anthropic', 'gemini', 'openai', 'perplexity']);
      expect(h.trends.map((t: any) => t.provider).sort(), plan).toEqual(['anthropic', 'gemini', 'openai', 'perplexity']);
      expect(h.latestResults.map((r: any) => r.provider).sort(), plan).toEqual(['anthropic', 'gemini', 'openai', 'perplexity']);
      // Manset yalniz olculen dort asistandan: 20 (eskiden bayat 80'lerle 40 cikiyordu)
      expect(h.headline.score, plan).toBe(20);
    }
  });

  it('Profesyonel ve ustu ile ADMIN: hicbir asistan suzulmez (davranis degismedi)', async () => {
    const hepsiV6: Snap[] = ['openai', 'gemini', 'anthropic', 'perplexity', 'xai', 'deepseek', 'meta']
      .map((provider) => ({ provider, date: gunOnce(2), score: 30, matchVersion: 6 }));
    for (const [plan, role] of [['PRO', 'USER'], ['AGENCY', 'USER'], ['ENTERPRISE', 'USER'], ['TRIAL', 'ADMIN']] as const) {
      const h: any = await kapsamli(plan, role, hepsiV6).getHistory('s1', 30);
      expect(Object.keys(h.byProvider).sort(), plan).toEqual(['anthropic', 'deepseek', 'gemini', 'meta', 'openai', 'perplexity', 'xai']);
      expect(h.latestResults).toHaveLength(7);
    }
  });

  it('site ya da sahibi okunamazsa suzme yapilmaz (gecmis dusmez)', async () => {
    const { svc } = trackerWith(ESKI_VE_YENI); // prisma.site yok
    const h: any = await svc.getHistory('s1', 30);
    expect(Object.keys(h.byProvider)).toContain('xai');
    const t = trackerWith(ESKI_VE_YENI);
    ((t.svc as any).prisma as any).site = { findUnique: vi.fn(async () => { throw new Error('db'); }) };
    expect(Object.keys(((await t.svc.getHistory('s1', 30)) as any).byProvider)).toContain('deepseek');
  });
});

