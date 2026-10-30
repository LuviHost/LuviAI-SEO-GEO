import { describe, expect, it, vi } from 'vitest';

/**
 * G5 — bot hata alarmi yalniz GUVENILIR durum sayaclarindan beslenir.
 *
 * NEDEN VAR: alarm AiCrawlerHit satirlarinin tamamini okuyordu; o tabloya
 * herkese acik betik/beacon yolu da yaziyordu (?status=500 dahil). Artik beacon
 * yalniz `hits` arttiriyor; alarm da orani durum kodu bilinen isteklerden
 * kuruyor. Payda `hits` olsaydi dogrulanmamis istekler orani sulandirip
 * gercek bir engeli gizlerdi. Eski ara katmanin '|' acigiyla yazilmis serbest
 * metinli bot adi da bildirim basligina gitmemeli.
 *
 * R16: guvenilir kaynaklar 3xx'i (304 Not Modified dahil) hicbir kovaya
 * yazmiyordu; payda 2xx+4xx+5xx olunca saglikli, onbellekli sitede (Bingbot
 * 80×304 + 12×200 + 8×404, gercek hata %8) "%40 hata — sitene ulaşamıyor"
 * alarmi gidiyordu. Kok duzeltme yazicilarda: 304 basarili kovaya yazilir
 * (crawler-analytics isSuccessfulCrawlStatus); alarm yeni satirdaki 304'u ham
 * istek tablosundan ikinci kez saymamali (kovasiz3xx). R22: metin toplam
 * hatayi cogunluk sinifinin etiketiyle yaziyordu (10×4xx + 12×5xx → "22
 * tanesinde 5xx").
 */

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../notifications/notifications.service.js', () => ({ NotificationsService: class {} }));
vi.mock('./webhook-notifier.service.js', () => ({ WebhookNotifierService: class {} }));

const { CrawlerErrorAlarmService, trustedStatusRow, hataDokumu, kovasiz3xx } = await import('./crawler-error-alarm.service.js');
const { CrawlerAnalyticsService } = await import('./crawler-analytics.service.js');
const { LiveCrawlerService } = await import('./live-crawler.service.js');
const { computeIngestSignature } = await import('./ingest-auth.js');

const SITE = 'cmp6036790001artdfumwec57';
const gun = new Date('2026-10-17T00:00:00.000Z');
const satir = (bot: string, hits: number, s2: number, s4: number, s5: number, over: Record<string, unknown> = {}) => ({
  bot, date: gun, hits, uniqueUrls: 0, status2xx: s2, status4xx: s4, status5xx: s5, ...over,
});

type HamOlay = { siteId: string; ts: Date; bot: string; status: number };

/**
 * crawlerHitEvent: createMany + alarmin groupBy'i (siteId, ts araligi;
 * istege bagli durum araligi; by ['bot'] ya da ['bot', 'status'] — Prisma gibi).
 */
function olayDeposu(olaylar: HamOlay[] = []) {
  return {
    olaylar,
    count: vi.fn(async () => 0),
    createMany: vi.fn(async ({ data }: { data: HamOlay[] }) => { olaylar.push(...data); return { count: data.length }; }),
    groupBy: vi.fn(async ({ by, where }: any) => {
      const durumla = (by as string[]).includes('status');
      const say = new Map<string, { bot: string; status: number; n: number }>();
      for (const o of olaylar) {
        if (o.siteId !== where.siteId) continue;
        if (o.ts < where.ts.gte || o.ts >= where.ts.lt) continue;
        if (where.status && (o.status < where.status.gte || o.status >= where.status.lt)) continue;
        const k = durumla ? `${o.bot}|${o.status}` : o.bot;
        const cur = say.get(k) ?? { bot: o.bot, status: o.status, n: 0 };
        cur.n++;
        say.set(k, cur);
      }
      return [...say.values()].map((g) => ({ bot: g.bot, ...(durumla ? { status: g.status } : {}), _count: { _all: g.n } }));
    }),
  };
}

