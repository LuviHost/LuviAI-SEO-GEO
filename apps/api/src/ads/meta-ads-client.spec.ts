import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { MetaAdsClientService, distributeMetaBudget, metaConversions, metaCount, metaPurchaseValue, metaTimeMs, parseMetaMinor } from './meta-ads-client.service.js';

/**
 * Meta gunluk butce yazimi (G9). Eskiden once kampanyaya yazmayi deniyor,
 * reddedilince ad set listesinin ILK sayfasina tutari esit bolerek yaziyor ve
 * liste bossa hicbir sey yazmadan { ok: true } donuyordu: arsivlenmis/silinmis
 * kampanyada sahte "butce artirildi", kaydiricida Meta azaltilmadan Google
 * artiriliyordu. Sahte Graph API: GET kampanya / ad set sayfalari, POST yazimlar.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const prismaFor = () => ({
  site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', metaAdsAccessToken: 'raw-token', metaAdsAccountId: 'act_1' })) },
}) as any;

type Post = { id: string; daily: number };

/**
 * campaign: GET /{id}?fields=effective_status,... govdesi. pages: ad set
 * sayfalari (her biri bir sonrakine paging.next ile baglanir). post: yazim
 * sonucu (varsayilan 200); 'throw' ag hatasi.
 */
function fakeGraph(opts: {
  currency?: string;
  campaign: Record<string, unknown> | number;
  pages?: Array<Array<Record<string, unknown>>>;
  pageStatus?: (i: number) => number;
  nextUrl?: (i: number) => string | undefined;
  post?: (p: Post, n: number) => number | 'throw';
}) {
  const posts: Post[] = [];
  const gets: string[] = [];
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (init?.method === 'POST') {
      const id = url.slice(`${GRAPH}/`.length);
      const daily = Number(new URLSearchParams(String(init.body)).get('daily_budget'));
      const p = { id, daily };
      posts.push(p);
      const r = opts.post ? opts.post(p, posts.length) : 200;
      if (r === 'throw') throw new TypeError('fetch failed');
      return json(r, r === 200 ? { success: true } : { error: { message: 'Invalid parameter', code: 100 } });
    }
    gets.push(url);
    if (url.includes('fields=currency')) return json(200, { currency: opts.currency ?? 'TRY' });
    if (url.includes('/adsets?')) {
      const i = Number(url.match(/after=p(\d+)/)?.[1] ?? 0);
      const status = opts.pageStatus?.(i) ?? 200;
      if (status !== 200) return json(status, { error: { message: 'x', code: 1 } });
      const pages = opts.pages ?? [[]];
      const next = opts.nextUrl ? opts.nextUrl(i) : i + 1 < pages.length ? `${GRAPH}/999/adsets?after=p${i + 1}&access_token=raw-token` : undefined;
      return json(200, { data: pages[i] ?? [], ...(next ? { paging: { cursors: { after: `p${i + 1}` }, next } } : {}) });
    }
    if (url.includes('?fields=effective_status')) {
      return typeof opts.campaign === 'number' ? json(opts.campaign, { error: { message: 'x', code: 100 } }) : json(200, { id: '999', ...opts.campaign });
    }
    return json(404, {});
  });
  return { fetchMock, posts, gets };
}

