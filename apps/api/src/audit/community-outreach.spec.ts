import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { CommunityOutreachService } = await import('./community-outreach.service.js');
const { COMMUNITY_MAX_LIMIT, clampLimit } = await import('./audit-limits.js');

/**
 * Topluluk firsatlari — servis duzeyi tavan.
 *
 * NEDEN VAR: firsat basina bir model cagrisi (yanit taslagi) yapiliyor; 20
 * tavani yalniz controller'da ve DTO'daydi. community-agent.service, MCP ya da
 * worker gibi dogrudan cagiranlar limit=1000 gecebiliyordu.
 */

function svc() {
  const prisma = {
    site: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: 's1', name: 'Lavanta', url: 'https://lavantakuafor.com', niche: 'kuaför',
        brain: { seoStrategy: { aeoQueries: ['kuaför önerisi', 'iyi kuaför hangisi'] }, brandVoice: {} },
      })),
    },
  };
  const s = new CommunityOutreachService(prisma as any);
  // Her arama 30 firsat doner — tavan yoksa 60 taslak cagrisi olurdu
  (s as any).searchReddit = vi.fn(async (q: string) => Array.from({ length: 30 }, (_, i) => ({
    source: 'reddit', url: `https://reddit.com/r/x/${q}/${i}`, title: `${q} ${i}?`, snippet: '', draftReply: '', brandFitScore: 0,
  })));
  const generateReply = vi.fn(async () => 'taslak');
  (s as any).generateReply = generateReply;
  return { s, generateReply };
}

describe('CommunityOutreachService.findOpportunities — limit servis icinde sikistirilir', () => {
  it.each([
    [1000, COMMUNITY_MAX_LIMIT],
    [undefined, 10],
    [Number.NaN, 10],
    [0, 1],
    [-5, 1],
    [7.9, 7],
  ])('limit=%s → %s taslak cagrisi', async (limit, beklenen) => {
    const { s, generateReply } = svc();
    const out = await s.findOpportunities('s1', { limit: limit as number | undefined });
    expect(generateReply).toHaveBeenCalledTimes(beklenen);
    expect(out).toHaveLength(beklenen);
  });

  it('clampLimit: dize ya da sonsuz deger varsayilana duser', () => {
    expect(clampLimit('50', 20, 10)).toBe(10);
    expect(clampLimit(Number.POSITIVE_INFINITY, 20, 10)).toBe(10);
    expect(clampLimit(25, 20, 10)).toBe(20);
  });
});