function kur(rows: Array<Record<string, unknown>>, olaylar: HamOlay[] = []) {
  const crawlerHitEvent = olayDeposu(olaylar);
  const prisma = {
    site: { findMany: vi.fn(async () => [{ id: SITE, userId: 'u1', name: 'Ornek Site' }]) },
    aiCrawlerHit: { findMany: vi.fn(async () => rows) },
    crawlerHitEvent,
    kvStore: { create: vi.fn(async () => ({})) },
  };
  const notifications = { create: vi.fn<(n: { title: string; body: string }) => Promise<object>>(async () => ({})) };
  const webhook = { notify: vi.fn<(h: { message: string }) => Promise<object>>(async () => ({})) };
  const svc = new CrawlerErrorAlarmService(prisma as never, notifications as never, webhook as never);
  return { svc, prisma, notifications, webhook };
}

/** AiCrawlerHit deposu: create ve {increment}/duz deger update'leri (iki guvenilir yazicinin upsert'leri) */
function hitDeposu() {
  const rows = new Map<string, Record<string, any>>();
  const key = (w: any) => `${w.siteId_date_bot.siteId}|${w.siteId_date_bot.date.toISOString()}|${w.siteId_date_bot.bot}`;
  return {
    rows,
    // Log yuklemesi mevcut satiri okuyup eksik kadar artirir (mergeLogIntoDailyHit)
    findUnique: vi.fn(async ({ where }: any) => rows.get(key(where)) ?? null),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const k = key(where);
      const cur = rows.get(k);
      if (!cur) { rows.set(k, { ...create }); return create; }
      for (const [f, v] of Object.entries(update)) {
        cur[f] = v && typeof v === 'object' && 'increment' in (v as any) ? (cur[f] ?? 0) + (v as any).increment : v;
      }
      return cur;
    }),
  };
}

const BING = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
const GOOG = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const GPT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';

/** Apache birlesik log satirlari */
function logSatirlari(parcalar: Array<[ua: string, status: number, n: number]>): string {
  const gunStr = '17/Oct/2026:10:00:00 +0000';
  const out: string[] = [];
  for (const [ua, status, n] of parcalar) {
    for (let i = 0; i < n; i++) out.push(`40.77.167.1 - - [${gunStr}] "GET /s${status}-${i} HTTP/1.1" ${status} 100 "-" "${ua}"`);
  }
  return out.join('\n');
}

describe('CrawlerErrorAlarmService — yalniz guvenilir kaynak', () => {
  it('durumsuz (beacon) istekler hata oranini sulandirmaz: 20/20 5xx alarm verir', async () => {
    // GPTBot: 500 dogrulanmamis beacon istegi + imzali ingest'ten 20 istek, hepsi 5xx (ham 3xx yok)
    const t = kur([satir('GPTBot', 520, 0, 0, 20), satir('ClaudeBot', 30, 30, 0, 0)]);
    const r = await t.svc.scanAndAlert();
    expect(r.alerts).toBe(1);
    const n = t.notifications.create.mock.calls[0][0];
    expect(n.title).toBe('⚠️ GPTBot sitene ulaşamıyor (%100 hata)');
    expect(n.body).toContain('son 3 günde (bugün dahil) GPTBot, durum kodu ölçülen 20 isteğin 20 tanesinde 5xx aldı');
    expect(n.body).toContain('ClaudeBot ise başarılı yanıt (2xx ya da 304) alıyor');
    expect(n.body).not.toContain('48 saat');
    expect(t.webhook.notify).toHaveBeenCalledTimes(1);
  });

  it('yalniz beacon sayimi (durum yok) alarm uretmez ve saglikli bot sayilmaz', async () => {
    const t = kur([satir('GPTBot', 60, 0, 0, 0), satir('ClaudeBot', 40, 0, 0, 0), satir('Bingbot', 25, 0, 25, 0)]);
    const r = await t.svc.scanAndAlert();
    // Bingbot 25/25 4xx ama 2xx alan baska bot yok (beacon 'saglikli' kaniti degil) → site komple
    // erisilemez olabilir, bot-ozel engel denemez
    expect(r.alerts).toBe(0);
    expect(t.notifications.create).not.toHaveBeenCalled();
  });

  it('UA belirteci bicimi disindaki bot adi (eski acikla yazilmis serbest metin) bildirime gitmez', async () => {
    const t = kur([
      satir('Hesabiniz askiya alindi - hemen giris yapin: evil.example/ranksup', 20, 0, 0, 20),
      satir('ClaudeBot', 30, 30, 0, 0),
    ]);
    const r = await t.svc.scanAndAlert();
    expect(r.alerts).toBe(0);
    expect(t.webhook.notify).not.toHaveBeenCalled();
  });

  it('hic 4xx/5xx yoksa ham istek tablosu sorgulanmaz', async () => {
    const t = kur([satir('GPTBot', 500, 20, 0, 0), satir('ClaudeBot', 30, 30, 0, 0)]);
    await expect(t.svc.scanAndAlert()).resolves.toEqual({ sites: 1, alerts: 0 });
    expect(t.prisma.crawlerHitEvent.groupBy).not.toHaveBeenCalled();
  });

  it('trustedStatusRow: 3xx log satirinda hits farkindan, digerinde imzali ham isteklerden (aciklanmamis hits ile sinirli)', () => {
    const tarih = { bot: 'GPTBot', date: gun };
    // Eski cagiran bicimi (hits yok): payda 2xx+4xx+5xx
    expect(trustedStatusRow({ ...tarih, status2xx: 7, status4xx: 2, status5xx: 1 })).toEqual({
      bot: 'GPTBot', date: '2026-10-17', hits: 10, status2xx: 7, status4xx: 2, status5xx: 1,
    });
    // Log yuklemesi (uniqueUrls > 0): hits logdaki tum istekler → 304'ler payda
    expect(trustedStatusRow({ ...tarih, hits: 100, uniqueUrls: 60, status2xx: 12, status4xx: 8, status5xx: 0 }).hits).toBe(100);
    // Log disi satir: beacon da hits'e yazar; yalniz imzali ham 3xx sayilir
    expect(trustedStatusRow({ ...tarih, hits: 600, uniqueUrls: 0, status2xx: 24, status4xx: 16, status5xx: 0 }, 60).hits).toBe(100);
    expect(trustedStatusRow({ ...tarih, hits: 600, uniqueUrls: 0, status2xx: 24, status4xx: 16, status5xx: 0 }).hits).toBe(40);
    // Ham sayi satirin aciklanmamis hits'ini asamaz (aggregate yazimi dusmus olabilir)
    expect(trustedStatusRow({ ...tarih, hits: 50, uniqueUrls: 0, status2xx: 24, status4xx: 16, status5xx: 0 }, 60).hits).toBe(50);
  });
});

