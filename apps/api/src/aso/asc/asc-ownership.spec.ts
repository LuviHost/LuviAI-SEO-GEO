import { describe, it, expect, vi, afterEach } from 'vitest';
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
  // Apple'in appStoreVersion kaynaginda yayin tarihi YOK (eski test `releaseDate`
  // varmis gibi kurulmustu — gercekte hic gelmedigi icin alarm hic calismiyordu).
  // Yayin tarihi iTunes Lookup'tan: currentVersionReleaseDate.
  const client = {
    listAppStoreVersions: vi.fn(async () => ({ data: [{ id: 'r1', attributes: { versionString: '1.0', appVersionState: 'READY_FOR_DISTRIBUTION' } }] })),
    listCustomerReviews: vi.fn(async () => ({ data: [] })),
  };
  vi.spyOn(svc as any, 'getClient').mockResolvedValue(client);
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('itunes.apple.com/lookup') ? { results: [{ version: '1.0', currentVersionReleaseDate: releaseDate }] } : {}),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return { svc, prisma, client, fetchMock };
}

afterEach(() => { vi.unstubAllGlobals(); });

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

  it('yayin tarihi iTunes Lookup\'tan; surum durumu appVersionState; ascRelease tarihi canli surume yazilir', async () => {
    const { svc, prisma, fetchMock } = build({ openAlert: false, releaseDaysAgo: 70 });
    await svc.syncReleases('app-1');
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/itunes\.apple\.com\/lookup\?id=123&country=tr$/);
    expect(prisma.ascRelease.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ state: 'READY_FOR_DISTRIBUTION', releaseDate: expect.any(Date) }),
    }));
    expect(prisma.ascApp.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ latestVersion: '1.0' }) }));
  });

  it('iTunes yaniti yoksa tarih bilinmez: mevcut tarih silinmez, alarm yok', async () => {
    const { svc, prisma } = build({ releaseDaysAgo: 200 });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) })));
    await svc.syncReleases('app-1');
    const call = (prisma.ascRelease.upsert as any).mock.calls[0][0];
    expect(call.update).toEqual({ state: 'READY_FOR_DISTRIBUTION' });
    expect(prisma.ascReleaseAlert.create).not.toHaveBeenCalled();
  });

  it('60 gunden yeni release → alert yok', async () => {
    const { svc, prisma } = build({ releaseDaysAgo: 10 });
    await svc.syncReleases('app-1');
    expect(prisma.ascReleaseAlert.findFirst).not.toHaveBeenCalled();
    expect(prisma.ascReleaseAlert.create).not.toHaveBeenCalled();
  });
});
