import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Controller, Get, Module, Post, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';

/**
 * G5 — betik/beacon bot sayimi (crawler-tracking.middleware.ts).
 *
 * NEDEN VAR: ara katman her API isteginde, guard'lardan once calisiyor ve
 * bot UA'si tasiyan herkesin ?site=&status=&bytes= ile AiCrawlerHit'e yazmasina
 * izin veriyordu: 20 anonim `GET /api/tracker/beacon?site=<id>&status=500`
 * istegi (UA: GPTBot) musteriye ve Slack/Discord webhook'una "GPTBot sitene
 * ulasamiyor (%100 hata)" bildirimi urettiriyordu. Site kimligi herkese acik
 * (betik gomme kodu). ?site=<id>|<tarih>|<metin> ile tarih geriye alinip bot
 * adi olarak serbest metin (bildirim basligi) yazilabiliyordu; rastgele kimlik
 * sahipsiz satir aciyordu; gun yerel saatle bir onceki gune yaziliyordu.
 */

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const SITE = 'cmoj14abcdefghijklmnopqrs'; // 25 karakter, Prisma cuid() bicimi
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';
const CLAUDEBOT = 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';

function makePrisma(existing: string[] = [SITE]) {
  return {
    site: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => existing.includes(id)).map((id) => ({ id })),
      ),
    },
    aiCrawlerHit: { upsert: vi.fn<(args: unknown) => Promise<object>>(async () => ({})) },
  };
}

/** Her test temiz surec durumu (sayac sinif seviyesinde tekil) */
async function freshMiddleware() {
  vi.resetModules();
  const mod = await import('./crawler-tracking.middleware.js');
  const { PrismaService } = await import('../prisma/prisma.service.js');
  return { ...mod, PrismaService };
}

type MwClass = Awaited<ReturnType<typeof freshMiddleware>>['CrawlerTrackingMiddleware'];
const flushOf = (cls: MwClass) =>
  (cls as unknown as { counter: { flush(): Promise<{ written: number; dropped: number }> } }).counter.flush();

function req(query: Record<string, unknown>, ua = GPTBOT, ip = '203.0.113.7') {
  return { headers: { 'user-agent': ua, 'cf-connecting-ip': ip }, query } as never;
}

function useMany(mw: { use(r: never, s: never, n: () => void): void }, n: number, query: Record<string, unknown>, ua = GPTBOT, ip?: (i: number) => string) {
  const next = vi.fn();
  for (let i = 0; i < n; i++) mw.use(req(query, ua, ip ? ip(i) : '203.0.113.7'), {} as never, next);
  expect(next).toHaveBeenCalledTimes(n); // sayim istegi asla durdurmaz
}