describe('R16 — 304 Not Modified / 3xx "ulasildi" sayilir', () => {
  it('LOG YUKLEMESI: Bingbot 80×304 + 12×200 + 8×404 (gercek hata %8) alarm URETMEZ (eskiden "%40 hata")', async () => {
    const store = hitDeposu();
    const analytics = new CrawlerAnalyticsService({ aiCrawlerHit: store } as never);
    await analytics.ingestLog(SITE, logSatirlari([[BING, 304, 80], [BING, 200, 12], [BING, 404, 8], [GOOG, 200, 40]]));
    const rows = [...store.rows.values()];
    const bing = rows.find((r) => r.bot === 'Bingbot')!;
    // Kok duzeltme: 304 basarili kovada (eskiden hicbir kovada degildi: s2 12)
    expect({ hits: bing.hits, s2: bing.status2xx, s4: bing.status4xx }).toEqual({ hits: 100, s2: 92, s4: 8 });
    const t = kur(rows);
    await expect(t.svc.scanAndAlert()).resolves.toEqual({ sites: 1, alerts: 0 });
    expect(t.notifications.create).not.toHaveBeenCalled();
    expect(t.webhook.notify).not.toHaveBeenCalled();
  });

  it('IMZALI EDGE INGEST: Bingbot 60×304 + 24×200 + 16×404 (gercek %16) alarm URETMEZ', async () => {
    const secret = 'luvi_ing_' + 'a'.repeat(48);
    const store = hitDeposu();
    const olaylar: HamOlay[] = [];
    const events = olayDeposu(olaylar);
    const live = new LiveCrawlerService({
      site: { findUnique: async () => ({ id: SITE, userId: 'u1', name: 'Ornek Site', ingestSecret: secret, user: { plan: 'AGENCY', role: 'USER' } }) },
      crawlerHitEvent: events,
      aiCrawlerHit: store,
      kvStore: { create: async () => ({}) },
    } as never, { create: async () => ({}) } as never, { notify: async () => ({}) } as never);
    const gonder = async (ua: string, status: number, n: number) => {
      const ts = Date.now();
      const body = JSON.stringify({ site: SITE, source: 'worker', events: Array.from({ length: n }, (_, i) => ({ ua, path: `/x${status}-${i}`, status, ts })) });
      await live.ingest(SITE, JSON.parse(body).events, 'worker', { signature: computeIngestSignature(secret, String(ts), body), timestamp: String(ts), rawBody: body });
    };
    await gonder(BING, 304, 60);
    await gonder(BING, 200, 24);
    await gonder(BING, 404, 16);
    await gonder(GOOG, 200, 30);
    await new Promise((r) => setTimeout(r, 20)); // updateDailyAggregates beklenmeden calisir
    const rows = [...store.rows.values()];
    // Kok duzeltme: 304 basarili kovada (eskiden status2xx 24)
    expect(rows.find((r) => r.bot === 'Bingbot')).toMatchObject({ hits: 100, status2xx: 84, status4xx: 16 });

    const t = kur(rows.map((r) => ({ ...r, uniqueUrls: r.uniqueUrls ?? 0 })), olaylar);
    await expect(t.svc.scanAndAlert()).resolves.toEqual({ sites: 1, alerts: 0 });
    // Aciklanmamis hits kalmadi: ham istek tablosu hic sorulmaz
    expect(t.prisma.crawlerHitEvent.groupBy).not.toHaveBeenCalled();
  });

  it('gercek engel yine alarm verir: log yuklemesinde GPTBot 30×403 + 5×304, Googlebot 2xx', async () => {
    const store = hitDeposu();
    await new CrawlerAnalyticsService({ aiCrawlerHit: store } as never)
      .ingestLog(SITE, logSatirlari([[GPT, 403, 30], [GPT, 304, 5], [GOOG, 200, 50]]));
    const t = kur([...store.rows.values()]);
    await expect(t.svc.scanAndAlert()).resolves.toEqual({ sites: 1, alerts: 1 });
    const n = t.notifications.create.mock.calls[0][0];
    expect(n.title).toBe('⚠️ GPTBot sitene ulaşamıyor (%86 hata)');
    expect(n.body).toContain('durum kodu ölçülen 35 isteğin 30 tanesinde 4xx aldı');
  });
});

