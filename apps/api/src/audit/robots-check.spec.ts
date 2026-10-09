import { describe, it, expect } from 'vitest';
import { computeRobotsCheck } from './robots-check.js';

const types = (r: ReturnType<typeof computeRobotsCheck>) => r.issues.map((i) => i.type);

describe('computeRobotsCheck (yontem v2)', () => {
  it('robots.txt yok → kritik', () => {
    expect(computeRobotsCheck(null)).toMatchObject({ score: 0, found: false });
  });

  it('yalnizca "User-agent: * Allow: /" + sitemap → AI arama botlari ETKIN serbest, tam puan (v1 "eksik" diyordu)', () => {
    const r = computeRobotsCheck('User-agent: *\nAllow: /\nSitemap: https://x.com/sitemap.xml');
    expect(r.score).toBe(100);
    expect(types(r)).toEqual([]);
  });

  it('GPTBot adi gecip ENGELLI olsa bile v1 puan veriyordu; v2 bunu egitim engeli olarak bilgi verir, arama botlari serbest', () => {
    const r = computeRobotsCheck('User-agent: GPTBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://x.com/s.xml');
    expect(r.score).toBe(100);
    expect(types(r)).toEqual(['robots_ai_training_blocked']);
    expect(r.issues[0].severity).toBe('info');
  });

  it('arama botu engelli → uyari + orantili puan kaybi', () => {
    const r = computeRobotsCheck('User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://x.com/s.xml');
    expect(types(r)).toContain('robots_ai_search_blocked');
    expect(r.score).toBe(90);
    expect(r.issues.find((i) => i.type === 'robots_ai_search_blocked')?.description).toMatch(/OAI-SearchBot/);
  });

  it('herkese kapali site → tum arama botlari engelli', () => {
    const r = computeRobotsCheck('User-agent: *\nDisallow: /');
    expect(r.score).toBe(50);
    expect(types(r)).toEqual(expect.arrayContaining(['robots_no_sitemap', 'robots_ai_search_blocked', 'robots_ai_training_blocked']));
    expect(r.details?.methodVersion).toBe(2);
  });
});
