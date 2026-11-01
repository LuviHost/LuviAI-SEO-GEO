import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Live Crawler ingest — IP dogrulamasi, site bazli tavan ve kurulum kodu.
 *
 * Vaka (02.11.2026): ayni IP'lerden UA degistiren bir kaziyici ChatGPT-User /
 * Claude-User / PerplexityBot gibi gorunuyordu; panel bunlari gercek asistan
 * ziyareti sayiyor, "Claude sayfani okudu" bildirimi gonderiyordu. Ayrica IP
 * basina 300/dk tavan paylasimli Worker IP'lerinde gercek isabetleri 429 ile
 * dusuruyordu (Cloudflare'e gore ~3,5 kat eksik sayim).
 */

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../notifications/notifications.service.js', () => ({ NotificationsService: class {} }));
vi.mock('./webhook-notifier.service.js', () => ({ WebhookNotifierService: class {} }));

const { LiveCrawlerService } = await import('./live-crawler.service.js');
const { BotVerifier } = await import('./bot-verifier.service.js');
const { IP_LIST_SOURCES } = await import('./bot-verification.js');
const { computeIngestSignature } = await import('./ingest-auth.js');

const SITE = 'cmp6036790001artdfumwec57';
const SECRET = 'luvi_ing_0123456789abcdef0123456789abcdef0123456789abcdef';

/** Tum resmi listeler sahte ve YUKLU: OpenAI + Anthropic + Perplexity araliklari */
function verifier() {
  const lists: Record<string, string[]> = {
    'openai-gptbot': ['132.196.86.0/24'],
    'openai-chatgpt-user': ['104.208.184.192/28'],
    'openai-searchbot': ['104.210.140.128/28'],
    'anthropic': ['216.73.216.0/22'],
    'perplexity-bot': ['18.97.9.100/32'],
    'perplexity-user': ['18.97.43.80/32'],
  };
  const byUrl = Object.fromEntries(Object.entries(IP_LIST_SOURCES).map(([id, s]) => [s.url, id]));
  return new BotVerifier({
    fetchText: async (url) => {
      const id = byUrl[url];
      if (!lists[id]) throw new Error('yok');
      return JSON.stringify({ prefixes: lists[id].map((p) => ({ ipv4Prefix: p })) });
    },
    reverse: async () => [],
    resolve: async () => [],
    now: () => Date.now(),
  });
}

function kur() {
  const rows: any[] = [];
  const upserts: any[] = [];
  const kv = new Map<string, string>();
  const prisma = {
    site: { findUnique: vi.fn(async () => ({ id: SITE, userId: 'u1', name: 'Ornek', ingestSecret: SECRET, user: { plan: 'AGENCY', role: 'USER' } })) },
    crawlerHitEvent: {
      count: vi.fn(async () => 0),
      createMany: vi.fn(async ({ data }: any) => { rows.push(...data); return { count: data.length }; }),
    },
    aiCrawlerHit: { upsert: vi.fn(async (a: any) => { upserts.push(a); return {}; }) },
    kvStore: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async ({ where }: any) => (kv.has(where.key) ? { key: where.key, value: kv.get(where.key)! } : null)),
      upsert: vi.fn(async ({ where, create, update }: any) => { kv.set(where.key, (kv.has(where.key) ? update : create).value); return {}; }),
    },
  };
  const notifications = { create: vi.fn(async () => ({})) };
  const webhook = { notify: vi.fn(async () => ({})) };
  const live = new LiveCrawlerService(prisma as never, notifications as never, webhook as never, verifier());
  const send = (events: any[]) => {
    const raw = JSON.stringify({ site: SITE, events });
    const ts = String(Date.now());
    return live.ingest(SITE, events, 'worker', { rawBody: raw, timestamp: ts, signature: computeIngestSignature(SECRET, ts, raw) });
  };
  return { live, prisma, rows, upserts, kv, notifications, send };
}

const SCRAPER = '45.140.10.20';

afterEach(() => {
  delete process.env.INGEST_SITE_RATE_LIMIT;
});