/** Gercek imzali LiveCrawlerService.ingest + ayni AiCrawlerHit / ham olay depolari + beacon yazimi */
function canliHat() {
  const secret = 'luvi_ing_' + 'b'.repeat(48);
  const store = hitDeposu();
  const olaylar: HamOlay[] = [];
  const live = new LiveCrawlerService({
    site: { findUnique: async () => ({ id: SITE, userId: 'u1', name: 'Ornek Site', ingestSecret: secret, user: { plan: 'AGENCY', role: 'USER' } }) },
    crawlerHitEvent: olayDeposu(olaylar),
    aiCrawlerHit: store,
    kvStore: { create: async () => ({}) },
  } as never, { create: async () => ({}) } as never, { notify: async () => ({}) } as never);
  const gonder = async (ua: string, status: number, n: number) => {
    const ts = Date.now();
    const body = JSON.stringify({ site: SITE, source: 'worker', events: Array.from({ length: n }, (_, i) => ({ ua, path: `/y${status}-${i}`, status, ts })) });
    await live.ingest(SITE, JSON.parse(body).events, 'worker', { signature: computeIngestSignature(secret, String(ts), body), timestamp: String(ts), rawBody: body });
  };
  /** crawler-tracking.middleware doFlush ile ayni upsert: ayni satira YALNIZ hits */
  const beacon = async (bot: string, n: number) => {
    const date = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    await store.upsert({
      where: { siteId_date_bot: { siteId: SITE, date, bot } },
      update: { hits: { increment: n } },
      create: { siteId: SITE, date, bot, hits: n, uniqueUrls: 0, topUrls: [] },
    });
  };
  /** updateDailyAggregates ingest'te beklenmeden calisir */
  const bekle = () => new Promise((r) => setTimeout(r, 20));
  const satirlar = (): Array<Record<string, any>> => [...store.rows.values()].map((r) => ({ ...r, uniqueUrls: r.uniqueUrls ?? 0 }));
  return { olaylar, gonder, beacon, bekle, satirlar };
}

/** Bugunun ham olaylari (alarmin gun penceresine duser) */
const hamOlaylar = (bot: string, status: number, n: number): HamOlay[] =>
  Array.from({ length: n }, () => ({ siteId: SITE, ts: new Date(), bot, status }));
const bugun = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