describe('CrawlerTrackingMiddleware — guvenilmeyen beacon girdisi', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sorgudaki status/bytes/url OKUNMAZ: yalniz istek sayisi yazilir, durum sayaclari ve adres listesine dokunulmaz', async () => {
    const { CrawlerTrackingMiddleware } = await freshMiddleware();
    const prisma = makePrisma();
    const mw = new CrawlerTrackingMiddleware(prisma as never);

    useMany(mw, 20, { site: SITE, status: '500', bytes: '9999999', url: 'https://evil.example/login' });
    await flushOf(CrawlerTrackingMiddleware);

    expect(prisma.aiCrawlerHit.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.aiCrawlerHit.upsert.mock.calls[0][0] as any;
    expect(arg.where.siteId_date_bot).toMatchObject({ siteId: SITE, bot: 'GPTBot' });
    expect(arg.update).toEqual({ hits: { increment: 20 } });
    expect(arg.create).toEqual({ siteId: SITE, date: arg.where.siteId_date_bot.date, bot: 'GPTBot', hits: 20, uniqueUrls: 0, topUrls: [] });
    // Eskiden: status5xx 20, bytesServed 199999980, topUrls [evil.example]
    expect(JSON.stringify(arg)).not.toMatch(/status[245]xx|bytesServed|evil\.example/);
  });

  it('var olmayan site kimligi yazilmaz (sahipsiz satir yok) ve sonraki istekler DB\'ye gitmeden dusurulur', async () => {
    const { CrawlerTrackingMiddleware } = await freshMiddleware();
    const prisma = makePrisma([]);
    const mw = new CrawlerTrackingMiddleware(prisma as never);
    const yok = 'czzzzzzzzzzzzzzzzzzzzzzzz';

    useMany(mw, 3, { site: yok });
    await flushOf(CrawlerTrackingMiddleware);
    expect(prisma.site.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.aiCrawlerHit.upsert).not.toHaveBeenCalled();

    // Negatif onbellek: ayni kimlik tampona bile girmez
    useMany(mw, 3, { site: yok });
    await flushOf(CrawlerTrackingMiddleware);
    expect(prisma.site.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.aiCrawlerHit.upsert).not.toHaveBeenCalled();
  });

  it("'|' ile tarih/bot adi enjeksiyonu, buyuk harfli varyant, dizi ve nesne site degeri reddedilir", async () => {
    const { CrawlerTrackingMiddleware } = await freshMiddleware();
    const prisma = makePrisma([SITE, SITE.toUpperCase()]);
    const mw = new CrawlerTrackingMiddleware(prisma as never);

    for (const site of [
      `${SITE}|2026-09-01T00:00:00.000Z|Hesabiniz askiya alindi - hemen giris yapin: evil.example/ranksup`,
      SITE.toUpperCase(),
      [SITE, SITE],
      { x: SITE },
      `${SITE}x`,
      '',
    ]) {
      useMany(mw, 1, { site });
    }
    await flushOf(CrawlerTrackingMiddleware);
    expect(prisma.site.findMany).not.toHaveBeenCalled();
    expect(prisma.aiCrawlerHit.upsert).not.toHaveBeenCalled();
  });

  it('bot olmayan kullanici ajani sayilmaz', async () => {
    const { CrawlerTrackingMiddleware } = await freshMiddleware();
    const prisma = makePrisma();
    const mw = new CrawlerTrackingMiddleware(prisma as never);
    useMany(mw, 5, { site: SITE }, 'Mozilla/5.0 (Macintosh) Safari/605.1.15');
    await flushOf(CrawlerTrackingMiddleware);
    expect(prisma.aiCrawlerHit.upsert).not.toHaveBeenCalled();
  });

  it("gun UTC'dir: Istanbul saatinde ogleden sonraki istek o gune yazilir (eskiden bir onceki gune)", async () => {
    const eskiTz = process.env.TZ;
    process.env.TZ = 'Europe/Istanbul';
    try {
      // On kosul: surec gercekten UTC+3'te (yerel gece yarisi 21:00Z)
      expect(new Date('2026-10-18T10:00:00.000Z').getTimezoneOffset()).toBe(-180);
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
      const { CrawlerTrackingMiddleware } = await freshMiddleware();
      const prisma = makePrisma();
      const mw = new CrawlerTrackingMiddleware(prisma as never);
      useMany(mw, 1, { site: SITE });
      await flushOf(CrawlerTrackingMiddleware);
      const date = (prisma.aiCrawlerHit.upsert.mock.calls[0][0] as any).where.siteId_date_bot.date as Date;
      expect(date.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    } finally {
      if (eskiTz === undefined) delete process.env.TZ; else process.env.TZ = eskiTz;
    }
  });

  it('ayni IP + site saatte en fazla ipSitePerHour istek; baska IP ayrica sayilir', async () => {
    const { CrawlerTrackingMiddleware, BEACON_LIMITS } = await freshMiddleware();
    const prisma = makePrisma();
    const mw = new CrawlerTrackingMiddleware(prisma as never);
    useMany(mw, BEACON_LIMITS.ipSitePerHour + 25, { site: SITE }, GPTBOT, () => '198.51.100.1');
    useMany(mw, 2, { site: SITE }, GPTBOT, () => '198.51.100.2');
    await flushOf(CrawlerTrackingMiddleware);
    expect((prisma.aiCrawlerHit.upsert.mock.calls[0][0] as any).update).toEqual({
      hits: { increment: BEACON_LIMITS.ipSitePerHour + 2 },
    });
  });

  it('site basina UTC gunluk tavan: cok sayida IP ile bile sitePerDay asilmaz', async () => {
    const { CrawlerTrackingMiddleware, BEACON_LIMITS } = await freshMiddleware();
    const prisma = makePrisma();
    const mw = new CrawlerTrackingMiddleware(prisma as never);
    // Her istek ayri IP'den: IP tavanlari devreye girmez, yalniz site tavani olculur
    const ip = (i: number) => `203.0.${Math.floor(i / 250)}.${(i % 250) + 1}`;
    useMany(mw, BEACON_LIMITS.sitePerDay - 100, { site: SITE }, GPTBOT, ip);
    await flushOf(CrawlerTrackingMiddleware);
    useMany(mw, 300, { site: SITE }, CLAUDEBOT, (i) => ip(i + 5000));
    await flushOf(CrawlerTrackingMiddleware);
    const yazilan = prisma.aiCrawlerHit.upsert.mock.calls.map((c) => (c[0] as any).update.hits.increment as number);
    expect(yazilan.reduce((a, b) => a + b, 0)).toBe(BEACON_LIMITS.sitePerDay);
  });
});