describe('ingest — IP dogrulamasi', () => {
  it('ayni kaziyici IP\'si farkli bot UA\'lariyla: hepsi unverified; resmi IP verified; IP\'siz eski Worker unknown', async () => {
    const t = kur();
    const r = await t.send([
      { ua: 'ChatGPT-User/1.0', path: '/a', status: 200, ip: SCRAPER },
      { ua: 'Claude-User/1.0', path: '/a', status: 200, ip: SCRAPER },
      { ua: 'PerplexityBot/1.0', path: '/a', status: 403, ip: SCRAPER },
      { ua: 'Claude-User/1.0', path: '/b', status: 200, ip: '216.73.216.9' },
      { ua: 'GPTBot/1.2', path: '/c', status: 200 },
    ]);
    expect(r).toEqual({ accepted: 5, skipped: 0 });
    expect(t.rows.map((x) => [x.bot, x.verify, x.verifyReason])).toEqual([
      ['ChatGPT-User', 'unverified', 'ip-not-in-list'],
      ['Claude-User', 'unverified', 'ip-not-in-list'],
      ['PerplexityBot', 'unverified', 'ip-not-in-list'],
      ['Claude-User', 'verified', 'ip-list'],
      ['GPTBot', 'unknown', 'no-ip'],
    ]);
    // Ham IP SAKLANMAZ
    for (const row of t.rows) {
      expect(row).not.toHaveProperty('ip');
      expect(JSON.stringify(row)).not.toContain(SCRAPER);
    }
  });

  it('gunluk toplamlar dogrulama kirilimiyla yazilir; taklit isteklerin durum kovalari ayri', async () => {
    const t = kur();
    await t.send([
      { ua: 'PerplexityBot/1.0', path: '/a', status: 403, ip: SCRAPER },
      { ua: 'PerplexityBot/1.0', path: '/a', status: 200, ip: '18.97.9.100' },
      { ua: 'PerplexityBot/1.0', path: '/a', status: 200 },
    ]);
    await vi.waitFor(() => expect(t.upserts).toHaveLength(1));
    expect(t.upserts[0].create).toMatchObject({
      bot: 'PerplexityBot', hits: 3, status2xx: 2, status4xx: 1,
      verifiedHits: 1, unverifiedHits: 1, unverified2xx: 0, unverified4xx: 1, unverified5xx: 0,
    });
  });

  it('"az once sayfani okudu" bildirimi YALNIZ dogrulanmis cite fetch ile gider', async () => {
    const t = kur();
    await t.send([{ ua: 'ChatGPT-User/1.0', path: '/a', status: 200, ip: SCRAPER }, { ua: 'Claude-User/1.0', path: '/a', status: 200 }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(t.notifications.create).not.toHaveBeenCalled();
    await t.send([{ ua: 'ChatGPT-User/1.0', path: '/fiyat', status: 200, ip: '104.208.184.200' }]);
    await vi.waitFor(() => expect(t.notifications.create).toHaveBeenCalledTimes(1));
  });

  it('dogrulayici firlatsa da ingest dusmez; isabetler unknown yazilir', async () => {
    const t = kur();
    (t.live as any).verifier = { classifyMany: async () => { throw new Error('boom'); } };
    const r = await t.send([{ ua: 'GPTBot/1.2', path: '/', status: 200, ip: '132.196.86.1' }]);
    expect(r.accepted).toBe(1);
    expect(t.rows[0]).toMatchObject({ verify: 'unknown', verifyReason: 'list-unavailable' });
  });
});

describe('ingest — site bazli tavan (imzali istekler)', () => {
  it('tavan asilinca 429 + Retry-After bilgisi; dusen istekler sayilir ve kvStore\'a yazilir', async () => {
    process.env.INGEST_SITE_RATE_LIMIT = '3';
    const t = kur();
    for (let i = 0; i < 3; i++) await t.send([{ ua: 'GPTBot/1.2', path: '/', status: 200 }]);
    let err: any = null;
    try { await t.send([{ ua: 'GPTBot/1.2', path: '/', status: 200 }]); } catch (e) { err = e; }
    expect(err?.getStatus?.()).toBe(429);
    expect(err.getResponse().retryAfter).toBeGreaterThan(0);
    try { await t.send([{ ua: 'GPTBot/1.2', path: '/', status: 200 }]); } catch { /* 429 */ }

    expect(await t.live.flushThrottled()).toBe(1);
    const [key, value] = [...t.kv.entries()][0]!;
    expect(key).toMatch(new RegExp(`^ingest-429:${SITE}:\\d{4}-\\d{2}-\\d{2}$`));
    expect(JSON.parse(value)).toMatchObject({ n: 2 });
    // Ikinci bosaltma oncekinin ustune ekler
    try { await t.send([{ ua: 'GPTBot/1.2', path: '/', status: 200 }]); } catch { /* 429 */ }
    await t.live.flushThrottled();
    expect(JSON.parse(t.kv.get(key)!).n).toBe(3);
  });

  it('imzasiz istek site kovasini TUKETMEZ (once imza)', async () => {
    process.env.INGEST_SITE_RATE_LIMIT = '1';
    const t = kur();
    for (let i = 0; i < 3; i++) {
      await expect(t.live.ingest(SITE, [{ ua: 'GPTBot' }], 'worker', { rawBody: '{}', timestamp: String(Date.now()), signature: 'sha256=00' })).rejects.toThrow();
    }
    await expect(t.send([{ ua: 'GPTBot/1.2', path: '/', status: 200 }])).resolves.toMatchObject({ accepted: 1 });
  });
});

describe('recent — panel dogrulama kirilimi ve kaynak sagligi', () => {
  it('bot sayaclari verified/unverified/unknown ayrilir; IP\'siz isabet varsa kod guncelleme istenir', async () => {
    const now = new Date();
    const prisma = {
      crawlerHitEvent: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => ({ ts: now, source: 'worker' })),
        groupBy: vi.fn(async ({ by }: any) => {
          if (by.length === 2) {
            return [
              { bot: 'Claude-User', verify: 'unverified', _count: { _all: 40 } },
              { bot: 'Claude-User', verify: 'verified', _count: { _all: 2 } },
              { bot: 'GPTBot', verify: 'unknown', _count: { _all: 5 } },
            ];
          }
          if (by[0] === 'verifyReason') return [{ verifyReason: 'no-ip', _count: { _all: 5 } }, { verifyReason: 'ip-list', _count: { _all: 2 } }];
          return [{ verify: 'verified', _count: { _all: 1 } }, { verify: 'unverified', _count: { _all: 9 } }];
        }),
      },
      kvStore: { findMany: vi.fn(async () => [{ key: 'k', value: JSON.stringify({ n: 7, last: '2026-11-02T10:00:00.000Z' }) }]) },
    };
    const live = new LiveCrawlerService(prisma as never, {} as never, {} as never, verifier());
    const r: any = await live.recent(SITE);
    expect(r.total).toBe(47);
    expect(r.verification).toEqual({ verified: 2, unverified: 40, unknown: 5 });
    expect(r.byBot[0]).toEqual({ bot: 'Claude-User', hits: 42, verified: 2, unverified: 40, unknown: 0 });
    expect(r.citeFetchCounts24h).toEqual({ verified: 1, unverified: 9, unknown: 0 });
    expect(r.ingestHealth).toMatchObject({ throttled7d: 7, noIp24h: 5, events24h: 7, needsCodeUpdate: true });
    expect(r.workerConnected).toBe(true);
    // Vitrin sorgusu yalniz dogrulanmis cite'lari ister
    const citeQuery = prisma.crawlerHitEvent.findMany.mock.calls.map((c: any) => c[0]).find((q: any) => q.where.isCiteFetch);
    expect(citeQuery.where.verify).toBe('verified');
  });
});

