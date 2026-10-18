import { describe, it, expect, vi } from 'vitest';

/**
 * Bot ziyaret takibindeki kullanici ajani (UA) desenleri.
 *
 * Google-Extended bir robots.txt KONTROL belirtecidir, HTTP kullanici ajani
 * degildir: "Google-Extended doesn't have a separate HTTP request user agent
 * string. Crawling is done with existing Google user agent strings; the
 * robots.txt user-agent token is used in a control capacity."
 * (https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers)
 * Bu adla eslesen bir istek ancak taklit olabilir; uc dedektor de onu aramamali.
 * Gercek Google taramasi Googlebot olarak sayilmaya devam eder.
 */

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const { LiveCrawlerService, LIVE_BOT_REGISTRY } = await import('./live-crawler.service.js');
const { CrawlerTrackingMiddleware } = await import('./crawler-tracking.middleware.js');
const { TrackerController } = await import('./tracker.controller.js');

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const FAKE_EXTENDED = 'Mozilla/5.0 (compatible; Google-Extended/1.0)';

describe('Live crawler (edge ingest) — UA kaydi', () => {
  const svc = new LiveCrawlerService({} as any, {} as any, {} as any);

  it('Google-Extended kayitta yok; taklit UA bot sayilmaz, gercek Googlebot sayilir', () => {
    expect(LIVE_BOT_REGISTRY.some((b) => b.name === 'Google-Extended')).toBe(false);
    expect(svc.resolveBot(FAKE_EXTENDED)).toBeNull();
    expect(svc.resolveBot(GOOGLEBOT)).toBe('Googlebot');
    expect(svc.resolveBot('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)')).toBe('GPTBot');
  });

  it('edge ajaninin yolladigi "Google-Extended" bot adi kabul edilmez', () => {
    expect((svc as any).normalizeBotName('Google-Extended')).toBeNull();
    expect((svc as any).normalizeBotName('googlebot')).toBe('Googlebot');
  });

  it('kurulum snippet\'lerindeki UA deseni Google-Extended aramaz', async () => {
    const prisma = { site: { findUnique: vi.fn(async () => ({ id: 's1', ingestSecret: 'sir' })) } };
    const s = await new LiveCrawlerService(prisma as any, {} as any, {} as any).snippets('s1');
    for (const code of [s.cloudflareWorker, s.wordpress, s.nginx]) {
      expect(code).not.toContain('Google-Extended');
      expect(code).toContain('GPTBot');
    }
  });
});

describe('API ara katmani — UA kaydi', () => {
  // Kurucu 60 sn'lik bosaltma zamanlayicisi kurar; desen denetimi icin gerekmez
  const detect = (ua: string) => (CrawlerTrackingMiddleware.prototype as any).detectBot.call({}, ua);

  it('taklit Google-Extended UA bot sayilmaz; Googlebot sayilir', () => {
    expect(detect(FAKE_EXTENDED)).toBeNull();
    expect(detect(GOOGLEBOT)).toBe('Googlebot');
    expect(detect('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')).toBe('ClaudeBot');
  });
});

describe('JS beacon (tracker.js) — UA deseni', () => {
  it('beacon betigindeki bot deseni Google-Extended aramaz', () => {
    let js = '';
    const res = { send: (body: string) => { js = body; } };
    new TrackerController({} as any, {} as any, {} as any).trackerScript('s1', res as any);
    const pattern = /var botPatterns = (\/.*\/i);/.exec(js)?.[1] ?? '';
    expect(pattern).toContain('GPTBot');
    expect(pattern).not.toContain('Google-Extended');
  });
});
