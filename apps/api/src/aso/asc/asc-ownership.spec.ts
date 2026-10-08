import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AscService } from './asc.service.js';

/**
 * ASC sahiplik + alert tekillestirme. Apple API istemcisi sahte; asil soru
 * baska kullanicinin app'i icin Apple'a HIC gidilmemesi.
 */
const SITES: Record<string, string> = { 'site-a': 'user-a', 'site-b': 'user-b' };

function build(opts: { openAlert?: boolean; releaseDaysAgo?: number } = {}) {
  const prisma = {
    site: { findUnique: vi.fn(async ({ where }: any) => (SITES[where.id] ? { id: where.id, userId: SITES[where.id] } : null)) },
    ascApp: {
      findUnique: vi.fn(async ({ where }: any) => ({
        id: where.id, appleAppId: '123', name: 'App', accountId: 'acc-b',
        account: { id: 'acc-b', siteId: 'site-b' },
      })),
      update: vi.fn(async () => ({})),
    },
    ascAccount: { findUnique: vi.fn(async () => ({ id: 'acc-b', siteId: 'site-b', issuerId: 'i', keyId: 'k', encryptedKey: 'x' })) },
    ascRelease: { upsert: vi.fn(async () => ({})) },
    ascReleaseAlert: {
      findFirst: vi.fn(async () => (opts.openAlert ? { id: 'alert-1' } : null)),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
  };
  const svc = new AscService(prisma as any);
  const releaseDate = new Date(Date.now() - (opts.releaseDaysAgo ?? 90) * 86400_000).toISOString();
  const client = {
    listAppStoreVersions: vi.fn(async () => ({ data: [{ id: 'r1', attributes: { versionString: '1.0', releaseDate, appStoreState: 'READY_FOR_SALE' } }] })),
    listCustomerReviews: vi.fn(async () => ({ data: [] })),
  };
  vi.spyOn(svc as any, 'getClient').mockResolvedValue(client);
  return { svc, prisma, client };
}

const userA = { id: 'user-a', role: 'USER' as const };
const userB = { id: 'user-b', role: 'USER' as const };

describe('AscService sahiplik', () => {
  it('baska kullanicinin app yorumlari → 403, Apple API cagrilmaz', async () => {
    const { svc, client } = build();
    await expect(svc.fetchReviews('app-1', userA)).rejects.toThrow(ForbiddenException);
    expect(client.listCustomerReviews).not.toHaveBeenCalled();
  });

  it('baska kullanicinin app release sync → 403, Apple API cagrilmaz', async () => {
    const { svc, client } = build();
    await expect(svc.syncReleases('app-1', userA)).rejects.toThrow(ForbiddenException);
    expect(client.listAppStoreVersions).not.toHaveBeenCalled();
  });

  it('sahibi gecer', async () => {
    const { svc, client } = build();
    await expect(svc.fetchReviews('app-1', userB)).resolves.toMatchObject({ appId: 'app-1' });
    expect(client.listCustomerReviews).toHaveBeenCalledOnce();
  });
});

describe('AscService release alert tekillestirme', () => {
  it('onaylanmamis alert varken yenisi acilmaz, mevcut guncellenir', async () => {
    const { svc, prisma } = build({ openAlert: true, releaseDaysAgo: 130 });
    await svc.syncReleases('app-1');
    expect(prisma.ascReleaseAlert.create).not.toHaveBeenCalled();
    expect(prisma.ascReleaseAlert.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'alert-1' },
      data: expect.objectContaining({ severity: 'CRITICAL' }),
    }));
  });

  it('acik alert yoksa yeni alert acilir', async () => {
    const { svc, prisma } = build({ openAlert: false, releaseDaysAgo: 70 });
    await svc.syncReleases('app-1');
    expect(prisma.ascReleaseAlert.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ appId: 'app-1', severity: 'WARN' }),
    }));
  });

  it('60 gunden yeni release → alert yok', async () => {
    const { svc, prisma } = build({ releaseDaysAgo: 10 });
    await svc.syncReleases('app-1');
    expect(prisma.ascReleaseAlert.findFirst).not.toHaveBeenCalled();
    expect(prisma.ascReleaseAlert.create).not.toHaveBeenCalled();
  });
});