describe('kurulum kodu — IP + yeniden deneme', () => {
  it('Worker cf-connecting-ip, ASN ve 429/5xx yeniden denemesi gonderir; WP ve nginx IP ekler', async () => {
    const prisma = { site: { findUnique: async () => ({ id: 's1', ingestSecret: SECRET }) } };
    const s = await new LiveCrawlerService(prisma as never, {} as never, {} as never, verifier()).snippets('s1');
    expect(s.cloudflareWorker).toContain("ip: request.headers.get('cf-connecting-ip')");
    expect(s.cloudflareWorker).toContain('cf.asn');
    expect(s.cloudflareWorker).toContain('verifiedBotCategory');
    expect(s.cloudflareWorker).toContain('RETRY_STATUS = [429, 500, 502, 503, 504]');
    expect(s.cloudflareWorker).toMatch(/for \(let attempt = 0; attempt < 3; attempt\+\+\)/);
    expect(s.cloudflareWorker).toContain("retry-after");
    // Hata yine yutulur ama once yeniden denenir
    expect(s.cloudflareWorker).toContain('ctx.waitUntil(ranksupSend(event)');
    expect(s.wordpress).toContain("$_SERVER['REMOTE_ADDR']");
    expect(s.wordpress).toContain("$_SERVER['HTTP_CF_CONNECTING_IP']");
    expect(s.nginx).toContain("ip=$(echo \"$line\" | awk '{print $1}')");
    expect(s.nginx).toContain('--retry 2');
  });

  it('Worker kodu sozdizimi gecerli JS ve yeniden denemede 429 sonrasi basarili gonderir', async () => {
    const prisma = { site: { findUnique: async () => ({ id: 's1', ingestSecret: SECRET }) } };
    const s = await new LiveCrawlerService(prisma as never, {} as never, {} as never, verifier()).snippets('s1');
    // ES modulunu calistirilabilir fonksiyona cevir: export default → return
    const body = s.cloudflareWorker.replace('export default {', 'return {');
    const calls: any[] = [];
    const statuses = [429, 200];
    const fakeFetch = async (input: any, init?: any) => {
      if (init?.method === 'POST') {
        calls.push(JSON.parse(init.body));
        const st = statuses.shift() ?? 200;
        return { status: st, headers: { get: (h: string) => (h === 'retry-after' && st === 429 ? '0.01' : null) } };
      }
      return { status: 200 };
    };
    const worker = new Function('fetch', 'crypto', 'TextEncoder', 'setTimeout', body)(fakeFetch, globalThis.crypto, TextEncoder, setTimeout);
    const waits: Promise<unknown>[] = [];
    const request = {
      url: 'https://ornek.com/blog/a',
      headers: { get: (h: string) => (h === 'user-agent' ? 'Mozilla/5.0; compatible; GPTBot/1.2' : h === 'cf-connecting-ip' ? '132.196.86.5' : null) },
      cf: { asn: 8075 },
    };
    await worker.fetch(request, {}, { waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(calls).toHaveLength(2);
    expect(calls[1].events[0]).toMatchObject({ ip: '132.196.86.5', asn: 8075, path: '/blog/a', status: 200 });
    expect(calls[1].events[0].cfVerified).toBeUndefined();
  });
});
