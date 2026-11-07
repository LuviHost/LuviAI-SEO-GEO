import { describe, it, expect } from 'vitest';
import { CLASSIC_BLOCK_SCORE_CAP, CRITICAL_SEARCH_BOTS, ROBOTS_METHOD_VERSION, computeRobotsCheck, criticalBotAccess } from './robots-check.js';
import { fixRouteForIssue } from './fix-routes.js';

const types = (r: ReturnType<typeof computeRobotsCheck>) => r.issues.map((i) => i.type);

describe('computeRobotsCheck (yontem v3 — alti kritik bot)', () => {
  it('robots.txt yok → kritik', () => {
    expect(computeRobotsCheck(null)).toMatchObject({ score: 0, found: false, details: { methodVersion: 3 } });
  });

  it('kritik liste: Googlebot, Bingbot, OAI-SearchBot, PerplexityBot, Claude-SearchBot, Claude-User; DeepSeek/Grok yok', () => {
    expect(CRITICAL_SEARCH_BOTS.map((b) => b.name)).toEqual(['Googlebot', 'Bingbot', 'OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User']);
    expect(CRITICAL_SEARCH_BOTS.map((b) => b.name).join(' ')).not.toMatch(/deepseek|grok|xai/i);
    expect(ROBOTS_METHOD_VERSION).toBe(3);
  });

  it('yalnizca "User-agent: * Allow: /" + sitemap → kritik botlar ETKIN serbest, tam puan (adla anmak gerekmez)', () => {
    const r = computeRobotsCheck('User-agent: *\nAllow: /\nSitemap: https://x.com/sitemap.xml');
    expect(r.score).toBe(100);
    expect(types(r)).toEqual([]);
    expect(r.details?.searchBots).toHaveLength(6);
  });

  it('egitim botu engeli bilgi olarak kalir, puan dusurmez', () => {
    const r = computeRobotsCheck('User-agent: GPTBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://x.com/s.xml');
    expect(r.score).toBe(100);
    expect(types(r)).toEqual(['robots_ai_training_blocked']);
    expect(r.issues[0].severity).toBe('info');
  });

  it('AI arama botu engelli → uyari + orantili puan kaybi (6 botun 1i: 30 * 5/6 = 25)', () => {
    const r = computeRobotsCheck('User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://x.com/s.xml');
    expect(types(r)).toEqual(['robots_ai_search_blocked']);
    expect(r.score).toBe(95);
    expect(r.issues[0]).toMatchObject({ severity: 'warning', fixable: false });
    expect(r.issues[0].description).toMatch(/OAI-SearchBot/);
  });

  it('Claude-User engeli de puana girer (Anthropic: engellemek kullanici sorusunda sayfanin getirilmesini engeller)', () => {
    const r = computeRobotsCheck('User-agent: Claude-User\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://x.com/s.xml');
    expect(r.score).toBe(95);
    expect(r.issues.find((i) => i.type === 'robots_ai_search_blocked')?.description).toContain('Claude-User');
  });

  it('Googlebot tamamen engelli → KRITIK, puan en fazla 30, valid degil', () => {
    const r = computeRobotsCheck('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://x.com/s.xml');
    const i = r.issues.find((x) => x.type === 'robots_search_engine_blocked')!;
    expect(i).toMatchObject({ severity: 'critical', fixable: false });
    expect(i.description).toContain('Googlebot');
    expect(i.description).toContain('Googlebot için kendi "User-agent" grubundaki "Disallow: /" satırını kaldır');
    expect(r.score).toBe(CLASSIC_BLOCK_SCORE_CAP);
    expect(r.valid).toBe(false);
    // AI arama botlari serbest: ayrica uyari yok
    expect(types(r)).not.toContain('robots_ai_search_blocked');
  });

  it('Bingbot tamamen engelli → KRITIK (kucuk harfli belirtec de eslesir)', () => {
    const r = computeRobotsCheck('User-agent: bingbot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://x.com/s.xml');
    expect(r.issues.find((x) => x.type === 'robots_search_engine_blocked')?.description).toContain('Bingbot');
    expect(r.score).toBe(CLASSIC_BLOCK_SCORE_CAP);
  });

  it('kismi engel (Disallow: /admin) engel sayilmaz', () => {
    const r = computeRobotsCheck('User-agent: Googlebot\nDisallow: /admin\n\nUser-agent: *\nAllow: /\nSitemap: https://x.com/s.xml');
    expect(r.score).toBe(100);
    expect(types(r)).toEqual([]);
  });

  it('herkese kapali site → arama motorlari KRITIK + AI arama uyarisi, puan tavanda', () => {
    const r = computeRobotsCheck('User-agent: *\nDisallow: /');
    expect(r.score).toBe(CLASSIC_BLOCK_SCORE_CAP);
    expect(types(r)).toEqual(expect.arrayContaining(['robots_no_sitemap', 'robots_search_engine_blocked', 'robots_ai_search_blocked', 'robots_ai_training_blocked']));
    expect(r.details?.methodVersion).toBe(3);
  });

  it('criticalBotAccess: RFC 9309 — kendi grubu olan bot "*" grubunu yok sayar', () => {
    const a = criticalBotAccess('User-agent: Googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /');
    expect(a.find((b) => b.name === 'Googlebot')).toMatchObject({ effective: 'allow', declared: 'allow', classic: true });
    expect(a.find((b) => b.name === 'Bingbot')).toMatchObject({ effective: 'block', declared: 'unspecified', classic: true });
    expect(a.find((b) => b.name === 'Claude-User')).toMatchObject({ effective: 'block', classic: false });
  });
});

