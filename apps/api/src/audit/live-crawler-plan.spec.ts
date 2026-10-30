import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

/**
 * Canli Tarayici (liveCrawler = Ajans) plan dusunce de tutar + log yuklemesi
 * canli sayaclari ezmez.
 *
 * NEDEN VAR:
 *  1) Panel uclari (akis, kurulum kodu, sir yenileme) acikti ve imzali edge
 *     ingest'i (POST /tracker/events) plana bakmadan olay kaydediyordu; alt
 *     plandaki site snippet'i kurup Ajans ozelligini tam kullanabiliyordu.
 *     Ingest artik alt planda 2xx doner ama KAYDETMEZ (edge snippet'i hata
 *     dongusune girmesin).
 *  2) Log yuklemesi gunluk satiri mutlak degerle eziyordu (hits: s.hits);
 *     Worker'in gun boyu `increment` ile topladigi sayi kucuk bir log
 *     parcasiyla siliniyordu.
 */

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../notifications/notifications.service.js', () => ({ NotificationsService: class {} }));
vi.mock('./webhook-notifier.service.js', () => ({ WebhookNotifierService: class {} }));

const { LiveCrawlerService } = await import('./live-crawler.service.js');
const { CrawlerAnalyticsService, mergeLogIntoDailyHit } = await import('./crawler-analytics.service.js');
const { computeIngestSignature } = await import('./ingest-auth.js');
const { AuditController } = await import('./audit.controller.js');
const { PLAN_FEATURE_KEY } = await import('../billing/plan-feature.decorator.js');

const SITE = 'site_canli_1';
const SECRET = 'luvi_ing_' + 'd'.repeat(48);
const GPT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';

function kur(owner: { plan: string; role?: string }) {
  const createMany = vi.fn(async ({ data }: any) => ({ count: data.length }));
  const count = vi.fn(async () => 0);
  const upsert = vi.fn(async () => ({}));
  const notify = vi.fn(async () => ({}));
  const live = new LiveCrawlerService({
    site: { findUnique: async () => ({ id: SITE, userId: 'u1', name: 'Ornek', ingestSecret: SECRET, user: { role: 'USER', ...owner } }) },
    crawlerHitEvent: { count, createMany },
    aiCrawlerHit: { upsert },
    kvStore: { create: async () => ({}) },
  } as never, { create: notify } as never, { notify: async () => ({}) } as never);
  return { live, createMany, count, upsert, notify };
}

function imzali(events: any[], secret = SECRET) {
  const ts = String(Date.now());
  const body = JSON.stringify({ site: SITE, source: 'worker', events });
  return { signature: computeIngestSignature(secret, ts, body), timestamp: ts, rawBody: body };
}

