import { afterEach, describe, expect, it, vi } from 'vitest';
import { FixedWindowLimiter, ingestIpFailureLimit, ingestSiteRateLimit } from './ingest-rate-limit.js';
import { needsCodeUpdate, parseThrottleValue, readIngestHealth, throttleKey } from './ingest-health.js';

afterEach(() => {
  delete process.env.INGEST_SITE_RATE_LIMIT;
});

describe('FixedWindowLimiter', () => {
  it('pencere icinde tavan, pencere degisince sifir; allows sayaci artirmaz', () => {
    let t = 60_000 * 1000;
    const l = new FixedWindowLimiter(60_000, 10, () => t);
    expect(l.allows('s1', 2)).toBe(true);
    expect(l.take('s1', 2)).toBe(true);
    expect(l.take('s1', 2)).toBe(true);
    expect(l.take('s1', 2)).toBe(false);
    expect(l.allows('s1', 2)).toBe(false);
    expect(l.take('s2', 2)).toBe(true); // site kovalari birbirinden bagimsiz
    t += 30_000;
    expect(l.retryAfterSeconds()).toBe(30);
    t += 30_000;
    expect(l.take('s1', 2)).toBe(true);
  });

  it('anahtar tavani dolunca en eski atilir, yeni anahtar reddedilmez', () => {
    const l = new FixedWindowLimiter(60_000, 2, () => 0);
    l.take('a', 1);
    l.take('b', 1);
    expect(l.take('c', 1)).toBe(true);
    expect(l.allows('a', 1)).toBe(true); // atildi → sifirlandi
  });

  it('tavanlar: imzali site basina 6000/dk, imzasiz IP basina 300/dk (env ile)', () => {
    expect(ingestSiteRateLimit()).toBe(6000);
    process.env.INGEST_SITE_RATE_LIMIT = '12';
    expect(ingestSiteRateLimit()).toBe(12);
    process.env.INGEST_SITE_RATE_LIMIT = 'abc';
    expect(ingestSiteRateLimit()).toBe(6000);
    expect(ingestIpFailureLimit()).toBeGreaterThan(0);
  });
});

describe('ingest sagligi', () => {
  it('429 degeri bozuk olsa da okunur', () => {
    expect(parseThrottleValue('{"n":5,"last":"2026-11-02T10:00:00.000Z"}')).toEqual({ n: 5, last: '2026-11-02T10:00:00.000Z' });
    expect(parseThrottleValue('bozuk')).toEqual({ n: 0, last: null });
    expect(parseThrottleValue(null)).toEqual({ n: 0, last: null });
  });

  it('IP\'siz isabet varsa kod guncellemesi istenir; isabet yoksa istenmez', () => {
    expect(needsCodeUpdate(10, 3)).toBe(true);
    expect(needsCodeUpdate(10, 0)).toBe(false);
    expect(needsCodeUpdate(0, 0)).toBe(false);
  });

  it('readIngestHealth: 7 gunluk 429 toplami, son event, DB hatasinda bos doner', async () => {
    const now = Date.UTC(2026, 10, 2, 12);
    const findMany = vi.fn(async ({ where }: any) => {
      expect(where.key.in).toHaveLength(7);
      expect(where.key.in[0]).toBe(throttleKey('s1', '2026-11-02'));
      return [
        { key: throttleKey('s1', '2026-11-02'), value: JSON.stringify({ n: 4, last: '2026-11-02T09:00:00.000Z' }) },
        { key: throttleKey('s1', '2026-10-30'), value: JSON.stringify({ n: 6, last: '2026-10-30T09:00:00.000Z' }) },
      ];
    });
    const h = await readIngestHealth({
      crawlerHitEvent: {
        findFirst: async () => ({ ts: new Date(now - 60_000), source: 'wp' }),
        groupBy: async () => [{ verifyReason: 'ip-list', _count: { _all: 3 } }],
      },
      kvStore: { findMany },
    }, 's1', now);
    expect(h).toEqual({
      lastEventAt: new Date(now - 60_000).toISOString(), lastEventSource: 'wp',
      throttled7d: 10, lastThrottledAt: '2026-11-02T09:00:00.000Z',
      events24h: 3, noIp24h: 0, needsCodeUpdate: false,
    });
    const bos = await readIngestHealth({} as never, 's1', now);
    expect(bos).toMatchObject({ lastEventAt: null, throttled7d: 0, needsCodeUpdate: false });
  });
});
