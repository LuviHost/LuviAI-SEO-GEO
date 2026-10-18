import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { AutoBoostService, AUTO_BOOST_DAILY_BUDGET, AUTO_BOOST_DAYS } from './auto-boost.service.js';

/**
 * Auto-Boost yalniz RanksUp'in bu sitenin makaleleri icin Facebook sayfasinda
 * paylastigi gonderilere bakar. Kanal filtresi eskiden semada olmayan
 * 'FACEBOOK' degeriydi; Prisma sorguyu her turda reddediyordu.
 */

const SITE = { id: 's1', name: 'Site', adsAutopilot: true, metaAdsAccessToken: 'enc', metaAdsAccountId: 'act_1', metaPageId: 'page1' };

function setup(posts: any[]) {
  const prisma: any = {
    site: { findMany: vi.fn(async () => [SITE]) },
    socialPost: { findMany: vi.fn(async () => posts), update: vi.fn(async () => ({})) },
  };
  const meta: any = {
    getPagePostInsights: vi.fn(async (_s: string, id: string) => ({ reach: 1000, engagementRate: id === 'p-top' ? 0.9 : 0.05 })),
    boostPagePost: vi.fn(async () => ({ ok: true, campaignId: 'camp-9', currency: 'USD' })),
  };
  return { svc: new AutoBoostService(prisma, meta), prisma, meta };
}

describe('AutoBoostService', () => {
  it('sorgu semadaki gercek kanal turunu ve yalniz RanksUp makale paylasimlarini kullanir', async () => {
    const enumValues = Prisma.dmmf.datamodel.enums.find((e) => e.name === 'SocialChannelType')!.values.map((v) => v.name);
    const { svc, prisma, meta } = setup([]);
    await expect(svc.findAndBoost()).resolves.toEqual({ siteScanned: 1, boosted: 0 });
    const where = prisma.socialPost.findMany.mock.calls[0][0].where;
    expect(where.article).toEqual({ siteId: 's1' });
    expect(where.status).toBe('PUBLISHED');
    expect(where.channel).toEqual({ type: 'FACEBOOK_PAGE' });
    expect(enumValues).toContain(where.channel.type);
    // Paylasim yok (sosyal paylasim kaldirildi) → Meta'ya hic gidilmez, harcama yok
    expect(meta.getPagePostInsights).not.toHaveBeenCalled();
    expect(meta.boostPagePost).not.toHaveBeenCalled();
  });

  it('aday varsa tutar ve sure degismez (gunluk 50, 7 gun); kullanilan para birimi kayda yazilir', async () => {
    const posts = ['p1', 'p2', 'p3', 'p4', 'p-top'].map((id) => ({ id: `db-${id}`, externalId: id, metadata: null }));
    const { svc, prisma, meta } = setup(posts);
    await expect(svc.findAndBoost()).resolves.toEqual({ siteScanned: 1, boosted: 1 });
    expect(AUTO_BOOST_DAILY_BUDGET).toBe(50);
    expect(AUTO_BOOST_DAYS).toBe(7);
    expect(meta.boostPagePost).toHaveBeenCalledWith('s1', { pageId: 'page1', postId: 'p-top', dailyBudget: 50, days: 7, countries: ['TR'] });
    expect(prisma.socialPost.update.mock.calls[0][0].data.metadata).toMatchObject({ boosted: true, boostBudget: 50, boostCurrency: 'USD', boostDays: 7 });
  });

  it('bu hafta zaten one cikarilmis gonderi varsa yenisi acilmaz', async () => {
    const posts = [{ id: 'a', externalId: 'p-top', metadata: { boosted: true } }, { id: 'b', externalId: 'p1', metadata: null }];
    const { svc, meta } = setup(posts);
    await svc.findAndBoost();
    expect(meta.boostPagePost).not.toHaveBeenCalled();
  });
});