describe('R16 kok duzeltme — 304 basarili kovada; alarm onu iki kez saymaz', () => {
  it('YENI satir + beacon: GPTBot 25×304 + 25×403 (+100 beacon) gercek %50 hata → alarm verir (304 ham tablodan ikinci kez sayilsaydi %33 → alarmsiz)', async () => {
    const h = canliHat();
    await h.gonder(GPT, 304, 25);
    await h.gonder(GPT, 403, 25);
    await h.gonder(GOOG, 200, 40);
    await h.bekle();
    await h.beacon('GPTBot', 100);
    const rows = h.satirlar();
    expect(rows.find((r) => r.bot === 'GPTBot')).toMatchObject({ hits: 150, status2xx: 25, status4xx: 25 });

    const t = kur(rows, h.olaylar);
    await expect(t.svc.scanAndAlert()).resolves.toEqual({ sites: 1, alerts: 1 });
    const n = t.notifications.create.mock.calls[0][0];
    expect(n.title).toBe('⚠️ GPTBot sitene ulaşamıyor (%50 hata)');
    expect(n.body).toContain('durum kodu ölçülen 50 isteğin 25 tanesinde 4xx aldı');
  });

  it('YENI satir + beacon: 301 yonlendirmeleri "ulasildi" olarak paydada kalir (304 ile birlikte, tek kez)', async () => {
    const h = canliHat();
    await h.gonder(BING, 304, 30);
    await h.gonder(BING, 301, 10);
    await h.gonder(BING, 404, 20);
    await h.gonder(GOOG, 200, 40);
    await h.bekle();
    await h.beacon('Bingbot', 200);
    expect(h.satirlar().find((r) => r.bot === 'Bingbot')).toMatchObject({ hits: 260, status2xx: 30, status4xx: 20 });
    // Payda 30 + 10 + 20 = 60 → %33: alarm yok. 301'ler sayilmasaydi 20/50 = %40 → sahte alarm
    const t = kur(h.satirlar(), h.olaylar);
    await expect(t.svc.scanAndAlert()).resolves.toEqual({ sites: 1, alerts: 0 });
  });

  it('GECIS: kok duzeltmeden ONCE yazilmis satir (304 kovasiz) ham 304\'lerle yine "ulasildi" sayilir — sahte alarm yok', async () => {
    const olaylar = [...hamOlaylar('Bingbot', 200, 24), ...hamOlaylar('Bingbot', 304, 60), ...hamOlaylar('Bingbot', 404, 16), ...hamOlaylar('Googlebot', 200, 30)];
    const t = kur([
      // 500 beacon + 100 canli; eski yazici 304'u kovaya yazmamis
      satir('Bingbot', 600, 24, 16, 0, { date: bugun() }),
      satir('Googlebot', 30, 30, 0, 0, { date: bugun() }),
    ], olaylar);
    await expect(t.svc.scanAndAlert()).resolves.toEqual({ sites: 1, alerts: 0 });
  });

  it('AYNI GUN KARISIK satir (sabah eski yazici, aksam yeni): 304 iki kez sayilmaz — gercek %47 hata alarm verir', async () => {
    // Ham: 40×304 (20'si eski yazicidan kovasiz, 20'si yeni yazicidan kovada) + 35×403; +300 beacon
    const olaylar = [...hamOlaylar('GPTBot', 304, 40), ...hamOlaylar('GPTBot', 403, 35), ...hamOlaylar('Googlebot', 200, 30)];
    const t = kur([
      satir('GPTBot', 375, 20, 35, 0, { date: bugun() }),
      satir('Googlebot', 30, 30, 0, 0, { date: bugun() }),
    ], olaylar);
    await expect(t.svc.scanAndAlert()).resolves.toEqual({ sites: 1, alerts: 1 });
    const n = t.notifications.create.mock.calls[0][0];
    expect(n.title).toBe('⚠️ GPTBot sitene ulaşamıyor (%47 hata)');
    expect(n.body).toContain('durum kodu ölçülen 75 isteğin 35 tanesinde 4xx aldı');
  });

  it('kovasiz3xx: eski satirda tum 3xx, yenide yalniz 301/302/307/308, karisikta kovasiz kisim; 0\'in altina inmez', () => {
    const s = (s2: number, s4: number) => ({ bot: 'GPTBot', date: gun, hits: 999, uniqueUrls: 0, status2xx: s2, status4xx: s4, status5xx: 0 });
    // Ham: 24×200 + 50×304 + 10×301 + 16×404
    const ham = { r2xx: 24, r3xx: 60 };
    expect(kovasiz3xx(s(24, 16), ham)).toBe(60); // eski yazici: 304 kovasiz
    expect(kovasiz3xx(s(74, 16), ham)).toBe(10); // yeni yazici: 304 kovada, kalan 301'ler
    expect(kovasiz3xx(s(49, 16), ham)).toBe(35); // ayni gun karisik: 25×304 kovada
    // Kovasi yazilamamis 404'ler sonucu degistirmez (yalniz 2xx ve 3xx karsilastirilir)
    expect(kovasiz3xx(s(74, 0), ham)).toBe(10);
    // HEAD donemi ara katmani beacon'u 2xx kovasina da yaziyordu: sonuc 0'in altina inmez
    expect(kovasiz3xx(s(500, 16), ham)).toBe(0);
  });

  it('yalniz 304 alan bot da "site ayakta" kanitidir: GPTBot 30×403, Googlebot 40×304 → alarm (eskiden saglikli bot yok sayilip alarmsiz)', async () => {
    const store = hitDeposu();
    await new CrawlerAnalyticsService({ aiCrawlerHit: store } as never)
      .ingestLog(SITE, logSatirlari([[GPT, 403, 30], [GOOG, 304, 40]]));
    const t = kur([...store.rows.values()]);
    await expect(t.svc.scanAndAlert()).resolves.toEqual({ sites: 1, alerts: 1 });
    const n = t.notifications.create.mock.calls[0][0];
    expect(n.title).toBe('⚠️ GPTBot sitene ulaşamıyor (%100 hata)');
    // Googlebot yalniz 304 aldi: "2xx alıyor" demek yanlis olurdu
    expect(n.body).toContain('Googlebot ise başarılı yanıt (2xx ya da 304) alıyor');
    expect(n.body).not.toContain('ise 2xx alıyor');
  });

  it('site komple dusuk, yalniz nginx yonlendirmesi calisiyor (301 + 502): "bota ozel engel" alarmi YOK — 301 basarili sayilmaz', async () => {
    const store = hitDeposu();
    await new CrawlerAnalyticsService({ aiCrawlerHit: store } as never)
      .ingestLog(SITE, logSatirlari([[GPT, 301, 20], [GPT, 502, 30], [GOOG, 301, 10], [GOOG, 502, 40]]));
    const rows = [...store.rows.values()];
    expect(rows.every((r) => r.status2xx === 0)).toBe(true);
    const t = kur(rows);
    await expect(t.svc.scanAndAlert()).resolves.toEqual({ sites: 1, alerts: 0 });
    expect(t.notifications.create).not.toHaveBeenCalled();
  });
});