const adset = (id: string, daily: number | null, over: Record<string, unknown> = {}) => ({
  id, status: 'ACTIVE', ...(daily === null ? {} : { daily_budget: String(daily) }), ...over,
});

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Meta updateDailyBudget — yazmadan once okur', () => {
  it('arsivlenmis ya da silinmis kampanya: ok:false, HICBIR yazim yok (eskiden { ok: true })', async () => {
    for (const status of ['ARCHIVED', 'DELETED']) {
      const g = fakeGraph({ campaign: { effective_status: status }, pages: [[]] });
      const res = await new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100);
      expect(res).toEqual({ ok: false, error: expect.stringMatching(/arşivlenmiş ya da silinmiş/) });
      expect(g.posts).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });

  it('etkin/duraklatilmis disindaki durumlar (IN_PROCESS, WITH_ISSUES) da yazilmaz', async () => {
    for (const status of ['IN_PROCESS', 'WITH_ISSUES']) {
      const g = fakeGraph({ campaign: { effective_status: status, daily_budget: '10000' } });
      await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false });
      expect(g.posts).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });

  it('etkin ad set yoksa (bos liste) ok:false ve yazim yok', async () => {
    const g = fakeGraph({ campaign: { effective_status: 'ACTIVE' }, pages: [[]] });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false });
    expect(g.posts).toHaveLength(0);
  });

  it('kampanya okunamazsa yazim yok', async () => {
    const g = fakeGraph({ campaign: 500 });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false });
    expect(g.posts).toHaveLength(0);
  });

  it('kimlik rakam degilse Meta\'ya hic istek gitmez', async () => {
    const g = fakeGraph({ campaign: { effective_status: 'ACTIVE', daily_budget: '10000' } });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999/adsets?x=', 120, 100)).resolves.toMatchObject({ ok: false });
    expect(g.fetchMock).not.toHaveBeenCalled();
  });

  it('kampanya butcesi (CBO): yalniz kampanyaya yazilir, uygulanan tutar doner', async () => {
    const g = fakeGraph({ campaign: { effective_status: 'ACTIVE', daily_budget: '10000' } });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: true, applied: 120 });
    expect(g.posts).toEqual([{ id: '999', daily: 12000 }]);
    expect(g.gets.some((u) => u.includes('/adsets'))).toBe(false);
  });

  it('duraklatilmis kampanyanin (PAUSED) butcesi istemci duzeyinde yazilabilir', async () => {
    const g = fakeGraph({ campaign: { effective_status: 'PAUSED', daily_budget: '10000' } });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: true, applied: 120 });
    expect(g.posts).toHaveLength(1);
  });

  it('canli butce beklenenden farkliysa (canli 50, beklenen 500) yazilmaz', async () => {
    const g = fakeGraph({ campaign: { effective_status: 'ACTIVE', daily_budget: '5000' } });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 600, 500))
      .resolves.toEqual({ ok: false, stale: true, live: 50, error: expect.stringMatching(/değişmiş/) });
    expect(g.posts).toHaveLength(0);
  });

  it('toplam butceli kampanya ya da karisik ad set butceleri: gunluk tutar yazilmaz', async () => {
    let g = fakeGraph({ campaign: { effective_status: 'ACTIVE', lifetime_budget: '900000' } });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100))
      .resolves.toEqual({ ok: false, error: expect.stringMatching(/günlük değil/) });
    expect(g.posts).toHaveLength(0);
    vi.restoreAllMocks();

    g = fakeGraph({ campaign: { effective_status: 'ACTIVE' }, pages: [[adset('1', 5000), adset('2', null, { lifetime_budget: '90000' })]] });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 50)).resolves.toEqual({ ok: false });
    expect(g.posts).toHaveLength(0);
  });
});

describe('Meta updateDailyBudget — ad set butceleri', () => {
  it('TUM sayfalardaki etkin ad set\'ler oranlari korunarak olceklenir; duraklatilmis ad set\'e dokunulmaz', async () => {
    // Sayfa 1: 60 + 20 (+ duraklatilmis 500), sayfa 2: 20 → canli toplam 100 TRY
    const g = fakeGraph({
      campaign: { effective_status: 'ACTIVE' },
      pages: [[adset('1', 6000), adset('2', 2000), adset('3', 50000, { status: 'PAUSED' })], [adset('4', 2000)]],
    });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: true, applied: 120 });
    expect(g.posts).toEqual([{ id: '1', daily: 7200 }, { id: '2', daily: 2400 }, { id: '4', daily: 2400 }]);
    const adsetGets = g.gets.filter((u) => u.includes('/adsets'));
    expect(adsetGets).toHaveLength(2);
    // Arsivlenmis/silinmis ad set'ler acikca istenmez
    const statuses = JSON.parse(decodeURIComponent(adsetGets[0].match(/effective_status=([^&]+)/)![1]));
    expect(statuses).not.toContain('ARCHIVED');
    expect(statuses).not.toContain('DELETED');
    expect(adsetGets[0]).toContain('fields=id,status,daily_budget,lifetime_budget');
  });

  it('bir ad set yazimi reddedilirse onceden yazilanlar eski degerine dondurulur; ok:false', async () => {
    const g = fakeGraph({
      campaign: { effective_status: 'ACTIVE' },
      pages: [[adset('1', 5000), adset('2', 5000)]],
      post: (_p, n) => (n === 2 ? 400 : 200),
    });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false });
    expect(g.posts).toEqual([
      { id: '1', daily: 6000 },
      { id: '2', daily: 6000 }, // reddedildi
      { id: '1', daily: 5000 }, // geri alindi
    ]);
  });

  it('geri alma da basarisizsa sonuc belirsiz (uncertain) doner', async () => {
    const g = fakeGraph({
      campaign: { effective_status: 'ACTIVE' },
      pages: [[adset('1', 5000), adset('2', 5000)]],
      post: (_p, n) => (n === 1 ? 200 : 400),
    });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false, uncertain: true });
    expect(g.posts).toHaveLength(3);
  });

  it('ag hatasiyla sonucu bilinmeyen yazim da geri alinir; geri alinirsa sonuc kesin (ok:false)', async () => {
    const g = fakeGraph({
      campaign: { effective_status: 'ACTIVE' },
      pages: [[adset('1', 5000), adset('2', 5000)]],
      post: (_p, n) => (n === 2 ? 'throw' : 200),
    });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false });
    expect(g.posts).toEqual([
      { id: '1', daily: 6000 },
      { id: '2', daily: 6000 }, // sonuc bilinmiyor
      { id: '1', daily: 5000 },
      { id: '2', daily: 5000 },
    ]);
  });

  it('kampanya butcesine (CBO) yazim ag hatasiyla duserse eski deger geri yazilir; o da olmazsa belirsiz', async () => {
    let g = fakeGraph({ campaign: { effective_status: 'ACTIVE', daily_budget: '10000' }, post: (_p, n) => (n === 1 ? 'throw' : 200) });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false });
    expect(g.posts).toEqual([{ id: '999', daily: 12000 }, { id: '999', daily: 10000 }]);
    vi.restoreAllMocks();

    g = fakeGraph({ campaign: { effective_status: 'ACTIVE', daily_budget: '10000' }, post: () => 'throw' });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false, uncertain: true });
  });

  it('bir ad set sayfasi okunamazsa ya da sonraki sayfa adresi Graph disindaysa eksik listeyle yazilmaz', async () => {
    let g = fakeGraph({ campaign: { effective_status: 'ACTIVE' }, pages: [[adset('1', 5000)], [adset('2', 5000)]], pageStatus: (i) => (i === 1 ? 500 : 200) });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false });
    expect(g.posts).toHaveLength(0);
    vi.restoreAllMocks();

    g = fakeGraph({ campaign: { effective_status: 'ACTIVE' }, pages: [[adset('1', 5000)]], nextUrl: () => 'https://evil.example/adsets?after=p1' });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 60, 50)).resolves.toEqual({ ok: false });
    expect(g.posts).toHaveLength(0);
    expect(g.gets.some((u) => u.startsWith('https://evil.example'))).toBe(false);
  });
});

