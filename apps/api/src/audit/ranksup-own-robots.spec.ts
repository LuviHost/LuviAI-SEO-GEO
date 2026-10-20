import { describe, it, expect } from 'vitest';
import { KNOWN_AI_BOT_NAMES } from './known-ai-bots.js';
import { computeRobotsCheck } from './robots-check.js';
import { parseRobotsAiStance } from './robots-ai-stance.js';

// ranksup.ai'nin kendi robots.txt'i (apps/web/src/app/robots.txt/route.ts sunar).
// Yol hesaplanarak import edilir: statik import'u `nest build` (tsconfig.json spec'leri de
// derler, rootDir yok) takip eder, ortak koku apps/'e kaydirir ve dist/main.js yolunu bozar.
const WEB_ROBOTS = ['..', '..', '..', 'web', 'src', 'lib', 'robots-txt.ts'].join('/');
const { AI_BOTS, buildRobotsTxt } = (await import(/* @vite-ignore */ new URL(WEB_ROBOTS, import.meta.url).href)) as {
  AI_BOTS: readonly string[];
  buildRobotsTxt: () => string;
};

/**
 * Kendi sitemiz kendi denetimimizden gecmeli. Eski apps/web/src/app/robots.ts
 * bayat UA'lar yaziyordu ('Claude-Web', 'Mistral', 'DeepSeek') ve her botu
 * yalniz `Allow: /` ile kendi grubuna koyuyordu — isimli grup "*" grubunu miras
 * almadigi icin GPTBot/ClaudeBot /api/, /admin/, /dashboard yasaklarini atliyordu.
 */
describe('ranksup.ai robots.txt', () => {
  const robots = buildRobotsTxt();
  const groups = robots.split(/\n\s*\n/).filter((g) => /User-agent:/i.test(g));
  const aiGroup = groups.find((g) => g.includes('User-agent: OAI-SearchBot'))!;
  const wildcard = groups.find((g) => g.includes('User-agent: *'))!;

  it('bot listesi known-ai-bots.ts ile birebir ayni (web o pakete bagli degil, sapma burada yakalanir)', () => {
    expect([...AI_BOTS]).toEqual([...KNOWN_AI_BOT_NAMES]);
    for (const stale of ['Claude-Web', 'Mistral', 'DeepSeek']) expect(robots).not.toMatch(new RegExp(`^User-agent: ${stale}$`, 'm'));
  });

  it('kendi robots denetimimizden 100 alir; 21/21 egitim + arama botu isimle anilir, hicbiri engelli degil', () => {
    const check = computeRobotsCheck(robots);
    expect(check.score).toBe(100);
    expect(check.issues).toEqual([]);
    expect(parseRobotsAiStance(robots).scored).toEqual({ allow: 21, block: 0, named: 21, total: 21 });
  });

  it('AI botlari "*" grubundaki ozel yol yasaklarini atlayamaz', () => {
    const disallows = (g: string) => g.split('\n').filter((l) => l.startsWith('Disallow:')).sort();
    expect(disallows(aiGroup).length).toBeGreaterThan(0);
    expect(disallows(aiGroup)).toEqual(disallows(wildcard));
    expect(aiGroup).toContain('Allow: /api/mcp/server-card');
  });

  it('Content-Signal yalniz isimli AI grubunda; Sitemap satiri var', () => {
    expect(aiGroup).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes');
    expect(wildcard).not.toContain('Content-Signal');
    expect(robots).toMatch(/^Sitemap: https:\/\/ranksup\.ai\/sitemap\.xml$/m);
  });
});