describe('R22 — metin 4xx ve 5xx\'i ayri ve gercek sayilarla yazar', () => {
  it('10×200 + 10×404 + 12×503: "22 tanesinde hata aldı (12 tanesi 5xx, 10 tanesi 4xx)" (eskiden "22 tanesinde 5xx")', async () => {
    const store = hitDeposu();
    await new CrawlerAnalyticsService({ aiCrawlerHit: store } as never)
      .ingestLog(SITE, logSatirlari([[GPT, 200, 10], [GPT, 404, 10], [GPT, 503, 12], [GOOG, 200, 50]]));
    const t = kur([...store.rows.values()]);
    await expect(t.svc.scanAndAlert()).resolves.toEqual({ sites: 1, alerts: 1 });
    const n = t.notifications.create.mock.calls[0][0];
    expect(n.title).toBe('⚠️ GPTBot sitene ulaşamıyor (%69 hata)');
    expect(n.body).toContain('durum kodu ölçülen 32 isteğin 22 tanesinde hata aldı (12 tanesi 5xx, 10 tanesi 4xx)');
    expect(t.webhook.notify.mock.calls[0][0].message).toContain('(12 tanesi 5xx, 10 tanesi 4xx)');
    expect(n.body).not.toContain('22 tanesinde 5xx');
  });

  it('hataDokumu: tek sinif kendi etiketiyle, iki sinif ayri sayilarla (esitlikte de)', () => {
    expect(hataDokumu(20, 0, 20)).toBe('20 tanesinde 5xx aldı');
    expect(hataDokumu(23, 23, 0)).toBe('23 tanesinde 4xx aldı');
    expect(hataDokumu(30, 15, 15)).toBe('30 tanesinde hata aldı (15 tanesi 5xx, 15 tanesi 4xx)');
  });
});
