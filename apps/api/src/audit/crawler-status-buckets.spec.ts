import { describe, expect, it, vi } from 'vitest';

/**
 * R16 kok duzeltme — iki guvenilir yazicinin AiCrawlerHit durum kovalari.
 *
 * NEDEN VAR: log yuklemesi (CrawlerAnalyticsService.summarize) ve imzali edge
 * ingest (LiveCrawlerService.updateDailyAggregates) 304 Not Modified'i hicbir
 * kovaya yazmiyordu; AiCrawlerHit'te yalniz status2xx/4xx/5xx kolonu var. 304
 * kosullu GET'e verilen basarili SON cevaptir (RFC 9110 15.4.5) ve "basarili
 * istek" kovasina girer. 301/302/307/308 son cevap degildir: kovasiz kalir
 * (hits'te ve ham olayda durur), yoksa yalniz yonlendirmesi calisan, kendisi
 * dusuk bir site "botlar basarili yanit aliyor" gorunurdu. Iki yazici AYNI
 * kurali kullanir.
 */

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../notifications/notifications.service.js', () => ({ NotificationsService: class {} }));
vi.mock('./webhook-notifier.service.js', () => ({ WebhookNotifierService: class {} }));

const { CrawlerAnalyticsService, isSuccessfulCrawlStatus } = await import('./crawler-analytics.service.js');
const { LiveCrawlerService } = await import('./live-crawler.service.js');
const { computeIngestSignature } = await import('./ingest-auth.js');

const SITE = 'cmp6036790001artdfumwec57';
const BING = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
/** Her durumdan kac istek: 2×200, 1×204, 3×304, 1×301, 1×302, 1×307, 1×308, 2×404, 1×410, 2×503 */
const KARISIM: Array<[status: number, n: number]> = [
  [200, 2], [204, 1], [304, 3], [301, 1], [302, 1], [307, 1], [308, 1], [404, 2], [410, 1], [503, 2],
];
const TOPLAM = KARISIM.reduce((a, [, n]) => a + n, 0);

function logSatirlari(parcalar: Array<[status: number, n: number]>): string {
  const out: string[] = [];
  for (const [status, n] of parcalar) {
    for (let i = 0; i < n; i++) out.push(`40.77.167.1 - - [17/Oct/2026:10:00:00 +0000] "GET /p${status}-${i} HTTP/1.1" ${status} 100 "-" "${BING}"`);
  }
  return out.join('\n');
}

/** AiCrawlerHit upsert deposu: create + {increment}/duz deger update */
function hitDeposu() {
  const rows = new Map<string, Record<string, any>>();
  return {
    rows,
    // Log yuklemesi mevcut satiri okuyup eksik kadar artirir (mergeLogIntoDailyHit)
    findUnique: vi.fn(async ({ where }: any) => rows.get(`${where.siteId_date_bot.date.toISOString()}|${where.siteId_date_bot.bot}`) ?? null),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const k = `${where.siteId_date_bot.date.toISOString()}|${where.siteId_date_bot.bot}`;
      const cur = rows.get(k);
      if (!cur) { rows.set(k, { ...create }); return create; }
      for (const [f, v] of Object.entries(update)) {
        cur[f] = v && typeof v === 'object' && 'increment' in (v as any) ? (cur[f] ?? 0) + (v as any).increment : v;
      }
      return cur;
    }),
  };
}

describe('isSuccessfulCrawlStatus — basarili kova: 2xx ve 304', () => {
  it('2xx ve 304 basarili; 1xx, diger 3xx, 4xx ve 5xx degil', () => {
    for (const s of [200, 201, 204, 206, 299, 304]) expect(isSuccessfulCrawlStatus(s), String(s)).toBe(true);
    for (const s of [100, 101, 199, 300, 301, 302, 303, 305, 307, 308, 399, 400, 403, 404, 429, 500, 503, 599]) {
      expect(isSuccessfulCrawlStatus(s), String(s)).toBe(false);
    }
  });
});

