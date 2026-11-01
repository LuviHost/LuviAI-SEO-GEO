import { describe, expect, it, vi } from 'vitest';
import { CrawlerAnalyticsService } from './crawler-analytics.service.js';
import { BotVerifier } from './bot-verifier.service.js';
import { IP_LIST_SOURCES } from './bot-verification.js';

/**
 * Log yuklemesi ve gecmis ucu — IP dogrulamasi. Manset dogrulanmis ziyaret;
 * "Yeni AI bot ziyareti" (firstSeen) yalniz dogrulanmis satirlardan.
 */

function verifier() {
  const lists: Record<string, string[]> = {
    'openai-gptbot': ['132.196.86.0/24'], 'openai-chatgpt-user': ['104.208.184.192/28'], 'openai-searchbot': ['104.210.140.128/28'],
    'cloudflare': Array.from({ length: 12 }, (_, i) => `173.245.${48 + i}.0/24`),
  };
  const byUrl = Object.fromEntries(Object.entries(IP_LIST_SOURCES).map(([id, s]) => [s.url, id]));
  return new BotVerifier({
    fetchText: async (url) => {
      const id = byUrl[url];
      if (!lists[id]) throw new Error('yok');
      if (id === 'cloudflare') return JSON.stringify({ result: { ipv4_cidrs: lists[id], ipv6_cidrs: [] } });
      return JSON.stringify({ prefixes: lists[id].map((p) => ({ ipv4Prefix: p })) });
    },
    reverse: async () => [], resolve: async () => [], now: () => Date.now(),
  });
}

const GPT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';
const satir = (ip: string, status = 200) => `${ip} - - [02/Nov/2026:10:00:00 +0000] "GET /a HTTP/1.1" ${status} 100 "-" "${GPT}"`;

describe('log yuklemesi — satirin IP\'si ile dogrulama', () => {
  it('resmi IP verified, kaziyici unverified, Cloudflare proxy adresi unknown', async () => {
    const upsert = vi.fn(async () => ({}));
    const prisma = { aiCrawlerHit: { findUnique: vi.fn(async () => null), upsert } };
    const svc = new CrawlerAnalyticsService(prisma as never, verifier());
    await svc.ingestLog('s1', [satir('132.196.86.5'), satir('45.140.10.20', 403), satir('45.140.10.20'), satir('173.245.48.9')].join('\n'));
    const create = (upsert.mock.calls[0] as any)[0].create;
    expect(create).toMatchObject({ bot: 'GPTBot', hits: 4, verifiedHits: 1, unverifiedHits: 2, unverified2xx: 1, unverified4xx: 1 });
  });
});

describe('getHistory — dogrulama kirilimi', () => {
  it('manset verification.verified; amac dagilimi dogrulanmislardan; firstSeen yalniz dogrulanmis satirlar', async () => {
    const groupBy = vi.fn(async () => []);
    const prisma = {
      aiCrawlerHit: {
        findMany: vi.fn(async () => [
          { bot: 'Claude-User', date: new Date('2026-11-01'), hits: 400, verifiedHits: 8, unverifiedHits: 380, topUrls: [], uniqueUrls: 0 },
          { bot: 'Bytespider', date: new Date('2026-11-01'), hits: 50, verifiedHits: 0, unverifiedHits: 0, topUrls: [], uniqueUrls: 0 },
          { bot: 'GPTBot', date: new Date('2026-11-01'), hits: 12, verifiedHits: 12, unverifiedHits: 0, topUrls: [], uniqueUrls: 0 },
        ]),
        groupBy,
      },
      crawlerHitEvent: { groupBy: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
      site: { findUnique: vi.fn(async () => null) },
      kvStore: { findMany: vi.fn(async () => []) },
    };
    const r: any = await new CrawlerAnalyticsService(prisma as never, verifier()).getHistory('s1', 30);
    expect(r.totalHits).toBe(462);
    expect(r.verification).toEqual({ verified: 20, unverified: 380, unknown: 62 });
    expect(r.byBotVerification['Claude-User']).toEqual({ verified: 8, unverified: 380, unknown: 12, hasMethod: true });
    expect(r.byBotVerification.Bytespider).toEqual({ verified: 0, unverified: 0, unknown: 50, hasMethod: false });
    // Claude-User + GPTBot dogrulanmis: ai-search 8, training 12
    expect(r.purposeSplit).toMatchObject({ basis: 'verified', aiSearchPct: 40, trainingPct: 60 });
    expect((groupBy.mock.calls[0] as any[])[0].where.verifiedHits).toEqual({ gt: 0 });
    expect(r.ingestHealth).toMatchObject({ lastEventAt: null, needsCodeUpdate: false });
  });
});