describe('Meta getLiveBudget', () => {
  it('CBO gunluk, ad set toplami, toplam butce ve kalici son', async () => {
    const cases: Array<[Parameters<typeof fakeGraph>[0], Record<string, unknown>]> = [
      [{ campaign: { effective_status: 'ACTIVE', daily_budget: '5000' } }, { status: 'ACTIVE', platformStatus: 'ACTIVE', budgetType: 'daily', amount: 50 }],
      [{ campaign: { effective_status: 'ACTIVE', daily_budget: '0' }, pages: [[adset('1', 3000), adset('2', 4550)]] }, { budgetType: 'daily', amount: 75.5 }],
      [{ campaign: { effective_status: 'PAUSED', lifetime_budget: '900000' } }, { status: 'PAUSED', budgetType: 'lifetime', amount: 9000 }],
      [{ campaign: { effective_status: 'ARCHIVED' } }, { status: 'ENDED', platformStatus: 'ARCHIVED', budgetType: null, amount: null }],
      [{ campaign: { effective_status: 'DELETED' } }, { status: 'ENDED', platformStatus: 'DELETED' }],
      [{ campaign: { effective_status: 'WITH_ISSUES', daily_budget: '5000' } }, { status: 'OTHER', platformStatus: 'WITH_ISSUES' }],
      [{ currency: 'JPY', campaign: { effective_status: 'ACTIVE', daily_budget: '1200' } }, { budgetType: 'daily', amount: 1200 }],
    ];
    for (const [graph, expected] of cases) {
      const g = fakeGraph(graph);
      const res = await new MetaAdsClientService(prismaFor()).getLiveBudget('s1', '999');
      expect(res.ok).toBe(true);
      expect((res as any).live).toMatchObject(expected);
      expect(g.posts).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });

  it('Meta hata mesaji bir adres yansitsa bile belirtec loga girmez', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('fields=currency')) return json(200, { currency: 'TRY' });
      return json(400, { error: { message: `Bad request ${GRAPH}/999?fields=x&access_token=gizli-belirtec-123`, code: 100 } });
    });
    const warn = vi.mocked(Logger.prototype.warn);
    await expect(new MetaAdsClientService(prismaFor()).getLiveBudget('s1', '999')).resolves.toEqual({ ok: false });
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('kod 100');
    expect(logged).not.toContain('gizli-belirtec-123');
  });

  it('arsivlenmis kampanyada ad set listesi istenmez; okunamayan kampanya → ok:false', async () => {
    let g = fakeGraph({ campaign: { effective_status: 'ARCHIVED' } });
    await new MetaAdsClientService(prismaFor()).getLiveBudget('s1', '999');
    expect(g.gets.some((u) => u.includes('/adsets'))).toBe(false);
    vi.restoreAllMocks();

    g = fakeGraph({ campaign: 400 });
    await expect(new MetaAdsClientService(prismaFor()).getLiveBudget('s1', '999')).resolves.toEqual({ ok: false });
  });
});

/** Graph API okuma bicimi: ISO-8601, saat dilimi iki noktasiz (+0300) */
const graphTime = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000');
const GECEN_HAFTA = graphTime(Date.now() - 7 * 86_400_000);
const GELECEK_AY = graphTime(Date.now() + 30 * 86_400_000);

