import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AsoResourceGuard } from './aso-resource.guard.js';

/**
 * IDOR kapisi: SiteAccessGuard yalnizca :siteId sahipligini dogrular;
 * :appId / :keywordId'nin o siteye ait oldugunu bu guard dogrular.
 */
const APPS: Record<string, string> = { 'app-a': 'site-a', 'app-b': 'site-b' };
const KEYWORDS: Record<string, string> = { 'kw-a': 'app-a', 'kw-b': 'app-b' };

function build() {
  const prisma = {
    trackedApp: {
      findUnique: vi.fn(async ({ where }: any) => (APPS[where.id] ? { siteId: APPS[where.id] } : null)),
    },
    trackedAppKeyword: {
      findUnique: vi.fn(async ({ where }: any) => {
        const appId = KEYWORDS[where.id];
        return appId ? { trackedApp: { siteId: APPS[appId] } } : null;
      }),
    },
  };
  return { guard: new AsoResourceGuard(prisma as any), prisma };
}

const ctx = (params: Record<string, string>) => ({
  switchToHttp: () => ({ getRequest: () => ({ params }) }),
}) as any;

describe('AsoResourceGuard', () => {
  it('kendi sitesinin uygulamasina izin verir', async () => {
    const { guard } = build();
    await expect(guard.canActivate(ctx({ siteId: 'site-a', appId: 'app-a' }))).resolves.toBe(true);
  });

  it('BASKA sitenin uygulamasi → 404 (IDOR kapali, varlik sizdirilmaz)', async () => {
    const { guard } = build();
    await expect(guard.canActivate(ctx({ siteId: 'site-a', appId: 'app-b' }))).rejects.toThrow(NotFoundException);
  });

  it('olmayan uygulama → 404', async () => {
    const { guard } = build();
    await expect(guard.canActivate(ctx({ siteId: 'site-a', appId: 'yok' }))).rejects.toThrow(NotFoundException);
  });

  it('anahtar kelime baska sitenin uygulamasina aitse → 404', async () => {
    const { guard } = build();
    await expect(guard.canActivate(ctx({ siteId: 'site-a', keywordId: 'kw-b' }))).rejects.toThrow(NotFoundException);
    await expect(guard.canActivate(ctx({ siteId: 'site-a', keywordId: 'kw-a' }))).resolves.toBe(true);
  });

  it('alt kaynak parametresi olmayan rotada DB sorgusu yapmaz', async () => {
    const { guard, prisma } = build();
    await expect(guard.canActivate(ctx({ siteId: 'site-a' }))).resolves.toBe(true);
    expect(prisma.trackedApp.findUnique).not.toHaveBeenCalled();
    expect(prisma.trackedAppKeyword.findUnique).not.toHaveBeenCalled();
  });
});
