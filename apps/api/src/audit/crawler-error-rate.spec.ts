import { describe, it, expect } from 'vitest';
import { findCrawlerErrorTriggers } from './crawler-error-rate.js';

const row = (bot: string, hits: number, s2: number, s4: number, s5: number, date = '2026-08-27') =>
  ({ bot, date, hits, status2xx: s2, status4xx: s4, status5xx: s5 });

describe('findCrawlerErrorTriggers', () => {
  it('bir bot 5xx yerken digeri 2xx aliyorsa tetikler (bot-ozel engel)', () => {
    const t = findCrawlerErrorTriggers([row('Googlebot', 50, 5, 0, 45), row('ChatGPT-User', 30, 30, 0, 0)]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ bot: 'Googlebot', kind: 'server_error', healthyBots: ['ChatGPT-User'] });
    expect(t[0].errorRate).toBeCloseTo(0.9);
  });

  it('hicbir bot 2xx almiyorsa alarm YOK (site komple down — farkli olay)', () => {
    expect(findCrawlerErrorTriggers([row('Googlebot', 50, 0, 0, 50), row('GPTBot', 40, 0, 0, 40)])).toEqual([]);
  });

  it('minHits altindaki bot atlanir; esik altindaki oran atlanir', () => {
    expect(findCrawlerErrorTriggers([row('GPTBot', 3, 1, 0, 2), row('Googlebot', 100, 100, 0, 0)])).toEqual([]);
    expect(findCrawlerErrorTriggers([row('GPTBot', 100, 70, 0, 30), row('Googlebot', 100, 100, 0, 0)])).toEqual([]);
  });

  it('4xx agirlikli hata client_error; birden fazla gun bot bazinda toplanir', () => {
    const t = findCrawlerErrorTriggers([
      row('PerplexityBot', 15, 5, 10, 0, '2026-08-26'), row('PerplexityBot', 15, 0, 15, 0, '2026-08-27'),
      row('Googlebot', 20, 20, 0, 0),
    ]);
    expect(t[0]).toMatchObject({ bot: 'PerplexityBot', hits: 30, errors: 25, kind: 'client_error' });
  });

  it('tetikleyen bot saglikli listesinde kendini gormez; siralama hata oranina gore', () => {
    const t = findCrawlerErrorTriggers([row('A', 40, 5, 0, 35), row('B', 40, 20, 20, 0), row('C', 40, 40, 0, 0)]);
    expect(t.map((x) => x.bot)).toEqual(['A', 'B']);
    expect(t[0].healthyBots).toEqual(['B', 'C']);
  });
});
