import { describe, it, expect, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';

/**
 * AuditController — kapsam ve yanit kurallari:
 *  - POST agent-readiness/run engelli taramada skor yerine null + measured:false
 *  - govdeden gelen articleId BU siteye ait olmali: SiteAccessGuard yalniz
 *    URL'deki :siteId'yi dogrular; snippet optimize / cross-link servisleri
 *    kimligi siteyle sinirlamadan okuyup yaziyordu (baska musterinin makalesi)
 *
 * Kurucu 38 bagimlilik aliyor ve vitest dekorator metadata'si uretmiyor:
 * yalniz handler'in kullandigi alanlar prototipten kurulan nesneye verilir.
 */
const { AuditController } = await import('./audit.controller.js');

const OWN = 'art-own';
const FOREIGN = 'art-foreign';

function controller() {
  const ctl = Object.create(AuditController.prototype) as any;
  ctl.prisma = {
    article: {
      findFirst: vi.fn(async ({ where }: any) => (where.id === OWN && where.siteId === 's1' ? { id: OWN } : null)),
    },
  };
  ctl.snippetOpt = { optimize: vi.fn(async (id: string) => ({ articleId: id })), apply: vi.fn(async () => ({ ok: true })) };
  ctl.crossLink = { suggestForArticle: vi.fn(async () => []), applyLinkSuggestion: vi.fn(async () => ({ ok: true })) };
  ctl.agentReadiness = { scan: vi.fn() };
  return ctl;
}

describe('POST agent-readiness/run', () => {
  it('engelli tarama: overallScore null + measured false; neden access alaninda kalir', async () => {
    const ctl = controller();
    ctl.agentReadiness.scan.mockResolvedValueOnce({ overallScore: 18, status: 'blocked', access: { state: 'blocked', reason: 'WAF' }, levels: [] });
    const r = await ctl.agentReadinessRun('s1');
    expect(r).toMatchObject({ overallScore: null, measured: false, status: 'blocked', access: { reason: 'WAF' } });
  });

  it('olculmus tarama: skor aynen', async () => {
    const ctl = controller();
    ctl.agentReadiness.scan.mockResolvedValueOnce({ overallScore: 71, status: 'mostly_ready', access: null, levels: [] });
    expect(await ctl.agentReadinessRun('s1')).toMatchObject({ overallScore: 71, measured: true });
  });
});

describe('makale kimligi siteyle sinirli', () => {
  it('snippet/optimize: baska sitenin makalesi 404, model cagrisi yok; kendi makalesi gecer', async () => {
    const ctl = controller();
    await expect(ctl.snippetOptimize('s1', { articleId: FOREIGN })).rejects.toBeInstanceOf(NotFoundException);
    expect(ctl.snippetOpt.optimize).not.toHaveBeenCalled();
    await ctl.snippetOptimize('s1', { articleId: OWN });
    expect(ctl.snippetOpt.optimize).toHaveBeenCalledWith('s1', OWN);
    expect(ctl.prisma.article.findFirst).toHaveBeenCalledWith({ where: { id: OWN, siteId: 's1' }, select: { id: true } });
  });

  it('snippet/optimize/apply: baska sitenin makalesine yazilmaz; oneri yoksa 400', async () => {
    const ctl = controller();
    await expect(ctl.snippetOptimizeApply('s1', { articleId: FOREIGN, optimized: { metaTitle: 'x' } })).rejects.toBeInstanceOf(NotFoundException);
    expect(ctl.snippetOpt.apply).not.toHaveBeenCalled();
    await expect(ctl.snippetOptimizeApply('s1', { articleId: OWN })).rejects.toBeInstanceOf(BadRequestException);
    await ctl.snippetOptimizeApply('s1', { articleId: OWN, optimized: { metaTitle: 'x' } });
    expect(ctl.snippetOpt.apply).toHaveBeenCalledWith('s1', OWN, { metaTitle: 'x' });
  });

  it('articleId eksikse 400 (DB sorgusu yok)', async () => {
    const ctl = controller();
    await expect(ctl.snippetOptimize('s1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(ctl.prisma.article.findFirst).not.toHaveBeenCalled();
  });

  it('cross-link/apply: oneri baska sitenin makalesini hedefliyorsa 404, yazim yok', async () => {
    const ctl = controller();
    await expect(ctl.crossLinkApply('s1', { suggestion: { fromArticleId: FOREIGN, anchorText: 'a', toArticleUrl: 'https://x', contextSnippet: 'c' } }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(ctl.crossLink.applyLinkSuggestion).not.toHaveBeenCalled();
  });

  it('cross-link/suggest: kendi makalesi; model cagrisi sayisi (limit) 1-10 arasina sikistirilir', async () => {
    const ctl = controller();
    await expect(ctl.crossLinkSuggest('s1', { articleId: FOREIGN })).rejects.toBeInstanceOf(NotFoundException);
    await ctl.crossLinkSuggest('s1', { articleId: OWN, limit: 500 });
    expect(ctl.crossLink.suggestForArticle).toHaveBeenLastCalledWith('s1', OWN, { limit: 10 });
    await ctl.crossLinkSuggest('s1', { articleId: OWN });
    expect(ctl.crossLink.suggestForArticle).toHaveBeenLastCalledWith('s1', OWN, { limit: 5 });
  });
});