describe('R9 — yayin takvimi bitmis Meta reklam setleri (effective_status ACTIVE kalsa da harcamaz)', () => {
  it('bitmis ad set canli toplama ve yazim hedeflerine girmez; bitmemis ve bitis tarihsiz olanlar olceklenir', async () => {
    // Bitmis 200 TRY (harcamaz) + yayinda 60 (bitis gelecek ay) + 40 (bitis yok) → canli toplam 100
    const g = fakeGraph({
      campaign: { effective_status: 'ACTIVE' },
      pages: [[
        adset('1', 20000, { end_time: GECEN_HAFTA }),
        adset('2', 6000, { end_time: GELECEK_AY }),
        adset('3', 4000),
      ]],
    });
    const svc = new MetaAdsClientService(prismaFor());
    await expect(svc.getLiveBudget('s1', '999')).resolves.toEqual({
      ok: true, live: { status: 'ACTIVE', platformStatus: 'ACTIVE', budgetType: 'daily', amount: 100 },
    });
    // Eskiden canli toplam 300 okunurdu; 300 bekleyen yazim artik "bayat" sayilir
    await expect(svc.updateDailyBudget('s1', '999', 360, 300)).resolves.toMatchObject({ ok: false, stale: true, live: 100 });
    expect(g.posts).toHaveLength(0);
    await expect(svc.updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: true, applied: 120 });
    // Bitmis ad set'e (1) hic yazilmaz
    expect(g.posts).toEqual([{ id: '2', daily: 7200 }, { id: '3', daily: 4800 }]);
    expect(g.gets.find((u) => u.includes('/adsets'))).toContain('fields=id,status,daily_budget,lifetime_budget,end_time');
  });

  it('etkin ad set\'lerin HEPSI bitmisse kampanya yayinda sayilmaz: OTHER (kalici ENDED degil), yazim yok', async () => {
    const g = fakeGraph({
      campaign: { effective_status: 'ACTIVE' },
      pages: [[adset('1', 30000, { end_time: GECEN_HAFTA }), adset('2', 20000, { end_time: GECEN_HAFTA })]],
    });
    const svc = new MetaAdsClientService(prismaFor());
    const res = await svc.getLiveBudget('s1', '999');
    expect(res).toEqual({ ok: true, live: { status: 'OTHER', platformStatus: 'ACTIVE/COMPLETED', budgetType: null, amount: null } });
    await expect(svc.updateDailyBudget('s1', '999', 600, 500)).resolves.toEqual({ ok: false, error: expect.stringMatching(/yayın takvimi bitmiş/) });
    expect(g.posts).toHaveLength(0);
  });

  it('kampanya butcesi (CBO): stop_time gecmisse OTHER ve yazim yok; gelecekteyse ya da yoksa normal; duraklatilmis duraklatilmis kalir', async () => {
    let g = fakeGraph({ campaign: { effective_status: 'ACTIVE', daily_budget: '10000', stop_time: GECEN_HAFTA } });
    let svc = new MetaAdsClientService(prismaFor());
    await expect(svc.getLiveBudget('s1', '999')).resolves.toEqual({
      ok: true, live: { status: 'OTHER', platformStatus: 'ACTIVE/COMPLETED', budgetType: 'daily', amount: 100 },
    });
    await expect(svc.updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false, error: expect.stringMatching(/yayın takvimi bitmiş/) });
    expect(g.posts).toHaveLength(0);
    vi.restoreAllMocks();

    g = fakeGraph({ campaign: { effective_status: 'ACTIVE', daily_budget: '10000', stop_time: GELECEK_AY } });
    svc = new MetaAdsClientService(prismaFor());
    await expect(svc.updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: true, applied: 120 });
    expect(g.posts).toEqual([{ id: '999', daily: 12000 }]);
    vi.restoreAllMocks();

    fakeGraph({ campaign: { effective_status: 'PAUSED', daily_budget: '10000', stop_time: GECEN_HAFTA } });
    await expect(new MetaAdsClientService(prismaFor()).getLiveBudget('s1', '999')).resolves.toMatchObject({
      ok: true, live: { status: 'PAUSED', platformStatus: 'PAUSED' },
    });
  });

  it('bitis zamani okunamayan etkin ad set varsa butce okunmaz ve yazilmaz (bitip bitmedigi bilinmiyor)', async () => {
    const g = fakeGraph({ campaign: { effective_status: 'ACTIVE' }, pages: [[adset('1', 5000), adset('2', 5000, { end_time: 'yarin' })]] });
    const svc = new MetaAdsClientService(prismaFor());
    await expect(svc.getLiveBudget('s1', '999')).resolves.toEqual({ ok: false });
    await expect(svc.updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false });
    expect(g.posts).toHaveLength(0);
  });

  it('metaTimeMs: ISO (+0300 / -07:00 / Z), UNIX saniye; yok/0/1970 = bitis yok (null); bozuk = undefined', () => {
    expect(metaTimeMs('2026-10-01T23:59:59+0300')).toBe(Date.parse('2026-10-01T20:59:59Z'));
    expect(metaTimeMs('2013-10-02T00:00:00-0700')).toBe(Date.parse('2013-10-02T07:00:00Z'));
    expect(metaTimeMs('2026-10-01T10:00:00-07:00')).toBe(Date.parse('2026-10-01T17:00:00Z'));
    expect(metaTimeMs('2026-10-01T10:00:00Z')).toBe(Date.parse('2026-10-01T10:00:00Z'));
    expect(metaTimeMs('1790000000')).toBe(1_790_000_000_000);
    expect(metaTimeMs(1_790_000_000)).toBe(1_790_000_000_000);
    for (const yok of [undefined, null, '', 0, '0', '1970-01-01T00:00:00+0000', '1969-12-31T16:00:00-0800']) expect(metaTimeMs(yok)).toBeNull();
    for (const bozuk of ['yarin', '2026-13-01T00:00:00+0000', '2026-10-01', {}, Number.NaN, '2026-10-01T00:00:00+2500']) expect(metaTimeMs(bozuk)).toBeUndefined();
  });
});