describe('arama botu engeli — otomatik duzeltilmez, karar sahibinin', () => {
  const issue = (txt: string, type = 'robots_ai_search_blocked') => computeRobotsCheck(txt).issues.find((i) => i.type === type)!;

  it('fixable:false — guvenli birlestirme mevcut Disallow\'u kaldirmaz; neden aciklamada', () => {
    const i = issue('User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://x.com/s.xml');
    expect(i.fixable).toBe(false);
    expect(i.fixCommand).toBeUndefined();
    expect(i.description).toContain('Otomatik düzeltilmez');
    expect(i.description).toContain('karar senin');
  });

  it('iki engel tipi de elle rotada (auto-fix onizlemesi acilmaz)', () => {
    const txt = 'User-agent: *\nDisallow: /';
    for (const type of ['robots_ai_search_blocked', 'robots_search_engine_blocked']) {
      expect(fixRouteForIssue({ checkId: 'robots_txt', type: issue(txt, type).type }), type).toBe('manual');
    }
  });

  it('bot kendi grubunda engelliyse o gruptaki "Disallow: /" satirinin kaldirilmasi soylenir', () => {
    const i = issue('User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://x.com/s.xml');
    expect(i.description).toContain('OAI-SearchBot için kendi "User-agent" grubundaki "Disallow: /" satırını kaldır');
    expect(i.description).not.toContain('User-agent: *');
  });

  it('"*" grubuyla engelliyse bota ozel "Allow: /" grubu onerilir (RFC 9309: ozel grup "*"in yerine gecer)', () => {
    const i = issue('User-agent: *\nDisallow: /');
    expect(i.description).toContain('"User-agent: *" grubundaki "Disallow: /" kuralına uyuyor');
    expect(i.description).toContain('"Allow: /" içeren ayrı bir "User-agent" grubu');
    for (const bot of ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'Claude-User']) expect(i.description).toContain(bot);
    const se = issue('User-agent: *\nDisallow: /', 'robots_search_engine_blocked');
    expect(se.description).toMatch(/Googlebot, Bingbot adıyla anılmadığı için/);
  });

  it('karisik durumda iki talimat birden', () => {
    const i = issue('User-agent: PerplexityBot\nDisallow: /\n\nUser-agent: *\nDisallow: /');
    expect(i.description).toContain('PerplexityBot için kendi "User-agent" grubundaki');
    expect(i.description).toMatch(/OAI-SearchBot, Claude-SearchBot, Claude-User adıyla anılmadığı için/);
  });

  it('Sitemap satiri eksikligi otomatik duzeltilebilir kalir (birlestirme ekler)', () => {
    const r = computeRobotsCheck('User-agent: *\nAllow: /');
    expect(r.issues.find((x) => x.type === 'robots_no_sitemap')?.fixable).toBe(true);
  });
});
