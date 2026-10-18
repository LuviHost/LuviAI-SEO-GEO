import { describe, it, expect, vi } from 'vitest';
import { ContentOpportunityService } from './content-opportunity.service.js';

/**
 * Kapali dongu "guncelle" modu KULLANICININ baslattigi bir yeniden yazimdir:
 * is verisinde otomatik yeniden yazim bayragi (automatedRewrite) olmamali —
 * yoksa hat editorden gecmeyen taslagi sessizce atardi; kullanici bugunku gibi
 * REVIZE_NEEDED ile duzeltilecek bir yazi gormeli. Onaysiz yayin da yok.
 * Is verisindeki aciklama yazinin adresinin ve ilk yayin tarihinin korundugunu
 * soyler ("tarih tazelendi" artik dogru degil: datePublished ilk yayin kalir).
 */

function build() {
  const prisma = {
    contentOpportunity: {
      findFirst: vi.fn(async () => ({ id: 'o1', siteId: 's1', articleId: null, title: 'Kira artışı nasıl hesaplanır', query: 'kira artışı nasıl hesaplanır', meta: { cited: 0, total: 6, method: 'main-unbranded' } })),
      update: vi.fn(async (a: any) => a),
    },
    site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', userId: 'u1', language: 'tr' })) },
    article: {
      findMany: vi.fn(async () => [{ id: 'a-live', title: 'Kira Artışı Nasıl Hesaplanır?', topic: 'kira artışı nasıl hesaplanır', slug: 'kira-artisi-nasil-hesaplanir' }]),
      create: vi.fn(),
    },
  };
  const jobQueue = { enqueue: vi.fn<(opts: any) => Promise<any>>(async () => ({ dbJobId: 'j1', bullJobId: '1' })) };
  const quota = { enforceArticleQuota: vi.fn(async () => undefined), incrementArticleUsage: vi.fn(async () => undefined) };
  const svc = new ContentOpportunityService(prisma as any, jobQueue as any, quota as any, {} as any, {} as any);
  return { svc, prisma, jobQueue };
}

describe('ContentOpportunityService.generateArticle — guncelleme modu (yayindaki yazi)', () => {
  it('yayindaki yaziyi yeniden yazar: otomatik yeniden yazim bayragi ve onaysiz yayin YOK', async () => {
    const { svc, jobQueue, prisma } = build();
    const r = await svc.generateArticle('s1', 'o1');
    expect(r).toMatchObject({ mode: 'update', articleId: 'a-live' });
    expect(prisma.article.create).not.toHaveBeenCalled();
    const job = jobQueue.enqueue.mock.calls[0][0];
    expect(job).toMatchObject({ type: 'GENERATE_ARTICLE', siteId: 's1', userId: 'u1' });
    expect(job.payload).toMatchObject({ articleId: 'a-live', skipImages: true, lostQuery: 'kira artışı nasıl hesaplanır' });
    expect(job.payload).not.toHaveProperty('automatedRewrite');
    expect(job.payload).not.toHaveProperty('autoPublish');
  });

  it('is aciklamasi dogru: adres ve ilk yayin tarihi korunur (eski metin "tarih tazelendi" diyordu)', async () => {
    const { svc, jobQueue } = build();
    await svc.generateArticle('s1', 'o1');
    const reason = jobQueue.enqueue.mock.calls[0][0].payload.pivotReason as string;
    expect(reason).toContain('adres ve ilk yayın tarihi korunur');
    expect(reason).not.toContain('tazelendi');
  });
});