const GELECEK_HAFTA = graphTime(Date.now() + 7 * 86_400_000);

describe('Baslangici gelecekte olan (henuz baslamamis) Meta reklam setleri — Google PENDING karsiligi', () => {
  it('baslamamis ad set canli toplama ve yazim hedeflerine girmez; baslamis olanlar ve baslangic alani gelmeyenler olceklenir', async () => {
    // Yayinda 60 (gecen hafta basladi) + 40 (baslangic alani yok) + haftaya baslayacak 400 → canli toplam 100
    const g = fakeGraph({
      campaign: { effective_status: 'ACTIVE' },
      pages: [[
        adset('1', 6000, { start_time: GECEN_HAFTA }),
        adset('2', 40000, { start_time: GELECEK_HAFTA }),
        adset('3', 4000),
      ]],
    });
    const svc = new MetaAdsClientService(prismaFor());
    await expect(svc.getLiveBudget('s1', '999')).resolves.toEqual({
      ok: true, live: { status: 'ACTIVE', platformStatus: 'ACTIVE', budgetType: 'daily', amount: 100 },
    });
    // Eskiden canli toplam 500 okunurdu (guard tabani 500, tavan 1000); 500 bekleyen yazim artik bayat
    await expect(svc.updateDailyBudget('s1', '999', 600, 500)).resolves.toMatchObject({ ok: false, stale: true, live: 100 });
    expect(g.posts).toHaveLength(0);
    await expect(svc.updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: true, applied: 120 });
    // Haftaya baslayacak ad set'e (2) hic yazilmaz
    expect(g.posts).toEqual([{ id: '1', daily: 7200 }, { id: '3', daily: 4800 }]);
    expect(g.gets.find((u) => u.includes('/adsets'))).toMatch(/fields=[^&]*\bstart_time\b/);
  });

  it('etkin ad set\'lerin HICBIRI baslamamissa kampanya OTHER (ACTIVE/SCHEDULED, kalici degil), yazim yok, Turkce neden', async () => {
    const g = fakeGraph({
      campaign: { effective_status: 'ACTIVE' },
      pages: [[adset('1', 30000, { start_time: GELECEK_HAFTA }), adset('2', 20000, { start_time: GELECEK_AY })]],
    });
    const svc = new MetaAdsClientService(prismaFor());
    await expect(svc.getLiveBudget('s1', '999')).resolves.toEqual({
      ok: true, live: { status: 'OTHER', platformStatus: 'ACTIVE/SCHEDULED', budgetType: null, amount: null },
    });
    await expect(svc.updateDailyBudget('s1', '999', 600, 500))
      .resolves.toEqual({ ok: false, error: 'Meta kampanyasında şu an yayında olan reklam seti yok; kalan reklam setlerinin başlangıç tarihi henüz gelmedi. Bütçesi değiştirilmedi.' });
    expect(g.posts).toHaveLength(0);
  });

  it('bir kismi bitmis, kalani baslamamis (yayinda hic yok): ACTIVE/SCHEDULED; bitmis ad set\'in baslangici okunmaz', async () => {
    const g = fakeGraph({
      campaign: { effective_status: 'ACTIVE' },
      pages: [[adset('1', 30000, { end_time: GECEN_HAFTA, start_time: 'okunamaz' }), adset('2', 20000, { start_time: GELECEK_HAFTA })]],
    });
    const svc = new MetaAdsClientService(prismaFor());
    await expect(svc.getLiveBudget('s1', '999')).resolves.toMatchObject({ ok: true, live: { status: 'OTHER', platformStatus: 'ACTIVE/SCHEDULED' } });
    await expect(svc.updateDailyBudget('s1', '999', 600, 500)).resolves.toEqual({ ok: false, error: expect.stringMatching(/şu an yayında olan reklam seti yok/) });
    expect(g.posts).toHaveLength(0);
  });

  it('bitmemis etkin ad set\'in baslangici okunamazsa butce okunmaz ve yazilmaz (baslayip baslamadigi bilinmiyor)', async () => {
    const g = fakeGraph({ campaign: { effective_status: 'ACTIVE' }, pages: [[adset('1', 5000), adset('2', 5000, { start_time: 'yarin' })]] });
    const svc = new MetaAdsClientService(prismaFor());
    await expect(svc.getLiveBudget('s1', '999')).resolves.toEqual({ ok: false });
    await expect(svc.updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false });
    expect(g.posts).toHaveLength(0);
  });

  it('kampanya butcesi (CBO): start_time gelecekteyse OTHER ve yazim yok; gecmisteyse normal; okunamazsa okunmaz; duraklatilmis duraklatilmis kalir', async () => {
    let g = fakeGraph({ campaign: { effective_status: 'ACTIVE', daily_budget: '10000', start_time: GELECEK_HAFTA } });
    let svc = new MetaAdsClientService(prismaFor());
    await expect(svc.getLiveBudget('s1', '999')).resolves.toEqual({
      ok: true, live: { status: 'OTHER', platformStatus: 'ACTIVE/SCHEDULED', budgetType: 'daily', amount: 100 },
    });
    await expect(svc.updateDailyBudget('s1', '999', 120, 100))
      .resolves.toEqual({ ok: false, error: 'Meta, kampanyanın başlangıç tarihini gelecekte gösteriyor; bu yüzden bütçesi değiştirilmedi.' });
    expect(g.posts).toHaveLength(0);
    expect(g.gets.find((u) => u.includes('?fields=effective_status'))).toMatch(/fields=[^&]*\bstart_time\b/);
    vi.restoreAllMocks();

    g = fakeGraph({ campaign: { effective_status: 'ACTIVE', daily_budget: '10000', start_time: GECEN_HAFTA } });
    svc = new MetaAdsClientService(prismaFor());
    await expect(svc.updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: true, applied: 120 });
    expect(g.posts).toEqual([{ id: '999', daily: 12000 }]);
    vi.restoreAllMocks();

    g = fakeGraph({ campaign: { effective_status: 'ACTIVE', daily_budget: '10000', start_time: 'yarin' } });
    await expect(new MetaAdsClientService(prismaFor()).updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false });
    expect(g.posts).toHaveLength(0);
    vi.restoreAllMocks();

    fakeGraph({ campaign: { effective_status: 'PAUSED', daily_budget: '10000', start_time: GELECEK_HAFTA } });
    await expect(new MetaAdsClientService(prismaFor()).getLiveBudget('s1', '999')).resolves.toMatchObject({
      ok: true, live: { status: 'PAUSED', platformStatus: 'PAUSED' },
    });
  });

  it('CBO: bitmis kampanyada (stop_time gecmis) baslangic sorulmaz — COMPLETED kalir', async () => {
    const g = fakeGraph({ campaign: { effective_status: 'ACTIVE', daily_budget: '10000', stop_time: GECEN_HAFTA, start_time: 'okunamaz' } });
    const svc = new MetaAdsClientService(prismaFor());
    await expect(svc.getLiveBudget('s1', '999')).resolves.toMatchObject({ ok: true, live: { status: 'OTHER', platformStatus: 'ACTIVE/COMPLETED' } });
    await expect(svc.updateDailyBudget('s1', '999', 120, 100)).resolves.toEqual({ ok: false, error: expect.stringMatching(/yayın takvimi bitmiş/) });
    expect(g.posts).toHaveLength(0);
  });
});