describe('Canli Tarayici ingest — sahibin plani', () => {
  const events = [{ ua: GPT, path: '/a', status: 200, ts: Date.now() }, { ua: 'ChatGPT-User/1.0', path: '/b', status: 200, ts: Date.now() }];

  it('Ajans: olaylar kaydedilir', async () => {
    const { live, createMany } = kur({ plan: 'AGENCY' });
    const r = await live.ingest(SITE, events, 'worker', imzali(events));
    expect(r).toEqual({ accepted: 2, skipped: 0 });
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('plani dusen site: 2xx (hata yok) ama HICBIR sey kaydedilmez, bildirim yok', async () => {
    for (const plan of ['PRO', 'STARTER', 'TRIAL']) {
      const { live, createMany, count, upsert, notify } = kur({ plan });
      const r = await live.ingest(SITE, events, 'worker', imzali(events));
      expect(r, plan).toEqual({ accepted: 0, skipped: 2, reason: 'plan' });
      expect(createMany).not.toHaveBeenCalled();
      expect(count).not.toHaveBeenCalled();
      await new Promise((res) => setTimeout(res, 10));
      expect(upsert).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    }
  });

  it('ADMIN sahipli site planindan bagimsiz kaydeder', async () => {
    const { live, createMany } = kur({ plan: 'TRIAL', role: 'ADMIN' });
    await live.ingest(SITE, events, 'worker', imzali(events));
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('imza plandan ONCE: imzasiz istek plan durumunu ogrenemez (401)', async () => {
    const { live } = kur({ plan: 'TRIAL' });
    await expect(live.ingest(SITE, events, 'worker', imzali(events, 'luvi_ing_' + 'x'.repeat(48))))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('Canli Tarayici panel uclari plana bagli', () => {
  it('akis, kurulum kodu ve sir yenileme liveCrawler ister; uzun donem gecmis acik', () => {
    const f = (h: string) => Reflect.getMetadata(PLAN_FEATURE_KEY, (AuditController.prototype as any)[h]);
    for (const h of ['liveCrawlerRecent', 'liveCrawlerSnippets', 'liveCrawlerRotateSecret', 'ingestCrawlerLog']) {
      expect(f(h), h).toBe('liveCrawler');
    }
    expect(f('crawlerHistory')).toBeUndefined();
  });
});

describe('Log yuklemesi canli sayaclari ezmez', () => {
  const log = (hits: number) => ({ hits, uniqueUrls: 2, status2xx: hits, status4xx: 0, status5xx: 0, bytesServed: 100, topUrls: [{ url: '/a', count: hits }] });

  it('mergeLogIntoDailyHit: satir yoksa log degerleri; varsa yalniz eksik kadar', () => {
    expect(mergeLogIntoDailyHit(null, log(5)).increments).toMatchObject({ hits: 5, status2xx: 5 });
    const canli = { hits: 900, uniqueUrls: 0, status2xx: 880, status4xx: 20, status5xx: 0, bytesServed: 0, topUrls: [] };
    // Kucuk log parcasi: hicbir sayac dusmez
    expect(mergeLogIntoDailyHit(canli, log(100)).increments).toEqual({ hits: 0, uniqueUrls: 2, status2xx: 0, status4xx: 0, status5xx: 0, bytesServed: 100 });
    // Log daha buyukse fark kadar artar (ayni trafigi iki kez saymaz)
    expect(mergeLogIntoDailyHit(canli, log(1000)).increments.hits).toBe(100);
  });

  it('topUrls: adres basina en buyuk sayi, ilk 10', () => {
    const existing = { hits: 3, uniqueUrls: 1, status2xx: 3, status4xx: 0, status5xx: 0, bytesServed: 0, topUrls: [{ url: '/a', count: 9 }, { url: '/z', count: 1 }] };
    const { topUrls } = mergeLogIntoDailyHit(existing, log(4));
    expect(topUrls).toEqual([{ url: '/a', count: 9 }, { url: '/z', count: 1 }]);
  });

  it('ingestLog: canli 900 hit, 3 satirlik log yuklemesi sonrasi 900 kalir; ayni log iki kez yuklenince degismez', async () => {
    const rows = new Map<string, any>();
    const k = (w: any) => `${w.siteId_date_bot.date.toISOString()}|${w.siteId_date_bot.bot}`;
    const store = {
      findUnique: vi.fn(async ({ where }: any) => rows.get(k(where)) ?? null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const cur = rows.get(k(where));
        if (!cur) { rows.set(k(where), { ...create }); return create; }
        for (const [f, v] of Object.entries(update)) {
          cur[f] = v && typeof v === 'object' && 'increment' in (v as any) ? (cur[f] ?? 0) + (v as any).increment : v;
        }
        return cur;
      }),
    };
    rows.set(`${new Date('2026-10-17').toISOString()}|GPTBot`, { hits: 900, uniqueUrls: 0, topUrls: [], status2xx: 900, status4xx: 0, status5xx: 0, bytesServed: 0 });
    const satirlar = [1, 2, 3].map((i) => `40.77.167.1 - - [17/Oct/2026:10:00:0${i} +0000] "GET /p${i} HTTP/1.1" 200 100 "-" "${GPT}"`).join('\n');
    const svc = new CrawlerAnalyticsService({ aiCrawlerHit: store } as never);
    await svc.ingestLog('s1', satirlar);
    const row = [...rows.values()][0];
    expect(row.hits).toBe(900);
    expect(row.status2xx).toBe(900);
    expect(row.uniqueUrls).toBe(3);
    await svc.ingestLog('s1', satirlar);
    expect([...rows.values()][0]).toMatchObject({ hits: 900, uniqueUrls: 3, bytesServed: 300 });
  });
});
