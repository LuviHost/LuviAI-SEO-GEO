import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrossLinkingService } from './cross-linking.service.js';
import { SnippetOptimizerService } from './snippet-optimizer.service.js';

/**
 * Servis katmaninda kiraci kapsami (savunma derinligi): controller
 * assertArticleInSite ile kontrol ediyor; servisler de makaleyi
 * findFirst({ id, siteId }) ile okur — baska bir cagiran kimligi siteyle
 * sinirlamayi unutursa baska musterinin makalesi okunup yazilamaz.
 */

const OWN = { id: 'a-own', siteId: 's1', title: 'Saç bakımı', slug: 'sac-bakimi', topic: 'saç bakımı ipuçları', bodyMd: '# Başlık\n\nMetin\n\n## Sonuç\n\nSon.', frontmatter: null, metaDescription: null };

function crossPrisma(target: any = { title: 'Hedef yazı', slug: 'hedef', site: { url: 'https://hedef.com/' } }) {
  return {
    article: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.siteId === 's1' && where.id === OWN.id) return OWN;
        if (where.siteId && typeof where.siteId === 'object') return where.id === 'b-target' ? target : null;
        return null;
      }),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    site: { findUnique: vi.fn(async () => ({ url: 'https://ornek.com', niche: 'kuafor' })) },
  };
}