describe('dagitim ve alan okuma', () => {
  it('oranlar korunur, toplam tam olarak hedef (en buyuk kalan)', () => {
    expect(distributeMetaBudget([8000, 2000], 12000)).toEqual([9600, 2400]);
    expect(distributeMetaBudget([1, 1, 1], 10)).toEqual([4, 3, 3]);
    const big = distributeMetaBudget([3_000_000_000, 7_000_000_001], 12_345_678_901)!;
    expect(big.reduce((a, b) => a + b, 0)).toBe(12_345_678_901);
    expect(distributeMetaBudget([5000, 5000], 8000)).toEqual([4000, 4000]);
  });

  it('bir pay sifira duserse ya da girdi gecersizse dagitim yok', () => {
    expect(distributeMetaBudget([1, 1, 1], 2)).toBeNull();
    expect(distributeMetaBudget([], 100)).toBeNull();
    expect(distributeMetaBudget([100, 0], 100)).toBeNull();
    expect(distributeMetaBudget([100], 10.5)).toBeNull();
  });

  it('butce alani: yok / bos / "0" → null', () => {
    expect(parseMetaMinor('5000')).toBe(5000);
    expect(parseMetaMinor(5000)).toBe(5000);
    expect(parseMetaMinor('0')).toBeNull();
    expect(parseMetaMinor('')).toBeNull();
    expect(parseMetaMinor(undefined)).toBeNull();
    expect(parseMetaMinor('abc')).toBeNull();
  });
});

/**
 * A/B icin sahte Graph: insights (level=ad), /ads ve /adsets kenarlari; her
 * biri `pages` ile birden cok sayfa olabilir. POST reklam durumu yazimlari.
 */
