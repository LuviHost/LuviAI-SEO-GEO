import { describe, it, expect, vi } from 'vitest';
import { LookerController } from './looker.controller.js';

/**
 * Looker crawler-hits disa aktarimi: errors eskiden yalniz status4xx'ti;
 * sunucu hatalari (5xx) panoda hic gorunmuyordu. ok, status2xx kovasidir
 * (2xx + 304, crawler-analytics.service.ts isSuccessfulCrawlStatus).
 * Vitest dekorator metadata'si uretmedigi icin denetleyici elle kurulur.
 */
describe('GET /looker/crawler-hits', () => {
  it('errors = 4xx + 5xx; 5xx satiri kaybolmaz', async () => {
    const prisma = {
      site: { findUnique: vi.fn(async () => ({ id: 's1', userId: 'u1', name: 'Örnek', url: 'https://ornek.com' })) },
      aiCrawlerHit: {
        findMany: vi.fn(async () => [
          { date: new Date('2026-10-17T00:00:00Z'), bot: 'GPTBot', hits: 10, status2xx: 6, status4xx: 1, status5xx: 3 },
        ]),
      },
    };
    const ctrl = new LookerController(prisma as never);
    const { rows } = await ctrl.crawlerHits({ user: { id: 'u1', role: 'USER' } } as never, 's1');
    expect(rows).toEqual([{ date: '2026-10-17', bot: 'GPTBot', hits: 10, ok: 6, errors: 4 }]);
    const select = (prisma.aiCrawlerHit.findMany.mock.calls[0] as any)[0].select;
    expect(select.status5xx).toBe(true);
  });
});