describe('Log yuklemesi (summarize / ingestLog)', () => {
  it('304 basarili kovada; yonlendirmeler yalniz hits\'te', () => {
    const svc = new CrawlerAnalyticsService({} as never);
    const s = svc.summarize(svc.parseApacheLog(logSatirlari(KARISIM))).get('Bingbot')!;
    // Eskiden status2xx 3 idi (304'ler hicbir kovada degildi)
    expect({ hits: s.hits, s2: s.status2xx, s4: s.status4xx, s5: s.status5xx }).toEqual({ hits: TOPLAM, s2: 6, s4: 3, s5: 2 });
    // Kovasiz kalan tam olarak 301/302/307/308
    expect(s.hits - (s.status2xx + s.status4xx + s.status5xx)).toBe(4);
  });

  it('ingestLog satira ayni kovalari yazar', async () => {
    const store = hitDeposu();
    await new CrawlerAnalyticsService({ aiCrawlerHit: store } as never).ingestLog(SITE, logSatirlari(KARISIM));
    expect([...store.rows.values()][0]).toMatchObject({ bot: 'Bingbot', hits: TOPLAM, status2xx: 6, status4xx: 3, status5xx: 2 });
  });
});

describe('Imzali edge ingest (LiveCrawlerService.updateDailyAggregates)', () => {
  async function canliIngest(parcalar: Array<[status: number, n: number]>) {
    const secret = 'luvi_ing_' + 'c'.repeat(48);
    const store = hitDeposu();
    const olaylar: Array<{ status: number }> = [];
    const live = new LiveCrawlerService({
      site: { findUnique: async () => ({ id: SITE, userId: 'u1', name: 'Ornek Site', ingestSecret: secret, user: { plan: 'AGENCY', role: 'USER' } }) },
      crawlerHitEvent: {
        count: async () => 0,
        createMany: async ({ data }: any) => { olaylar.push(...data); return { count: data.length }; },
      },
      aiCrawlerHit: store,
      kvStore: { create: async () => ({}) },
    } as never, { create: async () => ({}) } as never, { notify: async () => ({}) } as never);
    const ts = Date.now();
    const events = parcalar.flatMap(([status, n]) => Array.from({ length: n }, (_, i) => ({ ua: BING, path: `/p${status}-${i}`, status, ts })));
    const body = JSON.stringify({ site: SITE, source: 'worker', events });
    await live.ingest(SITE, events, 'worker', { signature: computeIngestSignature(secret, String(ts), body), timestamp: String(ts), rawBody: body });
    await new Promise((r) => setTimeout(r, 20)); // updateDailyAggregates beklenmeden calisir
    return { row: [...store.rows.values()][0], olaylar };
  }

  it('Worker\'in ilettigi 304 basarili kovada; yonlendirmeler kovasiz ama ham olayda durum koduyla durur', async () => {
    const { row, olaylar } = await canliIngest(KARISIM);
    // Eskiden status2xx 3 idi (`status < 300`)
    expect(row).toMatchObject({ bot: 'Bingbot', hits: TOPLAM, status2xx: 6, status4xx: 3, status5xx: 2 });
    expect(olaylar.filter((o) => o.status >= 300 && o.status < 400).map((o) => o.status).sort()).toEqual([301, 302, 304, 304, 304, 307, 308]);
  });

  it('durumu bilinmeyen istek (0 → 100\'e sikistirilir) basarili sayilmaz', async () => {
    const { row } = await canliIngest([[0, 2], [200, 1]]);
    // Eskiden status2xx 3 idi: 1xx de `status < 300` kosuluna giriyordu
    expect(row).toMatchObject({ hits: 3, status2xx: 1, status4xx: 0, status5xx: 0 });
  });

  it('iki yazici ayni durum karisimini ayni kovalara yazar', async () => {
    const svc = new CrawlerAnalyticsService({} as never);
    const log = svc.summarize(svc.parseApacheLog(logSatirlari(KARISIM))).get('Bingbot')!;
    const { row } = await canliIngest(KARISIM);
    expect({ s2: row.status2xx, s4: row.status4xx, s5: row.status5xx }).toEqual({ s2: log.status2xx, s4: log.status4xx, s5: log.status5xx });
  });
});