function fakeAbGraph(opts: {
  insights: Array<Array<Record<string, unknown>>> | number;
  ads: Array<Array<Record<string, unknown>>> | number;
  adsets: Array<Array<Record<string, unknown>>> | number;
  nextHost?: string;
}) {
  const gets: string[] = [];
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (init?.method === 'POST') return json(200, { success: true });
    gets.push(url);
    const kind = url.includes('/insights?') ? 'insights' : url.includes('/ads?') ? 'ads' : url.includes('/adsets?') ? 'adsets' : null;
    if (!kind) return json(404, {});
    const src = opts[kind];
    if (typeof src === 'number') return json(src, { error: { message: 'x', code: 100 } });
    const i = Number(url.match(/after=p(\d+)/)?.[1] ?? 0);
    const next = i + 1 < src.length ? `${opts.nextHost ?? GRAPH}/999/${kind}?after=p${i + 1}&access_token=raw-token` : undefined;
    return json(200, { data: src[i] ?? [], ...(next ? { paging: { next } } : {}) });
  });
  return { fetchMock, gets };
}

const insightRow = (ad: string, set: string, over: Record<string, unknown> = {}) => ({
  ad_id: ad, adset_id: set, adset_name: `Set ${set}`, impressions: '3000', inline_link_clicks: '90', ...over,
});
const adRow = (id: string, set: string, status = 'ACTIVE') => ({ id, adset_id: set, effective_status: status });
const setRow = (id: string, over: Record<string, unknown> = {}) => ({ id, effective_status: 'ACTIVE', optimization_goal: 'LINK_CLICKS', ...over });