/**
 * R15 — bellek siniri hicbir istemciyi kilitlemez.
 *
 * NEDEN VAR: IP+site anahtari IP tavanina bakilmadan aciliyordu ve dolu tablo
 * her yeni anahtari reddediyordu. GET /api/tracker/beacon herkese acik ve
 * throttle'siz: tek IP saatte 50.000 rastgele (cuid bicimli) kimlikle tabloyu
 * doldurup saatin kalaninda TUM musterilerin bot isabetlerini 'ip_limited'
 * diye, iz birakmadan dusurtebiliyordu (AI Crawler Trafigi paneli bos kaliyordu).
 */
describe('CrawlerBeaconCounter — rastgele kimlik yagmuru baska musterileri susturamaz (R15)', () => {
  const GERCEK = 'cmp6036790001artdfumwec57';
  const rastgele = (i: number) => ('czz' + i.toString(36).padStart(10, '0') + 'abcdefghijkl').slice(0, 25);

  function db(opts: { gate?: Promise<void> } = {}) {
    const upserts: any[] = [];
    const asked: string[][] = [];
    return {
      upserts,
      asked,
      site: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
          asked.push(where.id.in);
          if (opts.gate) await opts.gate;
          return where.id.in.filter((id) => id === GERCEK).map((id) => ({ id }));
        }),
      },
      aiCrawlerHit: { upsert: vi.fn(async (a: unknown) => { upserts.push(a); return {}; }) },
    };
  }

  it('tek IP 50.000 rastgele kimlik gonderse de baska IP\'nin gercek siteye isabeti ayni saatte yazilir', async () => {
    const { CrawlerBeaconCounter, BEACON_LIMITS } = await freshMiddleware();
    let t = Date.UTC(2026, 9, 18, 10, 0, 5);
    const d = db();
    const c = new CrawlerBeaconCounter(d as never, BEACON_LIMITS, () => t);

    const sonuc = new Map<string, number>();
    for (let i = 0; i < BEACON_LIMITS.maxKeys; i++) {
      const r = c.record({ ua: GPTBOT, site: rastgele(i), ip: '198.51.100.7' });
      sonuc.set(r, (sonuc.get(r) ?? 0) + 1);
    }
    // Saldirganin kendisi IP tavanina takilir
    expect(sonuc.get('ip_limited')).toBe(BEACON_LIMITS.maxKeys - BEACON_LIMITS.ipPerHour);

    t += 5 * 60_000;
    expect(c.record({ ua: GPTBOT, site: GERCEK, ip: '20.171.0.99' })).toBe('buffered'); // eskiden 'ip_limited'
    t += 50 * 60_000;
    expect(c.record({ ua: CLAUDEBOT, site: GERCEK, ip: '40.77.167.5' })).toBe('buffered');
    await c.flush();
    const yazilan = d.upserts.filter((u) => u.where.siteId_date_bot.siteId === GERCEK);
    expect(yazilan.map((u) => [u.where.siteId_date_bot.bot, u.update.hits.increment]).sort()).toEqual([['ClaudeBot', 1], ['GPTBot', 1]]);
  });

  it('tavana takilan IP baska IP+site anahtari ACAMAZ (yalniz ipPerHour kadar anahtar)', async () => {
    const { CrawlerBeaconCounter, BEACON_LIMITS } = await freshMiddleware();
    const limits = { ...BEACON_LIMITS, ipPerHour: 50, maxKeys: 10_000 };
    const c = new CrawlerBeaconCounter(db() as never, limits, () => Date.UTC(2026, 9, 18, 10, 0, 5));
    for (let i = 0; i < 500; i++) c.record({ ua: GPTBOT, site: rastgele(i), ip: '198.51.100.7' });
    expect((c as any).ipSiteCounter.size).toBe(50);
    expect((c as any).ipCounter.size).toBe(1);
  });

  it('IP degistiren yagmur (IPv6 / sahte CF-Connecting-IP) tablolari doldursa da bellek sinirli kalir ve gercek isabet yazilir', async () => {
    const { CrawlerBeaconCounter, BEACON_LIMITS } = await freshMiddleware();
    const limits = { ...BEACON_LIMITS, maxKeys: 200, maxPendingGroups: 100, flushAtGroups: 1_000_000 };
    let t = Date.UTC(2026, 9, 18, 10, 0, 5);
    const d = db();
    const c = new CrawlerBeaconCounter(d as never, limits, () => t);
    for (let i = 0; i < 5_000; i++) c.record({ ua: GPTBOT, site: rastgele(i), ip: `2001:db8::${i.toString(16)}` });
    expect((c as any).ipCounter.size).toBeLessThanOrEqual(200);
    expect((c as any).ipSiteCounter.size).toBeLessThanOrEqual(200);
    expect((c as any).pendingUnresolved.size).toBeLessThanOrEqual(100);

    t += 60_000;
    // Eskiden dolu IP+site tablosu her yeni anahtari reddediyordu: 'ip_limited'
    expect(c.record({ ua: GPTBOT, site: GERCEK, ip: '20.171.0.1' })).not.toBe('ip_limited');
    // Dogrulanmamis tampon yagmurla dolu olabilir: suren ve bekleyen bosaltmalar bitince yer acilir
    await c.flush();
    await c.flush();
    expect(c.record({ ua: GPTBOT, site: GERCEK, ip: '20.171.0.2' })).toBe('buffered');
    await c.flush();
    expect(d.upserts.some((u) => u.where.siteId_date_bot.siteId === GERCEK)).toBe(true);
  });

  it('var oldugu bilinen sitenin yeni grubu, dogrulanmamis kimlik tamponu doluyken bile tampona girer', async () => {
    const { CrawlerBeaconCounter, BEACON_LIMITS } = await freshMiddleware();
    const limits = { ...BEACON_LIMITS, maxPendingGroups: 50, flushAtGroups: 1_000_000 };
    const t = Date.UTC(2026, 9, 18, 10, 0, 5);
    let ac!: () => void;
    const gate = new Promise<void>((r) => { ac = r; });
    const d = db();
    const c = new CrawlerBeaconCounter(d as never, limits, () => t);
    // Site bir kez dogrulanir (bilinen site)
    c.record({ ua: GPTBOT, site: GERCEK, ip: '20.171.0.1' });
    await c.flush();
    expect(d.upserts).toHaveLength(1);

    // Yavas bir bosaltma surerken (DB beklerken) yagmur dogrulanmamis tamponu doldurur
    d.site.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
      await gate;
      return where.id.in.filter((id) => id === GERCEK).map((id) => ({ id }));
    });
    c.record({ ua: GPTBOT, site: rastgele(999_999), ip: '203.0.113.200' });
    const suren = c.flush();
    for (let i = 0; i < 200; i++) c.record({ ua: GPTBOT, site: rastgele(i), ip: `2001:db8::${i.toString(16)}` });
    expect(c.record({ ua: GPTBOT, site: rastgele(5_000), ip: '2001:db8::ffff' })).toBe('buffer_full');
    // Bilinen sitenin YENI grubu (baska bot) etkilenmez — eskiden 'buffer_full'
    expect(c.record({ ua: CLAUDEBOT, site: GERCEK, ip: '20.171.0.3' })).toBe('buffered');
    ac();
    await suren;
    await c.flush();
    expect(d.upserts.filter((u) => u.where.siteId_date_bot.siteId === GERCEK).map((u) => u.where.siteId_date_bot.bot)).toContain('ClaudeBot');
  });

  it('negatif kayit yagmuru bilinen siteyi onbellekten atamaz (gecerlilik suresince DB\'ye yeniden sorulmaz)', async () => {
    const { CrawlerBeaconCounter, BEACON_LIMITS } = await freshMiddleware();
    const limits = { ...BEACON_LIMITS, maxKeys: 50, maxPendingGroups: 1_000, flushAtGroups: 1_000_000 };
    let t = Date.UTC(2026, 9, 18, 10, 0, 5);
    const d = db();
    const c = new CrawlerBeaconCounter(d as never, limits, () => t);
    c.record({ ua: GPTBOT, site: GERCEK, ip: '20.171.0.1' });
    await c.flush();
    for (let tur = 0; tur < 4; tur++) {
      for (let i = 0; i < 50; i++) c.record({ ua: GPTBOT, site: rastgele(tur * 50 + i), ip: `2001:db8::${(tur * 50 + i).toString(16)}` });
      await c.flush();
    }
    t += 60_000;
    expect(c.record({ ua: CLAUDEBOT, site: GERCEK, ip: '20.171.0.9' })).toBe('buffered');
    await c.flush();
    // Gercek site yalniz ilk bosaltmada soruldu (eskiden negatif kayitlar onu tek onbellekten atiyordu)
    expect(d.asked.filter((ids) => ids.includes(GERCEK))).toHaveLength(1);
    expect(d.upserts.filter((u) => u.where.siteId_date_bot.siteId === GERCEK)).toHaveLength(2);
  });
});