describe('CrossLinkingService', () => {
  it('suggest: baska sitenin makalesi 404, aday sorgusu yok', async () => {
    const prisma = crossPrisma();
    const svc = new CrossLinkingService(prisma as any);
    await expect(svc.suggestForArticle('s2', OWN.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.article.findFirst).toHaveBeenCalledWith({ where: { id: OWN.id, siteId: 's2' } });
    expect(prisma.article.findMany).not.toHaveBeenCalled();
  });

  it('suggest: aday havuzu yalniz otopilotu acik, yayindaki BASKA siteler (paneldeki "onay" kurali)', async () => {
    const prisma = crossPrisma();
    const svc = new CrossLinkingService(prisma as any);
    await svc.suggestForArticle('s1', OWN.id, { limit: 500 });
    const where = (prisma.article.findMany.mock.calls[0] as any[])[0].where;
    expect(where).toMatchObject({ siteId: { not: 's1' }, status: 'PUBLISHED', site: { autopilot: true, status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] } } });
    // Aday sitenin tam satiri (token'lar) okunmaz
    expect((prisma.article.findMany.mock.calls[0] as any[])[0].include).toEqual({ site: { select: { name: true, url: true, niche: true } } });
  });

  it('apply: hedef adres istemciden degil kayitli makaleden; metin tek satir ve koseli parantezsiz', async () => {
    const prisma = crossPrisma();
    const svc = new CrossLinkingService(prisma as any);
    const r = await svc.applyLinkSuggestion('s1', {
      fromArticleId: OWN.id,
      toArticleId: 'b-target',
      toArticleUrl: 'javascript:alert(1)',
      anchorText: 'Tıkla](javascript:alert(1)) [x',
      contextSnippet: 'Fiyatı $10 ve $1 — <script>x</script>\nikinci satır',
    });
    expect(r).toEqual({ ok: true, toArticleUrl: 'https://hedef.com/blog/hedef.html' });
    const body: string = (prisma.article.update.mock.calls[0] as any[])[0].data.bodyMd;
    expect(body).toContain('- [Tıkla(javascript:alert(1)) x](https://hedef.com/blog/hedef.html) — Fiyatı $10 ve $1 — scriptx/script ikinci satır');
    expect(body).not.toContain('](javascript:');
    // "Ayrıca bakınız" Sonuç'tan once eklenir
    expect(body.indexOf('## Ayrıca bakınız')).toBeLessThan(body.indexOf('## Sonuç'));
    expect((prisma.article.update.mock.calls[0] as any[])[0].where).toEqual({ id: OWN.id });
  });

  it('apply: mevcut bolume eklerken "$1" metni bozulmaz', async () => {
    const prisma = crossPrisma();
    prisma.article.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.siteId === 's1') return { ...OWN, bodyMd: '# B\n\n## Ayrıca bakınız\n- [eski](https://x)\n' };
      return { title: 'Hedef', slug: 'h', site: { url: 'https://hedef.com' } };
    });
    const svc = new CrossLinkingService(prisma as any);
    await svc.applyLinkSuggestion('s1', { fromArticleId: OWN.id, toArticleId: 'b-target', anchorText: 'Fiyat $1', contextSnippet: 'c $&' });
    const body: string = (prisma.article.update.mock.calls[0] as any[])[0].data.bodyMd;
    expect(body).toContain('## Ayrıca bakınız\n- [Fiyat $1](https://hedef.com/blog/h.html) — c $&\n- [eski](https://x)');
  });

  it('apply: baska sitenin kaynak makalesi 404; hedef yayinda/paylasima acik degilse 400; kimlik eksikse 400', async () => {
    const prisma = crossPrisma(null);
    const svc = new CrossLinkingService(prisma as any);
    await expect(svc.applyLinkSuggestion('s2', { fromArticleId: OWN.id, toArticleId: 'b-target' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.applyLinkSuggestion('s1', { fromArticleId: OWN.id, toArticleId: 'b-target' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.applyLinkSuggestion('s1', { fromArticleId: OWN.id })).rejects.toThrow(/toArticleId/);
    expect(prisma.article.update).not.toHaveBeenCalled();
    // Hedef sorgusu da otopilot + yayin kosulunu tasir, kendi sitesi haric
    const targetWhere = prisma.article.findFirst.mock.calls.map((c: any[]) => c[0].where).find((w: any) => w.id === 'b-target');
    expect(targetWhere).toMatchObject({ siteId: { not: 's1' }, status: 'PUBLISHED', site: { autopilot: true } });
  });
});

describe('SnippetOptimizerService', () => {
  const optimized = { metaTitle: 'T', metaDescription: 'D', aiAnswerCard: 'Kart $10 ve $1 içerir', questionVariants: ['q1'] };

  it('optimize: baska sitenin makalesi 404, model cagrisi yok', async () => {
    const prisma = { article: { findFirst: vi.fn(async () => null), update: vi.fn() } };
    const svc = new SnippetOptimizerService(prisma as any);
    const create = vi.fn();
    (svc as any).anthropic = { messages: { create } };
    await expect(svc.optimize('s2', OWN.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.article.findFirst).toHaveBeenCalledWith({ where: { id: OWN.id, siteId: 's2' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('apply: kapsam + tip denetimi; "$1" icerigi H1 satirini kopyalamaz', async () => {
    const prisma = {
      article: {
        findFirst: vi.fn(async ({ where }: any) => (where.siteId === 's1' ? OWN : null)),
        update: vi.fn(async () => ({})),
      },
    };
    const svc = new SnippetOptimizerService(prisma as any);
    await expect(svc.apply('s2', OWN.id, optimized)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.apply('s1', OWN.id, { ...optimized, metaTitle: { x: 1 } } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.article.update).not.toHaveBeenCalled();

    await svc.apply('s1', OWN.id, optimized);
    const data = (prisma.article.update.mock.calls[0] as any[])[0].data;
    expect(data.bodyMd).toContain('# Başlık\n\n> **Hızlı cevap:** Kart $10 ve $1 içerir\n\n');
    expect(data.bodyMd.match(/# Başlık/g)).toHaveLength(1);
    expect(data.frontmatter.aeo_queries).toEqual(['q1']);
  });

  it('anahtar yokken 503 (500 degil)', async () => {
    const svc = new SnippetOptimizerService({ article: { findFirst: vi.fn() } } as any);
    (svc as any).anthropic = null;
    await expect(svc.optimize('s1', OWN.id)).rejects.toMatchObject({ status: 503 });
  });
});