describe('Meta A/B varyantlari (S10: reklam seti ve yayin uygunlugu)', () => {
  it('uc okuma: insights (adset_id, baglanti tiklamasi), etkin reklamlar ve etkin reklam setleri', async () => {
    const g = fakeAbGraph({ insights: [[]], ads: [[]], adsets: [[]] });
    await expect(new MetaAdsClientService(prismaFor()).getAdVariantMetrics('s1', '999')).resolves.toEqual([]);
    const [ins, ads, sets] = g.gets.map((u) => decodeURIComponent(u));
    expect(ins).toContain(`${GRAPH}/999/insights?level=ad&fields=ad_id,adset_id,adset_name,impressions,inline_link_clicks,actions,action_values`);
    expect(ins).toContain('date_preset=last_7d');
    expect(JSON.parse(ins.match(/filtering=(\[[^&]+\])/)![1])).toContainEqual({ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] });
    expect(ads).toContain(`${GRAPH}/999/ads?fields=id,adset_id,effective_status&effective_status=["ACTIVE"]`);
    expect(sets).toContain(`${GRAPH}/999/adsets?fields=id,effective_status,optimization_goal,end_time,start_time&effective_status=["ACTIVE"]`);
  });

  it('uygun: reklam ve reklam seti ACTIVE, takvim suruyor, hedef LINK_CLICKS; reklam seti grubu belirler', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    try {
      fakeAbGraph({
        insights: [[
          insightRow('1', '10', { actions: [{ action_type: 'link_click', value: '90' }, { action_type: 'purchase', value: '2' }, { action_type: 'omni_purchase', value: '3' }, { action_type: 'lead', value: '1' }], action_values: [{ action_type: 'omni_purchase', value: '450.5' }] }),
          insightRow('2', '10'),
          insightRow('3', '20'), // reklam seti duraklatilmis (listede yok)
          insightRow('4', '30'), // bitis tarihi gecmis
          insightRow('5', '40'), // baslangici gelecekte
          insightRow('6', '50'), // hedef mesaj (CONVERSATIONS)
          insightRow('7', '10'), // reklam etkin listede yok (incelemede / reddedilmis)
          insightRow('8', '60'), // bitis tarihi okunamadi
        ]],
        ads: [[adRow('1', '10'), adRow('2', '10'), adRow('3', '20'), adRow('4', '30'), adRow('5', '40'), adRow('6', '50'), adRow('8', '60')]],
        adsets: [[
          setRow('10', { end_time: '2026-12-01T00:00:00+0300', start_time: '2026-09-01T00:00:00+0300' }),
          setRow('30', { end_time: '2026-10-01T23:59:59+0300' }),
          setRow('40', { start_time: '2026-11-01T00:00:00+0300' }),
          setRow('50', { optimization_goal: 'CONVERSATIONS' }),
          setRow('60', { end_time: 'yarin' }),
        ]],
      });
      const rows = (await new MetaAdsClientService(prismaFor()).getAdVariantMetrics('s1', '999'))!;
      expect(rows.filter((r) => r.eligible).map((r) => r.adId)).toEqual(['1', '2']);
      expect(rows[0]).toEqual({
        adId: '1', target: '1', groupId: '10', groupName: 'Set 10', eligible: true,
        // Satin alma ailesinde en buyuk (omni 3) + potansiyel musteri 1; deger satin alma ailesinden
        impressions: 3000, clicks: 90, conversions: 4, conversionValue: 450.5,
      });
      expect(rows[1]).toMatchObject({ conversions: 0, conversionValue: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reklamin satirdaki reklam seti /ads listesindekiyle farkliysa uygun degil', async () => {
    fakeAbGraph({ insights: [[insightRow('1', '10')]], ads: [[adRow('1', '20')]], adsets: [[setRow('10'), setRow('20')]] });
    const [r] = (await new MetaAdsClientService(prismaFor()).getAdVariantMetrics('s1', '999'))!;
    expect(r.eligible).toBe(false);
  });

  it('tum sayfalar okunur; bir sayfa okunamazsa ya da sonraki sayfa Graph disina giderse null', async () => {
    let g = fakeAbGraph({ insights: [[insightRow('1', '10')], [insightRow('2', '10')]], ads: [[adRow('1', '10')], [adRow('2', '10')]], adsets: [[setRow('10')]] });
    const rows = (await new MetaAdsClientService(prismaFor()).getAdVariantMetrics('s1', '999'))!;
    expect(rows.map((r) => [r.adId, r.eligible])).toEqual([['1', true], ['2', true]]);
    expect(g.gets).toHaveLength(5);
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    for (const bad of [{ ads: 500 as const }, { adsets: 400 as const }, { insights: 500 as const }]) {
      fakeAbGraph({ insights: [[insightRow('1', '10')]], ads: [[adRow('1', '10')]], adsets: [[setRow('10')]], ...bad });
      await expect(new MetaAdsClientService(prismaFor()).getAdVariantMetrics('s1', '999')).resolves.toBeNull();
      vi.restoreAllMocks();
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    }
    g = fakeAbGraph({ insights: [[insightRow('1', '10')], [insightRow('2', '10')]], ads: [[adRow('1', '10')]], adsets: [[setRow('10')]], nextHost: 'https://evil.example' });
    await expect(new MetaAdsClientService(prismaFor()).getAdVariantMetrics('s1', '999')).resolves.toBeNull();
  });

  it('kimligi eksik ya da tekrarlanan satir: yanit guvenilmez (null); eksik metrik null', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    for (const insights of [
      [insightRow('1', '10'), insightRow('1', '10')],
      [insightRow('1', '10'), { ...insightRow('2', '10'), adset_id: undefined }],
    ]) {
      fakeAbGraph({ insights: [insights], ads: [[adRow('1', '10'), adRow('2', '10')]], adsets: [[setRow('10')]] });
      await expect(new MetaAdsClientService(prismaFor()).getAdVariantMetrics('s1', '999')).resolves.toBeNull();
      vi.restoreAllMocks();
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    }
    fakeAbGraph({ insights: [[{ ...insightRow('1', '10'), inline_link_clicks: undefined, actions: 'bozuk' }]], ads: [[adRow('1', '10')]], adsets: [[setRow('10')]] });
    const [r] = (await new MetaAdsClientService(prismaFor()).getAdVariantMetrics('s1', '999'))!;
    expect(r).toMatchObject({ clicks: null, conversions: null });
    await expect(new MetaAdsClientService(prismaFor()).getAdVariantMetrics('s1', '999/../act_1')).resolves.toBeNull();
  });

  it('reklam durumu: kesin red uncertain degil; 5xx ve ag hatasi uncertain; gecersiz kimlik gonderilmez', async () => {
    const posts: string[] = [];
    let mode: 'ok' | '400' | '500' | 'throw' = 'ok';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      posts.push(String(input));
      if (mode === 'throw') throw new TypeError('fetch failed');
      return mode === 'ok' ? json(200, { success: true }) : json(Number(mode), { error: { message: 'x', code: 100 } });
    });
    const svc = new MetaAdsClientService(prismaFor());
    await expect(svc.setAdStatus('s1', '9002', 'PAUSED')).resolves.toEqual({ ok: true });
    mode = '400';
    await expect(svc.setAdStatus('s1', '9002', 'PAUSED')).resolves.toEqual({ ok: false });
    mode = '500';
    await expect(svc.setAdStatus('s1', '9002', 'PAUSED')).resolves.toEqual({ ok: false, uncertain: true });
    mode = 'throw';
    await expect(svc.setAdStatus('s1', '9002', 'PAUSED')).resolves.toEqual({ ok: false, uncertain: true });
    const n = posts.length;
    await expect(svc.setAdStatus('s1', '9002?fields=x', 'PAUSED')).resolves.toEqual({ ok: false });
    expect(posts).toHaveLength(n);
  });
});

describe('Meta donusum aileleri (A/B emniyeti)', () => {
  it('aile icinde en buyuk alinir, aileler toplanir; liste yoksa 0, bozuksa null', () => {
    expect(metaConversions([{ action_type: 'purchase', value: '2' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '5' }, { action_type: 'onsite_conversion.lead_grouped', value: '1' }, { action_type: 'lead', value: '3' }])).toBe(8);
    expect(metaConversions(undefined)).toBe(0);
    expect(metaConversions([{ action_type: 'link_click', value: '40' }])).toBe(0);
    expect(metaConversions({})).toBeNull();
    expect(metaConversions([{ action_type: 'lead', value: 'x' }])).toBeNull();
    expect(metaPurchaseValue([{ action_type: 'purchase', value: '10.5' }, { action_type: 'omni_purchase', value: '12' }])).toBe(12);
    expect(metaCount('120')).toBe(120);
    expect(metaCount(undefined)).toBeNull();
    expect(metaCount('-1')).toBeNull();
  });
});