describe('CrawlerTrackingMiddleware — yalniz betik/beacon uclarinda calisir (HTTP)', () => {
  @Controller()
  class SahteUclar {
    @Get('tracker.js') betik() { return 'js'; }
    @Get('tracker/beacon') beacon() { return 'gif'; }
    @Post('tracker/beacon') beaconPost() { return 'x'; }
    @Get('sites/:siteId/audit/sitemap-ai.xml') sitemap() { return 'xml'; }
    @Get('baska') baska() { return 'ok'; }
  }

  let kapat: (() => Promise<void>) | null = null;
  beforeEach(() => { kapat = null; });
  afterEach(async () => { await kapat?.(); });

  it('GET tracker.js ve GET tracker/beacon sayilir; diger her yol (POST beacon dahil) sayilmaz', async () => {
    const { CrawlerTrackingMiddleware, CRAWLER_TRACKING_ROUTES, PrismaService } = await freshMiddleware();
    // esbuild dekorator metadatasi uretmez (bkz. ingest-e2e.spec.ts shimParamTypes)
    Reflect.defineMetadata('design:paramtypes', [PrismaService], CrawlerTrackingMiddleware);
    const prisma = makePrisma();

    @Module({ controllers: [SahteUclar], providers: [{ provide: PrismaService, useValue: prisma }] })
    class TestModulu implements NestModule {
      configure(consumer: MiddlewareConsumer) {
        consumer.apply(CrawlerTrackingMiddleware).forRoutes(...CRAWLER_TRACKING_ROUTES);
      }
    }

    const moduleRef = await Test.createTestingModule({ imports: [TestModulu] }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api'); // main.ts ile ayni onek
    await app.init();
    kapat = () => app.close();

    const http = request(app.getHttpServer());
    const q = `site=${SITE}&status=500`;
    await http.get(`/api/tracker.js?${q}`).set('User-Agent', GPTBOT).expect(200);
    await http.get(`/api/tracker/beacon?${q}`).set('User-Agent', GPTBOT).expect(200);
    await http.post(`/api/tracker/beacon?${q}`).set('User-Agent', GPTBOT).expect(201);
    await http.get(`/api/sites/${SITE}/audit/sitemap-ai.xml?${q}`).set('User-Agent', GPTBOT).expect(200);
    await http.get(`/api/baska?${q}`).set('User-Agent', GPTBOT).expect(200);

    await flushOf(CrawlerTrackingMiddleware);
    expect(prisma.aiCrawlerHit.upsert).toHaveBeenCalledTimes(1);
    expect((prisma.aiCrawlerHit.upsert.mock.calls[0][0] as any).update).toEqual({ hits: { increment: 2 } });
  });
});

describe('AppModule — ara katman kaydi', () => {
  it("forRoutes('*') yok; yalniz CRAWLER_TRACKING_ROUTES", async () => {
    vi.resetModules();
    const { AppModule } = await import('../app.module.js');
    const { CRAWLER_TRACKING_ROUTES, CrawlerTrackingMiddleware } = await import('./crawler-tracking.middleware.js');
    const kayitlar: Array<{ middleware: unknown[]; routes: unknown[] }> = [];
    const consumer = {
      apply: (...middleware: unknown[]) => ({
        exclude() { return this; },
        forRoutes: (...routes: unknown[]) => {
          kayitlar.push({ middleware, routes });
          return consumer;
        },
      }),
    };
    new AppModule().configure(consumer as never);

    const izleme = kayitlar.filter((k) => k.middleware.includes(CrawlerTrackingMiddleware));
    expect(izleme).toHaveLength(1);
    expect(izleme[0].routes).toEqual(CRAWLER_TRACKING_ROUTES);
    expect(CRAWLER_TRACKING_ROUTES.map((r) => `${r.method}:${r.path}`)).toEqual(['0:tracker.js', '0:tracker/beacon']); // RequestMethod.GET = 0
    for (const k of kayitlar) expect(k.routes).not.toContain('*');
  }, 60_000);
});
